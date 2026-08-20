// src/components/BuyCoinsScreen.tsx
//
// REDUNDANCY FIX: this replaces the ~90%-duplicated app/buy-coins.tsx and
// app/screens/marketplace/buy-coins.tsx. Both screens did the same thing —
// load a balance, show packages, redirect to the web checkout — with only
// the wallet column, coin packages, color theme, and a couple of copy
// strings actually differing. Everything that differed is now passed in as
// `config`, and the two original files become tiny wrappers (see
// src/buy-coins.tsx and src/screens/marketplace/buy-coins.tsx below).
//
// Fixing this in one place also means the earlier "extra () on goBack()"
// class of bug only has one call site to go wrong in, not two.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Linking,
} from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { detectCurrency, convertFromNgn, formatNgn } from '../utils/currencyUtils';
import { FLW_TEST_MODE } from '../utils/flutterwaveUtils';
import { useScreenPadding } from '@/hooks/useScreenPadding'; 

const NGN_PER_COIN = 150;
const WEB_BUY_URL  = 'https://lumvibe.site/buy-coins';

export interface CoinPackage {
  id: string;
  coins: number;
  bonusCoins: number;
  priceNgn: number;
  popular: boolean;
  label: string;
  icon: string;
  hint: string; // was `giftHint` on profile screen, `hint` on marketplace — unified name
}

export interface BuyCoinsConfig {
  walletType: 'profile' | 'marketplace';
  walletColumn: string;              // 'coins' | 'marketplace_coins'
  purchaseType: string;              // sent to the web checkout as ?type=
  packages: readonly CoinPackage[];
  accentColor: string;               // e.g. '#00ff88' (profile) or '#8888ff' (marketplace)
  headerTitle: string;
  walletLabel: string;
  walletIcon?: keyof typeof MaterialCommunityIcons.glyphMap; // marketplace shows a storefront icon
  infoBanner?: { title: string; body: string };              // "What are Marketplace Coins?" box
  bottomInfoLines: string[];
  successMessage: { title: string; body: string; ctaLabel: string };
  redirectUrlMatch: string;          // substring to check for in the deep-link callback
  navigateBackViaParent?: boolean;   // marketplace screen needs getParent() since it's nested
}

