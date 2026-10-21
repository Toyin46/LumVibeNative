// src/weekly/WeeklyCard.tsx
// The shareable 9:16 card (winner / top finalist / "vote for me"). Rendered off-screen at 360x640 and captured to a
// 1080x1920 PNG by react-native-view-shot, then saved to the gallery so the person can post it on Status.
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { GOLD, GREEN } from './weeklyApi';

export type CardKind = 'winner' | 'top' | 'finalist';
export interface CardSpec { kind: CardKind; username: string; avatarUri?: string; thumbUri?: string; votes: number; rank: number; weekText: string; }

export const CARD_W = 360, CARD_H = 640;

const copyFor = (c: CardSpec) => {
  if (c.kind === 'winner') return { head: 'WINNER', kicker: `WEEK OF ${c.weekText} CHAMPION`, line: `${c.votes} ${c.votes === 1 ? 'vote' : 'votes'} · Champion`, foot: 'Post. Get seen. Win the week.' };
  if (c.kind === 'top') return { head: c.rank <= 3 ? `TOP ${c.rank}` : 'TOP 10', kicker: 'WEEKLY TOP 10 FINALIST', line: `Finished #${c.rank} · ${c.votes} ${c.votes === 1 ? 'vote' : 'votes'}`, foot: 'Post. Get seen. Win the week.' };
  return { head: 'VOTE FOR ME', kicker: "I'M IN THE WEEKLY TOP 10", line: 'Watch my post and vote!', foot: 'Voting closes Saturday 11:59 PM' };
};

const WeeklyCard = forwardRef<View, { spec: CardSpec; onReady?: () => void }>(({ spec, onReady }, ref) => {
  const gold = spec.kind === 'winner';
  const accent = gold ? GOLD : GREEN;
  const t = copyFor(spec);
  const need = (spec.thumbUri ? 1 : 0) + (spec.avatarUri ? 1 : 0);
  const [done, setDone] = useState(0);
  const fired = useRef(false);
  const bump = () => setDone(d => d + 1);
  useEffect(() => {
    if (fired.current) return;
    if (done >= need) { fired.current = true; onReady?.(); }
  }, [done, need, onReady]);
  useEffect(() => { const x = setTimeout(() => { if (!fired.current) { fired.current = true; onReady?.(); } }, 6000); return () => clearTimeout(x); }, [onReady]);

  return (
    <View ref={ref} collapsable={false} style={c.card}>
      <Text style={c.brand}>LUMVIBE</Text>
      <Text style={c.sub}>WEEKLY TOP 10</Text>
      <Text style={[c.head, { color: accent }, spec.kind === 'finalist' && { fontSize: 44 }]}>{t.head}</Text>
      <Text style={[c.kicker, { color: accent }]}>{t.kicker}</Text>
      <View style={[c.frame, { borderColor: accent }]}>
        {spec.thumbUri ? <Image source={{ uri: spec.thumbUri }} style={c.thumb} onLoadEnd={bump} /> : <View style={[c.thumb, { backgroundColor: '#0B2A18' }]} />}
        <View style={c.play}><Text style={{ color: '#fff', fontSize: 18 }}>▶</Text></View>
      </View>
      <View style={[c.avatarWrap, { borderColor: accent }]}>
        {spec.avatarUri ? <Image source={{ uri: spec.avatarUri }} style={c.avatar} onLoadEnd={bump} /> : <View style={[c.avatar, { backgroundColor: '#0B3D24', alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: GREEN, fontWeight: '900', fontSize: 24 }}>{(spec.username || 'L')[0].toUpperCase()}</Text></View>}
      </View>
      <Text style={c.user} numberOfLines={1}>@{spec.username}</Text>
      <Text style={[c.line, { color: accent }]}>{t.line}</Text>
      <View style={c.pill}><Text style={c.pillText}>lumvibe.site</Text></View>
      <Text style={c.foot}>{t.foot}</Text>
    </View>
  );
});
export default WeeklyCard;

const c = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, backgroundColor: '#04170C', alignItems: 'center', paddingTop: 26, borderWidth: 0 },
  brand: { color: GREEN, fontSize: 20, fontWeight: '900', letterSpacing: 6 },
  sub: { color: '#7FD8A8', fontSize: 9.5, letterSpacing: 3.4, marginTop: 4, fontWeight: '700' },
  head: { fontSize: 58, fontWeight: '900', marginTop: 14, letterSpacing: 1 },
  kicker: { fontSize: 11.5, letterSpacing: 3, fontWeight: '800', marginTop: 2 },
  frame: { width: 232, height: 300, borderRadius: 18, borderWidth: 3, overflow: 'hidden', marginTop: 16, backgroundColor: '#000' },
  thumb: { width: '100%', height: '100%' },
  play: { position: 'absolute', left: 98, top: 128, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  avatarWrap: { width: 62, height: 62, borderRadius: 31, borderWidth: 3, overflow: 'hidden', marginTop: -26, backgroundColor: '#000' },
  avatar: { width: '100%', height: '100%' },
  user: { color: '#fff', fontSize: 24, fontWeight: '900', marginTop: 8, maxWidth: 320 },
  line: { fontSize: 15, fontWeight: '800', marginTop: 4 },
  pill: { backgroundColor: GREEN, paddingHorizontal: 34, paddingVertical: 9, borderRadius: 999, marginTop: 14 },
  pillText: { color: '#000', fontWeight: '900', fontSize: 16 },
  foot: { color: '#6FA88A', fontSize: 11, marginTop: 8 },
});
