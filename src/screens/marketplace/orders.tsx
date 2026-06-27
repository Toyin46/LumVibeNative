// app/(tabs)/marketplace/orders.tsx
// ✅ Translations added via useTranslation()

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 
import { useTranslation } from '../../locales/LanguageContext'; 

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  in_progress:        { label: 'In Progress',   color: '#00b4d8', icon: '⏳' },
  delivered:          { label: 'Delivered',      color: '#00ff88', icon: '📦' },
  revision_requested: { label: 'Revision',       color: '#ffa500', icon: '🔄' },
  completed:          { label: 'Completed',      color: '#00ff88', icon: '✅' },
  disputed:           { label: 'Disputed',       color: '#ff4d4d', icon: '⚠️' },
  cancelled:          { label: 'Cancelled',      color: '#666',    icon: '❌' },
  refunded:           { label: 'Refunded',       color: '#9d4edd', icon: '💸' },
};

function CountdownTimer({ deadline }: { deadline: string }) {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return <Text style={{ color: '#ff4d4d', fontSize: 11 }}>⏰ Overdue</Text>;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  return (
    <Text style={{ color: diff < 86400000 ? '#ffa500' : '#888', fontSize: 11 }}>
      {d > 0 ? `${d}d ` : ''}{h}h left
    </Text>
  );
}

export default function OrdersScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();
  const { t }    = useTranslation();

  const [orders,     setOrders]     = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'buying'|'selling'>('buying');

  useFocusEffect(useCallback(() => { loadOrders(); }, [tab]));

  const loadOrders = async () => {
    setLoading(true);
    try {
      const field      = tab === 'buying' ? 'buyer_id'  : 'seller_id';
      const otherField = tab === 'buying' ? 'seller'    : 'buyer';
      const otherKey   = tab === 'buying' ? 'seller_id' : 'buyer_id';
      const { data } = await supabase
        .from('marketplace_orders')
        .select(`*, ${otherField}:users!marketplace_orders_${otherKey}_fkey(id, username, display_name, avatar_url)`)
        .eq(field, user!.id).order('created_at', { ascending: false });
      setOrders(data || []);
    } catch {}
    finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await loadOrders(); setRefreshing(false); };

  const renderOrder = ({ item }: { item: any }) => {
    const cfg   = STATUS_CONFIG[item.status] || STATUS_CONFIG.in_progress;
    const other = tab === 'buying' ? item.seller : item.buyer;
    return (
      <TouchableOpacity style={s.orderCard} onPress={() => router.push(`/(tabs)/marketplace/order/${item.id}` as any)} activeOpacity={0.85}>
        <View style={s.orderLeft}>
          {other?.avatar_url
            ? <Image source={{ uri: other.avatar_url }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarPh]}><Feather name="user" size={20} color="#00ff88" /></View>}
        </View>
        <View style={s.orderMiddle}>
          <Text style={s.orderTitle} numberOfLines={1}>{item.listing_title}</Text>
          <Text style={s.orderParty}>{tab === 'buying' ? 'Seller' : 'Buyer'}: @{other?.username}</Text>
          <View style={s.orderMeta}>
            <View style={[s.statusBadge, { backgroundColor: cfg.color + '22', borderColor: cfg.color + '55' }]}>
              <Text style={[s.statusText, { color: cfg.color }]}>{cfg.icon} {cfg.label}</Text>
            </View>
            {item.status === 'in_progress' && item.delivery_deadline && <CountdownTimer deadline={item.delivery_deadline} />}
          </View>
        </View>
        <View style={s.orderRight}>
          <Text style={s.orderCoins}>{item.price_coins} 🪙</Text>
          <Text style={s.orderNumber}>{item.order_number}</Text>
          <Feather name="chevron-right" size={16} color="#444" />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Orders</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/marketplace/seller-dashboard' as any)}>
          <Feather name="bar-chart-2" size={22} color="#00ff88" />
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === 'buying' && s.tabActive]} onPress={() => setTab('buying')}>
          <Text style={[s.tabText, tab === 'buying' && s.tabTextActive]}>{t.common.buy}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'selling' && s.tabActive]} onPress={() => setTab('selling')}>
          <Text style={[s.tabText, tab === 'selling' && s.tabTextActive]}>{t.marketplace.myListings}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={i => i.id}
          renderItem={renderOrder}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 48 }}>📦</Text>
              <Text style={s.emptyTitle}>{t.marketplace.noListings}</Text>
              <Text style={s.emptySubtitle}>
                {tab === 'buying' ? 'Browse the marketplace to find a service' : 'Create a listing to start selling'}
              </Text>
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => router.push(tab === 'buying' ? '/(tabs)/marketplace' : '/(tabs)/marketplace/create-listing' as any)}
              >
                <Text style={s.emptyBtnText}>{tab === 'buying' ? t.marketplace.browse : t.marketplace.addListing}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#000' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:  { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  tabs:         { flexDirection: 'row', margin: 16, backgroundColor: '#111', borderRadius: 10, padding: 4, borderWidth: 1, borderColor: '#222' },
  tab:          { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabActive:    { backgroundColor: '#00ff88' },
  tabText:      { color: '#666', fontSize: 14, fontWeight: '600' },
  tabTextActive:{ color: '#000' },
  list:         { paddingHorizontal: 16, paddingBottom: 40 },
  orderCard:    { flexDirection: 'row', backgroundColor: '#111', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#1a1a1a', gap: 12 },
  orderLeft:    { justifyContent: 'center' },
  avatar:       { width: 46, height: 46, borderRadius: 23 },
  avatarPh:     { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  orderMiddle:  { flex: 1, gap: 4 },
  orderTitle:   { color: '#fff', fontSize: 14, fontWeight: '600' },
  orderParty:   { color: '#666', fontSize: 12 },
  orderMeta:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  statusBadge:  { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:   { fontSize: 11, fontWeight: '600' },
  orderRight:   { alignItems: 'flex-end', justifyContent: 'space-between' },
  orderCoins:   { color: '#00ff88', fontSize: 13, fontWeight: 'bold' },
  orderNumber:  { color: '#444', fontSize: 10 },
  center:       { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:        { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:   { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubtitle:{ color: '#666', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  emptyBtn:     { backgroundColor: '#00ff88', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 10 },
  emptyBtnText: { color: '#000', fontWeight: 'bold', fontSize: 14 },
}); 
