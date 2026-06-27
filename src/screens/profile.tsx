import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Alert,
  ActivityIndicator, RefreshControl, Modal, FlatList, Dimensions, Share,
  TextInput, Linking, Platform, Animated, Switch, KeyboardAvoidingView
} from 'react-native';
import * as Contacts from 'expo-contacts';
import * as Clipboard from 'expo-clipboard';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from '../locales/LanguageContext';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../config/supabase';
import { useNavigation, CommonActions, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import NetInfo from '@react-native-community/netinfo';
import { getWithdrawingUserReferrer } from '../utils/referralRewards';
import { WinnerProfileBadge } from '../components/LeaderboardWinnerCelebration'; 

// ─── TypeScript Interfaces ────────────────────────────────────────────────────

interface AppUser {
  id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
  is_premium?: boolean;
  coins?: number;
  points?: number;
  level?: number;
}

interface Post {
  id: string;
  media_url?: string;
  media_type?: string;
  likes_count?: number;
  comments_count?: number;
  caption?: string;
  thumbnail_url?: string;
  views_count?: number;
  created_at?: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  description?: string;
  created_at: string;
  status: string;
}

interface Follower {
  id: string;
  display_name: string;
  username: string;
  avatar_url?: string;
  is_premium?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPORTED_COUNTRIES = [
  { code: 'GH', name: 'Ghana',          flag: '🇬🇭', currency: 'GHS' },
  { code: 'KE', name: 'Kenya',          flag: '🇰🇪', currency: 'KES' },
  { code: 'ZA', name: 'South Africa',   flag: '🇿🇦', currency: 'ZAR' },
  { code: 'US', name: 'United States',  flag: '🇺🇸', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'CA', name: 'Canada',         flag: '🇨🇦', currency: 'CAD' },
  { code: 'DE', name: 'Germany',        flag: '🇩🇪', currency: 'EUR' },
  { code: 'FR', name: 'France',         flag: '🇫🇷', currency: 'EUR' },
  { code: 'EG', name: 'Egypt',          flag: '🇪🇬', currency: 'EGP' },
  { code: 'MA', name: 'Morocco',        flag: '🇲🇦', currency: 'MAD' },
];

async function getPaystackBanks(countryCode: string = 'NG'): Promise<Array<{ name: string; code: string }>> {
  try {
    if (countryCode !== 'NG') return [];
    const { data, error } = await supabase.functions.invoke('get-paystack-banks');
    if (error || !data?.banks?.length) throw new Error('Using fallback banks');
    return (data.banks || []).map((b: any) => ({ name: b.name, code: b.code }));
  } catch {
    return [
      { name: 'Access Bank',               code: '044'    },
      { name: 'First Bank of Nigeria',     code: '011'    },
      { name: 'Guaranty Trust Bank (GTB)', code: '058'    },
      { name: 'United Bank for Africa',    code: '033'    },
      { name: 'Zenith Bank',               code: '057'    },
      { name: 'Fidelity Bank',             code: '070'    },
      { name: 'First City Monument Bank',  code: '214'    },
      { name: 'Heritage Bank',             code: '030'    },
      { name: 'Keystone Bank',             code: '082'    },
      { name: 'Stanbic IBTC Bank',         code: '221'    },
      { name: 'Sterling Bank',             code: '232'    },
      { name: 'Union Bank',                code: '032'    },
      { name: 'Wema Bank',                 code: '035'    },
      { name: 'Ecobank',                   code: '050'    },
      { name: 'Polaris Bank',              code: '076'    },
      { name: 'OPay',                      code: '999992' },
      { name: 'Kuda Bank',                 code: '090267' },
      { name: 'PalmPay',                   code: '999991' },
      { name: 'Moniepoint MFB',            code: '090405' },
    ];
  }
}

async function verifyPaystackAccount(
  accountNumber: string,
  bankCode: string,
): Promise<{ success: boolean; accountName?: string; message?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-paystack-account', {
      body: { accountNumber, bankCode },
    });
    if (error) {
      console.warn('[verifyPaystackAccount] Edge Function error:', error.message);
      let msg = 'Could not verify account. Please try again.';
      try {
        const ctx = typeof error.context === 'string' ? JSON.parse(error.context) : error.context;
        if (ctx?.message) msg = ctx.message;
      } catch {}
      return { success: false, message: msg };
    }
    if (data?.account_name) {
      return { success: true, accountName: data.account_name };
    }
    return { success: false, message: data?.message || 'Could not verify account. Check account number and bank.' };
  } catch (e: any) {
    return { success: false, message: 'Verification failed. Please check your internet connection.' };
  }
}

const { width } = Dimensions.get('window');
const POST_SIZE = Math.floor((width - 4) / 3);

const WITHDRAWAL_SPLIT = {
  PLATFORM_FEE:        0.20,
  REFERRAL_COMMISSION: 0.05,
  USER_REFERRED:       0.75,
  USER_NOT_REFERRED:   0.80,
};
const MIN_WITHDRAW_COINS = 34;
const PAYSTACK_AUTO_CURRENCIES = ['NGN', 'GHS'];

