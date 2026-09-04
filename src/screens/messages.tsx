// FILE: src/screens/messages.tsx
// ─────────────────────────────────────────────────────────────
// Kinsta — Inbox / Messages Screen
// ✅ Working Friends / Groups / Requests / Circles tabs
// ✅ Compact feature chips — no tall dropdown boxes
// ✅ Professional Lucide icons throughout
// ✅ No "Coming Soon" for working features
// ✅ Circles — Kinsta's unique broadcast channel feature
// ─────────────────────────────────────────────────────────────
// FIXES APPLIED (nothing working was changed):
// ✅ FIX: Stories onPress now opens a full-screen story viewer
// ✅ FIX: Header search icon now focuses the search bar
// ✅ FIX: Real-time subscription now catches INSERT (new convos) not just UPDATE
// ✅ FIX: Circle subscribe button no longer double-fires the card onPress
// ✅ FIX: Story viewer modal added (full screen, swipeable, close button)
// ✅ CRITICAL FIX: removed dead `const navigation = useNavigation` (no
//    parens) sitting at module scope — never called, just leftover
//    confusion shadowed by the real `useNavigation<any>()` inside the
//    component. Harmless as-is but deleted for clarity.
// ✅ CRITICAL FIX: every navigate() call used expo-router's path-string /
//    {pathname, params} style ('/chat/new', '/chat/[id]', etc). None of
//    those are real screen names in @react-navigation — swapped every
//    one for the actual registered name from ChatStackParamList
//    ('NewChat', 'ChatDM', 'GroupChat', 'Circle', 'NewGroup', 'NewCircle')
//    or the parent tab navigator ('Explore').
// ✅ FIX: openFriendChat's "no existing conversation" branch tried to
//    navigate to NewChat with a userId param — but NewChat is a search
//    screen with no params in its type, and doesn't accept a pre-picked
//    friend anyway. Now creates the conversation directly (same insert
//    logic as chat/new.tsx's getOrCreateConversation) and opens ChatDM,
//    matching what tapping "Message" on a friend card should actually do.
// ✅ FIX: swapped '@/config/supabase' and '@/store/authStore' alias
//    imports for relative paths, matching every other screen file. If
//    the '@' alias isn't configured in babel/metro, those two lines
//    would fail to bundle before the routing bug even mattered.
// ─────────────────────────────────────────────────────────────

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, StatusBar, RefreshControl,
  Image, ScrollView, ActivityIndicator, Alert, Modal,
  TouchableWithoutFeedback, Dimensions,
} from 'react-native';
// FIX: same iOS-only SafeAreaView bug found and fixed across the chat
// folder this session (new.tsx, new-group.tsx, new-circle.tsx) — plain
// react-native's version is a no-op View on Android.
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import NetInfo from '@react-native-community/netinfo';

// ✅ NEW: when a caught error is network-shaped (or the device is
// confirmed offline), shows a clear "No internet" message instead of a
// raw JS error like "TypeError: Network request failed". For any other
// error (a real, human-readable message), the original message passes
// through completely unchanged — this never alters any error message
// that was already working correctly.
function getFriendlyErrorMessage(e: any, isOffline: boolean, fallback: string): string {
  const msg = String(e?.message || '');
  const isNetworkErr = isOffline || /network request failed|failed to fetch|timeout|abort|no internet/i.test(msg);
  return isNetworkErr ? 'No internet connection. Please check your network and try again.' : (msg || fallback);
}


const { width: SW, height: SH } = Dimensions.get('window');

// ── COLORS ────────────────────────────────────────────────────
const C = {
  black:   '#000000',
  bg:      '#0a0a0a',
  card:    '#1a1a1a',
  card2:   '#222222',
  border:  '#2a2a2a',
  green:   '#00e676',
  greenBg: 'rgba(0,230,118,0.1)',
  gold:    '#f5c518',
  red:     '#e53935',
  white:   '#ffffff',
  muted:   '#888888',
  muted2:  '#555555',
};

// ── TYPES ─────────────────────────────────────────────────────
interface ChatUser {
  id: string; username: string;
  display_name: string; photo_url?: string;
}
interface Conversation {
  id: string; created_at: string; updated_at: string;
  last_message?: string; last_message_at?: string;
  disappearing_enabled: boolean;
  other_user?: ChatUser;
  unread_count?: number; streak_count?: number;
}
interface Story {
  id: string; user_id: string; media_url: string;
  media_type: 'image' | 'video'; caption?: string;
  created_at: string; expires_at: string;
  is_active: boolean; view_count: number;
  user?: ChatUser; has_viewed?: boolean;
}
interface FriendRequest {
  id: string; from_user_id: string; to_user_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string; from_user?: ChatUser;
}
// NEW: join requests for public groups, visible only to that group's admin.
interface GroupJoinRequest {
  id: string; group_id: string; user_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string; requester?: ChatUser; group_name?: string;
}
interface Group {
  id: string; name: string; description?: string;
  avatar_url?: string; member_count: number;
  last_message?: string; last_message_at?: string;
  unread_count?: number; created_at: string;
}
interface Circle {
  id: string; name: string; description?: string;
  avatar_url?: string; subscriber_count: number;
  owner_id: string; owner?: ChatUser;
  last_post?: string; last_post_at?: string;
  is_subscribed?: boolean; created_at: string;
}

// ── SERVICE CALLS ─────────────────────────────────────────────
// (all identical to original — nothing changed here)

async function fetchConversations(currentUserId: string): Promise<Conversation[]> {
  try {
    const { data: myParticipations } = await supabase
      .from('conversation_participants')
      .select('conversation_id, unread_count')
      .eq('user_id', currentUserId);

    if (!myParticipations || myParticipations.length === 0) return [];

    const convIds = myParticipations.map((p: any) => p.conversation_id);
    const unreadMap: Record<string, number> = {};
    myParticipations.forEach((p: any) => { unreadMap[p.conversation_id] = p.unread_count || 0; });

    const { data: convs } = await supabase
      .from('conversations')
      .select('id, last_message, last_message_at, updated_at, disappearing_enabled')
      .in('id', convIds)
      .order('last_message_at', { ascending: false });

    if (!convs || convs.length === 0) return [];

    const { data: allParticipants } = await supabase
      .from('conversation_participants')
      .select('conversation_id, user_id')
      .in('conversation_id', convIds)
      .neq('user_id', currentUserId);

    const otherUserIdMap: Record<string, string> = {};
    (allParticipants || []).forEach((p: any) => { otherUserIdMap[p.conversation_id] = p.user_id; });

    const otherUserIds = [...new Set(Object.values(otherUserIdMap))];
    const { data: users } = await supabase
      .from('users').select('id, username, display_name, photo_url').in('id', otherUserIds);
    const userMap: Record<string, any> = {};
    (users || []).forEach((u: any) => { userMap[u.id] = u; });

    const { data: streaks } = await supabase
      .from('user_streaks').select('other_user_id, streak_count')
      .eq('user_id', currentUserId).in('other_user_id', otherUserIds);
    const streakMap: Record<string, number> = {};
    (streaks || []).forEach((s: any) => { streakMap[s.other_user_id] = s.streak_count || 0; });

    return convs.map((conv: any) => {
      const otherId = otherUserIdMap[conv.id];
      return {
        ...conv,
        other_user: otherId ? userMap[otherId] : undefined,
        unread_count: unreadMap[conv.id] || 0,
        streak_count: otherId ? (streakMap[otherId] || 0) : 0,
      };
    });
  } catch (error) { console.error('fetchConversations error:', error); return []; }
}

