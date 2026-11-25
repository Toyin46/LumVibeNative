// src/user/FollowListScreen.tsx
//
// Followers / Following of ANY person (not just you):
//   • each picture works like everywhere else: tap = their status (green ring) or the BIG picture,
//     hold = always the big picture, no picture = first letter
//   • tap the name → their profile
//   • Follow / Following button on every row, and a search box
// Route: FollowList  { userId, type: 'followers' | 'following', name? }
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import StatusAvatar from '../components/StatusAvatar';

const GREEN = '#00ff88';
type Row = { id: string; username: string; display_name: string | null; avatar_url: string | null; is_verified?: boolean };

export default function FollowListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuthStore();
  const { userId, type, name } = (route.params || {}) as { userId: string; type: 'followers' | 'following'; name?: string };

  const [rows, setRows]       = useState<Row[]>([]);
  const [mine, setMine]       = useState<Set<string>>(new Set());   // people I follow
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState('');
  const [busy, setBusy]       = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const col = type === 'followers' ? 'follower_id' : 'following_id';
      const key = type === 'followers' ? 'following_id' : 'follower_id';
      const { data: f } = await supabase.from('follows').select(col).eq(key, userId).order('created_at', { ascending: false }).limit(300);
      const ids = (f || []).map((r: any) => r[col]).filter(Boolean);
      if (!ids.length) { setRows([]); setLoading(false); return; }
      const { data: us } = await supabase.from('users').select('id, username, display_name, avatar_url, photo_url, is_verified').in('id', ids);
      const byId = new Map((us || []).map((u: any) => [u.id, u]));
      setRows(ids.map((id: string) => byId.get(id)).filter(Boolean).map((u: any) => ({
        id: u.id, username: u.username, display_name: u.display_name, avatar_url: u.avatar_url || u.photo_url || null, is_verified: u.is_verified,
      })));
      if (user?.id) {
        const { data: m } = await supabase.from('follows').select('following_id').eq('follower_id', user.id).in('following_id', ids);
        setMine(new Set((m || []).map((r: any) => r.following_id)));
      }
    } catch (e) { console.warn('follow list failed:', e); }
    setLoading(false);
  }, [userId, type, user?.id]);
  useEffect(() => { load(); }, [load]);

  const toggleFollow = async (id: string) => {
    if (!user?.id || busy) return;
    setBusy(id);
    try {
      if (mine.has(id)) {
        await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', id);
        setMine(s => { const n = new Set(s); n.delete(id); return n; });
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: id });
        await supabase.from('notifications').insert({ user_id: id, type: 'follow', from_user_id: user.id, is_read: false });
        setMine(s => new Set(s).add(id));
      }
    } catch (e) { console.warn('follow failed:', e); }
    setBusy(null);
  };

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase().replace(/^@/, '');
    return t ? rows.filter(r => (r.username || '').toLowerCase().includes(t) || (r.display_name || '').toLowerCase().includes(t)) : rows;
  }, [rows, q]);

  const openProfile = (id: string) => {
    if (id === user?.id) navigation.navigate('Main', { screen: 'Profile' });
    else navigation.push('UserProfile', { userId: id });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{type === 'followers' ? 'Followers' : 'Following'}</Text>
          {!!name && <Text style={styles.sub} numberOfLines={1}>{name}</Text>}
        </View>
        <Text style={styles.count}>{rows.length}</Text>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={16} color="#777" />
        <TextInput style={styles.searchInput} value={q} onChangeText={setQ} placeholder="Search name or @username" placeholderTextColor="#666" autoCapitalize="none" />
        {!!q && <TouchableOpacity onPress={() => setQ('')}><Ionicons name="close" size={16} color="#777" /></TouchableOpacity>}
      </View>

      {loading ? <ActivityIndicator color={GREEN} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={shown} keyExtractor={r => r.id} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={styles.empty}>{q ? 'No one found' : type === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</Text>}
          renderItem={({ item }) => {
            const isMe = item.id === user?.id;
            const following = mine.has(item.id);
            return (
              <View style={styles.row}>
                <StatusAvatar userId={item.id} avatarUrl={item.avatar_url} name={item.display_name || item.username} letter={item.username} size={48} style={{ margin: -5, marginRight: 7 }} />
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => openProfile(item.id)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={styles.name} numberOfLines={1}>{item.display_name || item.username}</Text>
                    {item.is_verified && <Ionicons name="checkmark-circle" size={15} color={GREEN} />}
                  </View>
                  <Text style={styles.handle} numberOfLines={1}>@{item.username}</Text>
                </TouchableOpacity>
                {!isMe && (
                  <TouchableOpacity style={[styles.btn, following && styles.btnOn]} onPress={() => toggleFollow(item.id)} disabled={busy === item.id}>
                    {busy === item.id ? <ActivityIndicator size="small" color={following ? '#fff' : '#000'} />
                      : <Text style={[styles.btnText, following && { color: '#fff' }]}>{following ? 'Following' : 'Follow'}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  title: { color: '#fff', fontSize: 19, fontWeight: '800' },
  sub: { color: '#8a8f93', fontSize: 12.5, marginTop: 1 },
  count: { color: '#8a8f93', fontSize: 15, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#141414', borderRadius: 12, marginHorizontal: 16, marginVertical: 10, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 9 },
  name: { color: '#fff', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  handle: { color: '#8a8f93', fontSize: 13, marginTop: 1 },
  btn: { backgroundColor: GREEN, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, minWidth: 92, alignItems: 'center' },
  btnOn: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333' },
  btnText: { color: '#000', fontSize: 13.5, fontWeight: '800' },
  empty: { color: '#777', textAlign: 'center', padding: 40, fontSize: 15 },
});
