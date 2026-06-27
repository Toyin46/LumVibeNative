// app/(tabs)/videos.tsx — LUMVIBE VIDEO FEED
// ✅ Bare workflow — react-native-video replaces expo-av Video
// ✅ Immerse mode removed completely
// ✅ Watermark + filters + effects baked into saved file via FFmpegKit fork
// ✅ Co-Watch button + AI Match Me entry added to right action bar
// ✅ Vibe Room tab + button added
// ✅ Ad + winner card double-injection fixed, badge multiplier fixed
// ✅ Both gift handlers do fresh DB read, loadVideos uses Promise.all
// ✅ ALGORITHM v2: saves, virality ratio, location boost, gentle decay
// ✅ FIXED: increment_coins RPC used for receiver
// ✅ FIXED: Replay uses react-native-video API (seek + setIsPlaying)
// ✅ ADDED: Three-dot menu with Report, Save, Share
// ✅ ADDED: Full report system with 9 categories saved to Supabase
// ✅ ADDED: Empty feed state (no blank black screen)
// ✅ FIXED: areEqual comparator cleaned up

import React, { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity, Dimensions,
  ActivityIndicator, Alert, Modal, TextInput, Share, ScrollView, Animated,
  PanResponder, GestureResponderEvent, RefreshControl, Platform, Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Video from 'react-native-video';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../config/supabase';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTranslation } from '../locales/LanguageContext';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';

const { width, height } = Dimensions.get('window');

async function fetchWithTimeout(input: RequestInfo, init?: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    clearTimeout(timer); return res;
  } catch (e) { clearTimeout(timer); throw e; }
}

function cdnVideoUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (url.includes('cloudinary.com') && url.includes('/upload/') && !url.includes('q_auto')) {
    const idx = url.indexOf('/upload/');
    return url.slice(0, idx + 8) + 'q_auto,vc_auto/' + url.slice(idx + 8);
  }
  return url;
}

export const PAYSTACK_PUBLIC_KEY = 'pk_test_e621a586c2029ce1345fd07fcb8d454882a4098c';
export const PAYSTACK_TEST_MODE  = true;

const POINTS_PER_VIEW    = 2;
const POINTS_PER_LIKE    = 10;
const POINTS_PER_COMMENT = 15;
const POINTS_PER_SHARE   = 30;

const FEED_SETTINGS = {
  windowSize: 2,
  maxToRenderPerBatch: 1,
  initialNumToRender: 1,
  updateCellsBatchingPeriod: 200,
  itemVisiblePercentThreshold: 60,
};

async function getOwnerBadgeMultipliers(ownerId: string) {
  try {
    const { data } = await supabase.from('user_badges').select('badge_id').eq('user_id', ownerId);
    const badges = new Set(data?.map((b: any) => b.badge_id) || []);
    return {
      viewPoints:    badges.has('early_adopter') ? 4  : 2,
      likePoints:    badges.has('followers_100') ? 15 : 10,
      commentPoints: badges.has('streak_30')     ? 20 : 15,
      sharePoints:   badges.has('posts_10')      ? 40 : 30,
    };
  } catch {
    return { viewPoints: 2, likePoints: 10, commentPoints: 15, sharePoints: 30 };
  }
}

const COIN_TO_NGN = 150;
function coinsToNGN(coins: number): string {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}

const CURRENCY_BY_TIMEZONE: Record<string, { code: string; symbol: string; rateFromNgn: number; decimals: number }> = {
  'Africa/Lagos':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        decimals: 0 },
  'Africa/Abuja':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        decimals: 0 },
  'Africa/Accra':        { code: 'GHS', symbol: 'GH₵', rateFromNgn: 0.0067,   decimals: 2 },
  'Africa/Nairobi':      { code: 'KES', symbol: 'KSh', rateFromNgn: 0.087,    decimals: 0 },
  'Africa/Johannesburg': { code: 'ZAR', symbol: 'R',   rateFromNgn: 0.012,    decimals: 2 },
  'Africa/Cairo':        { code: 'EGP', symbol: 'E£',  rateFromNgn: 0.033,    decimals: 2 },
  'Europe/London':       { code: 'GBP', symbol: '£',   rateFromNgn: 0.000533, decimals: 2 },
  'Europe/Paris':        { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, decimals: 2 },
  'Europe/Berlin':       { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, decimals: 2 },
  'America/New_York':    { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, decimals: 2 },
  'America/Chicago':     { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, decimals: 2 },
  'America/Los_Angeles': { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, decimals: 2 },
  'America/Toronto':     { code: 'CAD', symbol: 'CA$', rateFromNgn: 0.000917, decimals: 2 },
  'Asia/Dubai':          { code: 'AED', symbol: 'د.إ', rateFromNgn: 0.00245,  decimals: 2 },
  'Asia/Kolkata':        { code: 'INR', symbol: '₹',   rateFromNgn: 0.0557,   decimals: 0 },
  'Asia/Tokyo':          { code: 'JPY', symbol: '¥',   rateFromNgn: 0.10,     decimals: 0 },
  'Asia/Shanghai':       { code: 'CNY', symbol: '¥',   rateFromNgn: 0.00484,  decimals: 2 },
  'Asia/Singapore':      { code: 'SGD', symbol: 'S$',  rateFromNgn: 0.000894, decimals: 2 },
  'Australia/Sydney':    { code: 'AUD', symbol: 'A$',  rateFromNgn: 0.001033, decimals: 2 },
};
const DEFAULT_GIFT_CURRENCY = { code: 'USD', symbol: '$', rateFromNgn: 0.000667, decimals: 2 };

function detectGiftCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CURRENCY_BY_TIMEZONE[tz]) return CURRENCY_BY_TIMEZONE[tz];
    const continent = tz.split('/')[0];
    const match = Object.entries(CURRENCY_BY_TIMEZONE).find(([key]) => key.startsWith(continent));
    if (match) return match[1];
  } catch {}
  return DEFAULT_GIFT_CURRENCY;
}

function giftLocalPrice(ngnAmount: number): string {
  const cur = detectGiftCurrency();
  const localAmount = ngnAmount * cur.rateFromNgn;
  if (cur.decimals === 0) return `${cur.symbol}${Math.round(localAmount).toLocaleString()}`;
  return `${cur.symbol}${localAmount.toLocaleString(undefined, { minimumFractionDigits: cur.decimals, maximumFractionDigits: cur.decimals })}`;
}

const BANNER_AD_UNIT_ID = __DEV__ ? TestIds.BANNER : 'ca-app-pub-8235065812461074/4176727692';

const GIFT_PACKAGES = [
  { id: 'rose',        name: 'Rose',        icon: '🌹', coins: 10,    ngn: 1_500,   color: '#ff69b4' },
  { id: 'ice_cream',   name: 'Ice Cream',   icon: '🍦', coins: 50,    ngn: 7_500,   color: '#00bfff' },
  { id: 'love_letter', name: 'Love Letter', icon: '💌', coins: 100,   ngn: 15_000,  color: '#ff4d8f' },
  { id: 'trophy',      name: 'Trophy',      icon: '🏆', coins: 500,   ngn: 75_000,  color: '#cd7f32' },
  { id: 'crown',       name: 'Crown',       icon: '👑', coins: 1000,  ngn: 150_000, color: '#ffd700' },
  { id: 'diamond',     name: 'Diamond',     icon: '💎', coins: 5000,  ngn: 750_000, color: '#00ffff' },
];

const VIDEO_EFFECTS: Record<string, { label: string; tint?: string; badge?: string; badgeColor?: string; rate?: number }> = {
  none:      { label: 'Normal' },
  slow_025:  { label: '0.25x Slow',  badge: '🐌 0.25x',     badgeColor: '#00bfff', rate: 0.25 },
  slow_05:   { label: '0.5x Slow',   badge: '🐢 0.5x',      badgeColor: '#00bfff', rate: 0.5  },
  fast_15:   { label: '1.5x Fast',   badge: '⚡ 1.5x',      badgeColor: '#ffd700', rate: 1.5  },
  fast_2:    { label: '2x Fast',     badge: '🚀 2x',        badgeColor: '#ff4444', rate: 2.0  },
  blur:      { label: 'Blur',        tint: 'rgba(255,255,255,0.12)', badge: '🌫️ Blur',     badgeColor: '#aaa'    },
  beauty:    { label: 'Beauty',      tint: 'rgba(255,200,200,0.18)', badge: '✨ Beauty',   badgeColor: '#ff69b4' },
  vintage:   { label: 'Vintage',     tint: 'rgba(180,120,60,0.25)',  badge: '📷 Vintage',  badgeColor: '#cd7f32' },
  cool:      { label: 'Cool',        tint: 'rgba(100,180,255,0.22)', badge: '❄️ Cool',     badgeColor: '#00bfff' },
  warm:      { label: 'Warm',        tint: 'rgba(255,160,50,0.22)',  badge: '🔥 Warm',     badgeColor: '#ff8c00' },
  dramatic:  { label: 'Dramatic',    tint: 'rgba(0,0,0,0.35)',       badge: '🎭 Dramatic', badgeColor: '#888'    },
  bright:    { label: 'Bright',      tint: 'rgba(255,255,200,0.18)', badge: '☀️ Bright',   badgeColor: '#ffd700' },
  noir:      { label: 'Noir',        tint: 'rgba(0,0,0,0.5)',        badge: '🖤 Noir',     badgeColor: '#fff'    },
  neon:      { label: 'Neon',        tint: 'rgba(0,255,136,0.2)',    badge: '💚 Neon',     badgeColor: '#00ff88' },
  sunset:    { label: 'Sunset',      tint: 'rgba(255,80,80,0.25)',   badge: '🌅 Sunset',   badgeColor: '#ff6b35' },
  cinematic: { label: 'Cinematic',   tint: 'rgba(20,10,40,0.45)',    badge: '🎬 Cinematic',badgeColor: '#9b59b6' },
  golden:    { label: 'Golden',      tint: 'rgba(255,200,50,0.28)',  badge: '✨ Golden',   badgeColor: '#ffd700' },
  rose:      { label: 'Rose',        tint: 'rgba(255,80,120,0.25)',  badge: '🌸 Rose',     badgeColor: '#ff4d8f' },
  matrix:    { label: 'Matrix',      tint: 'rgba(0,80,20,0.4)',      badge: '💻 Matrix',   badgeColor: '#00ff00' },
  midnight:  { label: 'Midnight',    tint: 'rgba(10,10,60,0.45)',    badge: '🌙 Midnight', badgeColor: '#4444ff' },
  desert:    { label: 'Desert',      tint: 'rgba(200,120,30,0.3)',   badge: '🏜️ Desert',   badgeColor: '#e67e22' },
};

const VIBE_TYPES: Record<string, { label: string; emoji: string; color: string }> = {
  fire:     { label: 'Fire',       emoji: '🔥', color: '#ff4500' },
  funny:    { label: 'Funny',      emoji: '😂', color: '#ffd700' },
  shocking: { label: 'Shocking',   emoji: '😱', color: '#ff6b35' },
  love:     { label: 'Love',       emoji: '❤️', color: '#ff1744' },
  mindblow: { label: 'Mind-blown', emoji: '🤯', color: '#aa00ff' },
  dead:     { label: 'Dead 💀',    emoji: '💀', color: '#00e5ff' },
  hype:     { label: 'Hype',       emoji: '🚀', color: '#00ff88' },
  sad:      { label: 'Sad',        emoji: '😢', color: '#448aff' },
};

// ─── REPORT CATEGORIES ────────────────────────────────────────────────────────
const REPORT_CATEGORIES = [
  { id: 'spam',        label: 'Spam or Misleading',              icon: '🚫' },
  { id: 'nudity',      label: 'Nudity or Sexual Content',        icon: '🔞' },
  { id: 'hate',        label: 'Hate Speech or Discrimination',   icon: '💢' },
  { id: 'violence',    label: 'Violence or Dangerous Acts',      icon: '⚠️' },
  { id: 'harassment',  label: 'Harassment or Bullying',          icon: '👤' },
  { id: 'copyright',   label: 'Copyright Violation',             icon: '©️' },
  { id: 'minor',       label: 'Involves a Minor Inappropriately',icon: '🧒' },
  { id: 'illegal',     label: 'Illegal Activity',                icon: '🔫' },
  { id: 'other',       label: 'Other',                           icon: '📋' },
];

// ─── INTERFACES ───────────────────────────────────────────────────────────────
interface Post {
  id: string; user_id: string; username: string; display_name: string;
  user_photo_url?: string; media_url?: string; caption: string;
  likes_count: number; comments_count: number; views_count: number;
  coins_received: number; liked_by: string[]; location?: string;
  music_name?: string; music_artist?: string;
  music_url?: string | null; voice_duration?: number | null;
  applied_filter?: string;
  created_at: string; has_watermark?: boolean; watermarked_url?: string | null; _score?: number;
  video_effect?: string; video_filter_tint?: string; playback_rate?: number;
  vibe_type?: string | null;
  vibe_room_id?: string | null;
}

interface VibeRoomPreview {
  id: string;
  post_id: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
  scheduled_for: string;
  viewer_count: number;
}
interface Comment {
  id: string; post_id: string; user_id: string; username: string;
  display_name: string; user_photo_url?: string; text: string;
  likes_count: number; replies_count: number; liked_by: string[];
  parent_comment_id?: string; created_at: string;
  parent_comment?: { username: string; display_name: string; text: string };
}
interface AdItem        { id: string; isAd: true; adIndex: number }
interface WeeklyWinner  { rank: 1|2|3; user_id: string; username: string; display_name: string; avatar_url?: string; weekly_points: number; week_start: string }
interface WinnerCardItem { id: string; isWinnerCard: true; winners: WeeklyWinner[] }
type FeedItem = Post | AdItem | WinnerCardItem;
function isAd(item: FeedItem): item is AdItem { return 'isAd' in item && (item as AdItem).isAd === true; }
function isWinnerCard(item: FeedItem): item is WinnerCardItem { return 'isWinnerCard' in item && (item as WinnerCardItem).isWinnerCard === true; }

