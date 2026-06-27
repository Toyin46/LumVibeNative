// app/chat/new.tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — New Chat Screen
// SELF-CONTAINED: getOrCreateConversation inlined with safe queries
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, ActivityIndicator, Image,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

const C = {
  black: '#000000', bg: '#0a0a0a', card: '#1a1a1a', card2: '#222222',
  border: '#2a2a2a', green: '#00e676', greenBg: 'rgba(0,230,118,0.1)',
  white: '#ffffff', muted: '#888888', muted2: '#555555',
};

interface SearchUser {
  id: string;
  username: string;
  display_name: string;
  photo_url?: string;
}

// ── SAFE getOrCreateConversation ──────────────────────────────
// No FK joins — all queries are simple flat selects
async function getOrCreateConversation(
  currentUserId: string,
  otherUserId: string
): Promise<{ id: string } | null> {
  try {
    // Step 1: get all conversation IDs the current user is in
    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', currentUserId);

    if (myConvs && myConvs.length > 0) {
      const myConvIds = myConvs.map((c: any) => c.conversation_id);

      // Step 2: check if otherUser shares any of those conversations
      const { data: shared } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', myConvIds);

      if (shared && shared.length > 0) {
        // Conversation already exists — return it
        return { id: shared[0].conversation_id };
      }
    }

    // Step 3: no existing conversation — create one
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ disappearing_enabled: false, disappearing_duration: 86400 })
      .select('id')
      .single();

    if (convError || !newConv) {
      console.error('createConversation error:', convError);
      return null;
    }

    // Step 4: add both participants
    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert([
        { conversation_id: newConv.id, user_id: currentUserId, unread_count: 0 },
        { conversation_id: newConv.id, user_id: otherUserId, unread_count: 0 },
      ]);

    if (partError) {
      console.error('addParticipants error:', partError);
      // Still return the conversation — participants might have partial insert
    }

    return { id: newConv.id };
  } catch (error) {
    console.error('getOrCreateConversation error:', error);
    return null;
  }
}

// ── SCREEN ────────────────────────────────────────────────────
export default function NewChatScreen() {
  const { user } = useAuthStore();
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<SearchUser[]>([]);
  const [loading, setLoading]   = useState(false);
  const [starting, setStarting] = useState<string | null>(null);

  const searchUsers = useCallback(async (query: string) => {
    if (query.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, username, display_name, photo_url')
        .neq('id', user?.id)
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .limit(20);
      setResults(data || []);
    } catch (error) {
      console.error('searchUsers error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const startChat = useCallback(async (otherUser: SearchUser) => {
    if (!user?.id) return;
    setStarting(otherUser.id);
    try {
      const conv = await getOrCreateConversation(user.id, otherUser.id);
      if (conv?.id) {
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id:          conv.id,
            otherUserId: otherUser.id,
            otherName:   otherUser.display_name || otherUser.username,
            otherPhoto:  otherUser.photo_url || '',
          },
        });
      } else {
        console.error('Could not create conversation');
      }
    } catch (error) {
      console.error('startChat error:', error);
    } finally {
      setStarting(null);
    }
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>New Message</Text>
      </View>

      <View style={styles.searchWrap}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by username or name…"
          placeholderTextColor={C.muted2}
          value={search}
          onChangeText={(t) => { setSearch(t); searchUsers(t); }}
          autoFocus
        />
        {loading && <ActivityIndicator color={C.green} size="small" />}
      </View>

      <FlatList
        data={results}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.userItem}
            onPress={() => startChat(item)}
            activeOpacity={0.7}
            disabled={!!starting}
          >
            {item.photo_url ? (
              <Image source={{ uri: item.photo_url }} style={styles.userAv} />
            ) : (
              <View style={styles.userAvPlaceholder}>
                <Text style={{ color: C.green, fontSize: 18, fontWeight: '700' }}>
                  {(item.display_name || item.username || 'U')[0].toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.userName}>{item.display_name}</Text>
              <Text style={styles.userHandle}>@{item.username}</Text>
            </View>
            {starting === item.id ? (
              <ActivityIndicator color={C.green} size="small" />
            ) : (
              <View style={styles.msgBtn}>
                <Text style={styles.msgBtnText}>Message</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          search.length >= 2 && !loading ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>No users found for "{search}"</Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 13,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  backArrow: { fontSize: 30, color: C.white, lineHeight: 34 },
  title: { fontSize: 18, fontWeight: '700', color: C.white },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 28, paddingHorizontal: 16, marginHorizontal: 16, marginVertical: 12,
  },
  searchInput: { flex: 1, color: C.white, fontSize: 14, paddingVertical: 10 },
  userItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  userAv: { width: 48, height: 48, borderRadius: 24 },
  userAvPlaceholder: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.card, borderWidth: 1.5, borderColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  userName: { fontSize: 15, fontWeight: '700', color: C.white },
  userHandle: { fontSize: 12, color: C.muted, marginTop: 2 },
  msgBtn: {
    backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green,
    borderRadius: 20, paddingVertical: 6, paddingHorizontal: 14,
  },
  msgBtnText: { fontSize: 12, fontWeight: '700', color: C.green },
  emptyWrap: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 14, color: C.muted },
}); 
