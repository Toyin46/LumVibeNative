// src/challenge/ChallengeBanner.tsx
// Two small pieces for the Videos feed:
//   <ChallengeBanner top={...} />  — green banner under the Vibe/Following tabs (only while a challenge is running)
//   <EntryChip postId={...} top={...} left={...} /> — "🏆 Challenge" tag + Vote button on entry videos
// Both render nothing when no challenge is running, so the feed is untouched the rest of the time.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { GREEN, durLabel, phaseOf, toggleVote, watLabel } from './challengeApi';
import { patchFeedEntry, refreshChallengeFeed, useChallengeFeed } from './feedStore';

export default function ChallengeBanner({ top }: { top: number }) {
  const nav = useNavigation<any>();
  const feed = useChallengeFeed();
  const [, setTick] = useState(0);
  const [hidden, setHidden] = useState(false);
  const c = feed.challenge;
  const phase = c ? phaseOf(c, Date.now() + feed.skew) : 'closed';
  const dismissKey = c ? `lv_chb_x_${c.slug}_${phase}` : '';

  useFocusEffect(useCallback(() => { refreshChallengeFeed(true); }, []));
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!dismissKey) return;
    AsyncStorage.getItem(dismissKey).then(v => setHidden(!!v && Date.now() - Number(v) < 12 * 3600 * 1000)).catch(() => {});
  }, [dismissKey]);

  if (!c || hidden || phase === 'closed') return null;
  const now = Date.now() + feed.skew;
  const line = phase === 'upcoming' ? `Starts ${watLabel(c.entries_open_at)}`
    : phase === 'entries' ? `Enter now · voting opens in ${durLabel(Date.parse(c.voting_opens_at) - now)}`
    : `Voting open · closes in ${durLabel(Date.parse(c.voting_closes_at) - now)}`;
  const cta = phase === 'upcoming' ? 'Details' : phase === 'voting' ? 'Vote' : feed.iEntered ? 'View' : 'Enter';

  return (
    <View style={[s.banner, { top }]} pointerEvents="box-none">
      <TouchableOpacity style={s.main} activeOpacity={0.85} onPress={() => nav.navigate('Challenge', { slug: c.slug })}>
        <Text style={s.trophy}>🏆</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{c.title}</Text>
          <Text style={s.line} numberOfLines={1}>{line}</Text>
        </View>
        <View style={s.cta}><Text style={s.ctaText}>{cta}</Text></View>
      </TouchableOpacity>
      <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => { setHidden(true); AsyncStorage.setItem(dismissKey, String(Date.now())).catch(() => {}); }}>
        <Text style={s.x}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

export function EntryChip({ postId, top, left }: { postId: string; top: number; left: number }) {
  const nav = useNavigation<any>();
  const feed = useChallengeFeed();
  const [busy, setBusy] = useState(false);
  const c = feed.challenge, e = feed.entries.get(String(postId));
  if (!c || !e) return null;
  const voting = phaseOf(c, Date.now() + feed.skew) === 'voting';

  const vote = async () => {
    if (busy) return; setBusy(true);
    const r = await toggleVote(e.entry_id, e.my_vote);
    setBusy(false);
    if (r.ok) patchFeedEntry(postId, { my_vote: !e.my_vote }); else Alert.alert('LumVibe', r.message);
  };

  return (
    <View style={[s.chipRow, { top, left }]} pointerEvents="box-none">
      <TouchableOpacity style={s.chip} onPress={() => nav.navigate('Challenge', { slug: c.slug })}>
        <Text style={s.chipText}>🏆 Challenge</Text>
      </TouchableOpacity>
      {voting && !e.is_mine ? (
        <TouchableOpacity style={[s.chip, e.my_vote ? s.chipOn : s.chipVote]} disabled={busy} onPress={vote}>
          <Text style={[s.chipText, { color: e.my_vote ? GREEN : '#000' }]}>{e.my_vote ? '✓ Voted' : '🗳️ Vote'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  banner: { position: 'absolute', left: 12, right: 12, zIndex: 50, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 12, paddingRight: 10, borderRadius: 16, backgroundColor: '#0B3D24', borderWidth: 1, borderColor: 'rgba(0,255,136,0.4)' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  trophy: { fontSize: 22 },
  title: { color: '#fff', fontSize: 13, fontWeight: '800' },
  line: { color: '#A9E8C6', fontSize: 11, marginTop: 1 },
  cta: { backgroundColor: GREEN, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 },
  ctaText: { color: '#000', fontWeight: '800', fontSize: 12 },
  x: { color: '#7FB89A', fontSize: 16, paddingHorizontal: 4 },
  chipRow: { position: 'absolute', zIndex: 20, flexDirection: 'row', gap: 6 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(0,255,136,0.5)' },
  chipVote: { backgroundColor: GREEN, borderColor: GREEN },
  chipOn: { backgroundColor: '#0B3D24', borderColor: GREEN },
  chipText: { color: GREEN, fontSize: 12, fontWeight: '800' },
});