// ─── ALGORITHM v2 ─────────────────────────────────────────────────────────────
function computeVideoScore(
  post: Post,
  followingSet: Set<string>,
  authorFollowers: number,
  viewerCity?: string,
): number {
  const ageHours    = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);
  const decayFactor = 1 / (1 + Math.pow(ageHours, 0.8) * 0.08);
  const rawEngagement =
    post.coins_received * 50 +
    post.comments_count * 5  +
    post.likes_count    * 2  +
    post.views_count    * 0.5;
  const effectiveViews    = Math.max(post.views_count, 10);
  const engagementActions = post.likes_count + post.comments_count + (post.coins_received > 0 ? 1 : 0);
  const viralityRatio     = engagementActions / effectiveViews;
  const viralityBoost     = 1 + Math.min(viralityRatio * 8, 1.0);
  const freshnessBurst = ageHours < 1 ? 35 : ageHours < 2 ? 25 : ageHours < 3 ? 15 : 0;
  const followingBoost = followingSet.has(post.user_id) ? 1.6 : 1.0;
  const newCreatorBoost = authorFollowers < 500
    ? 1.0 + (0.5 * (1 - authorFollowers / 500))
    : 1.0;
  let locationBoost = 1.0;
  if (viewerCity && post.location) {
    const vc = viewerCity.toLowerCase();
    const pl = post.location.toLowerCase();
    if (pl.includes(vc) || vc.includes(pl)) locationBoost = 1.4;
  }
  const giftAuthorityBoost = post.coins_received > 0
    ? 1.0 + Math.min(Math.log10(post.coins_received + 1) * 0.15, 0.4)
    : 1.0;
  return (
    (rawEngagement * decayFactor + freshnessBurst)
    * viralityBoost
    * followingBoost
    * newCreatorBoost
    * locationBoost
    * giftAuthorityBoost
  );
}

const RANK_CONFIG = {
  1: { emoji: '🥇', color: '#FFD700', label: '1st Place', glow: '#FFD70044' },
  2: { emoji: '🥈', color: '#C0C0C0', label: '2nd Place', glow: '#C0C0C044' },
  3: { emoji: '🥉', color: '#CD7F32', label: '3rd Place', glow: '#CD7F3244' },
};

