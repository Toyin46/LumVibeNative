// app/(tabs)/marketplace/listing/[id].tsx
// ✅ Double payment bug FIXED
// ✅ Translations added via useTranslation()

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Alert, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../../config/supabase'; 
import { useAuthStore } from '../../../store/authStore';
import { useTranslation } from '../../../locales/LanguageContext'; 

const COIN_TO_NGN = 150;
function coinsToNGN(coins: number): string {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}

export default function ListingDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const { t }    = useTranslation();

  const [listing,     setListing]     = useState<any>(null);
  const [loading,     setLoading]     = useState(true);
  const [ordering,    setOrdering]    = useState(false);
  const [buyerWallet, setBuyerWallet] = useState<number>(0);
  const orderInProgress = useRef(false);

  useEffect(() => { if (id) loadListing(); }, [id]);

  const loadListing = async () => {
    try {
      const { data, error } = await supabase
        .from('marketplace_listings')
        .select('*, seller:users!marketplace_listings_seller_id_fkey(id, username, display_name, avatar_url, followers_count, bio)')
        .eq('id', id).single();
      if (error) throw error;
      setListing(data);
      supabase.from('marketplace_listings').update({ views_count: (data.views_count || 0) + 1 }).eq('id', id).then(() => {});
      if (user) {
        const { data: w } = await supabase.from('users').select('marketplace_coins').eq('id', user.id).single();
        setBuyerWallet(w?.marketplace_coins || 0);
      }
    } catch (e: any) { Alert.alert(t.errors.generic, e.message); }
    finally { setLoading(false); }
  };

  const handleOrder = () => {
    if (!user) { Alert.alert('Login Required', 'Please login to place an order'); return; }
    if (!listing) return;
    if (listing.seller_id === user.id) { Alert.alert(t.errors.generic, 'You cannot order your own listing'); return; }
    if (orderInProgress.current) return;

    if (buyerWallet < listing.price_coins) {
      Alert.alert(
        '💰 Insufficient Marketplace Coins',
        `You need ${listing.price_coins} coins (${coinsToNGN(listing.price_coins)}) in your marketplace wallet.\n\nYou have: ${buyerWallet} coins (${coinsToNGN(buyerWallet)})\n\nTop up your marketplace wallet to continue.`,
        [
          { text: t.common.cancel, style: 'cancel' },
          { text: 'Buy Coins Now', onPress: () => router.push('/(tabs)/marketplace/buy-coins' as any) },
        ]
      );
      return;
    }

    Alert.alert(
      'Confirm Order',
      `Place order for "${listing.title}"?\n\nCost: ${listing.price_coins} coins (${coinsToNGN(listing.price_coins)})\nDelivery: ${listing.delivery_days} days\nPlatform fee: 10% · Seller gets 90%`,
      [
        { text: t.common.cancel, style: 'cancel' },
        { text: 'Order Now', onPress: () => {
          if (orderInProgress.current) return;
          orderInProgress.current = true;
          confirmOrder().finally(() => { orderInProgress.current = false; });
        }},
      ]
    );
  };

  const confirmOrder = async () => {
    setOrdering(true);
    try {
      const { data: fresh, error: fetchErr } = await supabase.from('users').select('marketplace_coins').eq('id', user!.id).single();
      if (fetchErr) throw fetchErr;
      const balance = fresh?.marketplace_coins || 0;
      if (balance < listing.price_coins) { Alert.alert(t.videos.insufficientCoins, 'Your marketplace wallet balance is too low. Please top up.'); return; }

      const { error: deductErr } = await supabase.from('users').update({ marketplace_coins: balance - listing.price_coins }).eq('id', user!.id);
      if (deductErr) throw deductErr;

      const platformFee    = Math.floor(listing.price_coins * 0.10);
      const sellerEarnings = listing.price_coins - platformFee;

      const { error: orderErr } = await supabase.from('marketplace_orders').insert({
        listing_id: listing.id, listing_title: listing.title,
        buyer_id: user!.id, seller_id: listing.seller_id,
        price_coins: listing.price_coins, status: 'pending',
        delivery_days: listing.delivery_days,
        deadline: new Date(Date.now() + listing.delivery_days * 86400000).toISOString(),
        requirements: '', platform_fee_coins: platformFee, seller_earnings_coins: sellerEarnings,
      });

      if (orderErr) {
        await supabase.from('users').update({ marketplace_coins: balance }).eq('id', user!.id);
        throw orderErr;
      }

      setBuyerWallet(balance - listing.price_coins);
      await supabase.from('notifications').insert({
        user_id: listing.seller_id, from_user_id: user!.id, type: 'marketplace',
        title: 'New Order! 🛍️', message: `You have a new order for "${listing.title}"`, is_read: false,
      });

      Alert.alert('Order Placed! 🎉', 'Your order has been placed. The seller will be notified.', [
        { text: 'View Orders', onPress: () => router.push('/(tabs)/marketplace/orders' as any) },
      ]);
    } catch (e: any) {
      Alert.alert(t.errors.generic, e.message || 'Something went wrong. Please try again.');
    } finally { setOrdering(false); }
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>;
  if (!listing) return <View style={s.center}><Text style={{ color: '#fff' }}>Listing not found</Text></View>;
  const isOwner = user?.id === listing.seller_id;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}><Feather name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{listing.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {listing.portfolio_urls?.length > 0 ? (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {listing.portfolio_urls.map((url: string, i: number) => (
              <Image key={i} source={{ uri: url }} style={s.portfolioImg} resizeMode="cover" />
            ))}
          </ScrollView>
        ) : (
          <View style={s.portfolioPlaceholder}><Text style={{ fontSize: 64 }}>🛍️</Text></View>
        )}

        <View style={s.body}>
          <Text style={s.title}>{listing.title}</Text>
          <View style={s.priceRow}>
            <Text style={s.price}>{listing.price_coins} 🪙</Text>
            <Text style={s.priceNgn}>{coinsToNGN(listing.price_coins)}</Text>
          </View>
          <View style={s.statsRow}>
            <View style={s.stat}><Text style={s.statNum}>⏱ {listing.delivery_days}d</Text><Text style={s.statLabel}>Delivery</Text></View>
            <View style={s.stat}><Text style={s.statNum}>🔄 {listing.revisions}</Text><Text style={s.statLabel}>Revisions</Text></View>
            <View style={s.stat}><Text style={s.statNum}>📦 {listing.orders_count || 0}</Text><Text style={s.statLabel}>Orders</Text></View>
          </View>

          <TouchableOpacity style={s.sellerCard} onPress={() => router.push(`/user/${listing.seller_id}` as any)} activeOpacity={0.8}>
            {listing.seller?.avatar_url
              ? <Image source={{ uri: listing.seller.avatar_url }} style={s.sellerAvatar} />
              : <View style={[s.sellerAvatar, s.avatarPh]}><Feather name="user" size={20} color="#00ff88" /></View>}
            <View style={{ flex: 1 }}>
              <Text style={s.sellerName}>{listing.seller?.display_name}</Text>
              <Text style={s.sellerUsername}>@{listing.seller?.username}</Text>
            </View>
            <Feather name="chevron-right" size={18} color="#666" />
          </TouchableOpacity>

          <Text style={s.sectionTitle}>About This Service</Text>
          <Text style={s.description}>{listing.description}</Text>

          {!isOwner && (
            <View style={s.walletBadge}>
              <Text style={s.walletBadgeLabel}>💼 Your Marketplace Wallet</Text>
              <Text style={s.walletBadgeCoins}>{buyerWallet} {t.common.coins} · {coinsToNGN(buyerWallet)}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {!isOwner ? (
        <View style={s.bottomBar}>
          <View>
            <Text style={s.bottomPrice}>{listing.price_coins} {t.common.coins}</Text>
            <Text style={s.bottomNgn}>{coinsToNGN(listing.price_coins)}</Text>
            <Text style={s.bottomDelivery}>Delivered in {listing.delivery_days} days</Text>
          </View>
          <TouchableOpacity style={[s.orderBtn, (ordering || orderInProgress.current) && { opacity: 0.6 }]} onPress={handleOrder} disabled={ordering || orderInProgress.current}>
            {ordering ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.orderBtnText}>Order Now</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.bottomBar}>
          <Text style={{ color: '#888', fontSize: 14 }}>This is your listing</Text>
          <TouchableOpacity style={s.editBtn} onPress={() => router.push('/(tabs)/marketplace/my-listings' as any)}>
            <Text style={s.editBtnText}>Manage Listings</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#000' },
  center:               { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:          { color: '#fff', fontSize: 16, fontWeight: 'bold', flex: 1, textAlign: 'center', marginHorizontal: 12 },
  portfolioImg:         { width: 400, height: 280, backgroundColor: '#111' },
  portfolioPlaceholder: { height: 220, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  body:                 { padding: 20 },
  title:                { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 },
  priceRow:             { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  price:                { color: '#00ff88', fontSize: 22, fontWeight: 'bold' },
  priceNgn:             { color: '#ffd700', fontSize: 14, fontWeight: '600' },
  statsRow:             { flexDirection: 'row', gap: 16, marginBottom: 20, backgroundColor: '#111', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1a1a1a' },
  stat:                 { flex: 1, alignItems: 'center' },
  statNum:              { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  statLabel:            { color: '#666', fontSize: 11, marginTop: 4 },
  sellerCard:           { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: '#1a1a1a' },
  sellerAvatar:         { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: '#00ff88' },
  avatarPh:             { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  sellerName:           { color: '#fff', fontSize: 14, fontWeight: '600' },
  sellerUsername:       { color: '#666', fontSize: 12, marginTop: 2 },
  sectionTitle:         { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  description:          { color: '#aaa', fontSize: 14, lineHeight: 22 },
  walletBadge:          { backgroundColor: '#0a1a0a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#00ff8833', marginTop: 16 },
  walletBadgeLabel:     { color: '#666', fontSize: 11, marginBottom: 4 },
  walletBadgeCoins:     { color: '#00ff88', fontSize: 14, fontWeight: '700' },
  bottomBar:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 32, backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  bottomPrice:          { color: '#00ff88', fontSize: 18, fontWeight: 'bold' },
  bottomNgn:            { color: '#ffd700', fontSize: 12, fontWeight: '600', marginTop: 1 },
  bottomDelivery:       { color: '#666', fontSize: 12, marginTop: 2 },
  orderBtn:             { backgroundColor: '#00ff88', paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12 },
  orderBtnText:         { color: '#000', fontWeight: 'bold', fontSize: 15 },
  editBtn:              { backgroundColor: '#1a1a1a', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#333' },
  editBtnText:          { color: '#fff', fontWeight: '600', fontSize: 14 },
}); 
