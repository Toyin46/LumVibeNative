// src/weekly/WeeklyScreen.tsx
// Weekly leaderboard + Top 10 voting. ONE backend function (get_weekly_board) decides what to show:
//   points  -> Sunday..Thursday: top 50 by weekly points
//   voting  -> Thursday..Saturday: the frozen Top 10, ranked by votes
//   closed  -> after voting: final results
// Same database as the website, so web and app always agree. All rules (3 votes, no self-vote, verified email,
// official account can't win or vote) are enforced in the database, not here.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Share, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import { useAuthStore } from '../store/authStore';
import WeeklyCard, { CardSpec } from './WeeklyCard';
import {
  GREEN, GOLD, WeeklyBoard, WeeklyRow, getWeeklyBoard, loadPostThumbs, lockTime, toggleWeeklyVote, watLabel, weekLabel, weeklyShareUrl,
} from './weeklyApi';

const MEDAL = ['🥇', '🥈', '🥉'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function WeeklyScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const me: string | undefined = useAuthStore((st: any) => st.user?.id);

  const [board, setBoard] = useState<WeeklyBoard | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<View>(null);

  const load = useCallback(async () => {
    const b = await getWeeklyBoard();
    if (!b || !b.phase) { setLoading(false); return; }
    // thumbnails first, so the board and the shareable card appear together
    const t = b.phase === 'points' ? {} : await loadPostThumbs(b.rows.map(r => r.post_id || ''));
    setThumbs(prev => ({ ...prev, ...t }));
    setBoard(b);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const x = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(x); }, []);

  const phase = board?.phase ?? 'points';
  const target = !board ? 0 : phase === 'points' ? lockTime(board) : phase === 'voting' ? Date.parse(board.voting_ends_at || '') || 0 : 0;
  const left = target ? Math.max(0, Math.floor((target - tick) / 1000)) : 0;
  const parts = [Math.floor(left / 86400), Math.floor((left % 86400) / 3600), Math.floor((left % 3600) / 60), left % 60];

  // when a countdown reaches zero the database flips the phase within a minute: keep checking until it does
  useEffect(() => {
    if (!target || left > 0) return;
    const x = setInterval(() => { load(); }, 20000);
    return () => clearInterval(x);
  }, [target, left, load]);

  const rows = board?.rows ?? [];
  const mine: WeeklyRow | undefined = me ? rows.find(r => r.user_id === me) : undefined;
  const voting = phase === 'voting', closed = phase === 'closed';
  const votesLeft = board?.votes_left ?? 0, maxVotes = board?.max_votes ?? 3;

  const cardSpec: CardSpec | null = board && mine && phase !== 'points' ? {
    kind: voting ? 'finalist' : mine.rank === 1 ? 'winner' : 'top',
    username: mine.username, avatarUri: mine.avatar_url || undefined, thumbUri: thumbs[mine.post_id || ''] || undefined,
    votes: mine.votes || 0, rank: mine.rank, weekText: weekLabel(board.week_start),
  } : null;
  const cardKey = cardSpec ? `${cardSpec.kind}-${cardSpec.username}-${cardSpec.thumbUri || ''}-${cardSpec.votes}` : 'none';
  useEffect(() => { setCardReady(false); }, [cardKey]);

  const vote = async (r: WeeklyRow) => {
    if (busyId) return;
    if (!me) { Alert.alert('LumVibe', 'Please log in to vote.'); return; }
    setBusyId(r.user_id);
    const res = await toggleWeeklyVote(r.user_id, !!r.voted_by_me);
    setBusyId(null);
    if (!res.ok) { Alert.alert('LumVibe', res.message); return; }
    await load();
  };

  const share = (r: WeeklyRow) => {
    const text = r.user_id === me
      ? "I'm in this week's LumVibe Top 10! 🔥 Watch my post and vote for me before voting closes."
      : `Watch @${r.username}'s post in LumVibe's Weekly Top 10 and vote! 🔥`;
    Share.share({ message: `${text}\n${weeklyShareUrl(r.user_id)}` }).catch(() => {});
  };

  const saveCard = async () => {
    if (!cardReady || !cardRef.current || saving) return;
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.status !== 'granted') { Alert.alert('LumVibe', 'Allow photo access so we can save your card to your gallery.'); return; }
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile', width: 1080, height: 1920 });
      const asset = await MediaLibrary.createAssetAsync(uri);
      try {
        const album = await MediaLibrary.getAlbumAsync('LumVibe');
        if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
        else await MediaLibrary.createAlbumAsync('LumVibe', asset, false);
      } catch { /* the photo is already saved to the gallery */ }
      Alert.alert('Saved ✅', 'Your card is in your gallery (LumVibe album). Post it on your Status!');
    } catch {
      Alert.alert('LumVibe', 'Could not create your card. Please try again.');
    } finally { setSaving(false); }
  };

  const copy = phase === 'points'
    ? { kicker: 'THIS WEEK ON LUMVIBE', title: 'Weekly Leaderboard', sub: 'Post, get views, likes and comments. On Thursday the Top 10 go head to head, and your votes pick the winner.' }
    : voting
      ? { kicker: 'WEEKLY TOP 10', title: '🔥 Vote for your favourite', sub: `These 10 creators earned their spot. Watch their posts and vote. ${votesLeft} of ${maxVotes} votes left.` }
      : { kicker: 'WEEKLY TOP 10', title: '🏆 Final results', sub: 'Voting has closed. A new week starts on Sunday. Keep posting!' };

  const header = board ? (
    <View>
      {mine && voting ? (
        <View style={s.mine}>
          <Text style={s.mineTitle}>🔥 You're in the Top 10!</Text>
          <Text style={s.mineSub}>You're #{mine.rank} right now. Share your link and get your people to vote.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={[s.btn, { flex: 1, marginTop: 0 }]} onPress={() => share(mine)}><Text style={s.btnText}>🔗 Share my link</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btnGhost, { flex: 1, marginTop: 0 }]} onPress={saveCard} disabled={!cardReady || saving}>
              <Text style={s.btnGhostText}>{saving ? 'Saving…' : cardReady ? '⬇ My card' : 'Preparing…'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
      {mine && closed ? (
        <View style={s.mine}>
          <Text style={s.mineTitle}>{mine.rank === 1 ? '🏆 You won this week!' : `You finished #${mine.rank} with ${mine.votes ?? 0} votes 👏`}</Text>
          <Text style={s.mineSub}>{mine.rank === 1 ? 'Download your winner card and post it on your Status.' : 'Thanks for competing. Download your card and post it!'}</Text>
          <TouchableOpacity style={s.btn} onPress={saveCard} disabled={!cardReady || saving}>
            <Text style={s.btnText}>{saving ? 'Saving…' : cardReady ? '⬇ Download my card' : 'Preparing…'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={s.hero}>
        <Text style={s.kicker}>{copy.kicker}</Text>
        <Text style={s.title}>{copy.title}</Text>
        <Text style={s.sub}>{copy.sub}</Text>
        {target ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={s.phase}>{phase === 'points' ? 'Top 10 locks in' : 'Voting closes in'}</Text>
            {left > 0 ? (
              <View style={s.clock}>
                {['DAYS', 'HRS', 'MIN', 'SEC'].map((u, i) => (
                  <View key={u} style={s.clockBox}><Text style={s.clockNum}>{i === 0 ? parts[i] : pad(parts[i])}</Text><Text style={s.clockUnit}>{u}</Text></View>
                ))}
              </View>
            ) : <Text style={s.phase}>{phase === 'points' ? 'Locking in the Top 10…' : 'Counting the final votes…'}</Text>}
            <Text style={s.deadline}>{watLabel(target)}</Text>
          </View>
        ) : <Text style={s.phase}>Voting has closed 🎉</Text>}
      </View>

      <View style={s.rowHead}><Text style={s.h2}>{phase === 'points' ? 'Top 50 this week' : 'The Top 10'}</Text><Text style={s.count}>{phase === 'points' ? 'by points' : 'by votes'}</Text></View>
    </View>
  ) : null;

  const footer = board ? (
    <View style={{ marginTop: 14 }}>
      {voting ? <Text style={s.foot}>Voting needs a verified LumVibe account. You can't vote for yourself. Tap a vote again to move it.</Text> : null}
      <Text style={s.foot}>Voting closes Saturday 11:59 PM (Nigeria time). Weekly points reset every Sunday.</Text>
    </View>
  ) : null;

  const renderRow = ({ item: r }: { item: WeeklyRow }) => {
    if (phase === 'points') {
      const isMe = r.user_id === me;
      return (
        <TouchableOpacity style={[s.prow, isMe && s.prowMe]} activeOpacity={0.8} onPress={() => { if (!isMe) nav.navigate('UserProfile', { userId: r.user_id }); }}>
          <Text style={s.prank}>{MEDAL[r.rank - 1] || `#${r.rank}`}</Text>
          {r.avatar_url ? <Image source={{ uri: r.avatar_url }} style={s.pav} /> : <View style={[s.pav, s.pph]}><Text style={{ color: GREEN, fontWeight: '800' }}>{(r.username || 'L')[0].toUpperCase()}</Text></View>}
          <View style={{ flex: 1 }}><Text style={s.pname} numberOfLines={1}>{r.display_name || r.username}{r.wins ? `  🏆×${r.wins}` : ''}</Text><Text style={s.puser} numberOfLines={1}>@{r.username}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={s.ppts}>{(r.points ?? 0).toLocaleString()}</Text><Text style={s.plabel}>pts</Text></View>
        </TouchableOpacity>
      );
    }
    const th = thumbs[r.post_id || ''], isMe = r.user_id === me, lead = r.rank === 1 && (closed || (r.votes ?? 0) > 0);
    return (
      <View style={[s.fin, lead && s.finLead]}>
        <Text style={s.frank}>{MEDAL[r.rank - 1] || `#${r.rank}`}</Text>
        <TouchableOpacity activeOpacity={0.85} onPress={() => { if (r.post_id) nav.navigate('PostDetail', { postId: String(r.post_id) }); }}>
          {th ? <Image source={{ uri: th }} style={s.fthumb} /> : <View style={[s.fthumb, { backgroundColor: '#1A1A1A' }]} />}
          <View style={s.play}><Text style={{ color: '#fff', fontSize: 14 }}>▶</Text></View>
        </TouchableOpacity>
        <View style={{ flex: 1, justifyContent: 'space-between' }}>
          <View>
            <Text style={s.fname} numberOfLines={1}>@{r.username}{r.wins ? ` 🏆×${r.wins}` : ''}{isMe ? '  ' : ''}{isMe ? <Text style={s.you}> YOU </Text> : null}</Text>
            <Text style={s.fsub}>♥ {(r.votes ?? 0).toLocaleString()} {(r.votes ?? 0) === 1 ? 'vote' : 'votes'} · {(r.points_at_freeze ?? 0).toLocaleString()} pts</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {voting && !isMe ? (
              <TouchableOpacity style={[s.vbtn, r.voted_by_me && s.vbtnOn]} disabled={busyId === r.user_id} onPress={() => vote(r)}>
                <Text style={[s.vtext, r.voted_by_me && { color: GREEN }]}>{r.voted_by_me ? '✓ Voted' : '🗳️ Vote'}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={s.sbtn} onPress={() => share(r)}><Text style={s.stext}>🔗 Share</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  if (loading) return <View style={[s.screen, s.center]}><ActivityIndicator color={GREEN} size="large" /></View>;
  if (!board) return (
    <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
      <Text style={s.empty}>Could not load the leaderboard.</Text>
      <TouchableOpacity style={s.btnGhost} onPress={() => { setLoading(true); load(); }}><Text style={s.btnGhostText}>Try again</Text></TouchableOpacity>
    </View>
  );

  return (
    <View style={s.screen}>
      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
        <Text style={s.logo}>LumVibe</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={rows}
        keyExtractor={r => r.user_id}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 40 }}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={<Text style={s.empty}>{phase === 'points' ? 'No points yet this week. Be the first!' : 'No finalists this week.'}</Text>}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={GREEN} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      />
      {/* off-screen copy of the card, captured to PNG when the person taps "My card" */}
      {cardSpec ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: -2000, top: 0 }}>
          <WeeklyCard key={cardKey} ref={cardRef} spec={cardSpec} onReady={() => setCardReady(true)} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 },
  logo: { color: GREEN, fontSize: 22, fontWeight: '900' },
  hero: { marginTop: 8, padding: 20, borderRadius: 24, backgroundColor: '#06210F', borderWidth: 1, borderColor: '#0E3D22' },
  kicker: { textAlign: 'center', color: '#9DFFCF', fontSize: 11, letterSpacing: 2.4, fontWeight: '700' },
  title: { textAlign: 'center', color: '#fff', fontSize: 27, lineHeight: 32, fontWeight: '900', marginTop: 10 },
  sub: { textAlign: 'center', color: '#CFE9DB', fontSize: 14.5, marginTop: 8, lineHeight: 21 },
  phase: { color: '#9DFFCF', fontSize: 13, marginTop: 14, textAlign: 'center' },
  clock: { flexDirection: 'row', gap: 8, marginTop: 8 },
  clockBox: { minWidth: 58, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' },
  clockNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  clockUnit: { color: '#8FC9AA', fontSize: 10, letterSpacing: 1 },
  deadline: { color: '#8FB8A1', fontSize: 12, marginTop: 6 },
  btn: { marginTop: 12, backgroundColor: GREEN, paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
  btnText: { color: '#000', fontWeight: '800', fontSize: 15 },
  btnGhost: { marginTop: 10, borderWidth: 1, borderColor: GREEN, paddingVertical: 13, borderRadius: 16, alignItems: 'center' },
  btnGhostText: { color: GREEN, fontWeight: '800', fontSize: 15 },
  mine: { marginTop: 8, marginBottom: 4, padding: 14, borderRadius: 16, backgroundColor: '#052B16', borderWidth: 1, borderColor: GREEN },
  mineTitle: { color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  mineSub: { color: '#BFE3CF', textAlign: 'center', marginTop: 4, lineHeight: 20 },
  h2: { color: '#fff', fontSize: 19, fontWeight: '800' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 22, marginBottom: 12 },
  count: { color: '#888', fontSize: 13 },
  empty: { color: '#9A9A9A', textAlign: 'center', paddingVertical: 24, lineHeight: 22 },
  prow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#1D1D1D', marginBottom: 8 },
  prowMe: { borderColor: GREEN, backgroundColor: '#052B16' },
  prank: { width: 38, textAlign: 'center', fontSize: 20, fontWeight: '800', color: '#AAA' },
  pav: { width: 42, height: 42, borderRadius: 21 },
  pph: { backgroundColor: '#0B3D24', alignItems: 'center', justifyContent: 'center' },
  pname: { color: '#fff', fontWeight: '800', fontSize: 15 },
  puser: { color: '#888', fontSize: 12 },
  ppts: { color: GREEN, fontWeight: '800', fontSize: 16 },
  plabel: { color: '#777', fontSize: 10 },
  fin: { flexDirection: 'row', gap: 10, padding: 10, borderRadius: 18, backgroundColor: '#111', borderWidth: 1, borderColor: '#1D1D1D', marginBottom: 12 },
  finLead: { borderColor: GOLD, backgroundColor: '#241E00' },
  frank: { width: 30, textAlign: 'center', fontSize: 22, color: '#ddd', paddingTop: 4 },
  fthumb: { width: 92, height: 122, borderRadius: 12 },
  play: { position: 'absolute', left: 29, top: 44, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  fname: { color: '#fff', fontWeight: '800', fontSize: 15 },
  you: { backgroundColor: GREEN, color: '#000', fontSize: 10, fontWeight: '900' },
  fsub: { color: '#999', fontSize: 12, marginTop: 3 },
  vbtn: { flex: 1, backgroundColor: GREEN, paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  vbtnOn: { backgroundColor: '#0B3D24' },
  vtext: { color: '#000', fontWeight: '800', fontSize: 13 },
  sbtn: { flex: 1, backgroundColor: '#1B1B1B', paddingVertical: 10, borderRadius: 12, alignItems: 'center' },
  stext: { color: '#DDD', fontWeight: '800', fontSize: 13 },
  foot: { color: '#777', fontSize: 12, textAlign: 'center', marginTop: 8, lineHeight: 18 },
});
