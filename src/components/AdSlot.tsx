// src/components/AdSlot.tsx — LumVibe ads (feed native ad card + rewarded ad)
// ─────────────────────────────────────────────────────────────────────────
// 1) <AdSlot />        → a real AdMob NATIVE ad shown as a feed-style CARD
//                        (header + media + text + button), not full-bleed.
//                        variant="feed" (default) → Home feed: card with its own height.
//                        variant="page"           → Videos feed: the same card, centred
//                                                   inside a full-height page.
//                        If no ad can be loaded it shows `fallback` (your promo card).
//                        Native ads are PRELOADED into a shared pool (see below), so
//                        a slot normally gets its ad instantly instead of loading on scroll.
// 2) showRewardedAd()  → "Watch an ad, earn points" (used by AdWalletCard).
//
// Policy reminders (AdMob):
//  - Keep the "Ad" badge visible. Never make the card look like a normal post.
//  - Only the registered ad assets are clickable.
//  - Never tap your own real ads. Dev builds use Google's test ads automatically.
// ─────────────────────────────────────────────────────────────────────────

import React, { memo, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from 'react-native';

import mobileAds, {
  AdsConsent,
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  TestIds,
} from 'react-native-google-mobile-ads';

const { height: SCREEN_H } = Dimensions.get('window');
const ACCENT = '#00ff88';

// ── YOUR AD UNIT IDs (from AdMob) ───────────────────────────────────────
// In dev builds (__DEV__) Google's TEST ads are used automatically.
// In release builds the real IDs below are used.
// NOTE: the native unit must be a STANDARD unit (Partner bidding box NOT ticked).
const REAL_NATIVE_UNIT_ID = 'ca-app-pub-4412719226192046/7984937739';
const REAL_REWARDED_UNIT_ID = 'ca-app-pub-4412719226192046/9101144095';

const NATIVE_UNIT_ID = __DEV__ ? TestIds.NATIVE : REAL_NATIVE_UNIT_ID;
const REWARDED_UNIT_ID = __DEV__ ? TestIds.REWARDED : REAL_REWARDED_UNIT_ID;

// ── NATIVE AD KILL SWITCH ───────────────────────────────────────────────
// false = the feeds show your own promo card and the native-ad code never runs (safe off switch)
// (rewarded ads are not affected). Set to true only when you want to test native ads.
const NATIVE_ADS_ENABLED = true;

// ── ON-SCREEN DEBUG LINE ────────────────────────────────────────────────
// true  = when the native ad fails, a tiny red line under the fallback card shows
//         the real AdMob error (e.g. "googleMobileAds/error-code-no-fill").
//         Use this to diagnose in a release build where you cannot see console logs.
// false = hidden. SET THIS TO false once you have read the error.
const SHOW_AD_DEBUG = false;

// ── REWARD RATES LIVE IN SUPABASE, NOT HERE ─────────────────────────────
// Points per ad, points per coin, daily limit and the wait between ads are in
// the `ad_wallet_config` table and enforced by the server.

// ── START ADS ONCE PER APP SESSION ──────────────────────────────────────
const withTimeout = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);

let initPromise: Promise<void> | null = null;

export function initAdsOnce(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await withTimeout(AdsConsent.gatherConsent(), 4000);
      } catch {
        // No consent form or consent error: continue safely.
      }

      try {
        await withTimeout(mobileAds().initialize(), 6000);
      } catch {
        // Do not prevent the app from working if initialization fails.
      }
    })();
  }

  return initPromise;
}

// ═════════════════════════════════════════════════════════════════════════
// PART 1 — NATIVE AD POOL (preloading) + NATIVE AD CARD FOR THE FEEDS
// ═════════════════════════════════════════════════════════════════════════
//
// How it works:
//  - A shared POOL of ready native ads is loaded in the background, ONE request
//    at a time, as soon as this file is imported (so before the user scrolls).
//  - Each feed slot (identified by variant + adIndex) claims one ad from the pool.
//  - A slot keeps its ad even if the FlatList unmounts/remounts it while scrolling
//    (no more spinner + new request every time).
//  - Ads are only destroyed when evicted (too many held) or expired (> 50 min).
//  - If loading keeps failing, slots go straight to your promo `fallback`.

type SlotProps = {
  adIndex: number;
  fallback: React.ReactElement;
  variant?: 'feed' | 'page';
};

type PooledAd = { ad: NativeAd; loadedAt: number };

