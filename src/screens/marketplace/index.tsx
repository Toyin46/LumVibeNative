// app/(tabs)/marketplace/index.tsx
// ✅ All routes fixed to absolute /(tabs)/marketplace/... paths
// ✅ Translations added via useTranslation()

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  TextInput, ActivityIndicator, RefreshControl, ScrollView, Dimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 
import { useTranslation } from '../../locales/LanguageContext';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;
const COIN_TO_NGN = 150;
function toNGN(coins: number) { return '₦' + (coins * COIN_TO_NGN).toLocaleString('en-NG'); }

const CATEGORIES = [
  { id: 'all',       label: 'All',          icon: '⭐' },
  { id: 'creative',  label: 'Creative',     icon: '🎨' },
  { id: 'social',    label: 'Social Media', icon: '📱' },
  { id: 'music',     label: 'Music',        icon: '🎵' },
  { id: 'education', label: 'Education',    icon: '📚' },
  { id: 'beauty',    label: 'Beauty',       icon: '💅' },
  { id: 'tech',      label: 'Tech',         icon: '💻' },
  { id: 'trades',    label: 'Trades',       icon: '🔧' },
  { id: 'other',     label: 'Other',        icon: '📦' },
];

function StarRating({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <Text key={i} style={{ fontSize: size, color: i <= Math.round(rating) ? '#FFD700' : '#333' }}>★</Text>
      ))}
    </View>
  );
}

