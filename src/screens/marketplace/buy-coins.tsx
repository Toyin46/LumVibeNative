// app/(tabs)/marketplace/buy-coins.tsx
// ✅ SECRET KEY completely removed — lives only in Supabase Edge Function
// ✅ NO WebView — redirects to lumvibe.site/buy-coins?type=marketplace
// ✅ FIXED: email sourced consistently from userProfile first, user fallback second
// ✅ FIXED: accessibilityLabel on all header buttons
// ✅ FIXED: transaction-history uses correct absolute Expo Router path
// ✅ FIXED: currency code shown alongside price on each card
// ✅ FIXED: support email updated to lumvibesupport@gmail.com

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 
import { detectCurrency, convertFromNgn, formatNgn } from '../../utils/currencyUtils';
import { FLW_TEST_MODE } from '../../utils/flutterwaveUtils';

const NGN_PER_COIN = 150;
const WEB_BUY_URL  = 'https://lumvibe.site/buy-coins';

const COIN_PACKAGES = [
  { id: 'mkt_starter',    coins: 50,   bonusCoins: 0,   priceNgn: 7_500,   popular: false, label: 'Starter',    icon: '🛍️', hint: 'Great for small orders'     },
  { id: 'mkt_basic',      coins: 100,  bonusCoins: 10,  priceNgn: 15_000,  popular: false, label: 'Basic',      icon: '📦', hint: 'Good for mid-range services' },
  { id: 'mkt_standard',   coins: 500,  bonusCoins: 50,  priceNgn: 75_000,  popular: true,  label: 'Standard',   icon: '🚀', hint: 'Best value for creators'     },
  { id: 'mkt_premium',    coins: 1000, bonusCoins: 150, priceNgn: 150_000, popular: false, label: 'Premium',    icon: '💼', hint: 'For frequent buyers'         },
  { id: 'mkt_enterprise', coins: 2500, bonusCoins: 500, priceNgn: 375_000, popular: false, label: 'Enterprise', icon: '🏢', hint: 'For power users & agencies'  },
] as const;