const POOL_TARGET = 3;                    // ads kept ready in advance
const MAX_ASSIGNED = 8;                   // ads held by slots before old unmounted ones are destroyed
const AD_MAX_AGE_MS = 50 * 60 * 1000;     // AdMob native ads expire after ~1 hour
const RETRY_DELAYS_MS = [15000, 45000, 120000];
const FAILED_COOLDOWN_MS = 60000;         // after all retries fail, wait before trying again
const GIVE_UP_AFTER_INIT_MS = 5000;       // slot shows fallback if no ad is ready this long after init

const pool: PooledAd[] = [];
const assigned = new Map<string, PooledAd>();
const mountedKeys = new Map<string, number>();
const listeners = new Set<() => void>();

let inflight = 0;
let failureCount = 0;
let lastFailAt = 0;
let exhausted = false;
let lastError = '';
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // Ignore listener errors.
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isFresh(p: PooledAd) {
  return Date.now() - p.loadedAt < AD_MAX_AGE_MS;
}

function destroyAd(p: PooledAd) {
  try {
    p.ad.destroy();
  } catch {
    // Ignore destroy errors.
  }
}

function pruneExpired() {
  for (let i = pool.length - 1; i >= 0; i--) {
    if (!isFresh(pool[i])) {
      destroyAd(pool[i]);
      pool.splice(i, 1);
    }
  }
}

function describeError(error: unknown): string {
  const e = error as { code?: string; message?: string } | undefined;
  const code = e?.code ?? 'no-code';
  const message = e?.message ?? String(error);
  return `${code} | ${message}`;
}

function getStatusText(): string {
  if (lastError) return `Native ad: ${lastError}`;
  if (inflight > 0) return 'Native ad: still loading…';
  return 'Native ad: no ad ready';
}

function requestOne() {
  inflight += 1;

  // Promise.resolve().then(...) also catches a synchronous throw
  // (e.g. NativeAd is undefined because the installed build has no native-ad support).
  Promise.resolve()
    .then(() => NativeAd.createForAdRequest(NATIVE_UNIT_ID))
    .then((ad) => {
      inflight -= 1;
      pool.push({ ad, loadedAt: Date.now() });

      failureCount = 0;
      exhausted = false;
      lastError = '';

      if (__DEV__) {
        console.log('[AdSlot] Native ad loaded. Pool size:', pool.length);
      }

      notify();
      fillPool(); // keep filling the pool, one request at a time
    })
    .catch((error: unknown) => {
      inflight -= 1;

      lastError = describeError(error);
      lastFailAt = Date.now();
      failureCount += 1;

      // ← THE ERROR LINE: shows the real reason in `adb logcat` / Metro / Sentry.
      console.warn(
        '[AdSlot] Native ad failed to load →',
        lastError,
        '| unit:',
        NATIVE_UNIT_ID,
        '| attempt:',
        failureCount,
      );

      if (failureCount <= RETRY_DELAYS_MS.length) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          fillPool();
        }, RETRY_DELAYS_MS[failureCount - 1]);
      } else {
        exhausted = true;
      }

      notify();
    });
}

function fillPool() {
  if (!NATIVE_ADS_ENABLED || inflight > 0 || retryTimer || exhausted) return;

  pruneExpired();

  if (pool.length >= POOL_TARGET) return;

  requestOne();
}

function ensureLoading() {
  if (exhausted && Date.now() - lastFailAt > FAILED_COOLDOWN_MS) {
    exhausted = false;
    failureCount = 0;
  }

  fillPool();
}

/** Start loading native ads in the background. Safe to call many times. */
export function preloadNativeAds(): void {
  if (!NATIVE_ADS_ENABLED) return;

  initAdsOnce()
    .then(() => ensureLoading())
    .catch(() => {
      // Ignore: slots fall back to the promo card.
    });
}

function peekAssigned(key: string): NativeAd | null {
  const existing = assigned.get(key);
  return existing && isFresh(existing) ? existing.ad : null;
}

function evictOldAssigned() {
  while (assigned.size > MAX_ASSIGNED) {
    let evicted = false;

    for (const [k, p] of assigned) {
      if (!mountedKeys.has(k)) {
        assigned.delete(k);
        destroyAd(p);
        evicted = true;
        break;
      }
    }

    if (!evicted) break; // everything left is on screen
  }
}

function claimAd(key: string): PooledAd | null {
  const existing = assigned.get(key);

  if (existing) {
    if (isFresh(existing)) return existing;

    assigned.delete(key);
    destroyAd(existing);
  }

  pruneExpired();

  const next = pool.shift();
  if (!next) {
    fillPool();
    return null;
  }

  assigned.set(key, next);
  evictOldAssigned();
  fillPool(); // top the pool back up

  return next;
}

