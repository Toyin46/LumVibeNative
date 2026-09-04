// src/chat/components/ContextStoryBar.tsx
//
// Shared "story rail" for a specific chat/group/circle — the piece that
// was missing after the private/public story posting flow was built.
// Drop this into chat/[id].tsx, group/info.tsx, and circle/[id].tsx to
// show and view whatever stories were posted into that specific context.
//
// Deliberately self-contained (its own Avatar/getAvColor/styles) rather
// than importing from messages.tsx — messages.tsx's own StoryViewer stays
// completely untouched, so nothing here can break your working profile
// story feed. The viewing logic (progress bars, tap zones, mark-as-viewed)
// mirrors that proven component exactly; the two things it adds on top:
//   1. Filters by context_type/context_id instead of showing everyone's
//      profile stories.
//   2. Actually increments stories.view_count — the original only ever
//      inserted into story_views, so view counts never moved at all.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Image, TouchableOpacity, TouchableWithoutFeedback,
  ScrollView, Modal, StatusBar, StyleSheet, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../config/supabase';

const { width: SW, height: SH } = Dimensions.get('window');

const C = {
  black: '#000', white: '#fff', muted: '#888', muted2: '#555',
  green: '#00e676', border: '#2a2a2a', card: '#1a1a1a',
};

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

interface StoryUser { id: string; display_name: string; username: string; photo_url?: string; }
interface ContextStory {
  id: string; user_id: string; media_url?: string; media_type?: 'image' | 'video';
  caption?: string; created_at: string; view_count: number;
  user?: StoryUser; has_viewed?: boolean;
}

function Avatar({ user, size = 52 }: { user: StoryUser; size?: number }) {
  const av = getAvColor(user.id);
  return user.photo_url
    ? <Image source={{ uri: user.photo_url }} style={{ width: size, height: size, borderRadius: size / 2 }} />
    : (
      <View style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: av.bg,
        borderWidth: 1, borderColor: av.text, alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ color: av.text, fontSize: size * 0.36, fontWeight: '700' }}>
          {(user.display_name || 'U')[0]?.toUpperCase()}
        </Text>
      </View>
    );
}

// ── FULL-SCREEN VIEWER — same tap-to-advance pattern as messages.tsx ──
function ContextStoryViewer({
  stories, startIndex, currentUserId, onClose,
}: { stories: ContextStory[]; startIndex: number; currentUserId: string; onClose: () => void }) {
  const [index, setIndex] = useState(startIndex);
  const story = stories[index];

  useEffect(() => {
    if (!story || !currentUserId) return;
    // ✅ FIX: same bug as messages.tsx's viewer — this ran unconditionally,
    // so the poster viewing their own story counted as a view of
    // themselves.
    if (story.user_id === currentUserId) return;
    (async () => {
      try {
        // Check-then-insert instead of a blind insert, specifically so we
        // only increment view_count once per viewer — the original
        // messages.tsx viewer never incremented it at all.
        const { data: existing } = await supabase
          .from('story_views').select('story_id')
          .eq('story_id', story.id).eq('viewer_id', currentUserId).maybeSingle();
        if (!existing) {
          await supabase.from('story_views').insert({ story_id: story.id, viewer_id: currentUserId });
          await supabase.from('stories').update({ view_count: (story.view_count || 0) + 1 }).eq('id', story.id);
        }
      } catch (e) { console.error('markViewed error:', e); }
    })();
  }, [story?.id]);

  if (!story) return null;

  const goPrev = () => { if (index > 0) setIndex(i => i - 1); };
  const goNext = () => { if (index < stories.length - 1) setIndex(i => i + 1); else onClose(); };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={vs.root}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        <View style={vs.progressRow}>
          {stories.map((_, i) => (
            <View key={i} style={[vs.progressBar, { backgroundColor: i <= index ? C.white : 'rgba(255,255,255,0.3)' }]} />
          ))}
        </View>

        {story.media_url ? (
          <Image source={{ uri: story.media_url }} style={vs.media} resizeMode="contain" />
        ) : (
          <View style={[vs.media, { backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }]} />
        )}

        <View style={vs.topBar}>
          {story.user && (
            <View style={vs.userRow}>
              <Avatar user={story.user} size={36} />
              <View style={{ marginLeft: 10 }}>
                <Text style={vs.userName}>{story.user.display_name}</Text>
                <Text style={vs.userHandle}>@{story.user.username}</Text>
              </View>
            </View>
          )}
          <TouchableOpacity onPress={onClose} style={vs.closeBtn}>
            <Ionicons name="close" size={24} color={C.white} />
          </TouchableOpacity>
        </View>

        {story.caption ? (
          <View style={vs.captionWrap}><Text style={vs.captionText}>{story.caption}</Text></View>
        ) : null}

        {/* ✅ FIX: now owner-only, WhatsApp-style — other viewers never see
            this count at all. */}
        {story.user_id === currentUserId && (
          <View style={vs.viewCountWrap}>
            <Ionicons name="eye-outline" size={13} color="rgba(255,255,255,0.7)" />
            <Text style={vs.viewCountText}>{story.view_count || 0}</Text>
          </View>
        )}

        <View style={vs.tapZones}>
          <TouchableWithoutFeedback onPress={goPrev}><View style={{ flex: 1 }} /></TouchableWithoutFeedback>
          <TouchableWithoutFeedback onPress={goNext}><View style={{ flex: 1 }} /></TouchableWithoutFeedback>
        </View>
      </View>
    </Modal>
  );
}

