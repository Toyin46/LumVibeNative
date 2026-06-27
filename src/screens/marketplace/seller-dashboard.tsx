// app/(tabs)/marketplace/seller-dashboard.tsx
// ✅ All routes fixed to use /(tabs)/marketplace/... absolute paths
// ✅ marketplace_coins used (separate from profile coins)
// ✅ Withdraw button routes to /(tabs)/marketplace/withdraw
// ✅ NGN display (1 coin = ₦150)

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

const COIN_TO_NGN = 150;
function toNGN(coins: number) {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}

export default function SellerDashboardScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [loading,         setLoading]         = useState(true);
  const [refreshing,      setRefreshing]       = useState(false);
  const [totalEarned,     setTotalEarned]      = useState(0);
  const [pendingCoins,    setPendingCoins]     = useState(0);
  const [availableCoins,  setAvailableCoins]   = useState(0);
  const [totalOrders,     setTotalOrders]      = useState(0);
  const [completedOrders, setCompletedOrders]  = useState(0);
  const [avgRating,       setAvgRating]        = useState<number | null>(null);
  const [recentOrders,    setRecentOrders]     = useState<any[]>([]);
  const [earningHistory,  setEarningHistory]   = useState<any[]>([]);

  useFocusEffect(useCallback(() => { loadDashboard(); }, []));

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const { data: orders } = await supabase
        .from('marketplace_orders')
        .select('*, buyer:users!marketplace_orders_buyer_id_fkey(id,username,display_name,avatar_url)')
        .eq('seller_id', user!.id)
        .order('created_at', { ascending: false });

      const allOrders     = orders || [];
      const completed     = allOrders.filter(o => o.status === 'completed');
      const totalEarnings = completed.reduce((a: number, o: any) => a + (o.seller_earnings_coins || 0), 0);

      setTotalOrders(allOrders.length);
      setCompletedOrders(completed.length);
      setTotalEarned(totalEarnings);
      setRecentOrders(allOrders.slice(0, 5));

      // ✅ Read marketplace_coins directly from user wallet
      const { data: walletData } = await supabase
        .from('users')
        .select('marketplace_coins, marketplace_coins_pending')
        .eq('id', user!.id)
        .single();

      setAvailableCoins(walletData?.marketplace_coins || 0);
      setPendingCoins(walletData?.marketplace_coins_pending || 0);
      setEarningHistory(completed.slice(0, 10));

      const { data: reviews } = await supabase
        .from('marketplace_reviews')
        .select('rating')
        .eq('seller_id', user!.id);
      if (reviews && reviews.length > 0) {
        const avg = reviews.reduce((a: number, r: any) => a + r.rating, 0) / reviews.length;
        setAvgRating(Math.round(avg * 10) / 10);
      }
    } catch {}
    finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await loadDashboard(); setRefreshing(false); };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Seller Dashboard</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/marketplace/my-listings' as any)}>
          <Feather name="list" size={22} color="#00ff88" />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
      >
        {/* Earnings Overview */}
        <View style={s.earningsCard}>
          <Text style={s.earningsLabel}>Total Earnings</Text>
          <Text style={s.earningsAmount}>{totalEarned} 🪙</Text>
          <Text style={s.earningsNgn}>{toNGN(totalEarned)} · Kinsta keeps 10%</Text>

          <View style={s.balanceRow}>
            <View style={s.balanceBox}>
              <Text style={s.balanceNum}>{availableCoins}</Text>
              <Text style={s.balanceLabel}>Available 🪙</Text>
              <Text style={s.balanceNgn}>{toNGN(availableCoins)}</Text>
            </View>
            <View style={[s.balanceBox, { borderColor: '#ffa50055' }]}>
              <Text style={[s.balanceNum, { color: '#ffa500' }]}>{pendingCoins}</Text>
              <Text style={s.balanceLabel}>Pending 🪙</Text>
              <Text style={s.balanceNgn}>3-day hold</Text>
            </View>
          </View>

          {/* Withdraw button */}
          <TouchableOpacity
            style={[s.withdrawBtn, availableCoins === 0 && { opacity: 0.4 }]}
            onPress={() => router.push('/(tabs)/marketplace/withdraw' as any)}
            disabled={availableCoins === 0}
          >
            <Feather name="arrow-up-circle" size={18} color="#000" />
            <Text style={s.withdrawBtnText}>
              {availableCoins > 0 ? `Withdraw ${availableCoins} 🪙 (${toNGN(availableCoins)})` : 'No funds available'}
            </Text>
          </TouchableOpacity>

          {/* Buy coins shortcut */}
          <TouchableOpacity
            style={s.buyCoinsBtn}
            onPress={() => router.push('/(tabs)/marketplace/buy-coins' as any)}
          >
            <Feather name="plus-circle" size={16} color="#00ff88" />
            <Text style={s.buyCoinsText}>Top Up Marketplace Wallet</Text>
          </TouchableOpacity>
        </View>

        {/* Stats grid */}
        <View style={s.statsGrid}>
          <View style={s.statCard}>
            <Text style={s.statNum}>{totalOrders}</Text>
            <Text style={s.statLabel}>Total Orders</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statNum}>{completedOrders}</Text>
            <Text style={s.statLabel}>Completed</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: completedOrders > 0 ? '#00ff88' : '#666' }]}>
              {totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0}%
            </Text>
            <Text style={s.statLabel}>Completion Rate</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: avgRating ? '#FFD700' : '#666' }]}>
              {avgRating ? `⭐ ${avgRating}` : '—'}
            </Text>
            <Text style={s.statLabel}>Avg Rating</Text>
          </View>
        </View>

        {/* Recent orders */}
        {recentOrders.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Recent Orders</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/marketplace/orders' as any)}>
                <Text style={s.sectionLink}>See all →</Text>
              </TouchableOpacity>
            </View>
            {recentOrders.map(order => (
              <TouchableOpacity
                key={order.id}
                style={s.orderRow}
                onPress={() => router.push(`/(tabs)/marketplace/order/${order.id}` as any)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.orderTitle} numberOfLines={1}>{order.listing_title}</Text>
                  <Text style={s.orderBuyer}>@{order.buyer?.username}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={s.orderCoins}>+{order.seller_earnings_coins} 🪙</Text>
                  <Text style={s.orderNgn}>{toNGN(order.seller_earnings_coins || 0)}</Text>
                  <View style={[s.orderStatus, { backgroundColor: order.status === 'completed' ? '#00ff8822' : '#1a1a1a' }]}>
                    <Text style={[s.orderStatusText, { color: order.status === 'completed' ? '#00ff88' : '#888' }]}>
                      {order.status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Earning history */}
        {earningHistory.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Earning History</Text>
            {earningHistory.map((order: any) => (
              <View key={order.id} style={s.txRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.txDesc} numberOfLines={1}>{order.listing_title}</Text>
                  <Text style={s.txDate}>{new Date(order.completed_at || order.created_at).toLocaleDateString()}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.txAmt}>+{order.seller_earnings_coins} 🪙</Text>
                  <Text style={s.txNgn}>{toNGN(order.seller_earnings_coins || 0)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {totalOrders === 0 && (
          <View style={s.empty}>
            <Text style={{ fontSize: 48 }}>💰</Text>
            <Text style={s.emptyTitle}>No earnings yet</Text>
            <Text style={s.emptySubtitle}>Create listings and complete orders to start earning</Text>
            <TouchableOpacity style={s.createBtn} onPress={() => router.push('/(tabs)/marketplace/create-listing' as any)}>
              <Text style={s.createBtnText}>Create a Listing</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#000' },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  header:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  earningsCard:    { margin: 16, backgroundColor: '#111', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#00ff8833' },
  earningsLabel:   { color: '#888', fontSize: 13, marginBottom: 6 },
  earningsAmount:  { color: '#00ff88', fontSize: 36, fontWeight: 'bold', marginBottom: 2 },
  earningsNgn:     { color: '#ffd700', fontSize: 13, marginBottom: 16 },
  balanceRow:      { flexDirection: 'row', gap: 10, marginBottom: 14 },
  balanceBox:      { flex: 1, backgroundColor: '#0a0a0a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#00ff8833', alignItems: 'center' },
  balanceNum:      { color: '#00ff88', fontSize: 20, fontWeight: 'bold', marginBottom: 2 },
  balanceLabel:    { color: '#666', fontSize: 10, textAlign: 'center' },
  balanceNgn:      { color: '#ffd700', fontSize: 10, marginTop: 2 },
  withdrawBtn:     { backgroundColor: '#00ff88', padding: 14, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  withdrawBtnText: { color: '#000', fontWeight: 'bold', fontSize: 14 },
  buyCoinsBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#00ff8844', backgroundColor: '#0a1a0a' },
  buyCoinsText:    { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  statsGrid:       { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard:        { flex: 1, minWidth: '45%', backgroundColor: '#111', borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1a1a1a' },
  statNum:         { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  statLabel:       { color: '#666', fontSize: 11, textAlign: 'center' },
  section:         { marginHorizontal: 16, marginBottom: 20 },
  sectionHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle:    { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  sectionLink:     { color: '#00ff88', fontSize: 13 },
  orderRow:        { flexDirection: 'row', backgroundColor: '#111', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a1a' },
  orderTitle:      { color: '#fff', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  orderBuyer:      { color: '#666', fontSize: 12 },
  orderCoins:      { color: '#00ff88', fontSize: 13, fontWeight: 'bold' },
  orderNgn:        { color: '#ffd700', fontSize: 10 },
  orderStatus:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  orderStatusText: { fontSize: 10, fontWeight: '600' },
  txRow:           { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  txDesc:          { color: '#fff', fontSize: 13, marginBottom: 2 },
  txDate:          { color: '#555', fontSize: 11 },
  txAmt:           { color: '#00ff88', fontSize: 13, fontWeight: 'bold' },
  txNgn:           { color: '#ffd700', fontSize: 10, marginTop: 2 },
  empty:           { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyTitle:      { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubtitle:   { color: '#666', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  createBtn:       { backgroundColor: '#00ff88', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 10 },
  createBtnText:   { color: '#000', fontWeight: 'bold', fontSize: 14 },
}); 