function Page({
  variant,
  children,
}: {
  variant: 'feed' | 'page';
  children?: React.ReactNode;
}) {
  if (variant === 'page') {
    return <View style={s.page}>{children}</View>;
  }

  return <>{children}</>;
}

function AdCard({
  nativeAd,
  variant,
}: {
  nativeAd: NativeAd;
  variant: 'feed' | 'page';
}) {
  const ratio = Math.min(
    1.91,
    Math.max(0.8, (nativeAd.mediaContent as any)?.aspectRatio ?? 1.78),
  );

  return (
    <View style={[s.card, variant === 'page' && { marginBottom: 0 }]}>
      <NativeAdView nativeAd={nativeAd} style={s.adView}>
        {/* HEADER */}
        <View style={s.header}>
          {nativeAd.icon ? (
            <NativeAsset assetType={NativeAssetType.ICON}>
              <Image
                source={{ uri: nativeAd.icon.url }}
                style={s.icon}
              />
            </NativeAsset>
          ) : (
            <View style={[s.icon, s.iconEmpty]} />
          )}

          <View style={s.titleCol}>
            <NativeAsset assetType={NativeAssetType.HEADLINE}>
              <Text style={s.headline} numberOfLines={1}>
                {nativeAd.headline}
              </Text>
            </NativeAsset>

            <View style={s.subRow}>
              <View style={s.adBadge} pointerEvents="none">
                <Text style={s.adBadgeText}>Ad</Text>
              </View>

              {nativeAd.advertiser ? (
                <NativeAsset assetType={NativeAssetType.ADVERTISER}>
                  <Text style={s.advertiser} numberOfLines={1}>
                    {nativeAd.advertiser}
                  </Text>
                </NativeAsset>
              ) : null}
            </View>
          </View>
        </View>

        {/* MEDIA */}
        <View style={s.mediaWrap}>
          <NativeMediaView
            resizeMode="contain"
            style={{ width: '100%', aspectRatio: ratio }}
          />
        </View>

        {/* BODY */}
        {nativeAd.body ? (
          <NativeAsset assetType={NativeAssetType.BODY}>
            <Text style={s.body} numberOfLines={3}>
              {nativeAd.body}
            </Text>
          </NativeAsset>
        ) : null}

        {/* CALL TO ACTION */}
        {nativeAd.callToAction ? (
          <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
            <Text style={s.cta}>{nativeAd.callToAction}</Text>
          </NativeAsset>
        ) : (
          <View style={{ height: 12 }} />
        )}
      </NativeAdView>
    </View>
  );
}

function AdSlotInner({
  adIndex,
  fallback,
  variant = 'feed',
}: SlotProps) {
  const key = `${variant}:${adIndex}`;

  // A remounted slot instantly gets back the ad it already had.
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(() =>
    peekAssigned(key),
  );
  const [gaveUp, setGaveUp] = useState(false);
  const [debugText, setDebugText] = useState('');

  const nativeAdRef = useRef<NativeAd | null>(nativeAd);
  const gaveUpRef = useRef(false);

  useEffect(() => {
    let alive = true;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

    mountedKeys.set(key, (mountedKeys.get(key) ?? 0) + 1);

    const giveUp = () => {
      if (!alive || nativeAdRef.current || gaveUpRef.current) return;

      gaveUpRef.current = true;

      if (giveUpTimer) clearTimeout(giveUpTimer);
      if (SHOW_AD_DEBUG) setDebugText(getStatusText());

      setGaveUp(true);
    };

    const tryClaim = () => {
      if (!alive || nativeAdRef.current || gaveUpRef.current) return;

      const pooled = claimAd(key);

      if (pooled) {
        nativeAdRef.current = pooled.ad;
        if (giveUpTimer) clearTimeout(giveUpTimer);
        setNativeAd(pooled.ad);
        return;
      }

      // Loading failed on every retry → don't keep the user waiting on a spinner.
      if (exhausted) giveUp();
    };

    const unsubscribe = subscribe(tryClaim);

    initAdsOnce().then(() => {
      if (!alive) return;

      ensureLoading();
      tryClaim();

      if (!nativeAdRef.current && !gaveUpRef.current) {
        giveUpTimer = setTimeout(giveUp, GIVE_UP_AFTER_INIT_MS);
      }
    });

    return () => {
      alive = false;
      unsubscribe();

      if (giveUpTimer) clearTimeout(giveUpTimer);

      const count = (mountedKeys.get(key) ?? 1) - 1;
      if (count <= 0) {
        mountedKeys.delete(key);
      } else {
        mountedKeys.set(key, count);
      }
      // NOTE: the ad is NOT destroyed here on purpose — it stays in `assigned`
      // so a remount reuses it. evictOldAssigned() destroys old ones safely.
    };
  }, [key]);

  // Real ad ready.
  if (nativeAd) {
    return (
      <Page variant={variant}>
        <AdCard nativeAd={nativeAd} variant={variant} />
      </Page>
    );
  }

  // No ad → your promo card (plus the optional on-screen error line).
  if (gaveUp) {
    if (SHOW_AD_DEBUG && debugText) {
      return (
        <View>
          {fallback}
          <Text style={s.debug} numberOfLines={2} pointerEvents="none">
            {debugText}
          </Text>
        </View>
      );
    }

    return fallback;
  }

  // Short loading state (only if the pool was not ready yet).
  return (
    <Page variant={variant}>
      <View
        style={[
          s.card,
          s.loadingCard,
          variant === 'page' && { marginBottom: 0 },
        ]}
      >
        <ActivityIndicator color={ACCENT} />
      </View>
    </Page>
  );
}

