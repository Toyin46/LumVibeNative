// components/AdSlot.tsx — LumVibe ads (feed native ad + rewarded ad)
// ─────────────────────────────────────────────────────────────────────────
// 1) <AdSlot />        → real AdMob NATIVE ad as one full-screen card in the
//                        video feed. Falls back to your own promo card if no
//                        ad loads, so the feed is never blank.
// 2) showRewardedAd()  → "Watch an ad, get coins". Returns what happened;
//                        YOU give the coins (see usage at the bottom).
//
// Policy reminders (AdMob):
//  - Keep the "Ad" badge visible on native ads.
//  - Never tap your own real ads. In dev builds Google test ads are used.
//  - Tell users the reward BEFORE they watch ("Watch an ad, get 5 coins").
// ─────────────────────────────────────────────────────────────────────────

import React, { memo, useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, Dimensions, ActivityIndicator } from 'react-native';
import mobileAds, {
  AdsConsent,
  AdEventType,
  RewardedAd,
  RewardedAdEventType,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  NativeMediaAspectRatio,
  TestIds,
  useNativeAd,
} from 'react-native-google-mobile-ads';

const { height: SCREEN_H } = Dimensions.get('window');

// ── YOUR AD UNIT IDs (from AdMob) ───────────────────────────────────────
// In dev builds (__DEV__) Google's TEST ads are used automatically.
// In release builds the real IDs below are used.
const REAL_NATIVE_UNIT_ID   = 'ca-app-pub-4412719226192046/9972206789'; // feed native ad
const REAL_REWARDED_UNIT_ID = 'ca-app-pub-4412719226192046/9101144095'; // rewarded (coins)

const NATIVE_UNIT_ID   = __DEV__ ? TestIds.NATIVE   : REAL_NATIVE_UNIT_ID;
const REWARDED_UNIT_ID = __DEV__ ? TestIds.REWARDED : REAL_REWARDED_UNIT_ID;

// ── REWARD RATES LIVE IN SUPABASE, NOT HERE ────────────────────────────
// Points per ad, points per coin, daily limit and the wait between ads are
// stored in the `ad_wallet_config` table and enforced by the server, so you
// can change them any time with no new app build, e.g.:
//   update ad_wallet_config set points_per_coin = 150;

// ── START ADS ONCE PER APP SESSION ──────────────────────────────────────
// Asks for ad consent where the law requires it (e.g. Europe/UK), then
// starts the ads SDK. try/catch so it can never crash the app.
let initPromise: Promise<void> | null = null;
export function initAdsOnce(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      try { await AdsConsent.gatherConsent(); } catch { /* no consent form set up: fine */ }
      try { await mobileAds().initialize(); } catch { /* ignore */ }
    })();
  }
  return initPromise;
}

// ═════════════════════════════════════════════════════════════════════════
//  PART 1 — NATIVE AD CARD FOR THE FEED
// ═════════════════════════════════════════════════════════════════════════
type SlotProps = {
  adIndex: number;
  fallback: React.ReactElement; // your existing <NativeAdPost .../>
};

const GIVE_UP_MS = 6000; // no ad after this long → show the fallback card

