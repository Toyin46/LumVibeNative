// app/buy-coins.tsx
// ✅ Flutterwave completely removed — Paystack only
// ✅ No WebView — redirects to lumvibe.site/buy-coins (no Apple/Google 30% fee)
// ✅ email sourced from userProfile first, user fallback second
// ✅ accessibilityLabel on all header buttons
// ✅ transaction-history uses correct absolute Expo Router path
// ✅ currency code shown alongside price on each card
// ✅ support email: lumvibesupport@gmail.com

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from './config/supabase'; 
import { useAuthStore } from './store/authStore'; 
import { detectCurrency, convertFromNgn, formatNgn } from './utils/currencyUtils'; 

const NGN_PER_COIN = 150;
const WEB_BUY_URL  = 'https://lumvibe.site/buy-coins';

const COIN_PACKAGES = [
  { id: 'rose',        coins: 10,    bonusCoins: 0,   priceNgn: 1_500,   popular: false, label: 'Rose',        icon: '🌹', giftHint: 'Send 1 Rose gift' },
  { id: 'ice_cream',   coins: 50,    bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Ice Cream',   icon: '🍦', giftHint: 'Send Ice Cream gifts' },
  { id: 'love_letter', coins: 100,   bonusCoins: 10,  priceNgn: 15_000,  popular: true,  label: 'Love Letter', icon: '💌', giftHint: 'Send Love Letter gifts' },
  { id: 'trophy',      coins: 500,   bonusCoins: 60,  priceNgn: 75_000,  popular: false, label: 'Trophy',      icon: '🏆', giftHint: 'Send Trophy gifts' },
  { id: 'crown',       coins: 1000,  bonusCoins: 100, priceNgn: 150_000, popular: false, label: 'Crown',       icon: '👑', giftHint: 'Send Crown gifts' },
  { id: 'diamond',     coins: 5_000, bonusCoins: 500, priceNgn: 750_000, popular: false, label: 'Diamond',     icon: '💎', giftHint: 'Send Diamond gifts' },
] as const;

export default function BuyCoinsScreen() {
  const router                = useRouter();
  const { user, userProfile } = useAuthStore();
  const currency              = detectCurrency();

  const [loading, setLoading] = useState<string | null>(null);
  const [coins,   setCoins]   = useState(0);

  const loadBalance = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('coins').eq('id', user.id).single();
      setCoins(data?.coins || 0);
    } catch {}
  };

  useEffect(() => { loadBalance(); }, [user?.id]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.includes('buy-coins') && url.includes('credited=true')) {
        loadBalance();
        Alert.alert('🎉 Coins Added!', 'Your coins have been credited to your wallet!', [
          { text: 'Done', onPress: () => router.back() },
        ]);
      }
    });
    return () => sub.remove();
  }, []);

  const handleBuyPackage = async (pkg: typeof COIN_PACKAGES[number]) => {
    if (!user?.id) {
      Alert.alert('Error', 'Please log in to continue.');
      return;
    }

    const userEmail =
      (userProfile as any)?.email ||
      (user as any)?.email ||
      '';

    if (!userEmail.trim()) {
      Alert.alert(
        'Email Required',
        'Please add an email address to your account before purchasing.\n\nGo to Profile → Settings → Edit Profile.',
      );
      return;
    }

    const totalCoins = pkg.coins + pkg.bonusCoins;
    const localPrice = convertFromNgn(pkg.priceNgn, currency);
    const bonusLine  = pkg.bonusCoins > 0
      ? `🎁 Bonus: +${pkg.bonusCoins} coins\n✅ Total: ${totalCoins} coins\n\n`
      : `✅ You get: ${totalCoins} coins\n\n`;

    Alert.alert(
      `${pkg.icon} Buy Coins`,
      `${bonusLine}You will pay ${localPrice} ${currency.code}` +
      `${currency.code !== 'NGN' ? `\n(${formatNgn(pkg.priceNgn)})` : ''}` +
      `\n\n✅ Payment opens on our secure website.\nNo app store fees.\n\nYou'll return here automatically after payment.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay Now →',
          onPress: () => {
            setLoading(pkg.id);
            const params = new URLSearchParams({
              userId:   user.id,
              email:    userEmail,
              type:     'profile',
              pkg:      pkg.id,
              currency: currency.code,
            });
            const url = `${WEB_BUY_URL}?${params.toString()}`;
            Linking.openURL(url).catch(() => {
              Alert.alert('Error', 'Could not open browser. Please try again.');
            }).finally(() => {
              setLoading(null);
            });
          },
        },
      ],
    );
  };

  const localBalance = convertFromNgn(coins * NGN_PER_COIN, currency);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Buy Coins</Text>
        <TouchableOpacity onPress={loadBalance} accessibilityLabel="Refresh balance">
          <Feather name="refresh-cw" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      <View style={s.webNotice}>
        <Text style={s.webNoticeIcon}>🌐</Text>
        <View style={s.webNoticeText}>
          <Text style={s.webNoticeTitle}>Secure Web Payment</Text>
          <Text style={s.webNoticeBody}>
            Tapping Buy opens our secure website. You save up to 30% — no app store fees. You'll return here automatically after payment.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>Profile Wallet</Text>
          <Text style={s.balanceCoins}>{coins.toLocaleString()}</Text>
          <Text style={s.balanceSub}>coins available</Text>
          <Text style={s.balanceNgn}>{localBalance} {currency.code}</Text>
        </View>

        <View style={s.currencyBanner}>
          <Text style={s.currencyBannerText}>
            🌍 Showing prices in{' '}
            <Text style={s.currencyHighlight}>{currency.code}</Text>
            {currency.code !== 'NGN' ? '  ·  Charged in NGN' : ''}
          </Text>
        </View>

        <View style={s.rateCard}>
          <View style={s.rateRow}>
            <View>
              <Text style={s.rateLabel}>1 coin equals</Text>
              <Text style={s.rateValue}>{convertFromNgn(NGN_PER_COIN, currency)} {currency.code}</Text>
            </View>
            {currency.code !== 'NGN' && (
              <View style={s.rateNgnBox}>
                <Text style={s.rateNgnLabel}>NGN base</Text>
                <Text style={s.rateNgn}>{formatNgn(NGN_PER_COIN)}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={s.giftHintBox}>
          <Text style={s.giftHintText}>
            🌹 Rose = 10  ·  🍦 Ice Cream = 50  ·  💌 Love Letter = 100  ·  🏆 Trophy = 500  ·  👑 Crown = 1,000  ·  💎 Diamond = 5,000
          </Text>
        </View>

        <Text style={s.sectionTitle}>Choose a Package</Text>

        {COIN_PACKAGES.map((pkg) => {
          const totalCoins = pkg.coins + pkg.bonusCoins;
          const isLoading  = loading === pkg.id;
          const localPrice = convertFromNgn(pkg.priceNgn, currency);
          return (
            <TouchableOpacity
              key={pkg.id}
              style={[s.card, pkg.popular && s.cardPopular]}
              onPress={() => handleBuyPackage(pkg)}
              disabled={loading !== null}
              activeOpacity={0.8}
              accessibilityLabel={`Buy ${pkg.label} — ${totalCoins} coins for ${localPrice} ${currency.code}`}
            >
              {pkg.popular && (
                <View style={s.popularBadge}>
                  <Text style={s.popularBadgeText}>⭐ Most Popular</Text>
                </View>
              )}
              <View style={s.cardLeft}>
                <Text style={s.cardIcon}>{pkg.icon}</Text>
                <View>
                  <Text style={s.cardLabel}>{pkg.label}</Text>
                  <Text style={s.cardCoins}>{pkg.coins.toLocaleString()} coins</Text>
                  {pkg.bonusCoins > 0 && <Text style={s.cardBonus}>+{pkg.bonusCoins} bonus 🎁</Text>}
                  {pkg.bonusCoins > 0 && <Text style={s.cardTotal}>Total: {totalCoins.toLocaleString()}</Text>}
                  <Text style={s.cardGiftHint}>{pkg.giftHint}</Text>
                </View>
              </View>
              <View style={s.cardRight}>
                <Text style={s.cardLocalPrice}>{localPrice}</Text>
                <Text style={s.cardCurrencyCode}>{currency.code}</Text>
                {currency.code !== 'NGN' && (
                  <Text style={s.cardNgnPrice}>{formatNgn(pkg.priceNgn)}</Text>
                )}
                {isLoading
                  ? <ActivityIndicator size="small" color="#00ff88" style={{ marginTop: 10 }} />
                  : (
                    <View style={[s.buyBtn, pkg.popular && s.buyBtnPopular]}>
                      <Text style={[s.buyBtnText, pkg.popular && s.buyBtnTextPopular]}>Buy →</Text>
                    </View>
                  )}
              </View>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={s.historyLink}
          onPress={() => router.push('/transaction-history')}
          accessibilityLabel="View purchase history"
        >
          <Feather name="clock" size={14} color="#555" />
          <Text style={s.historyLinkText}>View purchase history</Text>
        </TouchableOpacity>

        <View style={s.infoCard}>
          <Text style={s.infoTitle}>ℹ️ How coins work</Text>
          <Text style={s.infoText}>• Send coins as gifts or tips to creators</Text>
          <Text style={s.infoText}>• Coins are non-refundable once purchased</Text>
          <Text style={s.infoText}>• Payments processed securely by Paystack</Text>
          <Text style={s.infoText}>• Coins credited instantly after payment verified</Text>
          <Text style={s.infoText}>• Issues? Email lumvibesupport@gmail.com with your payment reference</Text>
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:        { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  webNotice:          { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#0d1a0d', borderBottomWidth: 1, borderBottomColor: '#00ff8822', padding: 14, paddingHorizontal: 16 },
  webNoticeIcon:      { fontSize: 18, marginTop: 1 },
  webNoticeText:      { flex: 1 },
  webNoticeTitle:     { color: '#00ff88', fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  webNoticeBody:      { color: '#555', fontSize: 12, lineHeight: 18 },
  scroll:             { padding: 16 },
  balanceCard:        { backgroundColor: '#0d1a0d', borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#00ff8833', alignItems: 'center' },
  balanceLabel:       { color: '#666', fontSize: 12, marginBottom: 4 },
  balanceCoins:       { color: '#00ff88', fontSize: 36, fontWeight: 'bold', lineHeight: 42 },
  balanceSub:         { color: '#444', fontSize: 12, marginBottom: 4 },
  balanceNgn:         { color: '#ffd700', fontSize: 15, fontWeight: '600' },
  currencyBanner:     { backgroundColor: '#0d1a0d', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#00ff8833', alignItems: 'center' },
  currencyBannerText: { color: '#888', fontSize: 12, textAlign: 'center' },
  currencyHighlight:  { color: '#00ff88', fontWeight: 'bold' },
  rateCard:           { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#222' },
  rateRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateLabel:          { color: '#666', fontSize: 12, marginBottom: 2 },
  rateValue:          { color: '#00ff88', fontSize: 20, fontWeight: 'bold' },
  rateNgnBox:         { alignItems: 'flex-end' },
  rateNgnLabel:       { color: '#444', fontSize: 10, marginBottom: 2 },
  rateNgn:            { color: '#555', fontSize: 14, fontWeight: '600' },
  giftHintBox:        { backgroundColor: '#0a0a0a', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#1a1a1a' },
  giftHintText:       { color: '#555', fontSize: 11, textAlign: 'center', lineHeight: 18 },
  sectionTitle:       { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  card:               { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#222', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardPopular:        { borderColor: '#00ff8866', backgroundColor: '#0a1a0a' },
  popularBadge:       { position: 'absolute', top: -10, left: 16, backgroundColor: '#00ff88', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  popularBadgeText:   { color: '#000', fontSize: 10, fontWeight: 'bold' },
  cardLeft:           { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 12 },
  cardIcon:           { fontSize: 28, marginTop: 2 },
  cardLabel:          { color: '#666', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  cardCoins:          { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardBonus:          { color: '#ffd700', fontSize: 12, marginTop: 2 },
  cardTotal:          { color: '#00ff88', fontSize: 12, fontWeight: '600' },
  cardGiftHint:       { color: '#444', fontSize: 11, marginTop: 4 },
  cardRight:          { alignItems: 'flex-end' },
  cardLocalPrice:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cardCurrencyCode:   { color: '#666', fontSize: 10, marginTop: 1 },
  cardNgnPrice:       { color: '#555', fontSize: 11, marginTop: 1 },
  buyBtn:             { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8, marginTop: 8, borderWidth: 1, borderColor: '#333' },
  buyBtnPopular:      { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  buyBtnText:         { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  buyBtnTextPopular:  { color: '#000' },
  historyLink:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
  historyLinkText:    { color: '#555', fontSize: 13 },
  infoCard:           { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  infoTitle:          { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  infoText:           { color: '#555', fontSize: 12, lineHeight: 22 },
}); 