function AdSlotDisabled({ fallback }: SlotProps) {
  return fallback;
}

export default NATIVE_ADS_ENABLED ? memo(AdSlotInner) : AdSlotDisabled;

// Start preloading as soon as this file is imported (HomeScreen / Videos import it),
// so ads are already waiting before the user scrolls to the first ad slot.
preloadNativeAds();

// ═════════════════════════════════════════════════════════════════════════
// PART 2 — REWARDED AD
// ═════════════════════════════════════════════════════════════════════════

export type RewardedResult =
  | 'earned'
  | 'dismissed'
  | 'unavailable';

export function showRewardedAd(): Promise<RewardedResult> {
  return new Promise<RewardedResult>((resolve) => {
    (async () => {
      await initAdsOnce();

      const ad = RewardedAd.createForAdRequest(REWARDED_UNIT_ID);

      let earned = false;
      let loaded = false;
      let finished = false;

      const unsubs: Array<() => void> = [];
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (result: RewardedResult) => {
        if (finished) return;

        finished = true;

        if (timer) {
          clearTimeout(timer);
        }

        unsubs.forEach((unsubscribe) => {
          try {
            unsubscribe();
          } catch {
            // Ignore cleanup errors.
          }
        });

        resolve(result);
      };

      unsubs.push(
        ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
          loaded = true;

          ad.show().catch(() => finish('unavailable'));
        }),
      );

      unsubs.push(
        ad.addAdEventListener(
          RewardedAdEventType.EARNED_REWARD,
          () => {
            earned = true;
          },
        ),
      );

      unsubs.push(
        ad.addAdEventListener(AdEventType.CLOSED, () => {
          finish(earned ? 'earned' : 'dismissed');
        }),
      );

      unsubs.push(
        ad.addAdEventListener(AdEventType.ERROR, () => {
          finish('unavailable');
        }),
      );

      timer = setTimeout(() => {
        if (!loaded) {
          finish('unavailable');
        }
      }, 15000);

      ad.load();
    })().catch(() => resolve('unavailable'));
  });
}

// ═════════════════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════════════════

const s = StyleSheet.create({
  // Videos feed: one full screen-height page.
  page: {
    height: SCREEN_H,
    width: '100%',
    backgroundColor: '#000',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingTop: 70,
    paddingBottom: 90,
  },

  // Same look as your post cards in the Home feed.
  card: {
    backgroundColor: '#0a0a0a',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },

  loadingCard: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },

  adView: {
    width: '100%',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 44,
  },

  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },

  iconEmpty: {
    backgroundColor: '#1a1a1a',
  },

  titleCol: {
    flex: 1,
  },

  headline: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },

  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },

  adBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)',
    marginRight: 8,
  },

  adBadgeText: {
    color: '#ddd',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  advertiser: {
    color: '#888',
    fontSize: 12,
    flexShrink: 1,
  },

  mediaWrap: {
    width: '100%',
    backgroundColor: '#000',
  },

  // Margins (not padding) so empty space is not part of the clickable ad text.
  body: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 19,
    marginHorizontal: 12,
    marginTop: 12,
  },

  cta: {
    marginHorizontal: 12,
    marginTop: 12,
    marginBottom: 12,
    paddingVertical: 12,
    textAlign: 'center',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: ACCENT,
    color: ACCENT,
    fontSize: 14,
    fontWeight: '800',
    overflow: 'hidden',
  },

  // Debug line (only when SHOW_AD_DEBUG = true and the native ad failed).
  debug: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 2,
    color: '#ff6b6b',
    fontSize: 9,
  },
});
