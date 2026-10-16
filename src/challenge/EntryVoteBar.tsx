// src/challenge/EntryVoteBar.tsx
// Shown at the top of the normal post screen when that post is a challenge entry. The post screen itself is
// untouched, so likes and comments are the real ones and count on the real post. Renders nothing for normal posts.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { GREEN, entryShareUrl, rpc, toggleVote } from './challengeApi';

interface State { slug: string; title: string; entry_id: string; phase: string; username: string; is_mine: boolean; my_vote: boolean }

export default function EntryVoteBar({ postId }: { postId?: string }) {
  const nav = useNavigation<any>();
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    if (postId) rpc<State>('entry_vote_state', { p_post_id: String(postId) }).then(d => { if (alive && d && d.slug) setSt(d); });
    return () => { alive = false; };
  }, [postId]);

  if (!st || !postId) return null;

  const vote = async () => {
    if (busy) return; setBusy(true);
    const r = await toggleVote(st.entry_id, st.my_vote);
    setBusy(false);
    if (r.ok) setSt({ ...st, my_vote: !st.my_vote }); else Alert.alert('LumVibe', r.message);
  };
  const share = () => {
    const url = entryShareUrl(String(postId));
    Share.share({ message: `Watch this entry in LumVibe's challenge. Can you beat it? 😂\n${url}` }).catch(() => {});
  };

  return (
    <View style={s.bar}>
      <TouchableOpacity style={s.back} onPress={() => nav.navigate('Challenge', { slug: st.slug })}>
        <Text style={s.backText}>← Challenge</Text>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={s.kicker}>🏆 CHALLENGE ENTRY</Text>
        <Text style={s.name} numberOfLines={1}>@{st.username || 'creator'}</Text>
      </View>
      {st.phase === 'voting' && !st.is_mine ? (
        <TouchableOpacity disabled={busy} style={[s.vote, st.my_vote && s.voteOn]} onPress={vote}>
          <Text style={[s.voteText, st.my_vote && { color: GREEN }]}>{st.my_vote ? '✓ Voted' : '🗳️ Vote'}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={s.back} onPress={share}><Text style={s.backText}>🔗</Text></TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#06210F', borderBottomWidth: 1, borderBottomColor: 'rgba(0,255,136,0.25)' },
  back: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#1B1B1B', borderWidth: 1, borderColor: '#333' },
  backText: { color: GREEN, fontWeight: '800', fontSize: 12 },
  kicker: { color: '#7FD8A8', fontSize: 10, fontWeight: '700', letterSpacing: 1.2 },
  name: { color: '#fff', fontSize: 13, fontWeight: '700' },
  vote: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12 },
  voteOn: { backgroundColor: '#0B3D24', borderWidth: 1, borderColor: GREEN },
  voteText: { color: '#000', fontWeight: '800', fontSize: 13 },
});
