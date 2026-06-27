// app/(tabs)/marketplace/my-listings.tsx
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

function StarRating({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {[1,2,3,4,5].map(i => (
        <Text key={i} style={{ fontSize: 11, color: i <= Math.round(rating) ? '#FFD700' : '#333' }}>★</Text>
      ))}
    </View>
  );
}

export default function MyListingsScreen() {
  const router  = useRouter();
  const { user } = useAuthStore();
  const [listings,   setListings]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { loadListings(); }, []));

  const loadListings = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('marketplace_listings')
        .select('*')
        .eq('seller_id', user!.id)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false });
      setListings(data || []);
    } catch {}
    finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await loadListings(); setRefreshing(false); };

  const toggleStatus = async (listing: any) => {
    const newStatus = listing.status === 'active' ? 'paused' : 'active';
    try {
      await supabase.from('marketplace_listings').update({ status: newStatus }).eq('id', listing.id);
      setListings(prev => prev.map(l => l.id === listing.id ? { ...l, status: newStatus } : l));
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const deleteListing = (listing: any) => {
    Alert.alert('Delete Listing', `Are you sure you want to delete "${listing.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await supabase.from('marketplace_listings').update({ status: 'deleted' }).eq('id', listing.id);
          setListings(prev => prev.filter(l => l.id !== listing.id));
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const renderListing = ({ item }: { item: any }) => (
    <View style={s.card}>
      <TouchableOpacity onPress={() => router.push(`/(tabs)/marketplace/listing/${item.id}` as any)}>
        <View style={s.thumb}>
          {item.portfolio_urls?.[0] ? (
            <Image source={{ uri: item.portfolio_urls[0] }} style={s.thumbImg} />
          ) : (
            <View style={s.thumbPlaceholder}><Text style={{ fontSize: 32 }}>🛍️</Text></View>
          )}
          <View style={[s.statusBadge, { backgroundColor: item.status === 'active' ? '#00ff8822' : '#66666622', borderColor: item.status === 'active' ? '#00ff88' : '#666' }]}>
            <Text style={[s.statusText, { color: item.status === 'active' ? '#00ff88' : '#888' }]}>
              {item.status === 'active' ? '● Active' : '⏸ Paused'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={s.info}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <Text style={s.price}>{item.price_coins} 🪙 · {item.delivery_days}d delivery</Text>
        <View style={s.statsRow}>
          <View style={s.stat}>
            <Text style={s.statNum}>{item.orders_count || 0}</Text>
            <Text style={s.statLabel}>Orders</Text>
          </View>
          <View style={s.stat}>
            <Text style={s.statNum}>{item.views_count || 0}</Text>
            <Text style={s.statLabel}>Views</Text>
          </View>
          <View style={s.stat}>
            {item.rating_count > 0 ? (
              <><StarRating rating={item.rating_average} /><Text style={s.statLabel}>{item.rating_count} reviews</Text></>
            ) : (
              <><Text style={s.statNum}>—</Text><Text style={s.statLabel}>No reviews</Text></>
            )}
          </View>
        </View>
        <View style={s.actions}>
          <TouchableOpacity style={s.editBtn} onPress={() => router.push(`/(tabs)/marketplace/listing/${item.id}` as any)}>
            <Feather name="eye" size={14} color="#00ff88" />
            <Text style={s.editBtnText}>View</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.toggleBtn} onPress={() => toggleStatus(item)}>
            <Feather name={item.status === 'active' ? 'pause' : 'play'} size={14} color="#888" />
            <Text style={s.toggleBtnText}>{item.status === 'active' ? 'Pause' : 'Activate'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.deleteBtn} onPress={() => deleteListing(item)}>
            <Feather name="trash-2" size={14} color="#ff4d4d" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>My Listings</Text>
        <TouchableOpacity style={s.createBtn} onPress={() => router.push('/(tabs)/marketplace/create-listing')}>
          <Feather name="plus" size={20} color="#000" />
        </TouchableOpacity>
      </View>

      {listings.length > 0 && (
        <View style={s.quickStats}>
          <View style={s.quickStat}>
            <Text style={s.quickStatNum}>{listings.filter(l => l.status === 'active').length}</Text>
            <Text style={s.quickStatLabel}>Active</Text>
          </View>
          <View style={s.quickStat}>
            <Text style={s.quickStatNum}>{listings.reduce((a, l) => a + (l.orders_count || 0), 0)}</Text>
            <Text style={s.quickStatLabel}>Total Orders</Text>
          </View>
          <View style={s.quickStat}>
            <Text style={s.quickStatNum}>{listings.reduce((a, l) => a + (l.views_count || 0), 0)}</Text>
            <Text style={s.quickStatLabel}>Total Views</Text>
          </View>
          <TouchableOpacity style={s.quickStat} onPress={() => router.push('/(tabs)/marketplace/seller-dashboard')}>
            <Text style={[s.quickStatNum, { color: '#00ff88' }]}>💰</Text>
            <Text style={s.quickStatLabel}>Earnings</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>
      ) : (
        <FlatList
          data={listings}
          keyExtractor={i => i.id}
          renderItem={renderListing}
          contentContainerStyle={s.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 48 }}>🛍️</Text>
              <Text style={s.emptyTitle}>No listings yet</Text>
              <Text style={s.emptySubtitle}>Create your first service and start earning!</Text>
              <TouchableOpacity style={s.createLargeBtn} onPress={() => router.push('/(tabs)/marketplace/create-listing')}>
                <Text style={s.createLargeBtnText}>+ Create a Listing</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:      { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  createBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center' },
  quickStats:       { flexDirection: 'row', marginHorizontal: 16, marginVertical: 12, backgroundColor: '#111', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a' },
  quickStat:        { flex: 1, alignItems: 'center', paddingVertical: 12 },
  quickStatNum:     { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  quickStatLabel:   { color: '#666', fontSize: 10, marginTop: 2 },
  list:             { padding: 16, paddingBottom: 40 },
  card:             { backgroundColor: '#111', borderRadius: 12, marginBottom: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#1a1a1a' },
  thumb:            { height: 130, position: 'relative' },
  thumbImg:         { width: '100%', height: '100%' },
  thumbPlaceholder: { width: '100%', height: '100%', backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  statusBadge:      { position: 'absolute', top: 8, right: 8, borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:       { fontSize: 11, fontWeight: '700' },
  info:             { padding: 14 },
  title:            { color: '#fff', fontSize: 14, fontWeight: '700', marginBottom: 4 },
  price:            { color: '#00ff88', fontSize: 12, fontWeight: '600', marginBottom: 12 },
  statsRow:         { flexDirection: 'row', gap: 16, marginBottom: 12 },
  stat:             { alignItems: 'center' },
  statNum:          { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  statLabel:        { color: '#666', fontSize: 10, marginTop: 2 },
  actions:          { flexDirection: 'row', gap: 8 },
  editBtn:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#00ff8818', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#00ff8855' },
  editBtnText:      { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  toggleBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#1a1a1a', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#333' },
  toggleBtnText:    { color: '#888', fontSize: 13, fontWeight: '600' },
  deleteBtn:        { width: 40, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ff4d4d18', borderRadius: 8, borderWidth: 1, borderColor: '#ff4d4d33' },
  center:           { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:            { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:       { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubtitle:    { color: '#666', fontSize: 13, textAlign: 'center' },
  createLargeBtn:   { backgroundColor: '#00ff88', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, marginTop: 10 },
  createLargeBtnText: { color: '#000', fontWeight: 'bold', fontSize: 15 },
}); 