function ListingCard({ item, onPress }: { item: any; onPress: () => void }) {
  const { t } = useTranslation();
  const catIcon = CATEGORIES.find(c => c.id === item.category)?.icon || '🛒';
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.85}>
      <View style={s.cardThumb}>
        {item.portfolio_urls?.[0]
          ? <Image source={{ uri: item.portfolio_urls[0] }} style={s.cardThumbImg} />
          : <View style={s.cardThumbPlaceholder}><Text style={{ fontSize: 32 }}>{catIcon}</Text></View>}
        <View style={s.cardPriceBadge}>
          <Text style={s.cardPriceText}>{item.price_coins} 🪙</Text>
        </View>
      </View>
      <View style={s.cardSellerRow}>
        {item.seller?.avatar_url
          ? <Image source={{ uri: item.seller.avatar_url }} style={s.cardSellerAvatar} />
          : <View style={[s.cardSellerAvatar, s.avatarPh]}><Feather name="user" size={10} color="#00ff88" /></View>}
        <Text style={s.cardSellerName} numberOfLines={1}>{item.seller?.display_name}</Text>
      </View>
      <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
      <View style={s.cardFooter}>
        {item.rating_count > 0
          ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <StarRating rating={item.rating_average} />
              <Text style={s.cardRatingText}>({item.rating_count})</Text>
            </View>
          : <Text style={s.cardNewBadge}>New</Text>}
        <Text style={s.cardDelivery}>⏱ {item.delivery_days}d</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MarketplaceScreen() {
  const router   = useRouter();
  const { user } = useAuthStore();
  const { t }    = useTranslation();

  const [listings,   setListings]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category,   setCategory]   = useState('all');
  const [search,     setSearch]     = useState('');
  const [activeTab,  setActiveTab]  = useState<'browse'|'orders'|'selling'>('browse');
  const [mktCoins,   setMktCoins]   = useState(0);

  useFocusEffect(useCallback(() => { loadListings(); loadWallet(); }, [category]));

  const loadWallet = async () => {
    if (!user) return;
    const { data } = await supabase.from('users').select('marketplace_coins').eq('id', user.id).single();
    setMktCoins(data?.marketplace_coins || 0);
  };

  const loadListings = async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('marketplace_listings')
        .select('*, seller:users!marketplace_listings_seller_id_fkey(id, username, display_name, avatar_url, followers_count)')
        .eq('status', 'active').order('orders_count', { ascending: false }).limit(50);
      if (category !== 'all') q = q.eq('category', category);
      const { data } = await q;
      setListings(data || []);
    } catch {}
    finally { setLoading(false); }
  };

  const onRefresh = async () => { setRefreshing(true); await loadListings(); await loadWallet(); setRefreshing(false); };

  const filtered = search.trim()
    ? listings.filter(l => l.title.toLowerCase().includes(search.toLowerCase()) || l.description?.toLowerCase().includes(search.toLowerCase()))
    : listings;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>🛍️ {t.marketplace.title}</Text>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.walletBtn} onPress={() => router.push('/(tabs)/marketplace/buy-coins' as any)}>
            <Text style={s.walletCoins}>{mktCoins} 🪙</Text>
            <View style={s.walletAdd}><Feather name="plus" size={12} color="#000" /></View>
          </TouchableOpacity>
          <TouchableOpacity style={s.withdrawBtn} onPress={() => router.push('/(tabs)/marketplace/withdraw' as any)}>
            <Feather name="arrow-up-circle" size={16} color="#ffd700" />
          </TouchableOpacity>
          <TouchableOpacity style={s.createBtn} onPress={() => router.push('/(tabs)/marketplace/create-listing' as any)}>
            <Feather name="plus" size={18} color="#000" />
            <Text style={s.createBtnText}>'Sell'</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={s.tabs}>
        {(['browse', 'orders', 'selling'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, activeTab === tab && s.tabActive]}
            onPress={() => {
              setActiveTab(tab);
              if (tab === 'orders')  router.push('/(tabs)/marketplace/orders' as any);
              if (tab === 'selling') router.push('/(tabs)/marketplace/my-listings' as any);
            }}
          >
            <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
              {tab === 'browse' ? t.marketplace.browse : tab === 'orders' ? 'My Orders' : t.marketplace.myListings}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.searchRow}>
        <Feather name="search" size={16} color="#666" style={{ marginLeft: 12 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search services..."
          placeholderTextColor="#555"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={{ paddingRight: 12 }}>
            <Feather name="x" size={16} color="#666" />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.categoryScroll}>
        {CATEGORIES.map(cat => (
          <TouchableOpacity key={cat.id} style={[s.categoryPill, category === cat.id && s.categoryPillActive]} onPress={() => setCategory(cat.id)}>
            <Text style={s.categoryIcon}>{cat.icon}</Text>
            <Text style={[s.categoryLabel, category === cat.id && s.categoryLabelActive]}>{cat.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#00ff88" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={s.row}
          contentContainerStyle={s.grid}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />}
          renderItem={({ item }) => (
            <ListingCard item={item} onPress={() => router.push(`/(tabs)/marketplace/listing/${item.id}` as any)} />
          )}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 48 }}>🛒</Text>
              <Text style={s.emptyTitle}>{t.marketplace.noListings}</Text>
              <Text style={s.emptySubtitle}>Be the first to offer a service!</Text>
              <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/(tabs)/marketplace/create-listing' as any)}>
                <Text style={s.emptyBtnText}>{t.marketplace.addListing}</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#000' },
  header:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 14 },
  headerTitle:          { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  headerRight:          { flexDirection: 'row', alignItems: 'center', gap: 8 },
  walletBtn:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, gap: 6, borderWidth: 1, borderColor: '#00ff8844' },
  walletCoins:          { color: '#00ff88', fontSize: 12, fontWeight: '700' },
  walletAdd:            { width: 18, height: 18, borderRadius: 9, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center' },
  withdrawBtn:          { width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a1500', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#ffd70044' },
  createBtn:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00ff88', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, gap: 6 },
  createBtnText:        { color: '#000', fontWeight: 'bold', fontSize: 14 },
  tabs:                 { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  tab:                  { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  tabActive:            { backgroundColor: '#00ff8822', borderColor: '#00ff88' },
  tabText:              { color: '#666', fontSize: 12, fontWeight: '600' },
  tabTextActive:        { color: '#00ff88' },
  searchRow:            { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', marginHorizontal: 16, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#222' },
  searchInput:          { flex: 1, color: '#fff', fontSize: 14, paddingVertical: 10, paddingHorizontal: 10 },
  categoryScroll:       { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  categoryPill:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, gap: 5, borderWidth: 1, borderColor: '#222' },
  categoryPillActive:   { backgroundColor: '#00ff8822', borderColor: '#00ff88' },
  categoryIcon:         { fontSize: 14 },
  categoryLabel:        { color: '#888', fontSize: 12, fontWeight: '600' },
  categoryLabelActive:  { color: '#00ff88' },
  grid:                 { paddingHorizontal: 16, paddingBottom: 40 },
  row:                  { justifyContent: 'space-between', marginBottom: 12 },
  card:                 { width: CARD_WIDTH, backgroundColor: '#111', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#222' },
  cardThumb:            { width: '100%', height: CARD_WIDTH * 0.7, position: 'relative' },
  cardThumbImg:         { width: '100%', height: '100%' },
  cardThumbPlaceholder: { width: '100%', height: '100%', backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  cardPriceBadge:       { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  cardPriceText:        { color: '#00ff88', fontSize: 11, fontWeight: 'bold' },
  cardSellerRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, paddingBottom: 4 },
  cardSellerAvatar:     { width: 18, height: 18, borderRadius: 9 },
  avatarPh:             { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  cardSellerName:       { color: '#999', fontSize: 10, flex: 1 },
  cardTitle:            { color: '#fff', fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingBottom: 6, lineHeight: 16 },
  cardFooter:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  cardRatingText:       { color: '#666', fontSize: 10 },
  cardNewBadge:         { color: '#00ff88', fontSize: 10, fontWeight: '600' },
  cardDelivery:         { color: '#666', fontSize: 10 },
  center:               { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty:                { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:           { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  emptySubtitle:        { color: '#666', fontSize: 14 },
  emptyBtn:             { backgroundColor: '#00ff88', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 10 },
  emptyBtnText:         { color: '#000', fontWeight: 'bold', fontSize: 14 },
}); 