const CURRENCY_BY_TIMEZONE: Record<string, { code: string; symbol: string; name: string; ratePerCoin: number }> = {
  'Africa/Lagos':        { code: 'NGN', symbol: '₦',   name: 'Nigerian Naira',     ratePerCoin: 150  },
  'Africa/Abuja':        { code: 'NGN', symbol: '₦',   name: 'Nigerian Naira',     ratePerCoin: 150  },
  'Africa/Accra':        { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi',      ratePerCoin: 1.5  },
  'Africa/Nairobi':      { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling',    ratePerCoin: 13   },
  'Africa/Johannesburg': { code: 'ZAR', symbol: 'R',   name: 'South African Rand', ratePerCoin: 1.8  },
  'Africa/Cairo':        { code: 'EGP', symbol: 'E£',  name: 'Egyptian Pound',     ratePerCoin: 5    },
  'Africa/Casablanca':   { code: 'MAD', symbol: 'MAD', name: 'Moroccan Dirham',    ratePerCoin: 1    },
  'Europe/London':       { code: 'GBP', symbol: '£',   name: 'British Pound',      ratePerCoin: 0.08 },
  'Europe/Paris':        { code: 'EUR', symbol: '€',   name: 'Euro',               ratePerCoin: 0.09 },
  'Europe/Berlin':       { code: 'EUR', symbol: '€',   name: 'Euro',               ratePerCoin: 0.09 },
  'Europe/Rome':         { code: 'EUR', symbol: '€',   name: 'Euro',               ratePerCoin: 0.09 },
  'America/New_York':    { code: 'USD', symbol: '$',   name: 'US Dollar',          ratePerCoin: 0.10 },
  'America/Chicago':     { code: 'USD', symbol: '$',   name: 'US Dollar',          ratePerCoin: 0.10 },
  'America/Los_Angeles': { code: 'USD', symbol: '$',   name: 'US Dollar',          ratePerCoin: 0.10 },
  'America/Toronto':     { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar',    ratePerCoin: 0.14 },
  'America/Vancouver':   { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar',    ratePerCoin: 0.14 },
  'Asia/Dubai':          { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham',         ratePerCoin: 0.37 },
  'Asia/Kolkata':        { code: 'INR', symbol: '₹',   name: 'Indian Rupee',       ratePerCoin: 8.3  },
  'Asia/Tokyo':          { code: 'JPY', symbol: '¥',   name: 'Japanese Yen',       ratePerCoin: 15   },
  'Asia/Shanghai':       { code: 'CNY', symbol: '¥',   name: 'Chinese Yuan',       ratePerCoin: 0.72 },
  'Asia/Singapore':      { code: 'SGD', symbol: 'S$',  name: 'Singapore Dollar',   ratePerCoin: 0.13 },
  'Australia/Sydney':    { code: 'AUD', symbol: 'A$',  name: 'Australian Dollar',  ratePerCoin: 0.15 },
};
const DEFAULT_CURRENCY = { code: 'USD', symbol: '$', name: 'US Dollar', ratePerCoin: 0.10 };

function detectCurrency() {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CURRENCY_BY_TIMEZONE[timezone]) return CURRENCY_BY_TIMEZONE[timezone];
    for (const [tz, curr] of Object.entries(CURRENCY_BY_TIMEZONE)) {
      const region = tz.split('/')[0];
      if (timezone.startsWith(region)) return curr;
    }
  } catch {}
  return DEFAULT_CURRENCY;
}

const BADGES = [
  {
    id: 'founding_member',
    name: 'Founding Member',
    icon: '👑',
    description: 'One of the first 100 users ever',
    reward: '3x view points forever + 100 bonus points',
    rewardDetail: 'You earn 6 pts per view instead of 2 pts permanently! Plus an instant 100 point bonus.',
    bonusPoints: 100,
    getProgress: (_stats: any, userCount: number) => ({
      current: Math.min(userCount, 100),
      total: 100,
      label: userCount <= 100 ? 'You are a Founding Member! Top 100 ever 👑' : 'Only available to the first 100 users',
      achieved: userCount <= 100,
    }),
  },
  {
    id: 'early_adopter',
    name: 'Early Adopter',
    icon: '🚀',
    description: 'One of the first 1000 users',
    reward: '2x view points forever + 50 bonus points',
    rewardDetail: 'You earn 4 pts per view instead of 2 pts permanently! Plus an instant 50 point bonus.',
    bonusPoints: 50,
    getProgress: (_stats: any, userCount: number) => ({
      current: Math.min(userCount, 1000),
      total: 1000,
      label: userCount <= 1000 ? 'You qualified! One of the first 1000 users 🎉' : `${userCount - 1000} users joined after the cutoff`,
      achieved: userCount <= 1000,
    }),
  },
  {
    id: 'streak_7',
    name: '7-Day Streak',
    icon: '🔥',
    description: 'Post 7 days in a row',
    reward: '+50 bonus points instantly',
    rewardDetail: 'Post every day for 7 days straight and instantly earn 50 bonus points.',
    bonusPoints: 50,
    getProgress: (stats: any) => ({
      current: Math.min(stats.currentStreak, 7),
      total: 7,
      label: stats.currentStreak >= 7 ? 'Achieved! Keep your streak going 🔥' : `${7 - stats.currentStreak} more days remaining`,
      achieved: stats.currentStreak >= 7,
    }),
  },
  {
    id: 'streak_30',
    name: '30-Day Streak',
    icon: '💪',
    description: 'Post 30 days in a row',
    reward: '+200 bonus points + earn 20pts per comment',
    rewardDetail: 'Post every day for 30 days. Reward: 200 instant bonus points AND +5 on every comment permanently.',
    bonusPoints: 200,
    getProgress: (stats: any) => ({
      current: Math.min(stats.currentStreak, 30),
      total: 30,
      label: stats.currentStreak >= 30 ? 'Achieved! You are a posting legend 💪' : `${30 - stats.currentStreak} more days remaining`,
      achieved: stats.currentStreak >= 30,
    }),
  },
  {
    id: 'posts_10',
    name: 'Content Creator',
    icon: '📹',
    description: 'Publish 10 posts',
    reward: '+100 bonus points + earn 40pts per share',
    rewardDetail: 'Publish 10 posts total. Reward: 100 instant bonus points AND +10 on every share permanently.',
    bonusPoints: 100,
    getProgress: (stats: any) => ({
      current: Math.min(stats.posts_count, 10),
      total: 10,
      label: stats.posts_count >= 10 ? 'Achieved! You are a content creator 📹' : `${10 - stats.posts_count} more posts remaining`,
      achieved: stats.posts_count >= 10,
    }),
  },
  {
    id: 'followers_100',
    name: 'Rising Star',
    icon: '⭐',
    description: 'Reach 100 followers',
    reward: '+150 bonus points',
    rewardDetail: 'Get 100 followers and instantly earn 150 bonus points.',
    bonusPoints: 150,
    getProgress: (stats: any) => ({
      current: Math.min(stats.followers_count, 100),
      total: 100,
      label: stats.followers_count >= 100 ? 'Achieved! You are a Rising Star ⭐' : `${100 - stats.followers_count} more followers needed`,
      achieved: stats.followers_count >= 100,
    }),
  },
];

const THEMES: Record<string, { background: string; card: string; primary: string; text: string }> = {
  default: { background: '#000',    card: '#111',    primary: '#00ff88', text: '#fff' },
  purple:  { background: '#0a0010', card: '#160025', primary: '#a855f7', text: '#fff' },
  blue:    { background: '#000a1a', card: '#001230', primary: '#00b4d8', text: '#fff' },
  gold:    { background: '#0a0800', card: '#1a1400', primary: '#ffd700', text: '#fff' },
  red:     { background: '#0a0000', card: '#1a0000', primary: '#ff4444', text: '#fff' },
};

const UNLOCKABLE_FEATURES = [
  { id: 'custom_themes',      name: 'Custom Profile Themes',    icon: '🎨', requiredInvites: 3  },
  { id: 'advanced_analytics', name: 'Advanced Analytics',       icon: '📊', requiredInvites: 5  },
  { id: 'priority_support',   name: 'Priority Support',         icon: '💬', requiredInvites: 10 },
  { id: 'glowing_avatar',     name: 'Glowing Avatar Border ✨', icon: '🌟', requiredInvites: 20 },
];

const SOCIAL_PLATFORMS = [
  { id: 'twitter',   label: 'X (Twitter)', prefix: 'https://twitter.com/',  color: '#e7e9ea', initial: 'X'  },
  { id: 'instagram', label: 'Instagram',   prefix: 'https://instagram.com/', color: '#E1306C', initial: 'IG' },
  { id: 'tiktok',    label: 'TikTok',      prefix: 'https://tiktok.com/@',  color: '#ff0050', initial: 'TT' },
];

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountdownToSunday() {
  const [time, setTime] = useState({ d: 0, h: 0, m: 0, s: 0 });
  useEffect(() => {
    const tick = () => {
      const now  = new Date();
      const next = new Date(now);
      next.setDate(now.getDate() + (7 - now.getDay()) % 7 || 7);
      next.setHours(0, 0, 0, 0);
      const diff = Math.max(0, next.getTime() - now.getTime());
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTime({ d, h, m, s });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LeaderboardCountdown() {
  const { d, h, m, s } = useCountdownToSunday();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={ldStyles.countdownWrapper}>
      <Text style={ldStyles.countdownTitle}>🔄 Resets in</Text>
      <View style={ldStyles.countdownRow}>
        {[{ v: d, u: 'Days' }, { v: h, u: 'Hours' }, { v: m, u: 'Mins' }, { v: s, u: 'Secs' }].map(({ v, u }, i) => (
          <React.Fragment key={u}>
            {i > 0 && <Text style={ldStyles.countdownColon}>:</Text>}
            <View style={ldStyles.countdownBox}>
              <Text style={ldStyles.countdownNum}>{pad(v)}</Text>
              <Text style={ldStyles.countdownUnit}>{u}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const ldStyles = StyleSheet.create({
  countdownWrapper: { backgroundColor: '#0d0d0d', marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FFD70033', alignItems: 'center' },
  countdownTitle:   { color: '#888', fontSize: 11, marginBottom: 8, fontWeight: '600', letterSpacing: 1 },
  countdownRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  countdownBox:     { alignItems: 'center', backgroundColor: '#1a1200', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 52, borderWidth: 1, borderColor: '#FFD70044' },
  countdownNum:     { color: '#FFD700', fontSize: 20, fontWeight: 'bold', fontVariant: ['tabular-nums'] },
  countdownUnit:    { color: '#666', fontSize: 9, marginTop: 2, textTransform: 'uppercase' },
  countdownColon:   { color: '#FFD700', fontSize: 20, fontWeight: 'bold', paddingBottom: 12 },
});

function ReferralGlowBorder({ children, color, size = 80 }: { children: React.ReactNode; color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 0, duration: 1200, useNativeDriver: false }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.04, duration: 1400, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.00, duration: 1400, useNativeDriver: true }),
    ])).start();
  }, []);
  const glowOpacity    = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const outerGlowWidth = pulse.interpolate({ inputRange: [0, 1], outputRange: [4, 8] });
  const PADDING = 6;
  const outer   = size + PADDING * 2 + 10;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Animated.View style={{ position: 'absolute', top: -(PADDING + 5), left: -(PADDING + 5), width: outer, height: outer, borderRadius: outer / 2, borderWidth: outerGlowWidth, borderColor: color, opacity: glowOpacity, shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 1, shadowRadius: 16, elevation: 20 }} />
      <View style={{ borderRadius: (size + PADDING * 2) / 2, borderWidth: 3, borderColor: color, padding: PADDING / 2, shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 10, elevation: 12 }}>
        {children}
        <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: color, borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 10 }}>✨</Text>
        </View>
      </View>
    </Animated.View>
  );
}

function generateReferralCode(username: string): string {
  const random   = Math.random().toString(36).substring(2, 8).toUpperCase();
  const userPart = username.substring(0, 3).toUpperCase();
  return `${userPart}${random}`;
}

function BadgeProgressBar({ current, total, color }: { current: number; total: number; color: string }) {
  const pct = Math.min((current / total) * 100, 100);
  return (
    <View style={bpStyles.barTrack}>
      <View style={[bpStyles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}
const bpStyles = StyleSheet.create({
  barTrack: { height: 5, backgroundColor: '#2a2a2a', borderRadius: 3, overflow: 'hidden', marginTop: 6, marginBottom: 2 },
  barFill:  { height: '100%', borderRadius: 3 },
});

const LazyPostThumb = memo(({ post, onPress }: { post: Post; onPress: () => void }) => {
  return (
    <TouchableOpacity style={s.postThumb} onPress={onPress} activeOpacity={0.85}>
      {post.media_type === 'video'
        ? (
          <View style={s.postThumbVideoBg}>
            <Feather name="play" size={28} color="#fff" />
          </View>
        )
        : post.media_url
          ? (
            <Image
              source={{ uri: post.media_url }}
              style={s.postThumbImg}
              resizeMode="cover"
            />
          )
          : <View style={s.postThumbVideoBg} />
      }
      <View style={s.postThumbStats}>
        <View style={s.postThumbStat}>
          <Feather name="heart" size={10} color="#fff" />
          <Text style={s.postThumbStatText}>{post.likes_count || 0}</Text>
        </View>
        <View style={s.postThumbStat}>
          <Feather name="message-circle" size={10} color="#fff" />
          <Text style={s.postThumbStatText}>{post.comments_count || 0}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

function FounderBadgeStrip({ isFounder, primaryColor }: { isFounder: boolean; primaryColor: string }) {
  const glow  = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(glow,  { toValue: 1, duration: 1000, useNativeDriver: false }),
      Animated.timing(glow,  { toValue: 0, duration: 1000, useNativeDriver: false }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.18, duration: 900, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1.00, duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  const borderColor = glow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,215,0,0.35)', 'rgba(255,215,0,1)'] });
  const bgColor     = glow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,215,0,0.05)', 'rgba(255,215,0,0.16)'] });
  const textColor   = isFounder ? '#ffd700' : primaryColor;
  const label       = isFounder ? '👑 Founding Member' : '🚀 Early Adopter';
  const sub         = isFounder ? 'Top 100 ever · 3× view points forever' : 'Top 1000 ever · 2× view points forever';
  return (
    <Animated.View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginHorizontal: 20, marginTop: 12, marginBottom: 2, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 14, borderWidth: 1.5, borderColor, backgroundColor: bgColor }}>
      <Animated.Text style={{ fontSize: 26, transform: [{ scale }] }}>{isFounder ? '👑' : '🚀'}</Animated.Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: textColor, fontSize: 13, fontWeight: '800', letterSpacing: 0.4 }}>{label}</Text>
        <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>{sub}</Text>
      </View>
    </Animated.View>
  );
}

const AVATAR_COLORS = ['#00C96B', '#00A8E8', '#FF6B6B', '#FFD166', '#A78BFA', '#F97316', '#06B6D4', '#EC4899'];

function buildInviteMessage(contactFirstName: string, senderName: string, referralCode: string, includeReferral: boolean): string {
  const base = `Hey ${contactFirstName}! It's me ${senderName} 👋\n\nI just joined Lumvibe and I'm loving it! It's a social app with short videos, marketplace to sell your talent, gifts for creators, weekly leaderboards, voice & image posts, and a lot more 🔥\n\nCome join me 👉 https://play.google.com/store/apps/details?id=com.lumvibe.app`;
  const ref  = `\n\nP.S. Use my referral code 🎁 *${referralCode}* when signing up to get 50 FREE bonus points! (totally optional 😊)`;
  return includeReferral && referralCode && referralCode !== 'ERROR' ? base + ref : base;
}

// ─── ContactInviteModal ───────────────────────────────────────────────────────

function ContactInviteModal({
  visible,
  onClose,
  referralCode,
  userName,
}: {
  visible: boolean;
  onClose: () => void;
  referralCode: string;
  userName: string;
}) {
  const [step,             setStep]             = useState<'select' | 'sent'>('select');
  const [contacts,         setContacts]         = useState<any[]>([]);
  const [search,           setSearch]           = useState('');
  const [selected,         setSelected]         = useState<Set<string>>(new Set());
  const [includeReferral,  setIncludeReferral]  = useState(false);
  const [loadingContacts,  setLoadingContacts]  = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [sendMethod,       setSendMethod]       = useState<'sms' | 'whatsapp'>('sms');

  React.useEffect(() => {
    if (visible) {
      setStep('select');
      setSelected(new Set());
      setSearch('');
      setIncludeReferral(false);
      setSendMethod('sms');
      loadContacts();
    }
  }, [visible]);

  const loadContacts = async () => {
    setLoadingContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoadingContacts(false);
        return;
      }
      setPermissionDenied(false);
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
      });
      const normalizePhone = (raw: string) => raw.replace(/\D/g, '').slice(-10);
      const seen = new Set<string>();
      const withPhone = (data || [])
        .filter(c => c.name && c.phoneNumbers && c.phoneNumbers.length > 0)
        .map(c => ({
          id: c.id,
          name: c.name,
          phone: c.phoneNumbers![0].number || '',
          initials: c.name!.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
        }))
        .filter(c => {
          const key = normalizePhone(c.phone);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      setContacts(withPhone);
    } catch {
      setPermissionDenied(true);
    } finally {
      setLoadingContacts(false);
    }
  };

  const filtered = React.useMemo(
    () => contacts.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search)
    ),
    [contacts, search],
  );

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(c => c.id)));
    }
  };

  const selectedContacts = contacts.filter(c => selected.has(c.id));

  const handleSend = async () => {
    for (const contact of selectedContacts) {
      const firstName = contact.name.split(' ')[0];
      const msg   = buildInviteMessage(firstName, userName, referralCode, includeReferral);
      const phone = contact.phone.replace(/[\s\-().]/g, '');
      if (sendMethod === 'whatsapp') {
        let intlPhone = phone.replace(/^\+/, '');
        const userTz  = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const isNG    = userTz === 'Africa/Lagos' || userTz === 'Africa/Abuja';
        if (isNG && intlPhone.startsWith('0')) {
          intlPhone = '234' + intlPhone.slice(1);
        }
        const waUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
        try { await Linking.openURL(waUrl); } catch {}
      } else {
        const separator = Platform.OS === 'ios' ? '&' : '?';
        const smsUrl    = `sms:${phone}${separator}body=${encodeURIComponent(msg)}`;
        try { await Linking.openURL(smsUrl); } catch {}
      }
    }
    setStep('sent');
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={ci.overlay}
      >
        <View style={ci.sheet}>
          {step === 'select' && (
            <>
              <View style={ci.header}>
                <View>
                  <Text style={ci.title}>Bring Your People 🙌</Text>
                  <Text style={ci.subtitle}>Send a personal invite from your phone</Text>
                </View>
                <TouchableOpacity onPress={onClose}>
                  <Feather name="x" size={24} color="#fff" />
                </TouchableOpacity>
              </View>

              <View style={ci.infoBanner}>
                <Text style={{ fontSize: 16 }}>💬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={ci.infoBannerTitle}>This is a personal invite — not a referral</Text>
                  <Text style={ci.infoBannerText}>The message sends from YOUR phone number. To earn referral rewards, use the Referral section above.</Text>
                </View>
              </View>

              {permissionDenied ? (
                <View style={ci.permissionBox}>
                  <Feather name="lock" size={40} color="#555" />
                  <Text style={ci.permissionTitle}>Contacts Access Needed</Text>
                  <Text style={ci.permissionText}>Allow Lumvibe to access your contacts so you can invite friends.</Text>
                  <TouchableOpacity style={ci.permissionBtn} onPress={loadContacts}>
                    <Text style={ci.permissionBtnText}>Allow Access</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={ci.searchBox}>
                    <Feather name="search" size={16} color="#555" />
                    <TextInput
                      style={ci.searchInput}
                      placeholder="Search contacts..."
                      placeholderTextColor="#555"
                      value={search}
                      onChangeText={setSearch}
                    />
                  </View>

                  <View style={ci.selectAllRow}>
                    <TouchableOpacity onPress={selectAll}>
                      <Text style={ci.selectAllText}>
                        {selected.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
                      </Text>
                    </TouchableOpacity>
                    <Text style={ci.countText}>
                      {selected.size > 0 ? `${selected.size} selected` : `${filtered.length} contacts`}
                    </Text>
                  </View>

                  {loadingContacts ? (
                    <ActivityIndicator color="#00ff88" style={{ marginVertical: 30 }} />
                  ) : (
                    <FlatList
                      data={filtered}
                      keyExtractor={item => item.id}
                      style={{ maxHeight: 280 }}
                      keyboardShouldPersistTaps="handled"
                      renderItem={({ item, index }) => {
                        const isSelected = selected.has(item.id);
                        const color      = AVATAR_COLORS[index % AVATAR_COLORS.length];
                        return (
                          <TouchableOpacity style={ci.contactRow} onPress={() => toggle(item.id)}>
                            <View style={[ci.avatar, { backgroundColor: color + '22', borderColor: isSelected ? '#00ff88' : '#222' }]}>
                              <Text style={[ci.avatarText, { color }]}>{item.initials}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[ci.contactName, isSelected && { color: '#00ff88' }]}>{item.name}</Text>
                              <Text style={ci.contactPhone}>{item.phone}</Text>
                            </View>
                            <View style={[ci.checkbox, isSelected && ci.checkboxOn]}>
                              {isSelected && <Text style={ci.checkmark}>✓</Text>}
                            </View>
                          </TouchableOpacity>
                        );
                      }}
                    />
                  )}

                  <View style={ci.toggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={ci.toggleTitle}>🎁 Include referral code?</Text>
                      <Text style={ci.toggleSub}>Your friend gets 50 bonus points on signup</Text>
                    </View>
                    <TouchableOpacity
                      style={[ci.toggleTrack, includeReferral && ci.toggleTrackOn]}
                      onPress={() => setIncludeReferral(!includeReferral)}
                    >
                      <View style={[ci.toggleThumb, includeReferral && ci.toggleThumbOn]} />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={[ci.btn, selected.size === 0 && ci.btnDisabled]}
                    disabled={selected.size === 0}
                    onPress={handleSend}
                  >
                    <Text style={ci.btnText}>Send via SMS 📱</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {step === 'sent' && (
            <View style={{ padding: 32, alignItems: 'center' }}>
              <Text style={{ fontSize: 52, marginBottom: 16 }}>🎉</Text>
              <Text style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>Invites Sent!</Text>
              <Text style={{ color: '#666', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>Your friends will receive the invitation shortly.</Text>
              <TouchableOpacity style={ci.btn} onPress={onClose}>
                <Text style={ci.btnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── ProfileScreen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { userProfile, user, logout } = useAuthStore();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
    });
    return () => unsub();
  }, []);

  // ── Modal visibility ──
  const [refreshing,                  setRefreshing]                  = useState(false);
  const [walletVisible,               setWalletVisible]               = useState(false);
  const [settingsVisible,             setSettingsVisible]             = useState(false);
  const [aboutModalVisible,           setAboutModalVisible]           = useState(false);
  const [savedPostsModalVisible,      setSavedPostsModalVisible]      = useState(false);
  const [paystackConnectModalVisible, setPaystackConnectModalVisible] = useState(false);
  const [editModalVisible,            setEditModalVisible]            = useState(false);
  const [withdrawModalVisible,        setWithdrawModalVisible]        = useState(false);
  const [followersModalVisible,       setFollowersModalVisible]       = useState(false);
  const [followingModalVisible,       setFollowingModalVisible]       = useState(false);
  const [leaderboardModalVisible,     setLeaderboardModalVisible]     = useState(false);
  const [badgesModalVisible,          setBadgesModalVisible]          = useState(false);
  const [inviteModalVisible,          setInviteModalVisible]          = useState(false);
  const [contactInviteModalVisible,   setContactInviteModalVisible]   = useState(false);
  const [profilePictureModalVisible,  setProfilePictureModalVisible]  = useState(false);
  const [selectedBadge,               setSelectedBadge]               = useState<any>(null);
  const [badgeDetailVisible,          setBadgeDetailVisible]          = useState(false);
  const [socialModalVisible,          setSocialModalVisible]          = useState(false);
  const [deleteAccountModalVisible,   setDeleteAccountModalVisible]   = useState(false);

  // ── Profile data ──
  const [socialLinks,    setSocialLinks]    = useState<Record<string, string>>({ twitter: '', instagram: '', tiktok: '' });
  const [editingSocial,  setEditingSocial]  = useState<Record<string, string>>({ twitter: '', instagram: '', tiktok: '' });
  const [savingSocial,   setSavingSocial]   = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount,   setDeletingAccount]   = useState(false);

  // ── Wallet / coins ──
  const [coins,        setCoins]        = useState(0);
  const [stats,        setStats]        = useState({ posts_count: 0, followers_count: 0, following_count: 0, likes_received: 0 });
  const [userPosts,    setUserPosts]    = useState<Post[]>([]);
  const [savedPosts,   setSavedPosts]   = useState<Post[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [followers,    setFollowers]    = useState<Follower[]>([]);
  const [following,    setFollowing]    = useState<Follower[]>([]);
  const [leaderboardData, setLeaderboardData] = useState<AppUser[]>([]);

  // ── Gamification ──
  const [points,           setPoints]           = useState(0);
  const [level,            setLevel]            = useState(1);
  const [currentStreak,    setCurrentStreak]    = useState(0);
  const [userBadges,       setUserBadges]       = useState<any[]>([]);
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [inviteCount,      setInviteCount]      = useState(0);
  const [referralCode,     setReferralCode]     = useState('');
  const [myReferrerId,     setMyReferrerId]     = useState<string | null>(null);
  const [totalUserCount,   setTotalUserCount]   = useState(0);

  // ── Edit profile ──
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editBio,         setEditBio]         = useState('');
  const [editUsername,    setEditUsername]     = useState('');
  const [saving,          setSaving]          = useState(false);

  // ── Withdrawal ──
  const [withdrawAmount,    setWithdrawAmount]    = useState('');
  const [withdrawing,       setWithdrawing]       = useState(false);
  const [paystackConnected, setPaystackConnected] = useState(false);
  const [uploadingAvatar,   setUploadingAvatar]   = useState(false);
  const withdrawalInProgress = useRef(false);

  // ── Bank connect ──
  const [banks,              setBanks]              = useState<Array<{ name: string; code: string }>>([]);
  const [banksLoading,       setBanksLoading]       = useState(false);
  const [bankSearch,         setBankSearch]         = useState('');
  const [selectedBank,       setSelectedBank]       = useState<{ name: string; code: string } | null>(null);
  const [accountNumber,      setAccountNumber]      = useState('');
  const [accountName,        setAccountName]        = useState('');
  const [verifyingAccount,   setVerifyingAccount]   = useState(false);
  const [connectingPaystack, setConnectingPaystack] = useState(false);

  // ── Global bank ──
  const [bankRegion,         setBankRegion]         = useState<'nigeria' | 'global'>('nigeria');
  const [selectedCountry,    setSelectedCountry]    = useState<any>(null);
  const [globalBanks,        setGlobalBanks]        = useState<Array<{ name: string; code: string }>>([]);
  const [selectedGlobalBank, setSelectedGlobalBank] = useState<{ name: string; code: string } | null>(null);
  const [globalAccountNo,    setGlobalAccountNo]    = useState('');
  const [globalAccountName,  setGlobalAccountName]  = useState('');
  const [routingNumber,      setRoutingNumber]      = useState('');
  const [iban,               setIban]               = useState('');
  const [showCountryList,    setShowCountryList]    = useState(false);
  const [showGlobalBankList, setShowGlobalBankList] = useState(false);
  const [loadingGlobalBanks, setLoadingGlobalBanks] = useState(false);

  // ── UI state ──
  const [currency,           setCurrency]           = useState(detectCurrency);
  const [loadingPosts,       setLoadingPosts]       = useState(false);
  const [loadingSavedPosts,  setLoadingSavedPosts]  = useState(false);
  const [loadingFollowers,   setLoadingFollowers]   = useState(false);
  const [loadingFollowing,   setLoadingFollowing]   = useState(false);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [activeThemeId,      setActiveThemeId]      = useState('default');
  const [useNewLayout,       setUseNewLayout]       = useState(false);
  const [isWeeklyWinner,     setIsWeeklyWinner]     = useState(false);
  const [winnerWeekLabel,    setWinnerWeekLabel]    = useState('');
  const [winnerPoints,       setWinnerPoints]       = useState(0);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled,      setDarkModeEnabled]      = useState(true);

  // ── Derived values ──
  const theme          = THEMES[activeThemeId] ?? THEMES['default'];
  const userPayoutRate = myReferrerId ? WITHDRAWAL_SPLIT.USER_REFERRED : WITHDRAWAL_SPLIT.USER_NOT_REFERRED;
  const hasGlowingAvatar = unlockedFeatures.includes('glowing_avatar');
  const earnedBadgeIds   = userBadges.map((ub: any) => ub.badge_id);
  const balLocal         = Number((coins * currency.ratePerCoin).toFixed(2));
  const withdrawNum      = parseFloat(withdrawAmount) || 0;
  const previewTotal     = withdrawNum * currency.ratePerCoin;
  const previewFee       = previewTotal * WITHDRAWAL_SPLIT.PLATFORM_FEE;
  const previewRef       = myReferrerId ? previewTotal * WITHDRAWAL_SPLIT.REFERRAL_COMMISSION : 0;
  const previewRcv       = previewTotal * userPayoutRate;
  const isPaystackAuto   = PAYSTACK_AUTO_CURRENCIES.includes(currency.code);

  const filteredBanks = useMemo(
    () => banks.filter(b => b.name.toLowerCase().includes(bankSearch.toLowerCase())),
    [banks, bankSearch],
  );

  const badgeStats = useMemo(() => ({
    posts_count:     stats.posts_count,
    followers_count: stats.followers_count,
    likes_received:  stats.likes_received,
    currentStreak,
  }), [stats.posts_count, stats.followers_count, stats.likes_received, currentStreak]);

  // ── Effects ──
  useFocusEffect(
    useCallback(() => {
      if (user?.id) {
        loadUserStats();
        loadUserCoins();
        loadTransactions();
        loadGamificationData();
      }
    }, [user?.id]),
  );

  useEffect(() => {
    if (user?.id) {
      loadAllData();
      const walletChannel = supabase
        .channel('wallet-realtime')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` }, (payload: any) => {
          if (payload.new?.coins !== undefined) {
            setCoins(Math.max(0, payload.new.coins));
          } else {
            loadUserCoins();
          }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` }, () => {
          loadTransactions();
          loadUserCoins();
        })
        .subscribe();
      return () => { supabase.removeChannel(walletChannel); };
    }
  }, [user?.id]);

  // ── Data loaders ──
  const loadAllData = async () => {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000));
    try {
      await Promise.race([
        Promise.all([
          loadUserCurrency(), loadUserCoins(), loadUserStats(), loadUserPosts(),
          loadSavedPosts(), loadGamificationData(), loadUserBadges(), loadUnlockedFeatures(),
          loadTransactions(), checkPaystackConnection(), loadReferralData(),
          loadTheme(), loadMyReferrerStatus(), loadTotalUserCount(), loadSocialLinks(),
          loadLayoutPreference(),
        ]),
        timeout,
      ]);
    } catch (e: any) {
      if (e?.message !== 'timeout') console.warn('loadAllData error:', e?.message);
    }
  };

  const loadUserCurrency = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('withdrawal_currency').eq('id', user.id).single();
      if (data?.withdrawal_currency) {
        const found = Object.values(CURRENCY_BY_TIMEZONE).find(c => c.code === data.withdrawal_currency);
        if (found) setCurrency(found);
      }
    } catch {}
  };

  const loadGamificationData = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('points, level, current_streak, is_weekly_winner, winner_week_label, winner_points, last_active_date')
        .eq('id', user.id)
        .single();
      if (data) {
        setPoints(data.points || 0);
        setLevel(data.level || 1);
        setCurrentStreak(data.current_streak || 0);
        setIsWeeklyWinner(data.is_weekly_winner || false);
        setWinnerWeekLabel(data.winner_week_label || '');
        setWinnerPoints(data.winner_points || 0);
        try {
          const todayStr     = new Date().toISOString().split('T')[0];
          const lastDate     = data.last_active_date || '';
          if (lastDate !== todayStr) {
            const yesterday    = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            const newStreak    = lastDate === yesterdayStr ? (data.current_streak || 0) + 1 : 1;
            const DAILY_LOGIN_POINTS = 5;
            const newPoints    = (data.points || 0) + DAILY_LOGIN_POINTS;
            await supabase.from('users').update({ last_active_date: todayStr, current_streak: newStreak, points: newPoints }).eq('id', user.id);
            setPoints(newPoints);
            setCurrentStreak(newStreak);
          }
        } catch (streakErr) {
          console.warn('Daily streak update skipped:', streakErr);
        }
      }
    } catch {}
  };

  const loadUserBadges = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.from('user_badges').select('*').eq('user_id', user.id);
      if (error) console.warn('loadUserBadges error:', error.message);
      const existing = data || [];
      await checkAndAwardBadges(existing);
      const { data: fresh } = await supabase.from('user_badges').select('*').eq('user_id', user.id);
      setUserBadges(fresh || []);
    } catch (e: any) {
      console.warn('loadUserBadges catch:', e?.message);
    }
  };

  const checkAndAwardBadges = async (existingBadges: any[]) => {
    if (!user?.id) return;
    try {
      const [userDataRes, userCountRes, pcRes, uRes, upRes] = await Promise.all([
        supabase.from('users').select('points').eq('id', user.id).single(),
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('users').select('followers_count, current_streak').eq('id', user.id).single(),
        supabase.from('posts').select('id').eq('user_id', user.id),
      ]);
      let lks = 0;
      if (upRes.data && upRes.data.length > 0) {
        const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).in('post_id', upRes.data.map((p: any) => p.id));
        lks = count || 0;
      }
      const currentUserCount = userCountRes.count ?? 999999;
      const criteria = [
        { id: 'founding_member', bonusPoints: 100, check: () => currentUserCount <= 100 },
        { id: 'early_adopter',   bonusPoints: 50,  check: () => currentUserCount <= 1000 },
        { id: 'streak_7',        bonusPoints: 50,  check: () => (uRes.data?.current_streak || 0) >= 7 },
        { id: 'streak_30',       bonusPoints: 200, check: () => (uRes.data?.current_streak || 0) >= 30 },
        { id: 'posts_10',        bonusPoints: 100, check: () => (pcRes.count || 0) >= 10 },
        { id: 'followers_100',   bonusPoints: 150, check: () => (uRes.data?.followers_count || 0) >= 100 },
        { id: 'likes_100',       bonusPoints: 100, check: () => lks >= 100 },
      ];
      let pointsToAdd = 0;
      for (const badge of criteria) {
        const alreadyEarned = existingBadges.some((eb: any) => eb.badge_id === badge.id);
        if (!alreadyEarned && badge.check()) {
          const { error } = await supabase.from('user_badges').insert({
            user_id:    user.id,
            badge_id:   badge.id,
            badge_name: BADGES.find(b => b.id === badge.id)?.name || badge.id,
          });
          if (!error) {
            pointsToAdd += badge.bonusPoints;
            const info = BADGES.find(b => b.id === badge.id);
            if (info) {
              try {
                await supabase.from('notifications').insert({
                  user_id: user.id, type: 'achievement',
                  title:   `Badge Earned! ${info.icon}`,
                  message: `You earned "${info.name}"! Reward: ${info.reward}`,
                  is_read: false,
                });
              } catch {}
            }
          } else {
            console.warn('Badge insert error:', badge.id, error.message);
          }
        }
      }
      if (pointsToAdd > 0) {
        const newPoints = (userDataRes.data?.points || 0) + pointsToAdd;
        await supabase.from('users').update({ points: newPoints }).eq('id', user.id);
      }
    } catch (e: any) {
      console.warn('checkAndAwardBadges error:', e?.message);
    }
  };

  const loadUnlockedFeatures = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('user_unlocked_features').select('feature_id').eq('user_id', user.id);
      setUnlockedFeatures(data?.map((f: any) => f.feature_id) || []);
    } catch {}
  };

  const loadUserCoins = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('coins').eq('id', user.id).single();
      setCoins(Math.max(0, data?.coins || 0));
    } catch {}
  };

  const loadTransactions = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('transactions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20);
      setTransactions(data || []);
    } catch {}
  };

  const loadUserStats = async () => {
    if (!user?.id) return;
    try {
      const [userRes, pcRes, likeRes] = await Promise.all([
        supabase.from('users').select('followers_count, following_count').eq('id', user.id).single(),
        supabase.from('posts').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('posts').select('id').eq('user_id', user.id),
      ]);
      let lks = 0;
      if (likeRes.data && likeRes.data.length > 0) {
        const { count } = await supabase.from('likes').select('*', { count: 'exact', head: true }).in('post_id', likeRes.data.map((p: any) => p.id));
        lks = count || 0;
      }
      setStats({
        posts_count:     pcRes.count || 0,
        followers_count: userRes.data?.followers_count || 0,
        following_count: userRes.data?.following_count || 0,
        likes_received:  lks,
      });
    } catch {}
  };

  const loadUserPosts = async () => {
    if (!user?.id) return;
    setLoadingPosts(true);
    try {
      const { data } = await supabase
        .from('posts')
        .select('id, caption, media_url, media_type, thumbnail_url, likes_count, comments_count, views_count, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setUserPosts(data || []);
    } catch {}
    finally { setLoadingPosts(false); }
  };

  const loadSavedPosts = async () => {
    if (!user?.id) return;
    setLoadingSavedPosts(true);
    try {
      const { data: savedData, error: savedError } = await supabase
        .from('saved_posts')
        .select('post:posts(id, media_url, media_type, thumbnail_url, caption)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!savedError && savedData && savedData.length > 0) {
        setSavedPosts((savedData).map((d: any) => d.post).filter(Boolean));
        return;
      }
      const { data: allPosts } = await supabase
        .from('posts')
        .select('id, media_url, media_type, thumbnail_url, caption, saved_by')
        .contains('saved_by', [user.id])
        .order('created_at', { ascending: false });
      setSavedPosts(allPosts || []);
    } catch {
      setSavedPosts([]);
    } finally {
      setLoadingSavedPosts(false);
    }
  };

  const loadFollowers = async () => {
    if (!user?.id) return;
    setLoadingFollowers(true);
    try {
      const { data } = await supabase
        .from('follows')
        .select('follower_id, created_at, follower:users!follows_follower_id_fkey(id, username, display_name, avatar_url, is_premium)')
        .eq('following_id', user.id)
        .order('created_at', { ascending: false });
      setFollowers((data || []).map((i: any) => i.follower).filter(Boolean));
    } catch {
      setFollowers([]);
    } finally {
      setLoadingFollowers(false);
    }
  };

  const loadFollowing = async () => {
    if (!user?.id) return;
    setLoadingFollowing(true);
    try {
      const { data } = await supabase
        .from('follows')
        .select('following_id, created_at, following:users!follows_following_id_fkey(id, username, display_name, avatar_url, is_premium)')
        .eq('follower_id', user.id)
        .order('created_at', { ascending: false });
      setFollowing((data || []).map((i: any) => i.following).filter(Boolean));
    } catch {
      setFollowing([]);
    } finally {
      setLoadingFollowing(false);
    }
  };

  const loadLeaderboard = async () => {
    setLoadingLeaderboard(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, username, display_name, avatar_url, points, level, is_premium')
        .order('points', { ascending: false })
        .limit(20);
      setLeaderboardData(data || []);
    } catch {}
    finally { setLoadingLeaderboard(false); }
  };

  const loadReferralData = async () => {
    if (!user?.id) return;
    try {
      const { data: userData } = await supabase
        .from('users')
        .select('referral_code, username, successful_referrals')
        .eq('id', user.id)
        .single();
      let code = userData?.referral_code;
      if (!code) {
        code = generateReferralCode(userData?.username || 'USER');
        await supabase.from('users').update({ referral_code: code }).eq('id', user.id);
      }
      setReferralCode(code);
      const { count: countFromReferrals } = await supabase.from('referrals').select('id', { count: 'exact', head: true }).eq('referrer_id', user.id);
      const { count: countFromUsers }     = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('referred_by', user.id);
      const finalCount = Math.max(countFromReferrals || 0, countFromUsers || 0);
      setInviteCount(finalCount);
      if (userData?.successful_referrals !== finalCount) {
        await supabase.from('users').update({ successful_referrals: finalCount }).eq('id', user.id);
        const prevCount    = userData?.successful_referrals || 0;
        const newReferrals = finalCount - prevCount;
        if (newReferrals > 0) {
          const { data: meData } = await supabase.from('users').select('points').eq('id', user.id).single();
          const currentPoints    = meData?.points || 0;
          const bonusPoints      = newReferrals * 100;
          await supabase.from('users').update({ points: currentPoints + bonusPoints }).eq('id', user.id);
          await supabase.from('transactions').insert({
            user_id:     user.id,
            type:        'referral_bonus',
            amount:      bonusPoints,
            description: `🎉 Referral bonus: ${newReferrals} new person${newReferrals > 1 ? 's' : ''} joined with your code!`,
            status:      'completed',
          });
          setPoints(currentPoints + bonusPoints);
        }
      }
    } catch {
      setReferralCode('ERROR');
      setInviteCount(0);
    }
  };

  const loadMyReferrerStatus = async () => {
    if (!user?.id) return;
    try {
      const referrerId = await getWithdrawingUserReferrer(user.id);
      setMyReferrerId(referrerId || null);
    } catch {}
  };

  const loadTotalUserCount = async () => {
    try {
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
      setTotalUserCount(count || 0);
    } catch {}
  };

  const loadSocialLinks = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('users')
        .select('social_twitter, social_instagram, social_tiktok')
        .eq('id', user.id)
        .single();
      if (data) {
        const links = {
          twitter:   data.social_twitter   || '',
          instagram: data.social_instagram || '',
          tiktok:    data.social_tiktok    || '',
        };
        setSocialLinks(links);
        setEditingSocial(links);
      }
    } catch {}
  };

  const loadTheme = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('active_theme').eq('id', user.id).single();
      if (data?.active_theme && THEMES[data.active_theme]) setActiveThemeId(data.active_theme);
    } catch {}
  };

  const loadLayoutPreference = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('use_new_profile_layout').eq('id', user.id).single();
      setUseNewLayout(data?.use_new_profile_layout || false);
    } catch {}
  };

  const checkPaystackConnection = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase.from('users').select('bank_account_number').eq('id', user.id).single();
      setPaystackConnected(!!(data?.bank_account_number));
    } catch {}
  };

  // ── Actions ──
  const handleFollowUser = async (userId: string, isFollowing: boolean) => {
    if (!user?.id) return;
    try {
      setFollowing(prev =>
        isFollowing
          ? prev.filter(p => p.id !== userId)
          : [...prev, { id: userId, display_name: 'Loading...', username: 'loading' } as Follower],
      );
      setStats(prev => ({
        ...prev,
        following_count: Math.max(0, prev.following_count + (isFollowing ? -1 : 1)),
      }));
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', userId);
        await supabase.rpc('increment_followers', { target_id: userId, delta: -1 });
        await supabase.rpc('increment_following', { target_id: user.id, delta: -1 });
      } else {
        await supabase.from('follows').insert({ follower_id: user.id, following_id: userId });
        await supabase.rpc('increment_followers', { target_id: userId, delta: 1 });
        await supabase.rpc('increment_following', { target_id: user.id, delta: 1 });
      }
      Promise.all([loadUserStats(), loadFollowers(), loadFollowing()]);
    } catch {
      Alert.alert('Error', 'Failed to update follow status');
      Promise.all([loadUserStats(), loadFollowers(), loadFollowing()]);
    }
  };

  const navigateToUserProfile = (targetUserId: string) => {
    if (targetUserId !== user?.id) navigation.navigate('UserProfile', { userId: targetUserId });
  };

  const navigateToPost = (postId: string) => {
    setSavedPostsModalVisible(false);
    setTimeout(() => navigation.navigate('Post', { postId }), 300);
  };

  const handleBuyCoins = useCallback(() => {
    setWalletVisible(false);
    setTimeout(() => navigation.navigate('BuyCoins'), 300);
  }, [navigation]);

  const onRefresh = async () => { setRefreshing(true); await loadAllData(); setRefreshing(false); };

  const handleLogout = () => {
    Alert.alert(t.common.logout, t.settings.logoutConfirm, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: t.common.logout, style: 'destructive', onPress: async () => {
          try {
            await supabase.auth.signOut();
            if (logout) logout();
            navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] }));
          } catch { Alert.alert('Error', 'Failed to logout'); }
        },
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim() !== 'DELETE') {
      Alert.alert('Type DELETE', 'Please type DELETE in capitals to confirm');
      return;
    }
    setDeletingAccount(true);
    try {
      if (!user?.id) return;
      const { error: deleteAuthError } = await supabase.functions.invoke('deleteaccount');
      if (deleteAuthError) console.error('Auth deletion failed:', deleteAuthError.message);
      await supabase.from('likes').delete().eq('user_id', user.id);
      await supabase.from('comment_likes').delete().eq('user_id', user.id);
      await supabase.from('comments').delete().eq('user_id', user.id);
      await supabase.from('notifications').delete().eq('user_id', user.id);
      await supabase.from('follows').delete().eq('follower_id', user.id);
      await supabase.from('follows').delete().eq('following_id', user.id);
      await supabase.from('transactions').delete().eq('user_id', user.id);
      await supabase.from('user_badges').delete().eq('user_id', user.id);
      await supabase.from('marketplace_withdrawals').delete().eq('seller_id', user.id);
      await supabase.from('withdrawals').delete().eq('user_id', user.id); // ✅ ADDED
      await supabase.from('reports').delete().eq('reporter_id', user.id); // ✅ ADDED
      await supabase.from('posts').delete().eq('user_id', user.id);
      await supabase.from('users').delete().eq('id', user.id);
      await supabase.auth.signOut();
      if (logout) logout();
      Alert.alert('Account Deleted', 'Your account and all data have been permanently deleted.');
      navigation.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] }));
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to delete account. Please contact lumvibesupport@gmail.com');
    } finally {
      setDeletingAccount(false);
      setDeleteAccountModalVisible(false);
    }
  };


  // ✅ NEW: Download My Data — GDPR/CCPA compliance
  const handleDownloadData = async () => {
    if (!user?.id) return;
    Alert.alert(
      '📦 Preparing Your Data',
      'We are collecting all your data. This may take a moment...',
    );
    try {
      const [
        { data: userData },
        { data: postsData },
        { data: likesData },
        { data: commentsData },
        { data: followersData },
        { data: followingData },
        { data: transactionsData },
        { data: badgesData },
      ] = await Promise.all([
        supabase.from('users').select('*').eq('id', user.id).single(),
        supabase.from('posts').select('id,caption,media_type,created_at,likes_count,comments_count,views_count').eq('user_id', user.id),
        supabase.from('likes').select('post_id,created_at').eq('user_id', user.id),
        supabase.from('comments').select('post_id,text,created_at').eq('user_id', user.id),
        supabase.from('follows').select('following_id').eq('follower_id', user.id),
        supabase.from('follows').select('follower_id').eq('following_id', user.id),
        supabase.from('transactions').select('type,amount,description,created_at,status').eq('user_id', user.id),
        supabase.from('user_badges').select('badge_id,created_at').eq('user_id', user.id),
      ]);

      const dataExport = {
        exported_at: new Date().toISOString(),
        account: {
          id: userData?.id,
          username: userData?.username,
          display_name: userData?.display_name,
          email: user.email,
          created_at: userData?.created_at,
          is_premium: userData?.is_premium,
          points: userData?.points,
          coins: userData?.coins,
          level: userData?.level,
        },
        posts: postsData || [],
        likes_given: likesData || [],
        comments: commentsData || [],
        following: followingData || [],
        followers: followersData || [],
        transactions: transactionsData || [],
        badges: badgesData || [],
        privacy_note: 'This is all the personal data LumVibe holds about your account. For deletion requests, use the Delete Account option in Settings.',
      };

      const jsonString = JSON.stringify(dataExport, null, 2);
      const summary = `Your Data Export Summary:\n\n` +
        `Account: @${userData?.username}\n` +
        `Posts: ${postsData?.length || 0}\n` +
        `Likes given: ${likesData?.length || 0}\n` +
        `Comments: ${commentsData?.length || 0}\n` +
        `Transactions: ${transactionsData?.length || 0}\n` +
        `Badges: ${badgesData?.length || 0}\n\n` +
        `Tap Share to save or send your complete data file.`;

      Alert.alert('✅ Data Ready', summary, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Share / Save',
          onPress: async () => {
            try {
              await Share.share({
                message: jsonString,
                title: 'LumVibe Data Export',
              });
            } catch (e: any) {
              Alert.alert('Error', 'Could not share data. Please try again.');
            }
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('Error', 'Failed to collect your data. Please try again or contact lumvibesupport@gmail.com');
    }
  };

  // ✅ NEW: Do Not Sell My Information — CCPA compliance
  const handleDoNotSell = () => {
    Alert.alert(
      '🔒 Do Not Sell My Information',
      'LumVibe does not sell, trade, or transfer your personal information to third parties for commercial purposes.\n\nWe may share anonymised, non-personal usage data with analytics services to improve the app, but your personal information (name, email, posts, location) is never sold.\n\nFor questions, contact: lumvibesupport@gmail.com',
      [
        {
          text: 'Contact Support',
          onPress: () => Linking.openURL('mailto:lumvibesupport@gmail.com?subject=Privacy%20Request&body=Hi%20LumVibe%20team%2C%20I%20have%20a%20question%20about%20my%20data%3A%20'),
        },
        { text: 'OK', style: 'cancel' },
      ]
    );
  };

  const handleCopyReferralCode = async () => {
    if (referralCode && referralCode !== 'ERROR') {
      await Clipboard.setStringAsync(referralCode);
      Alert.alert('Copied! 📋', 'Referral code copied to clipboard');
    }
  };

  const handleEditProfile = () => {
    setEditDisplayName(userProfile?.display_name || '');
    setEditBio((userProfile as any)?.bio || '');
    setEditUsername(userProfile?.username || '');
    setEditModalVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!editDisplayName.trim()) { Alert.alert('Error', 'Display name cannot be empty'); return; }
    if (!editUsername.trim())    { Alert.alert('Error', 'Username cannot be empty'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('users').update({
        display_name: editDisplayName.trim(),
        bio:          editBio.trim(),
        username:     editUsername.trim().toLowerCase(),
      }).eq('id', user.id);
      if (error) throw error;
      Alert.alert('Success', 'Profile updated!');
      setEditModalVisible(false);
      await onRefresh();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeAvatar = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setUploadingAvatar(true);
        const asset   = result.assets[0];
        const base64  = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        const fileExt = asset.uri.split('.').pop()?.toLowerCase() || 'jpg';
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(`${user!.id}/avatar.${fileExt}`, decode(base64), { contentType: `image/${fileExt}`, cacheControl: '3600', upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(`${user!.id}/avatar.${fileExt}`);
        const cacheBustedUrl = `${publicUrl}?t=${Date.now()}`;
        await supabase.from('users').update({ avatar_url: cacheBustedUrl }).eq('id', user!.id);
        Alert.alert('Success! 🎉', 'Profile picture updated!');
        await onRefresh();
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to update avatar');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveSocialLinks = async () => {
    if (!user?.id) return;
    setSavingSocial(true);
    try {
      await supabase.from('users').update({
        social_twitter:   editingSocial.twitter,
        social_instagram: editingSocial.instagram,
        social_tiktok:    editingSocial.tiktok,
      }).eq('id', user.id);
      setSocialLinks({ ...editingSocial });
      setSocialModalVisible(false);
      Alert.alert('Saved! ✅', 'Social links updated.');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingSocial(false);
    }
  };

  const handleInviteFriends = async (platform?: 'whatsapp' | 'twitter' | 'instagram' | 'tiktok' | 'general') => {
    const code = referralCode && referralCode !== 'ERROR' ? referralCode : '';
    const link = `https://lumvibe.site/ref/${code}`;
    const messages: Record<string, string> = {
      whatsapp:  `Hey! 👋 I just joined *Lumvibe* — a new app where you actually get *PAID* for posting, getting likes and comments! 🤑\n\nUse my referral code *${code}* to get 50 bonus coins when you sign up!\n\nDownload here 👉 ${link}`,
      twitter:   `I'm earning money just by posting on @LumVibeApp 🤑\n\nNo more posting for free! Join me and start earning today 👉 ${link}\n\nUse my code: ${code} for 50 bonus coins! 🎁 #LumVibe #NigerianCreators #EarnOnline`,
      instagram: `Finally an app that PAYS Nigerian creators! 🇳🇬💰\n\nI joined LumVibe — you earn coins from every post, like and comment. Real money! 🤑\n\nJoin me 👉 ${link}\nReferral code: ${code} (get 50 bonus coins!)\n\n#LumVibe #NigerianCreators #ContentCreator #EarnOnline`,
      tiktok:    `I found an app that pays you for posting — it's called LumVibe 🤑🇳🇬\n\nUse my code ${code} to get 50 FREE coins when you join!\n\nDownload 👉 ${link}\n\n#LumVibe #NigerianCreators #EarnOnline #ContentCreator #FYP`,
      general:   `Join me on Lumvibe! 🚀\n\nUse my referral code: ${code}\n\n✅ Get 50 bonus coins\n✅ I get 100 bonus coins\n✅ Earn from every post, like & comment!\n\nDownload: ${link}`,
    };
    const msg = messages[platform || 'general'];
    if (platform === 'whatsapp') {
      const url      = `whatsapp://send?text=${encodeURIComponent(msg)}`;
      const canOpen  = await Linking.canOpenURL(url);
      if (canOpen) { await Linking.openURL(url); return; }
    }
    try { await Share.share({ message: msg }); } catch {}
  };

  const handleSelectGlobalCountry = async (country: any) => {
    setSelectedCountry(country);
    setShowCountryList(false);
    setSelectedGlobalBank(null);
    setGlobalBanks([]);
    setLoadingGlobalBanks(true);
    try { const bankList = await getPaystackBanks(country.code); setGlobalBanks(bankList); } catch {}
    finally { setLoadingGlobalBanks(false); }
  };

  const handleConnectGlobalBank = async () => {
    if (!globalAccountName || !globalAccountNo || !selectedCountry) {
      Alert.alert('Error', 'Please fill in all bank details');
      return;
    }
    setConnectingPaystack(true);
    try {
      await supabase.from('users').update({
        bank_account_number: globalAccountNo,
        bank_account_name:   globalAccountName,
        bank_code:           selectedGlobalBank?.code || routingNumber,
        bank_name:           selectedGlobalBank?.name || '',
        withdrawal_country:  selectedCountry.code,
        withdrawal_currency: selectedCountry.currency,
        withdrawal_iban:     iban || null,
      }).eq('id', user!.id);
      setPaystackConnected(true);
      setPaystackConnectModalVisible(false);
      Alert.alert('Bank Connected! ✅', `Your ${selectedCountry.name} bank has been saved.`);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to connect bank');
    } finally {
      setConnectingPaystack(false);
    }
  };

  const handleConnectPaystack = async () => {
    setBankSearch(''); setSelectedBank(null); setAccountNumber(''); setAccountName('');
    setGlobalAccountNo(''); setGlobalAccountName(''); setSelectedCountry(null);
    setBankRegion('nigeria');
    setPaystackConnectModalVisible(true);
    setBanksLoading(true);
    try {
      const bankList = await getPaystackBanks('NG');
      setBanks(bankList);
    } catch {
      Alert.alert('Error', 'Could not load banks. Please check your connection and try again.');
    } finally {
      setBanksLoading(false);
    }
  };

  const handleVerifyAccount = async () => {
    if (!accountNumber || !selectedBank) {
      Alert.alert('Error', 'Please select a bank and enter account number');
      return;
    }
    setVerifyingAccount(true);
    try {
      const result = await verifyPaystackAccount(accountNumber, selectedBank.code);
      if (result.success && result.accountName) {
        setAccountName(result.accountName);
        Alert.alert('Account Verified! ✅', `Account Name: ${result.accountName}`);
      } else {
        Alert.alert('Verification Failed', result.message || 'Invalid account details');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Verification failed');
    } finally {
      setVerifyingAccount(false);
    }
  };

  const handleConfirmPaystackConnection = async () => {
    if (!accountName || !accountNumber || !selectedBank) {
      Alert.alert('Error', 'Please verify your account first');
      return;
    }
    setConnectingPaystack(true);
    try {
      await supabase.from('users').update({
        bank_account_number: accountNumber,
        bank_account_name:   accountName,
        bank_code:           selectedBank.code,
        bank_name:           selectedBank.name,
        withdrawal_country:  'NG',
        withdrawal_currency: 'NGN',
      }).eq('id', user!.id);
      setPaystackConnected(true);
      setPaystackConnectModalVisible(false);
      Alert.alert('Success! 🎉', 'Bank account connected! You can now withdraw.');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to connect account');
    } finally {
      setConnectingPaystack(false);
    }
  };

  const handleWithdraw = async () => {
    const amountNum = parseFloat(withdrawAmount);
    if (!amountNum || isNaN(amountNum) || amountNum <= 0) { Alert.alert('Invalid Amount', 'Enter a valid amount'); return; }
    if (amountNum < MIN_WITHDRAW_COINS) { Alert.alert('Invalid Amount', `Minimum withdrawal is ${MIN_WITHDRAW_COINS} coins`); return; }
    if (amountNum > coins) { Alert.alert('Insufficient Balance', "You don't have enough coins"); return; }
    if (!paystackConnected) {
      Alert.alert('Connect Bank First', 'Connect your bank account before withdrawing.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: () => { setWithdrawModalVisible(false); setTimeout(() => handleConnectPaystack(), 300); } },
      ]);
      return;
    }
    const totalLocal   = amountNum * currency.ratePerCoin;
    const platformFee  = totalLocal * WITHDRAWAL_SPLIT.PLATFORM_FEE;
    const referralCut  = myReferrerId ? totalLocal * WITHDRAWAL_SPLIT.REFERRAL_COMMISSION : 0;
    const userReceives = totalLocal * userPayoutRate;
    const sym          = currency.symbol;
    const amountUSD    = amountNum * 0.10;
    const netUSD       = amountUSD * userPayoutRate;
    const referralCommissionCoins = myReferrerId
      ? parseFloat((amountNum * WITHDRAWAL_SPLIT.REFERRAL_COMMISSION).toFixed(4))
      : 0;
    const methodNote = isPaystackAuto
      ? '\n\n💳 Payment will be sent automatically to your bank.'
      : '\n\n📋 We will process your payment within 1-3 business days.';
    const msg = myReferrerId
      ? `Amount: ${sym}${totalLocal.toLocaleString()}\nPlatform Fee (20%): -${sym}${platformFee.toLocaleString()}\nReferral Commission (5%): -${sym}${referralCut.toLocaleString()}\nYou Receive (75%): ${sym}${userReceives.toLocaleString()}${methodNote}`
      : `Amount: ${sym}${totalLocal.toLocaleString()}\nPlatform Fee (20%): -${sym}${platformFee.toLocaleString()}\nYou Receive (80%): ${sym}${userReceives.toLocaleString()}${methodNote}`;
    Alert.alert('Confirm Withdrawal', msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: () => executeWithdraw(amountNum, netUSD, userReceives, referralCommissionCoins, sym) },
    ]);
  };

  const executeWithdraw = async (
    amountNum: number,
    netUSD: number,
    userReceives: number,
    referralCommissionCoins: number,
    sym: string,
  ) => {
    if (withdrawalInProgress.current) return;
    withdrawalInProgress.current = true;
    setWithdrawing(true);
    let originalBalance: number | null = null;
    let withdrawalRowId: string | null = null;
    let coinsWereDeducted = false;
    try {
      const { data: freshData, error: freshErr } = await supabase.from('users').select('coins').eq('id', user!.id).single();
      if (freshErr) throw new Error('Could not verify balance. Please try again.');
      const freshCoins = freshData?.coins || 0;
      if (freshCoins < amountNum) { Alert.alert('Error', 'Balance changed. Please try again.'); return; }
      originalBalance = freshCoins;

      const { data: userData, error: userErr } = await supabase
        .from('users')
        .select('bank_account_number, bank_account_name, bank_code, bank_name, withdrawal_country, withdrawal_currency, withdrawal_iban, display_name, username')
        .eq('id', user!.id)
        .single();
      if (userErr) throw new Error('Could not load bank details. Please try again.');
      if (!userData?.bank_account_number || !userData?.bank_code) {
        throw new Error('Bank account not connected. Please connect your bank first.');
      }

      const grossAmount    = amountNum * currency.ratePerCoin;
      const platformFee    = grossAmount * WITHDRAWAL_SPLIT.PLATFORM_FEE;
      const referralCutNGN = myReferrerId ? grossAmount * WITHDRAWAL_SPLIT.REFERRAL_COMMISSION : 0;
      const amountNGN      = grossAmount * userPayoutRate;

      const { error: deductErr } = await supabase.from('users').update({ coins: freshCoins - amountNum }).eq('id', user!.id);
      if (deductErr) throw new Error('Failed to deduct coins. Please try again.');
      coinsWereDeducted = true;
      setCoins(freshCoins - amountNum);

      const finalCurrency = userData.withdrawal_currency || currency.code;
      const isAutoPayable = PAYSTACK_AUTO_CURRENCIES.includes(finalCurrency);

      const { data: newRow, error: logErr } = await supabase.from('withdrawals').insert({
        user_id:       user!.id,
        amount_coins:  amountNum,
        amount_local:  grossAmount,
        currency_code: finalCurrency,
        platform_fee:  platformFee,
        referral_cut:  referralCutNGN,
        net_amount:    amountNGN,
        bank_account:  userData.bank_account_number,
        bank_code:     userData.bank_code,
        bank_name:     userData.bank_name || userData.bank_code || '',
        account_name:  userData.bank_account_name || '',
        status:        isAutoPayable ? 'processing' : 'pending',
        payout_method: isAutoPayable ? 'paystack_auto' : 'manual',
      }).select('id').single();
      if (logErr) throw new Error(`Failed to log withdrawal: ${logErr.message}. Coins will be refunded.`);
      withdrawalRowId = newRow?.id || null;

      await supabase.from('transactions').insert({
        user_id:     user!.id,
        type:        'withdrawal',
        amount:      amountNum,
        description: `Withdrawal: ${amountNum} coins → ${sym}${amountNGN.toLocaleString()} ${finalCurrency}`,
        status:      'pending',
      });

      if (myReferrerId && referralCommissionCoins > 0) {
        try {
          await supabase.rpc('increment_coins', { target_user_id: myReferrerId, coin_amount: referralCommissionCoins });
          await supabase.from('transactions').insert({ user_id: myReferrerId, type: 'referral_commission', amount: referralCommissionCoins, description: `💰 Referral commission: 5% from @${userProfile?.username || 'a user'}'s withdrawal`, status: 'completed' });
          await supabase.from('notifications').insert({ user_id: myReferrerId, type: 'referral_commission', title: '💰 Referral Commission Received!', message: `You earned ${referralCommissionCoins.toFixed(2)} coins (5% commission) from @${userProfile?.username || 'a user'}'s withdrawal`, is_read: false });
        } catch (commErr) {
          console.error('Referral commission credit failed:', commErr);
        }
      }

      if (isAutoPayable && withdrawalRowId) {
        try {
          const { data: paystackResult, error: fnErr } = await supabase.functions.invoke('paystack-transfer', {
            body: {
              withdrawalId:  withdrawalRowId,
              userId:        user!.id,
              amountNgn:     amountNGN,
              accountNumber: userData.bank_account_number,
              bankCode:      userData.bank_code,
              accountName:   userData.bank_account_name,
              currency:      finalCurrency,
              walletType:    'profile',
            },
          });
          if (fnErr || !paystackResult?.success) {
            await supabase.from('withdrawals').update({ status: 'pending', payout_method: 'manual', notes: paystackResult?.message || fnErr?.message }).eq('id', withdrawalRowId);
            setWithdrawModalVisible(false);
            setWithdrawAmount('');
            await Promise.all([loadUserCoins(), loadTransactions()]);
            Alert.alert('Withdrawal Submitted ✅', `Automatic payment could not be processed right now.\n\nYour request is queued for manual review. You will be paid within 1-3 business days. 🙏`);
          } else {
            await supabase.from('withdrawals').update({ status: 'completed', flw_reference: paystackResult.transferCode }).eq('id', withdrawalRowId);
            setWithdrawModalVisible(false);
            setWithdrawAmount('');
            await Promise.all([loadUserCoins(), loadTransactions()]);
            Alert.alert('💸 Payment Sent!', `${sym}${userReceives.toLocaleString()} has been sent to your ${userData.bank_name || 'bank'} account.\n\nIt may take a few minutes to appear.`);
          }
        } catch (paystackErr: any) {
          await supabase.from('withdrawals').update({ status: 'pending', payout_method: 'manual', notes: 'Paystack network error' }).eq('id', withdrawalRowId!);
          setWithdrawModalVisible(false);
          setWithdrawAmount('');
          await Promise.all([loadUserCoins(), loadTransactions()]);
          Alert.alert('Withdrawal Submitted ✅', `Payment encountered a network issue. Your request is queued and will be paid manually within 1-3 business days. 🙏`);
        }
      } else {
        setWithdrawModalVisible(false);
        setWithdrawAmount('');
        await Promise.all([loadUserCoins(), loadTransactions()]);
        Alert.alert('Withdrawal Requested! ✅', `Your request for ${sym}${amountNGN.toLocaleString()} has been submitted.\n\nWe will process your payment within 1-3 business days. 🙏`);
      }
    } catch (e: any) {
      if (coinsWereDeducted && originalBalance !== null) {
        try {
          const { data: currentData } = await supabase.from('users').select('coins').eq('id', user!.id).single();
          if ((currentData?.coins || 0) < originalBalance) {
            await supabase.from('users').update({ coins: originalBalance }).eq('id', user!.id);
            await supabase.from('transactions').update({ status: 'failed' }).eq('user_id', user!.id).eq('type', 'withdrawal').eq('status', 'pending');
            setCoins(originalBalance);
          }
        } catch (refundErr) {
          console.error('CRITICAL: Coin refund failed for user', user!.id, refundErr);
        }
        Alert.alert('Withdrawal Failed', `${e.message || 'Please try again.'}\n\nYour coins have been refunded. Contact lumvibesupport@gmail.com if this persists.`);
      } else {
        Alert.alert('Withdrawal Failed', e.message || 'Failed to process. Your coins are safe.');
      }
    } finally {
      setWithdrawing(false);
      withdrawalInProgress.current = false;
    }
  };

  const openBadgeDetail = (badge: any) => { setSelectedBadge(badge); setBadgeDetailVisible(true); };

  const isPositiveTx = (type: string) =>
    ['received', 'gift', 'gift_received', 'gift_receive', 'received_gift',
      'purchased', 'ad_revenue', 'referral_commission', 'referral_bonus',
      'coins_received', 'coin_purchase'].includes(type);

  const pointsForNextLevel = level * 1000;
  const levelProgress      = (points % 1000) / 10;

  const th = useMemo(() => ({
    container:    { flex: 1, backgroundColor: theme.background } as const,
    header:       { backgroundColor: theme.background } as const,
    modal:        { backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' as any, paddingBottom: 40 } as const,
    gamif:        { backgroundColor: theme.card, marginHorizontal: 20, marginBottom: 20, padding: 15, borderRadius: 12, borderWidth: 1, borderColor: theme.primary + '33' } as const,
    levelFill:    { height: '100%' as any, backgroundColor: theme.primary } as const,
    cameraBadge:  { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: theme.primary, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: theme.background } as const,
    btnPrimary:   { flex: 1, backgroundColor: theme.primary, paddingVertical: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' } as const,
    btnText:      { color: theme.primary === '#00ff88' || theme.primary === '#00b4d8' ? '#000' : '#fff', fontSize: 14, fontWeight: 'bold' } as const,
    accent:       { color: theme.primary } as const,
    walletAmt:    { color: theme.primary, fontSize: 32, fontWeight: 'bold', marginBottom: 5 } as const,
    icon:         theme.primary,
    walletBtn:    { flex: 1, backgroundColor: theme.card, padding: 20, borderRadius: 12, alignItems: 'center', gap: 8 } as const,
    settingsItem: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.primary + '22' } as const,
    topLeader:    { backgroundColor: theme.card } as const,
    unlockActive: { borderColor: theme.primary } as const,
  }), [theme, myReferrerId]);

  const handleThemeChange = async (themeKey: string) => {
    setActiveThemeId(themeKey);
    try {
      await supabase.from('users').update({ active_theme: themeKey }).eq('id', user!.id);
    } catch {}
  };

  if (!userProfile) return <ActivityIndicator style={{ flex: 1 }} color="#00ff88" />;

  const AvatarImg = userProfile.avatar_url
    ? <Image source={{ uri: userProfile.avatar_url }} style={s.avatar} />
    : <View style={[s.avatar, s.avatarPh]}><Feather name="user" size={32} color="#555" /></View>;

  const AvatarNode = hasGlowingAvatar
    ? <ReferralGlowBorder color={theme.primary} size={80}>{AvatarImg}</ReferralGlowBorder>
    : AvatarImg;

  const activeSocialLinks = SOCIAL_PLATFORMS.filter(p => socialLinks[p.id]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={th.container}>
      {isOffline && (
        <View style={{ backgroundColor: '#ff4444', paddingVertical: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="wifi-off" size={14} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 }}>No internet — some features unavailable</Text>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}
      >
        {/* ── Classic Layout ── */}
        {!useNewLayout && (
          <>
            <View style={[s.header, th.header]}>
              <Text style={s.headerTitle}>Profile</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(true)}>
                <Feather name="settings" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={th.gamif}>
              <View style={s.gamifRow}>
                <View style={s.gamifItem}>
                  <Text style={s.gamifIcon}>🔥</Text>
                  <Text style={s.gamifLabel}>{t.profile.streak}</Text>
                  <Text style={s.gamifValue}>{currentStreak} {t.profile.days}</Text>
                </View>
                <View style={s.gamifItem}>
                  <Text style={s.gamifIcon}>⭐</Text>
                  <Text style={s.gamifLabel}>{t.common.level} {level}</Text>
                  <Text style={s.gamifValue}>{points} {t.common.points}</Text>
                </View>
                <TouchableOpacity style={s.gamifItem} onPress={() => setBadgesModalVisible(true)}>
                  <Text style={s.gamifIcon}>🏆</Text>
                  <Text style={s.gamifLabel}>{t.common.badges}</Text>
                  <Text style={s.gamifValue}>{earnedBadgeIds.length}/{BADGES.length}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.gamifItem} onPress={async () => { await loadLeaderboard(); setLeaderboardModalVisible(true); }}>
                  <Text style={s.gamifIcon}>📊</Text>
                  <Text style={s.gamifLabel}>Rank</Text>
                  <Text style={s.gamifValue}>{t.profile.viewLeaderboard}</Text>
                </TouchableOpacity>
              </View>
              <View style={s.levelProgress}>
                <View style={s.levelBar}>
                  <View style={[th.levelFill, { width: `${levelProgress}%` as any }]} />
                </View>
                <Text style={s.levelProgressText}>{points % 1000}/{pointsForNextLevel} to Level {level + 1}</Text>
              </View>
            </View>

            <View style={s.profile}>
              <View style={s.topRow}>
                <View style={[s.avatarContainer, hasGlowingAvatar && { marginRight: 28 }]}>
                  <TouchableOpacity onPress={() => setProfilePictureModalVisible(true)} activeOpacity={0.8}>
                    {AvatarNode}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[th.cameraBadge, hasGlowingAvatar && { bottom: -2, right: -10 }]}
                    onPress={handleChangeAvatar}
                  >
                    {uploadingAvatar
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Feather name="camera" size={14} color="#fff" />}
                  </TouchableOpacity>
                </View>
                <View style={s.statsRow}>
                  <View style={s.stat}>
                    <Text style={s.statNum}>{stats.posts_count}</Text>
                    <Text style={s.statLbl}>{t.common.posts}</Text>
                  </View>
                  <TouchableOpacity style={s.stat} onPress={async () => { await loadFollowers(); setFollowersModalVisible(true); }}>
                    <Text style={s.statNum}>{stats.followers_count}</Text>
                    <Text style={s.statLbl}>{t.common.followers}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.stat} onPress={async () => { await loadFollowing(); setFollowingModalVisible(true); }}>
                    <Text style={s.statNum}>{stats.following_count}</Text>
                    <Text style={s.statLbl}>{t.common.following}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {isWeeklyWinner && winnerWeekLabel
                ? <WinnerProfileBadge weekLabel={winnerWeekLabel} points={winnerPoints} />
                : null}

              {(earnedBadgeIds.includes('founding_member') || earnedBadgeIds.includes('early_adopter')) && (
                <FounderBadgeStrip isFounder={earnedBadgeIds.includes('founding_member')} primaryColor={theme.primary} />
              )}

              <View style={s.info}>
                <View style={s.nameRow}>
                  <Text style={s.name}>{userProfile.display_name}</Text>
                  {userProfile.is_premium && <MaterialCommunityIcons name="crown" size={20} color="#ffd700" />}
                  {hasGlowingAvatar && (
                    <View style={[s.glowBadge, { backgroundColor: theme.primary + '22', borderColor: theme.primary + '66' }]}>
                      <Text style={[s.glowBadgeText, { color: theme.primary }]}>✨ Top Referrer</Text>
                    </View>
                  )}
                </View>
                <Text style={s.username}>@{userProfile.username}</Text>
                {(userProfile as any).bio ? <Text style={s.bio}>{(userProfile as any).bio}</Text> : null}
                <View style={s.likesRow}>
                  <Feather name="heart" size={14} color="#ff4d8f" />
                  <Text style={s.likesText}>{stats.likes_received} likes received</Text>
                </View>
                {activeSocialLinks.length > 0 && (
                  <View style={s.socialBadgesRow}>
                    {activeSocialLinks.map(platform => (
                      <TouchableOpacity
                        key={platform.id}
                        style={[s.socialBadge, { borderColor: platform.color + '66', backgroundColor: platform.color + '15' }]}
                        onPress={() => Linking.openURL(`${platform.prefix}${socialLinks[platform.id]}`)}
                      >
                        <Text style={[s.socialBadgeIcon, { color: platform.color, fontSize: 11, fontWeight: '900' }]}>{platform.initial}</Text>
                        <Text style={[s.socialBadgeText, { color: platform.color }]}>@{socialLinks[platform.id]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <TouchableOpacity
                  style={s.addSocialBtn}
                  onPress={() => { setEditingSocial({ ...socialLinks }); setSocialModalVisible(true); }}
                >
                  <Feather name="link" size={13} color="#666" />
                  <Text style={s.addSocialBtnText}>
                    {activeSocialLinks.length > 0 ? 'Edit social links' : 'Add social media links'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={s.actions}>
                <TouchableOpacity style={th.btnPrimary} onPress={handleEditProfile}>
                  <Text style={th.btnText}>{t.profile.editProfile}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.btnSecondary}
                  onPress={async () => { await Promise.all([loadUserCoins(), loadTransactions()]); setWalletVisible(true); }}
                >
                  <Feather name="dollar-sign" size={18} color={th.icon} />
                  <Text style={s.btnSecondaryText}>{coins.toFixed(2)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.btnSecondary} onPress={() => setInviteModalVisible(true)}>
                  <Feather name="user-plus" size={18} color={th.icon} />
                </TouchableOpacity>
                <TouchableOpacity style={s.btnSecondary} onPress={async () => { await loadSavedPosts(); setSavedPostsModalVisible(true); }}>
                  <Feather name="bookmark" size={18} color={th.icon} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.postsSection}>
              <Text style={s.sectionTitle}>{t.profile.myPosts}</Text>
              {loadingPosts
                ? <ActivityIndicator size="small" color={theme.primary} style={{ marginTop: 20 }} />
                : userPosts.length === 0
                  ? <View style={s.emptyState}><Feather name="image" size={48} color="#666" /><Text style={s.emptyText}>{t.profile.noPosts}</Text></View>
                  : <View style={s.postsGrid}>
                    {userPosts.map(post => (
                      <LazyPostThumb key={post.id} post={post} onPress={() => navigation.navigate('Post', { postId: post.id })} />
                    ))}
                  </View>}
            </View>
          </>
        )}

        {/* ── New Layout ── */}
        {useNewLayout && (
          <>
            <View style={[s.newHeader, { backgroundColor: theme.background }]}>
              <TouchableOpacity onPress={() => setSettingsVisible(true)}>
                <Feather name="settings" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={[s.newHeaderTitle, { color: theme.primary }]}>Profile</Text>
              <TouchableOpacity onPress={async () => { await Promise.all([loadUserCoins(), loadTransactions()]); setWalletVisible(true); }}>
                <Feather name="dollar-sign" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={s.newProfileRow}>
              <View style={[s.avatarContainer, hasGlowingAvatar && { marginRight: 28 }]}>
                <TouchableOpacity onPress={() => setProfilePictureModalVisible(true)} activeOpacity={0.8}>
                  {AvatarNode}
                </TouchableOpacity>
                <TouchableOpacity style={[th.cameraBadge, hasGlowingAvatar && { bottom: -2, right: -10 }]} onPress={handleChangeAvatar}>
                  {uploadingAvatar ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="camera" size={14} color="#fff" />}
                </TouchableOpacity>
              </View>
              <View style={s.newStatsRow}>
                <View style={s.stat}>
                  <Text style={[s.statNum, { color: theme.primary }]}>{stats.followers_count}</Text>
                  <Text style={s.statLbl}>{t.common.followers}</Text>
                </View>
                <View style={s.stat}>
                  <Text style={[s.statNum, { color: theme.primary }]}>{stats.following_count}</Text>
                  <Text style={s.statLbl}>{t.common.following}</Text>
                </View>
                <View style={s.stat}>
                  <Text style={[s.statNum, { color: theme.primary }]}>{stats.posts_count}</Text>
                  <Text style={s.statLbl}>{t.common.posts}</Text>
                </View>
              </View>
            </View>

            {isWeeklyWinner && winnerWeekLabel ? <WinnerProfileBadge weekLabel={winnerWeekLabel} points={winnerPoints} /> : null}

            <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
              <View style={s.nameRow}>
                <Text style={s.name}>{userProfile.display_name}</Text>
                {userProfile.is_premium && <MaterialCommunityIcons name="crown" size={20} color="#ffd700" />}
                {hasGlowingAvatar && (
                  <View style={[s.glowBadge, { backgroundColor: theme.primary + '22', borderColor: theme.primary + '66' }]}>
                    <Text style={[s.glowBadgeText, { color: theme.primary }]}>✨ Top Referrer</Text>
                  </View>
                )}
              </View>
              <Text style={s.username}>@{userProfile.username}</Text>
              {(userProfile as any).bio ? <Text style={s.bio}>{(userProfile as any).bio}</Text> : null}
              {activeSocialLinks.length > 0 && (
                <View style={s.socialBadgesRow}>
                  {activeSocialLinks.map(platform => (
                    <TouchableOpacity
                      key={platform.id}
                      style={[s.socialBadge, { borderColor: platform.color + '66', backgroundColor: platform.color + '15' }]}
                      onPress={() => Linking.openURL(`${platform.prefix}${socialLinks[platform.id]}`)}
                    >
                      <Text style={[s.socialBadgeIcon, { color: platform.color, fontSize: 11, fontWeight: '900' }]}>{platform.initial}</Text>
                      <Text style={[s.socialBadgeText, { color: platform.color }]}>@{socialLinks[platform.id]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={[s.actions, { paddingHorizontal: 20, marginBottom: 16 }]}>
              <TouchableOpacity style={[s.newActionBtn, { borderColor: theme.primary }]} onPress={handleEditProfile}>
                <Feather name="edit-2" size={15} color={theme.primary} />
                <Text style={[s.newActionBtnText, { color: theme.primary }]}>{t.profile.editProfile}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.newActionBtn, { borderColor: theme.primary }]} onPress={() => setInviteModalVisible(true)}>
                <Feather name="user-plus" size={15} color={theme.primary} />
                <Text style={[s.newActionBtnText, { color: theme.primary }]}>Invite Friends</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.newActionBtn, { borderColor: theme.primary }]} onPress={() => setWalletVisible(true)}>
                <Feather name="dollar-sign" size={15} color={theme.primary} />
                <Text style={[s.newActionBtnText, { color: theme.primary }]}>Wallet</Text>
              </TouchableOpacity>
            </View>

            <View style={[s.newLevelCard, { backgroundColor: theme.card, borderColor: theme.primary + '33' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <View>
                  <Text style={[s.newLevelTitle, { color: theme.primary }]}>Level {level}</Text>
                  <Text style={s.newLevelSub}>{points.toLocaleString()} pts · {(pointsForNextLevel - (points % 1000)).toLocaleString()} to next level</Text>
                </View>
                <TouchableOpacity
                  onPress={async () => { await loadLeaderboard(); setLeaderboardModalVisible(true); }}
                  style={[s.newLeaderBtn, { backgroundColor: theme.primary + '22', borderColor: theme.primary + '44' }]}
                >
                  <Text style={{ fontSize: 12, fontWeight: '600', color: theme.primary }}>🏆 Leaderboard</Text>
                </TouchableOpacity>
              </View>
              <View style={s.levelBar}>
                <View style={[th.levelFill, { width: `${levelProgress}%` as any }]} />
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: '#666', fontSize: 11 }}>🔥 {currentStreak} day streak</Text>
                <Text style={{ color: '#666', fontSize: 11 }}>❤️ {stats.likes_received} likes</Text>
                <Text style={{ color: '#666', fontSize: 11 }}>📹 {stats.posts_count} posts</Text>
              </View>
            </View>

            <View style={[s.newSection, { backgroundColor: theme.card }]}>
              <View style={s.newSectionHeader}>
                <Text style={s.newSectionTitle}>🏅 {t.common.badges}</Text>
                <TouchableOpacity onPress={() => setBadgesModalVisible(true)}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: theme.primary }}>See All</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingLeft: 4, gap: 10 }}>
                {BADGES.map(badge => {
                  const earned = earnedBadgeIds.includes(badge.id);
                  return (
                    <TouchableOpacity
                      key={badge.id}
                      style={[s.newBadgeChip, earned && { borderColor: theme.primary + '88', backgroundColor: theme.primary + '11' }]}
                      onPress={() => openBadgeDetail(badge)}
                    >
                      <Text style={[{ fontSize: 24, marginBottom: 4 }, !earned && { opacity: 0.3 }]}>{badge.icon}</Text>
                      <Text style={[{ color: '#888', fontSize: 10, fontWeight: '600', textAlign: 'center' }, earned && { color: theme.primary }]}>{badge.name}</Text>
                      {earned && <Text style={{ color: theme.primary, fontSize: 10, marginTop: 2 }}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={[s.newSection, { backgroundColor: theme.card }]}>
              <View style={s.newSectionHeader}>
                <Text style={s.newSectionTitle}>🔓 Unlock Features</Text>
                <Text style={{ color: '#666', fontSize: 12 }}>{inviteCount} invites</Text>
              </View>
              {UNLOCKABLE_FEATURES.map(feat => {
                const unlocked = unlockedFeatures.includes(feat.id);
                const progress = Math.min(inviteCount / feat.requiredInvites, 1);
                return (
                  <View key={feat.id} style={[s.newFeatureRow, unlocked && { backgroundColor: theme.primary + '11', borderColor: theme.primary + '44' }]}>
                    <Text style={{ fontSize: 20, width: 28 }}>{feat.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={[{ color: '#fff', fontSize: 13, fontWeight: '600' }, unlocked && { color: theme.primary }]}>{feat.name}</Text>
                        {unlocked
                          ? <Text style={{ fontSize: 12, fontWeight: '700', color: theme.primary }}>Unlocked ✓</Text>
                          : <Text style={{ color: '#666', fontSize: 12 }}>{inviteCount}/{feat.requiredInvites}</Text>}
                      </View>
                      {!unlocked && (
                        <View style={{ height: 3, backgroundColor: '#1a1a1a', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                          <View style={{ height: '100%', borderRadius: 2, width: `${progress * 100}%` as any, backgroundColor: theme.primary }} />
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            <View style={[s.newSection, { backgroundColor: theme.card, paddingHorizontal: 0 }]}>
              <View style={[s.newSectionHeader, { paddingHorizontal: 16 }]}>
                <Text style={s.newSectionTitle}>📹 {t.profile.myPosts}</Text>
                <Text style={{ color: '#666', fontSize: 12 }}>{stats.posts_count} posts</Text>
              </View>
              {loadingPosts
                ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 20 }} />
                : userPosts.length === 0
                  ? <View style={s.emptyState}><Feather name="image" size={48} color="#666" /><Text style={s.emptyText}>{t.profile.noPosts}</Text></View>
                  : <View style={s.postsGrid}>
                    {userPosts.map(post => (
                      <LazyPostThumb key={post.id} post={post} onPress={() => navigation.navigate('Post', { postId: post.id })} />
                    ))}
                  </View>}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Modals ── */}

      {/* Wallet */}
      <Modal visible={walletVisible} animationType="slide" transparent onRequestClose={() => setWalletVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>💰 {t.wallet.title}</Text>
              <TouchableOpacity onPress={() => setWalletVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <View style={s.walletBalance}>
              <Text style={s.walletLabel}>{t.wallet.balance}</Text>
              <Text style={th.walletAmt}>{coins.toLocaleString()}</Text>
              <Text style={{ color: '#666', fontSize: 12 }}>{t.common.coins}</Text>
              <Text style={s.walletUSD}>{currency.symbol}{balLocal.toLocaleString()} {currency.code}</Text>
              <Text style={s.walletRate}>1 coin = {currency.symbol}{currency.ratePerCoin} {currency.code}</Text>
            </View>
            <View style={s.walletActions}>
              <TouchableOpacity style={th.walletBtn} onPress={handleBuyCoins}>
                <Feather name="plus-circle" size={28} color={theme.primary} />
                <Text style={[s.walletBtnText, { color: theme.primary }]}>{t.wallet.buyCoins}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={th.walletBtn} onPress={() => { setWalletVisible(false); setTimeout(() => setWithdrawModalVisible(true), 300); }}>
                <Feather name="arrow-up-circle" size={28} color={theme.primary} />
                <Text style={[s.walletBtnText, { color: theme.primary }]}>{t.wallet.withdrawFunds}</Text>
              </TouchableOpacity>
            </View>
            {!paystackConnected && (
              <View style={s.paystackNotice}>
                <Feather name="alert-circle" size={16} color="#ffa500" />
                <Text style={s.paystackNoticeText}>Connect your bank account to enable withdrawals</Text>
              </View>
            )}
            <View style={s.txSection}>
              <Text style={[s.sectionTitle, { paddingHorizontal: 0, marginBottom: 10 }]}>{t.wallet.recentTransactions}</Text>
              {transactions.length === 0
                ? <Text style={{ color: '#555', fontSize: 13 }}>{t.wallet.noTransactions}</Text>
                : transactions.map((tx: any) => (
                  <View key={tx.id} style={s.txItem}>
                    <Feather name={isPositiveTx(tx.type) ? 'arrow-down-left' : 'arrow-up-right'} size={18} color={isPositiveTx(tx.type) ? '#00ff88' : '#ff6b6b'} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.txDesc}>{tx.description || tx.type}</Text>
                      <Text style={s.txDate}>{new Date(tx.created_at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={[s.txAmt, { color: isPositiveTx(tx.type) ? '#00ff88' : '#ff6b6b' }]}>
                      {isPositiveTx(tx.type) ? '+' : '-'}{Math.abs(tx.amount)}
                    </Text>
                  </View>
                ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* Withdraw */}
      <Modal visible={withdrawModalVisible} animationType="slide" transparent onRequestClose={() => setWithdrawModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>💸 {t.wallet.withdrawFunds}</Text>
              <TouchableOpacity onPress={() => setWithdrawModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={s.withdrawInfo}>
                <Text style={s.withdrawLabel}>{t.wallet.balance}</Text>
                <Text style={[s.withdrawBal, { color: theme.primary }]}>{coins.toLocaleString()} {t.common.coins}</Text>
                <Text style={s.withdrawUSD}>{currency.symbol}{balLocal.toLocaleString()} {currency.code}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: isPaystackAuto ? '#0a1a0a' : '#1a1000', borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: isPaystackAuto ? '#00ff8833' : '#ffa50033' }}>
                <Text style={{ fontSize: 16 }}>{isPaystackAuto ? '⚡' : '📋'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: isPaystackAuto ? '#00ff88' : '#ffa500', fontSize: 12, fontWeight: '700' }}>
                    {isPaystackAuto ? 'Automatic Payout' : 'Manual Processing'}
                  </Text>
                  <Text style={{ color: '#555', fontSize: 11, marginTop: 1 }}>
                    {isPaystackAuto ? 'Sent instantly to your bank after approval.' : 'Reviewed and paid within 1-3 business days.'}
                  </Text>
                </View>
              </View>
              {!paystackConnected && (
                <View style={s.reqNotice}>
                  <Feather name="alert-circle" size={16} color="#ffa500" />
                  <Text style={s.reqText}>Connect your bank account before withdrawing</Text>
                </View>
              )}
              <View style={s.inputGroup}>
                <Text style={s.inputLabel}>{t.wallet.withdrawAmount}</Text>
                <TextInput
                  style={s.input}
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  placeholder={`Min ${MIN_WITHDRAW_COINS} coins`}
                  placeholderTextColor="#666"
                  keyboardType="numeric"
                />
              </View>
              {withdrawNum >= MIN_WITHDRAW_COINS && (
                <View style={s.withdrawPreview}>
                  <Text style={s.withdrawPreviewLabel}>{t.wallet.breakdown}</Text>
                  <View style={s.withdrawRow}><Text style={s.withdrawRowLabel}>Gross</Text><Text style={s.withdrawRowValue}>{currency.symbol}{previewTotal.toLocaleString()}</Text></View>
                  <View style={s.withdrawRow}><Text style={s.withdrawRowLabel}>Platform fee (20%)</Text><Text style={[s.withdrawRowValue, { color: '#ff6b6b' }]}>-{currency.symbol}{previewFee.toLocaleString()}</Text></View>
                  {myReferrerId && <View style={s.withdrawRow}><Text style={s.withdrawRowLabel}>Referral (5%)</Text><Text style={[s.withdrawRowValue, { color: '#ff6b6b' }]}>-{currency.symbol}{previewRef.toLocaleString()}</Text></View>}
                  <View style={s.withdrawRow}><Text style={s.withdrawRowLabel}>You receive ({myReferrerId ? '75' : '80'}%)</Text><Text style={[s.withdrawRowValue, { color: theme.primary }]}>{currency.symbol}{previewRcv.toLocaleString()}</Text></View>
                  <Text style={s.withdrawPreviewNote}>Processing: {isPaystackAuto ? '⚡ Automatic' : '1-3 business days'}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[s.btnPrimary, (withdrawing || !paystackConnected || withdrawNum < MIN_WITHDRAW_COINS) && s.btnDisabled, { marginTop: 16 }]}
                onPress={handleWithdraw}
                disabled={withdrawing || !paystackConnected || withdrawNum < MIN_WITHDRAW_COINS}
              >
                {withdrawing ? <ActivityIndicator color="#000" /> : <Text style={s.btnPrimaryText}>{t.wallet.withdrawFunds}</Text>}
              </TouchableOpacity>
              {!paystackConnected && (
                <TouchableOpacity
                  style={[s.btnPrimary, { marginTop: 10, backgroundColor: '#111', borderWidth: 1, borderColor: theme.primary }]}
                  onPress={() => { setWithdrawModalVisible(false); setTimeout(() => handleConnectPaystack(), 300); }}
                >
                  <Text style={[s.btnPrimaryText, { color: theme.primary }]}>Connect Bank Account</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bank Connect */}
      <Modal visible={paystackConnectModalVisible} animationType="slide" transparent onRequestClose={() => setPaystackConnectModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🏦 Connect Bank</Text>
              <TouchableOpacity onPress={() => setPaystackConnectModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <Text style={s.paystackTitle}>Connect your bank account</Text>
              <Text style={s.paystackSubtitle}>Your bank details are encrypted and stored securely.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <TouchableOpacity
                  style={[s.btnPrimary, { flex: 1, paddingVertical: 8, backgroundColor: bankRegion === 'nigeria' ? theme.primary : '#1a1a1a', borderWidth: 1, borderColor: bankRegion === 'nigeria' ? theme.primary : '#333' }]}
                  onPress={() => setBankRegion('nigeria')}
                >
                  <Text style={[s.btnPrimaryText, { color: bankRegion === 'nigeria' ? '#000' : '#666' }]}>🇳🇬 Nigeria</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btnPrimary, { flex: 1, paddingVertical: 8, backgroundColor: bankRegion === 'global' ? theme.primary : '#1a1a1a', borderWidth: 1, borderColor: bankRegion === 'global' ? theme.primary : '#333' }]}
                  onPress={() => setBankRegion('global')}
                >
                  <Text style={[s.btnPrimaryText, { color: bankRegion === 'global' ? '#000' : '#666' }]}>🌍 International</Text>
                </TouchableOpacity>
              </View>

              {bankRegion === 'nigeria' && (
                <>
                  <Text style={s.inputLabel}>Select Bank</Text>
                  <TextInput style={[s.input, { marginBottom: 6 }]} placeholder="Search banks..." placeholderTextColor="#666" value={bankSearch} onChangeText={setBankSearch} />
                  {banksLoading
                    ? <ActivityIndicator color={theme.primary} style={{ marginVertical: 10 }} />
                    : (
                      <ScrollView style={s.bankList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                        {filteredBanks.map(b => (
                          <TouchableOpacity key={b.code} style={[s.bankItem, selectedBank?.code === b.code && s.bankItemActive]} onPress={() => setSelectedBank(b)}>
                            <Text style={[s.bankName, selectedBank?.code === b.code && { color: theme.primary }]}>{b.name}</Text>
                            {selectedBank?.code === b.code && <Feather name="check" size={14} color={theme.primary} />}
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    )}
                  <View style={s.inputGroup}>
                    <Text style={s.inputLabel}>Account Number</Text>
                    <TextInput style={s.input} placeholder="10-digit account number" placeholderTextColor="#666" keyboardType="numeric" maxLength={10} value={accountNumber} onChangeText={setAccountNumber} />
                  </View>
                  {accountName ? (
                    <View style={s.verifiedBox}>
                      <Feather name="check-circle" size={20} color="#00ff88" style={{ marginRight: 10 }} />
                      <View><Text style={s.verifiedLabel}>Verified Account</Text><Text style={s.verifiedName}>{accountName}</Text></View>
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={[s.btnPrimary, (verifyingAccount || !accountNumber || !selectedBank) && s.btnDisabled, { marginBottom: 10 }]}
                    onPress={handleVerifyAccount}
                    disabled={verifyingAccount || !accountNumber || !selectedBank}
                  >
                    {verifyingAccount ? <ActivityIndicator color="#000" /> : <Text style={s.btnPrimaryText}>Verify Account</Text>}
                  </TouchableOpacity>
                  {accountName && (
                    <TouchableOpacity style={[s.btnPrimary, connectingPaystack && s.btnDisabled]} onPress={handleConfirmPaystackConnection} disabled={connectingPaystack}>
                      {connectingPaystack ? <ActivityIndicator color="#000" /> : <Text style={s.btnPrimaryText}>Save & Connect Bank</Text>}
                    </TouchableOpacity>
                  )}
                </>
              )}

              {bankRegion === 'global' && (
                <>
                  <Text style={s.inputLabel}>Select Country</Text>
                  <TouchableOpacity style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setShowCountryList(!showCountryList)}>
                    <Text style={{ color: selectedCountry ? '#fff' : '#666' }}>{selectedCountry ? `${selectedCountry.flag} ${selectedCountry.name}` : 'Select your country'}</Text>
                    <Feather name={showCountryList ? 'chevron-up' : 'chevron-down'} size={18} color="#666" />
                  </TouchableOpacity>
                  {showCountryList && (
                    <ScrollView style={s.bankList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {SUPPORTED_COUNTRIES.filter(c => c.code !== 'NG').map(country => (
                        <TouchableOpacity key={country.code} style={[s.bankItem, selectedCountry?.code === country.code && s.bankItemActive]} onPress={() => handleSelectGlobalCountry(country)}>
                          <Text style={[s.bankName, selectedCountry?.code === country.code && { color: theme.primary }]}>{country.flag} {country.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                  {selectedCountry && (
                    <>
                      {loadingGlobalBanks && <ActivityIndicator color={theme.primary} style={{ marginVertical: 10 }} />}
                      {globalBanks.length > 0 && (
                        <>
                          <Text style={[s.inputLabel, { marginTop: 12 }]}>Select Bank</Text>
                          <TouchableOpacity style={[s.input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]} onPress={() => setShowGlobalBankList(!showGlobalBankList)}>
                            <Text style={{ color: selectedGlobalBank ? '#fff' : '#666' }}>{selectedGlobalBank?.name || 'Select your bank'}</Text>
                            <Feather name={showGlobalBankList ? 'chevron-up' : 'chevron-down'} size={18} color="#666" />
                          </TouchableOpacity>
                          {showGlobalBankList && (
                            <ScrollView style={s.bankList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                              {globalBanks.map(b => (
                                <TouchableOpacity key={b.code} style={[s.bankItem, selectedGlobalBank?.code === b.code && s.bankItemActive]} onPress={() => { setSelectedGlobalBank(b); setShowGlobalBankList(false); }}>
                                  <Text style={[s.bankName, selectedGlobalBank?.code === b.code && { color: theme.primary }]}>{b.name}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          )}
                        </>
                      )}
                      <Text style={[s.inputLabel, { marginTop: 12 }]}>Account Number {['GB', 'DE', 'FR'].includes(selectedCountry.code) ? '/ IBAN' : ''}</Text>
                      <TextInput style={s.input} placeholder="Enter account number" placeholderTextColor="#666" value={globalAccountNo} onChangeText={setGlobalAccountNo} autoCapitalize="none" />
                      {['US', 'CA'].includes(selectedCountry.code) && (
                        <>
                          <Text style={s.inputLabel}>Routing Number</Text>
                          <TextInput style={s.input} placeholder="9-digit routing number" placeholderTextColor="#666" keyboardType="numeric" value={routingNumber} onChangeText={setRoutingNumber} />
                        </>
                      )}
                      {['GB', 'DE', 'FR'].includes(selectedCountry.code) && (
                        <>
                          <Text style={s.inputLabel}>IBAN (optional)</Text>
                          <TextInput style={s.input} placeholder="e.g. GB29NWBK60161331926819" placeholderTextColor="#666" value={iban} onChangeText={setIban} autoCapitalize="characters" />
                        </>
                      )}
                      <Text style={s.inputLabel}>Account Holder Name</Text>
                      <TextInput style={s.input} placeholder="Full name on account" placeholderTextColor="#666" value={globalAccountName} onChangeText={setGlobalAccountName} />
                      <TouchableOpacity
                        style={[s.btnPrimary, { marginTop: 8 }, (connectingPaystack || !globalAccountNo || !globalAccountName) && s.btnDisabled]}
                        onPress={handleConnectGlobalBank}
                        disabled={connectingPaystack || !globalAccountNo || !globalAccountName}
                      >
                        {connectingPaystack ? <ActivityIndicator color="#000" /> : <Text style={s.btnPrimaryText}>Save & Connect Bank</Text>}
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Social Links */}
      <Modal visible={socialModalVisible} animationType="slide" transparent onRequestClose={() => setSocialModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🔗 Social Media Links</Text>
              <TouchableOpacity onPress={() => setSocialModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <Text style={s.socialModalSubtitle}>Link your accounts so followers can find you on other platforms.</Text>
              {SOCIAL_PLATFORMS.map(platform => (
                <View key={platform.id} style={s.inputGroup}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Text style={{ fontSize: 14, fontWeight: '900', color: platform.color }}>{platform.initial}</Text>
                    <Text style={[s.inputLabel, { color: platform.color, marginBottom: 0 }]}>{platform.label}</Text>
                  </View>
                  <View style={s.socialInputRow}>
                    <Text style={s.socialInputPrefix}>@</Text>
                    <TextInput
                      style={[s.input, { flex: 1, borderColor: editingSocial[platform.id] ? platform.color + '88' : '#333' }]}
                      placeholder={`Your ${platform.label} username`}
                      placeholderTextColor="#555"
                      value={editingSocial[platform.id]}
                      onChangeText={val => setEditingSocial(prev => ({ ...prev, [platform.id]: val.replace(/^@/, '') }))}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                  {editingSocial[platform.id] ? <Text style={[s.inputHint, { color: platform.color }]}>Will link to: {platform.prefix}{editingSocial[platform.id]}</Text> : null}
                </View>
              ))}
              <TouchableOpacity style={[s.btnPrimary, savingSocial && s.btnDisabled, { marginTop: 10, marginBottom: 20 }]} onPress={handleSaveSocialLinks} disabled={savingSocial}>
                {savingSocial ? <ActivityIndicator color="#000" /> : <Text style={s.btnPrimaryText}>Save Links</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Saved Posts */}
      <Modal visible={savedPostsModalVisible} animationType="slide" transparent onRequestClose={() => setSavedPostsModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🔖 {t.settings.savedPosts}</Text>
              <TouchableOpacity onPress={() => setSavedPostsModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            {loadingSavedPosts
              ? <ActivityIndicator size="large" color="#00ff88" style={{ marginTop: 20 }} />
              : savedPosts.length === 0
                ? <View style={s.emptyState}><Feather name="bookmark" size={48} color="#666" /><Text style={s.emptyText}>No saved posts yet</Text></View>
                : <ScrollView style={{ padding: 10 }}>
                  <View style={s.postsGrid}>
                    {savedPosts.map(post => (
                      <TouchableOpacity key={post.id} style={s.postThumb} onPress={() => navigateToPost(post.id)}>
                        {post.media_type === 'video' && <View style={s.postThumbOverlay}><Feather name="play" size={24} color="#fff" /></View>}
                        <Image source={{ uri: post.media_url }} style={s.postThumbImg} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>}
          </View>
        </View>
      </Modal>

      {/* About */}
      <Modal visible={aboutModalVisible} animationType="slide" transparent onRequestClose={() => setAboutModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>ℹ️ {t.about.title}</Text>
              <TouchableOpacity onPress={() => setAboutModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={s.aboutSection}>
                <Text style={s.aboutAppName}>LumVibe</Text>
                <Text style={s.aboutVersion}>Version 1.0.0</Text>
                <Text style={s.aboutTagline}>The Future of Social Media</Text>
              </View>
              <View style={s.aboutDivider} />
              <TouchableOpacity style={s.aboutItem} onPress={() => Linking.openURL('https://play.google.com/store/apps/details?id=com.lumvibe.app')}>
                <Feather name="star" size={20} color="#00ff88" /><Text style={s.aboutItemText}>Rate Us</Text><Feather name="chevron-right" size={20} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity style={s.aboutItem} onPress={() => Share.share({ message: 'Check out LumVibe! 🚀 https://lumvibe.site' })}>
                <Feather name="share-2" size={20} color="#00ff88" /><Text style={s.aboutItemText}>Share App</Text><Feather name="chevron-right" size={20} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity style={s.aboutItem} onPress={() => Linking.openURL('https://lumvibe.site/terms')}>
                <Feather name="file-text" size={20} color="#00ff88" /><Text style={s.aboutItemText}>Terms of Service</Text><Feather name="chevron-right" size={16} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity style={s.aboutItem} onPress={() => Linking.openURL('https://lumvibe.site/privacy')}>
                <Feather name="shield" size={20} color="#00ff88" /><Text style={s.aboutItemText}>Privacy Policy</Text><Feather name="chevron-right" size={16} color="#666" />
              </TouchableOpacity>
              <TouchableOpacity style={s.aboutItem} onPress={() => Linking.openURL('mailto:lumvibesupport@gmail.com')}>
                <Feather name="mail" size={20} color="#00ff88" /><Text style={s.aboutItemText}>Contact Support</Text><Feather name="external-link" size={16} color="#666" />
              </TouchableOpacity>
              <View style={s.aboutDivider} />
              <View style={s.aboutFooter}>
                <Text style={s.aboutFooterText}>Made with ❤️ in Nigeria</Text>
                <Text style={s.aboutCopyright}>© 2026 LumVibe. All rights reserved.</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Followers */}
      <Modal visible={followersModalVisible} animationType="slide" transparent onRequestClose={() => setFollowersModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{t.common.followers}</Text>
              <TouchableOpacity onPress={() => setFollowersModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            {loadingFollowers
              ? <ActivityIndicator size="large" color="#00ff88" style={{ marginTop: 20 }} />
              : followers.length === 0
                ? <View style={s.emptyState}><Feather name="users" size={48} color="#666" /><Text style={s.emptyText}>No followers yet</Text></View>
                : <FlatList
                  data={followers}
                  keyExtractor={i => i.id}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={s.userItem} onPress={() => { setFollowersModalVisible(false); navigateToUserProfile(item.id); }}>
                      {item.avatar_url
                        ? <Image source={{ uri: item.avatar_url }} style={s.userAvatar} />
                        : <View style={[s.userAvatar, s.avatarPh]}><Feather name="user" size={20} color="#00ff88" /></View>}
                      <View style={{ flex: 1 }}>
                        <View style={s.nameRow}>
                          <Text style={s.userName}>{item.display_name}</Text>
                          {item.is_premium && <MaterialCommunityIcons name="crown" size={14} color="#ffd700" />}
                        </View>
                        <Text style={s.userUsername}>@{item.username}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />}
          </View>
        </View>
      </Modal>

      {/* Following */}
      <Modal visible={followingModalVisible} animationType="slide" transparent onRequestClose={() => setFollowingModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{t.common.following}</Text>
              <TouchableOpacity onPress={() => setFollowingModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            {loadingFollowing
              ? <ActivityIndicator size="large" color="#00ff88" style={{ marginTop: 20 }} />
              : following.length === 0
                ? <View style={s.emptyState}><Feather name="users" size={48} color="#666" /><Text style={s.emptyText}>Not following anyone yet</Text></View>
                : <FlatList
                  data={following}
                  keyExtractor={i => i.id}
                  renderItem={({ item }) => (
                    <View style={s.userItem}>
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { setFollowingModalVisible(false); navigateToUserProfile(item.id); }}>
                        {item.avatar_url
                          ? <Image source={{ uri: item.avatar_url }} style={s.userAvatar} />
                          : <View style={[s.userAvatar, s.avatarPh]}><Feather name="user" size={20} color="#00ff88" /></View>}
                        <View style={{ flex: 1 }}>
                          <View style={s.nameRow}>
                            <Text style={s.userName}>{item.display_name}</Text>
                            {item.is_premium && <MaterialCommunityIcons name="crown" size={14} color="#ffd700" />}
                          </View>
                          <Text style={s.userUsername}>@{item.username}</Text>
                        </View>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.followBtn, s.followingBtn]} onPress={() => handleFollowUser(item.id, true)}>
                        <Text style={s.followingBtnText}>{t.common.following}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                />}
          </View>
        </View>
      </Modal>

      {/* Leaderboard */}
      <Modal visible={leaderboardModalVisible} animationType="slide" transparent onRequestClose={() => setLeaderboardModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🏆 Leaderboard</Text>
              <TouchableOpacity onPress={() => setLeaderboardModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <LeaderboardCountdown />
            {loadingLeaderboard
              ? <ActivityIndicator size="large" color="#00ff88" style={{ marginTop: 20 }} />
              : <FlatList
                data={leaderboardData}
                keyExtractor={i => i.id}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={[s.leaderItem, index < 3 && th.topLeader]}
                    onPress={() => { setLeaderboardModalVisible(false); if (item.id !== user?.id) navigateToUserProfile(item.id); }}
                  >
                    <Text style={s.leaderRank}>{index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`}</Text>
                    {item.avatar_url
                      ? <Image source={{ uri: item.avatar_url }} style={s.leaderAvatar} />
                      : <View style={[s.leaderAvatar, s.avatarPh]}><Feather name="user" size={16} color="#00ff88" /></View>}
                    <View style={{ flex: 1 }}>
                      <View style={s.nameRow}>
                        <Text style={s.leaderName}>{item.display_name}</Text>
                        {item.is_premium && <MaterialCommunityIcons name="crown" size={12} color="#ffd700" />}
                        {index === 0 && <Text style={{ fontSize: 12 }}> 👑</Text>}
                      </View>
                      <Text style={s.leaderUsername}>@{item.username}</Text>
                    </View>
                    <View style={s.leaderStats}>
                      <Text style={s.leaderLevel}>Lvl {item.level}</Text>
                      <Text style={s.leaderPts}>{item.points} pts</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />}
          </View>
        </View>
      </Modal>

      {/* Badges */}
      <Modal visible={badgesModalVisible} animationType="slide" transparent onRequestClose={() => setBadgesModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🏆 Badges <Text style={{ color: '#666', fontSize: 14 }}>{earnedBadgeIds.length}/{BADGES.length} earned</Text></Text>
              <TouchableOpacity onPress={() => setBadgesModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView>
              {BADGES.map(b => {
                const earned     = earnedBadgeIds.includes(b.id);
                const prog       = b.getProgress(badgeStats, totalUserCount);
                const pct        = Math.min((prog.current / prog.total) * 100, 100);
                const badgeColor = b.id === 'founding_member' ? '#ffd700' : theme.primary;
                return (
                  <TouchableOpacity key={b.id} style={[s.badgeItem, !earned && s.badgeItemLocked]} onPress={() => openBadgeDetail(b)} activeOpacity={0.7}>
                    <Text style={s.badgeIcon}>{b.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <Text style={[s.badgeName, earned && { color: '#fff' }]}>{b.name}</Text>
                        {b.id === 'founding_member' && prog.achieved && !earned && (
                          <View style={[s.earnedTag, { backgroundColor: '#1a1000', borderColor: '#ffd700', borderWidth: 1 }]}>
                            <Text style={[s.earnedTagText, { color: '#ffd700' }]}>👑 QUALIFIED</Text>
                          </View>
                        )}
                        {earned && (
                          <View style={[s.earnedTag, b.id === 'founding_member' && { backgroundColor: '#1a1000' }]}>
                            <Text style={[s.earnedTagText, b.id === 'founding_member' && { color: '#ffd700' }]}>
                              {b.id === 'founding_member' ? '👑 EARNED' : '✅ EARNED'}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.badgeDesc}>{b.description}</Text>
                      <View style={[s.rewardPill, b.id === 'founding_member' && { backgroundColor: '#1a1200' }]}>
                        <Text style={[s.rewardPillText, b.id === 'founding_member' && { color: '#ffd700' }]}>🎁 {b.reward}</Text>
                      </View>
                      {!earned && <><BadgeProgressBar current={prog.current} total={prog.total} color={badgeColor} /><Text style={s.badgeProgressText}>{prog.label}</Text></>}
                      {earned && <Text style={[s.badgeProgressText, { color: badgeColor }]}>{prog.label}</Text>}
                    </View>
                    {earned
                      ? <Feather name="check-circle" size={22} color={badgeColor} />
                      : <View style={s.lockWrap}><Feather name="lock" size={18} color="#555" /><Text style={s.lockPct}>{Math.round(pct)}%</Text></View>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Badge Detail */}
      <Modal visible={badgeDetailVisible} animationType="fade" transparent onRequestClose={() => setBadgeDetailVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={[th.modal, { padding: 24, alignItems: 'center' }]}>
            {selectedBadge && (() => {
              const earned     = earnedBadgeIds.includes(selectedBadge.id);
              const prog       = selectedBadge.getProgress(badgeStats, totalUserCount);
              const badgeColor = selectedBadge.id === 'founding_member' ? '#ffd700' : theme.primary;
              return (
                <>
                  <Text style={{ fontSize: 64, marginBottom: 12 }}>{selectedBadge.icon}</Text>
                  <Text style={{ color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 }}>{selectedBadge.name}</Text>
                  {earned
                    ? <View style={[s.earnedTag, { marginBottom: 12 }]}><Text style={s.earnedTagText}>✅ BADGE EARNED</Text></View>
                    : <View style={[s.lockWrap, { marginBottom: 12, flexDirection: 'row', gap: 6 }]}><Feather name="lock" size={16} color="#888" /><Text style={{ color: '#888', fontSize: 13 }}>Not yet earned</Text></View>}
                  <View style={[s.rewardPill, { marginBottom: 16, paddingHorizontal: 16, paddingVertical: 8 }]}>
                    <Text style={[s.rewardPillText, { fontSize: 14, color: badgeColor }]}>🎁 {selectedBadge.reward}</Text>
                  </View>
                  <Text style={{ color: '#ccc', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 }}>{selectedBadge.rewardDetail}</Text>
                  {!earned && (
                    <View style={{ width: '100%', marginBottom: 16 }}>
                      <BadgeProgressBar current={prog.current} total={prog.total} color={badgeColor} />
                      <Text style={[s.badgeProgressText, { textAlign: 'center', marginTop: 6 }]}>{prog.label}</Text>
                    </View>
                  )}
                  <TouchableOpacity style={[th.btnPrimary, { width: '100%', marginTop: 8 }]} onPress={() => setBadgeDetailVisible(false)}>
                    <Text style={th.btnText}>Got it!</Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Invite / Referral */}
      <Modal visible={inviteModalVisible} animationType="slide" transparent onRequestClose={() => setInviteModalVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>🎁 Invite Friends</Text>
              <TouchableOpacity onPress={() => setInviteModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView>
              <View style={s.inviteSection}>
                <Text style={s.inviteTitle}>Your Referral Code</Text>
                <View style={s.referralCodeBox}>
                  <Text style={[s.referralCode, th.accent]}>{referralCode || 'Loading...'}</Text>
                  <View style={{ flexDirection: 'row', gap: 15 }}>
                    <TouchableOpacity onPress={handleCopyReferralCode}><Feather name="copy" size={20} color="#00ff88" /></TouchableOpacity>
                    <TouchableOpacity onPress={() => handleInviteFriends('general')}><Feather name="share-2" size={20} color="#00ff88" /></TouchableOpacity>
                  </View>
                </View>
                <Text style={s.inviteSubtext}>You've invited {inviteCount} friend{inviteCount !== 1 ? 's' : ''}</Text>
                <Text style={[s.inviteTitle, { marginTop: 16, marginBottom: 10 }]}>Share on your platforms</Text>
                <View style={s.smartShareRow}>
                  <TouchableOpacity style={[s.smartShareBtn, { backgroundColor: '#25D36615' }]} onPress={() => handleInviteFriends('whatsapp')}>
                    <Text style={{ fontSize: 22, marginBottom: 4 }}>💬</Text>
                    <Text style={[s.smartShareLabel, { color: '#25D366' }]}>WhatsApp</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.smartShareBtn, { backgroundColor: '#00000015' }]} onPress={() => handleInviteFriends('twitter')}>
                    <Text style={{ fontSize: 22, marginBottom: 4 }}>🐦</Text>
                    <Text style={[s.smartShareLabel, { color: '#e7e9ea' }]}>Twitter</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.smartShareBtn, { backgroundColor: '#E1306C15' }]} onPress={() => handleInviteFriends('instagram')}>
                    <Text style={{ fontSize: 22, marginBottom: 4 }}>📸</Text>
                    <Text style={[s.smartShareLabel, { color: '#E1306C' }]}>Instagram</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.smartShareBtn, { backgroundColor: '#ff005015' }]} onPress={() => handleInviteFriends('tiktok')}>
                    <Text style={{ fontSize: 22, marginBottom: 4 }}>🎵</Text>
                    <Text style={[s.smartShareLabel, { color: '#ff0050' }]}>TikTok</Text>
                  </TouchableOpacity>
                </View>
                <View style={s.referralBenefits}>
                  <Text style={s.benefitsTitle}>Referral Rewards:</Text>
                  <View style={s.benefitItem}><Text style={s.benefitIcon}>🎁</Text><Text style={s.benefitText}>You get: 100 points when they join</Text></View>
                  <View style={s.benefitItem}><Text style={s.benefitIcon}>✨</Text><Text style={s.benefitText}>Friend gets: 50 points on signup</Text></View>
                  <View style={s.benefitItem}><Text style={s.benefitIcon}>💰</Text><Text style={s.benefitText}>You earn: 5% coins on every withdrawal they make — forever!</Text></View>
                  <View style={s.benefitItem}><Text style={s.benefitIcon}>🌟</Text><Text style={s.benefitText}>Refer 20 friends: unlock a glowing avatar border!</Text></View>
                </View>
              </View>

              <View style={s.unlockSection}>
                <Text style={s.sectionTitle}>Unlock Features</Text>
                {UNLOCKABLE_FEATURES.map(feature => {
                  const isUnlocked = inviteCount >= feature.requiredInvites;
                  const progress   = Math.min(inviteCount, feature.requiredInvites);
                  return (
                    <TouchableOpacity
                      key={feature.id}
                      style={[s.unlockItem, isUnlocked && th.unlockActive]}
                      onPress={() => {
                        if (!isUnlocked) { Alert.alert('Feature Locked 🔒', `You need ${feature.requiredInvites} invites.\n\nYou have ${inviteCount}.`); return; }
                        if (feature.id === 'custom_themes') { setInviteModalVisible(false); setTimeout(() => navigation.navigate('Themes'), 300); }
                        else if (feature.id === 'advanced_analytics') { setInviteModalVisible(false); setTimeout(() => navigation.navigate('Analytics'), 300); }
                        else if (feature.id === 'glowing_avatar') Alert.alert('✨ Glowing Avatar Active!', 'Your profile picture has a beautiful glowing border!');
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={s.unlockIcon}>{feature.icon}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.unlockName, isUnlocked && { color: '#00ff88' }]}>{feature.name}</Text>
                        <Text style={s.unlockProgress}>{progress}/{feature.requiredInvites} invites</Text>
                      </View>
                      {isUnlocked ? <Feather name="check-circle" size={20} color="#00ff88" /> : <Feather name="lock" size={18} color="#555" />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[th.btnPrimary, { marginHorizontal: 20, marginBottom: 10, backgroundColor: '#111', borderWidth: 1, borderColor: '#00ff88' }]}
                onPress={() => { setInviteModalVisible(false); setTimeout(() => setContactInviteModalVisible(true), 300); }}
              >
                <Text style={[th.btnText, { color: '#00ff88' }]}>💬 Bring Your Contacts via SMS</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[th.btnPrimary, { marginHorizontal: 20, marginBottom: 20 }]} onPress={() => handleInviteFriends('general')}>
                <Text style={th.btnText}>Share Invite Code</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Edit Profile */}
      <Modal visible={editModalVisible} animationType="slide" transparent onRequestClose={() => setEditModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>✏️ Edit Profile</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView style={{ padding: 20 }}>
              <View style={s.inputGroup}>
                <Text style={s.inputLabel}>{t.profile.displayName}</Text>
                <TextInput style={s.input} value={editDisplayName} onChangeText={setEditDisplayName} placeholder="Enter display name" placeholderTextColor="#666" />
              </View>
              <View style={s.inputGroup}>
                <Text style={s.inputLabel}>{t.profile.username}</Text>
                <TextInput style={s.input} value={editUsername} onChangeText={setEditUsername} placeholder="Enter username" placeholderTextColor="#666" autoCapitalize="none" />
              </View>
              <View style={s.inputGroup}>
                <Text style={s.inputLabel}>{t.profile.bio}</Text>
                <TextInput style={[s.input, { height: 100, textAlignVertical: 'top' }]} value={editBio} onChangeText={setEditBio} placeholder="Tell us about yourself" placeholderTextColor="#666" multiline numberOfLines={4} />
              </View>
              <TouchableOpacity style={[s.btnPrimary, saving && s.btnDisabled]} onPress={handleSaveProfile} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={s.btnPrimaryText}>{t.profile.saveChanges}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Settings */}
      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={s.modalOverlay}>
          <View style={th.modal}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>⚙️ {t.settings.title}</Text>
              <TouchableOpacity onPress={() => setSettingsVisible(false)}><Feather name="x" size={24} color="#fff" /></TouchableOpacity>
            </View>
            <ScrollView>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => handleEditProfile(), 300); }}>
                <Feather name="edit-2" size={20} color={theme.primary} /><Text style={s.settingsText}>{t.profile.editProfile}</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={async () => { setSettingsVisible(false); await loadSavedPosts(); setTimeout(() => setSavedPostsModalVisible(true), 300); }}>
                <Feather name="bookmark" size={20} color={theme.primary} /><Text style={s.settingsText}>{t.settings.savedPosts}</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => handleConnectPaystack(), 300); }}>
                <Feather name="credit-card" size={20} color={theme.primary} /><Text style={s.settingsText}>{paystackConnected ? t.bank.connected : t.bank.notConnected}</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => navigation.navigate('LanguagePicker'), 300); }}>
                <Text style={{ fontSize: 20 }}>🌐</Text><Text style={s.settingsText}>{t.common.language}</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => { setEditingSocial({ ...socialLinks }); setSocialModalVisible(true); }, 300); }}>
                <Feather name="link" size={20} color={theme.primary} /><Text style={s.settingsText}>Social Links</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <View style={th.settingsItem}>
                <Feather name="layout" size={20} color={theme.primary} />
                <Text style={s.settingsText}>New Profile Layout</Text>
                <Switch
                  value={useNewLayout}
                  onValueChange={async v => { setUseNewLayout(v); try { await supabase.from('users').update({ use_new_profile_layout: v }).eq('id', user!.id); } catch {} }}
                  trackColor={{ false: '#333', true: theme.primary }}
                  thumbColor="#fff"
                />
              </View>
              <View style={th.settingsItem}>
                <Feather name="bell" size={20} color={theme.primary} />
                <Text style={s.settingsText}>Notifications</Text>
                <Switch value={notificationsEnabled} onValueChange={setNotificationsEnabled} trackColor={{ false: '#333', true: theme.primary }} thumbColor="#fff" />
              </View>
              <View style={th.settingsItem}>
                <Feather name="moon" size={20} color={theme.primary} />
                <Text style={s.settingsText}>Dark Mode</Text>
                <Switch value={darkModeEnabled} onValueChange={setDarkModeEnabled} trackColor={{ false: '#333', true: theme.primary }} thumbColor="#fff" />
              </View>
              <View style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' }}>
                <Text style={[s.settingsText, { marginBottom: 10 }]}>App Theme</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {Object.entries(THEMES).map(([key, tConfig]) => (
                    <TouchableOpacity
                      key={key}
                      onPress={() => handleThemeChange(key)}
                      style={{ backgroundColor: tConfig.primary, width: 36, height: 36, borderRadius: 18, margin: 4, borderWidth: activeThemeId === key ? 2 : 0, borderColor: '#fff' }}
                    />
                  ))}
                </ScrollView>
              </View>
              <View style={s.settingsDivider} />
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => setAboutModalVisible(true), 300); }}>
                <Feather name="info" size={20} color={theme.primary} /><Text style={s.settingsText}>{t.settings.about}</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => Linking.openURL('mailto:lumvibesupport@gmail.com')}>
                <Feather name="mail" size={20} color={theme.primary} /><Text style={s.settingsText}>Contact Support</Text><Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <View style={s.settingsDivider} />
              {/* ✅ NEW: Privacy & Compliance Section */}
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(handleDownloadData, 300); }}>
                <Feather name="download" size={20} color={theme.primary} />
                <Text style={s.settingsText}>Download My Data</Text>
                <Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(handleDoNotSell, 300); }}>
                <Feather name="shield" size={20} color={theme.primary} />
                <Text style={s.settingsText}>Do Not Sell My Information</Text>
                <Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => Linking.openURL('https://lumvibe.site/privacy')}>
                <Feather name="file-text" size={20} color={theme.primary} />
                <Text style={s.settingsText}>Privacy Policy</Text>
                <Feather name="chevron-right" size={18} color="#555" />
              </TouchableOpacity>
              <View style={s.settingsDivider} />
              <TouchableOpacity style={th.settingsItem} onPress={handleLogout}>
                <Feather name="log-out" size={20} color="#ff6b6b" /><Text style={[s.settingsText, { color: '#ff6b6b' }]}>{t.common.logout}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={th.settingsItem} onPress={() => { setSettingsVisible(false); setTimeout(() => { setDeleteConfirmText(''); setDeleteAccountModalVisible(true); }, 300); }}>
                <Feather name="trash-2" size={20} color="#ff4444" /><Text style={[s.settingsText, { color: '#ff4444' }]}>Delete Account</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Account */}
      <Modal visible={deleteAccountModalVisible} animationType="fade" transparent onRequestClose={() => setDeleteAccountModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.modalOverlay}>
          <View style={[th.modal, { padding: 24 }]}>
            <Text style={{ color: '#ff4444', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>⚠️ Delete Account</Text>
            <Text style={{ color: '#ccc', fontSize: 14, lineHeight: 22, marginBottom: 20 }}>This permanently deletes your account, posts, coins, and all data. This cannot be undone.</Text>
            <Text style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>Type DELETE to confirm:</Text>
            <TextInput
              style={[s.input, { borderColor: '#ff444466', marginBottom: 16 }]}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor="#555"
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={[s.btnPrimary, { backgroundColor: '#ff4444' }, deletingAccount && s.btnDisabled]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount ? <ActivityIndicator color="#fff" /> : <Text style={[s.btnPrimaryText, { color: '#fff' }]}>Delete My Account</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={{ marginTop: 12, alignItems: 'center' }} onPress={() => setDeleteAccountModalVisible(false)}>
              <Text style={{ color: '#666', fontSize: 14 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Profile Picture Fullscreen */}
      <Modal visible={profilePictureModalVisible} animationType="fade" transparent onRequestClose={() => setProfilePictureModalVisible(false)}>
        <TouchableOpacity style={[s.modalOverlay, { justifyContent: 'center', alignItems: 'center' }]} activeOpacity={1} onPress={() => setProfilePictureModalVisible(false)}>
          <View style={s.ppContent}>
            {userProfile.avatar_url
              ? <Image source={{ uri: userProfile.avatar_url }} style={s.ppImg} resizeMode="cover" />
              : <View style={s.ppPlaceholder}><Feather name="user" size={80} color="#333" /></View>}
            <TouchableOpacity style={s.ppClose} onPress={() => setProfilePictureModalVisible(false)}>
              <Feather name="x" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Contact Invite */}
      <ContactInviteModal
        visible={contactInviteModalVisible}
        onClose={() => setContactInviteModalVisible(false)}
        referralCode={referralCode}
        userName={userProfile?.display_name || userProfile?.username || 'me'}
      />
    </View>
  );
}

// ─── StyleSheets ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:              { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 10 },
  headerTitle:         { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  profile:             { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  topRow:              { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  avatarContainer:     { position: 'relative', marginRight: 20 },
  avatar:              { width: 80, height: 80, borderRadius: 40 },
  avatarPh:            { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  statsRow:            { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingTop: 10 },
  stat:                { alignItems: 'center' },
  statNum:             { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  statLbl:             { color: '#666', fontSize: 11, marginTop: 2 },
  info:                { marginBottom: 12 },
  nameRow:             { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 },
  name:                { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  username:            { color: '#666', fontSize: 14, marginBottom: 6 },
  bio:                 { color: '#ccc', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  likesRow:            { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  likesText:           { color: '#888', fontSize: 13 },
  socialBadgesRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  socialBadge:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  socialBadgeIcon:     { fontWeight: '900' },
  socialBadgeText:     { fontSize: 11, fontWeight: '600' },
  addSocialBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  addSocialBtnText:    { color: '#666', fontSize: 13 },
  glowBadge:           { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  glowBadgeText:       { fontSize: 11, fontWeight: '700' },
  actions:             { flexDirection: 'row', gap: 8 },
  btnSecondary:        { backgroundColor: '#111', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#222', flexDirection: 'row', gap: 4 },
  btnSecondaryText:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  gamifRow:            { flexDirection: 'row', justifyContent: 'space-between' },
  gamifItem:           { alignItems: 'center', flex: 1 },
  gamifIcon:           { fontSize: 18 },
  gamifLabel:          { color: '#666', fontSize: 10, marginTop: 2 },
  gamifValue:          { color: '#fff', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  levelProgress:       { marginTop: 10 },
  levelBar:            { height: 4, backgroundColor: '#2a2a2a', borderRadius: 2, overflow: 'hidden' },
  levelProgressText:   { color: '#555', fontSize: 10, textAlign: 'right', marginTop: 4 },
  postsSection:        { paddingHorizontal: 20, paddingTop: 8 },
  sectionTitle:        { color: '#fff', fontSize: 16, fontWeight: 'bold', paddingHorizontal: 20, marginBottom: 12 },
  postsGrid:           { flexDirection: 'row', flexWrap: 'wrap' },
  postThumb:           { width: POST_SIZE, height: POST_SIZE * 1.35, backgroundColor: '#111', position: 'relative', overflow: 'hidden', margin: 0.5 },
  postThumbVideoBg:    { width: '100%', height: '100%', backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' },
  postThumbImg:        { width: '100%', height: '100%' },
  postThumbStats:      { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', gap: 6 },
  postThumbStat:       { flexDirection: 'row', alignItems: 'center', gap: 2 },
  postThumbStatText:   { color: '#fff', fontSize: 10 },
  postThumbOverlay:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000066', zIndex: 1 },
  emptyState:          { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyText:           { color: '#555', fontSize: 14 },
  newHeader:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  newHeaderTitle:      { fontSize: 18, fontWeight: 'bold' },
  newProfileRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, gap: 16 },
  newStatsRow:         { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  newActionBtn:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8, borderWidth: 1 },
  newActionBtnText:    { fontSize: 12, fontWeight: '700' },
  newLevelCard:        { marginHorizontal: 16, marginBottom: 12, borderRadius: 14, padding: 16, borderWidth: 1 },
  newLevelTitle:       { fontSize: 18, fontWeight: 'bold' },
  newLevelSub:         { color: '#555', fontSize: 12, marginTop: 2 },
  newLeaderBtn:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
  newSection:          { marginHorizontal: 16, marginBottom: 12, borderRadius: 14, padding: 16 },
  newSectionHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  newSectionTitle:     { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  newBadgeChip:        { alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#222', backgroundColor: '#111', minWidth: 70 },
  newFeatureRow:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#222', backgroundColor: '#0a0a0a', marginBottom: 8 },
  modalOverlay:        { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  modalHeader:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#222' },
  modalTitle:          { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  walletBalance:       { alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#222' },
  walletLabel:         { color: '#999', fontSize: 13, marginBottom: 5 },
  walletUSD:           { color: '#ffd700', fontSize: 16, fontWeight: '600', marginTop: 4 },
  walletRate:          { color: '#555', fontSize: 11, marginTop: 4 },
  walletActions:       { flexDirection: 'row', gap: 12, padding: 16 },
  walletBtnText:       { color: '#fff', fontSize: 13, fontWeight: '600' },
  paystackNotice:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, backgroundColor: '#1a0f00', borderRadius: 8, borderWidth: 1, borderColor: '#ffa50033' },
  paystackNoticeText:  { color: '#ffa500', fontSize: 12, flex: 1 },
  txSection:           { padding: 16 },
  txItem:              { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  txDesc:              { color: '#fff', fontSize: 13 },
  txDate:              { color: '#555', fontSize: 11, marginTop: 2 },
  txAmt:               { fontSize: 14, fontWeight: 'bold' },
  settingsItem:        { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  settingsText:        { flex: 1, color: '#fff', fontSize: 14 },
  settingsDivider:     { height: 1, backgroundColor: '#1a1a1a', marginVertical: 8 },
  withdrawInfo:        { alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#222' },
  withdrawLabel:       { color: '#999', fontSize: 13, marginBottom: 5 },
  withdrawBal:         { fontSize: 32, fontWeight: 'bold' },
  withdrawUSD:         { color: '#ffd700', fontSize: 16, fontWeight: '600', marginTop: 4 },
  withdrawPreview:     { backgroundColor: '#111', borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#222' },
  withdrawPreviewLabel: { color: '#888', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  withdrawRow:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  withdrawRowLabel:    { color: '#888', fontSize: 13 },
  withdrawRowValue:    { color: '#fff', fontSize: 13, fontWeight: '600' },
  withdrawPreviewNote: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 10 },
  reqNotice:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 12, padding: 12, backgroundColor: '#1a0f00', borderRadius: 8, borderWidth: 1, borderColor: '#ffa50033' },
  reqText:             { color: '#ffa500', fontSize: 12, flex: 1 },
  paystackTitle:       { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  paystackSubtitle:    { color: '#999', fontSize: 13, lineHeight: 20, marginBottom: 20 },
  bankList:            { backgroundColor: '#1a1a1a', borderRadius: 10, maxHeight: 200, marginBottom: 12 },
  bankItem:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#252525' },
  bankItemActive:      { backgroundColor: '#00ff8811' },
  bankName:            { color: '#ccc', fontSize: 14 },
  verifiedBox:         { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#00ff8811', borderRadius: 10, marginTop: 12, borderWidth: 1, borderColor: '#00ff8833' },
  verifiedLabel:       { color: '#999', fontSize: 11 },
  verifiedName:        { color: '#00ff88', fontSize: 15, fontWeight: 'bold', marginTop: 2 },
  inputGroup:          { marginBottom: 16 },
  inputLabel:          { color: '#999', fontSize: 13, marginBottom: 8 },
  input:               { backgroundColor: '#1a1a1a', borderRadius: 10, borderWidth: 1, borderColor: '#333', paddingHorizontal: 14, paddingVertical: 13, color: '#fff', fontSize: 14 },
  inputHint:           { color: '#555', fontSize: 11, marginTop: 6 },
  btnPrimary:          { backgroundColor: '#00ff88', paddingVertical: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnPrimaryText:      { color: '#000', fontWeight: 'bold', fontSize: 15 },
  btnDisabled:         { opacity: 0.5 },
  socialModalSubtitle: { color: '#999', fontSize: 13, lineHeight: 20, marginBottom: 20 },
  socialInputRow:      { flexDirection: 'row', alignItems: 'center' },
  socialInputPrefix:   { color: '#666', fontSize: 14, paddingHorizontal: 10, paddingVertical: 13, backgroundColor: '#1a1a1a', borderTopLeftRadius: 10, borderBottomLeftRadius: 10, borderWidth: 1, borderColor: '#333', borderRightWidth: 0 },
  userItem:            { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  userAvatar:          { width: 44, height: 44, borderRadius: 22, marginRight: 12 },
  userName:            { color: '#fff', fontSize: 14, fontWeight: '600' },
  userUsername:        { color: '#666', fontSize: 12, marginTop: 2 },
  followBtn:           { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, backgroundColor: '#00ff88' },
  followingBtn:        { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#333', backgroundColor: 'transparent' },
  followingBtnText:    { color: '#888', fontSize: 12, fontWeight: '600' },
  leaderItem:          { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a', gap: 10 },
  leaderRank:          { fontSize: 18, width: 36, textAlign: 'center' },
  leaderAvatar:        { width: 40, height: 40, borderRadius: 20 },
  leaderName:          { color: '#fff', fontSize: 14, fontWeight: '600' },
  leaderUsername:      { color: '#666', fontSize: 12, marginTop: 2 },
  leaderStats:         { alignItems: 'flex-end' },
  leaderLevel:         { color: '#00ff88', fontSize: 12, fontWeight: '600' },
  leaderPts:           { color: '#999', fontSize: 11, marginTop: 2 },
  badgeItem:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  badgeItemLocked:     { opacity: 0.7 },
  badgeIcon:           { fontSize: 32, width: 40, textAlign: 'center' },
  badgeName:           { color: '#888', fontSize: 14, fontWeight: '600' },
  badgeDesc:           { color: '#555', fontSize: 12, marginTop: 2, marginBottom: 6 },
  badgeProgressText:   { color: '#555', fontSize: 11, marginTop: 2 },
  earnedTag:           { backgroundColor: '#00ff8822', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  earnedTagText:       { color: '#00ff88', fontSize: 10, fontWeight: '700' },
  rewardPill:          { backgroundColor: '#1a1200', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start', marginTop: 4 },
  rewardPillText:      { color: '#ffd700', fontSize: 11, fontWeight: '600' },
  lockWrap:            { alignItems: 'center', gap: 2 },
  lockPct:             { color: '#555', fontSize: 10 },
  inviteSection:       { padding: 20 },
  inviteTitle:         { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  referralCodeBox:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#333' },
  referralCode:        { fontSize: 22, fontWeight: 'bold', letterSpacing: 3 },
  inviteSubtext:       { color: '#666', fontSize: 13, marginBottom: 8 },
  smartShareRow:       { flexDirection: 'row', gap: 8, marginBottom: 16 },
  smartShareBtn:       { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#333' },
  smartShareLabel:     { fontSize: 11, fontWeight: '600' },
  referralBenefits:    { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#222' },
  benefitsTitle:       { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 10 },
  benefitItem:         { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  benefitIcon:         { fontSize: 16, width: 22 },
  benefitText:         { color: '#ccc', fontSize: 13, flex: 1, lineHeight: 18 },
  unlockSection:       { paddingHorizontal: 20, marginBottom: 8 },
  unlockItem:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#222', backgroundColor: '#111', marginBottom: 8 },
  unlockIcon:          { fontSize: 22, width: 28 },
  unlockName:          { color: '#fff', fontSize: 13, fontWeight: '600' },
  unlockProgress:      { color: '#555', fontSize: 11, marginTop: 2 },
  aboutSection:        { alignItems: 'center', paddingVertical: 20 },
  aboutAppName:        { color: '#00ff88', fontSize: 32, fontWeight: 'bold' },
  aboutVersion:        { color: '#666', fontSize: 13, marginTop: 4 },
  aboutTagline:        { color: '#999', fontSize: 14, marginTop: 8 },
  aboutDivider:        { height: 1, backgroundColor: '#1a1a1a', marginVertical: 16 },
  aboutItem:           { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  aboutItemText:       { flex: 1, color: '#fff', fontSize: 14 },
  aboutFooter:         { alignItems: 'center', paddingVertical: 20 },
  aboutFooterText:     { color: '#666', fontSize: 13 },
  aboutCopyright:      { color: '#444', fontSize: 12, marginTop: 4 },
  ppContent:           { width: width - 40, aspectRatio: 1, position: 'relative' },
  ppImg:               { width: '100%', height: '100%', borderRadius: 12 },
  ppPlaceholder:       { width: '100%', height: '100%', backgroundColor: '#111', borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  ppClose:             { position: 'absolute', top: 10, right: 10, backgroundColor: '#00000088', borderRadius: 20, padding: 6 },
});

const ci = StyleSheet.create({
  overlay:          { flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' },
  sheet:            { backgroundColor: '#0a0a0a', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%', paddingBottom: 40 },
  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  title:            { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  subtitle:         { color: '#666', fontSize: 13, marginTop: 2 },
  infoBanner:       { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#0a1a0a', margin: 16, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#00ff8833' },
  infoBannerTitle:  { color: '#00ff88', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  infoBannerText:   { color: '#666', fontSize: 12, lineHeight: 18 },
  permissionBox:    { alignItems: 'center', padding: 32, gap: 12 },
  permissionTitle:  { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  permissionText:   { color: '#666', fontSize: 13, textAlign: 'center' },
  permissionBtn:    { backgroundColor: '#00ff88', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  permissionBtnText:{ color: '#000', fontWeight: 'bold' },
  searchBox:        { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#111', borderRadius: 10, margin: 16, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput:      { flex: 1, color: '#fff', fontSize: 14 },
  selectAllRow:     { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 8 },
  selectAllText:    { color: '#00ff88', fontSize: 13, fontWeight: '600' },
  countText:        { color: '#555', fontSize: 13 },
  contactRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  avatar:           { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', borderWidth: 2 },
  avatarText:       { fontSize: 14, fontWeight: 'bold' },
  contactName:      { color: '#fff', fontSize: 14, fontWeight: '600' },
  contactPhone:     { color: '#555', fontSize: 12, marginTop: 1 },
  checkbox:         { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#333', justifyContent: 'center', alignItems: 'center' },
  checkboxOn:       { backgroundColor: '#00ff88', borderColor: '#00ff88' },
  checkmark:        { color: '#000', fontSize: 13, fontWeight: 'bold' },
  toggleRow:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  toggleTitle:      { color: '#fff', fontSize: 13, fontWeight: '600' },
  toggleSub:        { color: '#555', fontSize: 11, marginTop: 2 },
  toggleTrack:      { width: 44, height: 24, borderRadius: 12, backgroundColor: '#333', justifyContent: 'center', padding: 2 },
  toggleTrackOn:    { backgroundColor: '#00ff88' },
  toggleThumb:      { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  toggleThumbOn:    { alignSelf: 'flex-end' },
  btn:              { backgroundColor: '#00ff88', marginHorizontal: 16, marginTop: 8, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  btnDisabled:      { opacity: 0.4 },
  btnText:          { color: '#000', fontWeight: 'bold', fontSize: 15 },
});