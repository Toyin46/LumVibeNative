// src/chat/circle/settings.tsx
//
// Circle management — owner can remove subscribers or delete the circle
// entirely. Didn't exist before; needed now that testing has created many
// throwaway circles with no way to clean them up.

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image,
  StyleSheet, StatusBar, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../../navigation/ChatStackTypes';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../store/authStore';

type NavProp = NativeStackNavigationProp<ChatStackParamList>;

const C = {
  black: '#000', card: '#1a1a1a', border: '#2a2a2a',
  green: '#00e676', greenBg: 'rgba(0,230,118,0.12)',
  white: '#fff', muted: '#888', red: '#e53935',
};

interface Subscriber { user_id: string; username: string; display_name: string; photo_url: string | null; }

export default function CircleSettingsScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute() as any;
  const { id } = route.params as { id: string };
  const { user } = useAuthStore();

  const [circleName, setCircleName] = useState('');
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: circle } = await supabase.from('circles').select('name').eq('id', id).single();
      setCircleName(circle?.name || 'Circle');

      const { data: subRows } = await supabase.from('circle_subscribers').select('user_id').eq('circle_id', id);
      if (!subRows || subRows.length === 0) { setSubscribers([]); return; }

      const userIds = subRows.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('users').select('id, username, display_name, photo_url').in('id', userIds);
      const profileById: Record<string, any> = {};
      (profiles || []).forEach(p => { profileById[p.id] = p; });

      setSubscribers(subRows.map(r => ({
        user_id: r.user_id,
        username: profileById[r.user_id]?.username || '',
        display_name: profileById[r.user_id]?.display_name || profileById[r.user_id]?.username || 'User',
        photo_url: profileById[r.user_id]?.photo_url || null,
      })));
    } catch (e) {
      console.error('CircleSettings load error:', e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRemoveSubscriber = (sub: Subscriber) => {
    Alert.alert('Remove Subscriber', `Remove ${sub.display_name} from this circle?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setBusy(true);
          const { error } = await supabase.from('circle_subscribers')
            .delete().eq('circle_id', id).eq('user_id', sub.user_id);
          setBusy(false);
          if (error) { Alert.alert('Error', error.message); return; }
          setSubscribers(prev => prev.filter(s => s.user_id !== sub.user_id));
          // Keep subscriber_count in sync — same field the circle header reads.
          const { data: current } = await supabase.from('circles').select('subscriber_count').eq('id', id).single();
          if (current) {
            await supabase.from('circles')
              .update({ subscriber_count: Math.max(0, (current.subscriber_count || 1) - 1) })
              .eq('id', id);
          }
        },
      },
    ]);
  };

  const handleDeleteCircle = () => {
    Alert.alert(
      'Delete Circle',
      `Delete "${circleName}" permanently? This removes every post and can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setBusy(true);
            try {
              // Children first — circle_posts/circle_subscribers likely
              // don't cascade automatically, safer to clear explicitly.
              await supabase.from('circle_posts').delete().eq('circle_id', id);
              await supabase.from('circle_subscribers').delete().eq('circle_id', id);
              const { error } = await supabase.from('circles').delete().eq('id', id);
              if (error) throw error;
              navigation.navigate('MessagesHome' as never);
            } catch (e: any) {
              setBusy(false);
              Alert.alert('Error', e?.message || 'Failed to delete circle.');
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.black} />
        <ActivityIndicator color={C.green} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={C.white} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Circle Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.circleHeader}>
        <Text style={s.circleName}>{circleName}</Text>
        <Text style={s.subCount}>{subscribers.length} subscriber{subscribers.length !== 1 ? 's' : ''}</Text>
      </View>

      <Text style={s.sectionLabel}>SUBSCRIBERS</Text>
      <FlatList
        data={subscribers}
        keyExtractor={(s) => s.user_id}
        renderItem={({ item }) => (
          <View style={s.row}>
            {item.photo_url
              ? <Image source={{ uri: item.photo_url }} style={s.avatar} />
              : (
                <View style={[s.avatar, s.avatarPlaceholder]}>
                  <Text style={s.avatarLetter}>{item.display_name[0]?.toUpperCase()}</Text>
                </View>
              )}
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{item.display_name}</Text>
              {!!item.username && <Text style={s.rowUsername}>@{item.username}</Text>}
            </View>
            <TouchableOpacity onPress={() => handleRemoveSubscriber(item)} disabled={busy}>
              <Ionicons name="close-circle-outline" size={22} color={C.red} />
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <Text style={s.emptyText}>No subscribers yet</Text>
        }
      />

      <TouchableOpacity style={s.deleteBtn} onPress={handleDeleteCircle} disabled={busy}>
        {busy
          ? <ActivityIndicator color={C.red} size="small" />
          : (
            <>
              <Ionicons name="trash-outline" size={18} color={C.red} />
              <Text style={s.deleteText}>Delete Circle</Text>
            </>
          )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  headerTitle: { color: C.white, fontSize: 16, fontWeight: '700' },
  circleHeader: { alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.border },
  circleName: { color: C.white, fontSize: 18, fontWeight: '700' },
  subCount: { color: C.muted, fontSize: 13, marginTop: 2 },
  sectionLabel: { color: C.muted, fontSize: 12, fontWeight: '600', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: C.green, fontSize: 16, fontWeight: '700' },
  rowName: { color: C.white, fontSize: 14, fontWeight: '600' },
  rowUsername: { color: C.muted, fontSize: 12, marginTop: 1 },
  emptyText: { color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 30 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderTopWidth: 1, borderTopColor: C.border,
  },
  deleteText: { color: C.red, fontSize: 14, fontWeight: '600' },
});