// ── THE BAR ITSELF ──────────────────────────────────────────────
export default function ContextStoryBar({
  contextType, contextId, currentUserId,
}: { contextType: 'dm' | 'group' | 'circle'; contextId: string; currentUserId?: string }) {
  const [stories, setStories] = useState<ContextStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerStart, setViewerStart] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: rows } = await supabase
        .from('stories')
        .select('id, user_id, media_url, media_type, caption, created_at, view_count')
        .eq('context_type', contextType)
        .eq('context_id', contextId)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true });
      if (!rows || rows.length === 0) { setStories([]); return; }

      const userIds = [...new Set(rows.map(r => r.user_id))];
      const { data: profiles } = await supabase
        .from('users').select('id, username, display_name, photo_url').in('id', userIds);
      const profileById: Record<string, StoryUser> = {};
      (profiles || []).forEach(p => { profileById[p.id] = p; });

      let viewedIds = new Set<string>();
      if (currentUserId) {
        const { data: views } = await supabase
          .from('story_views').select('story_id')
          .eq('viewer_id', currentUserId).in('story_id', rows.map(r => r.id));
        viewedIds = new Set((views || []).map(v => v.story_id));
      }

      setStories(rows.map(r => ({
        ...r, user: profileById[r.user_id], has_viewed: viewedIds.has(r.id),
      })));
    } catch (e) {
      console.error('ContextStoryBar load error:', e);
    } finally {
      setLoading(false);
    }
  }, [contextType, contextId, currentUserId]);

  useEffect(() => { load(); }, [load]);

  if (loading || stories.length === 0) return null;

  // Group consecutive stories per user so the bar shows one ring per
  // person (tapping opens the viewer starting at THEIR first story),
  // same grouping idea as a normal stories tray.
  const firstIndexByUser: { user: StoryUser; index: number; allViewed: boolean }[] = [];
  const seen = new Set<string>();
  stories.forEach((s, i) => {
    if (!s.user || seen.has(s.user.id)) return;
    seen.add(s.user.id);
    const usersStories = stories.filter(st => st.user_id === s.user!.id);
    firstIndexByUser.push({ user: s.user, index: i, allViewed: usersStories.every(st => st.has_viewed) });
  });

  return (
    <View style={bs.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={bs.scrollContent}>
        {firstIndexByUser.map(({ user, index, allViewed }) => (
          <TouchableOpacity key={user.id} style={bs.item} onPress={() => setViewerStart(index)}>
            <View style={[bs.ring, { borderColor: allViewed ? C.muted2 : C.green }]}>
              <Avatar user={user} size={54} />
            </View>
            <Text style={bs.name} numberOfLines={1}>{user.display_name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {viewerStart !== null && (
        <ContextStoryViewer
          stories={stories}
          startIndex={viewerStart}
          currentUserId={currentUserId || ''}
          onClose={() => { setViewerStart(null); load(); }}
        />
      )}
    </View>
  );
}

const bs = StyleSheet.create({
  wrap: { borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 10 },
  scrollContent: { paddingHorizontal: 14, gap: 14 },
  item: { alignItems: 'center', width: 64 },
  ring: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  name: { color: C.white, fontSize: 11, marginTop: 4, maxWidth: 64 },
});

const vs = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', position: 'relative' },
  media: { width: SW, height: SH, position: 'absolute', top: 0, left: 0 },
  progressRow: { position: 'absolute', top: 52, left: 12, right: 12, flexDirection: 'row', gap: 4, zIndex: 10 },
  progressBar: { flex: 1, height: 2.5, borderRadius: 2 },
  topBar: { position: 'absolute', top: 62, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  userRow: { flexDirection: 'row', alignItems: 'center' },
  userName: { fontSize: 14, fontWeight: '700', color: C.white, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  userHandle: { fontSize: 11, color: 'rgba(255,255,255,0.7)', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  captionWrap: { position: 'absolute', bottom: 60, left: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 12, zIndex: 10 },
  captionText: { fontSize: 14, color: C.white, lineHeight: 20, textAlign: 'center' },
  viewCountWrap: { position: 'absolute', bottom: 24, left: 16, flexDirection: 'row', alignItems: 'center', gap: 4, zIndex: 10 },
  viewCountText: { color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  tapZones: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', zIndex: 5 },
});
