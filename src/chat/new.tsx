// src/chat/new.tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — New Chat Screen
// SELF-CONTAINED: getOrCreateConversation inlined with safe queries
// ─────────────────────────────────────────────────────────────
//
// ✅ Removed dead `import { router } from 'expo-router'` — never used
//    anywhere in this file.
// ✅ CRITICAL FIX: `useNavigation()` was at MODULE scope. Moved inside
//    NewChatScreen().
// ✅ Fixed navigate() call that used expo-router's object-style
//    `navigate({ pathname, params })` — converted to
//    `navigate('ChatDM', params)` matching ChatStackParamList.

import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator, Image,
} from 'react-native';
// FIX: same iOS-only SafeAreaView bug found in new-group.tsx and
// new-circle.tsx — plain react-native's version is a no-op on Android.
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatStackParamList } from '../navigation/ChatStackTypes';

type NavProp = NativeStackNavigationProp<ChatStackParamList>;

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

// ✅ NEW: this is the actual gap that left Requests/Friends permanently
// empty — nothing anywhere in the app could create a friend_requests row.
// messages.tsx already has a complete, working accept/decline system
// (fetchFriendRequests, respondToFriendRequest, the Requests/Friends tab
// UI) — it just had nothing feeding it. This checks for an existing
// friendship/pending request first (skips duplicates both directions),
// then inserts a real pending request feeding straight into that
// already-built system.
async function sendFriendRequest(
  currentUserId: string,
  otherUserId: string
): Promise<{ status: 'sent' | 'already_friends' | 'already_pending'; error?: string }> {
  try {
    const { data: existing } = await supabase
      .from('friend_requests')
      .select('id, status, from_user_id')
      .or(
        `and(from_user_id.eq.${currentUserId},to_user_id.eq.${otherUserId}),` +
        `and(from_user_id.eq.${otherUserId},to_user_id.eq.${currentUserId})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') return { status: 'already_friends' };
      if (existing.status === 'pending')  return { status: 'already_pending' };
      // status === 'declined' — allow a fresh request by deleting the old
      // row first, so a past decline doesn't permanently block re-adding.
      await supabase.from('friend_requests').delete().eq('id', existing.id);
    }

    const { error } = await supabase
      .from('friend_requests')
      .insert({ from_user_id: currentUserId, to_user_id: otherUserId, status: 'pending' });
    if (error) return { status: 'sent', error: error.message };
    return { status: 'sent' };
  } catch (e: any) {
    return { status: 'sent', error: e?.message || 'Failed to send friend request.' };
  }
}

async function getOrCreateConversation(
  currentUserId: string,
  otherUserId: string
): Promise<{ id: string } | null> {
  try {
    const { data: myConvs } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', currentUserId);

    if (myConvs && myConvs.length > 0) {
      const myConvIds = myConvs.map((c: any) => c.conversation_id);

      const { data: shared } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', otherUserId)
        .in('conversation_id', myConvIds);

      if (shared && shared.length > 0) {
        return { id: shared[0].conversation_id };
      }
    }

    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ disappearing_enabled: false, disappearing_duration: 86400 })
      .select('id')
      .single();

    if (convError || !newConv) {
      console.error('createConversation error:', convError);
      return null;
    }

    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert([
        { conversation_id: newConv.id, user_id: currentUserId, unread_count: 0 },
        { conversation_id: newConv.id, user_id: otherUserId, unread_count: 0 },
      ]);

    if (partError) {
      console.error('addParticipants error:', partError);
    }

    return { id: newConv.id };
  } catch (error) {
    console.error('getOrCreateConversation error:', error);
    return null;
  }
}

export default function NewChatScreen() {
  const navigation = useNavigation<NavProp>();
  const { user } = useAuthStore();
  const [search, setSearch]     = useState('');
  const [results, setResults]   = useState<SearchUser[]>([]);
  const [loading, setLoading]   = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  // ✅ NEW: per-user request state so each row's "Add Friend" button can
  // independently show sending → Requested / Already friends, without a
  // full-screen loading state blocking the rest of the search results.
  const [requestState, setRequestState] = useState<Record<string, 'sending' | 'sent' | 'friends' | 'pending'>>({});

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
      // ✅ NEW: sending a message to someone you're not friends with yet
      // also raises a friend request, so they see "wants to connect" under
      // Requests even though the message itself goes through right away —
      // this is what lets the recipient "decide to accept or decline"
      // either way, per how this was asked for. Fire-and-forget: never
      // blocks or fails the actual chat-opening flow below.
      sendFriendRequest(user.id, otherUser.id).catch(() => {});

      const conv = await getOrCreateConversation(user.id, otherUser.id);
      if (conv?.id) {
        // FIX: same stack issue as group/circle creation — replace() so
        // back doesn't land on the "New Message" search screen.
        navigation.replace('ChatDM', {
          id:          conv.id,
          otherUserId: otherUser.id,
          otherName:   otherUser.display_name || otherUser.username,
          otherPhoto:  otherUser.photo_url || '',
        });
      } else {
        console.error('Could not create conversation');
      }
    } catch (error) {
      console.error('startChat error:', error);
    } finally {
      setStarting(null);
    }
  }, [user?.id, navigation]);

  // ✅ NEW: explicit "Add Friend" action — separate from messaging, per
  // how this was described (message and friend request as two distinct
  // options). Feeds the exact same friend_requests table and accept/
  // decline UI that messages.tsx already has fully built.
  const addFriend = useCallback(async (otherUser: SearchUser) => {
    if (!user?.id) return;
    setRequestState(prev => ({ ...prev, [otherUser.id]: 'sending' }));
    const result = await sendFriendRequest(user.id, otherUser.id);
    setRequestState(prev => ({
      ...prev,
      [otherUser.id]:
        result.status === 'already_friends' ? 'friends' :
        result.status === 'already_pending' ? 'pending' : 'sent',
    }));
  }, [user?.id]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
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
        renderItem={({ item }) => {
          const reqState = requestState[item.id];
          return (
            <View style={styles.userItem}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
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
              </TouchableOpacity>

              {/* ✅ NEW: separate, independent "Add Friend" action —
                  tapping it never opens a chat, and tapping Message never
                  sends an explicit request (it does so silently in the
                  background — see startChat). Each button has its own
                  loading/disabled state so they don't block each other. */}
              <TouchableOpacity
                style={[
                  styles.addFriendBtn,
                  (reqState === 'sent' || reqState === 'pending') && styles.addFriendBtnSent,
                  reqState === 'friends' && styles.addFriendBtnFriends,
                ]}
                onPress={() => addFriend(item)}
                activeOpacity={0.7}
                disabled={reqState === 'sending' || reqState === 'sent' || reqState === 'pending' || reqState === 'friends'}
              >
                {reqState === 'sending' ? (
                  <ActivityIndicator color={C.green} size="small" />
                ) : (
                  <Text style={styles.addFriendBtnText}>
                    {reqState === 'friends' ? 'Friends'
                      : (reqState === 'sent' || reqState === 'pending') ? 'Requested'
                      : 'Add Friend'}
                  </Text>
                )}
              </TouchableOpacity>

              {starting === item.id ? (
                <ActivityIndicator color={C.green} size="small" style={{ marginLeft: 8 }} />
              ) : (
                <TouchableOpacity style={styles.msgBtn} onPress={() => startChat(item)} disabled={!!starting}>
                  <Text style={styles.msgBtnText}>Message</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
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
  addFriendBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    borderWidth: 1, borderColor: C.green, marginRight: 8,
  },
  addFriendBtnSent:    { borderColor: '#555' },
  addFriendBtnFriends: { borderColor: '#555', backgroundColor: '#1a1a1a' },
  addFriendBtnText:    { color: C.green, fontSize: 12, fontWeight: '700' },
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
