// app/(tabs)/index.tsx — LUMVIBE HOME FEED
// 2705 All original features preserved, nothing removed
// 2705 Videos excluded from home feed (media_type.eq.video removed)
// 2705 Unlike/gift use badge multiplier and fresh DB reads
// 2705 Ad + winner card injection fixed, algorithm v2 scoring
// 250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500250025002500
// v3.5 2014 AUTO-PLAY + SPEED:
//  2705 Voice posts AUTO-PLAY when scrolled into view (226550% visible)
//  2705 startAudio: shouldPlay:true in createAsync 2014 instant start on slow networks
//  2705 LazyImage: preloads on mount, not waiting for isVisible 2014 snappier
//  2705 Feed cache extended to 90s, FEED_SETTINGS tuned for 2GB phones


import React, { useEffect, useState, useCallback, memo, useRef, useMemo } from 'react';
// FIX 1: useFocusEffect from @react-navigation/native, not expo-router
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity, RefreshControl,
  ActivityIndicator, Alert, TextInput, Modal, ScrollView, Dimensions, Share,
  ViewabilityConfig, ViewToken, KeyboardAvoidingView, Platform, Animated,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
// FIX 1: relative paths replace @/ aliases
import { useAuthStore } from '../store/authStore';
import { supabase } from '../config/supabase';
import { useAudioPlayer, useAudioPlayerStatus, AudioModule } from 'expo-audio';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import { useTranslation } from '../locales/LanguageContext';
import NetInfo from '@react-native-community/netinfo';

const { width } = Dimensions.get('window');

// ─── FEED PERFORMANCE SETTINGS ───────────────────────────────────────────────
const FEED_SETTINGS = {
  windowSize: 3,                  // Keep 3 screens in memory — good balance for 2GB RAM
  maxToRenderPerBatch: 2,         // Render 2 at a time — smooth scroll without jank
  initialNumToRender: 2,          // Show 2 immediately on open — fast first paint
  updateCellsBatchingPeriod: 80,  // Batch updates every 80ms — responsive but not CPU-heavy
  itemVisiblePercentThreshold: 50, // Trigger at 50% visible — earlier audio start for slow buffers
};

const COIN_TO_NGN = 150;
function coinsToNGN(coins: number): string {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}

// ─── LOCAL CURRENCY DETECTION ────────────────────────────────────────────────
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

const POINTS_PER_VIEW    = 2;
const POINTS_PER_LIKE    = 10;
const POINTS_PER_COMMENT = 15;
const POINTS_PER_SHARE   = 30;

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

const BANNER_AD_UNIT_ID = __DEV__ ? TestIds.BANNER : 'ca-app-pub-8235065812461074/4176727692';

const GIFT_PACKAGES = [
  { id: 'rose',        name: 'Rose',        icon: '🌹', coins: 10,    ngn: 1_500,   color: '#ff69b4' },
  { id: 'ice_cream',   name: 'Ice Cream',   icon: '🍦', coins: 50,    ngn: 7_500,   color: '#00bfff' },
  { id: 'love_letter', name: 'Love Letter', icon: '💌', coins: 100,   ngn: 15_000,  color: '#ff4d8f' },
  { id: 'trophy',      name: 'Trophy',      icon: '🏆', coins: 500,   ngn: 75_000,  color: '#cd7f32' },
  { id: 'crown',       name: 'Crown',       icon: '👑', coins: 1000,  ngn: 150_000, color: '#ffd700' },
  { id: 'diamond',     name: 'Diamond',     icon: '💎', coins: 5000,  ngn: 750_000, color: '#00ffff' },
];

const GRADIENT_PRESETS = [
  { name: 'Sunset', colors: ['#FF6B6B', '#4ECDC4', '#45B7D1'] },
  { name: 'Ocean',  colors: ['#667eea', '#764ba2', '#f093fb'] },
  { name: 'Forest', colors: ['#134E5E', '#71B280'] },
  { name: 'Fire',   colors: ['#f12711', '#f5af19'] },
  { name: 'Purple', colors: ['#8E2DE2', '#4A00E0'] },
  { name: 'Pink',   colors: ['#FF0080', '#FF8C00', '#40E0D0'] },
];

const VIBE_TYPES: Record<string, { label: string; emoji: string; color: string }> = {
  fire:      { label: 'Fire',       emoji: '🔥', color: '#ff4500' },
  funny:     { label: 'Funny',      emoji: '😂', color: '#ffd700' },
  shocking:  { label: 'Shocking',   emoji: '😱', color: '#ff6b35' },
  love:      { label: 'Love',       emoji: '❤️', color: '#ff1744' },
  mindblow:  { label: 'Mind-blown', emoji: '🤯', color: '#aa00ff' },
  dead:      { label: 'Dead 💀',    emoji: '💀', color: '#00e5ff' },
  hype:      { label: 'Hype',       emoji: '🚀', color: '#00ff88' },
  sad:       { label: 'Sad',        emoji: '😢', color: '#448aff' },
};


// ✅ REPORT CATEGORIES
const REPORT_CATEGORIES = [
  { id: 'spam',       label: 'Spam or Misleading',               icon: '🚫' },
  { id: 'nudity',     label: 'Nudity or Sexual Content',         icon: '🔞' },
  { id: 'hate',       label: 'Hate Speech or Discrimination',    icon: '💢' },
  { id: 'violence',   label: 'Violence or Dangerous Acts',       icon: '⚠️' },
  { id: 'harassment', label: 'Harassment or Bullying',           icon: '👤' },
  { id: 'copyright',  label: 'Copyright Violation',              icon: '©️' },
  { id: 'minor',      label: 'Involves a Minor Inappropriately', icon: '🧒' },
  { id: 'illegal',    label: 'Illegal Activity',                 icon: '🔫' },
  { id: 'other',      label: 'Other',                            icon: '📋' },
];

function isRemoteUrl(uri: string): boolean {
  if (!uri) return false;
  return uri.startsWith('http://') || uri.startsWith('https://');
}

// ─── GLOBAL AUDIO MANAGER ────────────────────────────────────────────────────
const globalAudioManager = {
  currentSound: null as any | null,
  currentPostId: null as string | null,
  async stopCurrent() {
    if (this.currentSound) {
      try { this.currentSound.pause(); this.currentSound.remove(); } catch (_) {}
      this.currentSound = null; this.currentPostId = null;
    }
  },
  async play(sound: any, postId: string) {
    await this.stopCurrent();
    this.currentSound = sound; this.currentPostId = postId;
    try { await sound.playAsync(); } catch (_) {}
  },
};

// ─── ALGORITHM v2: computeScore ───────────────────────────────────────────────
// Beats TikTok on the signals TikTok ignores for African creators:
//   • Gifts (real money = strongest intent signal)
//   • Saves (deep interest)
//   • Virality ratio (engagement per view, not raw totals)
//   • Location relevance (Lagos creator → Lagos viewer boosted)
//   • Gentler decay (good posts survive 48h not 7h)
//   • Gradual new creator ramp (not binary cutoff)
function computeScore(
  post: {
    user_id: string;
    created_at: string;
    likes_count: number;
    comments_count: number;
    views_count: number;
    coins_received: number;
    saved_by?: string[];
    location?: string;
    media_type?: string | null;
  },
  followingSet: Set<string>,
  authorFollowers: number,
  viewerCity?: string,
): number {
  // 1. GENTLE TIME DECAY — good posts survive longer than on TikTok
  const ageHours = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);
  const decayFactor = 1 / (1 + Math.pow(ageHours, 0.8) * 0.08);

  // 2. ENGAGEMENT WEIGHTS — ordered by intent strength
  const saveCount = post.saved_by?.length ?? 0;
  const rawEngagement =
    post.coins_received * 50 +  // Gift = real money spent. Strongest possible signal.
    saveCount           * 8  +  // Save = "I want this later". Very strong intent.
    post.comments_count * 5  +  // Comment = effort signal.
    post.likes_count    * 2  +  // Like = common but meaningful.
    post.views_count    * 0.3;  // View = weakest, just exposure.

  // 3. VIRALITY RATIO — efficiency over raw numbers (TikTok's real secret)
  // 100 likes from 200 views ranks higher than 100 likes from 10,000 views
  const effectiveViews    = Math.max(post.views_count, 10);
  const engagementActions = post.likes_count + post.comments_count + saveCount + (post.coins_received > 0 ? 1 : 0);
  const viralityRatio     = engagementActions / effectiveViews;
  const viralityBoost     = 1 + Math.min(viralityRatio * 8, 1.0); // up to 2x

  // 4. FRESHNESS BURST — every post gets a fair test audience window
  const freshnessBurst = ageHours < 1 ? 35 : ageHours < 2 ? 25 : ageHours < 3 ? 15 : 0;

  // 5. SOCIAL GRAPH — posts from people you follow feel personal
  const followingBoost = followingSet.has(post.user_id) ? 1.6 : 1.0;

  // 6. NEW CREATOR RAMP — gradual 1.5x→1.0x across 500 followers (not binary)
  const newCreatorBoost = authorFollowers < 500
    ? 1.0 + (0.5 * (1 - authorFollowers / 500))
    : 1.0;

  // 7. LOCATION RELEVANCE — YOUR WEAPON AGAINST TIKTOK
  // TikTok cannot tell the difference between a Lagos creator making genuine
  // cultural content vs random African content. We can.
  let locationBoost = 1.0;
  if (viewerCity && post.location) {
    const vc = viewerCity.toLowerCase();
    const pl = post.location.toLowerCase();
    if (pl.includes(vc) || vc.includes(pl)) locationBoost = 1.4;
  }

  // 8. GIFT AUTHORITY — posts that have earned coins stay visible longer
  const giftAuthorityBoost = post.coins_received > 0
    ? 1.0 + Math.min(Math.log10(post.coins_received + 1) * 0.15, 0.4)
    : 1.0;

  // 9. MEDIA TYPE DIVERSITY — surface rarer content types
  const mediaTypeBoost =
    post.media_type === 'voice' ? 1.1 :
    post.media_type === 'text'  ? 1.05 : 1.0;

  return (
    (rawEngagement * decayFactor + freshnessBurst)
    * viralityBoost
    * followingBoost
    * newCreatorBoost
    * locationBoost
    * giftAuthorityBoost
    * mediaTypeBoost
  );
}

// ─── LAZY IMAGE ───────────────────────────────────────────────────────────────
// Pre-fetches image dimensions as soon as the component mounts (not waiting for
// isVisible) so the image is ready the instant it scrolls into view. On slow
// networks this shaves off the Image.getSize round-trip time from the visible
// display latency. shouldLoad starts true so the <Image> renders immediately.
function LazyImage({ uri, isVisible, style }: { uri: string; isVisible: boolean; style?: any }) {
  const [imgHeight, setImgHeight] = useState(width * 0.75); // sensible default — no layout jump

  useEffect(() => {
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => { if (w > 0) setImgHeight(Math.round((h / w) * width)); },
      () => setImgHeight(width)
    );
  }, [uri]);

  return (
    <Image
      source={{ uri }}
      style={[{ width, height: imgHeight, backgroundColor: '#1a1a1a' }, style]}
      resizeMode="contain"
      fadeDuration={100}
    />
  );
}

// ─── FLOATING CHAMPION ────────────────────────────────────────────────────────
function FloatingChampion({ winner, onPress, isOfficial }: { winner: WeeklyWinner; onPress: () => void; isOfficial: boolean }) {
  const pulse     = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(ringScale, { toValue: 1.55, duration: 1400, useNativeDriver: true }),
      Animated.timing(ringScale, { toValue: 1,    duration: 0,    useNativeDriver: true }),
    ])).start();
  }, []);
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const ringOpacity = ringScale.interpolate({ inputRange: [1, 1.55], outputRange: [0.7, 0] });
  return (
    <TouchableOpacity style={floatStyles.container} onPress={onPress} activeOpacity={0.85}>
      <Animated.View style={[floatStyles.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} pointerEvents="none" />
      <Animated.View style={[floatStyles.halo, { opacity: glowOpacity }]} pointerEvents="none" />
      <LinearGradient colors={['#FFD700', '#FFA500', '#FFD700']} style={floatStyles.avatarBorder}>
        {winner.avatar_url
          ? <Image source={{ uri: winner.avatar_url }} style={floatStyles.avatar} />
          : <View style={[floatStyles.avatar, floatStyles.avatarFallback]}><Feather name="user" size={18} color="#FFD700" /></View>}
      </LinearGradient>
      <View style={floatStyles.crownWrap} pointerEvents="none"><Text style={floatStyles.crownText}>👑</Text></View>
      <View style={floatStyles.label}>
        <Text style={floatStyles.labelTop}>{isOfficial ? '#1 Champion' : 'Current Leader'}</Text>
        <Text style={floatStyles.labelName} numberOfLines={1}>{winner.display_name.length > 10 ? winner.display_name.slice(0, 10) + '…' : winner.display_name}</Text>
      </View>
    </TouchableOpacity>
  );
}

