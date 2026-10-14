// src/components/AdWalletCard.tsx — "Watch an ad, earn points" card
// Put this next to BuyCoinsScreen.tsx and AdSlot.tsx (src/components/).
//
// The user taps the button → a rewarded ad plays → if they watch it fully,
// the SERVER (credit_ad_point) adds the point, enforces the daily limit and
// the wait between ads, and turns every 100 points into 1 coin automatically.
// Nothing here plays automatically; it only runs when the user taps.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { supabase } from '../config/supabase';
import { showRewardedAd } from './AdSlot';

type WalletState = {
  points: number;
  points_per_coin: number;
  points_per_ad: number;
  daily_limit: number;
  ads_today: number;
  ads_left: number;
  cooldown_seconds_left: number;
  coins_earned: number;
};

type Props = {
  accentColor: string;
  onCoinsAdded?: () => void; // e.g. loadBalance, so the coin balance refreshes
};

export default function AdWalletCard({ accentColor, onCoinsAdded }: Props) {
  const [state, setState] = useState<WalletState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_ad_wallet');
      if (error) throw error;
      setState(data as WalletState);
      setFailed(false);
    } catch (e) {
      console.warn('[AdWallet] load failed:', e);
      setFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onWatch = async () => {
    if (!state || busy) return;
    if (state.ads_left <= 0) {
      Alert.alert('Come back tomorrow', "You've watched all of today's ads. Your limit resets at midnight.");
      return;
    }
    if (state.cooldown_seconds_left > 0) {
      Alert.alert('One moment', `Please wait ${state.cooldown_seconds_left} seconds before the next ad.`);
      return;
    }

    setBusy(true);
    try {
      const result = await showRewardedAd();
      if (result === 'dismissed') {
        Alert.alert('No points', 'Watch the whole ad to earn your point.');
      } else if (result === 'unavailable') {
        Alert.alert('No ad right now', 'Please try again in a bit.');
      } else {
        const { data, error } = await supabase.rpc('credit_ad_point');
        if (error) throw error;
        setState(data as WalletState);
        if (data?.ok === false) {
          Alert.alert(
            data.reason === 'limit' ? 'Come back tomorrow' : 'One moment',
            data.reason === 'limit'
              ? "You've watched all of today's ads."
              : 'Please wait a few seconds before the next ad.',
          );
        } else if (data?.coins_added > 0) {
          Alert.alert('🎉 You earned a coin!', `${data.coins_added} coin added to your balance.`);
          onCoinsAdded?.();
        }
      }
    } catch (e: any) {
      console.warn('[AdWallet] watch failed:', e);
      Alert.alert('Something went wrong', 'Please try again in a moment.');
      load();
    } finally {
      setBusy(false);
    }
  };

  // If the wallet is not set up yet (SQL not run) or offline, show nothing.
  if (failed || !state) {
    return failed ? null : (
      <View style={[s.card, { borderColor: `${accentColor}33` }]}>
        <ActivityIndicator color={accentColor} />
      </View>
    );
  }

  const pct = Math.min(100, Math.round((state.points / state.points_per_coin) * 100));
  const outOfAds = state.ads_left <= 0;

  return (
    <View style={[s.card, { borderColor: `${accentColor}33` }]}>
      <View style={s.topRow}>
        <Text style={s.title}>🎁 Free coins</Text>
        <Text style={s.small}>{state.ads_left} ads left today</Text>
      </View>

      <Text style={s.progressText}>
        <Text style={{ color: accentColor, fontWeight: '800' }}>{state.points}</Text>
        {` / ${state.points_per_coin} points → 1 coin`}
      </Text>
      <View style={s.track}>
        <View style={[s.fill, { width: `${pct}%`, backgroundColor: accentColor }]} />
      </View>

      <TouchableOpacity
        style={[s.btn, { backgroundColor: outOfAds ? '#222' : accentColor }]}
        onPress={onWatch}
        disabled={busy}
        activeOpacity={0.8}
        accessibilityLabel="Watch an ad to earn points"
      >
        {busy
          ? <ActivityIndicator color={outOfAds ? '#888' : '#000'} />
          : <Text style={[s.btnText, outOfAds && { color: '#888' }]}>
              {outOfAds ? 'Come back tomorrow' : `Watch an ad, earn ${state.points_per_ad} point`}
            </Text>}
      </TouchableOpacity>

      <Text style={s.note}>
        Watch the whole ad to earn a point. {state.points_per_coin} points = 1 coin.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card:         { backgroundColor: '#0d0d0d', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1 },
  topRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title:        { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  small:        { color: '#777', fontSize: 12 },
  progressText: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  track:        { height: 8, borderRadius: 4, backgroundColor: '#1a1a1a', overflow: 'hidden', marginBottom: 14 },
  fill:         { height: 8, borderRadius: 4 },
  btn:          { borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  btnText:      { color: '#000', fontSize: 14, fontWeight: '800' },
  note:         { color: '#555', fontSize: 11, marginTop: 10, textAlign: 'center' },
});
