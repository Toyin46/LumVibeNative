// app/leaderboard.tsx - UPGRADED: Weekly winners podium + countdown + proper filter logic
// ✅ Translations added via useTranslation()

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from './config/supabase'; 
import { useTranslation } from './locales/LanguageContext'; 

interface LeaderboardUser {
  id: string; username: string; display_name: string; avatar_url: string;
  points: number; weekly_points: number; rank: number;
}
interface WeeklyWinner {
  rank: 1|2|3; user_id: string; username: string; display_name: string;
  avatar_url?: string; weekly_points: number; week_start: string;
}

const RANK_CONFIG = {
  1: { emoji: '🥇', color: '#FFD700', glow: '#FFD70033', label: '1st Place' },
  2: { emoji: '🥈', color: '#C0C0C0', glow: '#C0C0C033', label: '2nd Place' },
  3: { emoji: '🥉', color: '#CD7F32', glow: '#CD7F3233', label: '3rd Place' },
};

function useCountdownToSunday() {
  const getSecondsUntilSunday = () => {
    const now = new Date();
    const nextSunday = new Date(now);
    const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
    nextSunday.setDate(now.getDate() + daysUntilSunday);
    nextSunday.setHours(0, 0, 0, 0);
    return Math.floor((nextSunday.getTime() - now.getTime()) / 1000);
  };
  const [seconds, setSeconds] = useState(getSecondsUntilSunday());
  useEffect(() => {
    const interval = setInterval(() => { setSeconds(getSecondsUntilSunday()); }, 1000);
    return () => clearInterval(interval);
  }, []);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return { d, h, m, s };
}

function CountdownTimer() {
  const { d, h, m, s } = useCountdownToSunday();
  const { t } = useTranslation();
  return (
    <View style={countdownStyles.container}>
      <Text style={countdownStyles.label}>🔄 {t.leaderboard.resetsIn}</Text>
      <View style={countdownStyles.units}>
        {[
          { value: d, unit: t.leaderboard.days },
          { value: h, unit: t.leaderboard.hours },
          { value: m, unit: t.leaderboard.mins },
          { value: s, unit: t.leaderboard.secs },
        ].map(({ value, unit }) => (
          <View key={unit} style={countdownStyles.unitBox}>
            <Text style={countdownStyles.unitValue}>{String(value).padStart(2, '0')}</Text>
            <Text style={countdownStyles.unitLabel}>{unit}</Text>
          </View>
        ))}
      </View>
      <Text style={countdownStyles.pointsGuide}>
        Post +50 · View +2 · Like +10 · Comment +15 · Share +30
      </Text>
    </View>
  );
}

