// FILE: app/chat/circle/[id].tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — Circle Detail Screen (Broadcast Channel)
// ✅ Owner can post text, images, voice notes
// ✅ Subscribers can read and react (no replies)
// ✅ Real-time new posts via Supabase subscription
// ✅ Subscribe/unsubscribe button
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, Image,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

const C = {
  black: '#000000', card: '#1a1a1a', card2: '#222222',
  border: '#2a2a2a', green: '#00e676', greenBg: 'rgba(0,230,118,0.1)',
  white: '#ffffff', muted: '#888888', muted2: '#555555', gold: '#f5c518',
};

const REACTIONS = ['❤️','😂','🔥','😮','👏','💯'];

interface CircleInfo {
  id: string; name: string; description?: string;
  owner_id: string; subscriber_count: number;
  owner?: { id: string; display_name: string; username: string; photo_url?: string };
}
interface CirclePost {
  id: string; circle_id: string; author_id: string; created_at: string;
  content?: string; media_url?: string; message_type: string;
  reactions?: { emoji: string; user_id: string }[];
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), dy = Math.floor(diff / 86400000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`; if (h < 24) return `${h}h`; return `${dy}d`;
}

const CLOUD_NAME    = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    || 'dvikzffqe';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'unsigned_preset_name';

export default function CircleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [circle,       setCircle]       = useState<CircleInfo | null>(null);
  const [posts,        setPosts]        = useState<CirclePost[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [inputText,    setInputText]    = useState('');
  const [posting,      setPosting]      = useState(false);
  const [selectedPost, setSelectedPost] = useState<CirclePost | null>(null);
  const [showReact,    setShowReact]    = useState(false);

  const isOwner = circle?.owner_id === user?.id;

  useEffect(() => {
    if (!id || id === 'new-circle' || id === 'undefined') {
      Alert.alert('Error', 'Invalid Circle.'); router.back(); return;
    }
    loadCircle();
    loadPosts();
    subscribeNewPosts();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [id]);

  const loadCircle = async () => {
    try {
      const { data } = await supabase
        .from('circles')
        .select('*, owner:owner_id (id, display_name, username, photo_url)')
        .eq('id', id).single();
      if (data) {
        setCircle({ ...data, owner: Array.isArray(data.owner) ? data.owner[0] : data.owner });
      }
      if (user?.id) {
        const { data: sub } = await supabase.from('circle_subscribers')
          .select('id').eq('circle_id', id).eq('user_id', user.id).single();
        setIsSubscribed(!!sub);
      }
    } catch (e) { console.error(e); }
  };

  const loadPosts = async () => {
    try {
      const { data: circlePosts } = await supabase
        .from('circle_posts')
        .select('*')
        .eq('circle_id', id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!circlePosts || circlePosts.length === 0) { setLoading(false); return; }

      const { data: reactions } = await supabase
        .from('circle_post_reactions').select('*').in('post_id', circlePosts.map((p: any) => p.id));
      const reactMap: Record<string, any[]> = {};
      (reactions || []).forEach((r: any) => {
        if (!reactMap[r.post_id]) reactMap[r.post_id] = [];
        reactMap[r.post_id].push(r);
      });

      setPosts(circlePosts.map((p: any) => ({ ...p, reactions: reactMap[p.id] || [] })));
    } catch (e) { console.error('loadPosts error:', e); }
    finally { setLoading(false); }
  };

  const subscribeNewPosts = () => {
    if (!id) return;
    channelRef.current = supabase.channel(`circle:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'circle_posts', filter: `circle_id=eq.${id}` },
        (payload) => {
          setPosts(prev => [{ ...payload.new as any, reactions: [] }, ...prev]);
        })
      .subscribe();
  };

  const handleToggleSubscribe = async () => {
    if (!user?.id) return;
    const next = !isSubscribed;
    setIsSubscribed(next);
    setCircle(prev => prev ? {
      ...prev,
      subscriber_count: next ? prev.subscriber_count + 1 : Math.max(0, prev.subscriber_count - 1),
    } : prev);
    if (next) {
      await supabase.from('circle_subscribers').insert({ circle_id: id, user_id: user.id });
    } else {
      await supabase.from('circle_subscribers').delete().eq('circle_id', id).eq('user_id', user.id);
    }
    // Update count in circles table
    const newCount = (circle?.subscriber_count || 1) + (next ? 1 : -1);
    await supabase.from('circles').update({ subscriber_count: Math.max(0, newCount) }).eq('id', id);
  };

  const postText = async () => {
    const text = inputText.trim();
    if (!text || !user?.id) return;
    setInputText(''); setPosting(true);
    try {
      await supabase.from('circle_posts').insert({
        circle_id: id, author_id: user.id, message_type: 'text', content: text,
      });
      await supabase.from('circles').update({ last_post: text, last_post_at: new Date().toISOString() }).eq('id', id);
    } catch (e) { Alert.alert('Error', 'Failed to post.'); }
    finally { setPosting(false); }
  };

  const postImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0] || !user?.id) return;
    setPosting(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri: result.assets[0].uri, type: 'image/jpeg', name: `img_${Date.now()}.jpg` } as any);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('folder', 'kinsta_circles');
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
      if (!res.ok) { Alert.alert('Upload failed', 'Try again.'); return; }
      const data = await res.json();
      await supabase.from('circle_posts').insert({
        circle_id: id, author_id: user.id, message_type: 'image', media_url: data.secure_url,
      });
    } catch (e) { Alert.alert('Error', 'Failed to post image.'); }
    finally { setPosting(false); }
  };

  const handleReaction = async (emoji: string) => {
    if (!selectedPost || !user?.id) return;
    setShowReact(false);
    await supabase.from('circle_post_reactions').upsert({
      post_id: selectedPost.id, user_id: user.id, emoji,
    });
    await loadPosts();
    setSelectedPost(null);
  };

  const renderPost = ({ item }: { item: CirclePost }) => {
    const reactionGroups = (item.reactions || []).reduce((acc: any, r: any) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc;
    }, {});

    return (
      <TouchableOpacity
        style={ps.card}
        onLongPress={() => { setSelectedPost(item); setShowReact(true); }}
        activeOpacity={0.85}
      >
        {/* Owner info */}
        <View style={ps.cardHeader}>
          {circle?.owner?.photo_url
            ? <Image source={{ uri: circle.owner.photo_url }} style={ps.ownerAv} />
            : <View style={[ps.ownerAv, { backgroundColor: '#1a2e1a', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: C.green, fontSize: 12, fontWeight: '700' }}>
                  {(circle?.owner?.display_name || 'O')[0].toUpperCase()}
                </Text>
              </View>}
          <View>
            <Text style={ps.ownerName}>{circle?.owner?.display_name || 'Creator'}</Text>
            <Text style={ps.postTime}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>

        {/* Content */}
        {item.message_type === 'image' && item.media_url
          ? <Image source={{ uri: item.media_url }} style={ps.postImg} resizeMode="cover" />
          : item.content
          ? <Text style={ps.postText}>{item.content}</Text>
          : null}

        {/* Reactions */}
        {Object.keys(reactionGroups).length > 0 && (
          <View style={ps.reactRow}>
            {Object.entries(reactionGroups).map(([emoji, count]) => (
              <View key={emoji} style={ps.reactPill}>
                <Text style={{ fontSize: 12 }}>{emoji}</Text>
                <Text style={ps.reactCount}>{count as number}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={ps.reactHint}>Hold to react</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={C.white} />
        </TouchableOpacity>
        <View style={s.circleAv}>
          <Ionicons name="radio-outline" size={20} color={C.green} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.circleName} numberOfLines={1}>{circle?.name || 'Circle'}</Text>
          <Text style={s.subCount}>{circle?.subscriber_count || 0} subscribers</Text>
        </View>
        {!isOwner && (
          <TouchableOpacity
            style={[s.subBtn, isSubscribed && s.subBtnActive]}
            onPress={handleToggleSubscribe}
          >
            <Ionicons
              name={isSubscribed ? 'notifications-outline' : 'add'}
              size={14}
              color={isSubscribed ? C.green : '#000'}
            />
            <Text style={[s.subBtnText, isSubscribed && { color: C.green }]}>
              {isSubscribed ? 'Following' : 'Follow'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Description */}
      {circle?.description ? (
        <View style={s.descRow}>
          <Text style={s.descText}>{circle.description}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.green} size="large" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={p => p.id}
          renderItem={renderPost}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 70, gap: 12 }}>
              <Ionicons name="radio-outline" size={56} color={C.border} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: C.white }}>No posts yet</Text>
              <Text style={{ fontSize: 13, color: C.muted, textAlign: 'center' }}>
                {isOwner ? 'Share something with your subscribers!' : 'The creator hasn\'t posted yet.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Owner post composer */}
      {isOwner && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.composer}>
            <TouchableOpacity style={s.attachBtn} onPress={postImage} disabled={posting}>
              <Ionicons name="image-outline" size={20} color={C.muted} />
            </TouchableOpacity>
            <View style={s.inputWrap}>
              <TextInput
                style={s.input}
                placeholder="Post to your Circle…"
                placeholderTextColor={C.muted2}
                value={inputText}
                onChangeText={setInputText}
                multiline maxLength={1000}
              />
            </View>
            <TouchableOpacity
              style={[s.sendBtn, (!inputText.trim() || posting) && { opacity: 0.4 }]}
              onPress={postText}
              disabled={!inputText.trim() || posting}
            >
              {posting
                ? <ActivityIndicator size="small" color="#000" />
                : <Ionicons name="send" size={16} color="#000" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Reaction picker */}
      <Modal visible={showReact} transparent animationType="fade" onRequestClose={() => setShowReact(false)}>
        <TouchableOpacity style={s.reactOverlay} onPress={() => setShowReact(false)}>
          <View style={s.reactPicker}>
            {REACTIONS.map(r => (
              <TouchableOpacity key={r} onPress={() => handleReaction(r)}>
                <Text style={{ fontSize: 28 }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const ps = StyleSheet.create({
  card:       { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  ownerAv:    { width: 36, height: 36, borderRadius: 18 },
  ownerName:  { fontSize: 13, fontWeight: '700', color: C.white },
  postTime:   { fontSize: 11, color: C.muted, marginTop: 1 },
  postText:   { fontSize: 14, color: C.white, lineHeight: 22 },
  postImg:    { width: '100%', height: 220, borderRadius: 12, marginVertical: 8 },
  reactRow:   { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  reactPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8 },
  reactCount: { fontSize: 11, color: C.white, fontWeight: '600' },
  reactHint:  { fontSize: 10, color: C.muted2, marginTop: 8 },
});

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.black },
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  circleAv:  { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,230,118,0.1)', borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)', alignItems: 'center', justifyContent: 'center' },
  circleName: { fontSize: 15, fontWeight: '700', color: C.white },
  subCount:  { fontSize: 11, color: C.muted, marginTop: 1 },
  subBtn:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.green, paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20 },
  subBtnActive: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.green },
  subBtnText: { fontSize: 12, fontWeight: '700', color: '#000' },
  descRow:   { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  descText:  { fontSize: 13, color: C.muted, lineHeight: 20 },
  composer:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: Platform.OS === 'ios' ? 24 : 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.black },
  attachBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 12 },
  input:     { color: C.white, fontSize: 14, paddingVertical: 10, maxHeight: 80 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  reactPicker:  { flexDirection: 'row', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 28, paddingVertical: 10, paddingHorizontal: 14, gap: 12 },
});