// src/challenge/ChallengeScreen.tsx
// "POV: ONLY IN NIGERIA" — the challenge page in the app. Same database as the website, so entries and votes are shared.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Share, RefreshControl, Dimensions,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '../store/authStore';
import { GREEN, challengeShareUrl, entryShareUrl, phaseOf, rpc, thumbFor, toggleVote, watLabel } from './challengeApi';
import { refreshChallengeFeed } from './feedStore';

const W = Dimensions.get('window').width;
const GAP = 10, PAD = 14, CARD_W = (W - PAD * 2 - GAP) / 2;

const START_ERRORS: Record<string, string> = {
  login: 'Please log in to enter.', entries_closed: 'Entries are closed.',
  already_entered: "You've already entered this challenge. Share your entry below!", not_found: 'This challenge was not found.',
};

export default function ChallengeScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const me: string | undefined = useAuthStore((st: any) => st.user?.id);
  const slug: string = route.params?.slug || 'only-in-nigeria';
  const seed = useMemo(() => Math.random().toString(36).slice(2), []);

  const [c, setC] = useState<any>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [skew, setSkew] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ch = await rpc<any>('get_challenge', { p_slug: slug });
    if (!ch || ch.code) { setC(null); setLoading(false); return; }
    setSkew(Date.parse(ch.server_now) - Date.now());
    setC(ch);
    const rows = await rpc<any[]>('list_challenge_entries', { p_slug: slug, p_limit: 100, p_offset: 0, p_seed: seed });
    setEntries(Array.isArray(rows) ? rows : []);
    if (phaseOf(ch, Date.now() + (Date.parse(ch.server_now) - Date.now())) === 'closed') {
      const rs = await rpc<any[]>('get_challenge_results', { p_slug: slug });
      setResults(Array.isArray(rs) ? rs : []);
    }
    setLoading(false);
  }, [slug, seed]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  const now = tick + skew;
  const phase = c ? phaseOf(c, now) : 'closed';
  const mine = me ? entries.find(e => e.user_id === me) : undefined;
  const entriesOpen = !!c && now >= Date.parse(c.entries_open_at) && now < Date.parse(c.entries_close_at);

  const target = !c ? null : phase === 'upcoming' ? c.entries_open_at : phase === 'entries' ? c.voting_opens_at : phase === 'voting' ? c.voting_closes_at : null;
  const label = phase === 'upcoming' ? 'Entries open in' : phase === 'entries' ? 'Voting opens in' : 'Voting closes in';
  const left = target ? Math.max(0, Math.floor((Date.parse(target) - now) / 1000)) : 0;
  const parts = [Math.floor(left / 86400), Math.floor((left % 86400) / 3600), Math.floor((left % 3600) / 60), left % 60];
  const pad = (n: number) => String(n).padStart(2, '0');

  const enter = async () => {
    const r: any = await rpc('start_challenge_entry', { p_slug: slug });
    if (!r || !r.ok) { Alert.alert('LumVibe', START_ERRORS[r?.error as string] ?? 'Could not start your entry. Try again.'); return; }
    nav.navigate('Main', { screen: 'Create', params: { initialMode: 'post' } });
  };

  const vote = async (e: any) => {
    if (busyId) return; setBusyId(e.entry_id);
    const r = await toggleVote(e.entry_id, e.my_vote);
    setBusyId(null);
    if (!r.ok) { Alert.alert('LumVibe', r.message); return; }
    setEntries(list => list.map(x => x.entry_id === e.entry_id ? { ...x, my_vote: !e.my_vote, vote_count: x.vote_count == null ? null : x.vote_count + (e.my_vote ? -1 : 1) } : x));
    refreshChallengeFeed(true);
  };

  const shareChallenge = () => Share.share({ message: `${c.title} on LumVibe 🇳🇬 Watch the entries, vote, or enter yours!\n${challengeShareUrl(slug)}` }).catch(() => {});
  const shareEntry = (e: any) => Share.share({ message: `Watch this entry in LumVibe's "${c.title}" challenge. Can you beat it? 😂\n${entryShareUrl(e.post_id)}` }).catch(() => {});
  const open = (e: any) => nav.navigate('PostDetail', { postId: String(e.post_id) });

  const myResult = me ? results.find(r => r.user_id === me) : undefined;
  const badge = (r: any) => r.rank === 1 ? '🏆 Season 1 Winner' : r.rank <= 3 ? '🥉 Top 3 Finalist' : '⭐ Top 10 Finalist';
  const votesText = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

  const header = c ? (
    <View>
      {mine ? (
        <View style={s.mine}>
          <Text style={s.mineTitle}>✅ You're in!</Text>
          <Text style={s.mineSub}>Your entry is live. Ask friends to {phase === 'voting' ? 'vote for it' : 'vote when voting opens'}.</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={[s.btn, { flex: 1 }]} onPress={() => shareEntry(mine)}><Text style={s.btnText}>🔗 Share my entry</Text></TouchableOpacity>
            <TouchableOpacity style={[s.btnGhost, { flex: 1 }]} onPress={() => open(mine)}><Text style={s.btnGhostText}>▶ Watch</Text></TouchableOpacity>
          </View>
        </View>
      ) : null}

      <View style={s.hero}>
        <Text style={s.kicker}>LUMVIBE PRESENTS</Text>
        <Text style={s.title}>{c.title}</Text>
        <Text style={s.sub}>Your funniest Nigerian moment deserves to be seen.</Text>
        <View style={s.prompt}>
          <Text style={s.promptLabel}>THIS WEEK'S PROMPT</Text>
          <Text style={s.promptText}>{c.prompt}</Text>
          {c.hook ? <Text style={s.hook}>“{c.hook}”</Text> : null}
        </View>

        {target ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={s.phase}>{label}</Text>
            <View style={s.clock}>
              {['DAYS', 'HRS', 'MIN', 'SEC'].map((u, i) => (
                <View key={u} style={s.clockBox}><Text style={s.clockNum}>{i === 0 ? parts[i] : pad(parts[i])}</Text><Text style={s.clockUnit}>{u}</Text></View>
              ))}
            </View>
            <Text style={s.deadline}>{watLabel(target)}</Text>
          </View>
        ) : <Text style={s.phase}>Voting has closed 🎉</Text>}

        {entriesOpen && !mine ? <TouchableOpacity style={s.btn} onPress={enter}><Text style={s.btnText}>🎬 Enter the challenge</Text></TouchableOpacity> : null}
        {phase === 'upcoming' ? <View style={[s.btn, { opacity: 0.45 }]}><Text style={s.btnText}>Opens {watLabel(c.entries_open_at)}</Text></View> : null}
        <TouchableOpacity style={s.btnGhost} onPress={shareChallenge}><Text style={s.btnGhostText}>🔗 Share the challenge</Text></TouchableOpacity>
      </View>

      {phase === 'closed' ? (
        <View style={{ marginTop: 22 }}>
          <Text style={s.h2}>🏆 Results</Text>
          {results.length === 0 ? <Text style={s.empty}>Results are being verified. Check back shortly.</Text> : results.slice(0, 5).map(r => (
            <View key={r.entry_id} style={[s.win, r.rank === 1 && s.winFirst]}>
              <Text style={s.winRank}>{['🥇', '🥈', '🥉'][r.rank - 1] || r.rank}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.winName, r.rank === 1 && { color: '#FFD700' }]}>@{r.username || 'creator'}</Text>
                <Text style={s.winSub}>{votesText(r.votes)} · {badge(r)}</Text>
              </View>
            </View>
          ))}
          {myResult && myResult.rank > 5 ? <Text style={s.empty}>You finished #{myResult.rank} 👏</Text> : null}
          {myResult ? (
            <TouchableOpacity style={s.btn} onPress={() => Share.share({ message: (myResult.rank === 1 ? `I WON ${c.title} on LumVibe! 🏆🇳🇬` : `I finished #${myResult.rank} in ${c.title} on LumVibe! 🇳🇬`) + `\n${challengeShareUrl(slug)}` }).catch(() => {})}>
              <Text style={s.btnText}>📣 Share my result</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      <View style={s.rowHead}><Text style={s.h2}>Entries</Text><Text style={s.count}>{entries.length} so far</Text></View>
    </View>
  ) : null;

  const footer = c ? (
    <View style={{ marginTop: 22 }}>
      <Text style={s.h2}>Rules</Text>
      <View style={s.rules}>
        {(Array.isArray(c.rules) ? c.rules : []).map((r: string, i: number) => <Text key={i} style={s.rule}>{i + 1}. {r}</Text>)}
      </View>
      <Text style={s.foot}>Voting closes {watLabel(c.voting_closes_at)}.{'\n'}Something breaks the rules? Open the entry and use Report.</Text>
    </View>
  ) : null;

  if (loading) return <View style={[s.screen, s.center]}><ActivityIndicator color={GREEN} size="large" /></View>;
  if (!c) return (
    <View style={[s.screen, s.center, { paddingTop: insets.top }]}>
      <Text style={s.empty}>This challenge doesn't exist (yet).</Text>
      <TouchableOpacity style={s.btnGhost} onPress={() => nav.goBack()}><Text style={s.btnGhostText}>Go back</Text></TouchableOpacity>
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
        data={entries}
        keyExtractor={e => String(e.entry_id)}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: PAD }}
        ListHeaderComponent={<View style={{ paddingHorizontal: PAD }}>{header}</View>}
        ListFooterComponent={<View style={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 40 }}>{footer}</View>}
        ListEmptyComponent={<Text style={[s.empty, { marginHorizontal: PAD }]}>{entriesOpen ? 'No entries yet. Be the first! Tap Enter the challenge above.' : 'No entries yet. Check back soon.'}</Text>}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={GREEN} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        renderItem={({ item: e }) => {
          const th = thumbFor(e);
          return (
            <View style={[s.card, { width: CARD_W }]}>
              <TouchableOpacity activeOpacity={0.85} onPress={() => open(e)}>
                {th ? <Image source={{ uri: th }} style={s.thumb} /> : <View style={[s.thumb, { backgroundColor: '#1A1A1A' }]} />}
                <View style={s.play}><Text style={{ color: '#fff', fontSize: 16 }}>▶</Text></View>
                {e.is_host ? <View style={s.host}><Text style={s.hostText}>HOST</Text></View> : null}
              </TouchableOpacity>
              <View style={s.meta}>
                <Text style={s.user} numberOfLines={1}>@{e.username || 'creator'}</Text>
                {e.vote_count != null ? <Text style={s.votes}>♥ {e.vote_count}</Text> : null}
              </View>
              {phase === 'voting' && e.user_id !== me ? (
                <TouchableOpacity style={[s.voteBtn, e.my_vote && s.voteOn]} disabled={busyId === e.entry_id} onPress={() => vote(e)}>
                  <Text style={[s.voteText, e.my_vote && { color: '#000' }]}>{e.my_vote ? '✓ Voted' : '🗳️ Vote'}</Text>
                </TouchableOpacity>
              ) : <View style={{ height: 10 }} />}
            </View>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: PAD, paddingBottom: 10 },
  logo: { color: GREEN, fontSize: 22, fontWeight: '900' },
  hero: { marginTop: 8, padding: 20, borderRadius: 24, backgroundColor: '#06210F', borderWidth: 1, borderColor: '#0E3D22', alignItems: 'stretch' },
  kicker: { textAlign: 'center', color: '#9DFFCF', fontSize: 11, letterSpacing: 2.4, fontWeight: '700' },
  title: { textAlign: 'center', color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '900', marginTop: 10 },
  sub: { textAlign: 'center', color: '#CFE9DB', fontSize: 15, marginTop: 8 },
  prompt: { marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderStyle: 'dashed', borderColor: '#1F8F55', alignItems: 'center' },
  promptLabel: { color: '#7FD8A8', fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  promptText: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 6 },
  hook: { color: '#BFE3CF', fontSize: 13, marginTop: 8, textAlign: 'center' },
  phase: { color: '#9DFFCF', fontSize: 13, marginTop: 14, textAlign: 'center' },
  clock: { flexDirection: 'row', gap: 8, marginTop: 8 },
  clockBox: { minWidth: 58, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center' },
  clockNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  clockUnit: { color: '#8FC9AA', fontSize: 10, letterSpacing: 1 },
  deadline: { color: '#8FB8A1', fontSize: 12, marginTop: 6, marginBottom: 6 },
  btn: { marginTop: 12, backgroundColor: GREEN, paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  btnText: { color: '#000', fontWeight: '800', fontSize: 16 },
  btnGhost: { marginTop: 10, borderWidth: 1, borderColor: GREEN, paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
  btnGhostText: { color: GREEN, fontWeight: '800', fontSize: 15 },
  mine: { marginTop: 8, marginBottom: 4, padding: 14, borderRadius: 16, backgroundColor: '#052B16', borderWidth: 1, borderColor: GREEN },
  mineTitle: { color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  mineSub: { color: '#BFE3CF', textAlign: 'center', marginTop: 4 },
  h2: { color: '#fff', fontSize: 19, fontWeight: '800' },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 12 },
  count: { color: '#888', fontSize: 13 },
  empty: { color: '#9A9A9A', textAlign: 'center', paddingVertical: 24, lineHeight: 22 },
  win: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#111', borderWidth: 1, borderColor: '#1D1D1D', marginTop: 10 },
  winFirst: { borderColor: '#FFD700', backgroundColor: '#241E00' },
  winRank: { fontSize: 26, width: 36, textAlign: 'center', color: '#fff' },
  winName: { color: '#fff', fontWeight: '800', fontSize: 15 },
  winSub: { color: '#999', fontSize: 12, marginTop: 2 },
  card: { marginBottom: GAP, borderRadius: 16, overflow: 'hidden', backgroundColor: '#111', borderWidth: 1, borderColor: '#1D1D1D' },
  thumb: { width: '100%', aspectRatio: 3 / 4 },
  play: { position: 'absolute', left: '50%', top: '50%', marginLeft: -23, marginTop: -23, width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  host: { position: 'absolute', top: 8, left: 8, backgroundColor: '#FFD700', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  hostText: { color: '#000', fontSize: 10, fontWeight: '900' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingTop: 9 },
  user: { color: '#DDD', fontSize: 13, flex: 1 },
  votes: { color: GREEN, fontWeight: '700', fontSize: 13 },
  voteBtn: { margin: 10, marginTop: 8, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: GREEN, alignItems: 'center' },
  voteOn: { backgroundColor: GREEN },
  voteText: { color: GREEN, fontWeight: '800' },
  rules: { backgroundColor: '#111', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1D1D1D', marginTop: 10 },
  rule: { color: '#CFCFCF', lineHeight: 22, marginVertical: 4 },
  foot: { color: '#777', fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 18 },
});
