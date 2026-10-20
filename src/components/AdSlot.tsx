// src/components/AdSlot.tsx — LumVibe ads (feed native ad card + rewarded ad)
// ─────────────────────────────────────────────────────────────────────────
// 1) <AdSlot />        → a real AdMob NATIVE ad shown as a feed-style CARD
//                        (header + media + text + button), not full-bleed.
//                        variant="feed" (default) → Home feed: card with its own height.
//                        variant="page"           → Videos feed: the same card, centred
//                                                   inside a full-height page.
//                        If no ad can be loaded it shows `fallback` (your promo card).
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
// PART 1 — NATIVE AD CARD FOR THE FEEDS
// ═════════════════════════════════════════════════════════════════════════

type SlotProps = {
  adIndex: number;
  fallback: React.ReactElement;
  variant?: 'feed' | 'page';
};

const GIVE_UP_MS = 8000;
const RETRY_DELAYS_MS = [15000, 45000];

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
  fallback,
  variant = 'feed',
}: SlotProps) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);
  const [requestAttempt, setRequestAttempt] = useState(0);

  const retries = useRef(0);

  // Initialize the ads SDK and keep the existing loading timeout.
  useEffect(() => {
    let alive = true;

    initAdsOnce().then(() => {
      if (alive) {
        setReady(true);
      }
    });

    const timeout = setTimeout(() => {
      if (alive) {
        setGaveUp(true);
      }
    }, GIVE_UP_MS);

    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, []);

  // Load native ads using the documented API for the installed library.
  useEffect(() => {
    if (!ready) return;

    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    NativeAd.createForAdRequest(NATIVE_UNIT_ID)
      .then((ad) => {
        if (!alive) {
          ad.destroy();
          return;
        }

        setNativeAd(ad);
        setFailed(false);
        setGaveUp(false);
      })
      .catch((error: unknown) => {
        if (!alive) return;

        console.warn(
          '[AdSlot] Native ad failed to load:',
          error instanceof Error ? error.message : error,
        );

        if (retries.current < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[retries.current];
          retries.current += 1;

          retryTimer = setTimeout(() => {
            if (alive) {
              setRequestAttempt((attempt) => attempt + 1);
            }
          }, delay);
        } else {
          setFailed(true);
        }
      });

    return () => {
      alive = false;

      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [ready, requestAttempt]);

  // Release the loaded native ad when it is replaced or the slot unmounts.
  useEffect(() => {
    return () => {
      nativeAd?.destroy();
    };
  }, [nativeAd]);

  // Real ad successfully loaded.
  if (nativeAd) {
    return (
      <Page variant={variant}>
        <AdCard nativeAd={nativeAd} variant={variant} />
      </Page>
    );
  }

  // Preserve the existing promotional fallback.
  if (failed || gaveUp) {
    return fallback;
  }

  // Preserve the original loading-card layout.
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
});