// ─── SEEK BAR ─────────────────────────────────────────────────────────────────
function VideoSeekBar({ positionMs, durationMs, onSeek, isVisible }: {
  positionMs: number; durationMs: number; onSeek: (ms: number) => void; isVisible: boolean;
}) {
  const BAR_PADDING = 16;
  const BAR_WIDTH   = width - BAR_PADDING * 2;
  const THUMB_HALF  = 8;
  const [dragging,     setDragging]     = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const barOriginX = useRef(BAR_PADDING);
  const barRef     = useRef<View>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pageXToProgress = (pageX: number) => { const x = clamp(pageX - barOriginX.current, 0, BAR_WIDTH); return x / BAR_WIDTH; };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      barRef.current?.measureInWindow((x: number) => { barOriginX.current = x; });
      const p = pageXToProgress(e.nativeEvent.pageX); setDragging(true); setDragProgress(p);
    },
    onPanResponderMove: (e: GestureResponderEvent) => { setDragProgress(pageXToProgress(e.nativeEvent.pageX)); },
    onPanResponderRelease: (e: GestureResponderEvent) => {
      const p = pageXToProgress(e.nativeEvent.pageX); setDragging(false); setDragProgress(p); onSeek(p * durationMs);
    },
    onPanResponderTerminate: () => { setDragging(false); },
  })).current;
  if (!isVisible) return null;
  const liveProgress = durationMs > 0 ? clamp(positionMs / durationMs, 0, 1) : 0;
  const displayProg  = dragging ? dragProgress : liveProgress;
  const thumbLeft    = displayProg * BAR_WIDTH - THUMB_HALF;
  const formatTime = (ms: number) => {
    if (!ms || isNaN(ms) || ms < 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`;
  };
  const remainingMs = Math.max(0, durationMs - positionMs);
  return (
    <View style={seekStyles.container}>
      <View style={seekStyles.timeRow}>
        <Text style={seekStyles.timeText}>{formatTime(positionMs)}</Text>
        <Text style={seekStyles.timeText}>-{formatTime(remainingMs)}</Text>
      </View>
      <View ref={barRef} style={seekStyles.barHitArea} onLayout={() => { barRef.current?.measureInWindow((x: number) => { barOriginX.current = x; }); }} {...panResponder.panHandlers}>
        <View style={seekStyles.track} />
        <View style={[seekStyles.fill, { width: clamp(displayProg * BAR_WIDTH, 0, BAR_WIDTH), backgroundColor: '#00ff88' }]} />
        <View style={[seekStyles.thumb, { left: clamp(thumbLeft, -THUMB_HALF, BAR_WIDTH - THUMB_HALF), backgroundColor: '#ffffff' }]} />
      </View>
    </View>
  );
}

const seekStyles = StyleSheet.create({
  container:  { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 6, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 20 },
  timeRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  timeText:   { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  barHitArea: { height: 28, justifyContent: 'center' },
  track:      { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2 },
  fill:       { position: 'absolute', left: 0, height: 3, borderRadius: 2 },
  thumb:      { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.6, shadowRadius: 3, elevation: 5 },
});

// ─── WEEKLY WINNERS ───────────────────────────────────────────────────────────
const WinnersVideoOverlay = memo(function WinnersVideoOverlay({ winners, onUserPress, onDismiss }: { winners: WeeklyWinner[]; onUserPress: (id: string) => void; onDismiss: () => void }) {
  if (winners.length === 0) return null;
  return (
    <View style={winnerStyles.overlay}>
      <LinearGradient colors={['rgba(0,0,0,0.92)', 'rgba(26,18,0,0.96)', 'rgba(0,0,0,0.92)']} style={winnerStyles.overlayGradient}>
        <View style={winnerStyles.overlayHeader}>
          <Text style={winnerStyles.overlayTitle}>🏆 This Week's Top Creators</Text>
          <TouchableOpacity onPress={onDismiss} style={winnerStyles.dismissBtn}><Feather name="x" size={18} color="#888" /></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={winnerStyles.overlayScroll}>
          {winners.map((winner) => {
            const cfg = RANK_CONFIG[winner.rank];
            return (
              <TouchableOpacity key={winner.user_id} style={[winnerStyles.overlayWinner, { borderColor: cfg.color }]} onPress={() => onUserPress(winner.user_id)} activeOpacity={0.8}>
                <View style={[winnerStyles.rankBadge, { backgroundColor: cfg.color }]}><Text style={winnerStyles.rankBadgeText}>{cfg.emoji}</Text></View>
                {winner.avatar_url ? <Image source={{ uri: winner.avatar_url }} style={[winnerStyles.overlayAvatar, { borderColor: cfg.color }]} /> : <View style={[winnerStyles.overlayAvatar, winnerStyles.avatarFallback, { borderColor: cfg.color }]}><Feather name="user" size={20} color={cfg.color} /></View>}
                <Text style={[winnerStyles.overlayName, { color: cfg.color }]} numberOfLines={1}>{winner.display_name}</Text>
                <Text style={winnerStyles.overlayUsername} numberOfLines={1}>@{winner.username}</Text>
                <Text style={winnerStyles.overlayPoints}>{winner.weekly_points.toLocaleString()} pts</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={winnerStyles.overlayFooter}>Post +50 · View +2 · Like +10 · Comment +15 · Share +30 · Resets Sunday</Text>
      </LinearGradient>
    </View>
  );
});

const WinnerCardVideo = memo(function WinnerCardVideo({ winners, onUserPress }: { winners: WeeklyWinner[]; onUserPress: (id: string) => void }) {
  const { t } = useTranslation();
  if (winners.length === 0) return null;
  return (
    <View style={[styles.videoContainer, { backgroundColor: '#050505' }]}>
      <LinearGradient colors={['#0d0d0d', '#1a1200', '#0d0d0d']} style={winnerStyles.cardGradient}>
        <View style={winnerStyles.cardHeader}>
          <Text style={winnerStyles.cardTitle}>🏆 {t.videos.weeklyChampions}</Text>
          <Text style={winnerStyles.cardSub}>{t.videos.weeklyChampionsSub}</Text>
        </View>
        {winners.map((winner) => {
          const cfg = RANK_CONFIG[winner.rank];
          return (
            <TouchableOpacity key={winner.user_id} style={[winnerStyles.cardRow, { backgroundColor: cfg.glow }]} onPress={() => onUserPress(winner.user_id)} activeOpacity={0.8}>
              <Text style={[winnerStyles.cardRank, { color: cfg.color }]}>{cfg.emoji}</Text>
              {winner.avatar_url ? <Image source={{ uri: winner.avatar_url }} style={[winnerStyles.cardAvatar, { borderColor: cfg.color }]} /> : <View style={[winnerStyles.cardAvatar, winnerStyles.avatarFallback, { borderColor: cfg.color }]}><Feather name="user" size={16} color={cfg.color} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={winnerStyles.cardName} numberOfLines={1}>{winner.display_name}</Text>
                <Text style={winnerStyles.cardUsername}>@{winner.username}</Text>
              </View>
              <View style={[winnerStyles.cardPoints, { borderColor: cfg.color }]}>
                <Text style={[winnerStyles.cardPointsNum, { color: cfg.color }]}>{winner.weekly_points.toLocaleString()}</Text>
                <Text style={winnerStyles.cardPointsLabel}>pts</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <Text style={winnerStyles.cardFooter}>🔄 {t.videos.resetsInfo}</Text>
      </LinearGradient>
    </View>
  );
});

const winnerStyles = StyleSheet.create({
  overlay:         { position: 'absolute', top: 80, left: 0, right: 0, zIndex: 100 },
  overlayGradient: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#FFD70033' },
  overlayHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  overlayTitle:    { color: '#FFD700', fontSize: 14, fontWeight: 'bold' },
  dismissBtn:      { padding: 4 },
  overlayScroll:   { paddingHorizontal: 16, gap: 12 },
  overlayWinner:   { alignItems: 'center', width: 90, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 10, borderWidth: 1.5 },
  rankBadge:       { position: 'absolute', top: -10, right: -6, width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  rankBadgeText:   { fontSize: 12 },
  overlayAvatar:   { width: 50, height: 50, borderRadius: 25, borderWidth: 2, marginBottom: 6 },
  avatarFallback:  { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  overlayName:     { fontSize: 11, fontWeight: 'bold', textAlign: 'center', maxWidth: 80 },
  overlayUsername: { color: '#888', fontSize: 10, textAlign: 'center', marginTop: 2 },
  overlayPoints:   { color: '#00ff88', fontSize: 10, fontWeight: '600', marginTop: 4 },
  overlayFooter:   { color: '#00ff8866', fontSize: 10, textAlign: 'center', marginTop: 12, paddingHorizontal: 16, fontWeight: '600' },
  cardGradient:    { flex: 1, justifyContent: 'center', padding: 24, borderWidth: 1, borderColor: '#FFD70022' },
  cardHeader:      { marginBottom: 24, alignItems: 'center' },
  cardTitle:       { color: '#FFD700', fontSize: 22, fontWeight: 'bold' },
  cardSub:         { color: '#666', fontSize: 13, marginTop: 6, textAlign: 'center' },
  cardRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, marginBottom: 10 },
  cardRank:        { fontSize: 28, width: 36, textAlign: 'center' },
  cardAvatar:      { width: 52, height: 52, borderRadius: 26, borderWidth: 2 },
  cardName:        { color: '#fff', fontSize: 15, fontWeight: '700' },
  cardUsername:    { color: '#666', fontSize: 13, marginTop: 2 },
  cardPoints:      { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  cardPointsNum:   { fontSize: 15, fontWeight: 'bold' },
  cardPointsLabel: { color: '#888', fontSize: 9, marginTop: 1 },
  cardFooter:      { color: '#00ff8866', fontSize: 10, textAlign: 'center', marginTop: 20, fontWeight: '600' },
});

// ─── AD POST ──────────────────────────────────────────────────────────────────
const NATIVE_AD_SLOTS = [
  {
    advertiser: 'LumVibe Premium',
    username:   'lumvibe',
    avatar:     null as null,
    caption:    '🚀 Unlock Premium — no ads, exclusive badges & more. Upgrade today!',
    gradient:   ['#0d0d0d', '#001a0d', '#0d0d0d'] as const,
    accentColor:'#00ff88',
    ctaLabel:   'Get Premium',
    ctaRoute:   '/buy-coins',
    bgEmoji:    '💎',
  },
  {
    advertiser: 'LumVibe Coins',
    username:   'lumvibe',
    avatar:     null as null,
    caption:    '🎁 Top up your coins and send gifts to your favourite creators!',
    gradient:   ['#0d0d0d', '#1a0d00', '#0d0d0d'] as const,
    accentColor:'#ffd700',
    ctaLabel:   'Buy Coins',
    ctaRoute:   '/buy-coins',
    bgEmoji:    '🪙',
  },
  {
    advertiser: 'LumVibe Creator Fund',
    username:   'lumvibe',
    avatar:     null as null,
    caption:    '✨ Join thousands of creators earning real money on LumVibe. Start posting now!',
    gradient:   ['#0d0d0d', '#0d001a', '#0d0d0d'] as const,
    accentColor:'#a855f7',
    ctaLabel:   'Start Creating',
    ctaRoute:   '/(tabs)/create',
    bgEmoji:    '🎬',
  },
];

function NativeAdPost({ adIndex }: { adIndex: number }) {
  const navigation = useNavigation<any>();
  const slot    = NATIVE_AD_SLOTS[adIndex % NATIVE_AD_SLOTS.length];
  const [adLoaded, setAdLoaded] = useState(false);
  const [adError,  setAdError]  = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.videoContainer}>
      <LinearGradient colors={slot.gradient} style={StyleSheet.absoluteFillObject} />
      <View style={nativeAdStyles.bgEmojiWrap} pointerEvents="none">
        <Animated.Text style={[nativeAdStyles.bgEmoji, { transform: [{ scale: pulseAnim }] }]}>
          {slot.bgEmoji}
        </Animated.Text>
      </View>
      <View style={nativeAdStyles.bannerAdContainer}>
        <Text style={nativeAdStyles.bannerAdLabel}>Advertisement</Text>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: false }}
          onAdLoaded={() => { setAdLoaded(true); setAdError(false); }}
          onAdFailedToLoad={() => setAdError(true)}
        />
        {adError && <Text style={nativeAdStyles.adErrorText}>Ad unavailable</Text>}
      </View>
      <View style={nativeAdStyles.sponsoredPill}>
        <Text style={nativeAdStyles.sponsoredText}>📢 Promoted by LumVibe</Text>
      </View>
      <View style={nativeAdStyles.promoCentre}>
        <Text style={nativeAdStyles.promoEmoji}>{slot.bgEmoji}</Text>
        <Text style={nativeAdStyles.promoTitle}>{slot.advertiser}</Text>
        <Text style={nativeAdStyles.promoCaption}>{slot.caption}</Text>
        <TouchableOpacity
          style={[nativeAdStyles.ctaButton, { backgroundColor: slot.accentColor }]}
          onPress={() => navigation.navigate(slot.ctaRoute.replace('/(tabs)/', '').replace('/', '') as any)}
          activeOpacity={0.8}
        >
          <Text style={nativeAdStyles.ctaButtonText}>{slot.ctaLabel} →</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.videoInfo}>
        <View style={styles.userInfoOverlay}>
          <View style={styles.userInfoContent}>
            <View style={[styles.videoUserAvatar, styles.avatarPlaceholder, { borderColor: slot.accentColor }]}>
              <MaterialCommunityIcons name="storefront-outline" size={20} color={slot.accentColor} />
            </View>
            <View style={styles.videoUserDetails}>
              <Text style={styles.videoDisplayName}>{slot.advertiser}</Text>
              <Text style={styles.videoUsername}>@{slot.username}</Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const nativeAdStyles = StyleSheet.create({
  bgEmojiWrap:       { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  bgEmoji:           { fontSize: 160, opacity: 0.10 },
  bannerAdContainer: { position: 'absolute', top: 52, left: 0, right: 0, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 8, zIndex: 20, borderBottomWidth: 1, borderBottomColor: '#222' },
  bannerAdLabel:     { color: 'rgba(255,255,255,0.55)', fontSize: 10, marginBottom: 4, letterSpacing: 0.5, fontWeight: '600' },
  adErrorText:       { color: '#555', fontSize: 10, marginTop: 4 },
  sponsoredPill:     { position: 'absolute', top: 140, left: 16, zIndex: 15, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' },
  sponsoredText:     { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  promoCentre:       { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingTop: 40 },
  promoEmoji:        { fontSize: 64, marginBottom: 16 },
  promoTitle:        { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  promoCaption:      { color: 'rgba(255,255,255,0.75)', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  ctaButton:         { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 24 },
  ctaButtonText:     { color: '#000', fontSize: 15, fontWeight: '800' },
});

// ─── VIDEO POST ───────────────────────────────────────────────────────────────
const VideoPost = memo(function VideoPost({
  item, activePostId, onLike, onComment, onGift, onFollow, onUserPress, onShare, onSaveMedia, onDelete, onReport, user, onView, followStatusMap,
  vibeRoomMap,
}: {
  item: Post; activePostId: string | null; onLike: (post: Post) => void; onComment: (post: Post) => void;
  onGift: (post: Post) => void; onFollow: (userId: string, isFollowing: boolean) => Promise<void>;
  onUserPress: (userId: string) => void; onShare: (post: Post) => void; onSaveMedia: (post: Post) => void;
  onDelete: (post: Post) => void; onReport: (post: Post) => void;
  user: any; onView: (postId: string) => void; followStatusMap: Map<string, boolean>;
  vibeRoomMap: Map<string, VibeRoomPreview>;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const isActive  = activePostId === item.id;
  const [isPlaying,        setIsPlaying]        = useState(false);
  const [isMuted,          setIsMuted]          = useState(false);
  const [checkingFollow,   setCheckingFollow]   = useState(false);
  const [positionMs,       setPositionMs]       = useState(0);
  const [durationMs,       setDurationMs]       = useState(0);
  const [shouldLoad,       setShouldLoad]       = useState(false);
  const [showEndScreen,    setShowEndScreen]    = useState(false);
  // ✅ NEW: three-dot menu state
  const [menuVisible,      setMenuVisible]      = useState(false);

  const isFollowing  = followStatusMap.get(item.user_id) || false;
  const videoRef     = useRef<any>(null);
  const viewedRef    = useRef(false);
  const userId       = user?.id || (user as any)?.id;
  const isLiked      = userId ? item.liked_by?.includes(userId) : false;
  const isOwnPost    = userId === item.user_id;

  const vibeRoom = vibeRoomMap.get(item.id) || null;

  const effectKey        = item.video_effect || 'none';
  const effectInfo       = VIDEO_EFFECTS[effectKey] || VIDEO_EFFECTS['none'];
  const FILTER_TINT_MAP: Record<string, string> = {
    beauty: 'rgba(255,200,200,0.18)', vintage: 'rgba(180,120,60,0.25)',
    cool: 'rgba(100,180,255,0.22)',   warm: 'rgba(255,160,50,0.22)',
    dramatic: 'rgba(0,0,0,0.35)',     bright: 'rgba(255,255,200,0.18)',
    noir: 'rgba(0,0,0,0.5)',          neon: 'rgba(0,255,136,0.2)',
    sunset: 'rgba(255,80,80,0.25)',   cinematic: 'rgba(20,10,40,0.45)',
    golden: 'rgba(255,200,50,0.22)',  rose: 'rgba(255,100,150,0.22)',
    glitch: 'rgba(255,0,80,0.15)',
  };
  const tintColor =
    item.video_filter_tint ||
    effectInfo.tint ||
    (item.applied_filter && item.applied_filter !== 'original' ? FILTER_TINT_MAP[item.applied_filter] || null : null) ||
    null;
  const playbackRate     = item.playback_rate ?? effectInfo.rate ?? 1.0;
  const effectBadge      = effectInfo.badge || null;
  const effectBadgeColor = effectInfo.badgeColor || '#fff';

  // Animated watermark — moves to 4 corners
  const wmX       = useRef(new Animated.Value(16)).current;
  const wmY       = useRef(new Animated.Value(height * 0.55)).current;
  const wmOpacity = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    if (!item.media_url) return;
    const W = width - 160;
    const positions = [{ x: 16, y: height * 0.55 }, { x: W, y: height * 0.55 }, { x: 16, y: height * 0.25 }, { x: W, y: height * 0.25 }];
    let idx = 0; let active = true;
    const next = () => {
      if (!active) return;
      idx = (idx + 1) % 4;
      Animated.parallel([
        Animated.timing(wmOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(wmX, { toValue: positions[idx].x, duration: 300, useNativeDriver: true }),
        Animated.timing(wmY, { toValue: positions[idx].y, duration: 300, useNativeDriver: true }),
      ]).start(() => {
        if (!active) return;
        Animated.timing(wmOpacity, { toValue: 0.85, duration: 300, useNativeDriver: true })
          .start(() => { if (active) setTimeout(next, 3500); });
      });
    };
    const timer = setTimeout(next, 3500);
    return () => { active = false; clearTimeout(timer); };
  }, [item.id]);

  useEffect(() => {
    if (isActive) {
      setShouldLoad(true);
      if (!viewedRef.current) { viewedRef.current = true; onView(item.id); }
      const t = setTimeout(() => { setIsPlaying(true); }, 50);
      return () => clearTimeout(t);
    } else {
      setIsPlaying(false);
      setShowEndScreen(false);
    }
  }, [isActive]);

  // ✅ react-native-video callbacks
  const handleLoad = useCallback((data: any) => {
    if (data?.duration) setDurationMs(data.duration * 1000);
  }, []);

  const lastStatusUpdate = useRef(0);
  const handleProgress = useCallback((data: { currentTime: number; playableDuration: number; seekableDuration: number }) => {
    const now = Date.now();
    if (now - lastStatusUpdate.current < 500) return;
    lastStatusUpdate.current = now;
    setPositionMs(data.currentTime * 1000);
  }, []);

  const handleEnd = useCallback(() => {
    setIsPlaying(false);
    setShowEndScreen(true);
  }, []);

  // ✅ FIXED: react-native-video seek uses seconds, not milliseconds
  const handleSeek = useCallback((ms: number) => {
    videoRef.current?.seek(ms / 1000);
    setPositionMs(ms);
  }, []);

  const handleFollow = async () => {
    if (checkingFollow || !userId) return;
    setCheckingFollow(true);
    try { await onFollow(item.user_id, isFollowing); }
    catch (e) { Alert.alert('Error', 'Follow update failed'); }
    finally { setCheckingFollow(false); }
  };

  const togglePlay = () => { setIsPlaying(prev => !prev); };
  const toggleMute = () => { setIsMuted(prev => !prev); };

  const videoStyle = { width, height };

  return (
    <View style={styles.videoContainer}>
      <View style={styles.videoBackground} />

      <TouchableOpacity style={styles.videoTouchable} onPress={togglePlay} onLongPress={() => onSaveMedia(item)} delayLongPress={500} activeOpacity={0.9}>
        {shouldLoad ? (
          <Video
            ref={videoRef}
            source={{ uri: item.media_url || '' }}
            style={videoStyle}
            resizeMode="contain"
            repeat
            muted={isMuted}
            paused={!isPlaying}
            rate={playbackRate}
            onLoad={handleLoad}
            onProgress={handleProgress}
            onEnd={handleEnd}
            onError={(err) => console.log('Video error:', err)}
            ignoreSilentSwitch="ignore"
            playInBackground={false}
            playWhenInactive={false}
          />
        ) : (
          <View style={[videoStyle, { backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color="#00ff88" />
          </View>
        )}

        {tintColor && (<View style={[styles.filterTintOverlay, { backgroundColor: tintColor }]} pointerEvents="none" />)}

        {item.vibe_type && VIBE_TYPES[item.vibe_type] && (
          <View pointerEvents="none" style={[styles.vibeBadge, { backgroundColor: VIBE_TYPES[item.vibe_type].color + '22', borderColor: VIBE_TYPES[item.vibe_type].color }]}>
            <Text style={styles.vibeBadgeEmoji}>{VIBE_TYPES[item.vibe_type].emoji}</Text>
            <Text style={[styles.vibeBadgeText, { color: VIBE_TYPES[item.vibe_type].color }]}>{VIBE_TYPES[item.vibe_type].label.toUpperCase()}</Text>
          </View>
        )}

        {effectBadge && (
          <View style={[styles.effectBadge, { backgroundColor: `${effectBadgeColor}22`, borderColor: effectBadgeColor }]}>
            <Text style={[styles.effectBadgeText, { color: effectBadgeColor }]}>{effectBadge}</Text>
          </View>
        )}

        {item.has_watermark && item.media_url && (
          <Animated.View style={[styles.watermarkOverlay, { transform: [{ translateX: wmX }, { translateY: wmY }], opacity: wmOpacity, position: 'absolute', top: 0, left: 0 }]}>
            <Image source={require('../assets/images/adaptive-icon.png')} style={styles.watermarkLogo} resizeMode="contain" />
            <View><Text style={styles.watermarkText}>LumVibe</Text><Text style={styles.watermarkUsername}>@{item.username}</Text></View>
          </Animated.View>
        )}

        {!isPlaying && (
          <View style={styles.playOverlay}>
            <View style={styles.playButton}>
              <Feather name="play" size={64} color="#00ff88" />
            </View>
          </View>
        )}
      </TouchableOpacity>

      {/* ✅ NEW: Three-dot menu button — top right */}
      <TouchableOpacity
        style={styles.menuDotBtn}
        onPress={() => setMenuVisible(true)}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="more-vertical" size={22} color="#fff" />
      </TouchableOpacity>

      {/* ✅ NEW: Three-dot menu modal */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={menuStyles.backdrop}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={menuStyles.sheet}>
            <View style={menuStyles.handle} />

            {/* Save Video */}
            <TouchableOpacity
              style={menuStyles.row}
              activeOpacity={0.7}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(() => onSaveMedia(item), 200);
              }}
            >
              <View style={menuStyles.iconWrap}>
                <Feather name="download" size={20} color="#00ff88" />
              </View>
              <View style={menuStyles.rowText}>
                <Text style={menuStyles.rowTitle}>Save Video</Text>
                <Text style={menuStyles.rowSub}>Download with watermark & effects</Text>
              </View>
            </TouchableOpacity>

            {/* Share */}
            <TouchableOpacity
              style={menuStyles.row}
              activeOpacity={0.7}
              onPress={() => {
                setMenuVisible(false);
                setTimeout(() => onShare(item), 200);
              }}
            >
              <View style={menuStyles.iconWrap}>
                <Feather name="share-2" size={20} color="#fff" />
              </View>
              <View style={menuStyles.rowText}>
                <Text style={menuStyles.rowTitle}>Share</Text>
                <Text style={menuStyles.rowSub}>Share this video with friends</Text>
              </View>
            </TouchableOpacity>

            {/* Report — only shown for other people's posts */}
            {!isOwnPost && (
              <TouchableOpacity
                style={menuStyles.row}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  setTimeout(() => onReport(item), 200);
                }}
              >
                <View style={menuStyles.iconWrap}>
                  <Feather name="flag" size={20} color="#ff4444" />
                </View>
                <View style={menuStyles.rowText}>
                  <Text style={[menuStyles.rowTitle, { color: '#ff4444' }]}>Report</Text>
                  <Text style={menuStyles.rowSub}>Let us know what's wrong</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* Delete — only shown for own posts */}
            {isOwnPost && (
              <TouchableOpacity
                style={menuStyles.row}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  setTimeout(() => {
                    Alert.alert('Delete Video', 'Permanently delete this video? This cannot be undone.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
                    ]);
                  }, 200);
                }}
              >
                <View style={menuStyles.iconWrap}>
                  <Feather name="trash-2" size={20} color="#ff4444" />
                </View>
                <View style={menuStyles.rowText}>
                  <Text style={[menuStyles.rowTitle, { color: '#ff4444' }]}>Delete Video</Text>
                  <Text style={menuStyles.rowSub}>Permanently remove this video</Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={menuStyles.cancelBtn} onPress={() => setMenuVisible(false)} activeOpacity={0.7}>
              <Text style={menuStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {item.music_name && (
        <View style={styles.musicContainer}>
          <Feather name="music" size={12} color="#00ff88" />
          <Text style={styles.musicText}>{item.music_name}{item.music_artist ? ` - ${item.music_artist}` : ''}</Text>
        </View>
      )}

      <View style={styles.videoInfo}>
        <View style={styles.userInfoOverlay}>
          <TouchableOpacity style={styles.userInfoContent} onPress={() => onUserPress(item.user_id)} activeOpacity={0.7}>
            {item.user_photo_url ? <Image source={{ uri: item.user_photo_url }} style={styles.videoUserAvatar} /> : <View style={[styles.videoUserAvatar, styles.avatarPlaceholder]}><Feather name="user" size={20} color="#00ff88" /></View>}
            <View style={styles.videoUserDetails}>
              <Text style={styles.videoDisplayName}>{item.display_name}</Text>
              <Text style={styles.videoUsername}>@{item.username}</Text>
            </View>
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity style={[styles.followButtonVideo, isFollowing && styles.followingButtonVideo, checkingFollow && styles.disabled]} onPress={handleFollow} disabled={checkingFollow} activeOpacity={0.7}>
              <Text style={[styles.followButtonTextVideo, isFollowing && styles.followingButtonTextVideo]}>{checkingFollow ? '...' : isFollowing ? t.common.following : t.common.follow}</Text>
            </TouchableOpacity>
          )}
        </View>
        {item.caption && <Text style={styles.videoCaption} numberOfLines={3}>{item.caption}</Text>}
        {item.location && (<View style={styles.locationContainer}><Feather name="map-pin" size={12} color="#00ff88" /><Text style={styles.locationText}>{item.location}</Text></View>)}

        {item.vibe_type === 'marketplace' && (() => {
          const listingIdFromColumn = (item as any).marketplace_listing_id as string | null | undefined;
          const listingIdFromPublicId = (item as any).cloudinary_public_id?.startsWith('marketplace_listing_')
            ? (item as any).cloudinary_public_id.replace('marketplace_listing_', '')
            : null;
          const listingId = listingIdFromColumn || listingIdFromPublicId;
          if (!listingId) return null;
          const price = (item as any).marketplace_price
            || item.caption?.match(/(\d+) coins/)?.[1]
            || '';
          return (
            <TouchableOpacity
              style={videoShopStyles.shopBtn}
              onPress={() => navigation.navigate('MarketplaceListing', { listingId })}
              activeOpacity={0.85}
            >
              <Text style={videoShopStyles.shopBtnIcon}>🛍️</Text>
              <Text style={videoShopStyles.shopBtnText}>
                Shop Now{price ? ` — ${price} coins` : ''}
              </Text>
              <Feather name="chevron-right" size={14} color="#000" />
            </TouchableOpacity>
          );
        })()}
      </View>

      <View style={styles.actionsRight}>
        <TouchableOpacity style={styles.actionButtonRight} onPress={() => onLike(item)} activeOpacity={0.7}>
          <View style={styles.iconContainer}><Feather name="heart" size={32} color={isLiked ? '#00ff88' : '#fff'} /></View>
          <Text style={styles.actionTextRight}>{item.likes_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonRight} onPress={() => onComment(item)} activeOpacity={0.7}>
          <View style={styles.iconContainer}><Feather name="message-circle" size={30} color="#fff" /></View>
          <Text style={styles.actionTextRight}>{item.comments_count}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButtonRight} onPress={() => onGift(item)} activeOpacity={0.7}>
          <View style={styles.iconContainer}><MaterialCommunityIcons name="gift-outline" size={32} color="#ffd700" /></View>
          <Text style={styles.actionTextRightGold}>{item.coins_received > 0 ? item.coins_received.toFixed(0) : 'Gift'}</Text>
        </TouchableOpacity>

        {/* Co-Watch button */}
        <TouchableOpacity
          style={styles.actionButtonRight}
          onPress={() => {
            Alert.alert(
              '👥 Watch Together',
              'Choose how to co-watch this video',
              [
                { text: '🤖 AI Match Me', onPress: () => navigation.navigate('CoWatch', { conversationId: '', otherName: '', otherPhoto: '', isAiMatch: 'true' }) },
                { text: '👤 Watch with Friend', onPress: () => navigation.navigate('Messages') },
                { text: 'Cancel', style: 'cancel' },
              ],
            );
          }}
          activeOpacity={0.7}
        >
          <View style={styles.iconContainer}>
            <Feather name="users" size={28} color="#fff" />
          </View>
          <Text style={styles.actionTextRight}>Watch</Text>
        </TouchableOpacity>

        {/* Vibe Room button */}
        {vibeRoom && vibeRoom.status !== 'ended' && (
          <TouchableOpacity
            style={styles.actionButtonRight}
            onPress={() => navigation.navigate('VibeRoom', { id: vibeRoom.id })}
            activeOpacity={0.7}
          >
            <View style={[styles.iconContainer, { position: 'relative' }]}>
              <MaterialCommunityIcons name="television-play" size={28} color={vibeRoom.status === 'live' ? '#ff4444' : '#00ff88'} />
              {vibeRoom.status === 'live' && (
                <View style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff4444' }} />
              )}
            </View>
            <Text style={[styles.actionTextRight, { color: vibeRoom.status === 'live' ? '#ff4444' : '#00ff88', fontSize: 9 }]}>
              {vibeRoom.status === 'live' ? '🔴 LIVE' : '⏰ Soon'}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.actionButtonRight} onPress={toggleMute} activeOpacity={0.7}>
          <View style={styles.iconContainer}>
            <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={30} color="#fff" />
          </View>
        </TouchableOpacity>
        {item.views_count > 0 && (<View style={styles.viewsOverlay}><Feather name="eye" size={16} color="#fff" /><Text style={styles.viewsOverlayText}>{item.views_count}</Text></View>)}
        {item.coins_received > 0 && (<View style={styles.coinsOverlay}><MaterialCommunityIcons name="diamond" size={20} color="#ffd700" /><Text style={styles.coinsOverlayText}>{item.coins_received.toFixed(2)}</Text></View>)}
      </View>

      <VideoSeekBar positionMs={positionMs} durationMs={durationMs} onSeek={handleSeek} isVisible={isActive && durationMs > 0} />

      {/* End screen */}
      {showEndScreen && isActive && (
        <View style={endScreenStyles.overlay}>
          <View style={endScreenStyles.bg} />
          <View style={endScreenStyles.watermarkBlock} pointerEvents="none">
            <Image source={require('../assets/images/adaptive-icon.png')} style={endScreenStyles.watermarkIcon} resizeMode="contain" />
            <Text style={endScreenStyles.watermarkTitle}>LumVibe</Text>
            <Text style={endScreenStyles.watermarkSub}>Discover more creators on LumVibe</Text>
          </View>
          <View style={endScreenStyles.divider} />
          <View style={endScreenStyles.statsRow}>
            <View style={endScreenStyles.statItem}>
              <Feather name="heart" size={18} color="#00ff88" />
              <Text style={endScreenStyles.statValue}>{item.likes_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Likes</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <Feather name="message-circle" size={18} color="#00ff88" />
              <Text style={endScreenStyles.statValue}>{item.comments_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Comments</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <MaterialCommunityIcons name="gift-outline" size={18} color="#ffd700" />
              <Text style={[endScreenStyles.statValue, { color: '#ffd700' }]}>{item.coins_received > 0 ? item.coins_received.toFixed(0) : '0'}</Text>
              <Text style={endScreenStyles.statLabel}>Gifts</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <Feather name="eye" size={18} color="#00ff88" />
              <Text style={endScreenStyles.statValue}>{item.views_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Views</Text>
            </View>
          </View>
          <View style={endScreenStyles.creatorRow}>
            {item.user_photo_url
              ? <Image source={{ uri: item.user_photo_url }} style={endScreenStyles.creatorAvatar} />
              : <View style={[endScreenStyles.creatorAvatar, endScreenStyles.avatarFallback]}><Feather name="user" size={18} color="#00ff88" /></View>
            }
            <View style={{ flex: 1 }}>
              <Text style={endScreenStyles.creatorName}>{item.display_name}</Text>
              <Text style={endScreenStyles.creatorUsername}>@{item.username}</Text>
            </View>
            {!isOwnPost ? (
              <TouchableOpacity
                style={[endScreenStyles.followBtn, isFollowing && endScreenStyles.followingBtn]}
                onPress={handleFollow}
                activeOpacity={0.8}
              >
                <Text style={[endScreenStyles.followBtnText, isFollowing && endScreenStyles.followingBtnText]}>
                  {isFollowing ? 'Following' : '+ Follow'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={endScreenStyles.deleteBtn}
                onPress={() => {
                  setShowEndScreen(false);
                  Alert.alert('Delete Post', 'Permanently delete this video? This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
                  ]);
                }}
                activeOpacity={0.8}
              >
                <Feather name="trash-2" size={14} color="#ff4444" />
                <Text style={endScreenStyles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ✅ FIXED: Replay uses react-native-video API — seek(0) + setIsPlaying */}
          <TouchableOpacity
            style={endScreenStyles.replayBtn}
            activeOpacity={0.85}
            onPress={() => {
              setShowEndScreen(false);
              setPositionMs(0);
              videoRef.current?.seek(0);
              setIsPlaying(true);
            }}
          >
            <Feather name="rotate-ccw" size={22} color="#000" />
            <Text style={endScreenStyles.replayBtnText}>Replay</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
// ✅ FIXED: areEqual only checks real props — isMuted removed (it's internal state, not a prop)
}, (prev, next) =>
  prev.item.id              === next.item.id &&
  prev.item.likes_count     === next.item.likes_count &&
  prev.item.comments_count  === next.item.comments_count &&
  prev.item.coins_received  === next.item.coins_received &&
  prev.activePostId         === next.activePostId
);

// ─── FFMPEG TINT FILTER BUILDER ──────────────────────────────────────────────
function buildTintFilter(filterName: string, filterTint?: string | null): string | null {
  const presets: Record<string, string> = {
    original:  '',
    beauty:    'unsharp=5:5:1.5:5:5:0,eq=brightness=0.05:contrast=1.1:saturation=1.2',
    vintage:   'curves=vintage,eq=saturation=0.7:brightness=-0.05',
    cool:      'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.1',
    warm:      'eq=saturation=1.3:brightness=0.05,colorchannelmixer=1.1:0:0:0:0:0.9:0:0:0:0:0:0.8',
    dramatic:  'eq=contrast=1.4:brightness=-0.1:saturation=1.5,vignette',
    bright:    'eq=brightness=0.08:contrast=0.95:saturation=1.1',
    noir:      'colorchannelmixer=.299:.587:.114:0:.299:.587:.114:0:.299:.587:.114,eq=contrast=1.6:brightness=-0.04',
    neon:      'eq=contrast=1.3:saturation=2.0,hue=s=2',
    sunset:    'eq=saturation=1.4:brightness=0.02:contrast=1.2,colorchannelmixer=1.1:0:0:0:0:0.9:0:0:0:0:0:0.8',
    cinematic: 'curves=preset=strong_contrast,vignette,pad=iw:ih+80:0:40:black,crop=iw:ih-80:0:40',
    golden:    'eq=brightness=0.04:contrast=1.08:saturation=1.3,colorchannelmixer=1.1:0:0:0:0:0.95:0:0:0:0:0:0.85',
    rose:      'eq=brightness=0.03:saturation=1.1,colorchannelmixer=1.05:0:0:0:0:0.9:0:0:0:0:0:0.95',
    glitch:    'rgbashift=rh=3:bh=-3,chromashift=cbh=2:crh=-2,eq=contrast=1.35:saturation=1.8',
  };

  if (filterName && presets[filterName] !== undefined) return presets[filterName] || null;

  if (filterTint) {
    const match = filterTint.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (match) {
      const r  = parseInt(match[1]) / 255;
      const g  = parseInt(match[2]) / 255;
      const b  = parseInt(match[3]) / 255;
      const a  = parseFloat(match[4]);
      const rs = ((r - 0.5) * a * 0.5).toFixed(2);
      const gs = ((g - 0.5) * a * 0.5).toFixed(2);
      const bs = ((b - 0.5) * a * 0.5).toFixed(2);
      return `colorbalance=rs=${rs}:gs=${gs}:bs=${bs}`;
    }
  }
  return null;
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────
export default function VideosScreen() {
  const { userProfile, user, loadProfile } = useAuthStore();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const userId = user?.id || (user as any)?.id;

  const [posts,               setPosts]               = useState<Post[]>([]);
  const [feedItems,           setFeedItems]           = useState<FeedItem[]>([]);
  const [loading,             setLoading]             = useState(true);
  const [error,               setError]               = useState<string | null>(null);
  const [refreshing,          setRefreshing]          = useState(false);
  const [activePostId,        setActivePostId]        = useState<string | null>(null);
  const [selectedPost,        setSelectedPost]        = useState<Post | null>(null);
  const [comments,            setComments]            = useState<Comment[]>([]);
  const [commentText,         setCommentText]         = useState('');
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [loadingComments,     setLoadingComments]     = useState(false);
  const [submittingComment,   setSubmittingComment]   = useState(false);
  const [replyingTo,          setReplyingTo]          = useState<Comment | null>(null);
  const [followStatusMap,     setFollowStatusMap]     = useState<Map<string, boolean>>(new Map());
  const [weeklyWinners,       setWeeklyWinners]       = useState<WeeklyWinner[]>([]);
  const [showWinnersOverlay,  setShowWinnersOverlay]  = useState(true);
  const [giftModalVisible,    setGiftModalVisible]    = useState(false);
  const [customGiftMode,      setCustomGiftMode]      = useState(false);
  const [customGiftAmount,    setCustomGiftAmount]    = useState('');
  const [giftRecipientPost,   setGiftRecipientPost]   = useState<Post | null>(null);
  const [vibeRoomMap,         setVibeRoomMap]         = useState<Map<string, VibeRoomPreview>>(new Map());
  // ✅ NEW: Report modal state
  const [reportModalVisible,  setReportModalVisible]  = useState(false);
  const [reportPost,          setReportPost]          = useState<Post | null>(null);
  const [reportSubmitting,    setReportSubmitting]    = useState(false);

  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  const isLoadingRef     = useRef(false);
  const flatListRef      = useRef<FlatList>(null);
  const weeklyWinnersRef = useRef<WeeklyWinner[]>([]);

  const videoCacheRef        = useRef<{ data: FeedItem[]; timestamp: number } | null>(null);
  const VIDEO_CACHE_DURATION = 90000;

  const viewerCity = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone.split('/')[1]?.replace(/_/g, ' ') || ''; }
    catch { return ''; }
  }, []);

  useEffect(() => {
    Promise.all([loadVideos(), loadWeeklyWinners()]);
    const videosChannel = supabase.channel('videos-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (payload) => {
        if (payload.new?.media_type === 'video' && payload.new?.is_published === true) {
          videoCacheRef.current = null;
          loadVideos(true);
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' }, () => {
        if (!isLoadingRef.current) loadVideos(true);
      })
      .subscribe();
    return () => { supabase.removeChannel(videosChannel); };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    videoCacheRef.current = null;
    await Promise.all([loadVideos(true), loadWeeklyWinners()]);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { return () => { setActivePostId(null); }; }, []));

  const loadWeeklyWinners = async () => {
    try {
      const now = new Date(); const dayOfWeek = now.getDay();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWeek); weekStart.setHours(0, 0, 0, 0);
      const { data: savedWinners } = await supabase.from('weekly_winners').select('*').gte('week_start', weekStart.toISOString()).order('rank', { ascending: true }).limit(3);
      if (savedWinners && savedWinners.length >= 1) {
        const winnerUserIds = savedWinners.map((w: any) => w.user_id);
        const { data: winnerUsers } = await supabase.from('users').select('id, username, display_name, avatar_url').in('id', winnerUserIds);
        const userMap = new Map(winnerUsers?.map((u: any) => [u.id, u]) || []);
        const hydrated: WeeklyWinner[] = savedWinners.map((w: any) => { const u: any = userMap.get(w.user_id) || {}; return { rank: w.rank, user_id: w.user_id, username: u.username || w.username || 'unknown', display_name: u.display_name || w.display_name || 'Unknown', avatar_url: u.avatar_url || w.avatar_url, weekly_points: w.weekly_points || 0, week_start: w.week_start }; });
        setWeeklyWinners(hydrated);
        weeklyWinnersRef.current = hydrated;
        return;
      }
      const { data: topUsers } = await supabase.from('users').select('id, username, display_name, avatar_url, points').order('points', { ascending: false }).limit(3);
      if (topUsers && topUsers.length > 0) {
        const derived: WeeklyWinner[] = topUsers.map((u: any, idx: number) => ({ rank: (idx + 1) as 1|2|3, user_id: u.id, username: u.username || 'unknown', display_name: u.display_name || 'Unknown', avatar_url: u.avatar_url, weekly_points: u.points || 0, week_start: weekStart.toISOString() }));
        setWeeklyWinners(derived);
        weeklyWinnersRef.current = derived;
      }
    } catch (e) { console.error('Error loading weekly winners:', e); }
  };

  const loadFollowStatus = async (userIds: string[]) => {
    if (!userId || userIds.length === 0) return;
    try {
      const uniqueUserIds = [...new Set(userIds)].filter(id => id !== userId);
      if (uniqueUserIds.length === 0) return;
      const { data: followsData, error } = await supabase.from('follows').select('following_id').eq('follower_id', userId).in('following_id', uniqueUserIds);
      if (error) return;
      const newFollowMap = new Map<string, boolean>();
      uniqueUserIds.forEach(targetUserId => { newFollowMap.set(targetUserId, followsData?.some(f => f.following_id === targetUserId) || false); });
      setFollowStatusMap(newFollowMap);
    } catch (error) { console.error('Error in loadFollowStatus:', error); }
  };

  const loadVideos = async (forceRefresh = false) => {
    if (!forceRefresh && videoCacheRef.current && Date.now() - videoCacheRef.current.timestamp < VIDEO_CACHE_DURATION) {
      setFeedItems(videoCacheRef.current.data); setLoading(false); return;
    }
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    const loadTimeout = setTimeout(() => {
      if (isLoadingRef.current) {
        isLoadingRef.current = false;
        setLoading(false);
        if (feedItems.length === 0) setError('Connection timed out. Pull down to retry.');
      }
    }, 15000);

    try {
      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('id,user_id,caption,media_url,watermarked_url,media_type,views_count,coins_received,comments_count,saved_by,liked_by,location,music_name,music_artist,music_url,voice_duration,created_at,has_watermark,applied_filter,video_effect,video_filter_tint,playback_rate,vibe_type,cloudinary_public_id,is_published,marketplace_listing_id,marketplace_price,marketplace_title')
        .eq('media_type', 'video')
        .or('is_published.is.null,is_published.eq.true')
        .order('created_at', { ascending: false })
        .limit(50);

      if (postsError) throw postsError;
      if (!postsData || postsData.length === 0) { setPosts([]); setFeedItems([]); setLoading(false); isLoadingRef.current = false; return; }

      const userIds = [...new Set(postsData.map(p => p.user_id))];
      const postIds = postsData.map(p => p.id);

      const [usersResult, likesResult, commentsResult, followingResult] = await Promise.all([
        supabase.from('users').select('id, username, display_name, avatar_url, followers_count').in('id', userIds),
        supabase.from('likes').select('post_id, user_id').in('post_id', postIds),
        supabase.from('comments').select('post_id').in('post_id', postIds).is('parent_comment_id', null),
        userId ? supabase.from('follows').select('following_id').eq('follower_id', userId) : Promise.resolve({ data: [] }),
      ]);

      const usersMap = new Map<string, any>(); usersResult.data?.forEach(u => usersMap.set(u.id, u));
      const likesMap = new Map<string, { count: number; users: string[] }>();
      likesResult.data?.forEach(like => { const existing = likesMap.get(like.post_id) || { count: 0, users: [] }; existing.count++; existing.users.push(like.user_id); likesMap.set(like.post_id, existing); });
      const commentsMap = new Map<string, number>();
      commentsResult.data?.forEach(c => { commentsMap.set(c.post_id, (commentsMap.get(c.post_id) || 0) + 1); });
      const followingSet = new Set<string>();
      (followingResult as any).data?.forEach((f: any) => followingSet.add(f.following_id));

      const formattedPosts: Post[] = postsData.map((p: any) => {
        const likes    = likesMap.get(p.id) || { count: 0, users: [] };
        const postUser = usersMap.get(p.user_id);
        return {
          id: p.id, user_id: p.user_id,
          username: postUser?.username || 'unknown', display_name: postUser?.display_name || 'Unknown',
          user_photo_url: postUser?.avatar_url, media_url: cdnVideoUrl(p.media_url), caption: p.caption || '',
          likes_count: likes.count, comments_count: p.comments_count ?? commentsMap.get(p.id) ?? 0,
          views_count: p.views_count || 0, coins_received: p.coins_received || 0,
          liked_by: likes.users, location: p.location,
          music_name: p.music_name, music_artist: p.music_artist,
          music_url: p.music_url || null,
          voice_duration: p.voice_duration || null,
          applied_filter: p.applied_filter || 'original',
          created_at: p.created_at, has_watermark: p.has_watermark || false,
          watermarked_url: cdnVideoUrl(p.watermarked_url) || null,
          video_effect: p.video_effect || 'none', video_filter_tint: p.video_filter_tint || null,
          playback_rate: p.playback_rate || null,
          vibe_type: p.vibe_type ?? null,
          vibe_room_id: null,
        };
      });

      const newVibeRoomMap = new Map<string, VibeRoomPreview>();
      try {
        const { data: vibeRoomsData } = await supabase
          .from('vibe_rooms')
          .select('id, post_id, title, status, scheduled_for, viewer_count')
          .in('post_id', postIds)
          .neq('status', 'ended');
        vibeRoomsData?.forEach((vr: any) => {
          newVibeRoomMap.set(vr.post_id, {
            id: vr.id, post_id: vr.post_id, title: vr.title,
            status: vr.status, scheduled_for: vr.scheduled_for,
            viewer_count: vr.viewer_count || 0,
          });
        });
      } catch { /* vibe_rooms table may not exist yet */ }
      setVibeRoomMap(newVibeRoomMap);

      const scoredPosts = formattedPosts.map(post => ({
        ...post,
        _score: computeVideoScore(post, followingSet, usersMap.get(post.user_id)?.followers_count || 0, viewerCity)
      }));
      scoredPosts.sort((a, b) => (b._score || 0) - (a._score || 0));
      const topPosts = scoredPosts.slice(0, 50);
      setPosts(topPosts);

      const itemsWithAds: FeedItem[] = [];
      let adCounter = 0; let winnerCardInserted = false;
      topPosts.forEach((post, index) => {
        itemsWithAds.push(post);
        if (index === 3 && !winnerCardInserted) {
          winnerCardInserted = true;
          itemsWithAds.push({ id: 'winner_card_video', isWinnerCard: true, winners: weeklyWinnersRef.current });
        } else if ((index + 1) % 4 === 0) {
          itemsWithAds.push({ id: `ad_${adCounter}`, isAd: true, adIndex: adCounter });
          adCounter++;
        }
      });

      videoCacheRef.current = { data: itemsWithAds, timestamp: Date.now() };
      setFeedItems(itemsWithAds);
      await loadFollowStatus(userIds);
    } catch (e: any) { Alert.alert('Error', e.message || 'Failed to load videos'); }
    finally { clearTimeout(loadTimeout); setLoading(false); isLoadingRef.current = false; }
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const firstPost = viewableItems.find((v: any) => v.item && !isAd(v.item) && !isWinnerCard(v.item));
    setActivePostId(firstPost ? (firstPost.item as Post).id : null);
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: FEED_SETTINGS.itemVisiblePercentThreshold,
  }).current;

  const viewQueueRef    = useRef<Set<string>>(new Set());
  const viewFlushRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleView = useCallback((postId: string) => {
    if (!userId) return;
    viewQueueRef.current.add(postId);
    if (viewFlushRef.current) clearTimeout(viewFlushRef.current);
    viewFlushRef.current = setTimeout(async () => {
      const toFlush = Array.from(viewQueueRef.current);
      viewQueueRef.current.clear();
      for (const pid of toFlush) {
        try {
          const { data: post } = await supabase.from('posts').select('views_count,viewed_by,user_id').eq('id', pid).single();
          if (!post) continue;
          const viewedBy = post.viewed_by || [];
          if (viewedBy.includes(userId)) continue;
          await supabase.from('posts').update({
            views_count: (post.views_count || 0) + 1,
            viewed_by:   [...viewedBy, userId],
          }).eq('id', pid);
          if (post.user_id && post.user_id !== userId) {
            const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
            if (ownerData) {
              const multipliers = await getOwnerBadgeMultipliers(post.user_id);
              await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.viewPoints }).eq('id', post.user_id);
            }
          }
          setPosts(prev => prev.map(p => p.id === pid ? { ...p, views_count: (post.views_count || 0) + 1 } : p));
          setFeedItems(prev => prev.map(item => {
            if (!isAd(item) && !isWinnerCard(item) && item.id === pid)
              return { ...item, views_count: (post.views_count || 0) + 1 };
            return item;
          }));
        } catch (e) { console.error('View tracking error:', e); }
      }
    }, 1500);
  }, [userId]);

  const handleLike = useCallback(async (post: Post) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToLike); return; }
    const isLiked = post.liked_by?.includes(userId);
    const updatePost = (p: Post) => { if (p.id !== post.id) return p; return { ...p, likes_count: isLiked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1, liked_by: isLiked ? p.liked_by.filter(id => id !== userId) : [...(p.liked_by || []), userId] }; };
    setPosts(prev => prev.map(updatePost));
    setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updatePost(item as Post) : item));
    try {
      if (isLiked) {
        const { error } = await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', userId);
        if (error) throw error;
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(post.user_id); await supabase.from('users').update({ points: Math.max(0, (ownerData.points || 0) - multipliers.likePoints) }).eq('id', post.user_id); }
      } else {
        const { error } = await supabase.from('likes').insert({ post_id: post.id, user_id: userId });
        if (error) throw error;
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(post.user_id); await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.likePoints }).eq('id', post.user_id); }
        if (post.user_id !== userId) await supabase.from('notifications').insert({ user_id: post.user_id, type: 'like', title: 'New Like', message: `@${userProfile?.username || 'Someone'} liked your video`, from_user_id: userId, post_id: post.id, is_read: false });
      }
    } catch (error: any) { await loadVideos(); }
  }, [userId, userProfile]);

  const handleGift = useCallback((post: Post) => { setGiftRecipientPost(post); setCustomGiftMode(false); setCustomGiftAmount(''); setGiftModalVisible(true); }, []);

  const handleSelectGiftPackage = async (giftPackage: typeof GIFT_PACKAGES[0]) => {
    if (!giftRecipientPost || !userId) return;
    if (giftPackage.coins > (userProfile?.coins || 0)) {
      Alert.alert(t.videos.insufficientCoins, `You need ${giftPackage.coins} coins but only have ${(userProfile?.coins || 0).toFixed(0)}.`, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.videos.topUpWallet, onPress: () => { setGiftModalVisible(false); setTimeout(() => navigation.navigate('BuyCoins'), 300); } },
      ]);
      return;
    }
    try {
      const { data: freshSender } = await supabase.from('users').select('coins').eq('id', userId).single();
      if ((freshSender?.coins || 0) < giftPackage.coins) {
        Alert.alert('Insufficient coins', 'Balance changed. Please try again.');
        return;
      }
      await supabase.from('users')
        .update({ coins: (freshSender?.coins || 0) - giftPackage.coins })
        .eq('id', userId);

      await supabase.rpc('increment_coins', {
        target_user_id: giftRecipientPost.user_id,
        coin_amount: giftPackage.coins,
      });

      const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', giftRecipientPost.id).single();
      await supabase.from('posts')
        .update({ coins_received: (freshPost?.coins_received || 0) + giftPackage.coins })
        .eq('id', giftRecipientPost.id);

      await supabase.from('transactions').insert([
        { user_id: userId, type: 'spent', amount: giftPackage.coins, description: `Sent ${giftPackage.name} ${giftPackage.icon} to @${giftRecipientPost.username}`, status: 'completed' },
        { user_id: giftRecipientPost.user_id, type: 'received', amount: giftPackage.coins, description: `Received ${giftPackage.name} ${giftPackage.icon} from @${userProfile?.username}`, status: 'completed' },
      ]);
      await supabase.from('notifications').insert({
        user_id: giftRecipientPost.user_id, type: 'gift', title: 'New Gift',
        message: `@${userProfile?.username || 'Someone'} sent you ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins)`,
        from_user_id: userId, post_id: giftRecipientPost.id, is_read: false,
      });
      setGiftModalVisible(false);
      const updateCoins = (p: Post) => p.id === giftRecipientPost.id ? { ...p, coins_received: p.coins_received + giftPackage.coins } : p;
      setPosts(prev => prev.map(updateCoins));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateCoins(item as Post) : item));
      await loadProfile();
      Alert.alert(`${giftPackage.icon} Sent!`, `You sent ${giftPackage.name} (${giftPackage.coins} coins) to @${giftRecipientPost.username}!`);
    } catch (error: any) { Alert.alert('Error', 'Failed to send gift'); }
  };

  const handleSendCustomGift = async () => {
    if (!customGiftAmount.trim() || !giftRecipientPost || !userId) return;
    const amount = parseFloat(customGiftAmount);
    if (isNaN(amount) || amount < 10)       { Alert.alert('Invalid Amount', 'Minimum 10 coins'); return; }
    if (amount > 5000)                      { Alert.alert('Invalid Amount', 'Maximum 5,000 coins (₦750,000)'); return; }
    if (amount > (userProfile?.coins || 0)) {
      Alert.alert(t.videos.insufficientCoins, `You only have ${(userProfile?.coins || 0).toFixed(0)} coins.`, [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.videos.topUpWallet, onPress: () => { setGiftModalVisible(false); setCustomGiftMode(false); setTimeout(() => navigation.navigate('BuyCoins'), 300); } },
      ]);
      return;
    }
    try {
      const { data: freshSender2 } = await supabase.from('users').select('coins').eq('id', userId).single();
      if ((freshSender2?.coins || 0) < amount) {
        Alert.alert('Insufficient coins', 'Balance changed. Please try again.');
        return;
      }
      await supabase.from('users')
        .update({ coins: (freshSender2?.coins || 0) - amount })
        .eq('id', userId);

      await supabase.rpc('increment_coins', {
        target_user_id: giftRecipientPost.user_id,
        coin_amount: amount,
      });

      const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', giftRecipientPost.id).single();
      await supabase.from('posts')
        .update({ coins_received: (freshPost?.coins_received || 0) + amount })
        .eq('id', giftRecipientPost.id);

      await supabase.from('transactions').insert([
        { user_id: userId, type: 'spent', amount, description: `Sent custom gift (${amount} coins = ${coinsToNGN(amount)}) to @${giftRecipientPost.username}`, status: 'completed' },
        { user_id: giftRecipientPost.user_id, type: 'received', amount, description: `Received custom gift (${amount} coins = ${coinsToNGN(amount)}) from @${userProfile?.username}`, status: 'completed' },
      ]);
      await supabase.from('notifications').insert({
        user_id: giftRecipientPost.user_id, type: 'gift', title: 'New Gift',
        message: `@${userProfile?.username || 'Someone'} sent a custom gift (${amount} coins)`,
        from_user_id: userId, post_id: giftRecipientPost.id, is_read: false,
      });
      setGiftModalVisible(false); setCustomGiftMode(false); setCustomGiftAmount('');
      const updateCoins = (p: Post) => p.id === giftRecipientPost.id ? { ...p, coins_received: p.coins_received + amount } : p;
      setPosts(prev => prev.map(updateCoins));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateCoins(item as Post) : item));
      await loadProfile();
      Alert.alert(t.videos.giftSent, `You sent ${amount} coins (${coinsToNGN(amount)}) to @${giftRecipientPost.username}!`);
    } catch (error: any) { Alert.alert('Error', 'Failed to send gift'); }
  };

  const handleComment = useCallback(async (post: Post) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToComment); return; }
    setSelectedPost(post); setCommentModalVisible(true); setLoadingComments(true); setCommentText(''); setReplyingTo(null);
    try {
      const { data: commentsData, error: commentsError } = await supabase.from('comments').select('*').eq('post_id', post.id).order('created_at', { ascending: false });
      if (commentsError) throw commentsError;
      const userIds = [...new Set(commentsData?.map(c => c.user_id) || [])];
      const { data: usersData } = await supabase.from('users').select('id, username, display_name, avatar_url').in('id', userIds);
      const usersMap = new Map(); usersData?.forEach(u => usersMap.set(u.id, u));
      const commentIds = (commentsData || []).map(c => c.id);
      const { data: likesData } = await supabase.from('comment_likes').select('comment_id, user_id').in('comment_id', commentIds);
      const likesMap = new Map<string, { count: number; users: string[] }>();
      likesData?.forEach(like => { const existing = likesMap.get(like.comment_id) || { count: 0, users: [] }; existing.count++; existing.users.push(like.user_id); likesMap.set(like.comment_id, existing); });
      const formattedComments = await Promise.all((commentsData || []).map(async (comment: any) => {
        const likes = likesMap.get(comment.id) || { count: 0, users: [] };
        const u = usersMap.get(comment.user_id);
        let parentComment = undefined;
        if (comment.parent_comment_id) {
          const { data: parentData } = await supabase.from('comments').select('text, user_id').eq('id', comment.parent_comment_id).single();
          if (parentData) { const pu = usersMap.get(parentData.user_id); parentComment = { username: pu?.username || 'unknown', display_name: pu?.display_name || 'Unknown', text: parentData.text }; }
        }
        return { id: comment.id, post_id: comment.post_id, user_id: comment.user_id, username: u?.username || 'unknown', display_name: u?.display_name || 'Unknown User', user_photo_url: u?.avatar_url, text: comment.text, likes_count: likes.count, replies_count: comment.replies_count || 0, liked_by: likes.users, parent_comment_id: comment.parent_comment_id, created_at: comment.created_at, parent_comment: parentComment };
      }));
      setComments(formattedComments);
    } catch (e: any) { Alert.alert('Error', 'Failed to load comments'); }
    finally { setLoadingComments(false); }
  }, [userId]);

  const handleCommentSubmit = useCallback(async () => {
    if (!commentText.trim() || !selectedPost || !userId || submittingComment) return;
    const trimmedText = commentText.trim();
    if (trimmedText.length < 1 || trimmedText.length > 500) { Alert.alert('Error', trimmedText.length < 1 ? 'Comment cannot be empty' : 'Comment too long (max 500)'); return; }
    setSubmittingComment(true);
    try {
      const { data: newComment, error: insertError } = await supabase.from('comments').insert({ post_id: selectedPost.id, user_id: userId, text: trimmedText, parent_comment_id: replyingTo?.id || null, replies_count: 0 }).select().single();
      if (insertError) throw insertError;
      if (replyingTo) { const { data: parentComment } = await supabase.from('comments').select('replies_count').eq('id', replyingTo.id).single(); if (parentComment) await supabase.from('comments').update({ replies_count: (parentComment.replies_count || 0) + 1 }).eq('id', replyingTo.id); }
      if (selectedPost.user_id !== userId) {
        try { const { data: ownerData } = await supabase.from('users').select('points').eq('id', selectedPost.user_id).single(); if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(selectedPost.user_id); await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.commentPoints }).eq('id', selectedPost.user_id); } } catch (e) {}
        await supabase.from('notifications').insert({ user_id: selectedPost.user_id, type: 'comment', title: 'New Comment', message: `@${userProfile?.username || 'Someone'} commented: ${trimmedText.substring(0, 50)}${trimmedText.length > 50 ? '...' : ''}`, from_user_id: userId, post_id: selectedPost.id, comment_id: newComment.id, is_read: false });
      }
      setCommentText(''); setReplyingTo(null);
      const updateComments = (p: Post) => p.id === selectedPost.id ? { ...p, comments_count: p.comments_count + 1 } : p;
      setPosts(prev => prev.map(updateComments));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateComments(item as Post) : item));
      await handleComment(selectedPost);
    } catch (error: any) { Alert.alert('Error', 'Failed to post comment.'); }
    finally { setSubmittingComment(false); }
  }, [commentText, selectedPost, userId, submittingComment, replyingTo, userProfile]);

  const handleCommentLike = useCallback(async (comment: Comment) => {
    if (!userId) return;
    const isLiked = comment.liked_by?.includes(userId);
    setComments(prev => prev.map(c => c.id === comment.id ? { ...c, likes_count: isLiked ? Math.max(0, c.likes_count - 1) : c.likes_count + 1, liked_by: isLiked ? c.liked_by.filter(id => id !== userId) : [...(c.liked_by || []), userId] } : c));
    try {
      if (isLiked) await supabase.from('comment_likes').delete().eq('comment_id', comment.id).eq('user_id', userId);
      else         await supabase.from('comment_likes').insert({ comment_id: comment.id, user_id: userId });
    } catch (error: any) { if (selectedPost) await handleComment(selectedPost); }
  }, [userId, selectedPost]);

  const handleReply       = useCallback((comment: Comment) => { setReplyingTo(comment); setCommentText(''); }, []);
  const handleCancelReply = useCallback(() => { setReplyingTo(null); setCommentText(''); }, []);

  const handleDeletePost = useCallback(async (post: Post) => {
    if (post.user_id !== userId) return;
    try {
      await supabase.from('likes').delete().eq('post_id', post.id);
      await supabase.from('comments').delete().eq('post_id', post.id);
      const { error } = await supabase.from('posts').delete().eq('id', post.id).eq('user_id', userId);
      if (error) throw error;
      setPosts(prev => prev.filter(p => p.id !== post.id));
      setFeedItems(prev => prev.filter(item => {
        if (isAd(item) || isWinnerCard(item)) return true;
        return (item as Post).id !== post.id;
      }));
    } catch { Alert.alert('Error', 'Failed to delete. Please try again.'); }
  }, [userId]);

  // ✅ NEW: handleReport — opens report modal
  const handleReport = useCallback((post: Post) => {
    if (!userId) { Alert.alert('Login Required', 'Please log in to report content.'); return; }
    setReportPost(post);
    setReportModalVisible(true);
  }, [userId]);

  // ✅ NEW: submitReport — saves to Supabase reports table
  const submitReport = useCallback(async (category: string) => {
    if (!reportPost || !userId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await supabase.from('reports').insert({
        post_id:     reportPost.id,
        reporter_id: userId,
        reported_user_id: reportPost.user_id,
        category,
        status:      'pending',
        created_at:  new Date().toISOString(),
      });
      setReportModalVisible(false);
      setReportPost(null);
      Alert.alert(
        '✅ Report Submitted',
        'Thank you for keeping LumVibe safe. Our team will review this content.',
        [{ text: 'OK' }]
      );
    } catch (e) {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  }, [reportPost, userId, reportSubmitting]);

  const handleFollow = useCallback(async (targetUserId: string, isFollowing: boolean) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToFollow); return; }
    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', userId).eq('following_id', targetUserId);
        const { data: cu } = await supabase.from('users').select('following_count').eq('id', userId).single();
        const { data: tu } = await supabase.from('users').select('followers_count').eq('id', targetUserId).single();
        if (cu) await supabase.from('users').update({ following_count: Math.max(0, (cu.following_count || 0) - 1) }).eq('id', userId);
        if (tu) await supabase.from('users').update({ followers_count: Math.max(0, (tu.followers_count || 0) - 1) }).eq('id', targetUserId);
        setFollowStatusMap(prev => { const m = new Map(prev); m.set(targetUserId, false); return m; });
      } else {
        const { data: existingFollow } = await supabase.from('follows').select('id').eq('follower_id', userId).eq('following_id', targetUserId).maybeSingle();
        if (existingFollow) return;
        await supabase.from('follows').insert({ follower_id: userId, following_id: targetUserId });
        const { data: cu } = await supabase.from('users').select('following_count').eq('id', userId).single();
        const { data: tu } = await supabase.from('users').select('followers_count').eq('id', targetUserId).single();
        if (cu) await supabase.from('users').update({ following_count: (cu.following_count || 0) + 1 }).eq('id', userId);
        if (tu) await supabase.from('users').update({ followers_count: (tu.followers_count || 0) + 1 }).eq('id', targetUserId);
        await supabase.from('notifications').insert({ user_id: targetUserId, type: 'follow', title: 'New Follower', message: `@${userProfile?.username || 'Someone'} started following you`, from_user_id: userId, is_read: false });
        setFollowStatusMap(prev => { const m = new Map(prev); m.set(targetUserId, true); return m; });
      }
    } catch (e: any) { throw e; }
  }, [userId, userProfile]);

  const handleShare = useCallback(async (post: Post) => {
    try {
      const deepLink = `https://lumvibe.site/video/${post.id}`;
      const result = await Share.share({ message: `Check out this video by @${post.username} on LumVibe!\n\n${post.caption || ''}\n\n${deepLink}`, title: `Video by @${post.username}` });
      if (result.action === Share.sharedAction && post.user_id !== userId) {
        try { const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single(); if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(post.user_id); await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.sharePoints }).eq('id', post.user_id); } } catch (e) {}
      }
    } catch (e: any) { console.error('Share error:', e); }
  }, [userId]);

  const handleSaveMedia = useCallback(async (post: Post) => {
    if (!post.media_url) return;
    Alert.alert(
      t.videos.saveVideo,
      'Save this video? Watermark, filter and effects will be baked in.',
      [
        { text: t.common.cancel, style: 'cancel' },
        { text: t.common.save, onPress: async () => {
          try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status !== 'granted') { Alert.alert(t.videos.permissionDenied, t.videos.permissionMsg); return; }

            const rawFileName = `lumvibe_raw_${post.id}_${Date.now()}.mp4`;
            const rawUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}${rawFileName}`;
            const outFileName = `lumvibe_${post.id}_${Date.now()}.mp4`;
            const outUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}${outFileName}`;

            Alert.alert('⬇️ Downloading...', 'Processing your video with effects...');

            const downloadResult = await FileSystem.downloadAsync(post.media_url ?? '', rawUri);
            if (downloadResult.status !== 200) { Alert.alert('Error', 'Download failed. Please try again.'); return; }

            const postPlaybackRate = post.playback_rate ?? 1.0;
            const tintFilter   = buildTintFilter(post.applied_filter || 'original', post.video_filter_tint);
            const username     = post.username.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 28);

            const buildAtempoChain = (rate: number): string => {
              const parts: string[] = [];
              let remaining = rate;
              while (remaining > 2.0) { parts.push('atempo=2.0'); remaining /= 2.0; }
              while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5; }
              parts.push(`atempo=${remaining.toFixed(4)}`);
              return parts.join(',');
            };

            const vfParts: string[] = [];
            if (postPlaybackRate !== 1.0) vfParts.push(`setpts=${(1 / postPlaybackRate).toFixed(4)}*PTS`);
            if (tintFilter) vfParts.push(tintFilter);
            if (post.has_watermark) {
              vfParts.push(`drawtext=text='LumVibe':fontcolor=white:fontsize=22:alpha=0.85:x=16:y=h-50`);
              vfParts.push(`drawtext=text='@${username}':fontcolor=white:fontsize=16:alpha=0.75:x=16:y=h-26`);
            }

            const afParts: string[] = [];
            if (postPlaybackRate !== 1.0) afParts.push(buildAtempoChain(postPlaybackRate));

            const vfArg = vfParts.length > 0 ? `-vf "${vfParts.join(',')}"` : '';
            const afArg = afParts.length > 0 ? `-af "${afParts.join(',')}"` : '';

            const ffmpegCommand = `-y -i "${rawUri}" ${vfArg} ${afArg} -c:v libx264 -preset fast -crf 22 -c:a aac "${outUri}"`;

            const session = await FFmpegKit.execute(ffmpegCommand);
            const returnCode = await session.getReturnCode();

            await FileSystem.deleteAsync(rawUri, { idempotent: true });

            if (ReturnCode.isSuccess(returnCode)) {
              const asset = await MediaLibrary.createAssetAsync(outUri);
              await MediaLibrary.createAlbumAsync('LumVibe', asset, false);
              await FileSystem.deleteAsync(outUri, { idempotent: true });
              Alert.alert('✅ Saved!', 'Video saved with watermark and effects to your LumVibe gallery.');
            } else {
              console.warn('FFmpeg processing failed, saving plain video');
              const plainDownload = await FileSystem.downloadAsync(post.media_url ?? '', outUri);
              if (plainDownload.status === 200) {
                const asset = await MediaLibrary.createAssetAsync(outUri);
                await MediaLibrary.createAlbumAsync('LumVibe', asset, false);
                await FileSystem.deleteAsync(outUri, { idempotent: true });
                Alert.alert('✅ Saved!', 'Video saved to your LumVibe gallery (effects could not be baked on this device).');
              } else {
                Alert.alert('Error', 'Failed to save video. Please try again.');
              }
            }
          } catch (e: any) { Alert.alert('Error', 'Failed to save video: ' + (e.message || 'Unknown error')); }
        }}
      ]
    );
  }, [t]);

  const handleUserPress = useCallback((targetUserId: string) => { if (!targetUserId) return; navigation.navigate('UserProfile', { userId: targetUserId }); }, [navigation]);

  const formatCommentTime = (timestamp: string) => {
    if (!timestamp) return 'Just now';
    const diff = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 1000);
    if (diff < 60) return 'Just now'; if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`; if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(timestamp).toLocaleDateString();
  };

  const renderItem = useCallback(({ item }: { item: FeedItem }) => {
    if (isAd(item)) return <NativeAdPost adIndex={item.adIndex} />;
    if (isWinnerCard(item)) { if (weeklyWinners.length === 0) return null; return <WinnerCardVideo winners={weeklyWinners} onUserPress={handleUserPress} />; }
    return (
      <VideoPost
        item={item as Post} activePostId={activePostId}
        onLike={handleLike} onComment={handleComment} onGift={handleGift}
        onFollow={handleFollow} onUserPress={handleUserPress} onShare={handleShare}
        onSaveMedia={handleSaveMedia} onDelete={handleDeletePost} onReport={handleReport}
        user={user} onView={handleView} followStatusMap={followStatusMap}
        vibeRoomMap={vibeRoomMap}
      />
    );
  }, [activePostId, weeklyWinners, followStatusMap, vibeRoomMap, handleLike, handleComment, handleGift, handleFollow, handleUserPress, handleShare, handleSaveMedia, handleDeletePost, handleReport, handleView, user]);

  if (loading) return (<View style={styles.loadingContainer}><ActivityIndicator size="large" color="#00ff88" /><Text style={styles.loadingText}>{t.videos.loadingVideos}</Text></View>);

  return (
    <View style={styles.container}>
      {/* Offline banner */}
      {isOffline && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, backgroundColor: '#ff4444', paddingVertical: 7, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="wifi-off" size={13} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 }}>No internet — videos may not load</Text>
        </View>
      )}
      {/* Error banner */}
      {error && !isOffline && feedItems.length === 0 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 999, backgroundColor: '#1a1a1a', paddingVertical: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="alert-circle" size={13} color="#ffd700" />
          <Text style={{ color: '#ffd700', fontSize: 12, flex: 1 }}>{error}</Text>
          <TouchableOpacity onPress={() => { setError(null); loadVideos(true); }}>
            <Text style={{ color: '#00ff88', fontSize: 12, fontWeight: '700' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        ref={flatListRef} data={feedItems} keyExtractor={(item) => item.id} renderItem={renderItem}
        pagingEnabled showsVerticalScrollIndicator={false}
        snapToInterval={height} snapToAlignment="start" decelerationRate="fast"
        getItemLayout={(_data, index) => ({ length: height, offset: height * index, index })}
        onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
        windowSize={FEED_SETTINGS.windowSize} maxToRenderPerBatch={FEED_SETTINGS.maxToRenderPerBatch}
        initialNumToRender={FEED_SETTINGS.initialNumToRender} updateCellsBatchingPeriod={FEED_SETTINGS.updateCellsBatchingPeriod}
        removeClippedSubviews={true}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#00ff88"
            colors={['#00ff88']}
            progressBackgroundColor="#111"
          />
        }
        // ✅ FIXED: Empty feed state — no more blank black screen
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="video" size={64} color="#333" />
            <Text style={styles.emptyText}>{t.videos.noVideos}</Text>
            <Text style={styles.emptySubtext}>{t.videos.noVideosSubtext}</Text>
            <TouchableOpacity
              style={{ marginTop: 20, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: '#00ff88', borderRadius: 24 }}
              onPress={() => loadVideos(true)}
              activeOpacity={0.8}
            >
              <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Refresh Feed</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {weeklyWinners.length > 0 && showWinnersOverlay && (
        <WinnersVideoOverlay winners={weeklyWinners} onUserPress={handleUserPress} onDismiss={() => setShowWinnersOverlay(false)} />
      )}

      {/* GIFT MODAL */}
      <Modal visible={giftModalVisible} transparent animationType="slide" onRequestClose={() => setGiftModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.giftModal}>
            <View style={styles.giftModalHeader}>
              <Text style={styles.giftModalTitle}>{t.videos.sendGiftTo} @{giftRecipientPost?.username}</Text>
              <TouchableOpacity onPress={() => setGiftModalVisible(false)} style={styles.closeButton}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <View style={styles.balanceInfo}>
              <MaterialCommunityIcons name="diamond" size={20} color="#ffd700" />
              <Text style={styles.balanceText}>{(userProfile?.coins || 0).toFixed(0)} coins ({coinsToNGN(userProfile?.coins || 0)})</Text>
            </View>
            {!customGiftMode ? (
              <>
                <ScrollView style={styles.giftPackagesContainer}>
                  {GIFT_PACKAGES.map((gift) => (
                    <TouchableOpacity key={gift.id} style={[styles.giftPackage, { borderColor: gift.color }]} onPress={() => handleSelectGiftPackage(gift)} activeOpacity={0.7}>
                      <View style={styles.giftPackageLeft}>
                        <Text style={styles.giftIcon}>{gift.icon}</Text>
                        <View style={styles.giftInfo}>
                          <Text style={styles.giftName}>{gift.name}</Text>
                          <Text style={styles.giftAmount}>{gift.coins} coins</Text>
                          <Text style={styles.giftLocalAmount}>{giftLocalPrice(gift.ngn)}</Text>
                        </View>
                      </View>
                      <Feather name="chevron-right" size={24} color={gift.color} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={styles.customGiftButton} onPress={() => setCustomGiftMode(true)} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="pencil" size={20} color="#00ff88" />
                  <Text style={styles.customGiftButtonText}>{t.videos.customAmount}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.customGiftContainer}>
                <Text style={styles.customGiftLabel}>{t.videos.enterAmount}</Text>
                <TextInput style={styles.customGiftInput} value={customGiftAmount} onChangeText={setCustomGiftAmount} placeholder="10" placeholderTextColor="#666" keyboardType="decimal-pad" autoFocus />
                {customGiftAmount && !isNaN(parseFloat(customGiftAmount)) && (<Text style={styles.customGiftPreview}>{coinsToNGN(parseFloat(customGiftAmount))}</Text>)}
                <View style={styles.customGiftActions}>
                  <TouchableOpacity style={[styles.customGiftActionButton, styles.cancelButton]} onPress={() => { setCustomGiftMode(false); setCustomGiftAmount(''); }} activeOpacity={0.7}><Text style={styles.cancelButtonText}>{t.common.cancel}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.customGiftActionButton, styles.sendButton]} onPress={handleSendCustomGift} activeOpacity={0.7}><MaterialCommunityIcons name="send" size={20} color="#000" /><Text style={styles.sendButtonText}>{t.videos.giftSent.replace('! 🎁','')}</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* COMMENT MODAL */}
      <Modal visible={commentModalVisible} animationType="slide" onRequestClose={() => setCommentModalVisible(false)}>
        <View style={styles.commentModal}>
          <View style={styles.commentModalHeader}>
            <TouchableOpacity onPress={() => { setCommentModalVisible(false); setReplyingTo(null); }} style={styles.backButton}><Feather name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
            <Text style={styles.commentModalTitle}>{t.comments.title}</Text>
            <View style={{ width: 40 }} />
          </View>
          {loadingComments ? <View style={styles.loadingCommentsContainer}><ActivityIndicator size="large" color="#00ff88" /></View>
            : <FlatList
                data={comments} keyExtractor={(item) => item.id}
                initialNumToRender={10} maxToRenderPerBatch={10} windowSize={5}
                renderItem={({ item }) => (
                  <View style={styles.commentItem}>
                    <TouchableOpacity onPress={() => handleUserPress(item.user_id)} activeOpacity={0.7}>
                      {item.user_photo_url ? <Image source={{ uri: item.user_photo_url }} style={styles.commentAvatar} /> : <View style={[styles.commentAvatar, styles.avatarPlaceholder]}><Feather name="user" size={16} color="#00ff88" /></View>}
                    </TouchableOpacity>
                    <View style={styles.commentContent}>
                      <View style={styles.commentHeader}>
                        <TouchableOpacity onPress={() => handleUserPress(item.user_id)} activeOpacity={0.7}>
                          <Text style={styles.commentDisplayName}>{item.display_name}</Text>
                          <Text style={styles.commentUsername}>@{item.username}</Text>
                        </TouchableOpacity>
                        <Text style={styles.commentTime}>{formatCommentTime(item.created_at)}</Text>
                      </View>
                      {item.parent_comment && (<View style={styles.replyingToContainer}><Feather name="corner-down-right" size={14} color="#00ff88" /><Text style={styles.replyingToText}>Replying to @{item.parent_comment.username}</Text></View>)}
                      <Text style={styles.commentText}>{item.text}</Text>
                      <View style={styles.commentActions}>
                        <TouchableOpacity style={styles.commentActionButton} onPress={() => handleCommentLike(item)} activeOpacity={0.7}>
                          <Feather name="heart" size={16} color={item.liked_by?.includes(userId) ? '#00ff88' : '#666'} />
                          {item.likes_count > 0 && <Text style={styles.commentActionCount}>{item.likes_count}</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.commentActionButton} onPress={() => handleReply(item)} activeOpacity={0.7}>
                          <Feather name="message-circle" size={16} color="#666" />
                          <Text style={styles.commentActionText}>Reply</Text>
                        </TouchableOpacity>
                        {item.replies_count > 0 && <Text style={styles.repliesCount}>{item.replies_count} {item.replies_count === 1 ? t.comments.reply1 : t.comments.replies}</Text>}
                      </View>
                    </View>
                  </View>
                )}
                contentContainerStyle={styles.commentsListContent}
                ListEmptyComponent={<View style={styles.emptyCommentsContainer}><Feather name="message-circle" size={48} color="#666" /><Text style={styles.emptyCommentsText}>{t.comments.noComments}</Text><Text style={styles.emptyCommentsSubtext}>{t.comments.noCommentsSubtext}</Text></View>}
              />}
          <View style={styles.commentInputContainer}>
            {replyingTo && (<View style={styles.replyingToBar}><Text style={styles.replyingToBarText}>Replying to @{replyingTo.username}</Text><TouchableOpacity onPress={handleCancelReply}><Feather name="x" size={20} color="#00ff88" /></TouchableOpacity></View>)}
            <View style={styles.commentInputRow}>
              {userProfile?.avatar_url ? <Image source={{ uri: userProfile.avatar_url }} style={styles.commentInputAvatar} /> : <View style={[styles.commentInputAvatar, styles.avatarPlaceholder]}><Feather name="user" size={16} color="#00ff88" /></View>}
              <TextInput style={styles.commentInput} value={commentText} onChangeText={setCommentText} placeholder={replyingTo ? `${t.comments.replyPlaceholder} @${replyingTo.username}...` : t.comments.placeholder} placeholderTextColor="#666" multiline maxLength={500} />
              <TouchableOpacity style={[styles.sendCommentButton, (!commentText.trim() || submittingComment) && styles.sendCommentButtonDisabled]} onPress={handleCommentSubmit} disabled={!commentText.trim() || submittingComment} activeOpacity={0.7}>
                {submittingComment ? <ActivityIndicator size="small" color="#000" /> : <Feather name="send" size={20} color="#000" />}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ✅ NEW: REPORT MODAL */}
      <Modal visible={reportModalVisible} transparent animationType="slide" onRequestClose={() => setReportModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={reportStyles.sheet}>
            <View style={reportStyles.handle} />
            <View style={reportStyles.header}>
              <Text style={reportStyles.title}>Report Video</Text>
              <TouchableOpacity onPress={() => setReportModalVisible(false)} style={styles.closeButton}>
                <Feather name="x" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={reportStyles.subtitle}>Why are you reporting @{reportPost?.username}'s video?</Text>
            <ScrollView style={reportStyles.list} showsVerticalScrollIndicator={false}>
              {REPORT_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[reportStyles.row, reportSubmitting && reportStyles.rowDisabled]}
                  onPress={() => submitReport(cat.id)}
                  activeOpacity={0.7}
                  disabled={reportSubmitting}
                >
                  <Text style={reportStyles.rowIcon}>{cat.icon}</Text>
                  <Text style={reportStyles.rowLabel}>{cat.label}</Text>
                  {reportSubmitting
                    ? <ActivityIndicator size="small" color="#00ff88" />
                    : <Feather name="chevron-right" size={18} color="#444" />
                  }
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={reportStyles.cancelBtn} onPress={() => setReportModalVisible(false)} activeOpacity={0.7}>
              <Text style={reportStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const videoShopStyles = StyleSheet.create({
  shopBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00ff88', marginTop: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, gap: 6, alignSelf: 'flex-start' },
  shopBtnIcon: { fontSize: 16 },
  shopBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
});

const endScreenStyles = StyleSheet.create({
  overlay:          { ...StyleSheet.absoluteFillObject, zIndex: 50, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  bg:               { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.82)' },
  watermarkBlock:   { alignItems: 'center', marginBottom: 20 },
  watermarkIcon:    { width: 56, height: 56, borderRadius: 14, marginBottom: 6, borderWidth: 2, borderColor: '#00ff88' },
  watermarkTitle:   { color: '#00ff88', fontSize: 24, fontWeight: '900', letterSpacing: 1 },
  watermarkSub:     { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2, letterSpacing: 0.5 },
  divider:          { width: '55%', height: 1, backgroundColor: '#00ff8833', marginBottom: 16, marginTop: 4 },
  statsRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 16, width: '100%' },
  statItem:         { flex: 1, alignItems: 'center', gap: 4 },
  statValue:        { color: '#fff', fontSize: 15, fontWeight: '800' },
  statLabel:        { color: '#666', fontSize: 10, fontWeight: '500' },
  statDivider:      { width: 1, height: 32, backgroundColor: '#222' },
  creatorRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 16, padding: 14, width: '100%' },
  creatorAvatar:    { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: '#00ff88' },
  avatarFallback:   { backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  creatorName:      { color: '#fff', fontSize: 14, fontWeight: '700' },
  creatorUsername:  { color: '#666', fontSize: 12, marginTop: 2 },
  followBtn:        { backgroundColor: '#00ff88', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  followingBtn:     { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#00ff88' },
  followBtnText:    { color: '#000', fontWeight: '800', fontSize: 13 },
  followingBtnText: { color: '#00ff88' },
  deleteBtn:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,68,68,0.12)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#ff4444' },
  deleteBtnText:    { color: '#ff4444', fontWeight: '700', fontSize: 13 },
  replayBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#00ff88', borderRadius: 28, paddingHorizontal: 32, paddingVertical: 14 },
  replayBtnText:    { color: '#000', fontWeight: '900', fontSize: 16, letterSpacing: 0.5 },
});

// ─── THREE-DOT MENU STYLES ────────────────────────────────────────────────────
const menuStyles = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36 },
  handle:      { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  row:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 14 },
  iconWrap:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  rowText:     { flex: 1 },
  rowTitle:    { color: '#fff', fontSize: 15, fontWeight: '600' },
  rowSub:      { color: '#666', fontSize: 12, marginTop: 2 },
  cancelBtn:   { marginHorizontal: 20, marginTop: 12, paddingVertical: 14, backgroundColor: '#1a1a1a', borderRadius: 14, alignItems: 'center' },
  cancelText:  { color: '#fff', fontSize: 15, fontWeight: '600' },
});

// ─── REPORT MODAL STYLES ──────────────────────────────────────────────────────
const reportStyles = StyleSheet.create({
  sheet:        { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, maxHeight: height * 0.75 },
  handle:       { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  title:        { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle:     { color: '#666', fontSize: 13, paddingHorizontal: 20, marginBottom: 12 },
  list:         { maxHeight: height * 0.5 },
  row:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 14 },
  rowDisabled:  { opacity: 0.5 },
  rowIcon:      { fontSize: 22, width: 32, textAlign: 'center' },
  rowLabel:     { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  cancelBtn:    { marginHorizontal: 20, marginTop: 16, paddingVertical: 14, backgroundColor: '#1a1a1a', borderRadius: 14, alignItems: 'center' },
  cancelText:   { color: '#fff', fontSize: 15, fontWeight: '600' },
});

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#000' },
  loadingContainer:     { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:          { color: '#fff', marginTop: 12, fontSize: 16 },
  emptyContainer:       { flex: 1, justifyContent: 'center', alignItems: 'center', height },
  emptyText:            { color: '#fff', fontSize: 20, fontWeight: '600', marginTop: 16 },
  emptySubtext:         { color: '#666', fontSize: 14, marginTop: 8 },
  videoContainer:       { width, height, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  videoBackground:      { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  videoTouchable:       { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  filterTintOverlay:    { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  watermarkOverlay:     { zIndex: 3, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  watermarkLogo:        { width: 24, height: 24 },
  watermarkText:        { color: '#00ff88', fontSize: 12, fontWeight: '700' },
  watermarkUsername:    { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 2 },
  effectBadge:          { position: 'absolute', top: 80, left: 12, zIndex: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center' },
  effectBadgeText:      { fontSize: 12, fontWeight: '700' },
  playOverlay:          { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 5 },
  playButton:           { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,255,136,0.2)', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#00ff88' },
  // ✅ NEW: three-dot menu button — top right, above vibe badge
  menuDotBtn:           { position: 'absolute', top: 12, right: 12, zIndex: 30, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  videoInfo:            { position: 'absolute', bottom: 68, left: 0, right: 80, paddingHorizontal: 16, zIndex: 6 },
  userInfoOverlay:      { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  userInfoContent:      { flexDirection: 'row', alignItems: 'center', flex: 1 },
  videoUserAvatar:      { width: 40, height: 40, borderRadius: 20, marginRight: 12, borderWidth: 2, borderColor: '#00ff88' },
  avatarPlaceholder:    { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  videoUserDetails:     { flex: 1 },
  videoDisplayName:     { color: '#fff', fontSize: 16, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  videoUsername:        { color: '#fff', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  followButtonVideo:    { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: '#00ff88' },
  followingButtonVideo: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#00ff88' },
  followButtonTextVideo:    { color: '#000', fontSize: 14, fontWeight: '600' },
  followingButtonTextVideo: { color: '#00ff88' },
  videoCaption:         { color: '#fff', fontSize: 14, lineHeight: 20, textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  locationContainer:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  locationText:         { color: '#00ff88', fontSize: 12 },
  musicContainer:       { position: 'absolute', bottom: 66, left: 16, right: 80, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, zIndex: 6 },
  musicText:            { color: '#00ff88', fontSize: 12, fontStyle: 'italic', flex: 1 },
  actionsRight:         { position: 'absolute', right: 16, bottom: 68, gap: 20, zIndex: 6 },
  actionButtonRight:    { alignItems: 'center', gap: 4 },
  iconContainer:        { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  actionTextRight:      { color: '#fff', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  actionTextRightGold:  { color: '#ffd700', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.75)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  viewsOverlay:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  viewsOverlayText:     { color: '#fff', fontSize: 12, fontWeight: '600' },
  coinsOverlay:         { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  coinsOverlayText:     { color: '#ffd700', fontSize: 12, fontWeight: '600' },
  vibeBadge:            { position: 'absolute', top: 52, right: 12, zIndex: 15, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1.5 },
  vibeBadgeEmoji:       { fontSize: 13 },
  vibeBadgeText:        { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  adContainer:          { width, height, backgroundColor: '#0a0a0a', justifyContent: 'center', alignItems: 'center', padding: 20 },
  ownerDeleteBtn:       { position: 'absolute', top: 52, right: 16, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: 8, borderWidth: 1, borderColor: 'rgba(255,68,68,0.5)' },
  modalOverlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  giftModal:            { backgroundColor: '#0a0a0a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: '80%' },
  giftModalHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  giftModalTitle:       { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  closeButton:          { padding: 4 },
  balanceInfo:          { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, backgroundColor: '#1a1a1a', marginHorizontal: 16, marginTop: 16, borderRadius: 12 },
  balanceText:          { color: '#ffd700', fontSize: 14, fontWeight: '600' },
  giftPackagesContainer:{ padding: 16 },
  giftPackage:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a1a1a', borderRadius: 12, marginBottom: 12, borderWidth: 2 },
  giftPackageLeft:      { flexDirection: 'row', alignItems: 'center', gap: 16 },
  giftIcon:             { fontSize: 40 },
  giftInfo:             { gap: 4 },
  giftName:             { color: '#fff', fontSize: 18, fontWeight: '600' },
  giftAmount:           { color: '#00ff88', fontSize: 14, fontWeight: '500' },
  giftLocalAmount:      { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  customGiftButton:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, marginHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: '#00ff88', borderStyle: 'dashed' },
  customGiftButtonText: { color: '#00ff88', fontSize: 16, fontWeight: '600' },
  customGiftContainer:  { padding: 20 },
  customGiftLabel:      { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  customGiftInput:      { backgroundColor: '#1a1a1a', color: '#fff', fontSize: 24, fontWeight: '600', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#00ff88', textAlign: 'center' },
  customGiftPreview:    { color: '#ffd700', fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  customGiftActions:    { flexDirection: 'row', gap: 12, marginTop: 24 },
  customGiftActionButton:{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12 },
  cancelButton:         { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#666' },
  cancelButtonText:     { color: '#fff', fontSize: 16, fontWeight: '600' },
  sendButton:           { backgroundColor: '#00ff88' },
  sendButtonText:       { color: '#000', fontSize: 16, fontWeight: '600' },
  commentModal:         { flex: 1, backgroundColor: '#000' },
  commentModalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  backButton:           { padding: 4 },
  commentModalTitle:    { color: '#fff', fontSize: 18, fontWeight: '600' },
  loadingCommentsContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  commentsListContent:  { padding: 16 },
  emptyCommentsContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyCommentsText:    { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptyCommentsSubtext: { color: '#666', fontSize: 14, marginTop: 8 },
  commentItem:          { flexDirection: 'row', marginBottom: 20, gap: 12 },
  commentAvatar:        { width: 36, height: 36, borderRadius: 18 },
  commentContent:       { flex: 1 },
  commentHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  commentDisplayName:   { color: '#fff', fontSize: 14, fontWeight: '600' },
  commentUsername:      { color: '#666', fontSize: 12 },
  commentTime:          { color: '#666', fontSize: 12 },
  replyingToContainer:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingLeft: 8 },
  replyingToText:       { color: '#00ff88', fontSize: 12, fontStyle: 'italic' },
  commentText:          { color: '#fff', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  commentActions:       { flexDirection: 'row', alignItems: 'center', gap: 16 },
  commentActionButton:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentActionCount:   { color: '#666', fontSize: 12 },
  commentActionText:    { color: '#666', fontSize: 12 },
  repliesCount:         { color: '#00ff88', fontSize: 12, fontWeight: '500' },
  commentInputContainer:{ backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  replyingToBar:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1a1a1a' },
  replyingToBarText:    { color: '#00ff88', fontSize: 14 },
  commentInputRow:      { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  commentInputAvatar:   { width: 32, height: 32, borderRadius: 16 },
  commentInput:         { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', fontSize: 14, padding: 12, borderRadius: 20, maxHeight: 100 },
  sendCommentButton:    { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center' },
  sendCommentButtonDisabled: { opacity: 0.5 },
  disabled:             { opacity: 0.5 },
});
