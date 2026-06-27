// app/transaction-history.tsx
// ✅ Full transaction history screen
// ✅ Shows coin purchases, withdrawals, gifts sent/received
// ✅ Works with coin_transactions table + withdrawals table

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from './config/supabase'; 
import { useAuthStore } from './store/authStore'; 

type TxType = 'purchase' | 'withdrawal' | 'gift_sent' | 'gift_received' | 'refund';

interface Transaction {
  id: string;
  type: TxType;
  description: string;
  coins: number;        // positive = gained, negative = spent
  amountNgn: number;   // 0 if not applicable
  status: string;
  date: string;
}

function typeIcon(type: TxType): string {
  switch (type) {
    case 'purchase':      return '🪙';
    case 'withdrawal':    return '💸';
    case 'gift_sent':     return '🎁';
    case 'gift_received': return '💝';
    case 'refund':        return '↩️';
    default:              return '📋';
  }
}

function typeColor(type: TxType, positive: boolean): string {
  if (type === 'withdrawal') return '#ffd700';
  if (type === 'gift_sent')  return '#ff6666';
  if (type === 'refund')     return '#00aaff';
  return positive ? '#00ff88' : '#ff6666';
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':  return '#00ff88';
    case 'pending':    return '#ffd700';
    case 'failed':     return '#ff4444';
    case 'refunded':   return '#00aaff';
    default:           return '#666';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-NG', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function TransactionHistoryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [filter, setFilter]             = useState<'all' | TxType>('all');

  const loadTransactions = useCallback(async () => {
    if (!user?.id) return;

    try {
      const results: Transaction[] = [];

      // 1. Coin purchases
      const { data: purchases } = await supabase
        .from('coin_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      for (const p of purchases || []) {
        results.push({
          id:          p.id,
          type:        'purchase',
          description: `Bought ${p.coins_added} coins`,
          coins:       p.coins_added,
          amountNgn:   p.amount_ngn || 0,
          status:      p.status || 'completed',
          date:        p.created_at,
        });
      }

      // 2. Withdrawals
      const { data: withdrawals } = await supabase
        .from('withdrawals')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      for (const w of withdrawals || []) {
        results.push({
          id:          w.id,
          type:        'withdrawal',
          description: `Withdrawal → ${w.bank_name || 'Bank'}`,
          coins:       -(w.coins_deducted || 0),
          amountNgn:   w.amount_ngn || 0,
          status:      w.status || 'pending',
          date:        w.created_at,
        });
      }

      // 3. Gifts sent (coins_sent table or notifications — use what you have)
      const { data: giftsSent } = await supabase
        .from('gifts')
        .select('*')
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false });

      for (const g of giftsSent || []) {
        results.push({
          id:          g.id,
          type:        'gift_sent',
          description: `Sent ${g.gift_name || 'gift'} to @${g.recipient_username || 'user'}`,
          coins:       -(g.coin_cost || 0),
          amountNgn:   0,
          status:      'completed',
          date:        g.created_at,
        });
      }

      // 4. Gifts received
      const { data: giftsReceived } = await supabase
        .from('gifts')
        .select('*')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false });

      for (const g of giftsReceived || []) {
        results.push({
          id:          g.id + '_recv',
          type:        'gift_received',
          description: `Received ${g.gift_name || 'gift'} from @${g.sender_username || 'user'}`,
          coins:       g.coin_value || 0,
          amountNgn:   0,
          status:      'completed',
          date:        g.created_at,
        });
      }

      // Sort all by date descending
      results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setTransactions(results);

    } catch (err) {
      console.error('[TransactionHistory] load error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const onRefresh = () => { setRefreshing(true); loadTransactions(); };

  const filtered = filter === 'all'
    ? transactions
    : transactions.filter(t => t.type === filter);

  const FILTERS: { key: 'all' | TxType; label: string }[] = [
    { key: 'all',           label: 'All' },
    { key: 'purchase',      label: '🪙 Purchases' },
    { key: 'withdrawal',    label: '💸 Withdrawals' },
    { key: 'gift_sent',     label: '🎁 Gifts Sent' },
    { key: 'gift_received', label: '💝 Received' },
  ];

  const renderItem = ({ item }: { item: Transaction }) => {
    const isPositive = item.coins > 0;
    return (
      <View style={s.card}>
        <View style={s.cardLeft}>
          <Text style={s.icon}>{typeIcon(item.type)}</Text>
          <View style={s.cardMid}>
            <Text style={s.description} numberOfLines={1}>{item.description}</Text>
            <Text style={s.date}>{formatDate(item.date)}</Text>
            <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '22' }]}>
              <Text style={[s.statusText, { color: statusColor(item.status) }]}>
                {item.status}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.cardRight}>
          <Text style={[s.coins, { color: typeColor(item.type, isPositive) }]}>
            {isPositive ? '+' : ''}{item.coins} coins
          </Text>
          {item.amountNgn > 0 && (
            <Text style={s.ngn}>₦{item.amountNgn.toLocaleString()}</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Transaction History</Text>
        <TouchableOpacity onPress={onRefresh}>
          <Feather name="refresh-cw" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={s.filterRow}>
        <FlatList
          horizontal
          data={FILTERS}
          keyExtractor={f => f.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterList}
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[s.filterTab, filter === f.key && s.filterTabActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[s.filterTabText, filter === f.key && s.filterTabTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* List */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#00ff88" />
          <Text style={s.loadingText}>Loading transactions...</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>📋</Text>
          <Text style={s.emptyTitle}>No transactions yet</Text>
          <Text style={s.emptySub}>
            {filter === 'all'
              ? 'Your transaction history will appear here'
              : `No ${filter.replace('_', ' ')} transactions yet`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" />
          }
          ItemSeparatorComponent={() => <View style={s.separator} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#000' },
  header:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:        { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  filterRow:          { borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  filterList:         { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterTab:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#222' },
  filterTabActive:    { backgroundColor: '#00ff8820', borderColor: '#00ff88' },
  filterTabText:      { color: '#555', fontSize: 12, fontWeight: '600' },
  filterTabTextActive:{ color: '#00ff88' },
  list:               { padding: 16 },
  card:               { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#1a1a1a' },
  cardLeft:           { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  icon:               { fontSize: 24 },
  cardMid:            { flex: 1 },
  description:        { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 3 },
  date:               { color: '#444', fontSize: 11, marginBottom: 5 },
  statusBadge:        { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusText:         { fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase' },
  cardRight:          { alignItems: 'flex-end', gap: 4 },
  coins:              { fontSize: 15, fontWeight: 'bold' },
  ngn:                { color: '#555', fontSize: 11 },
  separator:          { height: 8 },
  center:             { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  loadingText:        { color: '#555', fontSize: 14, marginTop: 12 },
  emptyIcon:          { fontSize: 48, marginBottom: 16 },
  emptyTitle:         { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub:           { color: '#444', fontSize: 14, textAlign: 'center', lineHeight: 22 },
}); 