const floatStyles = StyleSheet.create({
  container:      { position: 'absolute', bottom: 90, right: 14, alignItems: 'center', zIndex: 999, width: 62 },
  ring:           { position: 'absolute', width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderColor: '#FFD700', top: 0 },
  halo:           { position: 'absolute', width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFD700', top: 0, shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 18, elevation: 20 },
  avatarBorder:   { width: 62, height: 62, borderRadius: 31, padding: 2.5, justifyContent: 'center', alignItems: 'center' },
  avatar:         { width: 54, height: 54, borderRadius: 27, backgroundColor: '#111' },
  avatarFallback: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' },
  crownWrap:      { position: 'absolute', top: -13, alignSelf: 'center' },
  crownText:      { fontSize: 20 },
  label:          { marginTop: 5, backgroundColor: 'rgba(0,0,0,0.82)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center', borderWidth: 1, borderColor: '#FFD70055', width: 72, marginLeft: -5 },
  labelTop:       { color: '#FFD700', fontSize: 8, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  labelName:      { color: '#fff', fontSize: 10, fontWeight: '700', marginTop: 1 },
});

function useGlowPulse() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
    ])).start();
  }, []);
  return anim;
}

function WinnerGlowBorder({ children }: { children: React.ReactNode }) {
  const glow          = useGlowPulse();
  const borderOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const shadowRadius  = glow.interpolate({ inputRange: [0, 1], outputRange: [6, 22] });
  const scale         = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.003] });
  return (
    <Animated.View style={[winnerGlowStyles.wrapper, { transform: [{ scale }], shadowRadius, shadowOpacity: borderOpacity }]}>
      <Animated.View style={[winnerGlowStyles.borderLayer, { opacity: borderOpacity }]} pointerEvents="none">
        <LinearGradient colors={['#FFD700', '#FFA500', '#FFD700', '#FFF0A0', '#FFD700']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      </Animated.View>
      <View style={winnerGlowStyles.inner}>{children}</View>
      <View style={winnerGlowStyles.ribbon} pointerEvents="none">
        <LinearGradient colors={['#FFD700', '#FFA500']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={winnerGlowStyles.ribbonGradient}>
          <Text style={winnerGlowStyles.ribbonText}>👑 #1 This Week</Text>
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

const winnerGlowStyles = StyleSheet.create({
  wrapper:     { marginBottom: 16, borderRadius: 14, shadowColor: '#FFD700', shadowOffset: { width: 0, height: 0 }, elevation: 14, position: 'relative' },
  borderLayer: { ...StyleSheet.absoluteFillObject, borderRadius: 14, padding: 2, overflow: 'hidden' },
  inner:       { margin: 2.5, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0a0a0a' },
  ribbon:      { position: 'absolute', top: 10, left: -2, zIndex: 99, borderRadius: 4, overflow: 'hidden', elevation: 10 },
  ribbonGradient: { paddingHorizontal: 10, paddingVertical: 4, borderTopRightRadius: 8, borderBottomRightRadius: 8 },
  ribbonText:  { color: '#000', fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
});

// ─── INTERFACES ───────────────────────────────────────────────────────────────
interface Post {
  id: string; user_id: string; username: string; display_name: string;
  user_photo_url?: string; media_url?: string; media_type?: 'image' | 'voice' | 'text' | null; // ✅ video excluded — home feed never shows video
  caption: string; likes_count: number; comments_count: number; views_count: number;
  coins_received: number; liked_by: string[]; saved_by: string[];
  location?: string; music_url?: string; music_name?: string;
  music_artist?: string; created_at: string; has_watermark?: boolean;
  text_gradient?: string; voice_duration?: number; _score?: number;
  video_filter_tint?: string | null; applied_filter?: string | null;
  video_effect?: string | null; vibe_type?: string | null;
  cloudinary_public_id?: string | null;
}

interface Comment {
  id: string; post_id: string; user_id: string; username: string;
  display_name: string; user_photo_url?: string; text: string;
  likes_count: number; replies_count: number; liked_by: string[];
  parent_comment_id?: string; created_at: string;
  parent_comment?: { username: string; display_name: string; text: string; };
}

interface AdItem       { id: string; isAd: true; adIndex: number; }
interface WeeklyWinner { rank: 1 | 2 | 3; user_id: string; username: string; display_name: string; avatar_url?: string; weekly_points: number; week_start: string; }
interface WinnerCardItem { id: string; isWinnerCard: true; winners: WeeklyWinner[]; }
type FeedItem = Post | AdItem | WinnerCardItem;
function isAd(item: FeedItem): item is AdItem { return 'isAd' in item && item.isAd === true; }
function isWinnerCard(item: FeedItem): item is WinnerCardItem { return 'isWinnerCard' in item && (item as WinnerCardItem).isWinnerCard === true; }

const RANK_CONFIG = {
  1: { emoji: '🥇', color: '#FFD700', label: '1st Place', glow: '#FFD70044' },
  2: { emoji: '🥈', color: '#C0C0C0', label: '2nd Place', glow: '#C0C0C044' },
  3: { emoji: '🥉', color: '#CD7F32', label: '3rd Place', glow: '#CD7F3244' },
};

function useCountdownToSunday() {
  const calc = () => {
    const now = new Date(); const days = (7 - now.getDay()) % 7 || 7;
    const next = new Date(now); next.setDate(now.getDate() + days); next.setHours(0, 0, 0, 0);
    return Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  };
  const [secs, setSecs] = useState(calc);
  useEffect(() => { const t = setInterval(() => setSecs(calc()), 1000); return () => clearInterval(t); }, []);
  return { d: Math.floor(secs / 86400), h: Math.floor((secs % 86400) / 3600), m: Math.floor((secs % 3600) / 60), s: secs % 60 };
}

function MiniCountdown() {
  const { d, h, m, s } = useCountdownToSunday();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={winnerStyles.countdown}>
      <Text style={winnerStyles.countdownLabel}>🔄 Resets in </Text>
      {[{ v: d, u: 'D' }, { v: h, u: 'H' }, { v: m, u: 'M' }, { v: s, u: 'S' }].map(({ v, u }, i) => (
        <React.Fragment key={u}>
          {i > 0 && <Text style={winnerStyles.countdownColon}>:</Text>}
          <View style={winnerStyles.countdownBox}>
            <Text style={winnerStyles.countdownNum}>{pad(v)}</Text>
            <Text style={winnerStyles.countdownUnit}>{u}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

function WinnersBanner({ winners, onUserPress, isOfficial }: { winners: WeeklyWinner[]; onUserPress: (id: string) => void; isOfficial: boolean }) {
  const { t } = useTranslation();
  if (winners.length === 0) return null;
  return (
    <View style={winnerStyles.banner}>
      <LinearGradient colors={['#1a1200', '#0d0d0d', '#001a0a']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={winnerStyles.bannerGradient}>
        <View style={winnerStyles.bannerHeader}>
          <View style={winnerStyles.bannerHeaderRow}><Text style={winnerStyles.bannerTitle}>{isOfficial ? '🏆 This Week\'s Champions' : '📊 Current Standings'}</Text></View>
          {!isOfficial && <MiniCountdown />}
          {isOfficial && <Text style={winnerStyles.officialBadge}>✅ Officially Declared</Text>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={winnerStyles.bannerScroll}>
          {winners.map((winner) => {
            const cfg = RANK_CONFIG[winner.rank];
            return (
              <TouchableOpacity key={winner.user_id} style={[winnerStyles.bannerWinner, { borderColor: cfg.color, shadowColor: cfg.color }]} onPress={() => onUserPress(winner.user_id)} activeOpacity={0.8}>
                <View style={[winnerStyles.rankBadge, { backgroundColor: cfg.color }]}><Text style={winnerStyles.rankBadgeText}>{cfg.emoji}</Text></View>
                {winner.avatar_url
                  ? <Image source={{ uri: winner.avatar_url }} style={[winnerStyles.bannerAvatar, { borderColor: cfg.color }]} />
                  : <View style={[winnerStyles.bannerAvatar, winnerStyles.bannerAvatarPlaceholder, { borderColor: cfg.color }]}><Feather name="user" size={22} color={cfg.color} /></View>}
                <Text style={[winnerStyles.bannerName, { color: cfg.color }]} numberOfLines={1}>{winner.display_name}</Text>
                <Text style={winnerStyles.bannerUsername} numberOfLines={1}>@{winner.username}</Text>
                <Text style={winnerStyles.bannerPoints}>{winner.weekly_points.toLocaleString()} pts</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

function WinnerCardInFeed({ winners, onUserPress }: { winners: WeeklyWinner[]; onUserPress: (id: string) => void }) {
  const { t } = useTranslation();
  if (winners.length === 0) return null;
  return (
    <View style={winnerStyles.feedCard}>
      <LinearGradient colors={['#1a1200', '#0a0a0a']} style={winnerStyles.feedCardGradient}>
        <View style={winnerStyles.feedCardHeader}>
          <Text style={winnerStyles.feedCardTitle}>🏆 {t.videos.weeklyChampions}</Text>
          <Text style={winnerStyles.feedCardSub}>{t.videos.weeklyChampionsSub}</Text>
        </View>
        {winners.map((winner) => {
          const cfg = RANK_CONFIG[winner.rank];
          return (
            <TouchableOpacity key={winner.user_id} style={[winnerStyles.feedCardRow, { backgroundColor: cfg.glow }]} onPress={() => onUserPress(winner.user_id)} activeOpacity={0.8}>
              <Text style={[winnerStyles.feedCardRank, { color: cfg.color }]}>{cfg.emoji}</Text>
              {winner.avatar_url
                ? <Image source={{ uri: winner.avatar_url }} style={[winnerStyles.feedCardAvatar, { borderColor: cfg.color }]} />
                : <View style={[winnerStyles.feedCardAvatar, winnerStyles.bannerAvatarPlaceholder, { borderColor: cfg.color }]}><Feather name="user" size={16} color={cfg.color} /></View>}
              <View style={{ flex: 1 }}>
                <Text style={winnerStyles.feedCardName} numberOfLines={1}>{winner.display_name}</Text>
                <Text style={winnerStyles.feedCardUsername}>@{winner.username}</Text>
              </View>
              <View style={[winnerStyles.feedCardPoints, { borderColor: cfg.color }]}>
                <Text style={[winnerStyles.feedCardPointsText, { color: cfg.color }]}>{winner.weekly_points.toLocaleString()}</Text>
                <Text style={winnerStyles.feedCardPointsLabel}>pts</Text>
              </View>
            </TouchableOpacity>
          );
        })}
        <View style={winnerStyles.feedCardFooter}>
          <Text style={winnerStyles.feedCardFooterText}>🔄 {t.videos.resetsInfo}</Text>
          <Text style={winnerStyles.feedCardPointsGuide}>Post +50 · View +2 · Like +10 · Comment +15 · Share +30</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const winnerStyles = StyleSheet.create({
  banner:               { marginBottom: 8 },
  bannerGradient:       { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#FFD70033' },
  bannerHeader:         { paddingHorizontal: 16, marginBottom: 12 },
  bannerHeaderRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bannerTitle:          { color: '#FFD700', fontSize: 15, fontWeight: 'bold' },
  officialBadge:        { color: '#00ff88', fontSize: 11, fontWeight: '600', marginTop: 2 },
  countdown:            { flexDirection: 'row', alignItems: 'center', gap: 2 },
  countdownLabel:       { color: '#888', fontSize: 11 },
  countdownBox:         { alignItems: 'center', backgroundColor: '#1a1a0a', borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: '#FFD70033' },
  countdownNum:         { color: '#FFD700', fontSize: 13, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  countdownUnit:        { color: '#666', fontSize: 8 },
  countdownColon:       { color: '#FFD700', fontSize: 13, fontWeight: 'bold', marginHorizontal: 1 },
  bannerScroll:         { paddingHorizontal: 16, gap: 12 },
  bannerWinner:         { alignItems: 'center', width: 100, backgroundColor: '#111', borderRadius: 16, padding: 12, borderWidth: 1.5, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8, elevation: 6 },
  rankBadge:            { position: 'absolute', top: -10, right: -6, width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  rankBadgeText:        { fontSize: 13 },
  bannerAvatar:         { width: 56, height: 56, borderRadius: 28, borderWidth: 2, marginBottom: 8 },
  bannerAvatarPlaceholder: { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' },
  bannerName:           { fontSize: 12, fontWeight: 'bold', textAlign: 'center', maxWidth: 88 },
  bannerUsername:       { color: '#888', fontSize: 10, textAlign: 'center', marginTop: 2 },
  bannerPoints:         { color: '#00ff88', fontSize: 11, fontWeight: '600', marginTop: 4 },
  feedCard:             { marginHorizontal: 0, marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  feedCardGradient:     { padding: 16, borderWidth: 1, borderColor: '#FFD70033', borderRadius: 12 },
  feedCardHeader:       { marginBottom: 14 },
  feedCardTitle:        { color: '#FFD700', fontSize: 16, fontWeight: 'bold' },
  feedCardSub:          { color: '#888', fontSize: 12, marginTop: 3 },
  feedCardRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, marginBottom: 8 },
  feedCardRank:         { fontSize: 24, width: 32, textAlign: 'center' },
  feedCardAvatar:       { width: 44, height: 44, borderRadius: 22, borderWidth: 2 },
  feedCardName:         { color: '#fff', fontSize: 14, fontWeight: '600' },
  feedCardUsername:     { color: '#666', fontSize: 12, marginTop: 2 },
  feedCardPoints:       { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  feedCardPointsText:   { fontSize: 14, fontWeight: 'bold' },
  feedCardPointsLabel:  { color: '#888', fontSize: 9, marginTop: 1 },
  feedCardFooter:       { marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#222', alignItems: 'center' },
  feedCardFooterText:   { color: '#555', fontSize: 11, textAlign: 'center' },
  feedCardPointsGuide:  { color: '#00ff8866', fontSize: 10, textAlign: 'center', marginTop: 4, fontWeight: '600', letterSpacing: 0.3 },
});

// ─── AD POST (Instagram/Twitter-style native card — looks like a real PostCard) ─
const NATIVE_AD_SLOTS_FEED = [
  {
    advertiser:  'LumVibe Premium',
    username:    'lumvibe',
    caption:     '🚀 Go Premium — zero ads, exclusive creator badges, and priority support. Upgrade now!',
    gradient:    ['#001a0d', '#0d1a0d', '#001a0d'] as const,
    accentColor: '#00ff88',
    ctaLabel:    'Get Premium',
    ctaRoute:    '/buy-coins',
    bgEmoji:     '💎',
    tagline:     'Unlock the full LumVibe experience',
  },
  {
    advertiser:  'LumVibe Coins',
    username:    'lumvibe',
    caption:     '🪙 Top up your wallet and show your favourite creators some love with gifts!',
    gradient:    ['#1a1200', '#1a1000', '#1a1200'] as const,
    accentColor: '#ffd700',
    ctaLabel:    'Buy Coins',
    ctaRoute:    '/buy-coins',
    bgEmoji:     '🪙',
    tagline:     'Support creators with real value',
  },
  {
    advertiser:  'LumVibe Creator Fund',
    username:    'lumvibe',
    caption:     '🎬 Turn your creativity into income. Start posting on LumVibe and earn today!',
    gradient:    ['#0d001a', '#160d1a', '#0d001a'] as const,
    accentColor: '#a855f7',
    ctaLabel:    'Start Creating',
    ctaRoute:    '/(tabs)/create',
    bgEmoji:     '🎬',
    tagline:     'Creators earn real money here',
  },
];

function NativeAdPost({ adIndex }: { adIndex: number }) {
  const navigation = useNavigation<any>();
  const slot    = NATIVE_AD_SLOTS_FEED[adIndex % NATIVE_AD_SLOTS_FEED.length];
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,    duration: 1000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={styles.postCard}>
      {/* ── HEADER ── */}
      <View style={styles.postHeader}>
        <View style={styles.userInfo}>
          <View style={[styles.userAvatar, styles.avatarPlaceholder, feedAdStyles.avatarBorder, { borderColor: slot.accentColor }]}>
            <MaterialCommunityIcons name="storefront-outline" size={20} color={slot.accentColor} />
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.displayName}>{slot.advertiser}</Text>
            <Text style={styles.username}>@{slot.username}</Text>
          </View>
        </View>
        {/* "Promoted" label — clearly readable, AdMob policy compliant */}
        <View style={feedAdStyles.sponsoredPill}>
          <Text style={feedAdStyles.sponsoredText}>📢 Promoted</Text>
        </View>
      </View>

      {/* ── AD CREATIVE — clearly a promo card, not disguised as a real post ── */}
      <TouchableOpacity
        style={styles.textPostContainer}
        onPress={() => navigation.navigate(slot.ctaRoute.replace('/(tabs)/', '').replace('/', '') as any)}
        activeOpacity={0.92}
      >
        <LinearGradient colors={slot.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.textPostGradient}>
          <Animated.Text
            style={[feedAdStyles.bgEmoji, { transform: [{ scale: pulseAnim }] }]}
            pointerEvents="none"
          >
            {slot.bgEmoji}
          </Animated.Text>
          <View style={styles.textPostContent}>
            <Text style={[styles.textPostText, { color: slot.accentColor }]}>{slot.tagline}</Text>
          </View>
          {/* LumVibe watermark — correctly branded */}
          <View style={styles.textPostWatermark}>
            <MaterialCommunityIcons name="shield-check" size={14} color={slot.accentColor} />
            <Text style={[styles.watermarkText, { color: slot.accentColor }]}>LumVibe</Text>
          </View>
        </LinearGradient>
      </TouchableOpacity>

      {/* Caption */}
      <View style={styles.captionContainer}>
        <Text style={styles.captionUsername}>@{slot.username}</Text>
        <Text style={styles.captionText}>{slot.caption}</Text>
      </View>

      {/* CTA button — clearly separate from banner ad below */}
      <TouchableOpacity
        style={[feedAdStyles.ctaButton, { borderColor: slot.accentColor }]}
        onPress={() => navigation.navigate(slot.ctaRoute.replace('/(tabs)/', '').replace('/', '') as any)}
        activeOpacity={0.8}
      >
        <Text style={[feedAdStyles.ctaButtonText, { color: slot.accentColor }]}>{slot.ctaLabel} →</Text>
      </TouchableOpacity>

      {/* ── ADMOB BANNER — clearly labelled, separated from all buttons ── */}
      <View style={feedAdStyles.bannerAdContainer}>
        <Text style={feedAdStyles.bannerAdLabel}>Advertisement</Text>
        <BannerAd
          unitId={BANNER_AD_UNIT_ID}
          size={BannerAdSize.BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: false }}
          onAdLoaded={() => {}}
          onAdFailedToLoad={() => {}}
        />
      </View>
    </View>
  );
}

const feedAdStyles = StyleSheet.create({
  avatarBorder:      { borderWidth: 2 },
  // "Promoted" — large enough to read clearly per AdMob policy
  sponsoredPill:     { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  sponsoredText:     { color: '#ccc', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  bgEmoji:           { position: 'absolute', fontSize: 140, opacity: 0.1 },
  // CTA button — clearly separated from the AdMob banner below
  ctaButton:         { marginHorizontal: 16, marginTop: 4, marginBottom: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  ctaButtonText:     { fontSize: 14, fontWeight: '800' },
  // AdMob banner — clearly labelled, at the bottom with padding so nothing tappable is adjacent
  bannerAdContainer: { alignItems: 'center', paddingVertical: 8, paddingTop: 4, backgroundColor: 'rgba(0,0,0,0.06)', borderTopWidth: 1, borderTopColor: '#1a1a1a', marginTop: 4 },
  bannerAdLabel:     { color: '#666', fontSize: 10, marginBottom: 4, letterSpacing: 0.5, fontWeight: '600' },
});

// ─── POST CARD ────────────────────────────────────────────────────────────────
const PostCard = memo(({
  item, user, onLike, onComment, onSave, onGift, onFollow, onUserPress, onShare, onDelete, onReport, isVisible, onView, followStatusMap, isTopWinner
}: {
  item: Post; user: any; onLike: (post: Post) => void; onComment: (post: Post) => void;
  onSave: (post: Post) => void; onGift: (post: Post) => void;
  onFollow: (userId: string, isFollowing: boolean) => Promise<void>;
  onUserPress: (userId: string) => void; onShare: (post: Post) => void;
  onDelete: (post: Post) => void;
  onReport: (post: Post) => void; // ✅ NEW
  isVisible: boolean; onView: (postId: string) => void;
  followStatusMap: Map<string, boolean>; isTopWinner?: boolean;
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>(); // FIX 4: replaces useRouter
  const isFollowing    = followStatusMap.get(item.user_id) || false;
  const [checkingFollow, setCheckingFollow] = useState(false);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [voiceProgress,  setVoiceProgress]  = useState(0);
  const viewedRef = useRef(false);
  const soundRef  = useRef<any | null>(null);

  const wmX       = useRef(new Animated.Value(8)).current;
  const wmY       = useRef(new Animated.Value(8)).current;
  const wmOpacity = useRef(new Animated.Value(0.85)).current;

  // ✅ BUG FIX: Waveform heights memoized — no more flickering on re-render
  // Previously Math.random() was called on every render causing bars to jump
  const waveformHeights = useMemo(
    () => Array.from({ length: 40 }, () => Math.random() * 30 + 10),
    [item.id]
  );

  useEffect(() => {
    if (!item.media_url || item.media_type !== 'image') return;
    const W = width - 160;
    const H = 340;
    const positions = [{ x: 8, y: 8 }, { x: W, y: 8 }, { x: 8, y: H }, { x: W, y: H }];
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

  const userId  = user?.id || (user as any)?.id;
  const isLiked = userId ? item.liked_by?.includes(userId) : false;

  const FILTER_TINT_MAP: Record<string, string> = {
    beauty: 'rgba(255,200,200,0.18)', vintage: 'rgba(180,120,60,0.25)',
    cool: 'rgba(100,180,255,0.22)', warm: 'rgba(255,160,50,0.22)',
    dramatic: 'rgba(0,0,0,0.35)', bright: 'rgba(255,255,200,0.18)',
    noir: 'rgba(0,0,0,0.5)', neon: 'rgba(0,255,136,0.2)',
    sunset: 'rgba(255,80,80,0.25)', blur: 'rgba(255,255,255,0.18)',
    cinematic: 'rgba(20,10,40,0.45)', golden: 'rgba(255,200,50,0.22)',
    rose: 'rgba(255,100,150,0.22)', matrix: 'rgba(0,80,20,0.35)',
  };
  const resolvedTint: string | null = item.video_filter_tint || (item.applied_filter && item.applied_filter !== 'original' && item.applied_filter !== 'none' ? FILTER_TINT_MAP[item.applied_filter] || null : null);
  const isSaved      = userId ? item.saved_by?.includes(userId) : false;
  const isOwnPost    = userId === item.user_id;
  const gradientColors = item.text_gradient ? JSON.parse(item.text_gradient) : GRADIENT_PRESETS[0].colors;
  const isTextPost   = (!item.media_url || item.media_type === 'text') && !!item.caption;

  // ── AUTO-PLAY ─────────────────────────────────────────────────────────────
  // Auto-plays audio as soon as the post scrolls into view (≥50% visible).
  // Voice posts:  plays media_url (the voice recording).
  // Image/text:   loops music_url quietly at 0.7 volume if present.
  // User can tap the play button to pause/resume at any time.
  // When the post scrolls out of view, audio stops and memory is freed.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isVisible) {
        if (!viewedRef.current) { viewedRef.current = true; onView(item.id); }
        // Pick the correct audio URI and loop flag
        const isVoice = item.media_type === 'voice';
        const audioUri = isVoice && item.media_url && isRemoteUrl(item.media_url)
          ? item.media_url
          : (!isVoice && item.music_url && isRemoteUrl(item.music_url))
            ? item.music_url
            : null;
        const loop = !isVoice; // voice plays once, background music loops
        if (audioUri && !cancelled) await startAudio(audioUri, loop, () => cancelled);
      } else {
        cancelled = true;
        if (soundRef.current) {
          try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch (_) {}
          soundRef.current = null;
        }
        if (globalAudioManager.currentPostId === item.id) {
          globalAudioManager.currentSound = null; globalAudioManager.currentPostId = null;
        }
        setIsPlaying(false); setVoiceProgress(0);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (soundRef.current) {
        soundRef.current.stopAsync().catch(() => {});
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
      if (globalAudioManager.currentPostId === item.id) {
        globalAudioManager.currentSound = null; globalAudioManager.currentPostId = null;
      }
    };
  }, [isVisible, item.id]);

  // ── startAudio ────────────────────────────────────────────────────────────
  // Loads and plays a Cloudinary audio URL. Plain upload URLs (no transforms)
  // are served as direct CDN streams — expo-av loads them in a single call.
  // shouldPlay:true in createAsync starts playback immediately as the first
  // bytes arrive (progressive download) — much faster on slow networks than
  // calling createAsync then playAsync as two separate native calls.
  const startAudio = async (uri: string, loop: boolean, isCancelled: () => boolean) => {
    if (!uri || (!isRemoteUrl(uri) && !uri.startsWith('file://'))) return;
    try {
      if (soundRef.current) {
        try { soundRef.current.pause(); soundRef.current.remove(); } catch (_) {}
        soundRef.current = null;
      }
      await globalAudioManager.stopCurrent();
      if (isCancelled()) return;

      await (AudioModule as any).setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      }).catch(() => {});
      if (isCancelled()) return;

      const isCloudinaryUrl = uri.includes('cloudinary.com');
      const sourceObj = isCloudinaryUrl
        ? { uri, overrideFileExtensionAndroid: 'm4a' }
        : { uri };

      // shouldPlay:true starts playback the moment the first bytes arrive —
      // no need to call playAsync separately, saving one async round-trip.
      // progressUpdateIntervalMillis:250 gives smooth waveform progress on slow nets.
      // expo-audio API (replaces expo-av Audio.Sound)
      const { createAudioPlayer } = require('expo-audio');
      const player = createAudioPlayer(sourceObj);
      if (isCancelled()) { try { player.remove(); } catch (_) {} return; }

      soundRef.current = player;
      globalAudioManager.currentSound = player;
      globalAudioManager.currentPostId = item.id;
      player.volume = loop ? 0.7 : 1.0;
      player.loop = loop;

      if (!loop) {
        player.addListener('playbackStatusUpdate', (status: any) => {
          if (status.isLoaded && status.duration > 0)
            setVoiceProgress(status.currentTime / status.duration);
          if (status.didJustFinish) { setIsPlaying(false); setVoiceProgress(0); }
        });
      }
      await player.play();
      if (!isCancelled()) setIsPlaying(true);
    } catch (e) {
      console.warn('[LumVibe] startAudio failed for uri:', uri, e);
      setIsPlaying(false);
    }
  };

  const stopAudio = async () => {
    if (soundRef.current) {
      try { soundRef.current.pause(); soundRef.current.remove(); } catch (_) {}
      soundRef.current = null;
      if (globalAudioManager.currentPostId === item.id) {
        globalAudioManager.currentSound = null; globalAudioManager.currentPostId = null;
      }
    }
    setIsPlaying(false); setVoiceProgress(0);
  };

  const toggleVoicePlayback = async () => {
    if (!item.media_url || !isRemoteUrl(item.media_url)) return;
    // ✅ FIX: If soundRef exists and is loaded, toggle play/pause normally.
    // If soundRef exists but isn't loaded (e.g. error state), unload and reload.
    // If soundRef is null (auto-play hasn't completed yet), start fresh.
    if (soundRef.current) {
      try {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (isPlaying) { await soundRef.current.pauseAsync(); setIsPlaying(false); }
          else           { await soundRef.current.playAsync();  setIsPlaying(true);  }
          return;
        }
        // Sound exists but isn't loaded — unload and fall through to reload below
        try { await soundRef.current.unloadAsync(); } catch (_) {}
        soundRef.current = null;
        if (globalAudioManager.currentPostId === item.id) {
          globalAudioManager.currentSound = null; globalAudioManager.currentPostId = null;
        }
      } catch (_) {
        // getStatusAsync failed — unload and reload
        try { await soundRef.current?.unloadAsync(); } catch (_) {}
        soundRef.current = null;
      }
    }
    // soundRef is null — start fresh (handles first tap and error-recovery)
    await startAudio(item.media_url, false, () => false);
  };

  const toggleMusicPlayback = async () => {
    if (!item.music_url || !isRemoteUrl(item.music_url)) return;
    if (soundRef.current) {
      try {
        const status = await soundRef.current.getStatusAsync();
        if (status.isLoaded) {
          if (isPlaying) { await soundRef.current.pauseAsync(); setIsPlaying(false); }
          else           { await soundRef.current.playAsync();  setIsPlaying(true);  }
          return;
        }
        try { await soundRef.current.unloadAsync(); } catch (_) {}
        soundRef.current = null;
        if (globalAudioManager.currentPostId === item.id) {
          globalAudioManager.currentSound = null; globalAudioManager.currentPostId = null;
        }
      } catch (_) {
        try { await soundRef.current?.unloadAsync(); } catch (_) {}
        soundRef.current = null;
      }
    }
    await startAudio(item.music_url, true, () => false);
  };

  const handleFollow = async () => {
    if (checkingFollow) return;
    setCheckingFollow(true);
    try { await onFollow(item.user_id, isFollowing); }
    catch (e) { Alert.alert('Error', 'Failed to update follow status'); }
    finally { setCheckingFollow(false); }
  };

  const handlePostOptions = () => {
    if (!isOwnPost) return;
    // ✅ FIXED: Share option added alongside Delete
    Alert.alert('Post Options', '', [
      {
        text: '🔗 Share',
        onPress: () => onShare(item),
      },
      {
        text: '🗑️ Delete Post',
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            'Delete Post',
            'Permanently delete your post and all its likes, comments, and coins? This cannot be undone.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => onDelete(item) },
            ]
          );
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const formatTime = (timestamp: string) => {
    if (!timestamp) return 'Just now';
    const diff = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  return (
    <View style={[styles.postCard, isTopWinner && styles.postCardWinner]}>
      {/* POST HEADER */}
      <View style={styles.postHeader}>
        <TouchableOpacity style={styles.userInfo} onPress={() => onUserPress(item.user_id)} activeOpacity={0.7}>
          <View style={{ position: 'relative', marginRight: 12 }}>
            {item.user_photo_url
              ? <Image source={{ uri: item.user_photo_url }} style={[styles.userAvatar, isTopWinner && styles.winnerAvatar]} fadeDuration={200} />
              : <View style={[styles.userAvatar, styles.avatarPlaceholder, isTopWinner && styles.winnerAvatar]}><Feather name="user" size={20} color={isTopWinner ? '#FFD700' : '#00ff88'} /></View>}
            {isTopWinner && (<View style={styles.crownBadge} pointerEvents="none"><Text style={styles.crownEmoji}>👑</Text></View>)}
          </View>
          <View style={styles.userDetails}>
            {isTopWinner
              ? <LinearGradient colors={['#FFD700', '#FFA500', '#FFD700']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.winnerNameGradient}><Text style={styles.winnerDisplayName}>{item.display_name}</Text></LinearGradient>
              : <Text style={styles.displayName}>{item.display_name}</Text>}
            <Text style={[styles.username, isTopWinner && styles.winnerUsername]}>@{item.username}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.headerRightContainer}>
          <Text style={styles.timestamp}>{formatTime(item.created_at)}</Text>
          {isOwnPost
            ? <TouchableOpacity style={styles.optionsButton} onPress={handlePostOptions} activeOpacity={0.7}>
                <Feather name="more-horizontal" size={24} color="#fff" />
              </TouchableOpacity>
            : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {/* ✅ NEW: Report button for other users' posts */}
                <TouchableOpacity
                  style={styles.optionsButton}
                  onPress={() => onReport(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="more-horizontal" size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.followButton, isFollowing && styles.followingButton, checkingFollow && styles.followButtonDisabled]}
                  onPress={handleFollow}
                  disabled={checkingFollow}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.followButtonText, isFollowing && styles.followingButtonText]}>
                    {checkingFollow ? '...' : isFollowing ? t.common.following : t.common.follow}
                  </Text>
                </TouchableOpacity>
              </View>
            )
          }
        </View>
      </View>

      {/* VOICE POST — music-player style with cover art */}
      {item.media_type === 'voice' && item.media_url && (
        <View style={styles.voicePostOuterContainer}>
          {/* Cover art — full width, square-ish */}
          <View style={styles.voiceCoverContainer}>
            {item.user_photo_url
              ? <Image source={{ uri: item.user_photo_url }} style={styles.voiceCoverImage} resizeMode="cover" />
              : <LinearGradient colors={['#1a3a2a', '#0d1f16']} style={styles.voiceCoverImage}>
                  <Feather name="mic" size={64} color="#00ff88" />
                </LinearGradient>
            }
            {/* Dark gradient overlay at the bottom of the cover */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.voiceCoverGradient}
            />
            {/* Track title + artist on the cover */}
            <View style={styles.voiceCoverMeta}>
              <Text style={styles.voiceCoverTitle} numberOfLines={1}>
                {item.caption || item.display_name}
              </Text>
              <Text style={styles.voiceCoverArtist} numberOfLines={1}>
                {item.display_name}
              </Text>
            </View>
          </View>

          {/* Player controls row */}
          <View style={styles.voicePlayerRow}>
            {/* Progress bar */}
            <View style={styles.voiceProgressTrack}>
              <View style={[styles.voiceProgressFill, { width: `${voiceProgress * 100}%` }]} />
            </View>

            {/* Time + controls */}
            <View style={styles.voiceControlsRow}>
              <Text style={styles.voiceTimeText}>
                {item.voice_duration
                  ? formatDuration(item.voice_duration * voiceProgress)
                  : '0:00'}
              </Text>
              <TouchableOpacity style={styles.voicePlayButton} onPress={toggleVoicePlayback} activeOpacity={0.7}>
                <Feather name={isPlaying ? 'pause' : 'play'} size={22} color="#000" />
              </TouchableOpacity>
              <Text style={styles.voiceTimeText}>
                {item.voice_duration ? formatDuration(item.voice_duration) : '0:00'}
              </Text>
            </View>

            {/* Mini waveform */}
            <View style={styles.voiceWaveform}>
              {waveformHeights.map((h, i) => (
                <View key={i} style={[styles.voiceWaveformBar, {
                  height: h * 0.7,
                  backgroundColor: i / 40 < voiceProgress ? '#00ff88' : '#333'
                }]} />
              ))}
            </View>
          </View>
        </View>
      )}

      {/* TEXT POST */}
      {isTextPost && item.media_type !== 'voice' && (
        <View style={styles.textPostContainer}>
          <LinearGradient colors={gradientColors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.textPostGradient}>
            <View style={styles.textPostContent}><Text style={styles.textPostText}>{item.caption}</Text></View>
            <View style={styles.textPostWatermark}>
              <Image source={require('../assets/images/adaptive-icon.png')} style={styles.watermarkLogo} resizeMode="contain" />
              <View><Text style={styles.watermarkText}>LumVibe</Text><Text style={styles.watermarkUsername}>@{item.username}</Text></View>
            </View>
          </LinearGradient>
        </View>
      )}

      {/* ✅ VIDEO BLOCK REMOVED — videos only show in videos.tsx */}

            {/* IMAGE POST — lazy loads only when visible */}
      {item.media_url && item.media_type === 'image' && (
        <View style={styles.mediaContainer}>
          <LazyImage uri={item.media_url} isVisible={isVisible} />
          {!!resolvedTint && (<View style={[StyleSheet.absoluteFillObject, { backgroundColor: resolvedTint }]} pointerEvents="none" />)}
          <Animated.View style={[styles.watermarkOverlay, { top: 0, left: 0, bottom: undefined, right: undefined, transform: [{ translateX: wmX }, { translateY: wmY }], opacity: wmOpacity }]}>
            <Image source={require('../assets/images/adaptive-icon.png')} style={styles.watermarkLogo} resizeMode="contain" />
            <View><Text style={styles.watermarkText}>LumVibe</Text><Text style={styles.watermarkUsername}>@{item.username}</Text></View>
          </Animated.View>
        </View>
      )}

      {/* VIBE BADGE */}
      {item.vibe_type && VIBE_TYPES[item.vibe_type] && (
        <View style={[vibeStyles.badge, { backgroundColor: VIBE_TYPES[item.vibe_type].color + '18', borderColor: VIBE_TYPES[item.vibe_type].color + '88' }]}>
          <Text style={vibeStyles.emoji}>{VIBE_TYPES[item.vibe_type].emoji}</Text>
          <Text style={[vibeStyles.label, { color: VIBE_TYPES[item.vibe_type].color }]}>{VIBE_TYPES[item.vibe_type].label}</Text>
        </View>
      )}

      {/* ACTIONS */}
      <View style={styles.actionsContainer}>
        <View style={styles.actionsLeft}>
          <TouchableOpacity style={styles.actionButton} onPress={() => onLike(item)} activeOpacity={0.7}>
            <Feather name="heart" size={28} color={isLiked ? '#00ff88' : '#666'} />
            <Text style={styles.actionCount}>{item.likes_count}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={() => onComment(item)} activeOpacity={0.7}>
            <Feather name="message-circle" size={26} color="#666" />
            <Text style={styles.actionCount}>{item.comments_count}</Text>
          </TouchableOpacity>
          {!isOwnPost && (
            <TouchableOpacity style={styles.actionButton} onPress={() => onGift(item)} activeOpacity={0.7}>
              <MaterialCommunityIcons name="gift-outline" size={28} color="#ffd700" />
              <Text style={styles.actionCountGold}>{item.coins_received > 0 ? item.coins_received.toFixed(0) : 'Gift'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={() => onShare(item)} activeOpacity={0.7}>
            <Feather name="share-2" size={26} color="#666" />
          </TouchableOpacity>
        </View>
        <View style={styles.actionsRight}>
          {item.coins_received > 0 && (
            <View style={styles.coinsEarned}>
              <MaterialCommunityIcons name="diamond" size={16} color="#ffd700" />
              <Text style={styles.coinsText}>{item.coins_received.toFixed(2)}</Text>
            </View>
          )}
          <TouchableOpacity style={styles.actionButton} onPress={() => onSave(item)} activeOpacity={0.7}>
            <Feather name="bookmark" size={26} color={isSaved ? '#00ff88' : '#666'} />
          </TouchableOpacity>
        </View>
      </View>

      {item.views_count > 0 && (<View style={styles.viewsContainer}><Feather name="eye" size={14} color="#666" /><Text style={styles.viewsText}>{item.views_count} {item.views_count === 1 ? 'view' : 'views'}</Text></View>)}
      {item.location && (<View style={styles.locationContainer}><Feather name="map-pin" size={12} color="#00ff88" /><Text style={styles.locationText}>{item.location}</Text></View>)}
      {item.music_name && item.media_type !== 'voice' && (
        <TouchableOpacity style={styles.musicContainer} onPress={toggleMusicPlayback} activeOpacity={0.7}>
          <Feather name={isPlaying ? "volume-2" : "music"} size={12} color="#00ff88" />
          <Text style={styles.musicText}>{item.music_name}{item.music_artist ? ` - ${item.music_artist}` : ''}{isPlaying ? ' • Playing' : ' • Tap to play'}</Text>
        </TouchableOpacity>
      )}
      {item.caption && item.media_url && item.media_type !== 'voice' && item.media_type !== 'text' && (
        <View style={styles.captionContainer}>
          <Text style={styles.captionUsername}>@{item.username}</Text>
          <Text style={styles.captionText}>{item.caption}</Text>
        </View>
      )}

      {/* ── MARKETPLACE SHOP NOW BUTTON ── */}
      {item.vibe_type === 'marketplace' && (() => {
        // Support both approaches:
        // 1. New: marketplace_listing_id column in posts table
        // 2. Old/fallback: cloudinary_public_id = 'marketplace_listing_<id>'
        const listingIdFromColumn = (item as any).marketplace_listing_id as string | null | undefined;
        const listingIdFromPublicId = item.cloudinary_public_id?.startsWith('marketplace_listing_')
          ? item.cloudinary_public_id.replace('marketplace_listing_', '')
          : null;
        const listingId = listingIdFromColumn || listingIdFromPublicId;
        if (!listingId) return null;
        // Price: prefer marketplace_price column, fall back to parsing caption
        const price = (item as any).marketplace_price
          || item.caption?.match(/(\d+) coins/)?.[1]
          || '';
        // Title: prefer marketplace_title column, fall back to first line of caption
        const title = (item as any).marketplace_title
          || item.caption?.split('\n')[0]?.replace(/^[^\w]*/, '').trim()
          || 'View Service';
        return (
          <TouchableOpacity
            style={shopStyles.shopBtn}
            onPress={() => navigation.navigate("MarketplaceListing", { listingId })}
            activeOpacity={0.85}
          >
            <Text style={shopStyles.shopBtnIcon}>🛍️</Text>
            <Text style={shopStyles.shopBtnText} numberOfLines={1}>
              Shop Now{price ? ` — ${price} coins` : ''}
            </Text>
            <Feather name="chevron-right" size={16} color="#000" />
          </TouchableOpacity>
        );
      })()}
    </View>
  );
});

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { userProfile, user, loadProfile } = useAuthStore();
  const { t } = useTranslation();
  const userId = user?.id || (user as any)?.id;

  const [posts,               setPosts]               = useState<Post[]>([]);
  const [feedItems,           setFeedItems]           = useState<FeedItem[]>([]);
  const [loading,             setLoading]             = useState(true);
  const [refreshing,          setRefreshing]          = useState(false);
  const [selectedPost,        setSelectedPost]        = useState<Post | null>(null);
  const [comments,            setComments]            = useState<Comment[]>([]);
  const [commentText,         setCommentText]         = useState('');
  const [commentModalVisible, setCommentModalVisible] = useState(false);
  const [loadingComments,     setLoadingComments]     = useState(false);
  const [submittingComment,   setSubmittingComment]   = useState(false);
  const [visiblePostId,       setVisiblePostId]       = useState<string | null>(null);
  const [replyingTo,          setReplyingTo]          = useState<Comment | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [followStatusMap,     setFollowStatusMap]     = useState<Map<string, boolean>>(new Map());
  const [weeklyWinners,       setWeeklyWinners]       = useState<WeeklyWinner[]>([]);
  const [winnersAreOfficial,  setWinnersAreOfficial]  = useState(false);
  const [giftModalVisible,    setGiftModalVisible]    = useState(false);
  // ✅ NEW: Report modal state
  const [reportModalVisible,  setReportModalVisible]  = useState(false);
  const [reportPost,          setReportPost]          = useState<Post | null>(null);
  const [reportSubmitting,    setReportSubmitting]    = useState(false);
  const [customGiftMode,      setCustomGiftMode]      = useState(false);
  const [customGiftAmount,    setCustomGiftAmount]    = useState('');
  const [giftRecipientPost,   setGiftRecipientPost]   = useState<Post | null>(null);
  // FIX 7: Offline detection
  const [isOffline,           setIsOffline]           = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  const navigation   = useNavigation<any>(); // FIX 4: replaces useRouter
  const isLoadingRef       = useRef(false);
  const weeklyWinnersRef   = useRef<WeeklyWinner[]>([]); // FIX 5: always in sync for feed injection
  const flatListRef  = useRef<FlatList>(null);

  // ─── FEED CACHE — 30s TTL, bypassed on manual pull-to-refresh ────────────
  const feedCacheRef        = useRef<{ data: FeedItem[]; timestamp: number } | null>(null);
  const FEED_CACHE_DURATION = 90000;
  // ✅ FIX: Debounce realtime reloads — no expensive full reload on every DB event
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedLoadFeed = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    realtimeDebounceRef.current = setTimeout(() => {
      if (!isLoadingRef.current) loadFeed();
    }, 2000);
  }, []); // 90s — feed feels instant on return visits

  // ─── VIEWER CITY — detected once for location boost in algorithm ──────────
  // Extract city part from timezone string e.g. "Africa/Lagos" → "Lagos"
  const viewerCity = useMemo(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return tz.split('/')[1]?.replace(/_/g, ' ') || '';
    } catch { return ''; }
  }, []);

  const viewabilityConfig = useRef<ViewabilityConfig>({
    itemVisiblePercentThreshold: FEED_SETTINGS.itemVisiblePercentThreshold,
  }).current;

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const firstReal = viewableItems.find(v => v.item && !isAd(v.item) && !isWinnerCard(v.item));
    setVisiblePostId(firstReal ? (firstReal.item as Post).id : null);
  }).current;

  useFocusEffect(useCallback(() => {
    return () => { globalAudioManager.stopCurrent(); setVisiblePostId(null); };
  }, []));

  useEffect(() => {
    (AudioModule as any).setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false, shouldDuckAndroid: true }).catch(() => {})
    .catch((e: unknown) => console.error('Audio mode error:', e));
    Promise.all([loadFeed(), loadUnreadNotifications(), loadWeeklyWinners()]);
    const postsChannel         = supabase.channel('posts-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'posts' }, () => { if (!isLoadingRef.current) loadFeed(); }).subscribe();
    const commentsChannel      = supabase.channel('comments-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => { if (!isLoadingRef.current && selectedPost) handleComment(selectedPost); }).subscribe();
    const likesChannel         = supabase.channel('likes-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'likes' }, () => { if (!isLoadingRef.current) loadFeed(); }).subscribe();
    const notificationsChannel = supabase.channel('notifications-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => { loadUnreadNotifications(); }).subscribe();
    return () => {
      supabase.removeChannel(postsChannel); supabase.removeChannel(commentsChannel);
      supabase.removeChannel(likesChannel); supabase.removeChannel(notificationsChannel);
      globalAudioManager.stopCurrent();
    };
  }, []);

  const loadUnreadNotifications = async () => {
    if (!userId) return;
    try {
      const { data, error } = await supabase.from('notifications').select('id').eq('user_id', userId).eq('is_read', false);
      if (!error && data) setUnreadNotifications(data.length);
    } catch (error) { console.error('Error loading notifications:', error); }
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

  const loadWeeklyWinners = async () => {
    try {
      const now = new Date(); const dayOfWeek = now.getDay();
      const weekStart = new Date(now); weekStart.setDate(now.getDate() - dayOfWeek); weekStart.setHours(0, 0, 0, 0);
      const { data: savedWinners } = await supabase.from('weekly_winners').select('*').gte('week_start', weekStart.toISOString()).order('rank', { ascending: true }).limit(3);
      if (savedWinners && savedWinners.length >= 1) {
        const winnerUserIds = savedWinners.map((w: any) => w.user_id);
        const { data: winnerUsers } = await supabase.from('users').select('id, username, display_name, avatar_url').in('id', winnerUserIds);
        const userMap = new Map(winnerUsers?.map((u: any) => [u.id, u]) || []);
        const hydrated: WeeklyWinner[] = savedWinners.map((w: any) => {
          const u: any = userMap.get(w.user_id) || {};
          return { rank: w.rank, user_id: w.user_id, username: u.username || w.username || 'unknown', display_name: u.display_name || w.display_name || 'Unknown', avatar_url: u.avatar_url || w.avatar_url, weekly_points: w.weekly_points || 0, week_start: w.week_start };
        });
        setWeeklyWinners(hydrated); weeklyWinnersRef.current = hydrated; setWinnersAreOfficial(true); return;
      }
      const { data: topUsers } = await supabase.from('users').select('id, username, display_name, avatar_url, points').order('points', { ascending: false }).limit(3);
      if (topUsers && topUsers.length > 0) {
        const derived: WeeklyWinner[] = topUsers.map((u: any, idx: number) => ({ rank: (idx + 1) as 1 | 2 | 3, user_id: u.id, username: u.username || 'unknown', display_name: u.display_name || 'Unknown', avatar_url: u.avatar_url, weekly_points: u.points || 0, week_start: weekStart.toISOString() }));
        setWeeklyWinners(derived); weeklyWinnersRef.current = derived; setWinnersAreOfficial(false);
      }
    } catch (e) { console.error('Error loading weekly winners:', e); }
  };

  const loadFeed = async (forceRefresh = false) => {
    if (!forceRefresh && feedCacheRef.current && Date.now() - feedCacheRef.current.timestamp < FEED_CACHE_DURATION) {
      setFeedItems(feedCacheRef.current.data); setLoading(false); setRefreshing(false); return;
    }
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;

    // FIX 6: 15-second timeout so feed never hangs on slow 3G
    const loadTimeout = setTimeout(() => {
      if (isLoadingRef.current) {
        isLoadingRef.current = false;
        setLoading(false); setRefreshing(false);
      }
    }, 15000);

    try {
      const { data: postsData, error: postsError } = await supabase.from('posts').select('*')
        .or('is_published.is.null,is_published.eq.true')
        // ✅ FIX: Removed media_type.eq.video — videos belong in videos.tsx only.
        // Home feed shows: text posts, image posts, and voice/audio posts only.
        .or('media_type.is.null,media_type.eq.text,media_type.eq.image,media_type.eq.voice')
        // ✅ videos excluded: home feed only shows image, text, voice
        .not('media_type', 'eq', 'video')
        .order('created_at', { ascending: false })
        .limit(50);

      if (postsError) throw postsError;
      if (!postsData || postsData.length === 0) {
        setPosts([]); setFeedItems([]); setLoading(false); isLoadingRef.current = false; return;
      }

      const userIds = [...new Set(postsData.map(p => p.user_id))];
      const [usersResult, likesResult, commentsResult, followingResult] = await Promise.all([
        supabase.from('users').select('id, username, display_name, avatar_url, followers_count').in('id', userIds),
        supabase.from('likes').select('post_id, user_id').in('post_id', postsData.map(p => p.id)),
        supabase.from('comments').select('post_id').in('post_id', postsData.map(p => p.id)).is('parent_comment_id', null),
        userId ? supabase.from('follows').select('following_id').eq('follower_id', userId) : Promise.resolve({ data: [] }),
      ]);

      const usersMap = new Map<string, any>(); usersResult.data?.forEach(u => usersMap.set(u.id, u));
      const likesMap = new Map<string, { count: number; users: string[] }>();
      likesResult.data?.forEach(like => { const existing = likesMap.get(like.post_id) || { count: 0, users: [] }; existing.count++; existing.users.push(like.user_id); likesMap.set(like.post_id, existing); });
      const commentsMap = new Map<string, number>();
      commentsResult.data?.forEach(comment => { commentsMap.set(comment.post_id, (commentsMap.get(comment.post_id) || 0) + 1); });
      const followingSet = new Set<string>();
      (followingResult as any).data?.forEach((f: any) => followingSet.add(f.following_id));

      const formattedPosts: Post[] = postsData.map((post: any) => {
        const likes   = likesMap.get(post.id) || { count: 0, users: [] };
        const postUser = usersMap.get(post.user_id);
        return {
          id: post.id, user_id: post.user_id,
          username: postUser?.username || 'unknown',
          display_name: postUser?.display_name || 'Unknown User',
          user_photo_url: postUser?.avatar_url,
          media_url: (() => {
            const url = post.media_url;
            if (url && url.includes('/upload/') && !url.includes('q_auto')) {
              const idx = url.indexOf('/upload/');
              return url.slice(0, idx + 8) + 'q_auto:good,f_auto/' + url.slice(idx + 8);
            }
            return url;
          })(),
          media_type: post.media_type,
          caption: post.caption || '',
          likes_count: likes.count,
          comments_count: commentsMap.get(post.id) || 0,
          views_count: post.views_count || 0,
          coins_received: post.coins_received || 0,
          liked_by: likes.users, saved_by: post.saved_by || [],
          location: post.location, music_url: post.music_url,
          music_name: post.music_name, music_artist: post.music_artist,
          created_at: post.created_at, has_watermark: post.has_watermark || false,
          text_gradient: post.text_gradient, voice_duration: post.voice_duration,
          video_filter_tint: post.video_filter_tint || null,
          applied_filter: post.applied_filter || null,
          video_effect: post.video_effect || null,
          vibe_type: post.vibe_type || null,
          cloudinary_public_id: post.cloudinary_public_id || null,
        };
      });

      // ─── ALGORITHM v2 — pass viewerCity for location boost ───────────────
      const scoredPosts = formattedPosts.map(post => ({
        ...post,
        _score: computeScore(
          post,
          followingSet,
          usersMap.get(post.user_id)?.followers_count || 0,
          viewerCity,  // ← location relevance boost
        )
      }));
      scoredPosts.sort((a, b) => (b._score || 0) - (a._score || 0));
      const topPosts = scoredPosts.slice(0, 50);
      setPosts(topPosts);

      // ✅ BUG FIX: ad + winner card no longer double-inject at index 3
      // Use else-if so only one special item is inserted per post slot
      const itemsWithAds: FeedItem[] = [];
      let adCounter = 0; let winnerCardInserted = false;
      topPosts.forEach((post, index) => {
        itemsWithAds.push(post);
        if (index === 3 && !winnerCardInserted) {
          winnerCardInserted = true;
          // FIX 5: pass real weeklyWinners — not empty array
          itemsWithAds.push({ id: 'winner_card', isWinnerCard: true, winners: weeklyWinnersRef.current });
        } else if ((index + 1) % 4 === 0) {
          itemsWithAds.push({ id: `ad_${adCounter}`, isAd: true, adIndex: adCounter });
          adCounter++;
        }
      });

      feedCacheRef.current = { data: itemsWithAds, timestamp: Date.now() };
      setFeedItems(itemsWithAds);
      await loadFollowStatus(userIds);
    } catch (e: any) {
      console.error('Error loading feed:', e);
      Alert.alert('Error', `Failed to load feed: ${e.message || 'Unknown error'}`);
    } finally { clearTimeout(loadTimeout); setLoading(false); setRefreshing(false); isLoadingRef.current = false; }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadFeed(true), loadUnreadNotifications(), loadWeeklyWinners()]);
  };

  // FIX 8: View debounce queue — prevents 10 concurrent writes on fast scroll
  const viewQueueRef  = useRef<Set<string>>(new Set());
  const viewFlushRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleView = useCallback((postId: string) => {
    if (!userId) return;
    viewQueueRef.current.add(postId);
    if (viewFlushRef.current) clearTimeout(viewFlushRef.current);
    viewFlushRef.current = setTimeout(async () => {
      const toFlush = Array.from(viewQueueRef.current);
      viewQueueRef.current.clear();
      for (const pid of toFlush) {
        try {
          const { data: post } = await supabase.from('posts').select('views_count, viewed_by, user_id').eq('id', pid).single();
          if (!post) continue;
          const viewedBy = post.viewed_by || [];
          if (viewedBy.includes(userId)) continue;
          await supabase.from('posts')
            .update({ views_count: (post.views_count || 0) + 1, viewed_by: [...viewedBy, userId] })
            .eq('id', pid);
          if (post.user_id && post.user_id !== userId) {
            const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
            if (ownerData) {
              const multipliers = await getOwnerBadgeMultipliers(post.user_id);
              await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.viewPoints }).eq('id', post.user_id);
            }
          }
          setPosts(prev => prev.map(p => p.id === pid ? { ...p, views_count: (post.views_count || 0) + 1 } : p));
          setFeedItems(prev => prev.map(item => (!isAd(item) && item.id === pid) ? { ...item, views_count: (post.views_count || 0) + 1 } : item));
        } catch (e) { console.error('View tracking error:', e); }
      }
    }, 1500);
  }, [userId]);

  // ✅ NEW: Report handlers
  const handleReport = useCallback((post: Post) => {
    if (!userId) { Alert.alert('Login Required', 'Please log in to report content.'); return; }
    setReportPost(post);
    setReportModalVisible(true);
  }, [userId]);

  const submitReport = useCallback(async (category: string) => {
    if (!reportPost || !userId || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await supabase.from('reports').insert({
        post_id: reportPost.id,
        reporter_id: userId,
        reported_user_id: reportPost.user_id,
        category,
        status: 'pending',
        created_at: new Date().toISOString(),
      });
      setReportModalVisible(false);
      setReportPost(null);
      Alert.alert('✅ Report Submitted', 'Thank you for keeping LumVibe safe. Our team will review this content.', [{ text: 'OK' }]);
    } catch (e) {
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setReportSubmitting(false);
    }
  }, [reportPost, userId, reportSubmitting]);

  const handleDeletePost = useCallback(async (post: Post) => {
    if (post.user_id !== userId) { Alert.alert('Error', 'You can only delete your own posts'); return; }
    Alert.alert('Delete Post', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await supabase.from('likes').delete().eq('post_id', post.id);
          await supabase.from('comments').delete().eq('post_id', post.id);
          const { error } = await supabase.from('posts').delete().eq('id', post.id).eq('user_id', userId);
          if (error) throw error;
          setPosts(prev => prev.filter(p => p.id !== post.id));
          setFeedItems(prev => prev.filter(item => !isAd(item) ? item.id !== post.id : true));
          Alert.alert('Success', 'Post deleted successfully');
        } catch (e: any) { Alert.alert('Error', 'Failed to delete post. Please try again.'); }
      }}
    ]);
  }, [userId]);

  const handleLike = useCallback(async (post: Post) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToLike); return; }
    const isLiked = post.liked_by?.includes(userId);
    const updatePost = (p: Post) => {
      if (p.id !== post.id) return p;
      return { ...p, likes_count: isLiked ? Math.max(0, p.likes_count - 1) : p.likes_count + 1, liked_by: isLiked ? p.liked_by.filter(id => id !== userId) : [...(p.liked_by || []), userId] };
    };
    setPosts(prev => prev.map(updatePost));
    setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updatePost(item as Post) : item));
    try {
      if (isLiked) {
        const { error } = await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', userId);
        if (error) throw error;
        // ✅ BUG FIX: Unlike uses badge multiplier same as like — no more point inflation
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) {
          const multipliers = await getOwnerBadgeMultipliers(post.user_id);
          await supabase.from('users').update({ points: Math.max(0, (ownerData.points || 0) - multipliers.likePoints) }).eq('id', post.user_id);
        }
      } else {
        const { error } = await supabase.from('likes').insert({ post_id: post.id, user_id: userId });
        if (error) throw error;
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) {
          const multipliers = await getOwnerBadgeMultipliers(post.user_id);
          await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.likePoints }).eq('id', post.user_id);
        }
        if (post.user_id !== userId)
          await supabase.from('notifications').insert({ user_id: post.user_id, type: 'like', title: 'New Like', message: 'Someone liked your post', from_user_id: userId, post_id: post.id, is_read: false });
      }
    } catch (e: any) { await loadFeed(); }
  }, [userId]);

  const handleFollow = useCallback(async (targetUserId: string, isFollowing: boolean) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.videos.loginToFollow); return; }
    if (userId === targetUserId) { Alert.alert('Error', 'You cannot follow yourself'); return; }
    try {
      if (isFollowing) {
        const { error } = await supabase.from('follows').delete().eq('follower_id', userId).eq('following_id', targetUserId);
        if (error) throw error;
        const { data: cu } = await supabase.from('users').select('following_count').eq('id', userId).single();
        const { data: tu } = await supabase.from('users').select('followers_count').eq('id', targetUserId).single();
        if (cu) await supabase.from('users').update({ following_count: Math.max(0, (cu.following_count || 0) - 1) }).eq('id', userId);
        if (tu) await supabase.from('users').update({ followers_count: Math.max(0, (tu.followers_count || 0) - 1) }).eq('id', targetUserId);
        setFollowStatusMap(prev => { const m = new Map(prev); m.set(targetUserId, false); return m; });
      } else {
        const { data: existingFollow } = await supabase.from('follows').select('id').eq('follower_id', userId).eq('following_id', targetUserId).maybeSingle();
        if (existingFollow) return;
        const { error } = await supabase.from('follows').insert({ follower_id: userId, following_id: targetUserId });
        if (error) { if (error.code === '23505') return; throw error; }
        const { data: cu } = await supabase.from('users').select('following_count').eq('id', userId).single();
        const { data: tu } = await supabase.from('users').select('followers_count').eq('id', targetUserId).single();
        if (cu) await supabase.from('users').update({ following_count: (cu.following_count || 0) + 1 }).eq('id', userId);
        if (tu) await supabase.from('users').update({ followers_count: (tu.followers_count || 0) + 1 }).eq('id', targetUserId);
        await supabase.from('notifications').insert({ user_id: targetUserId, type: 'follow', title: 'New Follower', message: `@${userProfile?.username || 'Someone'} started following you`, from_user_id: userId, is_read: false });
        setFollowStatusMap(prev => { const m = new Map(prev); m.set(targetUserId, true); return m; });
      }
      await loadProfile();
    } catch (e: any) { throw e; }
  }, [userId, userProfile, loadProfile]);

  const handleGift = useCallback((post: Post) => {
    setGiftRecipientPost(post); setCustomGiftMode(false); setCustomGiftAmount(''); setGiftModalVisible(true);
  }, []);

  const handleSelectGiftPackage = async (giftPackage: typeof GIFT_PACKAGES[0]) => {
    if (!giftRecipientPost || !userId) return;
    if (giftPackage.coins > (userProfile?.coins || 0)) {
      Alert.alert(t.videos.insufficientCoins, `You need ${giftPackage.coins} coins but only have ${(userProfile?.coins || 0).toFixed(0)} coins.\n\nTop up your wallet to continue.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: t.videos.topUpWallet, onPress: () => { setGiftModalVisible(false); setTimeout(() => navigation.navigate('BuyCoins'), 300); } }
      ]);
      return;
    }
    try {
      // ✅ FIX: Fresh DB read before deducting — prevents stale store overwriting real balance
      const { data: freshSender } = await supabase.from('users').select('coins').eq('id', userId).single();
      if ((freshSender?.coins || 0) < giftPackage.coins) { Alert.alert('Insufficient coins', 'Balance changed. Please try again.'); return; }
      await supabase.from('users').update({ coins: (freshSender?.coins || 0) - giftPackage.coins }).eq('id', userId);
      // ✅ Use RPC to bypass RLS — direct update of another user's coins is blocked
      const rpcResult = await supabase.rpc('increment_coins', { target_user_id: giftRecipientPost.user_id, coin_amount: giftPackage.coins });
      // ✅ BUG FIX: Read fresh coins_received from DB before incrementing
      // Prevents stale-read overwrite when multiple gifts are sent simultaneously
      const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', giftRecipientPost.id).single();
      await supabase.from('posts').update({ coins_received: (freshPost?.coins_received || 0) + giftPackage.coins }).eq('id', giftRecipientPost.id);
      await supabase.from('transactions').insert([
        { user_id: userId, type: 'spent', amount: giftPackage.coins, description: `Sent ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins) to @${giftRecipientPost.username}`, status: 'completed' },
        { user_id: giftRecipientPost.user_id, type: 'received', amount: giftPackage.coins, description: `Received ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins) from @${userProfile?.username}`, status: 'completed' },
      ]);
      await supabase.from('notifications').insert({ user_id: giftRecipientPost.user_id, type: 'gift', title: 'New Gift', message: `Sent you ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins)`, from_user_id: userId, post_id: giftRecipientPost.id, is_read: false });
      setGiftModalVisible(false);
      const updateCoins = (p: Post) => p.id === giftRecipientPost.id ? { ...p, coins_received: p.coins_received + giftPackage.coins } : p;
      setPosts(prev => prev.map(updateCoins));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateCoins(item as Post) : item));
      await loadProfile();
      Alert.alert(`${giftPackage.icon} ${giftPackage.name} Sent!`, `You sent ${giftPackage.name} (${giftPackage.coins} coins = ${coinsToNGN(giftPackage.coins)}) to @${giftRecipientPost.username}!`);
    } catch (error: any) { Alert.alert('Error', 'Failed to send gift'); }
  };

  const handleSendCustomGift = async () => {
    if (!customGiftAmount.trim() || !giftRecipientPost || !userId) return;
    const amount = parseFloat(customGiftAmount);
    if (isNaN(amount) || amount < 10)    { Alert.alert('Invalid Amount', 'Minimum 10 coins (₦1,500)'); return; }
    if (amount > 5000)                    { Alert.alert('Invalid Amount', 'Maximum 5,000 coins (₦750,000)'); return; }
    if (amount > (userProfile?.coins || 0)) {
      Alert.alert(t.videos.insufficientCoins, `You only have ${(userProfile?.coins || 0).toFixed(0)} coins (${coinsToNGN(userProfile?.coins || 0)}).`, [
        { text: 'Cancel', style: 'cancel' },
        { text: t.videos.topUpWallet, onPress: () => { setGiftModalVisible(false); setCustomGiftMode(false); setTimeout(() => navigation.navigate('BuyCoins'), 300); } }
      ]);
      return;
    }
    try {
      // ✅ FIX: Fresh DB read before deducting — prevents stale store overwriting real balance
      const { data: freshSender2 } = await supabase.from('users').select('coins').eq('id', userId).single();
      if ((freshSender2?.coins || 0) < amount) { Alert.alert('Insufficient coins', 'Balance changed. Please try again.'); return; }
      await supabase.from('users').update({ coins: (freshSender2?.coins || 0) - amount }).eq('id', userId);
      // ✅ Use RPC to bypass RLS — direct update of another user's coins is blocked
      const rpcResult2 = await supabase.rpc('increment_coins', { target_user_id: giftRecipientPost.user_id, coin_amount: amount });
      // ✅ BUG FIX: Fresh read before write (same as package gift fix)
      const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', giftRecipientPost.id).single();
      await supabase.from('posts').update({ coins_received: (freshPost?.coins_received || 0) + amount }).eq('id', giftRecipientPost.id);
      await supabase.from('transactions').insert([
        { user_id: userId, type: 'spent', amount, description: `Sent custom gift (${amount} coins = ${coinsToNGN(amount)}) to @${giftRecipientPost.username}`, status: 'completed' },
        { user_id: giftRecipientPost.user_id, type: 'received', amount, description: `Received custom gift (${amount} coins = ${coinsToNGN(amount)}) from @${userProfile?.username}`, status: 'completed' },
      ]);
      await supabase.from('notifications').insert({ user_id: giftRecipientPost.user_id, type: 'gift', title: 'New Gift', message: `Sent you a custom gift (${amount} coins = ${coinsToNGN(amount)})`, from_user_id: userId, post_id: giftRecipientPost.id, is_read: false });
      setGiftModalVisible(false); setCustomGiftMode(false); setCustomGiftAmount('');
      const updateCoins = (p: Post) => p.id === giftRecipientPost.id ? { ...p, coins_received: p.coins_received + amount } : p;
      setPosts(prev => prev.map(updateCoins));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateCoins(item as Post) : item));
      await loadProfile();
      Alert.alert(t.videos.giftSent, `You sent ${amount} coins (${coinsToNGN(amount)}) to @${giftRecipientPost.username}!`);
    } catch (error: any) { Alert.alert('Error', 'Failed to send gift'); }
  };

  const handleCommentLike = useCallback(async (comment: Comment) => {
    if (!userId) return;
    const isLiked = comment.liked_by?.includes(userId);
    setComments(prev => prev.map(c => {
      if (c.id !== comment.id) return c;
      return { ...c, likes_count: isLiked ? Math.max(0, c.likes_count - 1) : c.likes_count + 1, liked_by: isLiked ? c.liked_by.filter(id => id !== userId) : [...(c.liked_by || []), userId] };
    }));
    try {
      if (isLiked) await supabase.from('comment_likes').delete().eq('comment_id', comment.id).eq('user_id', userId);
      else         await supabase.from('comment_likes').insert({ comment_id: comment.id, user_id: userId });
    } catch (e: any) { if (selectedPost) await handleComment(selectedPost); }
  }, [userId, selectedPost]);

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
        const u     = usersMap.get(comment.user_id);
        let parentComment = undefined;
        if (comment.parent_comment_id) {
          const { data: parentData } = await supabase.from('comments').select('text, user_id').eq('id', comment.parent_comment_id).single();
          if (parentData) { const pu = usersMap.get(parentData.user_id); parentComment = { username: pu?.username || 'unknown', display_name: pu?.display_name || 'Unknown User', text: parentData.text }; }
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
    if (trimmedText.length < 1 || trimmedText.length > 500) {
      Alert.alert(t.errors.generic, trimmedText.length < 1 ? t.comments.empty : t.comments.tooLong); return;
    }
    setSubmittingComment(true);
    try {
      const { data: newComment, error: insertError } = await supabase.from('comments').insert({ post_id: selectedPost.id, user_id: userId, text: trimmedText, parent_comment_id: replyingTo?.id || null }).select().single();
      if (insertError) throw insertError;
      if (replyingTo) {
        try {
          const { data: parentComment } = await supabase.from('comments').select('replies_count').eq('id', replyingTo.id).single();
          if (parentComment) await supabase.from('comments').update({ replies_count: (parentComment.replies_count || 0) + 1 }).eq('id', replyingTo.id);
        } catch (err) {}
      }
      if (selectedPost.user_id !== userId) {
        try {
          const { data: ownerData } = await supabase.from('users').select('points').eq('id', selectedPost.user_id).single();
          if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(selectedPost.user_id); await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.commentPoints }).eq('id', selectedPost.user_id); }
        } catch (e) {}
      }
      setCommentText(''); setReplyingTo(null);
      const updateComments = (p: Post) => p.id === selectedPost.id ? { ...p, comments_count: p.comments_count + 1 } : p;
      setPosts(prev => prev.map(updateComments));
      setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updateComments(item as Post) : item));
      await handleComment(selectedPost);
    } catch (e: any) { Alert.alert('Error', `Failed to post comment: ${e.message || 'Unknown error'}`); }
    finally { setSubmittingComment(false); }
  }, [commentText, selectedPost, userId, submittingComment, replyingTo]);

  const handleReply       = useCallback((comment: Comment) => { setReplyingTo(comment); setCommentText(''); }, []);
  const handleCancelReply = useCallback(() => { setReplyingTo(null); setCommentText(''); }, []);

  const handleSave = useCallback(async (post: Post) => {
    if (!userId) { Alert.alert(t.videos.loginRequired, t.common.save); return; }
    const isSaved = post.saved_by?.includes(userId);
    const updatePost = (p: Post) => {
      if (p.id !== post.id) return p;
      return { ...p, saved_by: isSaved ? p.saved_by.filter(id => id !== userId) : [...p.saved_by, userId] };
    };
    setPosts(prev => prev.map(updatePost));
    setFeedItems(prev => prev.map(item => (!isAd(item) && !isWinnerCard(item)) ? updatePost(item as Post) : item));
    try {
      const { data: currentPost } = await supabase.from('posts').select('saved_by').eq('id', post.id).single();
      const currentSavedBy = currentPost?.saved_by || [];
      const newSavedBy = isSaved ? currentSavedBy.filter((id: string) => id !== userId) : [...currentSavedBy, userId];
      await supabase.from('posts').update({ saved_by: newSavedBy }).eq('id', post.id);
    } catch (e: any) { await loadFeed(); }
  }, [userId]);

  const handleShare = useCallback(async (post: Post) => {
    try {
      const deepLink = `https://lumvibe.site/post/${post.id}`;
      const result = await Share.share({ message: `Check out this post by @${post.username} on LumVibe!\n\n${post.caption || ''}\n\n${deepLink}`, title: `Post by @${post.username}` });
      if (result.action === Share.sharedAction && post.user_id !== userId) {
        try {
          const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
          if (ownerData) { const multipliers = await getOwnerBadgeMultipliers(post.user_id); await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.sharePoints }).eq('id', post.user_id); }
        } catch (e) {}
      }
    } catch (e: any) { console.error('Share error:', e); }
  }, [userId]);

  const handleUserPress = useCallback((targetUserId: string) => {
    if (!targetUserId) return;
    if (targetUserId === userId) navigation.navigate('Profile');
    else navigation.navigate('UserProfile', { userId: targetUserId });
  }, [navigation, userId]);

  const handleSearchPress       = useCallback(() => { navigation.navigate('Search'); }, [navigation]);
  const handleNotificationPress = useCallback(() => { navigation.navigate('Notification'); }, [navigation]);

  const formatCommentTime = (timestamp: string) => {
    if (!timestamp) return 'Just now';
    const diff = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 1000);
    if (diff < 60) return 'Just now'; if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`; if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return new Date(timestamp).toLocaleDateString();
  };

  const renderItem = useCallback(({ item }: { item: FeedItem }) => {
    if (isAd(item)) return <NativeAdPost adIndex={item.adIndex} />;
    if (isWinnerCard(item)) {
      if (weeklyWinners.length === 0) return null;
      return <WinnerCardInFeed winners={weeklyWinners} onUserPress={handleUserPress} />;
    }
    const isTopWinner = weeklyWinners.length > 0 && (item as Post).user_id === weeklyWinners[0].user_id;
    const card = (
      <PostCard
        item={item as Post} user={user} onLike={handleLike} onComment={handleComment}
        onSave={handleSave} onGift={handleGift} onFollow={handleFollow}
        onUserPress={handleUserPress} onShare={handleShare} onDelete={handleDeletePost} onReport={handleReport}
        isVisible={visiblePostId === (item as Post).id} onView={handleView}
        followStatusMap={followStatusMap} isTopWinner={isTopWinner}
      />
    );
    return isTopWinner ? <WinnerGlowBorder key={(item as Post).id}>{card}</WinnerGlowBorder> : card;
  }, [visiblePostId, weeklyWinners, followStatusMap, user, handleReport]);

  if (loading) return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#00ff88" />
      <Text style={styles.loadingText}>{t.feed.loading}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* FIX 7: Offline banner — always visible so user knows why feed isn't loading */}
      {isOffline && (
        <View style={{ backgroundColor: '#ff4444', paddingVertical: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="wifi-off" size={13} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 }}>No internet — pull down to retry when back online</Text>
        </View>
      )}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>LumVibe</Text>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.headerIconButton} onPress={handleSearchPress}><Feather name="search" size={24} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={styles.headerIconButton} onPress={handleNotificationPress}>
            <Feather name="bell" size={24} color="#fff" />
            {unreadNotifications > 0 && (<View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadNotifications > 99 ? '99+' : unreadNotifications}</Text></View>)}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={flatListRef}
        data={feedItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00ff88" colors={['#00ff88']} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.feedContent}
        removeClippedSubviews={true}
        maxToRenderPerBatch={FEED_SETTINGS.maxToRenderPerBatch}
        initialNumToRender={FEED_SETTINGS.initialNumToRender}
        windowSize={FEED_SETTINGS.windowSize}
        updateCellsBatchingPeriod={FEED_SETTINGS.updateCellsBatchingPeriod}
        ListHeaderComponent={weeklyWinners.length > 0 ? <WinnersBanner winners={weeklyWinners} onUserPress={handleUserPress} isOfficial={winnersAreOfficial} /> : null}
        ListEmptyComponent={<View style={styles.emptyContainer}><Feather name="image" size={64} color="#666" /><Text style={styles.emptyText}>{t.feed.noContent}</Text><Text style={styles.emptySubtext}>{t.feed.noContentSub}</Text></View>}
      />

      {/* GIFT MODAL */}
      <Modal visible={giftModalVisible} transparent animationType="slide" onRequestClose={() => setGiftModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setGiftModalVisible(false)} />
          <View style={styles.giftModal}>
            <View style={styles.giftModalHeader}>
              <Text style={styles.giftModalTitle}>{customGiftMode ? t.videos.customAmount : `${t.videos.sendGiftTo} @${giftRecipientPost?.username}`}</Text>
              <TouchableOpacity onPress={() => setGiftModalVisible(false)} style={styles.closeButton}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <View style={styles.balanceInfo}>
              <MaterialCommunityIcons name="diamond" size={20} color="#ffd700" />
              <Text style={styles.balanceText}>{(userProfile?.coins || 0).toFixed(0)} coins ({coinsToNGN(userProfile?.coins || 0)})</Text>
            </View>
            {!customGiftMode ? (
              <ScrollView style={styles.giftPackagesContainer} showsVerticalScrollIndicator={false}>
                {GIFT_PACKAGES.map((pkg) => (
                  <TouchableOpacity key={pkg.id} style={[styles.giftPackage, { borderColor: pkg.color }]} onPress={() => handleSelectGiftPackage(pkg)} activeOpacity={0.7}>
                    <View style={styles.giftPackageLeft}>
                      <Text style={styles.giftIcon}>{pkg.icon}</Text>
                      <View style={styles.giftInfo}>
                        <Text style={styles.giftName}>{pkg.name}</Text>
                        <Text style={styles.giftAmount}>{pkg.coins} coins</Text>
                        <Text style={styles.giftLocalAmount}>{giftLocalPrice(pkg.ngn)}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.customGiftButton} onPress={() => setCustomGiftMode(true)} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="pencil" size={20} color="#00ff88" />
                  <Text style={styles.customGiftButtonText}>{t.videos.customAmount}</Text>
                </TouchableOpacity>
              </ScrollView>
            ) : (
              <View style={styles.customGiftContainer}>
                <Text style={styles.customGiftLabel}>Enter amount (10 - 5,000 coins):</Text>
                <TextInput style={styles.customGiftInput} value={customGiftAmount} onChangeText={setCustomGiftAmount} placeholder="0" placeholderTextColor="#666" keyboardType="numeric" autoFocus />
                {customGiftAmount && !isNaN(parseFloat(customGiftAmount)) && (<Text style={styles.customGiftPreview}>{coinsToNGN(parseFloat(customGiftAmount))}</Text>)}
                <View style={styles.customGiftActions}>
                  <TouchableOpacity style={[styles.customGiftActionButton, styles.cancelButton]} onPress={() => setCustomGiftMode(false)} activeOpacity={0.7}><Text style={styles.cancelButtonText}>{t.common.cancel}</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.customGiftActionButton, styles.sendButton]} onPress={handleSendCustomGift} activeOpacity={0.7}><MaterialCommunityIcons name="gift" size={20} color="#000" /><Text style={styles.sendButtonText}>{t.videos.giftSent.replace('! 🎁','')}</Text></TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* COMMENT MODAL */}
      <Modal visible={commentModalVisible} animationType="slide" onRequestClose={() => setCommentModalVisible(false)}>
        <KeyboardAvoidingView style={styles.commentModal} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.commentModalHeader}>
            <TouchableOpacity onPress={() => setCommentModalVisible(false)} style={styles.backButton}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            <Text style={styles.commentModalTitle}>{t.comments.title}</Text>
            <View style={{ width: 24 }} />
          </View>
          {loadingComments ? (
            <View style={styles.loadingCommentsContainer}><ActivityIndicator size="large" color="#00ff88" /></View>
          ) : (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              renderItem={({ item: comment }) => (
                <View style={styles.commentItem}>
                  {comment.user_photo_url ? <Image source={{ uri: comment.user_photo_url }} style={styles.commentAvatar} /> : <View style={[styles.commentAvatar, styles.avatarPlaceholder]}><Feather name="user" size={16} color="#00ff88" /></View>}
                  <View style={styles.commentContent}>
                    <View style={styles.commentHeader}>
                      <View><Text style={styles.commentDisplayName}>{comment.display_name}</Text><Text style={styles.commentUsername}>@{comment.username}</Text></View>
                      <Text style={styles.commentTime}>{formatCommentTime(comment.created_at)}</Text>
                    </View>
                    {comment.parent_comment && (<View style={styles.replyingToContainer}><Feather name="corner-down-right" size={12} color="#00ff88" /><Text style={styles.replyingToText}>Replying to @{comment.parent_comment.username}</Text></View>)}
                    <Text style={styles.commentText}>{comment.text}</Text>
                    <View style={styles.commentActions}>
                      <TouchableOpacity style={styles.commentActionButton} onPress={() => handleCommentLike(comment)} activeOpacity={0.7}>
                        <Feather name="heart" size={16} color={comment.liked_by?.includes(userId || '') ? '#00ff88' : '#666'} />
                        <Text style={styles.commentActionCount}>{comment.likes_count}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.commentActionButton} onPress={() => handleReply(comment)} activeOpacity={0.7}>
                        <Feather name="corner-down-right" size={16} color="#666" />
                        <Text style={styles.commentActionText}>Reply</Text>
                      </TouchableOpacity>
                      {comment.replies_count > 0 && (<Text style={styles.repliesCount}>{comment.replies_count} {comment.replies_count === 1 ? t.comments.reply1 : t.comments.replies}</Text>)}
                    </View>
                  </View>
                </View>
              )}
              contentContainerStyle={styles.commentsListContent}
              ListEmptyComponent={<View style={styles.emptyCommentsContainer}><Feather name="message-circle" size={64} color="#666" /><Text style={styles.emptyCommentsText}>{t.comments.noComments}</Text><Text style={styles.emptyCommentsSubtext}>{t.comments.noCommentsSubtext}</Text></View>}
            />
          )}
          <View style={styles.commentInputContainer}>
            {replyingTo && (<View style={styles.replyingToBar}><Text style={styles.replyingToBarText}>Replying to @{replyingTo.username}</Text><TouchableOpacity onPress={handleCancelReply}><Feather name="x" size={20} color="#00ff88" /></TouchableOpacity></View>)}
            <View style={styles.commentInputRow}>
              {userProfile?.avatar_url ? <Image source={{ uri: userProfile.avatar_url }} style={styles.commentInputAvatar} /> : <View style={[styles.commentInputAvatar, styles.avatarPlaceholder]}><Feather name="user" size={14} color="#00ff88" /></View>}
              <TextInput style={styles.commentInput} value={commentText} onChangeText={setCommentText} placeholder={replyingTo ? `${t.comments.replyPlaceholder} @${replyingTo.username}...` : t.comments.placeholder} placeholderTextColor="#666" multiline maxLength={500} />
              <TouchableOpacity style={[styles.sendCommentButton, (!commentText.trim() || submittingComment) && styles.sendCommentButtonDisabled]} onPress={handleCommentSubmit} disabled={!commentText.trim() || submittingComment} activeOpacity={0.7}>
                {submittingComment ? <ActivityIndicator size="small" color="#000" /> : <Feather name="send" size={20} color="#000" />}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


      {/* ✅ NEW: REPORT MODAL */}
      <Modal visible={reportModalVisible} transparent animationType="slide" onRequestClose={() => setReportModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={reportStyles.sheet}>
            <View style={reportStyles.handle} />
            <View style={reportStyles.header}>
              <Text style={reportStyles.title}>Report Post</Text>
              <TouchableOpacity onPress={() => setReportModalVisible(false)} style={styles.closeButton}>
                <Feather name="x" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <Text style={reportStyles.subtitle}>Why are you reporting @{reportPost?.username}'s post?</Text>
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
                    : <Feather name="chevron-right" size={18} color="#444" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={reportStyles.cancelBtn} onPress={() => setReportModalVisible(false)} activeOpacity={0.7}>
              <Text style={reportStyles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {weeklyWinners.length > 0 && (<FloatingChampion winner={weeklyWinners[0]} isOfficial={winnersAreOfficial} onPress={() => handleUserPress(weeklyWinners[0].user_id)} />)}
    </View>
  );
}

const shopStyles = StyleSheet.create({
  shopBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#00ff88', marginHorizontal: 12, marginBottom: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, gap: 8 },
  shopBtnIcon: { fontSize: 18 },
  shopBtnText: { flex: 1, color: '#000', fontWeight: '700', fontSize: 14 },
});

const vibeStyles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, alignSelf: 'flex-start' },
  emoji: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: '700' },
});

const reportStyles = StyleSheet.create({
  sheet:       { backgroundColor: '#111', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 36, maxHeight: '75%' },
  handle:      { width: 40, height: 4, backgroundColor: '#333', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 },
  title:       { color: '#fff', fontSize: 18, fontWeight: '700' },
  subtitle:    { color: '#666', fontSize: 13, paddingHorizontal: 20, marginBottom: 12 },
  list:        { maxHeight: 420 },
  row:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 14 },
  rowDisabled: { opacity: 0.5 },
  rowIcon:     { fontSize: 22, width: 32, textAlign: 'center' as const },
  rowLabel:    { color: '#fff', fontSize: 14, fontWeight: '500' as const, flex: 1 },
  cancelBtn:   { marginHorizontal: 20, marginTop: 16, paddingVertical: 14, backgroundColor: '#1a1a1a', borderRadius: 14, alignItems: 'center' as const },
  cancelText:  { color: '#fff', fontSize: 15, fontWeight: '600' as const },
});


const styles = StyleSheet.create({
  container:              { flex: 1, backgroundColor: '#000' },
  header:                 { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, backgroundColor: '#000', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle:            { fontSize: 24, fontWeight: 'bold', color: '#00ff88' },
  headerIcons:            { flexDirection: 'row', gap: 16 },
  headerIconButton:       { padding: 4, position: 'relative' },
  notificationBadge:      { position: 'absolute', top: -4, right: -4, backgroundColor: '#ff0000', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  notificationBadgeText:  { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  feedContent:            { paddingBottom: 20 },
  loadingContainer:       { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText:            { color: '#fff', marginTop: 12, fontSize: 16 },
  emptyContainer:         { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  emptyText:              { color: '#fff', fontSize: 20, fontWeight: '600', marginTop: 16 },
  emptySubtext:           { color: '#666', fontSize: 14, marginTop: 8 },
  adContainer:            { width: '100%', backgroundColor: '#0a0a0a', alignItems: 'center', padding: 20 },
  postCard:               { backgroundColor: '#0a0a0a', marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  postCardWinner:         { marginBottom: 0, borderRadius: 12 },
  winnerAvatar:           { borderWidth: 2.5, borderColor: '#FFD700' },
  crownBadge:             { position: 'absolute', top: -10, left: '50%', marginLeft: -9, zIndex: 20 },
  crownEmoji:             { fontSize: 16 },
  winnerNameGradient:     { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, alignSelf: 'flex-start', marginBottom: 1 },
  winnerDisplayName:      { fontSize: 15, fontWeight: '800', color: '#000', letterSpacing: 0.2 },
  winnerUsername:         { color: '#FFD700', fontWeight: '600' },
  postHeader:             { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  userInfo:               { flexDirection: 'row', alignItems: 'center', flex: 1 },
  userAvatar:             { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  avatarPlaceholder:      { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  userDetails:            { flex: 1 },
  displayName:            { color: '#fff', fontSize: 16, fontWeight: '600' },
  username:               { color: '#666', fontSize: 14 },
  headerRightContainer:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timestamp:              { color: '#666', fontSize: 12 },
  followButton:           { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: '#00ff88' },
  followingButton:        { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#00ff88' },
  followButtonDisabled:   { opacity: 0.5 },
  followButtonText:       { color: '#000', fontSize: 14, fontWeight: '600' },
  followingButtonText:    { color: '#00ff88' },
  optionsButton:          { padding: 4 },
  voicePostOuterContainer:{ backgroundColor: '#000' },
  voiceCoverContainer:    { width: '100%', height: width, backgroundColor: '#111', position: 'relative', justifyContent: 'center', alignItems: 'center' },
  voiceCoverImage:        { width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, justifyContent: 'center', alignItems: 'center' },
  voiceCoverGradient:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: '45%' },
  voiceCoverMeta:         { position: 'absolute', bottom: 16, left: 16, right: 16 },
  voiceCoverTitle:        { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 4, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  voiceCoverArtist:       { color: 'rgba(255,255,255,0.75)', fontSize: 14, fontWeight: '500' },
  voicePlayerRow:         { backgroundColor: '#0d0d0d', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  voiceProgressTrack:     { height: 3, backgroundColor: '#333', borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  voiceProgressFill:      { height: '100%', backgroundColor: '#00ff88', borderRadius: 2 },
  voiceControlsRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  voicePlayButton:        { width: 52, height: 52, borderRadius: 26, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center' },
  voiceTimeText:          { color: '#888', fontSize: 12, fontWeight: '500', width: 40 },
  voiceWaveform:          { flexDirection: 'row', alignItems: 'center', height: 24, gap: 2 },
  voiceWaveformBar:       { width: 3, borderRadius: 2 },
  voiceDuration:          { color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 8 },
  textPostContainer:      { width: '100%', height: 400 },
  textPostGradient:       { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  textPostContent:        { padding: 40, justifyContent: 'center', alignItems: 'center' },
  textPostText:           { fontSize: 28, fontWeight: 'bold', color: '#fff', textAlign: 'center', textShadowColor: 'rgba(0, 0, 0, 0.5)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4 },
  textPostWatermark:      { position: 'absolute', bottom: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  mediaContainer:         { width: '100%', position: 'relative', backgroundColor: '#000' },
  watermarkOverlay:       { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  watermarkLogo:          { width: 24, height: 24 },
  watermarkText:          { color: '#00ff88', fontSize: 12, fontWeight: '700' },
  watermarkUsername:      { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 2 },
  actionsContainer:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  actionsLeft:            { flexDirection: 'row', gap: 16 },
  actionsRight:           { flexDirection: 'row', alignItems: 'center', gap: 12 },
  actionButton:           { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionCount:            { color: '#fff', fontSize: 14, fontWeight: '500' },
  actionCountGold:        { color: '#ffd700', fontSize: 14, fontWeight: '600' },
  coinsEarned:            { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1a1a1a', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  coinsText:              { color: '#ffd700', fontSize: 12, fontWeight: '600' },
  viewsContainer:         { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  viewsText:              { color: '#666', fontSize: 12 },
  locationContainer:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  locationText:           { color: '#00ff88', fontSize: 12 },
  musicContainer:         { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  musicText:              { color: '#00ff88', fontSize: 12, fontStyle: 'italic' },
  captionContainer:       { paddingHorizontal: 12, paddingBottom: 12 },
  captionUsername:        { color: '#00ff88', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  captionText:            { color: '#fff', fontSize: 14, lineHeight: 20 },
  modalOverlay:           { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.9)', justifyContent: 'flex-end' },
  giftModal:              { backgroundColor: '#0a0a0a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: '80%' },
  giftModalHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  giftModalTitle:         { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  closeButton:            { padding: 4 },
  balanceInfo:            { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, backgroundColor: '#1a1a1a', marginHorizontal: 16, marginTop: 16, borderRadius: 12 },
  balanceText:            { color: '#ffd700', fontSize: 15, fontWeight: '600' },
  giftPackagesContainer:  { padding: 16 },
  giftPackage:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a1a1a', borderRadius: 12, marginBottom: 12, borderWidth: 2 },
  giftPackageLeft:        { flexDirection: 'row', alignItems: 'center', gap: 16 },
  giftIcon:               { fontSize: 40 },
  giftInfo:               { gap: 4 },
  giftName:               { color: '#fff', fontSize: 18, fontWeight: '600' },
  giftAmount:             { color: '#00ff88', fontSize: 14, fontWeight: '500' },
  giftLocalAmount:        { color: '#ffd700', fontSize: 13, fontWeight: '600' },
  customGiftButton:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, marginHorizontal: 16, borderRadius: 12, borderWidth: 2, borderColor: '#00ff88', borderStyle: 'dashed' },
  customGiftButtonText:   { color: '#00ff88', fontSize: 16, fontWeight: '600' },
  customGiftContainer:    { padding: 20 },
  customGiftLabel:        { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  customGiftInput:        { backgroundColor: '#1a1a1a', color: '#fff', fontSize: 24, fontWeight: '600', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#00ff88', textAlign: 'center' },
  customGiftPreview:      { color: '#ffd700', fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  customGiftActions:      { flexDirection: 'row', gap: 12, marginTop: 24 },
  customGiftActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12 },
  cancelButton:           { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#666' },
  cancelButtonText:       { color: '#fff', fontSize: 16, fontWeight: '600' },
  sendButton:             { backgroundColor: '#00ff88' },
  sendButtonText:         { color: '#000', fontSize: 16, fontWeight: '600' },
  commentModal:           { flex: 1, backgroundColor: '#000' },
  commentModalHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 60, paddingBottom: 16, backgroundColor: '#0a0a0a', borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  backButton:             { padding: 4 },
  commentModalTitle:      { color: '#fff', fontSize: 18, fontWeight: '600' },
  loadingCommentsContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  commentsListContent:    { padding: 16 },
  emptyCommentsContainer: { alignItems: 'center', paddingVertical: 60 },
  emptyCommentsText:      { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 16 },
  emptyCommentsSubtext:   { color: '#666', fontSize: 14, marginTop: 8 },
  commentItem:            { flexDirection: 'row', marginBottom: 20, gap: 12 },
  commentAvatar:          { width: 36, height: 36, borderRadius: 18 },
  commentContent:         { flex: 1 },
  commentHeader:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  commentDisplayName:     { color: '#fff', fontSize: 14, fontWeight: '600' },
  commentUsername:        { color: '#666', fontSize: 12 },
  commentTime:            { color: '#666', fontSize: 12 },
  replyingToContainer:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, paddingLeft: 8 },
  replyingToText:         { color: '#00ff88', fontSize: 12, fontStyle: 'italic' },
  commentText:            { color: '#fff', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  commentActions:         { flexDirection: 'row', alignItems: 'center', gap: 16 },
  commentActionButton:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentActionCount:     { color: '#666', fontSize: 12 },
  commentActionText:      { color: '#666', fontSize: 12 },
  repliesCount:           { color: '#00ff88', fontSize: 12, fontWeight: '500' },
  commentInputContainer:  { backgroundColor: '#0a0a0a', borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  replyingToBar:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#1a1a1a' },
  replyingToBarText:      { color: '#00ff88', fontSize: 14 },
  commentInputRow:        { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  commentInputAvatar:     { width: 32, height: 32, borderRadius: 16 },
  commentInput:           { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', fontSize: 14, padding: 12, borderRadius: 20, maxHeight: 100 },
  sendCommentButton:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00ff88', justifyContent: 'center', alignItems: 'center' },
  sendCommentButtonDisabled: { opacity: 0.5 },
});