const countdownStyles = StyleSheet.create({
  container:   { alignItems: 'center', paddingVertical: 10 },
  label:       { color: '#888', fontSize: 11, marginBottom: 6 },
  units:       { flexDirection: 'row', gap: 6 },
  unitBox:     { alignItems: 'center', backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 44, borderWidth: 1, borderColor: '#2a2a2a' },
  unitValue:   { color: '#00ff88', fontSize: 16, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  unitLabel:   { color: '#555', fontSize: 9, marginTop: 2 },
  pointsGuide: { color: '#00ff8866', fontSize: 10, fontWeight: '600', marginTop: 10 },
});

function TopThreePodium({ winners, onUserPress, filter }: {
  winners: LeaderboardUser[]; onUserPress: (id: string) => void; filter: 'week'|'month'|'all';
}) {
  const { t } = useTranslation();
  const top3 = winners.slice(0, 3);
  if (top3.length === 0) return null;
  const order = [top3[1], top3[0], top3[2]].filter(Boolean);
  const podiumHeights = { 0: 90, 1: 120, 2: 70 };
  return (
    <View style={podiumStyles.container}>
      <View style={podiumStyles.winnersRow}>
        {order.map((user, idx) => {
          const realRank = (top3.indexOf(user) + 1) as 1|2|3;
          const cfg = RANK_CONFIG[realRank];
          const pts = filter === 'all' ? user.points : user.weekly_points;
          return (
            <TouchableOpacity key={user.id} style={podiumStyles.winnerCol} onPress={() => onUserPress(user.id)} activeOpacity={0.8}>
              <Text style={podiumStyles.rankEmoji}>{cfg.emoji}</Text>
              <View style={[podiumStyles.avatarRing, { borderColor: cfg.color, shadowColor: cfg.color }]}>
                {user.avatar_url
                  ? <Image source={{ uri: user.avatar_url }} style={podiumStyles.avatar} />
                  : <View style={[podiumStyles.avatar, podiumStyles.avatarFallback]}><Feather name="user" size={realRank === 1 ? 26 : 20} color={cfg.color} /></View>}
              </View>
              <Text style={[podiumStyles.name, { color: cfg.color }]} numberOfLines={1}>{user.display_name}</Text>
              <Text style={podiumStyles.username} numberOfLines={1}>@{user.username}</Text>
              <Text style={podiumStyles.pts}>{pts.toLocaleString()} {t.leaderboard.pointsLabel}</Text>
              <View style={[podiumStyles.podiumBlock, { height: podiumHeights[idx as 0|1|2], backgroundColor: cfg.glow, borderColor: cfg.color }]}>
                <Text style={[podiumStyles.podiumRankNum, { color: cfg.color }]}>#{realRank}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const podiumStyles = StyleSheet.create({
  container:      { paddingHorizontal: 16, paddingBottom: 8 },
  winnersRow:     { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  winnerCol:      { flex: 1, alignItems: 'center', maxWidth: 110 },
  rankEmoji:      { fontSize: 24, marginBottom: 6 },
  avatarRing:     { borderWidth: 2.5, borderRadius: 40, padding: 2, marginBottom: 8, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8, elevation: 8 },
  avatar:         { width: 60, height: 60, borderRadius: 30 },
  avatarFallback: { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  name:           { fontSize: 12, fontWeight: 'bold', textAlign: 'center', maxWidth: 100 },
  username:       { color: '#666', fontSize: 10, textAlign: 'center', marginTop: 2 },
  pts:            { color: '#00ff88', fontSize: 11, fontWeight: '600', marginTop: 4, marginBottom: 8 },
  podiumBlock:    { width: '100%', borderRadius: 8, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  podiumRankNum:  { fontSize: 20, fontWeight: 'bold' },
});

function PreviousWinnersBanner({ winners, onUserPress }: { winners: WeeklyWinner[]; onUserPress: (id: string) => void }) {
  if (winners.length === 0) return null;
  return (
    <View style={prevStyles.container}>
      <LinearGradient colors={['#1a1200', '#0d0d0d']} style={prevStyles.gradient}>
        <Text style={prevStyles.title}>🏆 Last Week's Champions</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={prevStyles.scroll}>
          {winners.map((winner) => {
            const cfg = RANK_CONFIG[winner.rank];
            return (
              <TouchableOpacity key={winner.user_id} style={[prevStyles.winner, { borderColor: cfg.color }]} onPress={() => onUserPress(winner.user_id)} activeOpacity={0.8}>
                <Text style={prevStyles.rankEmoji}>{cfg.emoji}</Text>
                {winner.avatar_url
                  ? <Image source={{ uri: winner.avatar_url }} style={[prevStyles.avatar, { borderColor: cfg.color }]} />
                  : <View style={[prevStyles.avatar, prevStyles.avatarFallback, { borderColor: cfg.color }]}><Feather name="user" size={16} color={cfg.color} /></View>}
                <Text style={[prevStyles.name, { color: cfg.color }]} numberOfLines={1}>{winner.display_name}</Text>
                <Text style={prevStyles.pts}>{winner.weekly_points.toLocaleString()} pts</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const prevStyles = StyleSheet.create({
  container:      { marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#FFD70033' },
  gradient:       { padding: 14 },
  title:          { color: '#FFD700', fontSize: 13, fontWeight: 'bold', marginBottom: 12 },
  scroll:         { gap: 10 },
  winner:         { alignItems: 'center', width: 80, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 10, borderWidth: 1.5 },
  rankEmoji:      { fontSize: 18, marginBottom: 4 },
  avatar:         { width: 44, height: 44, borderRadius: 22, borderWidth: 2, marginBottom: 6 },
  avatarFallback: { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  name:           { fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  pts:            { color: '#00ff88', fontSize: 10, marginTop: 3 },
});

export default function LeaderboardScreen() {
  const router = useRouter();
  const { t }  = useTranslation();
  const [users,           setUsers]           = useState<LeaderboardUser[]>([]);
  const [previousWinners, setPreviousWinners] = useState<WeeklyWinner[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [filter,          setFilter]          = useState<'week'|'month'|'all'>('week');

  useEffect(() => { loadLeaderboard(); loadPreviousWinners(); }, [filter]);

  const loadPreviousWinners = async () => {
    try {
      const now = new Date();
      const thisWeekStart = new Date(now);
      thisWeekStart.setDate(now.getDate() - now.getDay());
      thisWeekStart.setHours(0, 0, 0, 0);
      const { data } = await supabase.from('weekly_winners').select('*')
        .lt('week_start', thisWeekStart.toISOString())
        .order('week_start', { ascending: false }).order('rank', { ascending: true }).limit(3);
      if (data && data.length > 0) {
        const ids = data.map((w: any) => w.user_id);
        const { data: usersData } = await supabase.from('users').select('id, username, display_name, avatar_url').in('id', ids);
        const uMap = new Map(usersData?.map((u: any) => [u.id, u]) || []);
        const hydrated: WeeklyWinner[] = data.map((w: any) => {
          const u: any = uMap.get(w.user_id) || {};
          return { rank: w.rank, user_id: w.user_id, username: u.username || w.username, display_name: u.display_name || w.display_name, avatar_url: u.avatar_url || w.avatar_url, weekly_points: w.weekly_points, week_start: w.week_start };
        });
        setPreviousWinners(hydrated);
      }
    } catch (e) { console.error('Error loading previous winners:', e); }
  };

  const loadLeaderboard = async () => {
    setLoading(true);
    try {
      const orderColumn = filter === 'all' ? 'points' : 'weekly_points';
      const { data, error } = await supabase.from('users')
        .select('id, username, display_name, avatar_url, points, weekly_points')
        .order(orderColumn, { ascending: false }).limit(50);
      if (error) throw error;
      const rankedUsers: LeaderboardUser[] = (data || []).map((user: any, index: number) => ({
        id: user.id, username: user.username || 'unknown', display_name: user.display_name || 'Unknown',
        avatar_url: user.avatar_url || '', points: user.points || 0,
        weekly_points: user.weekly_points || 0, rank: index + 1,
      }));
      setUsers(rankedUsers);
    } catch (error) { console.error('Error loading leaderboard:', error); }
    finally { setLoading(false); }
  };

  const handleUserPress = (id: string) => router.push(`/user/${id}`);
  const getDisplayPoints = (user: LeaderboardUser) => filter === 'all' ? user.points : user.weekly_points;

  const renderUser = ({ item }: { item: LeaderboardUser }) => {
    const isTop3 = item.rank <= 3;
    const cfg = isTop3 ? RANK_CONFIG[item.rank as 1|2|3] : null;
    const pts = getDisplayPoints(item);
    return (
      <TouchableOpacity style={[styles.userItem, isTop3 && cfg ? { backgroundColor: cfg.glow, borderColor: cfg.color, borderWidth: 1 } : {}]} onPress={() => handleUserPress(item.id)} activeOpacity={0.8}>
        <View style={styles.rankContainer}>
          {isTop3 && cfg ? <Text style={styles.rankEmoji}>{cfg.emoji}</Text> : <Text style={styles.rankText}>#{item.rank}</Text>}
        </View>
        {item.avatar_url
          ? <Image source={{ uri: item.avatar_url }} style={[styles.avatar, isTop3 && cfg ? { borderWidth: 2, borderColor: cfg.color } : {}]} />
          : <View style={[styles.avatar, styles.avatarPlaceholder, isTop3 && cfg ? { borderWidth: 2, borderColor: cfg.color } : {}]}><Ionicons name="person" size={24} color={cfg?.color || '#00ff88'} /></View>}
        <View style={styles.userInfo}>
          <Text style={[styles.displayName, isTop3 && cfg ? { color: cfg.color } : {}]}>{item.display_name}</Text>
          <Text style={styles.username}>@{item.username}</Text>
        </View>
        <View style={[styles.pointsContainer, isTop3 && cfg ? { borderColor: cfg.color } : {}]}>
          <Text style={[styles.pointsValue, isTop3 && cfg ? { color: cfg.color } : {}]}>{pts.toLocaleString()}</Text>
          <Text style={styles.pointsLabel}>{t.leaderboard.pointsLabel}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const ListHeader = () => (
    <View>
      {previousWinners.length > 0 && <PreviousWinnersBanner winners={previousWinners} onUserPress={handleUserPress} />}
      {filter !== 'all' && <View style={styles.countdownWrapper}><CountdownTimer /></View>}
      {users.length >= 1 && <TopThreePodium winners={users} onUserPress={handleUserPress} filter={filter} />}
      <View style={styles.listDivider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Full Rankings</Text>
        <View style={styles.dividerLine} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🏆 {t.leaderboard.title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterContainer}>
        {(['week', 'month', 'all'] as const).map((f) => (
          <TouchableOpacity key={f} style={[styles.filterTab, filter === f && styles.filterTabActive]} onPress={() => setFilter(f)} activeOpacity={0.8}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'week' ? 'This Week' : f === 'month' ? 'This Month' : 'All Time'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#00ff88" />
          <Text style={styles.loadingText}>{t.common.loading}</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          renderItem={renderUser}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t.explore.noResults}</Text>
              <Text style={styles.emptySubtext}>Be the first to earn points!</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  backBtn:          { padding: 4 },
  headerTitle:      { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  filterContainer:  { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  filterTab:        { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  filterTabActive:  { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  filterText:       { fontSize: 13, fontWeight: '600', color: '#666' },
  filterTextActive: { color: '#000' },
  centerContainer:  { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText:      { color: '#666', fontSize: 14 },
  countdownWrapper: { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#0a0a0a', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a', paddingVertical: 12 },
  listDivider:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, gap: 10 },
  dividerLine:      { flex: 1, height: 1, backgroundColor: '#1a1a1a' },
  dividerText:      { color: '#555', fontSize: 11, fontWeight: '600' },
  listContainer:    { paddingBottom: 40, paddingTop: 16 },
  userItem:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, marginHorizontal: 16, marginBottom: 6, borderRadius: 12, backgroundColor: '#0a0a0a', borderWidth: 1, borderColor: '#1a1a1a' },
  rankContainer:    { width: 36, alignItems: 'center' },
  rankEmoji:        { fontSize: 22 },
  rankText:         { fontSize: 14, fontWeight: 'bold', color: '#555' },
  avatar:           { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder:{ backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  userInfo:         { flex: 1 },
  displayName:      { fontSize: 15, fontWeight: '600', color: '#fff' },
  username:         { fontSize: 13, color: '#666', marginTop: 2 },
  pointsContainer:  { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a', minWidth: 60 },
  pointsValue:      { fontSize: 14, fontWeight: 'bold', color: '#00ff88' },
  pointsLabel:      { fontSize: 9, color: '#555', marginTop: 1 },
  emptyContainer:   { alignItems: 'center', paddingTop: 60 },
  emptyText:        { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySubtext:     { color: '#666', fontSize: 14, marginTop: 8 },
}); 