function AdSlotInner({ fallback }: SlotProps) {
  const [ready, setReady] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    let alive = true;
    initAdsOnce().then(() => { if (alive) setReady(true); });
    const t = setTimeout(() => { if (alive) setGaveUp(true); }, GIVE_UP_MS);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  const { status, nativeAd } = useNativeAd({
    adUnitId: NATIVE_UNIT_ID,
    autoLoad: ready,
    requestOptions: { aspectRatio: NativeMediaAspectRatio.PORTRAIT },
  });

  if (status === 'no-fill' || status === 'error' || (!nativeAd && gaveUp)) {
    return fallback;
  }

  if (!nativeAd) {
    return (
      <View style={s.card}>
        <ActivityIndicator color="#00ff88" />
      </View>
    );
  }

  return (
    <View style={s.card}>
      <NativeAdView nativeAd={nativeAd} style={s.fill}>
        <View style={s.mediaWrap} pointerEvents="box-none">
          <NativeMediaView style={s.media} />
        </View>

        {/* Required label so people know this is an ad */}
        <View style={s.adBadge} pointerEvents="none">
          <Text style={s.adBadgeText}>Ad</Text>
        </View>

        <View style={s.bottom}>
          <View style={s.row}>
            {nativeAd.icon ? (
              <NativeAsset assetType={NativeAssetType.ICON}>
                <Image source={{ uri: nativeAd.icon.url }} style={s.icon} />
              </NativeAsset>
            ) : null}
            <View style={s.titleCol}>
              <NativeAsset assetType={NativeAssetType.HEADLINE}>
                <Text style={s.headline} numberOfLines={2}>{nativeAd.headline}</Text>
              </NativeAsset>
              {nativeAd.advertiser ? (
                <NativeAsset assetType={NativeAssetType.ADVERTISER}>
                  <Text style={s.advertiser} numberOfLines={1}>{nativeAd.advertiser}</Text>
                </NativeAsset>
              ) : null}
            </View>
          </View>

          {nativeAd.body ? (
            <NativeAsset assetType={NativeAssetType.BODY}>
              <Text style={s.body} numberOfLines={3}>{nativeAd.body}</Text>
            </NativeAsset>
          ) : null}

          {nativeAd.callToAction ? (
            <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
              <Text style={s.cta}>{nativeAd.callToAction}</Text>
            </NativeAsset>
          ) : null}
        </View>
      </NativeAdView>
    </View>
  );
}

export default memo(AdSlotInner);

// ═════════════════════════════════════════════════════════════════════════
//  PART 2 — REWARDED AD (the user taps a button, watches, earns points)
// ═════════════════════════════════════════════════════════════════════════
// This only loads and shows the ad. It does NOT give any reward itself: the
// Ad Wallet card calls the server (credit_ad_point) after 'earned', and the
// server enforces the daily limit and the wait between ads.
export type RewardedResult =
  | 'earned'       // user watched it fully → ask the server to credit the point
  | 'dismissed'    // user closed it early → NO reward
  | 'unavailable'; // no ad right now / error / no internet → try again later

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

      const finish = (r: RewardedResult) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        unsubs.forEach(u => { try { u(); } catch { /* ignore */ } });
        resolve(r);
      };

      unsubs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
        loaded = true;
        ad.show().catch(() => finish('unavailable'));
      }));
      unsubs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { earned = true; }));
      unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(earned ? 'earned' : 'dismissed')));
      unsubs.push(ad.addAdEventListener(AdEventType.ERROR, () => finish('unavailable')));

      // If the ad has not loaded after 15 seconds, give up politely.
      timer = setTimeout(() => { if (!loaded) finish('unavailable'); }, 15000);
      ad.load();
    })().catch(() => resolve('unavailable'));
  });
}

/* ── HOW IT IS USED ──────────────────────────────────────────────────────
The Ad Wallet card (AdWalletCard.tsx) calls showRewardedAd() when the user
TAPS its button. NEVER call showRewardedAd() automatically (e.g. between
videos or on screen open).
────────────────────────────────────────────────────────────────────────── */


const s = StyleSheet.create({
  card:        { height: SCREEN_H, width: '100%', backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fill:        { ...StyleSheet.absoluteFillObject },
  mediaWrap:   { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  media:       { width: '100%' },
  adBadge:     { position: 'absolute', top: 110, left: 16, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  adBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  bottom:      { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0.55)' },
  row:         { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon:        { width: 44, height: 44, borderRadius: 10, marginRight: 12 },
  titleCol:    { flex: 1 },
  headline:    { color: '#fff', fontSize: 16, fontWeight: '800' },
  advertiser:  { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
  body:        { color: 'rgba(255,255,255,0.85)', fontSize: 13, lineHeight: 19, marginBottom: 12 },
  cta:         { alignSelf: 'flex-start', backgroundColor: '#00ff88', color: '#000', fontSize: 15, fontWeight: '800', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 22, overflow: 'hidden' },
});