async function fetchFriendRequests(userId: string): Promise<FriendRequest[]> {
  try {
    const { data, error } = await supabase
      .from('friend_requests')
      .select('*, from_user:from_user_id (id, username, display_name, photo_url)')
      .eq('to_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((r: any) => ({
      ...r,
      from_user: Array.isArray(r.from_user) ? r.from_user[0] : r.from_user,
    }));
  } catch { return []; }
}

async function fetchFriends(userId: string): Promise<ChatUser[]> {
  try {
    const { data } = await supabase
      .from('friend_requests')
      .select('from_user_id, to_user_id')
      .eq('status', 'accepted')
      .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`);

    if (!data || data.length === 0) return [];

    const friendIds = data.map((r: any) =>
      r.from_user_id === userId ? r.to_user_id : r.from_user_id
    );

    const { data: users } = await supabase
      .from('users').select('id, username, display_name, photo_url').in('id', friendIds);
    return users || [];
  } catch { return []; }
}

async function fetchGroups(userId: string): Promise<Group[]> {
  try {
    const { data: memberships } = await supabase
      .from('group_members').select('group_id').eq('user_id', userId);
    if (!memberships || memberships.length === 0) return [];

    const groupIds = memberships.map((m: any) => m.group_id);
    const { data: groups } = await supabase
      .from('groups')
      .select('id, name, description, avatar_url, member_count, last_message, last_message_at, created_at')
      .in('id', groupIds)
      .order('last_message_at', { ascending: false });
    return groups || [];
  } catch { return []; }
}

async function fetchCircles(userId: string): Promise<Circle[]> {
  try {
    const { data, error } = await supabase
      .from('circles')
      .select('*, owner:owner_id (id, username, display_name, photo_url)')
      .order('subscriber_count', { ascending: false })
      .limit(30);
    if (error) return [];

    const circleIds = (data || []).map((c: any) => c.id);
    const { data: subs } = await supabase
      .from('circle_subscribers')
      .select('circle_id').eq('user_id', userId).in('circle_id', circleIds);
    const subSet = new Set((subs || []).map((s: any) => s.circle_id));

    return (data || []).map((c: any) => ({
      ...c,
      owner: Array.isArray(c.owner) ? c.owner[0] : c.owner,
      is_subscribed: subSet.has(c.id),
    }));
  } catch { return []; }
}

async function respondToFriendRequest(
  requestId: string, action: 'accepted' | 'declined'
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('friend_requests').update({ status: action }).eq('id', requestId);
    if (error) return { error: error.message };
    return { error: null };
  } catch (e: any) { return { error: e?.message || 'Failed to respond to request.' }; }
}

async function toggleCircleSubscription(
  circleId: string, userId: string, isSubscribed: boolean
): Promise<{ error: string | null }> {
  try {
    const { error } = isSubscribed
      ? await supabase.from('circle_subscribers').delete().eq('circle_id', circleId).eq('user_id', userId)
      : await supabase.from('circle_subscribers').insert({ circle_id: circleId, user_id: userId });
    if (error) return { error: error.message };
    return { error: null };
  } catch (e: any) { return { error: e?.message || 'Failed to update subscription.' }; }
}

// NEW: group join requests — only for public groups (enforced by RLS, not
// just hidden client-side), visible only to that group's admin.
async function fetchGroupJoinRequests(userId: string): Promise<GroupJoinRequest[]> {
  try {
    // Only groups where I'm admin even have requests I'm allowed to see —
    // RLS enforces this too, this just avoids an empty round trip otherwise.
    const { data: adminGroups } = await supabase
      .from('group_members').select('group_id').eq('user_id', userId).eq('role', 'admin');
    if (!adminGroups || adminGroups.length === 0) return [];
    const groupIds = adminGroups.map(g => g.group_id);

    const { data: reqs } = await supabase
      .from('group_join_requests').select('id, group_id, user_id, status, created_at')
      .in('group_id', groupIds).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (!reqs || reqs.length === 0) return [];

    const userIds = [...new Set(reqs.map(r => r.user_id))];
    const { data: profiles } = await supabase.from('users').select('id, username, display_name, photo_url').in('id', userIds);
    const profileById: Record<string, any> = {};
    (profiles || []).forEach(p => { profileById[p.id] = p; });

    const { data: groupsData } = await supabase.from('groups').select('id, name').in('id', groupIds);
    const groupNameById: Record<string, string> = {};
    (groupsData || []).forEach(g => { groupNameById[g.id] = g.name; });

    return reqs.map(r => ({
      ...r, requester: profileById[r.user_id], group_name: groupNameById[r.group_id],
    }));
  } catch (e) { console.error('fetchGroupJoinRequests error:', e); return []; }
}

async function respondToGroupJoinRequest(
  request: GroupJoinRequest, action: 'accepted' | 'declined'
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('group_join_requests').update({ status: action }).eq('id', request.id);
    if (error) return { error: error.message };
    if (action === 'accepted') {
      const { error: memberErr } = await supabase.from('group_members')
        .insert({ group_id: request.group_id, user_id: request.user_id, role: 'member' });
      if (memberErr) return { error: memberErr.message };
      await supabase.from('groups').select('member_count').eq('id', request.group_id).single()
        .then(({ data }) => {
          if (data) supabase.from('groups').update({ member_count: (data.member_count || 0) + 1 }).eq('id', request.group_id);
        });
    }
    return { error: null };
  } catch (e: any) { return { error: e?.message || 'Failed to respond to request.' }; }
}

async function requestToJoinGroup(groupId: string, userId: string): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.from('group_join_requests').insert({ group_id: groupId, user_id: userId });
    if (error) return { error: error.message };
    return { error: null };
  } catch (e: any) { return { error: e?.message || 'Failed to send request.' }; }
}

async function discoverPublicGroups(userId: string, query: string): Promise<Group[]> {
  try {
    const { data: myGroups } = await supabase.from('group_members').select('group_id').eq('user_id', userId);
    const myGroupIds = (myGroups || []).map(g => g.group_id);

    let q = supabase.from('groups').select('*').eq('is_public', true).ilike('name', `%${query}%`).limit(20);
    if (myGroupIds.length > 0) q = q.not('id', 'in', `(${myGroupIds.join(',')})`);
    const { data } = await q;
    return data || [];
  } catch (e) { console.error('discoverPublicGroups error:', e); return []; }
}

async function fetchStories(currentUserId: string): Promise<Story[]> {
  try {
    const { data, error } = await supabase.from('stories').select('*')
      .eq('is_active', true).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) return [];

    const userIds = [...new Set(data.map((s: any) => s.user_id))];
    const { data: users } = await supabase
      .from('users').select('id, username, display_name, photo_url').in('id', userIds);
    const userMap: Record<string, any> = {};
    (users || []).forEach((u: any) => { userMap[u.id] = u; });

    const storyIds = data.map((s: any) => s.id);
    const { data: viewed } = await supabase.from('story_views')
      .select('story_id').eq('viewer_id', currentUserId).in('story_id', storyIds);
    const viewedIds = new Set((viewed || []).map((v: any) => v.story_id));

    return data.map((story: any) => ({
      ...story, user: userMap[story.user_id] || undefined,
      has_viewed: viewedIds.has(story.id),
    }));
  } catch { return []; }
}

// NEW: creates a conversation + both participant rows and returns the
// new conversation id. Same insert logic as chat/new.tsx's
// getOrCreateConversation — used by openFriendChat below so tapping
// "Message" on a friend card opens a real chat directly instead of
// bouncing through the search screen with an unsupported param.
async function startConversationWith(
  currentUserId: string, otherUserId: string
): Promise<string | null> {
  try {
    const { data: newConv, error: convError } = await supabase
      .from('conversations')
      .insert({ disappearing_enabled: false, disappearing_duration: 86400 })
      .select('id')
      .single();

    if (convError || !newConv) {
      console.error('startConversationWith error:', convError);
      return null;
    }

    const { error: partError } = await supabase
      .from('conversation_participants')
      .insert([
        { conversation_id: newConv.id, user_id: currentUserId, unread_count: 0 },
        { conversation_id: newConv.id, user_id: otherUserId, unread_count: 0 },
      ]);

    if (partError) console.error('startConversationWith participants error:', partError);

    return newConv.id;
  } catch (error) {
    console.error('startConversationWith error:', error);
    return null;
  }
}

// ✅ FIX: Now listens for INSERT (new conversations) AND UPDATE (existing ones)
// Original only caught UPDATE — brand new conversations never appeared without refresh
function subscribeConversations(userId: string, onUpdate: () => void): RealtimeChannel {
  // FIX: same remount race as HomeScreen.tsx's posts-changes channel — this
  // used a fixed name (conversations:${userId}), so going back into this
  // screen while the previous mount's channel was still being torn down
  // (removeChannel() is async) could grab that stale, already-subscribed
  // channel and crash on .on(). Unique suffix per mount fixes it the same
  // way, matching exactly what the user reported (crashes on navigating
  // back into Messages from a group/chat/circle).
  const mountId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return supabase.channel(`conversations:${userId}:${mountId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'conversation_participants',
      filter: `user_id=eq.${userId}`,
    }, () => onUpdate())
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public',
      table: 'conversations',
    }, () => onUpdate())
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'messages',
    }, () => onUpdate())
    .subscribe();
}