export default function MarketplaceBuyCoinsScreen() {
  const router                = useRouter();
  const { user, userProfile } = useAuthStore();
  const currency              = detectCurrency();

  const [loading, setLoading] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);

  const loadBalance = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('marketplace_coins')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      setBalance(data?.marketplace_coins || 0);
    } catch (err) {
      console.error('[MktBuyCoins] loadBalance error:', err);
    }
  };

  useEffect(() => { if (user?.id) loadBalance(); }, [user?.id]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.includes('marketplace') && url.includes('credited=true')) {
        loadBalance();
        Alert.alert(
          '🎉 Coins Added!',
          'Your marketplace coins have been credited! Start shopping.',
          [{ text: 'Start Shopping →', onPress: () => router.back() }],
        );
      }
    });
    return () => sub.remove();
  }, []);

  const handleBuyPackage = async (pkg: typeof COIN_PACKAGES[number]) => {
    if (!user?.id) { Alert.alert('Error', 'Please log in first'); return; }

    // ✅ FIXED: consistent email — userProfile first, user object fallback
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
      ? `🎁 Bonus: +${pkg.bonusCoins} coins\n✅ Total: ${totalCoins.toLocaleString()} coins\n\n`
      : `✅ You get: ${totalCoins.toLocaleString()} coins\n\n`;

    // ── TEST MODE ────────────────────────────────────────────────────────
    if (FLW_TEST_MODE) {
      Alert.alert(
        `🧪 Test Mode — ${pkg.icon} ${pkg.label}`,
        `${bonusLine}Price: ${localPrice} ${currency.code}\n\nTest mode — no real charge.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Simulate Payment ✓', onPress: async () => {
            setLoading(pkg.id);
            try {
              const ref = `MKT_WEB_${user.id.slice(0, 8).toUpperCase()}_${Date.now()}`;
              const { data } = await supabase.functions.invoke('credit-coins', {
                body: {
                  reference:  ref,
                  packageId:  pkg.id,
                  isTest:     true,
                  walletType: 'marketplace',
                },
              });
              if (data?.success) {
                await loadBalance();
                Alert.alert('🎉 Coins Added!', `${totalCoins} marketplace coins added!`, [
                  { text: 'Start Shopping →', onPress: () => router.back() },
                ]);
              } else {
                Alert.alert('Error', data?.message || 'Simulation failed');
              }
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Simulation failed');
            } finally {
              setLoading(null);
            }
          }},
        ],
      );
      return;
    }

    // ── PRODUCTION: open website ──────────────────────────────────────────
    Alert.alert(
      `${pkg.icon} Buy ${pkg.coins.toLocaleString()} Marketplace Coins`,
      `${bonusLine}You will pay ${localPrice} ${currency.code}` +
      `${currency.code !== 'NGN' ? `\n(${formatNgn(pkg.priceNgn)})` : ''}` +
      `\n\n✅ Payment opens on our secure website.\nNo app store fees.\n\nYou'll return here automatically after payment.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pay Now →', onPress: () => {
          setLoading(pkg.id);
          const params = new URLSearchParams({
            userId:   user.id,
            email:    userEmail,
            type:     'marketplace',
            pkg:      pkg.id,
            currency: currency.code,
          });
          const url = `${WEB_BUY_URL}?${params.toString()}`;
          console.log('[MktBuyCoins] Opening URL:', url);
          Linking.openURL(url).catch(() => {
            Alert.alert('Error', 'Could not open browser. Please try again.');
          }).finally(() => {
            setLoading(null);
          });
        }},
      ],
    );
  };

  const localBalance = convertFromNgn(balance * NGN_PER_COIN, currency);

  return (
    <View style={s.container}>

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Buy Marketplace Coins</Text>
        <TouchableOpacity onPress={loadBalance} accessibilityLabel="Refresh balance">
          <Feather name="refresh-cw" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {FLW_TEST_MODE && (
        <View style={s.testBanner}>
          <Text style={s.testBannerText}>🧪 TEST MODE — No real charge</Text>
        </View>
      )}

      <View style={s.webNotice}>
        <Text style={s.webNoticeIcon}>🌐</Text>
        <View style={s.webNoticeText}>
          <Text style={s.webNoticeTitle}>Secure Web Payment</Text>
          <Text style={s.webNoticeBody}>
            Tapping Buy opens our secure website — no app store fees. You'll return here automatically after payment.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        <View style={s.balanceCard}>
          <MaterialCommunityIcons name="storefront" size={22} color="#8888ff" style={{ marginBottom: 6 }} />
          <Text style={s.balanceLabel}>Marketplace Wallet</Text>
          <Text style={s.balanceCoins}>{balance.toLocaleString()}</Text>
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

        <View style={s.infoBox}>
          <Text style={s.infoBoxTitle}>🛍️ What are Marketplace Coins?</Text>
          <Text style={s.infoBoxText}>
            Used exclusively to purchase services from other creators. Separate from your profile gifting wallet.
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
                  <Text style={s.cardHint}>{pkg.hint}</Text>
                </View>
              </View>
              <View style={s.cardRight}>
                <Text style={s.cardLocalPrice}>{localPrice}</Text>
                <Text style={s.cardCurrencyCode}>{currency.code}</Text>
                {currency.code !== 'NGN' && (
                  <Text style={s.cardNgnPrice}>{formatNgn(pkg.priceNgn)}</Text>
                )}
                {isLoading
                  ? <ActivityIndicator size="small" color="#8888ff" style={{ marginTop: 10 }} />
                  : (
                    <View style={[s.buyBtn, pkg.popular && s.buyBtnPopular]}>
                      <Text style={[s.buyBtnText, pkg.popular && s.buyBtnTextPopular]}>
                        {FLW_TEST_MODE ? 'Test' : 'Buy →'}
                      </Text>
                    </View>
                  )}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* ✅ FIXED: absolute path for Expo Router */}
        <TouchableOpacity
          style={s.historyLink}
          onPress={() => router.push('/transaction-history')}
          accessibilityLabel="View purchase history"
        >
          <Feather name="clock" size={14} color="#555" />
          <Text style={s.historyLinkText}>View purchase history</Text>
        </TouchableOpacity>

        <View style={s.bottomInfo}>
          <Text style={s.bottomInfoTitle}>ℹ️ About Marketplace Coins</Text>
          <Text style={s.bottomInfoText}>• Used to buy services from other creators</Text>
          <Text style={s.bottomInfoText}>• Separate from your profile gifting wallet</Text>
          <Text style={s.bottomInfoText}>• Non-refundable once purchased</Text>
          <Text style={s.bottomInfoText}>• Payments secured by Paystack & Flutterwave</Text>
          <Text style={s.bottomInfoText}>• Issues? Email lumvibesupport@gmail.com with your payment reference</Text>
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
  testBanner:         { backgroundColor: '#1a1200', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ffd70033' },
  testBannerText:     { fontSize: 11, color: '#ffd700', textAlign: 'center' },
  webNotice:          { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#0d0d1a', borderBottomWidth: 1, borderBottomColor: '#8888ff22', padding: 14, paddingHorizontal: 16 },
  webNoticeIcon:      { fontSize: 18, marginTop: 1 },
  webNoticeText:      { flex: 1 },
  webNoticeTitle:     { color: '#8888ff', fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  webNoticeBody:      { color: '#555', fontSize: 12, lineHeight: 18 },
  scroll:             { padding: 16 },
  balanceCard:        { backgroundColor: '#0d0d1a', borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: '#8888ff33', alignItems: 'center' },
  balanceLabel:       { color: '#666', fontSize: 12, marginBottom: 4 },
  balanceCoins:       { color: '#8888ff', fontSize: 36, fontWeight: 'bold', lineHeight: 42 },
  balanceSub:         { color: '#444', fontSize: 12, marginBottom: 4 },
  balanceNgn:         { color: '#ffd700', fontSize: 15, fontWeight: '600' },
  currencyBanner:     { backgroundColor: '#0d0d1a', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#8888ff33', alignItems: 'center' },
  currencyBannerText: { color: '#888', fontSize: 12, textAlign: 'center' },
  currencyHighlight:  { color: '#8888ff', fontWeight: 'bold' },
  infoBox:            { backgroundColor: '#0a0a0a', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  infoBoxTitle:       { color: '#8888ff', fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
  infoBoxText:        { color: '#666', fontSize: 12, lineHeight: 18 },
  rateCard:           { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  rateRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateLabel:          { color: '#666', fontSize: 12, marginBottom: 2 },
  rateValue:          { color: '#8888ff', fontSize: 20, fontWeight: 'bold' },
  rateNgnBox:         { alignItems: 'flex-end' },
  rateNgnLabel:       { color: '#444', fontSize: 10, marginBottom: 2 },
  rateNgn:            { color: '#555', fontSize: 14, fontWeight: '600' },
  sectionTitle:       { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  card:               { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#222', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardPopular:        { borderColor: '#8888ff66', backgroundColor: '#0d0d1a' },
  popularBadge:       { position: 'absolute', top: -10, left: 16, backgroundColor: '#8888ff', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  popularBadgeText:   { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  cardLeft:           { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 12 },
  cardIcon:           { fontSize: 26, marginTop: 2 },
  cardLabel:          { color: '#666', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  cardCoins:          { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardBonus:          { color: '#ffd700', fontSize: 12, marginTop: 2 },
  cardTotal:          { color: '#8888ff', fontSize: 12, fontWeight: '600' },
  cardHint:           { color: '#444', fontSize: 11, marginTop: 4 },
  cardRight:          { alignItems: 'flex-end' },
  cardLocalPrice:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cardCurrencyCode:   { color: '#666', fontSize: 10, marginTop: 1 },
  cardNgnPrice:       { color: '#555', fontSize: 11, marginTop: 1 },
  buyBtn:             { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8, marginTop: 8, borderWidth: 1, borderColor: '#333' },
  buyBtnPopular:      { backgroundColor: '#8888ff', borderColor: '#8888ff' },
  buyBtnText:         { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  buyBtnTextPopular:  { color: '#fff' },
  historyLink:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
  historyLinkText:    { color: '#555', fontSize: 13 },
  bottomInfo:         { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  bottomInfoTitle:    { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  bottomInfoText:     { color: '#555', fontSize: 12, lineHeight: 22 },
}); 