export default function BuyCoinsScreen({ config }: { config: BuyCoinsConfig }) {
  const navigation = useNavigation<any>();
  const { user, userProfile } = useAuthStore();
  const currency              = detectCurrency();

  const [loading, setLoading] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);

  const loadBalance = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('users')
        .select(config.walletColumn)
        .eq('id', user.id)
        .single();
      if (error) throw error;
      setBalance((data as any)?.[config.walletColumn] || 0);
    } catch (err) {
      console.error(`[BuyCoins:${config.walletType}] loadBalance error:`, err);
    }
  };

  useEffect(() => { if (user?.id) loadBalance(); }, [user?.id]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => {
      if (url.includes(config.redirectUrlMatch) && url.includes('credited=true')) {
        loadBalance();
        Alert.alert(config.successMessage.title, config.successMessage.body, [
          { text: config.successMessage.ctaLabel, onPress: () => navigation.goBack() },
        ]);
      }
    });
    return () => sub.remove();
  }, []);

  const goBack = () => {
    if (config.navigateBackViaParent) {
      navigation.getParent()?.navigate('TransactionHistory');
    } else {
      navigation.navigate('TransactionHistory' as never);
    }
  };

  const handleBuyPackage = async (pkg: CoinPackage) => {
    if (!user?.id) { Alert.alert('Error', 'Please log in to continue.'); return; }

    const userEmail = (userProfile as any)?.email || (user as any)?.email || '';

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

    if (FLW_TEST_MODE) {
      Alert.alert(
        `🧪 Test Mode — ${pkg.icon} ${pkg.label}`,
        `${bonusLine}Price: ${localPrice} ${currency.code}\n\nTest mode — no real charge.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Simulate Payment ✓', onPress: async () => {
            setLoading(pkg.id);
            try {
              const ref = `${config.walletType.toUpperCase()}_WEB_${user.id.slice(0, 8).toUpperCase()}_${Date.now()}`;
              const { data } = await supabase.functions.invoke('credit-coins', {
                body: {
                  reference:  ref,
                  packageId:  pkg.id,
                  isTest:     true,
                  walletType: config.walletType,
                },
              });
              if (data?.success) {
                await loadBalance();
                Alert.alert(config.successMessage.title, `${totalCoins} coins added!`, [
                  { text: config.successMessage.ctaLabel, onPress: () => navigation.goBack() },
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
              type:     config.purchaseType,
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

  const localBalance = convertFromNgn(balance * NGN_PER_COIN, currency);
  const s = makeStyles(config.accentColor);
  const pad = useScreenPadding();

  return (
    <View style={s.container}>
      {/* POLISH FIX: was a hardcoded paddingTop: 60, which either left dead
          space or got covered by the status bar/notch depending on phone.
          Now uses the device's real safe area. */}
      <View style={[s.header, { paddingTop: pad.top + 16 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{config.headerTitle}</Text>
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
          {config.walletIcon && (
            <MaterialCommunityIcons name={config.walletIcon} size={22} color={config.accentColor} style={{ marginBottom: 6 }} />
          )}
          <Text style={s.balanceLabel}>{config.walletLabel}</Text>
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

        {config.infoBanner && (
          <View style={s.infoBox}>
            <Text style={s.infoBoxTitle}>{config.infoBanner.title}</Text>
            <Text style={s.infoBoxText}>{config.infoBanner.body}</Text>
          </View>
        )}

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

        {config.packages.map((pkg) => {
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
                  <Text style={s.cardGiftHint}>{pkg.hint}</Text>
                </View>
              </View>
              <View style={s.cardRight}>
                <Text style={s.cardLocalPrice}>{localPrice}</Text>
                <Text style={s.cardCurrencyCode}>{currency.code}</Text>
                {currency.code !== 'NGN' && (
                  <Text style={s.cardNgnPrice}>{formatNgn(pkg.priceNgn)}</Text>
                )}
                {isLoading
                  ? <ActivityIndicator size="small" color={config.accentColor} style={{ marginTop: 10 }} />
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

        <TouchableOpacity
          style={s.historyLink}
          onPress={goBack}
          accessibilityLabel="View purchase history"
        >
          <Feather name="clock" size={14} color="#555" />
          <Text style={s.historyLinkText}>View purchase history</Text>
        </TouchableOpacity>

        <View style={s.infoCard}>
          <Text style={s.infoTitle}>ℹ️ How coins work</Text>
          {config.bottomInfoLines.map((line, i) => (
            <Text key={i} style={s.infoText}>• {line}</Text>
          ))}
        </View>
        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

// Styles take the accent color as a parameter so the profile (green) and
// marketplace (purple) themes stay visually distinct, exactly as before.
const makeStyles = (accent: string) => StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:        { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  testBanner:         { backgroundColor: '#1a1200', paddingVertical: 8, paddingHorizontal: 16, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#ffd70033' },
  testBannerText:     { fontSize: 11, color: '#ffd700', textAlign: 'center' },
  webNotice:          { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#0d0d0d', borderBottomWidth: 1, borderBottomColor: `${accent}22`, padding: 14, paddingHorizontal: 16 },
  webNoticeIcon:      { fontSize: 18, marginTop: 1 },
  webNoticeText:      { flex: 1 },
  webNoticeTitle:     { color: accent, fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  webNoticeBody:      { color: '#555', fontSize: 12, lineHeight: 18 },
  scroll:             { padding: 16 },
  balanceCard:        { backgroundColor: '#0d0d0d', borderRadius: 16, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: `${accent}33`, alignItems: 'center' },
  balanceLabel:       { color: '#666', fontSize: 12, marginBottom: 4 },
  balanceCoins:       { color: accent, fontSize: 36, fontWeight: 'bold', lineHeight: 42 },
  balanceSub:         { color: '#444', fontSize: 12, marginBottom: 4 },
  balanceNgn:         { color: '#ffd700', fontSize: 15, fontWeight: '600' },
  currencyBanner:     { backgroundColor: '#0d0d0d', borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: `${accent}33`, alignItems: 'center' },
  currencyBannerText: { color: '#888', fontSize: 12, textAlign: 'center' },
  currencyHighlight:  { color: accent, fontWeight: 'bold' },
  infoBox:            { backgroundColor: '#0a0a0a', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  infoBoxTitle:       { color: accent, fontSize: 13, fontWeight: 'bold', marginBottom: 6 },
  infoBoxText:        { color: '#666', fontSize: 12, lineHeight: 18 },
  rateCard:           { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  rateRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateLabel:          { color: '#666', fontSize: 12, marginBottom: 2 },
  rateValue:          { color: accent, fontSize: 20, fontWeight: 'bold' },
  rateNgnBox:         { alignItems: 'flex-end' },
  rateNgnLabel:       { color: '#444', fontSize: 10, marginBottom: 2 },
  rateNgn:            { color: '#555', fontSize: 14, fontWeight: '600' },
  sectionTitle:       { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  card:               { backgroundColor: '#111', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#222', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardPopular:        { borderColor: `${accent}66`, backgroundColor: '#0d0d0d' },
  popularBadge:       { position: 'absolute', top: -10, left: 16, backgroundColor: accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  popularBadgeText:   { color: '#000', fontSize: 10, fontWeight: 'bold' },
  cardLeft:           { flexDirection: 'row', alignItems: 'flex-start', flex: 1, gap: 12 },
  cardIcon:           { fontSize: 28, marginTop: 2 },
  cardLabel:          { color: '#666', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginBottom: 2 },
  cardCoins:          { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  cardBonus:          { color: '#ffd700', fontSize: 12, marginTop: 2 },
  cardTotal:          { color: accent, fontSize: 12, fontWeight: '600' },
  cardGiftHint:       { color: '#444', fontSize: 11, marginTop: 4 },
  cardRight:          { alignItems: 'flex-end' },
  cardLocalPrice:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cardCurrencyCode:   { color: '#666', fontSize: 10, marginTop: 1 },
  cardNgnPrice:       { color: '#555', fontSize: 11, marginTop: 1 },
  buyBtn:             { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8, marginTop: 8, borderWidth: 1, borderColor: '#333' },
  buyBtnPopular:      { backgroundColor: accent, borderColor: accent },
  buyBtnText:         { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  buyBtnTextPopular:  { color: '#000' },
  historyLink:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginBottom: 8 },
  historyLinkText:    { color: '#555', fontSize: 13 },
  infoCard:           { backgroundColor: '#0d0d0d', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  infoTitle:          { color: '#fff', fontSize: 13, fontWeight: 'bold', marginBottom: 10 },
  infoText:           { color: '#555', fontSize: 12, lineHeight: 22 },
});