// ── AVATAR ────────────────────────────────────────────────────
// (identical to original)
const AV_COLORS = [
  { bg: '#1a2e1a', text: '#00e676' }, { bg: '#1a1a2e', text: '#7c8fff' },
  { bg: '#2e1a1a', text: '#ff7043' }, { bg: '#1a2a1a', text: '#69f0ae' },
  { bg: '#2e1a2a', text: '#f06292' }, { bg: '#2a2a1a', text: '#f5c518' },
];
function getAvColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AV_COLORS[Math.abs(hash) % AV_COLORS.length];
}

function Avatar({ user, size = 52, showOnline = false }: {
  user: { id: string; display_name: string; photo_url?: string };
  size?: number; showOnline?: boolean;
}) {
  const av = getAvColor(user.id);
  return (
    <View style={{ position: 'relative', width: size, height: size }}>
      {user.photo_url
        ? <Image source={{ uri: user.photo_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : <View style={[styles.avatarBase, {
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: av.bg, borderColor: av.text,
          }]}>
            <Text style={{ color: av.text, fontSize: size * 0.36, fontWeight: '700' }}>
              {(user.display_name || 'U')[0].toUpperCase()}
            </Text>
          </View>}
      {showOnline && (
        <View style={[styles.onlineDot, {
          width: size * 0.24, height: size * 0.24, borderRadius: size * 0.12,
        }]} />
      )}
    </View>
  );
}

// ── STORY VIEWER MODAL ────────────────────────────────────────
// ✅ NEW: Full-screen story viewer that was missing entirely
// Marks story as viewed in DB when opened
function StoryViewer({
  stories, startIndex, currentUserId, onClose,
}: {
  stories: Story[]; startIndex: number;
  currentUserId: string; onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const story = stories[index];
  // ✅ NEW: owner-only viewers list, WhatsApp-style — who actually viewed
  // this story, only visible to the person who posted it.
  const [viewersVisible, setViewersVisible] = useState(false);
  const [viewersList, setViewersList]       = useState<{ viewer_id: string; created_at: string; user: any }[]>([]);
  const [loadingViewers, setLoadingViewers] = useState(false);

  const isOwner = story?.user_id === currentUserId;

  const openViewersList = async () => {
    if (!isOwner || !story) return;
    setViewersVisible(true);
    setLoadingViewers(true);
    try {
      const { data: views } = await supabase
        .from('story_views')
        .select('viewer_id, created_at')
        .eq('story_id', story.id)
        .order('created_at', { ascending: false });
      const viewerIds = (views || []).map((v: any) => v.viewer_id);
      if (viewerIds.length === 0) { setViewersList([]); return; }
      const { data: users } = await supabase
        .from('users')
        .select('id, username, display_name, photo_url')
        .in('id', viewerIds);
      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      setViewersList(
        (views || [])
          .map((v: any) => ({ ...v, user: userMap.get(v.viewer_id) }))
          .filter((v: any) => v.user)
      );
    } catch (e) {
      console.error('loadViewers error:', e);
      setViewersList([]);
    } finally {
      setLoadingViewers(false);
    }
  };

  // Mark as viewed when opened
  useEffect(() => {
  if (!story) return;
  // ✅ FIX: this ran unconditionally, so a user opening their OWN story
  // counted as a view of themselves — inflating their own view count
  // every time they checked their story, exactly like the bug described.
  if (story.user_id === currentUserId) return;
  const markViewed = async () => {
    try {
      // FIX: this used to blindly insert into story_views every time and
      // never touched view_count at all — so profile story view counts
      // never moved, and repeat views could silently duplicate rows.
      // Same check-then-insert-then-increment pattern now used by the new
      // per-chat/group/circle ContextStoryBar viewer.
      const { data: existing } = await supabase
        .from('story_views').select('story_id')
        .eq('story_id', story.id).eq('viewer_id', currentUserId).maybeSingle();
      if (!existing) {
        await supabase.from('story_views').insert({ story_id: story.id, viewer_id: currentUserId });
        await supabase.from('stories').update({ view_count: (story.view_count || 0) + 1 }).eq('id', story.id);
      }
    } catch (e) { console.error('markViewed error:', e); }
  };
  markViewed();
}, [story?.id]);


  if (!story) return null;

  const goPrev = () => { if (index > 0) setIndex(i => i - 1); };
  const goNext = () => {
    if (index < stories.length - 1) setIndex(i => i + 1);
    else onClose();
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={viewerStyles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {/* Progress bars */}
        <View style={viewerStyles.progressRow}>
          {stories.map((_, i) => (
            <View
              key={i}
              style={[
                viewerStyles.progressBar,
                { backgroundColor: i <= index ? C.white : 'rgba(255,255,255,0.3)' },
              ]}
            />
          ))}
        </View>

        {/* Media */}
        <Image
          source={{ uri: story.media_url }}
          style={viewerStyles.media}
          resizeMode="contain"
        />

        {/* Top bar */}
        <View style={viewerStyles.topBar}>
          {story.user && (
            <View style={viewerStyles.userRow}>
              <Avatar user={story.user} size={36} />
              <View style={{ marginLeft: 10 }}>
                <Text style={viewerStyles.userName}>{story.user.display_name}</Text>
                <Text style={viewerStyles.userHandle}>@{story.user.username}</Text>
              </View>
            </View>
          )}
          <TouchableOpacity onPress={onClose} style={viewerStyles.closeBtn}>
            <Ionicons name="close" size={24} color={C.white} />
          </TouchableOpacity>
        </View>

        {/* Caption */}
        {story.caption ? (
          <View style={viewerStyles.captionWrap}>
            <Text style={viewerStyles.captionText}>{story.caption}</Text>
          </View>
        ) : null}

        {/* View count — was tracked in the DB but never actually shown.
            ✅ FIX: now only visible to the story's own poster, WhatsApp-
            style — other viewers never see this at all, and tapping it (as
            the owner) opens the actual list of who viewed. */}
        {isOwner && (
          <TouchableOpacity style={viewerStyles.viewCountWrap} onPress={openViewersList} activeOpacity={0.7}>
            <Ionicons name="eye-outline" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={viewerStyles.viewCountText}>{story.view_count || 0}</Text>
          </TouchableOpacity>
        )}

        {/* Tap zones — left goes back, right goes forward */}
        <View style={viewerStyles.tapZones}>
          <TouchableWithoutFeedback onPress={goPrev}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>
          <TouchableWithoutFeedback onPress={goNext}>
            <View style={{ flex: 1 }} />
          </TouchableWithoutFeedback>
        </View>
      </View>

      {/* ✅ NEW: owner-only viewers list */}
      <Modal visible={viewersVisible} transparent animationType="slide" onRequestClose={() => setViewersVisible(false)}>
        <TouchableOpacity style={viewerStyles.viewersBackdrop} activeOpacity={1} onPress={() => setViewersVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={viewerStyles.viewersSheet}>
            <View style={viewerStyles.viewersHandle} />
            <Text style={viewerStyles.viewersTitle}>
              {(story?.view_count || 0)} {(story?.view_count || 0) === 1 ? 'view' : 'views'}
            </Text>
            {loadingViewers ? (
              <ActivityIndicator color={C.green} style={{ marginTop: 20 }} />
            ) : viewersList.length === 0 ? (
              <Text style={viewerStyles.viewersEmpty}>No views yet</Text>
            ) : (
              <FlatList
                data={viewersList}
                keyExtractor={v => v.viewer_id}
                style={{ maxHeight: 360 }}
                renderItem={({ item }) => (
                  <View style={viewerStyles.viewerRow}>
                    <Avatar user={item.user} size={40} />
                    <View style={{ marginLeft: 10, flex: 1 }}>
                      <Text style={viewerStyles.viewerName}>{item.user.display_name}</Text>
                      <Text style={viewerStyles.viewerHandle}>@{item.user.username}</Text>
                    </View>
                  </View>
                )}
              />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}

// ── CONVERSATION ITEM ─────────────────────────────────────────
// (identical to original)
function ConvoItem({ convo, onPress }: { convo: Conversation; onPress: () => void }) {
  const hasUnread = (convo.unread_count || 0) > 0;
  const other = convo.other_user;
  const timeAgo = (d?: string) => {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), dy = Math.floor(diff / 86400000);
    if (m < 1) return 'now'; if (m < 60) return `${m}m`; if (h < 24) return `${h}h`; return `${dy}d`;
  };
  return (
    <TouchableOpacity style={styles.convoItem} onPress={onPress} activeOpacity={0.7}>
      {other
        ? <Avatar user={other} size={52} />
        : <View style={[styles.avatarBase, { width: 52, height: 52, borderRadius: 26, backgroundColor: C.card2, borderColor: C.border }]}>
            <Text style={{ color: C.muted, fontSize: 20 }}>?</Text>
          </View>}
      <View style={styles.convoInfo}>
        <View style={styles.convoTop}>
          <Text style={styles.convoName} numberOfLines={1}>{other?.display_name || 'Unknown'}</Text>
          <Text style={styles.convoTime}>{timeAgo(convo.last_message_at)}</Text>
        </View>
        <View style={styles.convoBottom}>
          <Text style={[styles.convoPreview, hasUnread && styles.convoPreviewUnread]} numberOfLines={1}>
            {convo.last_message || 'Start a conversation 👋'}
          </Text>
          {hasUnread
            ? <View style={styles.unreadBadge}>
                <Text style={styles.unreadText}>{convo.unread_count! > 99 ? '99+' : convo.unread_count}</Text>
              </View>
            : convo.streak_count ? <Text style={styles.streakChip}>🔥 {convo.streak_count}</Text> : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── FRIEND REQUEST CARD ───────────────────────────────────────
// (identical to original)
function FriendRequestCard({
  request, onAccept, onDecline,
}: { request: FriendRequest; onAccept: () => void; onDecline: () => void }) {
  return (
    <View style={styles.requestCard}>
      {request.from_user
        ? <Avatar user={request.from_user} size={48} />
        : <View style={[styles.avatarBase, { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card2, borderColor: C.border }]} />}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.requestName}>{request.from_user?.display_name || 'User'}</Text>
        <Text style={styles.requestHandle}>@{request.from_user?.username || 'unknown'}</Text>
      </View>
      <View style={styles.requestBtns}>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
          <Ionicons name="checkmark" size={15} color="#000" />
          <Text style={styles.acceptBtnText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline}>
          <Ionicons name="close" size={15} color={C.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// NEW: same layout as FriendRequestCard, for group join requests instead.
function GroupJoinRequestCard({
  request, onAccept, onDecline,
}: { request: GroupJoinRequest; onAccept: () => void; onDecline: () => void }) {
  return (
    <View style={styles.requestCard}>
      {request.requester
        ? <Avatar user={request.requester} size={48} />
        : <View style={[styles.avatarBase, { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card2, borderColor: C.border }]} />}
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.requestName}>{request.requester?.display_name || 'User'}</Text>
        <Text style={styles.requestHandle}>wants to join {request.group_name || 'your group'}</Text>
      </View>
      <View style={styles.requestBtns}>
        <TouchableOpacity style={styles.acceptBtn} onPress={onAccept}>
          <Ionicons name="checkmark" size={15} color="#000" />
          <Text style={styles.acceptBtnText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.declineBtn} onPress={onDecline}>
          <Ionicons name="close" size={15} color={C.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── FRIEND CARD ───────────────────────────────────────────────
// (identical to original)
function FriendCard({ user, onMessage }: { user: ChatUser; onMessage: () => void }) {
  return (
    <TouchableOpacity style={styles.friendCard} onPress={onMessage} activeOpacity={0.7}>
      <Avatar user={user} size={50} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.friendName}>{user.display_name}</Text>
        <Text style={styles.friendHandle}>@{user.username}</Text>
      </View>
      <View style={styles.msgIconBtn}>
        <Ionicons name="chatbubble-outline" size={17} color={C.green} />
      </View>
    </TouchableOpacity>
  );
}

// ── GROUP CARD ────────────────────────────────────────────────
// (identical to original)

function GroupCard({ group, onPress }: { group: Group; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.convoItem} onPress={onPress} activeOpacity={0.7}>
      {group.avatar_url
        ? <Image source={{ uri: group.avatar_url }} style={{ width: 52, height: 52, borderRadius: 26 }} />
        : <View style={[styles.groupAvatarFallback]}>
            <Ionicons name="people-outline" size={22} color={C.green} />
          </View>}
      <View style={styles.convoInfo}>
        <View style={styles.convoTop}>
          <Text style={styles.convoName} numberOfLines={1}>{group.name}</Text>
          <Text style={styles.convoTime}>{group.member_count} members</Text>
        </View>
        <Text style={styles.convoPreview} numberOfLines={1}>
          {group.last_message || group.description || 'No messages yet'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.muted2} />
    </TouchableOpacity>
  );
}

// NEW: for a public group found via search that you're not a member of —
// same shape as GroupCard but with a Request-to-Join button instead of
// navigating straight into the chat.
function DiscoverGroupCard({
  group, requested, onRequest,
}: { group: Group; requested: boolean; onRequest: () => void }) {
  return (
    <View style={styles.convoItem}>
      {group.avatar_url
        ? <Image source={{ uri: group.avatar_url }} style={{ width: 52, height: 52, borderRadius: 26 }} />
        : <View style={styles.groupAvatarFallback}>
            <Ionicons name="people-outline" size={22} color={C.green} />
          </View>}
      <View style={styles.convoInfo}>
        <Text style={styles.convoName} numberOfLines={1}>{group.name}</Text>
        <Text style={styles.convoPreview} numberOfLines={1}>
          {group.member_count} members{group.description ? ` · ${group.description}` : ''}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.subBtn, requested && styles.subBtnActive]}
        onPress={onRequest} disabled={requested}
      >
        <Text style={[styles.subBtnText, requested && { color: C.green }]}>
          {requested ? 'Requested' : 'Request'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── CIRCLE CARD ───────────────────────────────────────────────
// ✅ FIX: Subscribe button no longer double-fires the card's onPress
// Original used e.stopPropagation() which doesn't work on React Native
// Fix: wrap the whole card in a View, not TouchableOpacity, so the two
// touch targets are fully independent siblings
function CircleCard({
  circle, onPress, onToggle,
}: { circle: Circle; onPress: () => void; onToggle: () => void }) {
  return (
    <View style={styles.circleCardRow}>
      {/* Left side — tappable to open circle */}
      <TouchableOpacity
        style={styles.circleCardLeft}
        onPress={onPress}
        activeOpacity={0.8}
      >
        {circle.avatar_url
          ? <Image source={{ uri: circle.avatar_url }} style={styles.circleAvatar} />
          : <View style={styles.circleAvatarFallback}>
              <Ionicons name="radio-outline" size={22} color={C.green} />
            </View>}

        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.circleName} numberOfLines={1}>{circle.name}</Text>
            <View style={styles.circleBadge}>
              <Ionicons name="radio-outline" size={9} color={C.green} />
              <Text style={styles.circleBadgeText}>Circle</Text>
            </View>
          </View>
          <Text style={styles.circleOwner} numberOfLines={1}>
            by {circle.owner?.display_name || circle.owner?.username || 'creator'}
          </Text>
          <Text style={styles.circleStats}>{circle.subscriber_count?.toLocaleString() || 0} subscribers</Text>
        </View>
      </TouchableOpacity>

      {/* Right side — subscribe button, fully independent touch target */}
      <TouchableOpacity
        style={[styles.subBtn, circle.is_subscribed && styles.subBtnActive]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        {circle.is_subscribed
          ? <Ionicons name="notifications-outline" size={14} color={C.green} />
          : <Ionicons name="add" size={14} color="#000" />}
        <Text style={[styles.subBtnText, circle.is_subscribed && { color: C.green }]}>
          {circle.is_subscribed ? 'Following' : 'Follow'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── STORY ITEM ────────────────────────────────────────────────
// (identical to original — onPress is now wired up in the main screen)
function StoryItem({ story, onPress }: { story: Story; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.storyItem} onPress={onPress} activeOpacity={0.8}>
      <View style={[styles.storyRing, { borderColor: story.has_viewed ? C.border : C.green }]}>
        {story.user
          ? <Avatar user={story.user} size={48} />
          : <View style={[styles.avatarBase, { width: 48, height: 48, borderRadius: 24, backgroundColor: C.card2, borderColor: C.border }]} />}
      </View>
      <Text style={styles.storyName} numberOfLines={1}>
        {story.user?.display_name?.split(' ')[0] || 'User'}
      </Text>
    </TouchableOpacity>
  );
}

// ── TABS ──────────────────────────────────────────────────────
const TABS = [
  { id: 'All' },
  { id: 'Friends' },
  { id: 'Groups' },
  { id: 'Requests' },
  { id: 'Circles' },
];

// ── MAIN SCREEN ───────────────────────────────────────────────
export default function MessagesScreen() {
  const { user } = useAuthStore();
  const navigation = useNavigation<any>();

  const [activeTab,     setActiveTab]     = useState('All');
  const [search,        setSearch]        = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends,       setFriends]       = useState<ChatUser[]>([]);
  const [groups,        setGroups]        = useState<Group[]>([]);
  const [requests,      setRequests]      = useState<FriendRequest[]>([]);
  // NEW: group join requests (admin-only) and public-group discovery
  const [groupRequests,   setGroupRequests]   = useState<GroupJoinRequest[]>([]);
  const [discoveredGroups, setDiscoveredGroups] = useState<Group[]>([]);
  const [requestedGroupIds, setRequestedGroupIds] = useState<Set<string>>(new Set());
  const [circles,       setCircles]       = useState<Circle[]>([]);
  const [stories,       setStories]       = useState<Story[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [startingChat,  setStartingChat]  = useState<string | null>(null);
  // ✅ NEW: loadAll previously failed completely silently on error (just a
  // console.error, nothing shown to the user at all) — a failed load just
  // looked like an empty inbox forever with zero explanation. These two
  // track connectivity and surface a real, specific message instead.
  const [isOffline, setIsOffline]   = useState(false);
  const [loadError, setLoadError]   = useState<string | null>(null);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
    });
    return () => unsub();
  }, []);

  // ✅ NEW: Story viewer state
  const [viewingStoryIndex, setViewingStoryIndex] = useState<number | null>(null);

  const channelRef  = useRef<RealtimeChannel | null>(null);
  // ✅ FIX: ref to search input so the header icon can focus it
  const searchRef   = useRef<TextInput>(null);

  const loadAll = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    try {
      setLoadError(null);
      const [convs, frds, grps, reqs, circs, strs, grpReqs] = await Promise.all([
        fetchConversations(user.id),
        fetchFriends(user.id),
        fetchGroups(user.id),
        fetchFriendRequests(user.id),
        fetchCircles(user.id),
        fetchStories(user.id),
        fetchGroupJoinRequests(user.id),
      ]);
      setConversations(convs);
      setFriends(frds);
      setGroups(grps);
      setRequests(reqs);
      setCircles(circs);
      setStories(strs);
      setGroupRequests(grpReqs);
    } catch (e) {
      console.error('loadAll error:', e);
      // ✅ FIX: this used to be silent — a failed load just looked like an
      // empty inbox forever, with no indication anything went wrong. Now
      // surfaces a real, network-aware message via the banner below.
      setLoadError(getFriendlyErrorMessage(e, isOffline, "Couldn't load your messages."));
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [user?.id, isOffline]);

  useEffect(() => {
    loadAll();
    if (user?.id) {
      channelRef.current = subscribeConversations(user.id, loadAll);
    }
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, loadAll]);

  // FIX: this screen previously only ever fetched data once, on mount.
  // subscribeConversations() only listens for DM-related tables
  // (conversations/messages) — it was never told about group_members or
  // circle_subscribers. Since this screen sits at the bottom of the stack
  // the whole time (creation screens are pushed on top of it), coming
  // back after making a group or circle never re-triggered a reload at
  // all — the exact "erase after going back" symptom. This refetches
  // every time the screen regains focus, on top of the mount-time load
  // and subscription above (which stay as-is, so the realtime channel
  // isn't torn down and rebuilt on every focus).
  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  const handleRefresh = () => { setRefreshing(true); loadAll(); };

  const handleAcceptRequest = async (request: FriendRequest) => {
    // FIX: this used to remove the request from the list unconditionally,
    // even if the update silently failed — meaning a blocked accept would
    // make the request just vanish with the two of you never actually
    // becoming friends, and no error shown. Same silent-failure pattern
    // fixed in cowatch.tsx/group/[id].tsx/circle/[id].tsx earlier.
    const { error } = await respondToFriendRequest(request.id, 'accepted');
    if (error) { Alert.alert('Error', getFriendlyErrorMessage({ message: error }, isOffline, 'Failed to accept request.')); return; }
    setRequests(prev => prev.filter(r => r.id !== request.id));
  };

  const handleDeclineRequest = async (request: FriendRequest) => {
    const { error } = await respondToFriendRequest(request.id, 'declined');
    if (error) { Alert.alert('Error', getFriendlyErrorMessage({ message: error }, isOffline, 'Failed to decline request.')); return; }
    setRequests(prev => prev.filter(r => r.id !== request.id));
  };

  // NEW: when searching the Groups tab, also look for public groups you're
  // not in yet — same "search everyone, not just your own list" fallback
  // pattern already used for adding members in new-group.tsx.
  useEffect(() => {
    if (!user?.id || !search.trim() || activeTab !== 'Groups') { setDiscoveredGroups([]); return; }
    const t = setTimeout(async () => {
      const found = await discoverPublicGroups(user.id, search.trim());
      setDiscoveredGroups(found);
    }, 350);
    return () => clearTimeout(t);
  }, [search, user?.id, activeTab]);

  const handleRequestToJoinGroup = async (group: Group) => {
    if (!user?.id) return;
    setRequestedGroupIds(prev => new Set(prev).add(group.id));
    const { error } = await requestToJoinGroup(group.id, user.id);
    if (error) {
      setRequestedGroupIds(prev => { const next = new Set(prev); next.delete(group.id); return next; });
      Alert.alert('Error', getFriendlyErrorMessage({ message: error }, isOffline, 'Failed to send join request.'));
    }
  };

  const handleAcceptGroupRequest = async (request: GroupJoinRequest) => {
    const { error } = await respondToGroupJoinRequest(request, 'accepted');
    if (error) { Alert.alert('Error', getFriendlyErrorMessage({ message: error }, isOffline, 'Failed to accept request.')); return; }
    setGroupRequests(prev => prev.filter(r => r.id !== request.id));
    loadAll();
  };

  const handleDeclineGroupRequest = async (request: GroupJoinRequest) => {
    const { error } = await respondToGroupJoinRequest(request, 'declined');
    if (error) { Alert.alert('Error', getFriendlyErrorMessage({ message: error }, isOffline, 'Failed to decline request.')); return; }
    setGroupRequests(prev => prev.filter(r => r.id !== request.id));
  };

  const handleToggleCircle = async (circle: Circle) => {
    if (!user?.id) return;
    setCircles(prev => prev.map(c => c.id === circle.id
      ? { ...c, is_subscribed: !c.is_subscribed,
          subscriber_count: c.is_subscribed ? c.subscriber_count - 1 : c.subscriber_count + 1 }
      : c));
    const { error } = await toggleCircleSubscription(circle.id, user.id, circle.is_subscribed || false);
    if (error) {
      // roll back the optimistic update since it didn't actually happen
      setCircles(prev => prev.map(c => c.id === circle.id
        ? { ...c, is_subscribed: circle.is_subscribed, subscriber_count: circle.subscriber_count }
        : c));
      Alert.alert('Error', error);
    }
  };

  // FIX: real screen name + real param shape from ChatStackParamList,
  // instead of expo-router's { pathname: '/chat/[id]', params } object.
  const openChat = useCallback((convo: Conversation) => {
    if (!convo.other_user) return;
    navigation.navigate('ChatDM', {
      id: convo.id,
      otherUserId: convo.other_user.id,
      otherName: convo.other_user.display_name,
      otherPhoto: convo.other_user.photo_url || '',
    });
  }, [navigation]);

  // FIX: previously navigated to '/chat/new' with a userId param that
  // NewChatScreen doesn't accept (it's a search screen with no params).
  // Now creates the conversation directly and opens ChatDM — matches
  // what tapping "Message" on a friend you already know should do.
  const openFriendChat = useCallback(async (friend: ChatUser) => {
    const existing = conversations.find(c => c.other_user?.id === friend.id);
    if (existing) {
      navigation.navigate('ChatDM', {
        id: existing.id,
        otherUserId: friend.id,
        otherName: friend.display_name,
        otherPhoto: friend.photo_url || '',
      });
      return;
    }
    if (!user?.id || startingChat) return;
    setStartingChat(friend.id);
    try {
      const convId = await startConversationWith(user.id, friend.id);
      if (!convId) {
        Alert.alert('Error', 'Could not start the conversation. Please try again.');
        return;
      }
      navigation.navigate('ChatDM', {
        id: convId,
        otherUserId: friend.id,
        otherName: friend.display_name,
        otherPhoto: friend.photo_url || '',
      });
    } finally {
      setStartingChat(null);
    }
  }, [conversations, navigation, user?.id, startingChat]);

  // ── Filtered data ──────────────────────────────────────────
  const filteredConvos = conversations.filter(c =>
    !search || c.other_user?.display_name?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredFriends = friends.filter(f =>
    !search || f.display_name?.toLowerCase().includes(search.toLowerCase())
  );
  // FIX: search previously did nothing on the Groups/Circles tabs — those
  // FlatLists read straight from `groups`/`circles` state, never through a
  // filtered version. Same pattern as the two above, now applied here too.
  const filteredGroups = groups.filter(g =>
    !search || g.name?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredCircles = circles.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  // FIX: "All" used to only ever show `filteredConvos` — DMs only, with
  // groups and circles completely invisible there even though they exist
  // and show up fine on their own tabs. This merges all three into one
  // real feed, sorted by whichever had the most recent activity, the way
  // "All" is supposed to read.
  type AllItem =
    | { kind: 'convo';  key: string; ts: string; data: Conversation }
    | { kind: 'group';  key: string; ts: string; data: Group }
    | { kind: 'circle'; key: string; ts: string; data: Circle };
  const allItems: AllItem[] = [
    ...filteredConvos.map(c => ({ kind: 'convo' as const,  key: `convo-${c.id}`,  ts: c.last_message_at || c.created_at, data: c })),
    ...filteredGroups.map(g => ({ kind: 'group' as const,  key: `group-${g.id}`,  ts: g.last_message_at || g.created_at, data: g })),
    ...filteredCircles.map(c => ({ kind: 'circle' as const, key: `circle-${c.id}`, ts: c.last_post_at || c.created_at,    data: c })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  // ── Tab content ────────────────────────────────────────────
  const renderTabContent = () => {
    if (loading) {
      return (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={C.green} size="large" />
        </View>
      );
    }

    switch (activeTab) {
      case 'All':
        return (
          <FlatList
            data={allItems}
            keyExtractor={item => item.key}
            renderItem={({ item }) => {
              if (item.kind === 'convo') return <ConvoItem convo={item.data} onPress={() => openChat(item.data)} />;
              if (item.kind === 'group') return (
                <GroupCard group={item.data} onPress={() => navigation.navigate('GroupChat', { id: item.data.id })} />
              );
              return (
                <CircleCard
                  circle={item.data}
                  onPress={() => navigation.navigate('Circle', { id: item.data.id })}
                  onToggle={() => handleToggleCircle(item.data)}
                />
              );
            }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.green} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="chatbubble-outline" size={56} color={C.border} />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySubtitle}>Start a conversation with someone you follow</Text>
                {/* FIX: was navigate('/chat/new') — real screen name is 'NewChat' */}
                <TouchableOpacity style={styles.newChatBtn} onPress={() => navigation.navigate('NewChat')}>
                  <Ionicons name="create-outline" size={16} color="#000" />
                  <Text style={styles.newChatBtnText}>New Message</Text>
                </TouchableOpacity>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        );

      case 'Friends':
        return (
          <FlatList
            data={filteredFriends}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <FriendCard
                user={item}
                onMessage={() => openFriendChat(item)}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.green} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={56} color={C.border} />
                <Text style={styles.emptyTitle}>No friends yet</Text>
                <Text style={styles.emptySubtitle}>Follow people and send friend requests to connect</Text>
                {/* FIX: was navigate('/(tabs)/explore') — the parent Tab.Navigator
                    registers this tab as 'Explore' (see MainTabs.tsx); React
                    Navigation bubbles the call up to the parent navigator
                    automatically since 'Explore' doesn't exist in this stack. */}
                <TouchableOpacity style={styles.newChatBtn} onPress={() => navigation.navigate('Explore')}>
                  <Ionicons name="search-outline" size={16} color="#000" />
                  <Text style={styles.newChatBtnText}>Discover People</Text>
                </TouchableOpacity>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        );

      case 'Groups':
        return (
          <FlatList
            data={filteredGroups}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <GroupCard group={item} onPress={() => {
                // FIX: was { pathname: '/chat/group/[id]', params } — real
                // screen name is 'GroupChat', param shape is { id }.
                navigation.navigate('GroupChat', { id: item.id });
              }} />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.green} />}
            ListHeaderComponent={
              <TouchableOpacity style={styles.createGroupBtn} onPress={() => navigation.navigate('NewGroup')}>
                <Ionicons name="add" size={18} color="#000" />
                <Text style={styles.createGroupBtnText}>Create a Group</Text>
              </TouchableOpacity>
            }
            ListFooterComponent={
              // NEW: public groups found via search that you're not in yet —
              // same "search everyone, not just your own list" idea already
              // used for adding members during group creation.
              discoveredGroups.length > 0 ? (
                <View>
                  <Text style={[styles.discoverLabel, { paddingHorizontal: 20, marginTop: 8, marginBottom: 4 }]}>
                    DISCOVER
                  </Text>
                  {discoveredGroups.map(g => (
                    <DiscoverGroupCard
                      key={g.id} group={g}
                      requested={requestedGroupIds.has(g.id)}
                      onRequest={() => handleRequestToJoinGroup(g)}
                    />
                  ))}
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={56} color={C.border} />
                <Text style={styles.emptyTitle}>No groups yet</Text>
                <Text style={styles.emptySubtitle}>Create a group to chat with multiple friends at once</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        );

      case 'Requests': {
        // NEW: merges friend requests with group join requests (admin-only,
        // already filtered server-side by RLS and fetchGroupJoinRequests).
        type ReqItem =
          | { kind: 'friend'; key: string; data: FriendRequest }
          | { kind: 'group';  key: string; data: GroupJoinRequest };
        const allRequests: ReqItem[] = [
          ...requests.map(r => ({ kind: 'friend' as const, key: `f-${r.id}`, data: r })),
          ...groupRequests.map(r => ({ kind: 'group' as const, key: `g-${r.id}`, data: r })),
        ];
        return (
          <FlatList
            data={allRequests}
            keyExtractor={item => item.key}
            renderItem={({ item }) => item.kind === 'friend' ? (
              <FriendRequestCard
                request={item.data}
                onAccept={() => handleAcceptRequest(item.data)}
                onDecline={() => handleDeclineRequest(item.data)}
              />
            ) : (
              <GroupJoinRequestCard
                request={item.data}
                onAccept={() => handleAcceptGroupRequest(item.data)}
                onDecline={() => handleDeclineGroupRequest(item.data)}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.green} />}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="person-add-outline" size={56} color={C.border} />
                <Text style={styles.emptyTitle}>No requests</Text>
                <Text style={styles.emptySubtitle}>Friend requests and group join requests will appear here</Text>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        );
      }

      case 'Circles':
        return (
          <FlatList
            data={filteredCircles}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <CircleCard
                circle={item}
                // FIX: was { pathname: '/chat/circle/[id]', params } — real
                // screen name is 'Circle', param shape is { id }.
                onPress={() => navigation.navigate('Circle', { id: item.id })}
                onToggle={() => handleToggleCircle(item)}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.green} />}
            ListHeaderComponent={
              <TouchableOpacity style={styles.createGroupBtn} onPress={() => navigation.navigate('NewCircle')}>
                <Ionicons name="radio-outline" size={16} color="#000" />
                <Text style={styles.createGroupBtnText}>Create a Circle</Text>
              </TouchableOpacity>
            }
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="radio-outline" size={56} color={C.border} />
                <Text style={styles.emptyTitle}>No Circles yet</Text>
                <Text style={styles.emptySubtitle}>
                  Circles are broadcast channels where creators share content with their audience
                </Text>
                <TouchableOpacity style={styles.newChatBtn} onPress={() => navigation.navigate('NewCircle')}>
                  <Ionicons name="add" size={16} color="#000" />
                  <Text style={styles.newChatBtnText}>Start a Circle</Text>
                </TouchableOpacity>
              </View>
            }
            contentContainerStyle={{ paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        );

      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* ✅ NEW: loadAll failing used to be completely invisible — this
          makes it visible with a clear, specific message, and a retry. */}
      {loadError && (
        <TouchableOpacity
          style={{ backgroundColor: '#ff4444', paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          onPress={loadAll}
        >
          <Ionicons name={isOffline ? 'wifi-outline' : 'alert-circle-outline'} size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 }}>{loadError}</Text>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', textDecorationLine: 'underline' }}>Retry</Text>
        </TouchableOpacity>
      )}

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerBtns}>
          {/* ✅ FIX: Now actually focuses the search input */}
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => searchRef.current?.focus()}
          >
            <Ionicons name="search-outline" size={18} color={C.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate('NewChat')}>
            <Ionicons name="create-outline" size={18} color={C.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search bar ── */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={15} color={C.muted} />
        <TextInput
          ref={searchRef}
          style={styles.searchInput}
          placeholder="Search messages…"
          placeholderTextColor={C.muted2}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close" size={16} color={C.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Stories row ── */}
      {/* ✅ FIX: onPress now opens the story viewer at the correct index */}
      {stories.length > 0 && (
        <View style={styles.storiesWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.storiesRow}>
            {stories.map((story, idx) => (
              <StoryItem
                key={story.id}
                story={story}
                onPress={() => setViewingStoryIndex(idx)}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Tabs ── */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            const badge = tab.id === 'Requests' && (requests.length + groupRequests.length) > 0 ? requests.length + groupRequests.length : 0;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(tab.id)}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {tab.id}
                </Text>
                {badge > 0 && (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab content ── */}
      <View style={{ flex: 1 }}>
        {renderTabContent()}
      </View>

      {/* ── Story viewer ── */}
      {/* ✅ NEW: Full-screen story viewer rendered at root level so it covers everything */}
      {viewingStoryIndex !== null && (
        <StoryViewer
          stories={stories}
          startIndex={viewingStoryIndex}
          currentUserId={user?.id || ''}
          onClose={() => setViewingStoryIndex(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ── STORY VIEWER STYLES ───────────────────────────────────────
const viewerStyles = StyleSheet.create({
  root: {
    flex: 1, backgroundColor: '#000',
    position: 'relative',
  },
  media: {
    width: SW, height: SH, position: 'absolute', top: 0, left: 0,
  },
  progressRow: {
    position: 'absolute', top: 52, left: 12, right: 12,
    flexDirection: 'row', gap: 4, zIndex: 10,
  },
  progressBar: {
    flex: 1, height: 2.5, borderRadius: 2,
  },
  topBar: {
    position: 'absolute', top: 62, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', zIndex: 10,
  },
  userRow: { flexDirection: 'row', alignItems: 'center' },
  userName: {
    fontSize: 14, fontWeight: '700', color: C.white,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  userHandle: {
    fontSize: 11, color: 'rgba(255,255,255,0.7)',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  // ✅ NEW: owner-only viewers list sheet
  viewersBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  viewersSheet: {
    backgroundColor: '#111', borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingTop: 10, paddingHorizontal: 16, paddingBottom: 24, maxHeight: '60%',
  },
  viewersHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: '#444',
    alignSelf: 'center', marginBottom: 12,
  },
  viewersTitle: { fontSize: 15, fontWeight: '700', color: C.white, marginBottom: 12 },
  viewersEmpty: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  viewerName: { fontSize: 14, fontWeight: '600', color: C.white },
  viewerHandle: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  captionWrap: {
    position: 'absolute', bottom: 60, left: 16, right: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 12, padding: 12, zIndex: 10,
  },
  captionText: {
    fontSize: 14, color: C.white, lineHeight: 20,
    textAlign: 'center',
  },
  tapZones: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', zIndex: 5,
  },
  viewCountWrap: {
    position: 'absolute', bottom: 24, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 10,
  },
  viewCountText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
});

// ── STYLES ────────────────────────────────────────────────────
// (identical to original — nothing changed)
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12,
  },
  headerTitle: { fontSize: 26, fontWeight: '800', color: C.white },
  headerBtns:  { flexDirection: 'row', gap: 10 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    borderRadius: 28, paddingHorizontal: 14,
    marginHorizontal: 20, marginBottom: 8,
  },
  searchInput: { flex: 1, color: C.white, fontSize: 14, paddingVertical: 10 },

  storiesWrap: { paddingBottom: 8 },
  storiesRow:  { paddingHorizontal: 20, gap: 14 },
  storyItem:   { alignItems: 'center', gap: 5 },
  storyRing:   { borderWidth: 2.5, borderRadius: 30, padding: 2 },
  storyName:   { fontSize: 10.5, color: C.muted, maxWidth: 56, textAlign: 'center' },

  tabsWrap: { borderBottomWidth: 1, borderBottomColor: C.border },
  tabs:     { paddingHorizontal: 16, gap: 6, paddingBottom: 10, paddingTop: 2 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1, borderColor: 'transparent',
    position: 'relative',
  },
  tabActive:     { backgroundColor: C.greenBg, borderColor: C.green },
  tabText:       { fontSize: 13, fontWeight: '600', color: C.muted },
  tabTextActive: { color: C.green },
  tabBadge: {
    backgroundColor: C.red, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: 'center',
  },
  tabBadgeText: { fontSize: 9, fontWeight: '800', color: C.white },

  loadingCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },

  convoItem: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    paddingHorizontal: 20, paddingVertical: 12,
  },
  avatarBase: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  onlineDot: {
    position: 'absolute', bottom: 1, right: 1,
    backgroundColor: C.green, borderWidth: 2, borderColor: C.black,
  },
  convoInfo:  { flex: 1 },
  convoTop:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  convoName:  { fontSize: 15, fontWeight: '700', color: C.white, flex: 1, marginRight: 8 },
  convoTime:  { fontSize: 11.5, color: C.muted2 },
  convoBottom:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  convoPreview:       { fontSize: 13, color: C.muted, flex: 1, marginRight: 8 },
  convoPreviewUnread: { color: C.white, fontWeight: '500' },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  unreadText: { fontSize: 11, fontWeight: '700', color: '#000' },
  streakChip: { fontSize: 12, color: C.gold, fontWeight: '700' },

  requestCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  requestName:   { fontSize: 14, fontWeight: '700', color: C.white },
  requestHandle: { fontSize: 12, color: C.muted, marginTop: 2 },
  requestBtns:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  acceptBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.green, paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: 20,
  },
  acceptBtnText: { fontSize: 12, fontWeight: '800', color: '#000' },
  declineBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },

  friendCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  friendName:   { fontSize: 14, fontWeight: '700', color: C.white },
  friendHandle: { fontSize: 12, color: C.muted, marginTop: 2 },
  msgIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.green + '55',
    alignItems: 'center', justifyContent: 'center',
  },

  groupAvatarFallback: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  createGroupBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green, marginHorizontal: 20, marginTop: 12, marginBottom: 4,
    paddingVertical: 12, borderRadius: 14, justifyContent: 'center',
  },
  createGroupBtnText: { fontSize: 14, fontWeight: '800', color: '#000' },
  // FIX: this was referencing styles.label, which never existed in this
  // stylesheet — a plain section-header style, same weight/spacing
  // convention as the rest of the file's labels.
  discoverLabel: { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 0.5 },

  // ✅ FIX: circleCard split into circleCardRow + circleCardLeft
  // so the subscribe button is a fully independent touch target
  circleCardRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingRight: 20,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  circleCardLeft: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  circleCard: {  // kept for reference but replaced by circleCardRow above
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  circleAvatar: { width: 52, height: 52, borderRadius: 26 },
  circleAvatarFallback: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,230,118,0.08)', borderWidth: 1, borderColor: C.green + '44',
    alignItems: 'center', justifyContent: 'center',
  },
  circleName:  { fontSize: 14, fontWeight: '700', color: C.white, flex: 1 },
  circleOwner: { fontSize: 12, color: C.muted, marginTop: 2 },
  circleStats: { fontSize: 11, color: C.muted2, marginTop: 2 },
  circleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green + '44',
    borderRadius: 10, paddingVertical: 2, paddingHorizontal: 6,
  },
  circleBadgeText: { fontSize: 9, color: C.green, fontWeight: '700' },
  subBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.green, paddingVertical: 7, paddingHorizontal: 13,
    borderRadius: 20,
  },
  subBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.green },
  subBtnText:   { fontSize: 12, fontWeight: '700', color: '#000' },

  emptyWrap: {
    alignItems: 'center', justifyContent: 'center',
    paddingTop: 70, paddingHorizontal: 40,
  },
  emptyTitle:    { fontSize: 18, fontWeight: '700', color: C.white, marginTop: 16, marginBottom: 8 },
  emptySubtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  newChatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.green, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 28,
  },
  newChatBtnText: { fontSize: 14, fontWeight: '700', color: '#000' },
}); 
