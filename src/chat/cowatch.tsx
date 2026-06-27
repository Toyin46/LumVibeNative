// app/chat/cowatch.tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — Co-Watch Screen (Full Production Build)
//
// ✅ All previous fixes preserved (Agora, chat, gifts, reactions, audio, etc.)
// ─────────────────────────────────────────────────────────────
// v5 — 100% PARITY WITH index.tsx (v19) + videos.tsx (v15):
//
//  ✅ LIKES — fully consistent across all screens:
//     handleLike writes to `likes` table (not posts.liked_by array).
//     fetchFeedPosts reads liked_by from `likes` table — same source as
//     index.tsx and videos.tsx. Like in cowatch = liked in home feed. ✅
//     toggleLikePost (wrote to posts array) removed — was the old divergent path.
//
//  ✅ REAL-TIME liked_by SYNC:
//     subscribeToPostsUpdates now also re-fetches liked_by from likes table
//     on every UPDATE event — hearts stay correct when partner likes a post.
//     Previously only likes_count/coins_received/comments_count were synced.
//
//  ✅ AUDIO — matches index.tsx v3.5 exactly:
//     startAudio: shouldPlay:true (instant start on first bytes),
//     overrideFileExtensionAndroid:'m4a' (Cloudinary URL format hint),
//     shouldCorrectPitch:false (no blocking DSP on older Android),
//     progressUpdateIntervalMillis:250 (smooth waveform on slow network).
//
//  ✅ VOICE AUTO-PLAY:
//     Voice posts auto-play when isCurrent — user can tap to pause.
//     Artificial 200ms delay removed — matches index.tsx v3.5.
//
//  ✅ toggleVoicePlayback / toggleMusicPlayback:
//     Robust 3-state handling (loaded / unloaded / null) — matches index.tsx.
// ─────────────────────────────────────────────────────────────

import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity,
  StyleSheet, StatusBar, ActivityIndicator,
  KeyboardAvoidingView, Platform, Image, Alert, Dimensions,
  Animated, Modal, Share, ScrollView, PermissionsAndroid,
  RefreshControl, PanResponder, GestureResponderEvent, Linking,
} from 'react-native';
// FIX 3/19: react-native-video for feed video (same as videos.tsx — reliable in bare workflow)
import RNVideo from 'react-native-video';
// FIX: expo-av is deprecated — replaced with expo-audio for music/voice posts.
// createAudioPlayer is the imperative (non-hook) factory, needed here since
// globalAudioManager is a plain singleton object, not a React component.
import { createAudioPlayer, AudioModule, type AudioPlayer } from 'expo-audio';
// FIX 1: Replace expo-router with @react-navigation/native
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaView } from 'react-native-safe-area-context';
// FIX 2: Correct relative paths for bare workflow
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import { notifyCowatchInvite } from '../lib/notifications';

// ── FIX 4: LIVEKIT — replaces Agora completely ──────────────────────────────
// Install: npm install @livekit/react-native @livekit/react-native-webrtc
// android/build.gradle → add: implementation "org.webrtc:google-webrtc:1.0.32006"
// ios/Podfile → pod 'livekit-client-sdk-swift', '~> 2.0'
// app.json → plugins: ["@livekit/react-native"]
// FIX: Room/RoomEvent/Track are core classes from livekit-client.
// @livekit/react-native only wraps native WebRTC + provides RN-specific UI (VideoView).
// useTracks/ConnectionState were imported but never used, so they've been dropped.
import { Room, RoomEvent, Track } from 'livekit-client';
import { VideoView } from '@livekit/react-native';

// FIX 17: 15-second timeout wrapper for all network requests
async function fetchWithTimeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('Request timed out')), ms)
  );
  return Promise.race([promise, timeout]);
}

const { width: SW, height: SH } = Dimensions.get('screen');

// ─────────────────────────────────────────────────────────────
// LIVEKIT CONFIG — set your LiveKit server URL in app.config.js
// extra: { livekitUrl: process.env.LIVEKIT_URL }
// For LiveKit Cloud free tier: wss://your-project.livekit.cloud
// ─────────────────────────────────────────────────────────────
const LIVEKIT_URL: string =
  (Constants.expoConfig?.extra as any)?.livekitUrl ?? '';

if (__DEV__ && !LIVEKIT_URL) {
  console.warn(
    '[LumVibe] LIVEKIT_URL not set. Video calls will not connect.\n' +
    '1. Sign up at https://livekit.io (free)\n' +
    '2. Add LIVEKIT_URL=wss://your-project.livekit.cloud to .env\n' +
    '3. Add livekitUrl: process.env.LIVEKIT_URL to app.config.js → extra\n' +
    '4. Deploy the livekit-token Supabase edge function\n' +
    '5. Run: expo prebuild'
  );
}

// ── AdMob ─────────────────────────────────────────────────────
const BANNER_AD_UNIT_ID = __DEV__
  ? TestIds.BANNER
  : 'ca-app-pub-8235065812461074/4176727692';

// ─────────────────────────────────────────────────────────────
// LIVEKIT PERMISSIONS (camera + mic for both platforms)
// ─────────────────────────────────────────────────────────────
async function requestLiveKitPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    const ok =
      results[PermissionsAndroid.PERMISSIONS.CAMERA]       === PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
    if (!ok) {
      Alert.alert(
        'Permissions Required',
        'Camera and microphone access are needed for video calls.\n\nGo to Settings → App Permissions to enable them.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]
      );
    }
    return ok;
  } catch (e) {
    console.error('requestLiveKitPermissions:', e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// LIVEKIT TOKEN — fetch from Supabase edge function
// Edge function: supabase/functions/livekit-token/index.ts
// Deploy: npx supabase functions deploy livekit-token
// ─────────────────────────────────────────────────────────────
async function fetchLiveKitToken(roomName: string, participantName: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke('livekit-token', {
      body: { roomName, participantName },
    });
    if (error) throw error;
    return data?.token || null;
  } catch (e) {
    console.error('fetchLiveKitToken error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// useLiveKitCall — drop-in replacement for useAgoraCall
// Handles: connect, disconnect, mic mute, cam mute, speaker
// ─────────────────────────────────────────────────────────────
function useLiveKitCall(channelName: string, userId: string, displayName: string) {
  const roomRef           = useRef<Room | null>(null);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [callReady,       setCallReady]       = useState(false);
  const [micMuted,        setMicMuted]        = useState(false);
  const [camMuted,        setCamMuted]        = useState(false);
  const [speakerOn,       setSpeakerOn]       = useState(true);
  const [permDenied,      setPermDenied]      = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<any>(null);
  const [remoteVideoTrack,setRemoteVideoTrack]= useState<any>(null);
  const mountedRef        = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!channelName || !LIVEKIT_URL) return;

    let room: Room;
    const init = async () => {
      const granted = await requestLiveKitPermissions();
      if (!granted) { if (mountedRef.current) setPermDenied(true); return; }
      if (!mountedRef.current) return;

      const token = await fetchWithTimeout(fetchLiveKitToken(channelName, displayName || userId));
      if (!token || !mountedRef.current) return;

      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: { width: 360, height: 640, frameRate: 24 },
        },
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      // ── Event handlers ──────────────────────────────────────
      room.on(RoomEvent.Connected, () => {
        if (!mountedRef.current) return;
        setCallReady(true);
      });

      room.on(RoomEvent.ParticipantConnected, (participant: any) => {
        if (!mountedRef.current) return;
        setRemoteConnected(true);
        // Subscribe to their video/audio tracks automatically
        participant.on('trackPublished', (publication: any) => {
          publication.setSubscribed(true);
        });
        participant.videoTrackPublications.forEach((pub: any) => {
          pub.setSubscribed(true);
          if (pub.track) setRemoteVideoTrack(pub.track);
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!mountedRef.current) return;
        setRemoteConnected(false);
        setRemoteVideoTrack(null);
      });

      room.on(RoomEvent.TrackSubscribed, (track: any, _pub: any, participant: any) => {
        if (!mountedRef.current) return;
        if (track.kind === Track.Kind.Video) {
          setRemoteVideoTrack(track);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        if (track.kind === Track.Kind.Video) setRemoteVideoTrack(null);
      });

      room.on(RoomEvent.Disconnected, () => {
        if (!mountedRef.current) return;
        setCallReady(false);
        setRemoteConnected(false);
      });

      // FIX: capture the local camera track as soon as it's published,
      // instead of relying on a return value from a manual createVideoTrack call.
      room.on(RoomEvent.LocalTrackPublished, (publication: any) => {
        if (mountedRef.current && publication?.track && publication.source === Track.Source.Camera) {
          setLocalVideoTrack(publication.track);
        }
      });

      try {
        await room.connect(LIVEKIT_URL, token);
        if (!mountedRef.current) { room.disconnect(); return; }

        // FIX: setCameraEnabled/setMicrophoneEnabled create AND publish the track
        // in one call — there's no createVideoTrack/createAudioTrack method on
        // LocalParticipant. The LocalTrackPublished listener above captures the
        // resulting camera track for the local preview.
        await Promise.all([
          room.localParticipant.setCameraEnabled(true),
          room.localParticipant.setMicrophoneEnabled(true),
        ]);

        // Fallback in case the LocalTrackPublished event fired before this line
        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        if (mountedRef.current && cameraPub?.track) setLocalVideoTrack(cameraPub.track);
      } catch (err) {
        console.error('LiveKit connect error:', err);
      }
    };

    init();
    return () => {
      mountedRef.current = false;
      if (roomRef.current) {
        try { roomRef.current.disconnect(); } catch (_) {}
        roomRef.current = null;
      }
    };
  }, [channelName, userId, displayName]);

  const toggleMic = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !micMuted;
    try {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
      setMicMuted(next);
    } catch (e) { console.warn('toggleMic error:', e); }
  }, [micMuted]);

  const toggleCam = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !camMuted;
    try {
      await roomRef.current.localParticipant.setCameraEnabled(!next);
      setCamMuted(next);
    } catch (e) { console.warn('toggleCam error:', e); }
  }, [camMuted]);

  const toggleSpeaker = useCallback(() => {
    // LiveKit handles speaker routing via audio session automatically
    // On Android: InCallManager handles speaker/earpiece
    setSpeakerOn(v => !v);
  }, []);

  const disconnect = useCallback(async () => {
    try {
      if (roomRef.current) {
        await roomRef.current.disconnect();
        roomRef.current = null;
      }
    } catch (_) {}
  }, []);

  return {
    remoteConnected, callReady, micMuted, camMuted, speakerOn, permDenied,
    localVideoTrack, remoteVideoTrack,
    toggleMic, toggleCam, toggleSpeaker, disconnect,
    // kept for backward compat with PipOverlay prop names
    agoraReady: true,
    engineJoined: callReady,
    remoteUid: remoteConnected ? 1 : null,
  };
}

const COIN_TO_NGN = 150;
function coinsToNGN(coins: number): string {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}

// ── Local Currency Detection (matches index.tsx) ───────────────
const CURRENCY_BY_TIMEZONE: Record<string, { code: string; symbol: string; rateFromNgn: number; decimals: number }> = {
  'Africa/Lagos':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        decimals: 0 },
  'Africa/Abuja':        { code: 'NGN', symbol: '₦',   rateFromNgn: 1,        decimals: 0 },
  'Africa/Accra':        { code: 'GHS', symbol: 'GH₵', rateFromNgn: 0.0067,   decimals: 2 },
  'Africa/Nairobi':      { code: 'KES', symbol: 'KSh', rateFromNgn: 0.087,    decimals: 0 },
  'Africa/Johannesburg': { code: 'ZAR', symbol: 'R',   rateFromNgn: 0.012,    decimals: 2 },
  'Africa/Cairo':        { code: 'EGP', symbol: 'E£',  rateFromNgn: 0.033,    decimals: 2 },
  'Europe/London':       { code: 'GBP', symbol: '£',   rateFromNgn: 0.000533, decimals: 2 },
  'Europe/Paris':        { code: 'EUR', symbol: '€',   rateFromNgn: 0.000617, decimals: 2 },
  'America/New_York':    { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, decimals: 2 },
  'America/Los_Angeles': { code: 'USD', symbol: '$',   rateFromNgn: 0.000667, decimals: 2 },
  'America/Toronto':     { code: 'CAD', symbol: 'CA$', rateFromNgn: 0.000917, decimals: 2 },
  'Asia/Dubai':          { code: 'AED', symbol: 'د.إ', rateFromNgn: 0.00245,  decimals: 2 },
  'Asia/Kolkata':        { code: 'INR', symbol: '₹',   rateFromNgn: 0.0557,   decimals: 0 },
  'Asia/Tokyo':          { code: 'JPY', symbol: '¥',   rateFromNgn: 0.10,     decimals: 0 },
  'Asia/Singapore':      { code: 'SGD', symbol: 'S$',  rateFromNgn: 0.000894, decimals: 2 },
  'Australia/Sydney':    { code: 'AUD', symbol: 'A$',  rateFromNgn: 0.001033, decimals: 2 },
};
const DEFAULT_GIFT_CURRENCY = { code: 'USD', symbol: '$', rateFromNgn: 0.000667, decimals: 2 };

function detectGiftCurrency() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CURRENCY_BY_TIMEZONE[tz]) return CURRENCY_BY_TIMEZONE[tz];
    const continent = tz.split('/')[0];
    const match = Object.entries(CURRENCY_BY_TIMEZONE).find(([k]) => k.startsWith(continent));
    if (match) return match[1];
  } catch {}
  return DEFAULT_GIFT_CURRENCY;
}

function giftLocalPrice(ngnAmount: number): string {
  const cur = detectGiftCurrency();
  const local = ngnAmount * cur.rateFromNgn;
  if (cur.decimals === 0) return `${cur.symbol}${Math.round(local).toLocaleString()}`;
  return `${cur.symbol}${local.toLocaleString(undefined, {
    minimumFractionDigits: cur.decimals,
    maximumFractionDigits: cur.decimals,
  })}`;
}

// ── Points ─────────────────────────────────────────────────────
const POINTS_PER_VIEW    = 2;
const POINTS_PER_LIKE    = 10;
const POINTS_PER_COMMENT = 15;

async function getOwnerBadgeMultipliers(ownerId: string) {
  try {
    const { data } = await supabase.from('user_badges').select('badge_id').eq('user_id', ownerId);
    const badges = new Set(data?.map((b: any) => b.badge_id) || []);
    return {
      viewPoints:    badges.has('early_adopter') ? 4  : POINTS_PER_VIEW,
      likePoints:    badges.has('followers_100') ? 15 : POINTS_PER_LIKE,
      commentPoints: badges.has('streak_30')     ? 20 : POINTS_PER_COMMENT,
    };
  } catch {
    return { viewPoints: POINTS_PER_VIEW, likePoints: POINTS_PER_LIKE, commentPoints: POINTS_PER_COMMENT };
  }
}

// ── COLORS ────────────────────────────────────────────────────
const C = {
  black:   '#000000',
  bg:      '#0a0a0a',
  card:    '#1a1a1a',
  card2:   '#1e1e1e',
  border:  '#2a2a2a',
  green:   '#00e676',
  greenBg: 'rgba(0,230,118,0.12)',
  red:     '#e53935',
  gold:    '#ffd700',
  white:   '#ffffff',
  muted:   '#888888',
  muted2:  '#444444',
  overlay: 'rgba(0,0,0,0.55)',
};

// ── Gift packages ─────────────────────────────────────────────
const GIFT_PACKAGES = [
  { id: 'rose',        name: 'Rose',        icon: '🌹', coins: 10,   ngn: 1_500,   color: '#ff69b4' },
  { id: 'ice_cream',   name: 'Ice Cream',   icon: '🍦', coins: 50,   ngn: 7_500,   color: '#00bfff' },
  { id: 'love_letter', name: 'Love Letter', icon: '💌', coins: 100,  ngn: 15_000,  color: '#ff4d8f' },
  { id: 'trophy',      name: 'Trophy',      icon: '🏆', coins: 500,  ngn: 75_000,  color: '#cd7f32' },
  { id: 'crown',       name: 'Crown',       icon: '👑', coins: 1000, ngn: 150_000, color: '#ffd700' },
  { id: 'diamond',     name: 'Diamond',     icon: '💎', coins: 5000, ngn: 750_000, color: '#00ffff' },
];

// ── Native Ad Slots (LumVibe branded) ─────────────────────────
const NATIVE_AD_SLOTS = [
  {
    advertiser:  'LumVibe Premium',
    caption:     '🚀 Go Premium — zero ads, exclusive creator badges, and priority support. Upgrade now!',
    gradient:    ['#001a0d', '#0d1a0d', '#001a0d'] as const,
    accentColor: C.green,
    ctaLabel:    'Get Premium',
    ctaRoute:    '/buy-coins',
    bgEmoji:     '💎',
    tagline:     'Unlock the full LumVibe experience',
  },
  {
    advertiser:  'LumVibe Coins',
    caption:     '🪙 Top up your wallet and show your favourite creators some love with gifts!',
    gradient:    ['#1a1200', '#1a1000', '#1a1200'] as const,
    accentColor: C.gold,
    ctaLabel:    'Buy Coins',
    ctaRoute:    '/buy-coins',
    bgEmoji:     '🪙',
    tagline:     'Support creators with real value',
  },
  {
    advertiser:  'LumVibe Creator Fund',
    caption:     '🎬 Turn your creativity into income. Start posting on LumVibe and earn today!',
    gradient:    ['#0d001a', '#160d1a', '#0d001a'] as const,
    accentColor: '#a855f7',
    ctaLabel:    'Start Creating',
    ctaRoute:    '/(tabs)/create',
    bgEmoji:     '🎬',
    tagline:     'Creators earn real money here',
  },
];

// ── GLOBAL AUDIO MANAGER (matches index.tsx) ──────────────────
const globalAudioManager = {
  currentPlayer: null as AudioPlayer | null,
  currentPostId: null as string | null,
  async stopCurrent() {
    if (this.currentPlayer) {
      try {
        this.currentPlayer.pause();
        this.currentPlayer.remove();
      } catch (_) {}
      this.currentPlayer = null;
      this.currentPostId = null;
    }
  },
  play(player: AudioPlayer, postId: string) {
    this.stopCurrent();
    this.currentPlayer = player;
    this.currentPostId = postId;
    try { player.play(); } catch (_) {}
  },
};

function isRemoteUrl(uri: string): boolean {
  if (!uri) return false;
  return uri.startsWith('http://') || uri.startsWith('https://');
}

// ── TYPES ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// AI MATCH — status type
// Tracks the state of AI vibe matching before session starts
// ─────────────────────────────────────────────────────────────
type AiMatchStatus =
  | 'idle'        // not in AI match mode
  | 'searching'   // inserted into queue, polling for a match
  | 'matched'     // match found, transitioning to session
  | 'expired'     // timed out with no match found
  | 'cancelled';  // user cancelled before match

interface CowatchSession {
  id: string; conversation_id: string;
  feed_type: 'index' | 'video';
  current_post_index: number;
  started_by: string; created_at: string;
  is_active: boolean; is_playing: boolean;
  current_position: number;
}

interface LiveMessage {
  id: string; user_id: string; display_name: string;
  avatar_url?: string; content: string;
  created_at: string; isMe: boolean;
}

interface FeedPost {
  id: string; user_id: string;
  display_name: string; username: string; avatar_url?: string;
  caption?: string;
  media_url?: string;
  thumbnail_url?: string;
  media_type: string;
  likes_count: number; comments_count: number;
  coins_received: number;
  views_count: number;
  liked_by: string[];
  saved_by?: string[];
  created_at: string;
  liked_by_me?: boolean;
  // audio fields
  music_url?: string;
  music_name?: string;
  music_artist?: string;
  voice_duration?: number;
  location?: string | null;
  // ✅ video-specific fields (from videos.tsx) — needed for video tab consistency
  video_effect?: string;
  video_filter_tint?: string | null;
  playback_rate?: number | null;
  is_immerse?: boolean;
  haptic_pattern?: string | null;
  spatial_audio?: boolean | null;
  vibe_type?: string | null;
}

interface AdItem { id: string; isAd: true; adIndex: number; }
type FeedItem = FeedPost | AdItem;
function isAd(item: FeedItem): item is AdItem { return 'isAd' in item && (item as AdItem).isAd === true; }

interface Comment {
  id: string; user_id: string;
  display_name: string; avatar_url?: string;
  content: string; created_at: string;
  parent_comment_id?: string | null;
  likes_count?: number;
  liked_by?: string[];
}

interface FloatingReaction {
  id: string; emoji: string; anim: Animated.Value; x: number;
}

const QUICK_REACTIONS = ['🔥', '😂', '😮', '❤️', '👏', '💀'];

// ─────────────────────────────────────────────────────────────
// AVATAR — unified
// ─────────────────────────────────────────────────────────────
function Avatar({ uri, name, size, borderColor }: {
  uri?: string; name: string; size: number; borderColor?: string;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, overflow: 'hidden',
      borderWidth: borderColor ? 2 : 0, borderColor: borderColor || 'transparent',
    }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size }} />
      ) : (
        <View style={{ width: size, height: size, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#000', fontWeight: '800', fontSize: size * 0.38 }}>
            {(name || 'U')[0].toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// NATIVE AD CARD (LumVibe branded)
// ✅ FIXED: BannerAd is now VISIBLE at bottom — AdMob policy compliant
// ─────────────────────────────────────────────────────────────
const NativeAdCard = memo(function NativeAdCard({ adIndex, itemHeight = SH }: { adIndex: number; itemHeight?: number }) {
  const slot = NATIVE_AD_SLOTS[adIndex % NATIVE_AD_SLOTS.length];
  const pulse = useRef(new Animated.Value(1)).current;
  // FIX: this is a standalone component, not nested under the main screen,
  // so it needs its own navigation reference rather than relying on an
  // outer-scope variable that doesn't exist here.
  const navigation = useNavigation<any>();

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.05, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={[adStyles.card, { width: SW, height: itemHeight }]}>
      <LinearGradient
        colors={slot.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Big faded background emoji */}
      <Animated.Text style={[adStyles.bgEmoji, { transform: [{ scale: pulse }] }]}>
        {slot.bgEmoji}
      </Animated.Text>

      {/* Sponsored pill top-right */}
      <View style={adStyles.sponsoredPill}>
        <MaterialCommunityIcons name="shield-check" size={11} color={slot.accentColor} />
        <Text style={[adStyles.sponsoredText, { color: slot.accentColor }]}>Sponsored</Text>
      </View>

      {/* Center content */}
      <View style={adStyles.center}>
        <Text style={[adStyles.tagline, { color: slot.accentColor }]}>{slot.tagline}</Text>
        <Text style={adStyles.caption}>{slot.caption}</Text>
        <TouchableOpacity
          style={[adStyles.cta, { backgroundColor: slot.accentColor }]}
          onPress={() => navigation.navigate(slot.ctaRoute.replace('/(tabs)/', '').replace('/', '') as any)}
          activeOpacity={0.85}
        >
          <Text style={adStyles.ctaText}>{slot.ctaLabel}</Text>
        </TouchableOpacity>
      </View>

      {/* LumVibe watermark */}
      <View style={adStyles.watermark}>
        <MaterialCommunityIcons name="shield-check" size={13} color={slot.accentColor} />
        <Text style={[adStyles.watermarkText, { color: slot.accentColor }]}>LumVibe</Text>
      </View>

      {/* ✅ FIXED: BannerAd is now VISIBLE at the bottom of the card */}
      {/* Previously hidden with opacity:0 which violates AdMob policy */}
      <View style={adStyles.bannerAdContainer}>
        <Text style={adStyles.bannerAdLabel}>Advertisement</Text>
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
});

// ─────────────────────────────────────────────────────────────
// SERVICE CALLS
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// AI MATCH — get user's top vibe categories
// Reads the last 20 liked posts and finds the top 2 vibe_types.
// Falls back to ['fire','funny'] if no history exists.
// ─────────────────────────────────────────────────────────────
async function getUserTopVibes(userId: string): Promise<string[]> {
  try {
    const { data: likedPostIds } = await supabase
      .from('likes')
      .select('post_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!likedPostIds || likedPostIds.length === 0) return ['fire', 'funny'];

    const ids = likedPostIds.map((l: any) => l.post_id);
    const { data: posts } = await supabase
      .from('posts')
      .select('vibe_type')
      .in('id', ids)
      .not('vibe_type', 'is', null);

    if (!posts || posts.length === 0) return ['fire', 'funny'];

    const counts: Record<string, number> = {};
    posts.forEach((p: any) => {
      if (p.vibe_type) counts[p.vibe_type] = (counts[p.vibe_type] || 0) + 1;
    });

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([vibe]) => vibe);
  } catch (e) {
    console.error('getUserTopVibes error:', e);
    return ['fire', 'funny'];
  }
}

// ─────────────────────────────────────────────────────────────
// AI MATCH — insert self into queue
// ─────────────────────────────────────────────────────────────
async function joinAiMatchQueue(
  userId: string,
  vibeCategories: string[],
): Promise<string | null> {
  try {
    await supabase
      .from('ai_match_queue')
      .update({ status: 'expired' })
      .eq('user_id', userId)
      .eq('status', 'waiting');

    const { data, error } = await supabase
      .from('ai_match_queue')
      .insert({
        user_id: userId,
        vibe_categories: vibeCategories,
        status: 'waiting',
        expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;
    return data?.id || null;
  } catch (e) {
    console.error('joinAiMatchQueue error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// AI MATCH — poll queue row for a match
// ─────────────────────────────────────────────────────────────
async function pollAiMatchQueue(queueId: string): Promise<{
  matched_with: string | null;
  session_id: string | null;
  status: string;
} | null> {
  try {
    const { data, error } = await supabase
      .from('ai_match_queue')
      .select('status, matched_with, session_id')
      .eq('id', queueId)
      .single();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('pollAiMatchQueue error:', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// AI MATCH — cancel queue entry
// ─────────────────────────────────────────────────────────────
async function cancelAiMatchQueue(queueId: string): Promise<void> {
  try {
    await supabase
      .from('ai_match_queue')
      .update({ status: 'expired' })
      .eq('id', queueId);
  } catch (e) {
    console.error('cancelAiMatchQueue error:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// AI MATCH — attempt to match a waiting user
// Finds another waiting user with overlapping vibe categories,
// creates a shared cowatch_session, and updates both queue rows.
// ─────────────────────────────────────────────────────────────
async function attemptAiMatch(
  myQueueId: string,
  myUserId: string,
  myVibes: string[],
): Promise<{
  matched: boolean;
  sessionId: string | null;
  partnerId: string | null;
  partnerName: string | null;
  partnerPhoto: string | null;
}> {
  try {
    const { data: candidates, error } = await supabase
      .from('ai_match_queue')
      .select('id, user_id, vibe_categories')
      .eq('status', 'waiting')
      .neq('user_id', myUserId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(20);

    if (error || !candidates || candidates.length === 0) {
      return { matched: false, sessionId: null, partnerId: null, partnerName: null, partnerPhoto: null };
    }

    let bestCandidate: any = null;
    let bestScore = -1;
    for (const c of candidates) {
      const theirVibes: string[] = c.vibe_categories || [];
      const overlap = myVibes.filter(v => theirVibes.includes(v)).length;
      if (overlap > bestScore) { bestScore = overlap; bestCandidate = c; }
    }

    if (!bestCandidate) {
      return { matched: false, sessionId: null, partnerId: null, partnerName: null, partnerPhoto: null };
    }

    const partnerId: string = bestCandidate.user_id;
    const sharedSessionId = `ai_match_${myUserId.slice(0, 8)}_${partnerId.slice(0, 8)}_${Date.now()}`;

    const { data: sessionData, error: sessionError } = await supabase
      .from('cowatch_sessions')
      .insert({
        conversation_id: sharedSessionId,
        started_by: myUserId,
        feed_type: 'video',
        current_post_index: 0,
        current_position: 0,
        is_playing: false,
        is_active: true,
        video_id: 'feed',
        video_title: 'AI Match Feed',
        video_url: '',
      })
      .select('id')
      .single();

    if (sessionError || !sessionData) {
      console.error('attemptAiMatch: session insert failed', sessionError);
      return { matched: false, sessionId: null, partnerId: null, partnerName: null, partnerPhoto: null };
    }

    await supabase.from('ai_match_queue').update({
      status: 'matched',
      matched_with: partnerId,
      session_id: sharedSessionId,
      matched_at: new Date().toISOString(),
    }).eq('id', myQueueId);

    await supabase.from('ai_match_queue').update({
      status: 'matched',
      matched_with: myUserId,
      session_id: sharedSessionId,
      matched_at: new Date().toISOString(),
    }).eq('id', bestCandidate.id);

    const { data: partnerProfile } = await supabase
      .from('users')
      .select('display_name, username, avatar_url')
      .eq('id', partnerId)
      .single();

    return {
      matched: true,
      sessionId: sharedSessionId,
      partnerId,
      partnerName: partnerProfile?.display_name || partnerProfile?.username || 'Vibe Match',
      partnerPhoto: partnerProfile?.avatar_url || null,
    };
  } catch (e) {
    console.error('attemptAiMatch error:', e);
    return { matched: false, sessionId: null, partnerId: null, partnerName: null, partnerPhoto: null };
  }
}

async function startCowatchSession(
  conversationId: string, startedBy: string, feedType: 'index' | 'video',
): Promise<CowatchSession | null> {
  try {
    await supabase.from('cowatch_sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('is_active', true);
    const { data, error } = await supabase.from('cowatch_sessions').insert({
      conversation_id: conversationId, started_by: startedBy,
      feed_type: feedType, current_post_index: 0,
      current_position: 0, is_playing: false, is_active: true,
      video_id: 'feed', video_title: 'Feed', video_url: '',
    }).select().single();
    if (error) throw error;
    return data;
  } catch (e) { console.error('startCowatchSession:', e); return null; }
}

async function getActiveCowatchSession(conversationId: string): Promise<CowatchSession | null> {
  try {
    const { data } = await supabase.from('cowatch_sessions').select('*')
      .eq('conversation_id', conversationId).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).single();
    return data || null;
  } catch { return null; }
}

async function syncFeedIndex(sessionId: string, postIndex: number, isPlaying: boolean, position: number) {
  try {
    await supabase.from('cowatch_sessions')
      .update({ current_post_index: postIndex, is_playing: isPlaying, current_position: position })
      .eq('id', sessionId);
  } catch (e) { console.error('syncFeedIndex:', e); }
}

async function endCowatchSession(sessionId: string) {
  try {
    await supabase.from('cowatch_sessions')
      .update({ is_active: false, ended_at: new Date().toISOString() }).eq('id', sessionId);
  } catch (e) { console.error('endCowatchSession:', e); }
}

function subscribeCowatchSession(sessionId: string, onSync: (s: CowatchSession) => void): RealtimeChannel {
  return supabase.channel(`cowatch:${sessionId}`)
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public',
      table: 'cowatch_sessions', filter: `id=eq.${sessionId}`,
    }, (payload) => onSync(payload.new as CowatchSession))
    .subscribe();
}

async function fetchFeedPosts(feedType: 'index' | 'video', page = 0, currentUserId?: string): Promise<FeedPost[]> {
  try {
    const PAGE_SIZE = 30;
    // ✅ KEY FIX: fetch posts with select('*') then join likes separately
    // This matches index.tsx and videos.tsx exactly, making liked_by state
    // consistent across all three screens from the same Supabase source of truth
    let postsQuery = supabase.from('posts').select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (feedType === 'video') {
      postsQuery = postsQuery.eq('media_type', 'video');
    } else {
      postsQuery = postsQuery.or('media_type.is.null,media_type.eq.text,media_type.eq.image,media_type.eq.voice');
    }
    const { data: postsData, error } = await postsQuery;
    if (error) { console.warn('fetchFeedPosts error:', error.message); return []; }
    if (!postsData || postsData.length === 0) return [];
    const postIds = postsData.map((p: any) => p.id);
    const userIds = [...new Set(postsData.map((p: any) => p.user_id))];
    // Parallel fetch — identical pattern to index.tsx and videos.tsx
    const [usersResult, likesResult, commentsResult] = await Promise.all([
      supabase.from('users').select('id, username, display_name, avatar_url').in('id', userIds),
      supabase.from('likes').select('post_id, user_id').in('post_id', postIds),
      supabase.from('comments').select('post_id').in('post_id', postIds).is('parent_comment_id', null),
    ]);
    const usersMap = new Map<string, any>();
    usersResult.data?.forEach((u: any) => usersMap.set(u.id, u));
    // liked_by built from likes table — same source as index/videos
    const likesMap = new Map<string, { count: number; users: string[] }>();
    likesResult.data?.forEach((like: any) => {
      const ex = likesMap.get(like.post_id) || { count: 0, users: [] };
      ex.count++; ex.users.push(like.user_id); likesMap.set(like.post_id, ex);
    });
    const commentsMap = new Map<string, number>();
    commentsResult.data?.forEach((c: any) => { commentsMap.set(c.post_id, (commentsMap.get(c.post_id) || 0) + 1); });
    return postsData.map((p: any) => {
      const profile = usersMap.get(p.user_id);
      const likes   = likesMap.get(p.id) || { count: 0, users: [] };
      return {
        id: p.id, user_id: p.user_id,
        caption: p.caption || '', media_url: p.media_url,
        media_type: p.media_type || 'text', thumbnail_url: p.thumbnail_url || null,
        liked_by: likes.users, saved_by: p.saved_by || [],
        likes_count: likes.count, comments_count: commentsMap.get(p.id) ?? 0,
        coins_received: p.coins_received ?? 0, views_count: p.views_count ?? 0,
        created_at: p.created_at,
        music_url: p.music_url || null, music_name: p.music_name || null,
        music_artist: p.music_artist || null, voice_duration: p.voice_duration || null,
        // video-specific fields
        video_effect: p.video_effect || 'none', video_filter_tint: p.video_filter_tint || null,
        playback_rate: p.playback_rate || null, is_immerse: p.is_immerse ?? false,
        haptic_pattern: p.haptic_pattern ?? null, spatial_audio: p.spatial_audio ?? null,
        vibe_type: p.vibe_type ?? null, location: p.location || null,
        display_name: profile?.display_name || profile?.username || 'LumVibe User',
        username: profile?.username || 'user', avatar_url: profile?.avatar_url,
        // ✅ liked_by_me from real likes table — consistent with index.tsx and videos.tsx
        liked_by_me: currentUserId ? likes.users.includes(currentUserId) : false,
      };
    });
  } catch (e) { console.error('fetchFeedPosts exception:', e); return []; }
}

async function fetchPostComments(postId: string): Promise<Comment[]> {
  try {
    const { data } = await supabase.from('comments')
      .select(`id, user_id, text, created_at, parent_comment_id,
        likes_count, liked_by,
        users:user_id ( display_name, username, avatar_url )`)
      .eq('post_id', postId)
      .order('created_at', { ascending: true }).limit(50);
    return (data || []).map((c: any) => {
      const profile = Array.isArray(c.users) ? c.users[0] : c.users;
      return {
        id: c.id,
        user_id: c.user_id,
        content: c.text || '',
        created_at: c.created_at,
        parent_comment_id: c.parent_comment_id || null,
        likes_count: c.likes_count || 0,
        liked_by: c.liked_by || [],
        display_name: profile?.display_name || profile?.username || 'User',
        avatar_url: profile?.avatar_url,
      };
    });
  } catch (e) { console.error('fetchPostComments:', e); return []; }
}

// NOTE: toggleLikePost removed — handleLike in CowatchScreen writes directly
// to the `likes` table (same source of truth as index.tsx and videos.tsx).
// Writing to posts.liked_by array is no longer used anywhere.

async function postComment(postId: string, userId: string, content: string, parentCommentId?: string | null) {
  try {
    const { error } = await supabase.from('comments').insert({
      post_id: postId,
      user_id: userId,
      text: content,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    });
    if (error) throw error;

    const { data: postRow } = await supabase
      .from('posts').select('comments_count, user_id').eq('id', postId).single();
    if (postRow) {
      await supabase.from('posts')
        .update({ comments_count: (postRow.comments_count || 0) + 1 })
        .eq('id', postId);
      if (postRow.user_id && postRow.user_id !== userId) {
        const multipliers = await getOwnerBadgeMultipliers(postRow.user_id);
        const { data: ownerData } = await supabase
          .from('users').select('points').eq('id', postRow.user_id).single();
        if (ownerData) {
          await supabase.from('users')
            .update({ points: (ownerData.points || 0) + multipliers.commentPoints })
            .eq('id', postRow.user_id);
        }
      }
    }
  } catch (e) { console.error('postComment error:', e); }
}

async function trackView(postId: string, userId: string) {
  try {
    const { error } = await supabase.rpc('increment_views', { p_post_id: postId });
    if (error) {
      // Fallback: manual increment if RPC doesn't exist yet
      const { data: postRow } = await supabase.from('posts').select('views_count').eq('id', postId).single();
      if (postRow) {
        await supabase.from('posts').update({ views_count: (postRow.views_count || 0) + 1 }).eq('id', postId);
      }
    }
    const { data: postData } = await supabase.from('posts').select('user_id').eq('id', postId).single();
    if (postData?.user_id && postData.user_id !== userId) {
      const multipliers = await getOwnerBadgeMultipliers(postData.user_id);
      const { data: ownerData } = await supabase.from('users').select('points').eq('id', postData.user_id).single();
      if (ownerData) {
        await supabase.from('users')
          .update({ points: (ownerData.points || 0) + multipliers.viewPoints })
          .eq('id', postData.user_id);
      }
    }
  } catch (_) {}
}

async function sendGiftToPost(
  post: FeedPost, senderUserId: string, senderUsername: string,
  giftPackage: typeof GIFT_PACKAGES[0],
): Promise<{ success: boolean; message?: string }> {
  try {
    const { data: freshSender } = await supabase.from('users').select('coins').eq('id', senderUserId).single();
    if ((freshSender?.coins || 0) < giftPackage.coins) return { success: false, message: 'insufficient_coins' };

    await supabase.from('users').update({ coins: (freshSender?.coins || 0) - giftPackage.coins }).eq('id', senderUserId);
    await supabase.rpc('increment_coins', { target_user_id: post.user_id, coin_amount: giftPackage.coins });

    const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', post.id).single();
    await supabase.from('posts')
      .update({ coins_received: (freshPost?.coins_received || 0) + giftPackage.coins })
      .eq('id', post.id);

    await supabase.from('transactions').insert([
      { user_id: senderUserId, type: 'spent', amount: giftPackage.coins, description: `Sent ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins) to @${post.username} via Co-Watch`, status: 'completed' },
      { user_id: post.user_id, type: 'received', amount: giftPackage.coins, description: `Received ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins) from @${senderUsername} via Co-Watch`, status: 'completed' },
    ]);
    await supabase.from('notifications').insert({
      user_id: post.user_id, type: 'gift', title: 'New Gift 🎁',
      message: `@${senderUsername} sent you ${giftPackage.name} ${giftPackage.icon} (${giftPackage.coins} coins) on your post`,
      from_user_id: senderUserId, post_id: post.id, is_read: false,
    });

    const multipliers = await getOwnerBadgeMultipliers(post.user_id);
    const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
    if (ownerData) {
      await supabase.from('users')
        .update({ points: (ownerData.points || 0) + Math.min(giftPackage.coins * 2, 500) })
        .eq('id', post.user_id);
    }

    return { success: true };
  } catch (e) { console.error('sendGiftToPost error:', e); return { success: false, message: 'error' }; }
}

async function sendCustomGift(
  post: FeedPost, senderUserId: string, senderUsername: string, coins: number,
): Promise<{ success: boolean; message?: string }> {
  try {
    const { data: freshSender } = await supabase.from('users').select('coins').eq('id', senderUserId).single();
    if ((freshSender?.coins || 0) < coins) return { success: false, message: 'insufficient_coins' };

    await supabase.from('users').update({ coins: (freshSender?.coins || 0) - coins }).eq('id', senderUserId);
    await supabase.rpc('increment_coins', { target_user_id: post.user_id, coin_amount: coins });

    const { data: freshPost } = await supabase.from('posts').select('coins_received').eq('id', post.id).single();
    await supabase.from('posts').update({ coins_received: (freshPost?.coins_received || 0) + coins }).eq('id', post.id);

    await supabase.from('transactions').insert([
      { user_id: senderUserId, type: 'spent', amount: coins, description: `Custom gift (${coins} coins = ${coinsToNGN(coins)}) to @${post.username} via Co-Watch`, status: 'completed' },
      { user_id: post.user_id, type: 'received', amount: coins, description: `Custom gift (${coins} coins = ${coinsToNGN(coins)}) from @${senderUsername} via Co-Watch`, status: 'completed' },
    ]);
    await supabase.from('notifications').insert({
      user_id: post.user_id, type: 'gift', title: 'New Gift 🎁',
      message: `@${senderUsername} sent you a custom gift (${coins} coins) on your post`,
      from_user_id: senderUserId, post_id: post.id, is_read: false,
    });
    return { success: true };
  } catch (e) { return { success: false, message: 'error' }; }
}

async function sendChatMessage(conversationId: string, senderId: string, content: string) {
  try {
    await supabase.from('messages').insert({
      conversation_id: conversationId, sender_id: senderId,
      message_type: 'text', content, is_disappearing: false,
    });
  } catch (e) { console.error('sendChatMessage:', e); }
}

// ─────────────────────────────────────────────────────────────
// PiP OVERLAY (partner) — top-right — FIX 4: uses LiveKit VideoView
// ─────────────────────────────────────────────────────────────
const PIP_W = 88; const PIP_H = 118;
const PIP_OFFSET_TOP = Platform.OS === 'ios' ? 130 : 110;

// FIX 4: PipOverlay now uses LiveKit VideoView for remote participant
function PipOverlay({ photo, name, isActive, remoteVideoTrack, micMuted, camMuted, onToggleMic, onToggleCam, callReady }: {
  photo?: string; name: string; isActive: boolean;
  remoteVideoTrack: any;
  micMuted: boolean; camMuted: boolean;
  onToggleMic: () => void; onToggleCam: () => void;
  callReady: boolean;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    if (isActive) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])).start();
    } else { pulse.setValue(1); }
  }, [isActive]);

  return (
    <Animated.View style={[pipStyles.pip, { transform: [{ scale: pulse }] }]}>
      <TouchableOpacity style={pipStyles.pipTouchable} onPress={() => setShowControls(s => !s)} activeOpacity={0.9}>
        {remoteVideoTrack && callReady ? (
          // FIX 4: LiveKit VideoView renders remote participant video
          <VideoView
            style={pipStyles.pipVideo}
            videoTrack={remoteVideoTrack}
            mirror={false}
          />
        ) : (
          <View style={pipStyles.pipPlaceholder}><Avatar uri={photo} name={name} size={PIP_W} /></View>
        )}
        <View style={[pipStyles.pipRing, isActive && pipStyles.pipRingActive]} />
        <View style={pipStyles.pipNameTag}>
          <Text style={pipStyles.pipNameText} numberOfLines={1}>{name.split(' ')[0]}</Text>
        </View>
        {isActive && <View style={pipStyles.pipLiveDot} />}
      </TouchableOpacity>
      {showControls && (
        <View style={pipStyles.pipControls}>
          <TouchableOpacity style={pipStyles.pipCtrlBtn} onPress={onToggleMic}>
            <Ionicons name={micMuted ? 'mic-off' : 'mic-outline'} size={13} color={micMuted ? C.red : C.green} />
          </TouchableOpacity>
          <TouchableOpacity style={pipStyles.pipCtrlBtn} onPress={onToggleCam}>
            <Ionicons name={camMuted ? 'videocam-off' : 'videocam-outline'} size={13} color={camMuted ? C.red : C.green} />
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}

// FIX 4: LocalPreview now uses LiveKit VideoView for local camera
function LocalPreview({ localVideoTrack, photo, yourName, permDenied }: {
  localVideoTrack: any; photo?: string; yourName: string; permDenied?: boolean;
}) {
  return (
    <View style={pipStyles.localPip}>
      {permDenied ? (
        <View style={[pipStyles.pipPlaceholder, { backgroundColor: '#1a0a0a' }]}>
          <Ionicons name="videocam-off" size={22} color={C.red} />
          <Text style={{ color: C.red, fontSize: 7, marginTop: 3, textAlign: 'center' }}>Allow{'\n'}Camera</Text>
        </View>
      ) : localVideoTrack ? (
        <VideoView
          style={pipStyles.pipVideo}
          videoTrack={localVideoTrack}
          mirror={true}
        />
      ) : (
        <Avatar uri={photo} name={yourName} size={PIP_W} />
      )}
      <View style={pipStyles.pipNameTag}><Text style={pipStyles.pipNameText}>You</Text></View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// CALL CONTROLS — left side
// ─────────────────────────────────────────────────────────────
function CallControls({ micMuted, camMuted, speakerOn, onToggleMic, onToggleCam, onToggleSpeaker, onEndCall }: {
  micMuted: boolean; camMuted: boolean; speakerOn: boolean;
  onToggleMic: () => void; onToggleCam: () => void;
  onToggleSpeaker: () => void; onEndCall: () => void;
}) {
  return (
    <View style={callCtrlStyles.bar}>
      <TouchableOpacity style={[callCtrlStyles.btn, micMuted && callCtrlStyles.btnMuted]} onPress={onToggleMic}>
        <Ionicons name={micMuted ? 'mic-off' : 'mic-outline'} size={18} color={C.white} />
      </TouchableOpacity>
      <TouchableOpacity style={[callCtrlStyles.btn, camMuted && callCtrlStyles.btnMuted]} onPress={onToggleCam}>
        <Ionicons name={camMuted ? 'videocam-off' : 'videocam-outline'} size={18} color={C.white} />
      </TouchableOpacity>
      <TouchableOpacity style={[callCtrlStyles.btn, !speakerOn && callCtrlStyles.btnMuted]} onPress={onToggleSpeaker}>
        <Ionicons name={speakerOn ? 'volume-high-outline' : 'volume-mute-outline'} size={18} color={C.white} />
      </TouchableOpacity>
      <TouchableOpacity style={callCtrlStyles.endBtn} onPress={onEndCall}>
        <Ionicons name="call" size={18} color={C.white} />
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// FEED SELECTOR
// ─────────────────────────────────────────────────────────────
function FeedSelector({ activeFeed, onSelect }: { activeFeed: 'index' | 'video'; onSelect: (f: 'index' | 'video') => void }) {
  return (
    <View style={selectorStyles.row}>
      <TouchableOpacity style={[selectorStyles.tab, activeFeed === 'index' && selectorStyles.tabActive]} onPress={() => onSelect('index')}>
        <Ionicons name="home-outline" size={15} color={activeFeed === 'index' ? '#000' : C.muted} />
        <Text style={[selectorStyles.tabText, activeFeed === 'index' && selectorStyles.tabTextActive]}>Feed</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[selectorStyles.tab, activeFeed === 'video' && selectorStyles.tabActive]} onPress={() => onSelect('video')}>
        <Ionicons name="videocam-outline" size={15} color={activeFeed === 'video' ? '#000' : C.muted} />
        <Text style={[selectorStyles.tabText, activeFeed === 'video' && selectorStyles.tabTextActive]}>Videos</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// VIDEO EFFECTS MAP — identical to videos.tsx
// ─────────────────────────────────────────────────────────────
const VIDEO_EFFECTS: Record<string, { label: string; tint?: string; badge?: string; badgeColor?: string; rate?: number }> = {
  none:      { label: 'Normal' },
  slow_025:  { label: '0.25x Slow',  badge: '🐌 0.25x',      badgeColor: '#00bfff', rate: 0.25 },
  slow_05:   { label: '0.5x Slow',   badge: '🐢 0.5x',       badgeColor: '#00bfff', rate: 0.5  },
  fast_15:   { label: '1.5x Fast',   badge: '⚡ 1.5x',       badgeColor: '#ffd700', rate: 1.5  },
  fast_2:    { label: '2x Fast',     badge: '🚀 2x',         badgeColor: '#ff4444', rate: 2.0  },
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

const VIBE_TYPES_CARD: Record<string, { label: string; emoji: string; color: string }> = {
  fire:     { label: 'Fire',       emoji: '🔥', color: '#ff4500' },
  funny:    { label: 'Funny',      emoji: '😂', color: '#ffd700' },
  shocking: { label: 'Shocking',   emoji: '😱', color: '#ff6b35' },
  love:     { label: 'Love',       emoji: '❤️', color: '#ff1744' },
  mindblow: { label: 'Mind-blown', emoji: '🤯', color: '#aa00ff' },
  dead:     { label: 'Dead 💀',    emoji: '💀', color: '#00e5ff' },
  hype:     { label: 'Hype',       emoji: '🚀', color: '#00ff88' },
  sad:      { label: 'Sad',        emoji: '😢', color: '#448aff' },
};

const IMMERSE_HAPTIC_ENGINES: Record<string, () => ReturnType<typeof setInterval>> = {
  wave: () => {
    let step = 0;
    const pattern = [Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium, Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Medium];
    return setInterval(async () => { await Haptics.impactAsync(pattern[step % pattern.length]); step++; }, 350);
  },
  pulse: () => {
    let step = 0;
    const beats = [Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Light];
    return setInterval(async () => { await Haptics.impactAsync(beats[step % beats.length]); step++; }, 280);
  },
  beat: () => {
    let step = 0;
    const pattern = [Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Heavy, Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Light];
    return setInterval(async () => { await Haptics.impactAsync(pattern[step % pattern.length]); step++; }, 180);
  },
  energy: () => setInterval(async () => { await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); }, 80),
};

// ─────────────────────────────────────────────────────────────
// VIDEO SEEK BAR — identical to videos.tsx
// ─────────────────────────────────────────────────────────────
function CowatchSeekBar({ positionMs, durationMs, onSeek, isVisible, isImmerse }: {
  positionMs: number; durationMs: number; onSeek: (ms: number) => void;
  isVisible: boolean; isImmerse?: boolean;
}) {
  const BAR_PADDING = 16;
  const BAR_WIDTH   = SW - BAR_PADDING * 2;
  const THUMB_HALF  = 8;
  const [dragging,     setDragging]     = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const barOriginX = useRef(BAR_PADDING);
  const barRef     = useRef<View>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const pageXToProgress = (pageX: number) => { const x = clamp(pageX - barOriginX.current, 0, BAR_WIDTH); return x / BAR_WIDTH; };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
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
  const fillColor   = isImmerse ? '#00cfff' : C.green;
  return (
    <View style={[seekBarStyles.container, isImmerse && seekBarStyles.containerImmerse]}>
      <View style={seekBarStyles.timeRow}>
        <Text style={[seekBarStyles.timeText, isImmerse && seekBarStyles.timeTextImmerse]}>{formatTime(positionMs)}</Text>
        <Text style={[seekBarStyles.timeText, isImmerse && seekBarStyles.timeTextImmerse]}>-{formatTime(remainingMs)}</Text>
      </View>
      <View ref={barRef} style={seekBarStyles.barHitArea}
        onLayout={() => { barRef.current?.measureInWindow((x: number) => { barOriginX.current = x; }); }}
        {...panResponder.panHandlers}
      >
        <View style={seekBarStyles.track} />
        <View style={[seekBarStyles.fill, { width: clamp(displayProg * BAR_WIDTH, 0, BAR_WIDTH), backgroundColor: fillColor }]} />
        <View style={[seekBarStyles.thumb, { left: clamp(thumbLeft, -THUMB_HALF, BAR_WIDTH - THUMB_HALF), backgroundColor: isImmerse ? '#00cfff' : '#fff' }]} />
      </View>
    </View>
  );
}

const seekBarStyles = StyleSheet.create({
  container:        { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 14, paddingTop: 6, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 20 },
  containerImmerse: { backgroundColor: 'rgba(0,20,40,0.55)', borderTopWidth: 1, borderTopColor: 'rgba(0,207,255,0.2)' },
  timeRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  timeText:  { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '600' },
  timeTextImmerse: { color: 'rgba(0,207,255,0.9)' },
  barHitArea:{ height: 28, justifyContent: 'center' },
  track:     { position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2 },
  fill:      { position: 'absolute', left: 0, height: 3, borderRadius: 2 },
  thumb:     { position: 'absolute', width: 16, height: 16, borderRadius: 8, top: 6, elevation: 5 },
});

// ─────────────────────────────────────────────────────────────
// END SCREEN STYLES — shown after video finishes
// ─────────────────────────────────────────────────────────────
const endScreenStyles = StyleSheet.create({
  overlay:       { ...StyleSheet.absoluteFillObject, zIndex: 30, alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 24 },
  bg:            { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.82)' },
  watermarkBlock:{ alignItems: 'center', gap: 4 },
  watermarkIcon: { width: 48, height: 48, borderRadius: 24 },
  watermarkTitle:{ color: C.green, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  watermarkSub:  { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  statsRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 20, gap: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  statItem:      { alignItems: 'center', flex: 1, gap: 4 },
  statValue:     { color: C.white, fontSize: 15, fontWeight: '800' },
  statLabel:     { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600' },
  statDivider:   { width: 1, height: 36, backgroundColor: 'rgba(255,255,255,0.15)' },
  creatorRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', width: '100%' },
  creatorAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.green },
  avatarFallback:{ backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  creatorName:   { color: C.white, fontSize: 14, fontWeight: '700' },
  creatorUsername:{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  followBtn:     { backgroundColor: C.green, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20 },
  followingBtn:  { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.green },
  followBtnText: { color: '#000', fontSize: 13, fontWeight: '800' },
  followingBtnText:{ color: C.green },
  deleteBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(229,57,53,0.12)', borderWidth: 1, borderColor: C.red, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12 },
  deleteBtnText: { color: C.red, fontSize: 12, fontWeight: '700' },
  replayBtn:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.green, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30 },
  replayBtnText: { color: '#000', fontSize: 15, fontWeight: '800' },
});

// ─────────────────────────────────────────────────────────────
// FEED POST CARD — full videos.tsx parity
// ✅ Animated moving watermark (4 corners like videos.tsx)
// ✅ Long-press to save video to device
// ✅ End screen after video finishes (LumVibe logo, stats, replay, follow)
// ✅ Seek bar (drag to scrub)
// ✅ Filter tint overlay
// ✅ Vibe badge
// ✅ Immerse mode (glow border, haptics, spatial audio arrows)
// ✅ Effect badge (slow motion, speed)
// ✅ Mute button on right actions
// ✅ Owner delete button
// ✅ Voice post player + waveform (from audio system)
// ✅ Music background indicator
// ✅ "Watching Together" badge preserved
// ─────────────────────────────────────────────────────────────
const FeedPostCard = memo(function FeedPostCard({
  post, isCurrent, userId, isOwnPost,
  onLike, onComment, onGift, onShare, onView, onDelete, itemHeight,
  syncedIsPlaying, onSyncPlayPause,
}: {
  post: FeedPost; isCurrent: boolean; userId: string; isOwnPost: boolean;
  onLike: (post: FeedPost) => void;
  onComment: (post: FeedPost) => void;
  onGift: (post: FeedPost) => void;
  onShare: (post: FeedPost) => void;
  onView: (postId: string) => void;
  onDelete: (post: FeedPost) => void;
  itemHeight: number;
  syncedIsPlaying?: boolean;   // ✅ play/pause sync from CoWatch partner
  onSyncPlayPause?: (playing: boolean) => void; // ✅ bubble play/pause up to CoWatch
}) {
  const videoRef  = useRef<any>(null);
  const soundRef  = useRef<AudioPlayer | null>(null);
  const likeAnim  = useRef(new Animated.Value(1)).current;
  const viewedRef = useRef(false);

  // ✅ Respond to partner play/pause sync — react-native-video uses paused prop
  useEffect(() => {
    if (!isCurrent || syncedIsPlaying === undefined) return;
    setIsPlaying(syncedIsPlaying);
  }, [syncedIsPlaying, isCurrent]);

  // Animated watermark — moves to 4 corners like videos.tsx
  const wmX       = useRef(new Animated.Value(16)).current;
  const wmY       = useRef(new Animated.Value(SH * 0.55)).current;
  const wmOpacity = useRef(new Animated.Value(0.85)).current;

  // Immerse glow + pulse
  const immerseGlow    = useRef(new Animated.Value(0)).current;
  const immersePulse   = useRef(new Animated.Value(1)).current;
  const immerseGlowRef = useRef<Animated.CompositeAnimation | null>(null);

  // Haptic interval
  const hapticRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isPlaying,    setIsPlaying]    = useState(false);
  const [isMuted,      setIsMuted]      = useState(false);
  const [positionMs,   setPositionMs]   = useState(0);
  const [durationMs,   setDurationMs]   = useState(0);
  const [showEndScreen,setShowEndScreen] = useState(false);
  const [shouldLoad,   setShouldLoad]   = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [voiceProgress,setVoiceProgress] = useState(0);

  const waveformHeights = useMemo(
    () => Array.from({ length: 40 }, () => Math.random() * 30 + 10),
    [post.id]
  );

  const isImmerse    = !!(post.is_immerse);
  const effectKey    = post.video_effect || 'none';
  const effectInfo   = VIDEO_EFFECTS[effectKey] || VIDEO_EFFECTS['none'];
  const tintColor    = post.video_filter_tint || effectInfo.tint || null;
  const playbackRate = post.playback_rate ?? effectInfo.rate ?? 1.0;
  const effectBadge  = effectInfo.badge || null;
  const effectBadgeColor = effectInfo.badgeColor || '#fff';
  const isTextOrVoice = post.media_type === 'voice' || post.media_type === 'text' || !post.media_url;

  const fmtCount = (n: number) => (n ?? 0) > 999 ? `${((n ?? 0) / 1000).toFixed(1)}k` : String(n ?? 0);
  const formatDuration = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

  // ── Animated watermark — 4 corner rotation like videos.tsx ──
  useEffect(() => {
    if (!post.media_url) return;
    const W = SW - 160;
    const positions = [
      { x: 16,  y: SH * 0.55 },  // bottom-left
      { x: W,   y: SH * 0.55 },  // bottom-right
      { x: 16,  y: 80 },          // top-left
      { x: W,   y: 80 },          // top-right
    ];
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
  }, [post.id]);

  // ── Immerse glow ──
  const startImmerseGlow = useCallback(() => {
    if (immerseGlowRef.current) return;
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(immerseGlow, { toValue: 1, duration: 900, useNativeDriver: false }),
      Animated.timing(immerseGlow, { toValue: 0.25, duration: 900, useNativeDriver: false }),
    ]));
    immerseGlowRef.current = anim; anim.start();
    Animated.loop(Animated.sequence([
      Animated.timing(immersePulse, { toValue: 1.04, duration: 900, useNativeDriver: true }),
      Animated.timing(immersePulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    ])).start();
  }, []);
  const stopImmerseGlow = useCallback(() => {
    if (immerseGlowRef.current) { immerseGlowRef.current.stop(); immerseGlowRef.current = null; }
    immerseGlow.setValue(0); immersePulse.setValue(1);
  }, []);

  // ── Haptics ──
  const startHaptics = useCallback(() => {
    if (!isImmerse || hapticRef.current || isMuted) return;
    const pattern = post.haptic_pattern || 'wave';
    const engine  = IMMERSE_HAPTIC_ENGINES[pattern] || IMMERSE_HAPTIC_ENGINES['wave'];
    hapticRef.current = engine();
  }, [isImmerse, isMuted, post.haptic_pattern]);
  const stopHaptics = useCallback(() => {
    if (hapticRef.current) { clearInterval(hapticRef.current); hapticRef.current = null; }
  }, []);

  // ── Video active/inactive — react-native-video uses paused prop ──
  useEffect(() => {
    if (post.media_type !== 'video') return;
    if (isCurrent) {
      setShouldLoad(true);
      if (!viewedRef.current) { viewedRef.current = true; onView(post.id); }
      const t = setTimeout(() => {
        setIsPlaying(true);
        if (isImmerse) { startImmerseGlow(); startHaptics(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
      }, 80);
      return () => clearTimeout(t);
    } else {
      setIsPlaying(false);
      setShowEndScreen(false);
      if (isImmerse) { stopImmerseGlow(); stopHaptics(); }
    }
  }, [isCurrent]);

  // ── Non-video view tracking ──
  useEffect(() => {
    if (isCurrent && !viewedRef.current && post.media_type !== 'video') {
      viewedRef.current = true; onView(post.id);
    }
  }, [isCurrent]);

  // Cleanup on unmount
  useEffect(() => () => { stopHaptics(); stopImmerseGlow(); }, []);

  // ── Audio auto-play — matches index.tsx v3.5 exactly ──
  // Voice posts auto-play when isCurrent (same as index.tsx ≥50% visible rule).
  // Background music loops quietly at 0.7 volume on image/text posts.
  // User can tap the play button to pause/resume at any time.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (isCurrent && post.media_type !== 'video') {
        // Pick the correct URI and loop flag — mirrors index.tsx auto-play logic
        const isVoice = post.media_type === 'voice';
        const audioUri = isVoice && post.media_url && isRemoteUrl(post.media_url)
          ? post.media_url
          : (!isVoice && post.music_url && isRemoteUrl(post.music_url))
            ? post.music_url
            : null;
        const loop = !isVoice;
        if (audioUri && !cancelled) await startAudio(audioUri, loop, () => cancelled);
      } else if (!isCurrent) {
        cancelled = true;
        if (soundRef.current) {
          try { soundRef.current.pause(); soundRef.current.remove(); } catch (_) {}
          soundRef.current = null;
        }
        if (globalAudioManager.currentPostId === post.id) {
          globalAudioManager.currentPlayer = null; globalAudioManager.currentPostId = null;
        }
        setAudioPlaying(false); setVoiceProgress(0);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (soundRef.current) { try { soundRef.current.pause(); soundRef.current.remove(); } catch (_) {} soundRef.current = null; }
      if (globalAudioManager.currentPostId === post.id) { globalAudioManager.currentPlayer = null; globalAudioManager.currentPostId = null; }
    };
  }, [isCurrent, post.id]);

  const startAudio = async (uri: string, loop: boolean, isCancelled: () => boolean) => {
    if (!uri || (!isRemoteUrl(uri) && !uri.startsWith('file://'))) return;
    try {
      if (soundRef.current) { try { soundRef.current.pause(); soundRef.current.remove(); } catch (_) {} soundRef.current = null; }
      await globalAudioManager.stopCurrent();
      if (isCancelled()) return;
      await AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'duckOthers' });
      if (isCancelled()) return;
      // ✅ Matches index.tsx intent, translated to expo-audio:
      // overrideFileExtensionAndroid — Android needs extension hint for Cloudinary URLs
      // player.play() right after creation — starts on first bytes, mirrors shouldPlay:true
      // shouldCorrectPitch:false — avoids blocking DSP setup on older Android devices
      // 250ms update interval — smooth waveform progress on slow networks
      const isCloudinaryUrl = uri.includes('cloudinary.com');
      const sourceObj = isCloudinaryUrl ? { uri, overrideFileExtensionAndroid: 'm4a' } : { uri };
      const player = createAudioPlayer(sourceObj,{updateInterval: 250});
      player.loop = loop;
      player.volume = loop ? 0.7 : 1.0;
      player.shouldCorrectPitch = false;

      if (isCancelled()) { try { player.remove(); } catch (_) {} return; }
      soundRef.current = player; globalAudioManager.currentPlayer = player; globalAudioManager.currentPostId = post.id;
      if (!loop) {
        player.addListener('playbackStatusUpdate', (status: any) => {
          if (status.isLoaded) {
            if (status.duration && status.currentTime) setVoiceProgress(status.currentTime / status.duration);
            if (status.didJustFinish) { setAudioPlaying(false); setVoiceProgress(0); }
          }
        });
      }
      player.play();
      // Sound already playing — just update UI state
      if (!isCancelled()) setAudioPlaying(true);
    } catch (e) { console.warn('[LumVibe CoWatch] startAudio failed:', e); setAudioPlaying(false); }
  };

  // ── Toggle handlers — match index.tsx robust 3-state logic ──
  const toggleVoicePlayback = async () => {
    if (!post.media_url || !isRemoteUrl(post.media_url)) return;
    if (soundRef.current) {
      try {
        if (soundRef.current.isLoaded) {
          if (audioPlaying) { soundRef.current.pause(); setAudioPlaying(false); }
          else              { soundRef.current.play();  setAudioPlaying(true);  }
          return;
        }
        try { soundRef.current.remove(); } catch (_) {}
        soundRef.current = null;
        if (globalAudioManager.currentPostId === post.id) { globalAudioManager.currentPlayer = null; globalAudioManager.currentPostId = null; }
      } catch (_) { try { soundRef.current?.remove(); } catch (_) {} soundRef.current = null; }
    }
    await startAudio(post.media_url, false, () => false);
  };

  const toggleMusicPlayback = async () => {
    if (!post.music_url || !isRemoteUrl(post.music_url)) return;
    if (soundRef.current) {
      try {
        if (soundRef.current.isLoaded) {
          if (audioPlaying) { soundRef.current.pause(); setAudioPlaying(false); }
          else              { soundRef.current.play();  setAudioPlaying(true);  }
          return;
        }
        try { soundRef.current.remove(); } catch (_) {}
        soundRef.current = null;
        if (globalAudioManager.currentPostId === post.id) { globalAudioManager.currentPlayer = null; globalAudioManager.currentPostId = null; }
      } catch (_) { try { soundRef.current?.remove(); } catch (_) {} soundRef.current = null; }
    }
    await startAudio(post.music_url, true, () => false);
  };

  // ── Video playback handlers ──
  // react-native-video callbacks are inline on the component (onProgress, onEnd, onLoad)
  // No separate status update handler needed

  const handleSeek = useCallback((ms: number) => {
    if (!videoRef.current) return;
    try {
      // react-native-video uses seconds, not milliseconds
      videoRef.current.seek(ms / 1000);
      setPositionMs(ms);
    } catch (_) {}
  }, []);

  const togglePlay = () => {
    const next = !isPlaying;
    setIsPlaying(next);
    if (isImmerse) { next ? startHaptics() : stopHaptics(); }
    onSyncPlayPause?.(next);
  };

  const toggleMuteVideo = () => setIsMuted(v => !v);

  const handleLikeTap = () => {
    Animated.sequence([
      Animated.timing(likeAnim, { toValue: 1.35, duration: 130, useNativeDriver: true }),
      Animated.timing(likeAnim, { toValue: 1, duration: 130, useNativeDriver: true }),
    ]).start();
    onLike(post);
  };

  // ── Long-press to save video (identical to videos.tsx) ──
  const handleLongPress = async () => {
    if (post.media_type !== 'video' || !post.media_url) return;
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Please allow media library access to save videos.'); return; }
      Alert.alert('Saving…', 'Downloading video to your device.');
      const localUri = FileSystem.cacheDirectory + `cowatch_video_${post.id}.mp4`;
      const { uri } = await FileSystem.downloadAsync(post.media_url, localUri);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved!', 'Video saved to your gallery.');
    } catch (e) { Alert.alert('Error', 'Could not save video.'); }
  };

  const isLiked = (post.liked_by || []).includes(userId);

  return (
    <View style={[cardStyles.card, { width: SW, height: itemHeight }]}>

      {/* ── Immerse border glow ── */}
      {isImmerse && isCurrent && (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { borderWidth: 3, zIndex: 2, borderColor: immerseGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0,207,255,0.15)', 'rgba(0,207,255,0.7)'] }) }]} />
      )}

      {/* ── Video — FIX 3: react-native-video (same as videos.tsx) ── */}
      {post.media_type === 'video' && post.media_url ? (
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={togglePlay} onLongPress={handleLongPress} delayLongPress={500} activeOpacity={0.9}>
          {shouldLoad ? (
            <RNVideo
              ref={videoRef}
              source={{ uri: post.media_url }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
              repeat={false}
              muted={isMuted}
              paused={!isPlaying}
              rate={playbackRate}
              onProgress={({ currentTime, seekableDuration }) => {
                setPositionMs(currentTime * 1000);
                if (seekableDuration) setDurationMs(seekableDuration * 1000);
              }}
              onEnd={() => { setIsPlaying(false); setShowEndScreen(true); }}
              onLoad={({ duration }) => { if (duration) setDurationMs(duration * 1000); }}
              ignoreSilentSwitch="ignore"
              playInBackground={false}
              playWhenInactive={false}
            />
          ) : (
            <View style={{ flex: 1, backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color={C.green} />
            </View>
          )}
          {/* Filter tint */}
          {tintColor && (<View style={[StyleSheet.absoluteFillObject, { backgroundColor: tintColor }]} pointerEvents="none" />)}
          {/* Immerse vignette */}
          {isImmerse && isCurrent && (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: '#00cfff', opacity: immerseGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.12] }) }]} />
          )}
          {/* Play overlay */}
          {!isPlaying && (
            <View style={[cardStyles.pauseIconWrap]}>
              <View style={[cardStyles.pauseIconBg, isImmerse && { borderColor: '#00cfff', borderWidth: 2 }]}>
                <Ionicons name="play" size={36} color={isImmerse ? '#00cfff' : C.green} />
              </View>
            </View>
          )}
        </TouchableOpacity>
      ) : null}

      {/* ── Image ── */}
      {post.media_type === 'image' && post.media_url ? (
        <Image source={{ uri: post.media_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}

      {/* ── Voice post player ── */}
      {post.media_type === 'voice' && post.media_url ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          {post.avatar_url
            ? <Image source={{ uri: post.avatar_url }} style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} resizeMode="cover" />
            : <LinearGradient colors={['#1a3a2a', '#0d1f16']} style={StyleSheet.absoluteFill} />}
          <LinearGradient colors={['transparent', 'rgba(0,0,0,0.85)']} style={[StyleSheet.absoluteFill, { top: '50%' }]} pointerEvents="none" />
          <View style={cardStyles.voicePlayerWrap}>
            <View style={cardStyles.voiceProgressTrack}>
              <View style={[cardStyles.voiceProgressFill, { width: `${voiceProgress * 100}%` }]} />
            </View>
            <View style={cardStyles.voiceControlsRow}>
              <Text style={cardStyles.voiceTimeText}>{post.voice_duration ? formatDuration(post.voice_duration * voiceProgress) : '0:00'}</Text>
              <TouchableOpacity style={cardStyles.voicePlayButton} onPress={toggleVoicePlayback} activeOpacity={0.8}>
                <Ionicons name={audioPlaying ? 'pause' : 'play'} size={22} color="#000" />
              </TouchableOpacity>
              <Text style={cardStyles.voiceTimeText}>{post.voice_duration ? formatDuration(post.voice_duration) : '0:00'}</Text>
            </View>
            <View style={cardStyles.voiceWaveform}>
              {waveformHeights.map((h, i) => (
                <View key={i} style={[cardStyles.voiceWaveformBar, { height: h * 0.7, backgroundColor: i / 40 < voiceProgress ? C.green : '#333' }]} />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* ── Text post ── */}
      {isTextOrVoice && post.media_type !== 'voice' ? (
        <View style={StyleSheet.absoluteFill}>
          {(post.thumbnail_url || post.media_url) && (
            <Image source={{ uri: post.thumbnail_url || post.media_url }} style={[StyleSheet.absoluteFill, { opacity: 0.3 }]} resizeMode="cover" />
          )}
          <View style={cardStyles.textPostOverlay}>
            <Text style={cardStyles.textPostContent} numberOfLines={8}>{post.caption || ''}</Text>
          </View>
        </View>
      ) : null}

      {/* ── Gradient scrim ── */}
      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.75)']} style={[StyleSheet.absoluteFill, { top: '50%' }]} pointerEvents="none" />

      {/* ── Animated moving watermark — identical to videos.tsx ── */}
      <Animated.View pointerEvents="none" style={[cardStyles.watermarkAnimated, { transform: [{ translateX: wmX }, { translateY: wmY }], opacity: wmOpacity }]}>
        <Image source={require('../../assets/images/adaptive-icon.png')} style={cardStyles.watermarkLogo} resizeMode="contain" />
        <View>
          <Text style={cardStyles.watermarkText}>LumVibe</Text>
          <Text style={cardStyles.watermarkUsername}>@{post.username}</Text>
        </View>
      </Animated.View>

      {/* ── Vibe badge ── */}
      {post.vibe_type && VIBE_TYPES_CARD[post.vibe_type] && (
        <View pointerEvents="none" style={[cardStyles.vibeBadge, { backgroundColor: VIBE_TYPES_CARD[post.vibe_type].color + '22', borderColor: VIBE_TYPES_CARD[post.vibe_type].color }]}>
          <Text style={cardStyles.vibeBadgeEmoji}>{VIBE_TYPES_CARD[post.vibe_type].emoji}</Text>
          <Text style={[cardStyles.vibeBadgeText, { color: VIBE_TYPES_CARD[post.vibe_type].color }]}>{VIBE_TYPES_CARD[post.vibe_type].label.toUpperCase()}</Text>
        </View>
      )}

      {/* ── Effect badge ── */}
      {effectBadge && (
        <View style={[cardStyles.effectBadge, { backgroundColor: `${effectBadgeColor}22`, borderColor: effectBadgeColor }]}>
          <Text style={[cardStyles.effectBadgeText, { color: effectBadgeColor }]}>{effectBadge}</Text>
        </View>
      )}

      {/* ── Immerse badge ── */}
      {isImmerse && (
        <Animated.View pointerEvents="none" style={[cardStyles.immerseBadge, { transform: isCurrent ? [{ scale: immersePulse }] : [{ scale: 1 }] }]}>
          <MaterialCommunityIcons name="waves" size={11} color="#000" />
          <Text style={cardStyles.immerseBadgeText}>IMMERSE</Text>
        </Animated.View>
      )}

      {/* ── Spatial audio arrows ── */}
      {isImmerse && isCurrent && post.spatial_audio && !isMuted && (
        <>
          <View style={cardStyles.spatialLeft}><Text style={cardStyles.spatialArrow}>◀</Text><Text style={cardStyles.spatialLabel}>3D</Text></View>
          <View style={cardStyles.spatialRight}><Text style={cardStyles.spatialArrow}>▶</Text><Text style={cardStyles.spatialLabel}>3D</Text></View>
        </>
      )}

      {/* ── Owner delete button ── */}
      {isOwnPost && (
        <TouchableOpacity style={cardStyles.ownerDeleteBtn} onPress={() =>
          Alert.alert('Delete Post', 'Permanently delete this post?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => onDelete(post) },
          ])
        } activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={18} color="#ff4444" />
        </TouchableOpacity>
      )}

      {/* ── Author row (bottom-left) ── */}
      <View style={cardStyles.authorRow}>
        <Avatar uri={post.avatar_url} name={post.display_name} size={40} borderColor={C.green} />
        <View style={{ flex: 1 }}>
          <Text style={cardStyles.authorName}>{post.display_name}</Text>
          <Text style={cardStyles.authorHandle}>@{post.username}</Text>
          {post.caption && !isTextOrVoice ? (
            <Text style={cardStyles.captionText} numberOfLines={2}>{post.caption}</Text>
          ) : null}
        </View>
      </View>

      {/* ── Music indicator ── */}
      {post.music_name && post.media_type !== 'voice' && (
        <TouchableOpacity style={cardStyles.musicContainer} onPress={toggleMusicPlayback} activeOpacity={0.7}>
          <Ionicons name={audioPlaying ? 'volume-high-outline' : 'musical-notes-outline'} size={12} color={C.green} />
          <Text style={cardStyles.musicText}>{post.music_name}{post.music_artist ? ` - ${post.music_artist}` : ''}{audioPlaying ? ' • Playing' : ' • Tap to play'}</Text>
        </TouchableOpacity>
      )}

      {/* ── Action buttons — right side ── */}
      <View style={cardStyles.actionsCol}>
        <TouchableOpacity style={cardStyles.actionBtn} onPress={handleLikeTap}>
          <Animated.View style={{ transform: [{ scale: likeAnim }] }}>
            <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={28} color={isLiked ? C.red : C.white} />
          </Animated.View>
          <Text style={cardStyles.actionCount}>{fmtCount(post.likes_count)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={cardStyles.actionBtn} onPress={() => onComment(post)}>
          <Ionicons name="chatbubble-outline" size={28} color={C.white} />
          <Text style={cardStyles.actionCount}>{fmtCount(post.comments_count)}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={cardStyles.actionBtn} onPress={() => onGift(post)}>
          <Ionicons name="gift-outline" size={28} color={C.gold} />
          <Text style={[cardStyles.actionCount, { color: C.gold }]}>{post.coins_received > 0 ? fmtCount(post.coins_received) : 'Gift'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={cardStyles.actionBtn} onPress={() => onShare(post)}>
          <Ionicons name="share-outline" size={26} color={C.white} />
          <Text style={cardStyles.actionCount}>Share</Text>
        </TouchableOpacity>

        {/* ── Mute button (video only) ── */}
        {post.media_type === 'video' && (
          <TouchableOpacity style={cardStyles.actionBtn} onPress={toggleMuteVideo}>
            <Ionicons name={isMuted ? 'volume-mute-outline' : 'volume-high-outline'} size={26} color={isImmerse && !isMuted ? '#00cfff' : C.white} />
            {isImmerse && !isMuted && <Text style={[cardStyles.actionCount, { color: '#00cfff', fontSize: 9 }]}>3D</Text>}
          </TouchableOpacity>
        )}

        {post.views_count > 0 && (
          <View style={cardStyles.viewsOverlay}>
            <Ionicons name="eye-outline" size={14} color={C.white} />
            <Text style={cardStyles.viewsText}>{fmtCount(post.views_count)}</Text>
          </View>
        )}
      </View>

      {/* ── Seek bar (video only) ── */}
      {post.media_type === 'video' && (
        <CowatchSeekBar
          positionMs={positionMs} durationMs={durationMs}
          onSeek={handleSeek}
          isVisible={isCurrent && durationMs > 0}
          isImmerse={isImmerse}
        />
      )}

      {/* ── "Watching Together" badge ── */}
      {isCurrent && (
        <View style={cardStyles.watchingBadge}>
          <View style={cardStyles.watchingDot} />
          <Text style={cardStyles.watchingBadgeText}>Watching Together</Text>
        </View>
      )}

      {/* ── End screen — after video finishes ── */}
      {showEndScreen && isCurrent && post.media_type === 'video' && (
        <View style={endScreenStyles.overlay}>
          <View style={endScreenStyles.bg} />
          <View style={endScreenStyles.watermarkBlock} pointerEvents="none">
            <MaterialCommunityIcons name="shield-check" size={40} color={C.green} />
            <Text style={endScreenStyles.watermarkTitle}>LumVibe</Text>
            <Text style={endScreenStyles.watermarkSub}>lumvibe.site</Text>
          </View>
          <View style={endScreenStyles.statsRow}>
            <View style={endScreenStyles.statItem}>
              <Ionicons name="heart" size={18} color={C.green} />
              <Text style={endScreenStyles.statValue}>{post.likes_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Likes</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <Ionicons name="chatbubble-outline" size={18} color={C.green} />
              <Text style={endScreenStyles.statValue}>{post.comments_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Comments</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <Ionicons name="gift-outline" size={18} color={C.gold} />
              <Text style={[endScreenStyles.statValue, { color: C.gold }]}>{post.coins_received > 0 ? post.coins_received.toFixed(0) : '0'}</Text>
              <Text style={endScreenStyles.statLabel}>Gifts</Text>
            </View>
            <View style={endScreenStyles.statDivider} />
            <View style={endScreenStyles.statItem}>
              <Ionicons name="eye-outline" size={18} color={C.green} />
              <Text style={endScreenStyles.statValue}>{post.views_count.toLocaleString()}</Text>
              <Text style={endScreenStyles.statLabel}>Views</Text>
            </View>
          </View>
          <View style={endScreenStyles.creatorRow}>
            {post.avatar_url
              ? <Image source={{ uri: post.avatar_url }} style={endScreenStyles.creatorAvatar} />
              : <View style={[endScreenStyles.creatorAvatar, endScreenStyles.avatarFallback]}><Ionicons name="person-outline" size={18} color={C.green} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={endScreenStyles.creatorName}>{post.display_name}</Text>
              <Text style={endScreenStyles.creatorUsername}>@{post.username}</Text>
            </View>
            {isOwnPost ? (
              <TouchableOpacity style={endScreenStyles.deleteBtn} onPress={() => { setShowEndScreen(false); onDelete(post); }} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={14} color={C.red} />
                <Text style={endScreenStyles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity style={endScreenStyles.replayBtn} activeOpacity={0.85} onPress={() => {
            setShowEndScreen(false); setPositionMs(0);
            try {
              // FIX: react-native-video's ref only has seek() — rate is already
              // bound via the `rate` prop above, and `paused={!isPlaying}` resumes
              // playback once isPlaying is set true. No expo-av Video methods needed.
              videoRef.current?.seek(0);
              setIsPlaying(true);
            } catch (_) {}
          }}>
            <Ionicons name="refresh-outline" size={22} color="#000" />
            <Text style={endScreenStyles.replayBtnText}>Replay</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// COMMENT SHEET — with reply support
// ─────────────────────────────────────────────────────────────
function CommentSheet({ visible, postId, userId, onClose }: {
  visible: boolean; postId: string; userId: string; onClose: () => void;
}) {
  const [comments, setComments]     = useState<Comment[]>([]);
  const [text, setText]             = useState('');
  const [loading, setLoading]       = useState(false);
  const [sending, setSending]       = useState(false);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const flatRef = useRef<FlatList>(null);

  useEffect(() => {
    if (visible && postId) {
      setLoading(true);
      fetchPostComments(postId).then(c => { setComments(c); setLoading(false); });
    } else {
      setReplyingTo(null); setText('');
    }
  }, [visible, postId]);

  const submit = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    await postComment(postId, userId, t, replyingTo?.id || null);
    setText(''); setReplyingTo(null);
    const fresh = await fetchPostComments(postId);
    setComments(fresh); setSending(false);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const topLevel  = comments.filter(c => !c.parent_comment_id);
  const replies   = (parentId: string) => comments.filter(c => c.parent_comment_id === parentId);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={sheetStyles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} activeOpacity={1} />
        <View style={sheetStyles.sheet}>
          <View style={sheetStyles.handle} />
          <Text style={[sheetStyles.sheetTitle, { paddingHorizontal: 16, marginBottom: 12 }]}>Comments</Text>
          {loading ? (
            <ActivityIndicator color={C.green} style={{ marginVertical: 20 }} />
          ) : (
            <FlatList
              ref={flatRef}
              data={topLevel}
              keyExtractor={c => c.id}
              style={{ maxHeight: SH * 0.38 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}
              ListEmptyComponent={<Text style={sheetStyles.emptyText}>No comments yet. Be first!</Text>}
              renderItem={({ item }) => (
                <View>
                  <TouchableOpacity style={sheetStyles.commentRow} onPress={() => setReplyingTo(item)} activeOpacity={0.8}>
                    <Avatar uri={item.avatar_url} name={item.display_name} size={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={sheetStyles.commentName}>{item.display_name}</Text>
                      <Text style={sheetStyles.commentText}>{item.content}</Text>
                      <TouchableOpacity onPress={() => setReplyingTo(item)}>
                        <Text style={sheetStyles.replyLink}>Reply</Text>
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                  {replies(item.id).map(reply => (
                    <View key={reply.id} style={[sheetStyles.commentRow, { marginLeft: 44, marginTop: 8 }]}>
                      <Avatar uri={reply.avatar_url} name={reply.display_name} size={26} />
                      <View style={{ flex: 1 }}>
                        <Text style={sheetStyles.commentName}>{reply.display_name}</Text>
                        <Text style={sheetStyles.commentText}>{reply.content}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            />
          )}
          {replyingTo && (
            <View style={sheetStyles.replyingBar}>
              <Text style={sheetStyles.replyingText}>Replying to {replyingTo.display_name}</Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)}>
                <Ionicons name="close" size={16} color={C.muted} />
              </TouchableOpacity>
            </View>
          )}
          <View style={sheetStyles.commentInputRow}>
            <TextInput
              style={sheetStyles.commentInput}
              placeholder={replyingTo ? `Reply to ${replyingTo.display_name}…` : 'Add a comment…'}
              placeholderTextColor={C.muted2}
              value={text} onChangeText={setText}
              onSubmitEditing={submit} returnKeyType="send"
              editable={!sending}
            />
            <TouchableOpacity
              style={[sheetStyles.commentSendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
              onPress={submit} disabled={!text.trim() || sending}
            >
              {sending ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="send" size={16} color="#000" />}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// GIFT SHEET — local currency, custom amount, coin balance
// ─────────────────────────────────────────────────────────────
function GiftSheet({ visible, post, userId, userProfile, onClose, onGiftSent }: {
  visible: boolean; post: FeedPost | null; userId: string; userProfile: any;
  onClose: () => void; onGiftSent: (postId: string, coins: number) => void;
}) {
  // FIX: standalone component — needs its own navigation reference.
  const navigation = useNavigation<any>();
  const [sending, setSending]             = useState(false);
  const [customMode, setCustomMode]       = useState(false);
  const [customAmount, setCustomAmount]   = useState('');
  const userCoins = userProfile?.coins || 0;

  const handlePackageGift = async (gift: typeof GIFT_PACKAGES[0]) => {
    if (!post) return;
    if (gift.coins > userCoins) {
      Alert.alert('💰 Insufficient Coins',
        `You need ${gift.coins} coins but only have ${userCoins} coins.\n\nTop up your wallet to send this gift.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Buy Coins →', onPress: () => { onClose(); setTimeout(() => navigation.navigate('BuyCoins'), 300); } },
        ],
      );
      return;
    }
    setSending(true);
    const result = await sendGiftToPost(post, userId, userProfile?.username || 'user', gift);
    setSending(false);
    if (result.success) {
      onGiftSent(post.id, gift.coins);
      onClose();
      Alert.alert(`${gift.icon} ${gift.name} Sent!`, `You sent ${gift.name} (${gift.coins} coins = ${coinsToNGN(gift.coins)}) to @${post.username}!`);
    } else if (result.message === 'insufficient_coins') {
      Alert.alert('Insufficient Coins', 'Balance changed. Please try again.');
    } else { Alert.alert('Error', 'Failed to send gift. Please try again.'); }
  };

  const handleCustomGift = async () => {
    if (!post || !customAmount.trim()) return;
    const coins = parseFloat(customAmount);
    if (isNaN(coins) || coins < 10)  { Alert.alert('Invalid Amount', 'Minimum is 10 coins (₦1,500)'); return; }
    if (coins > 5000)                { Alert.alert('Invalid Amount', 'Maximum is 5,000 coins per gift'); return; }
    if (coins > userCoins)           { Alert.alert('Insufficient Coins', `You only have ${userCoins} coins.`); return; }
    setSending(true);
    const result = await sendCustomGift(post, userId, userProfile?.username || 'user', coins);
    setSending(false);
    if (result.success) {
      onGiftSent(post.id, coins);
      setCustomAmount(''); setCustomMode(false); onClose();
      Alert.alert('🎁 Gift Sent!', `You sent ${coins} coins (${coinsToNGN(coins)}) to @${post.username}!`);
    } else { Alert.alert('Error', 'Failed to send gift. Please try again.'); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={sheetStyles.backdrop} onPress={onClose} activeOpacity={1}>
        <View style={sheetStyles.giftSheet} onStartShouldSetResponder={() => true}>
          <View style={sheetStyles.handle} />
          <View style={sheetStyles.giftHeader}>
            <Text style={sheetStyles.sheetTitle}>Send a Gift to @{post?.username}</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={22} color={C.muted} />
            </TouchableOpacity>
          </View>

          <View style={sheetStyles.balanceRow}>
            <Text style={{ fontSize: 18 }}>🪙</Text>
            <Text style={sheetStyles.balanceText}>{userCoins.toLocaleString()} coins available</Text>
            <TouchableOpacity style={sheetStyles.topUpBtn} onPress={() => { onClose(); setTimeout(() => navigation.navigate('BuyCoins'), 300); }}>
              <Text style={sheetStyles.topUpBtnText}>+ Top Up</Text>
            </TouchableOpacity>
          </View>

          {sending ? (
            <View style={{ alignItems: 'center', padding: 40 }}>
              <ActivityIndicator color={C.green} size="large" />
              <Text style={{ color: C.muted, marginTop: 12 }}>Sending gift…</Text>
            </View>
          ) : customMode ? (
            <View style={sheetStyles.customGiftContainer}>
              <Text style={sheetStyles.customGiftLabel}>Enter custom coin amount (min 10, max 5,000)</Text>
              <TextInput
                style={sheetStyles.customGiftInput}
                placeholder="e.g. 250"
                placeholderTextColor={C.muted2}
                keyboardType="numeric"
                value={customAmount}
                onChangeText={setCustomAmount}
              />
              {customAmount.trim() && !isNaN(parseFloat(customAmount)) && (
                <Text style={sheetStyles.customGiftPreview}>
                  = {coinsToNGN(parseFloat(customAmount))} · {giftLocalPrice(parseFloat(customAmount) * COIN_TO_NGN)}
                </Text>
              )}
              <View style={sheetStyles.customGiftActions}>
                <TouchableOpacity style={[sheetStyles.customGiftBtn, { borderColor: C.border }]} onPress={() => { setCustomMode(false); setCustomAmount(''); }}>
                  <Text style={{ color: C.white, fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[sheetStyles.customGiftBtn, { backgroundColor: C.green }]} onPress={handleCustomGift} disabled={!customAmount.trim()}>
                  <Text style={{ color: '#000', fontWeight: '700' }}>Send Gift</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView contentContainerStyle={sheetStyles.giftGrid} showsVerticalScrollIndicator={false}>
              {GIFT_PACKAGES.map(g => {
                const canAfford = userCoins >= g.coins;
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[sheetStyles.giftItem, { borderColor: canAfford ? g.color + '66' : C.border }, !canAfford && { opacity: 0.45 }]}
                    onPress={() => handlePackageGift(g)} activeOpacity={0.75}
                  >
                    <Text style={{ fontSize: 32 }}>{g.icon}</Text>
                    <Text style={sheetStyles.giftName}>{g.name}</Text>
                    <View style={[sheetStyles.giftCostBadge, { borderColor: g.color + '44' }]}>
                      <Text style={[sheetStyles.giftCostText, { color: canAfford ? g.color : C.muted }]}>🪙 {g.coins.toLocaleString()}</Text>
                    </View>
                    <Text style={sheetStyles.giftNgnText}>{coinsToNGN(g.coins)}</Text>
                    <Text style={[sheetStyles.giftNgnText, { color: C.gold }]}>{giftLocalPrice(g.ngn)}</Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={sheetStyles.customGiftTrigger} onPress={() => setCustomMode(true)}>
                <Ionicons name="add-circle-outline" size={20} color={C.green} />
                <Text style={sheetStyles.customGiftTriggerText}>Custom Amount</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// FLOATING REACTIONS
// ─────────────────────────────────────────────────────────────
function FloatingReactionLayer({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' } as any]}>
      {reactions.map(r => (
        <Animated.Text key={r.id} style={[floatStyles.bubble, {
          left: r.x,
          transform: [{ translateY: r.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -260] }) }],
          opacity: r.anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.9, 0] }),
        }]}>
          {r.emoji}
        </Animated.Text>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
// MAIN SCREEN
// ─────────────────────────────────────────────────────────────
export default function CowatchScreen() {
  // FIX 1: useRoute replaces useLocalSearchParams from expo-router
  const route = useRoute<any>();
  const {
    conversationId,
    otherName,
    otherPhoto,
    sessionId: existingSessionId,
    isAiMatch,
  } = (route.params || {}) as {
    conversationId: string;
    otherName: string;
    otherPhoto: string;
    sessionId?: string;
    isAiMatch?: string;
  };

  const navigation = useNavigation<any>();
  const { user, userProfile, loadProfile } = useAuthStore();

  // FIX 16: Offline detection
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      setIsOffline(!(state.isConnected && state.isInternetReachable));
    });
    return () => unsub();
  }, []);

  // FIX 4: useLiveKitCall replaces useAgoraCall completely
  const livekitChannel = `cowatch_${conversationId}`;
  const displayName = userProfile?.display_name || userProfile?.username || 'LumVibe User';
  const {
    remoteConnected, callReady, micMuted, camMuted, speakerOn, permDenied,
    localVideoTrack, remoteVideoTrack,
    toggleMic, toggleCam, toggleSpeaker, disconnect: disconnectLiveKit,
    agoraReady, engineJoined, remoteUid,  // backward compat aliases
  } = useLiveKitCall(livekitChannel, user?.id || '', displayName);

  const feedRef           = useRef<FlatList>(null);
  // ✅ FIX: Track the actual rendered height of feedContainer.
  // Cards use height:SH (screen height) but feedContainer is shorter
  // because bottomPanel takes space at the bottom. This mismatch causes
  // FlatList to snap at SH intervals while the visible window is smaller,
  // making cards stop halfway on scroll. Using the measured layout height
  // for both card height and getItemLayout fixes the snap alignment.
  const [feedHeight, setFeedHeight] = useState(SH);
  const syncChannelRef    = useRef<RealtimeChannel | null>(null);
  const chatChannelRef    = useRef<RealtimeChannel | null>(null);
  const postsChannelRef   = useRef<RealtimeChannel | null>(null);
  const isSyncingRef      = useRef(false);
  const syncPlayingRef    = useRef(false);          // ✅ tracks partner play/pause state
  const [syncedIsPlaying, setSyncedIsPlaying] = useState(false); // ✅ triggers re-render for FeedPostCard
  const chatFlatRef       = useRef<FlatList>(null);
  const feedTypeRef       = useRef<'index' | 'video'>('video');
  const postsRef          = useRef<FeedPost[]>([]);
  const viewedPostsRef    = useRef<Set<string>>(new Set());

  const [session,           setSession]           = useState<CowatchSession | null>(null);
  const [isLoading,         setIsLoading]         = useState(true);
  const [feedLoading,       setFeedLoading]       = useState(false);
  const [refreshing,        setRefreshing]        = useState(false);
  const [feedType,          setFeedType]          = useState<'index' | 'video'>('video');
  const [feedItems,         setFeedItems]         = useState<FeedItem[]>([]);
  const [currentIndex,      setCurrentIndex]      = useState(0);
  const [messages,          setMessages]          = useState<LiveMessage[]>([]);
  const [inputText,         setInputText]         = useState('');
  const [isSendingChat,     setIsSendingChat]     = useState(false);
  const [otherUserActive,   setOtherUserActive]   = useState(false);
  const [chatExpanded,      setChatExpanded]      = useState(false);
  const [isSynced,          setIsSynced]          = useState(false);
  const [commentPost,       setCommentPost]       = useState<FeedPost | null>(null);
  const [giftPost,          setGiftPost]          = useState<FeedPost | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [page,              setPage]              = useState(0);
  const [hasMore,           setHasMore]           = useState(true);

  // ── AI MATCH state ──────────────────────────────────────────
  const [aiMatchStatus,       setAiMatchStatus]       = useState<AiMatchStatus>('idle');
  const [aiMatchVibes,        setAiMatchVibes]        = useState<string[]>([]);
  const [aiMatchQueueId,      setAiMatchQueueId]      = useState<string | null>(null);
  const [aiMatchPartnerName,  setAiMatchPartnerName]  = useState<string>('');
  const [aiMatchPartnerPhoto, setAiMatchPartnerPhoto] = useState<string | null>(null);
  const aiMatchPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiMatchMountedRef = useRef(true);

  useEffect(() => { feedTypeRef.current = feedType; }, [feedType]);

  // ✅ useFocusEffect: refresh coin balance + stop audio when leaving screen
  useFocusEffect(useCallback(() => {
    if (loadProfile) loadProfile();
    return () => {
      // ✅ ADDED: stop any playing audio when leaving cowatch screen
      globalAudioManager.stopCurrent();
    };
  }, [loadProfile]));

  useEffect(() => {
    // ✅ ADDED: Set audio mode on mount (matches index.tsx)
    AudioModule.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'duckOthers',
    }).catch((e: any) => console.error('Audio mode error:', e));

    if (isAiMatch === 'true') {
      setupAiMatchSession();
    } else {
      setupSession();
    }
    return () => {
      aiMatchMountedRef.current = false;
      if (aiMatchPollRef.current) clearInterval(aiMatchPollRef.current);
      if (syncChannelRef.current)  supabase.removeChannel(syncChannelRef.current);
      if (chatChannelRef.current)  supabase.removeChannel(chatChannelRef.current);
      if (postsChannelRef.current) supabase.removeChannel(postsChannelRef.current);
      // ✅ ADDED: stop audio on unmount
      globalAudioManager.stopCurrent();
    };
  }, []);

  useEffect(() => { loadFeed(feedType, 0, false); }, [feedType]);

  // ── Real-time incoming chat messages ──
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`chat:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const msg = payload.new as any;
          if (msg.sender_id === user?.id) return;
          const { data: profile } = await supabase.from('users').select('display_name, username, avatar_url').eq('id', msg.sender_id).single();
          const newMsg: LiveMessage = {
            id: msg.id, user_id: msg.sender_id,
            display_name: profile?.display_name || profile?.username || otherName || 'Partner',
            avatar_url: profile?.avatar_url,
            content: msg.content?.replace(/^🎬 \[Co-Watch\] /, '') || '',
            created_at: msg.created_at, isMe: false,
          };
          setMessages(prev => [...prev, newMsg]);
          setTimeout(() => chatFlatRef.current?.scrollToEnd({ animated: true }), 100);
        })
      .subscribe();
    chatChannelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user?.id, otherName]);

  // ── Real-time post updates (likes, coins, comments) ──
  // ✅ FIX: also sync liked_by array so the heart icon state stays correct
  // when the partner (or another user) likes a post from any screen.
  // index.tsx and videos.tsx both derive isLiked from liked_by — we must
  // keep liked_by in sync here too so cowatch hearts match the other feeds.
  const subscribeToPostsUpdates = useCallback((postIds: string[]) => {
    if (postsChannelRef.current) supabase.removeChannel(postsChannelRef.current);
    if (!postIds.length) return;
    const channel = supabase.channel(`posts_realtime_cowatch`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'posts' },
        async (payload) => {
          const updated = payload.new as any;
          if (!postIds.includes(updated.id)) return;
          // Re-fetch liked_by from the likes table (same source as index/videos)
          // so the heart state is always consistent across all screens.
          const { data: likesData } = await supabase
            .from('likes').select('user_id').eq('post_id', updated.id);
          const likedBy = likesData?.map((l: any) => l.user_id) || [];
          setFeedItems(prev => prev.map(item => {
            if (isAd(item) || item.id !== updated.id) return item;
            return {
              ...item,
              likes_count:    updated.likes_count    ?? (item as FeedPost).likes_count,
              coins_received: updated.coins_received ?? (item as FeedPost).coins_received,
              comments_count: updated.comments_count ?? (item as FeedPost).comments_count,
              // ✅ Keep liked_by in sync — this is what drives the heart colour
              liked_by: likedBy,
              liked_by_me: user?.id ? likedBy.includes(user.id) : (item as FeedPost).liked_by_me,
            };
          }));
        })
      .subscribe();
    postsChannelRef.current = channel;
  }, [user?.id]);

  const injectAds = useCallback((posts: FeedPost[]): FeedItem[] => {
    const items: FeedItem[] = [];
    let adCounter = 0;
    posts.forEach((post, index) => {
      items.push(post);
      if ((index + 1) % 8 === 0) {
        items.push({ id: `ad_${adCounter}`, isAd: true, adIndex: adCounter });
        adCounter++;
      }
    });
    return items;
  }, []);

  const loadFeed = async (type: 'index' | 'video', pageNum = 0, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else if (pageNum === 0) setFeedLoading(true);

    const data = await fetchFeedPosts(type, pageNum, user?.id);
    const withLiked = data; // liked_by_me already set correctly inside fetchFeedPosts using likes table

    if (pageNum === 0) {
      const items = injectAds(withLiked);
      setFeedItems(items);
      postsRef.current = withLiked;
      setCurrentIndex(0);
      setPage(0);
      subscribeToPostsUpdates(withLiked.map(p => p.id));
    } else {
      setFeedItems(prev => {
        const existingPosts = prev.filter(i => !isAd(i)) as FeedPost[];
        const combined = [...existingPosts, ...withLiked];
        return injectAds(combined);
      });
      postsRef.current = [...postsRef.current, ...withLiked];
    }

    setHasMore(data.length === 30);
    if (isRefresh) setRefreshing(false);
    else setFeedLoading(false);
  };

  const handleLoadMore = useCallback(() => {
    if (!hasMore || feedLoading || refreshing) return;
    const nextPage = page + 1;
    setPage(nextPage);
    loadFeed(feedType, nextPage, false);
  }, [hasMore, feedLoading, refreshing, page, feedType]);

  const handleRefresh = useCallback(() => {
    loadFeed(feedType, 0, true);
  }, [feedType]);

  // ─────────────────────────────────────────────────────────────
  // AI MATCH — full setup flow
  // Called instead of setupSession when isAiMatch === 'true'
  // ─────────────────────────────────────────────────────────────
  const setupAiMatchSession = async () => {
    if (!user?.id) return;
    try {
      const vibes = await getUserTopVibes(user.id);
      setAiMatchVibes(vibes);
      setAiMatchStatus('searching');

      const queueId = await joinAiMatchQueue(user.id, vibes);
      if (!queueId || !aiMatchMountedRef.current) return;
      setAiMatchQueueId(queueId);

      let attempts = 0;
      const MAX_ATTEMPTS = 90; // 90 × 2s = 3 minutes

      aiMatchPollRef.current = setInterval(async () => {
        if (!aiMatchMountedRef.current) {
          clearInterval(aiMatchPollRef.current!);
          return;
        }

        attempts++;

        // Every other attempt, actively try to match (safe — RLS allows own writes)
        if (attempts % 2 === 0) {
          const result = await attemptAiMatch(queueId, user.id, vibes);
          if (result.matched && result.sessionId && aiMatchMountedRef.current) {
            clearInterval(aiMatchPollRef.current!);
            setAiMatchStatus('matched');
            setAiMatchPartnerName(result.partnerName || 'Vibe Match');
            setAiMatchPartnerPhoto(result.partnerPhoto);
            setTimeout(async () => {
              if (!aiMatchMountedRef.current) return;
              const activeSession = await getActiveCowatchSession(result.sessionId!);
              if (!activeSession) { setIsLoading(false); return; }
              setSession(activeSession);
              setFeedType('video'); feedTypeRef.current = 'video';
              setIsLoading(false);
              syncChannelRef.current = subscribeCowatchSession(activeSession.id, handleRemoteSync);
              addSystemMessage(`🎯 AI matched you with ${result.partnerName}! Watch party started 🎬`);
            }, 1500);
            return;
          }
        }

        // Also check if partner matched us first
        const row = await pollAiMatchQueue(queueId);
        if (!row || !aiMatchMountedRef.current) return;

        if (row.status === 'matched' && row.session_id && row.matched_with) {
          clearInterval(aiMatchPollRef.current!);
          setAiMatchStatus('matched');

          const { data: partnerProfile } = await supabase
            .from('users')
            .select('display_name, username, avatar_url')
            .eq('id', row.matched_with)
            .single();

          const pName = partnerProfile?.display_name || partnerProfile?.username || 'Vibe Match';
          const pPhoto = partnerProfile?.avatar_url || null;
          setAiMatchPartnerName(pName);
          setAiMatchPartnerPhoto(pPhoto);

          setTimeout(async () => {
            if (!aiMatchMountedRef.current) return;
            const activeSession = await getActiveCowatchSession(row.session_id!);
            if (!activeSession) { setIsLoading(false); return; }
            setSession(activeSession);
            setFeedType('video'); feedTypeRef.current = 'video';
            setIsLoading(false);
            syncChannelRef.current = subscribeCowatchSession(activeSession.id, handleRemoteSync);
            addSystemMessage(`🎯 AI matched you with ${pName}! Watch party started 🎬`);
          }, 1500);
          return;
        }

        if (row.status === 'expired' || attempts >= MAX_ATTEMPTS) {
          clearInterval(aiMatchPollRef.current!);
          setAiMatchStatus('expired');
          setIsLoading(false);
        }
      }, 2000);
    } catch (e) {
      console.error('setupAiMatchSession error:', e);
      setAiMatchStatus('expired');
      setIsLoading(false);
    }
  };

  const setupSession = async () => {
    if (!user?.id || (!conversationId && isAiMatch !== 'true')) return;
    try {
      let activeSession: CowatchSession | null = null;
      if (existingSessionId) {
        activeSession = await getActiveCowatchSession(conversationId);
        setOtherUserActive(true);
      } else {
        activeSession = await startCowatchSession(conversationId, user.id, feedType);
      }
      if (!activeSession) { Alert.alert('Error', 'Could not start co-watch session.'); navigation.goBack(); return; }
      setSession(activeSession);
      if (activeSession.feed_type) { setFeedType(activeSession.feed_type); feedTypeRef.current = activeSession.feed_type; }
      if (activeSession.current_post_index) setCurrentIndex(activeSession.current_post_index);
      setIsLoading(false);
      syncChannelRef.current = subscribeCowatchSession(activeSession.id, handleRemoteSync);
      addSystemMessage(`Watch party started with ${otherName} 🎬`);

      if (!existingSessionId && conversationId) {
        try {
          const { data: convoData } = await supabase.from('conversations').select('user1_id, user2_id').eq('id', conversationId).single();
          if (convoData) {
            const inviteeId = convoData.user1_id === user.id ? convoData.user2_id : convoData.user1_id;
            if (inviteeId) await notifyCowatchInvite(inviteeId, user.id, userProfile?.display_name || userProfile?.username || 'Someone', conversationId, activeSession.id);
          }
        } catch (notifyErr) { console.warn('notifyCowatchInvite failed:', notifyErr); }
      }
    } catch (e) { console.error('setupSession error:', e); setIsLoading(false); }
  };

  const handleRemoteSync = useCallback((updatedSession: CowatchSession) => {
    if (isSyncingRef.current) return;
    setOtherUserActive(true);

    // ✅ FIXED: sync scroll index to partner's position
    const newIndex = updatedSession.current_post_index ?? 0;
    setCurrentIndex(prev => {
      if (prev !== newIndex && newIndex >= 0 && newIndex < postsRef.current.length) {
        feedRef.current?.scrollToIndex({ index: newIndex, animated: true });
        return newIndex;
      }
      return prev;
    });

    // ✅ FIXED: sync play/pause state from partner
    // is_playing comes from DB — we store in ref so FeedPostCard can read it
    if (typeof updatedSession.is_playing === 'boolean') {
      syncPlayingRef.current = updatedSession.is_playing;
      setSyncedIsPlaying(updatedSession.is_playing);
    }

    if (updatedSession.feed_type && updatedSession.feed_type !== feedTypeRef.current) {
      setFeedType(updatedSession.feed_type);
      feedTypeRef.current = updatedSession.feed_type;
    }
    setIsSynced(true);
    setTimeout(() => setIsSynced(false), 2000);
  }, []);

  // ── View tracking via viewability ──
  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: any[] }) => {
    viewableItems.forEach(({ item }: { item: FeedItem }) => {
      if (isAd(item)) return;
      const post = item as FeedPost;
      if (!viewedPostsRef.current.has(post.id) && user?.id) {
        viewedPostsRef.current.add(post.id);
        trackView(post.id, user.id);
      }
    });
  }, [user?.id]);

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 70 }), []);

  const handleLike = useCallback(async (post: FeedPost) => {
    if (!user) return;
    // ✅ KEY FIX: read liked_by from the post object (now sourced from likes table)
    const wasLiked = (post.liked_by || []).includes(user.id);

    // Optimistic update
    setFeedItems(prev => prev.map(item => {
      if (isAd(item) || item.id !== post.id) return item;
      const p = item as FeedPost;
      return {
        ...p,
        liked_by_me: !wasLiked,
        liked_by: wasLiked
          ? (p.liked_by || []).filter(id => id !== user.id)
          : [...(p.liked_by || []), user.id],
        likes_count: wasLiked
          ? Math.max(0, p.likes_count - 1)
          : p.likes_count + 1,
      };
    }));

    try {
      if (wasLiked) {
        // ✅ Delete from likes table — same as index.tsx and videos.tsx
        const { error } = await supabase.from('likes').delete()
          .eq('post_id', post.id).eq('user_id', user.id);
        if (error) throw error;
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) {
          const multipliers = await getOwnerBadgeMultipliers(post.user_id);
          await supabase.from('users').update({ points: Math.max(0, (ownerData.points || 0) - multipliers.likePoints) }).eq('id', post.user_id);
        }
      } else {
        // ✅ Insert into likes table — same as index.tsx and videos.tsx
        const { error } = await supabase.from('likes').insert({ post_id: post.id, user_id: user.id });
        if (error) throw error;
        const { data: ownerData } = await supabase.from('users').select('points').eq('id', post.user_id).single();
        if (ownerData) {
          const multipliers = await getOwnerBadgeMultipliers(post.user_id);
          await supabase.from('users').update({ points: (ownerData.points || 0) + multipliers.likePoints }).eq('id', post.user_id);
        }
        if (post.user_id !== user.id) {
          await supabase.from('notifications').insert({
            user_id: post.user_id, type: 'like', title: 'New Like',
            message: `@${userProfile?.username || 'Someone'} liked your post`,
            from_user_id: user.id, post_id: post.id, is_read: false,
          });
        }
      }
    } catch (e) {
      console.error('handleLike error in cowatch:', e);
      // Revert optimistic update on failure
      loadFeed(feedType, 0, false);
    }
  }, [user, userProfile, feedType]);

  const handleShare = useCallback(async (post: FeedPost) => {
    try {
      const deepLink = `https://lumvibe.site/post/${post.id}`;
      await Share.share({ message: `Check out this post by @${post.username} on LumVibe!\n\n${post.caption || ''}\n\n${deepLink}`, title: `Post by @${post.username}` });
    } catch (e) { console.error('Share error:', e); }
  }, []);

  const handleDeletePost = useCallback(async (post: FeedPost) => {
    if (!user?.id || post.user_id !== user.id) return;
    try {
      await supabase.from("posts").delete().eq("id", post.id).eq("user_id", user.id);
      setFeedItems(prev => prev.filter(item => item.id !== post.id));
    } catch (e) { Alert.alert("Error", "Could not delete post."); }
  }, [user?.id]);

  const handleFeedTypeChange = useCallback(async (newType: 'index' | 'video') => {
    if (!session) return;
    // ✅ ADDED: stop audio when switching feed type
    globalAudioManager.stopCurrent();
    setFeedType(newType); feedTypeRef.current = newType; setCurrentIndex(0);
    isSyncingRef.current = true;
    await supabase.from('cowatch_sessions').update({ feed_type: newType, current_post_index: 0 }).eq('id', session.id);
    setTimeout(() => { isSyncingRef.current = false; }, 600);
  }, [session]);

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), user_id: 'system', display_name: 'System', content: text, created_at: new Date().toISOString(), isMe: false }]);
  };

  const sendLiveMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !user || isSendingChat) return;
    setIsSendingChat(true);
    setMessages(prev => [...prev, {
      id: `local_${Date.now()}`, user_id: user.id,
      display_name: userProfile?.display_name || userProfile?.username || 'You',
      avatar_url: userProfile?.avatar_url,
      content: text, created_at: new Date().toISOString(), isMe: true,
    }]);
    setInputText('');
    if (conversationId) await sendChatMessage(conversationId, user.id, `🎬 [Co-Watch] ${text}`);
    setIsSendingChat(false);
    setTimeout(() => chatFlatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [inputText, user, conversationId, userProfile, isSendingChat]);

  const sendReaction = useCallback((emoji: string) => {
    if (!user) return;
    setMessages(prev => [...prev, { id: `react_${Date.now()}`, user_id: user.id, display_name: userProfile?.display_name || 'You', content: emoji, created_at: new Date().toISOString(), isMe: true }]);
    const id = `float_${Date.now()}_${Math.random()}`;
    const anim = new Animated.Value(0);
    const x = SW * 0.3 + Math.random() * SW * 0.4;
    setFloatingReactions(prev => [...prev, { id, emoji, anim, x }]);
    Animated.timing(anim, { toValue: 1, duration: 1800, useNativeDriver: true })
      .start(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)));
    setTimeout(() => chatFlatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [user, userProfile]);

  const handleGiftSent = useCallback((postId: string, coins: number) => {
    setFeedItems(prev => prev.map(item => {
      if (isAd(item) || item.id !== postId) return item;
      return { ...item, coins_received: (item as FeedPost).coins_received + coins };
    }));
    if (loadProfile) loadProfile();
  }, [loadProfile]);

  const handleOnView = useCallback((postId: string) => {
    if (!user?.id || viewedPostsRef.current.has(postId)) return;
    viewedPostsRef.current.add(postId);
    trackView(postId, user.id);
  }, [user?.id]);

  const endCowatch = useCallback(async () => {
    globalAudioManager.stopCurrent();
    // FIX 11: Disconnect LiveKit room before leaving screen
    await disconnectLiveKit();
    if (session) await endCowatchSession(session.id);
    navigation.goBack();
  }, [session, disconnectLiveKit, navigation]);

  // ── AI Match screens (shown before isLoading resolves) ──
  if (isAiMatch === 'true' && aiMatchStatus === 'searching') {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
        <ActivityIndicator color={C.green} size="large" />
        <Text style={styles.loadingTitle}>🎯 Finding Your Vibe Match…</Text>
        <Text style={styles.loadingSubtitle}>
          Looking for someone who loves{' '}
          {aiMatchVibes.length > 0
            ? aiMatchVibes.map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(' + ')
            : 'great content'}
        </Text>
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>This takes up to 3 minutes</Text>
        <TouchableOpacity
          style={{ marginTop: 28, borderWidth: 1.5, borderColor: C.border, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 28 }}
          onPress={async () => {
            if (aiMatchPollRef.current) clearInterval(aiMatchPollRef.current);
            if (aiMatchQueueId) await cancelAiMatchQueue(aiMatchQueueId);
            setAiMatchStatus('cancelled');
            navigation.goBack();
          }}
        >
          <Text style={{ color: C.muted, fontWeight: '700' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isAiMatch === 'true' && aiMatchStatus === 'matched') {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
        {aiMatchPartnerPhoto ? (
          <Image
            source={{ uri: aiMatchPartnerPhoto }}
            style={{ width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: C.green, marginBottom: 16 }}
          />
        ) : (
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: C.greenBg, borderWidth: 3, borderColor: C.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 32 }}>🎯</Text>
          </View>
        )}
        <Text style={[styles.loadingTitle, { color: C.green }]}>Vibe Match Found! 🎉</Text>
        <Text style={styles.loadingSubtitle}>Starting watch party with {aiMatchPartnerName}…</Text>
        <ActivityIndicator color={C.green} size="small" style={{ marginTop: 16 }} />
      </View>
    );
  }

  if (isAiMatch === 'true' && aiMatchStatus === 'expired') {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
        <Text style={{ fontSize: 40, marginBottom: 16 }}>😔</Text>
        <Text style={styles.loadingTitle}>No Match Found</Text>
        <Text style={styles.loadingSubtitle}>No one with your vibe is online right now.{'\n'}Try again in a few minutes!</Text>
        <TouchableOpacity
          style={{ marginTop: 28, backgroundColor: C.green, borderRadius: 20, paddingVertical: 12, paddingHorizontal: 36 }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ color: '#000', fontWeight: '800', fontSize: 14 }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Regular loading screen ──
  if (isLoading) {
    return (
      <View style={styles.loadingScreen}>
        <StatusBar barStyle="light-content" backgroundColor="#000" translucent />
        <ActivityIndicator color={C.green} size="large" />
        <Text style={styles.loadingTitle}>Starting Watch Party</Text>
        <Text style={styles.loadingSubtitle}>Connecting with {otherName}…</Text>
      </View>
    );
  }

  const currentPost = feedItems[currentIndex];
  const currentPostIsAd = currentPost ? isAd(currentPost) : false;

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right'] as any}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* FIX 16: Offline banner */}
      {isOffline && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9999, backgroundColor: '#ff4444', paddingVertical: 6, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Feather name="wifi-off" size={13} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', flex: 1 }}>No internet — sync and video calls paused</Text>
        </View>
      )}

      {/* ── FEED — full height ── */}
      <View
        style={styles.feedContainer}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && h !== feedHeight) setFeedHeight(h);
        }}
      >
        {feedLoading && !refreshing ? (
          <View style={styles.feedLoadingWrap}>
            <ActivityIndicator color={C.green} size="large" />
            <Text style={styles.feedLoadingText}>Loading {feedType === 'video' ? 'videos' : 'posts'}…</Text>
          </View>
        ) : (
          <FlatList
            ref={feedRef}
            data={feedItems}
            keyExtractor={item => item.id}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.y / feedHeight);
              if (idx === currentIndex || !session) return;
              // ✅ ADDED: stop audio when scrolling to new post
              globalAudioManager.stopCurrent();
              setCurrentIndex(idx);
              isSyncingRef.current = true;
              syncFeedIndex(session.id, idx, false, 0).finally(() => {
                setTimeout(() => { isSyncingRef.current = false; }, 600);
              });
            }}
            getItemLayout={(_, index) => ({ length: feedHeight, offset: feedHeight * index, index })}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.4}
            onViewableItemsChanged={handleViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={C.green}
                colors={[C.green]}
              />
            }
            renderItem={({ item, index }) => {
              if (isAd(item)) return <NativeAdCard adIndex={item.adIndex} itemHeight={feedHeight} />;
              return (
                <FeedPostCard
                  post={item as FeedPost}
                  isCurrent={index === currentIndex}
                  userId={user?.id || ''}
                  isOwnPost={(item as FeedPost).user_id === user?.id}
                  syncedIsPlaying={index === currentIndex ? syncedIsPlaying : undefined}
                  onSyncPlayPause={index === currentIndex && session ? (playing: boolean) => {
                    // ✅ FIXED: user tapped play/pause — write to DB so partner syncs
                    isSyncingRef.current = true;
                    syncFeedIndex(session.id, currentIndex, playing, 0).finally(() => {
                      setTimeout(() => { isSyncingRef.current = false; }, 600);
                    });
                  } : undefined}
                  onLike={handleLike}
                  onComment={setCommentPost}
                  onGift={setGiftPost}
                  onShare={handleShare}
                  onView={handleOnView}
                  onDelete={handleDeletePost}
                  itemHeight={feedHeight}
                />
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyFeed}>
                <Text style={styles.emptyFeedText}>No posts found</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => loadFeed(feedType, 0, false)}>
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}

        <FloatingReactionLayer reactions={floatingReactions} />

        {/* Partner PiP — top right — FIX 4: LiveKit VideoView */}
        <PipOverlay
          photo={otherPhoto || undefined}
          name={otherName || 'Partner'}
          isActive={remoteConnected || callReady}
          remoteVideoTrack={remoteVideoTrack}
          micMuted={micMuted}
          camMuted={camMuted}
          onToggleMic={toggleMic}
          onToggleCam={toggleCam}
          callReady={callReady}
        />

        {/* Your PiP — top left — FIX 4: LiveKit local video */}
        <LocalPreview
          localVideoTrack={localVideoTrack}
          photo={userProfile?.avatar_url}
          yourName={userProfile?.display_name || userProfile?.username || 'You'}
          permDenied={permDenied}
        />

        {/* TOP BAR */}
        <View style={[styles.topBarWrap, { pointerEvents: 'box-none' } as any]}>
          <View style={styles.topBarRow1}>
            <TouchableOpacity style={styles.backBtn} onPress={endCowatch}>
              <Ionicons name="chevron-back" size={20} color={C.white} />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.topBarTitle}>Watch Together</Text>
              <Text style={styles.topBarSub}>with {isAiMatch === 'true' && aiMatchPartnerName ? aiMatchPartnerName : otherName}</Text>
            </View>
            {isSynced && (
              <View style={styles.syncBadge}>
                <Ionicons name="flash" size={10} color={C.green} />
                <Text style={styles.syncBadgeText}>Synced</Text>
              </View>
            )}
            <View style={styles.liveBadge}>
              <Ionicons name="radio-outline" size={9} color={C.white} />
              <Text style={styles.liveBadgeText}>LIVE</Text>
            </View>
          </View>
          <View style={styles.topBarRow2}>
            <FeedSelector activeFeed={feedType} onSelect={handleFeedTypeChange} />
            <View style={styles.postCounter}>
              <Text style={styles.postCounterText}>
                {feedItems.length > 0 ? `${currentIndex + 1} / ${feedItems.length}` : '--'}
              </Text>
            </View>
          </View>
        </View>

        {/* Call controls — left side */}
        <CallControls micMuted={micMuted} camMuted={camMuted} speakerOn={speakerOn} onToggleMic={toggleMic} onToggleCam={toggleCam} onToggleSpeaker={toggleSpeaker} onEndCall={endCowatch} />
      </View>

      {/* ── BOTTOM PANEL ── */}
      <KeyboardAvoidingView style={styles.bottomPanel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Reaction bar */}
        <View style={styles.reactionsBar}>
          {QUICK_REACTIONS.map(emoji => (
            <TouchableOpacity key={emoji} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
              <Text style={{ fontSize: 20 }}>{emoji}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.chatToggleBtn} onPress={() => setChatExpanded(e => !e)}>
            <Ionicons name={chatExpanded ? 'chevron-down' : 'chevron-up'} size={16} color={C.muted} />
          </TouchableOpacity>
        </View>

        {chatExpanded && (
          <FlatList
            ref={chatFlatRef}
            data={messages}
            keyExtractor={m => m.id}
            style={styles.chatArea}
            contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => chatFlatRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
              if (item.user_id === 'system') {
                return (
                  <View style={styles.systemMsg}>
                    <Ionicons name="radio-outline" size={11} color={C.green} />
                    <Text style={styles.systemMsgText}>{item.content}</Text>
                  </View>
                );
              }
              if (QUICK_REACTIONS.includes(item.content)) {
                return <View style={[styles.cwMsg, item.isMe && styles.cwMsgMe]}><Text style={{ fontSize: 26 }}>{item.content}</Text></View>;
              }
              return (
                <View style={[styles.cwMsg, item.isMe && styles.cwMsgMe]}>
                  {!item.isMe && <Avatar uri={item.avatar_url} name={item.display_name} size={26} />}
                  <View style={[styles.cwBubble, item.isMe && styles.cwBubbleMe]}>
                    {!item.isMe && <Text style={styles.cwSenderName}>{item.display_name}</Text>}
                    <Text style={[styles.cwBubbleText, item.isMe && { color: '#000' }]}>{item.content}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 8 }}>
                <Text style={{ color: C.muted, fontSize: 12 }}>React while watching 🔥</Text>
              </View>
            }
          />
        )}

        <View style={styles.inputRow}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.inputField}
              placeholder="Say something…"
              placeholderTextColor={C.muted2}
              value={inputText} onChangeText={setInputText}
              onSubmitEditing={sendLiveMessage}
              returnKeyType="send" editable={!isSendingChat}
            />
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || isSendingChat) && { opacity: 0.4 }]}
            onPress={sendLiveMessage} disabled={!inputText.trim() || isSendingChat}
          >
            {isSendingChat ? <ActivityIndicator size="small" color="#000" /> : <Ionicons name="send" size={16} color="#000" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <CommentSheet visible={!!commentPost} postId={commentPost?.id || ''} userId={user?.id || ''} onClose={() => setCommentPost(null)} />
      <GiftSheet visible={!!giftPost} post={giftPost} userId={user?.id || ''} userProfile={userProfile} onClose={() => setGiftPost(null)} onGiftSent={handleGiftSent} />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────

const pipStyles = StyleSheet.create({
  pip: {
    position: 'absolute', top: PIP_OFFSET_TOP, right: 12,
    width: PIP_W, height: PIP_H, borderRadius: 14, zIndex: 20,
    shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 14,
  },
  pipTouchable: { width: PIP_W, height: PIP_H, borderRadius: 14, overflow: 'hidden' },
  pipVideo:     { width: PIP_W, height: PIP_H },
  pipPlaceholder: { width: PIP_W, height: PIP_H, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  pipRing: { position: 'absolute', inset: 0, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', zIndex: 2 },
  pipRingActive: { borderColor: C.green },
  pipNameTag: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 3, paddingHorizontal: 6,
    borderBottomLeftRadius: 14, borderBottomRightRadius: 14, zIndex: 3,
  },
  pipNameText: { fontSize: 9.5, color: C.white, fontWeight: '600', textAlign: 'center' },
  pipLiveDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: C.green, zIndex: 4, borderWidth: 1.5, borderColor: '#000' },
  pipControls: { position: 'absolute', top: -52, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 8, zIndex: 25 },
  pipCtrlBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.85)', borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  localPip: {
    position: 'absolute', top: PIP_OFFSET_TOP, left: 12,
    width: PIP_W, height: PIP_H, borderRadius: 14, overflow: 'hidden', zIndex: 19,
    borderWidth: 2, borderColor: C.green,
    shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 13,
  },
});

const callCtrlStyles = StyleSheet.create({
  bar: {
    position: 'absolute', bottom: 18, left: 16,
    flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 18,
    backgroundColor: 'rgba(0,0,0,0.65)', paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 30, borderWidth: 1, borderColor: C.border,
  },
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  btnMuted: { backgroundColor: 'rgba(229,57,53,0.25)', borderColor: C.red },
  endBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
});

const cardStyles = StyleSheet.create({
  card: { backgroundColor: '#000', position: 'relative', overflow: 'hidden' },
  textPostOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  textPostContent: { fontSize: 20, fontWeight: '700', color: C.white, textAlign: 'center', lineHeight: 30 },
  pauseIconWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 4, pointerEvents: 'none' },
  pauseIconBg: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  // Animated moving watermark — identical to videos.tsx
  watermarkAnimated: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 8, zIndex: 10 },
  watermarkLogo:     { width: 24, height: 24 },
  watermarkText:     { color: '#00ff88', fontSize: 12, fontWeight: '700' },
  watermarkUsername: { color: '#fff', fontSize: 10, fontWeight: '600', marginTop: 2 },
  // Vibe badge
  vibeBadge: { position: 'absolute', top: 56, left: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, borderWidth: 1, zIndex: 10 },
  vibeBadgeEmoji: { fontSize: 13 },
  vibeBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  // Effect badge
  effectBadge: { position: 'absolute', top: 92, left: 14, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, zIndex: 10 },
  effectBadgeText: { fontSize: 10, fontWeight: '700' },
  // Immerse badge
  immerseBadge: { position: 'absolute', top: 92, right: 14, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#00cfff', zIndex: 10 },
  immerseBadgeText: { color: '#000', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  // Spatial audio arrows
  spatialLeft:  { position: 'absolute', left: 8,  top: '45%', alignItems: 'center', zIndex: 10 },
  spatialRight: { position: 'absolute', right: 8, top: '45%', alignItems: 'center', zIndex: 10 },
  spatialArrow: { color: 'rgba(0,207,255,0.7)', fontSize: 18, fontWeight: '900' },
  spatialLabel: { color: 'rgba(0,207,255,0.7)', fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  // Owner delete (top-left corner)
  ownerDeleteBtn: { position: 'absolute', top: 56, left: 14, zIndex: 15, backgroundColor: 'rgba(229,57,53,0.18)', borderWidth: 1, borderColor: C.red, borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  authorRow: { position: 'absolute', bottom: 72, left: 16, flexDirection: 'row', alignItems: 'center', gap: 10, zIndex: 5, right: 76 },
  authorName:   { fontSize: 13, fontWeight: '700', color: C.white },
  authorHandle: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  captionText:  { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 3, lineHeight: 15 },
  actionsCol: { position: 'absolute', right: 12, bottom: 68, gap: 18, alignItems: 'center', zIndex: 5 },
  actionBtn:   { alignItems: 'center', gap: 3 },
  actionCount: { fontSize: 11, color: C.white, fontWeight: '600' },
  // Views
  viewsOverlay: { alignItems: 'center', gap: 2 },
  viewsText: { fontSize: 10, color: C.white, fontWeight: '600' },
  // Watching Together badge
  watchingBadge: { position: 'absolute', bottom: 56, left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: C.green + '55', zIndex: 5 },
  watchingDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  watchingBadgeText: { fontSize: 10.5, color: C.green, fontWeight: '600' },
  // Voice post player
  voicePlayerWrap: { position: 'absolute', bottom: 100, left: 16, right: 76, zIndex: 5 },
  voiceProgressTrack: { height: 3, backgroundColor: '#333', borderRadius: 2, marginBottom: 10, overflow: 'hidden' },
  voiceProgressFill:  { height: '100%', backgroundColor: C.green, borderRadius: 2 },
  voiceControlsRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  voicePlayButton:    { width: 48, height: 48, borderRadius: 24, backgroundColor: C.green, justifyContent: 'center', alignItems: 'center' },
  voiceTimeText:      { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '500', width: 40 },
  voiceWaveform:      { flexDirection: 'row', alignItems: 'center', height: 24, gap: 2 },
  voiceWaveformBar:   { width: 3, borderRadius: 2 },
  // Music indicator
  musicContainer: { position: 'absolute', bottom: 54, left: 16, right: 76, flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 5 },
  musicText: { color: C.green, fontSize: 11, fontStyle: 'italic', flex: 1 },
});

const adStyles = StyleSheet.create({
  card: { backgroundColor: '#0a0a0a', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  bgEmoji: { position: 'absolute', fontSize: 160, opacity: 0.06 },
  sponsoredPill: { position: 'absolute', top: 56, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 14, zIndex: 5 },
  sponsoredText: { fontSize: 10, fontWeight: '700' },
  center: { alignItems: 'center', paddingHorizontal: 40, gap: 16 },
  tagline: { fontSize: 26, fontWeight: '900', textAlign: 'center', lineHeight: 34 },
  caption: { fontSize: 14, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 21 },
  cta: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 28, marginTop: 8 },
  ctaText: { color: '#000', fontSize: 15, fontWeight: '800' },
  watermark: { position: 'absolute', bottom: 120, right: 20, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.55)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 10 },
  watermarkText: { fontSize: 11, fontWeight: '700' },
  // ✅ FIXED: BannerAd is now visible at the bottom
  bannerAdContainer: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingVertical: 6,
  },
  bannerAdLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
});

const selectorStyles = StyleSheet.create({
  row: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 22, padding: 4, gap: 2, borderWidth: 1, borderColor: C.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 18 },
  tabActive:     { backgroundColor: C.green },
  tabText:       { fontSize: 12, color: C.muted, fontWeight: '600' },
  tabTextActive: { color: '#000', fontWeight: '800' },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderTopWidth: 1, borderColor: C.border },
  giftSheet: { backgroundColor: '#121212', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderTopWidth: 1, borderColor: C.border, maxHeight: SH * 0.8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginTop: 10, marginBottom: 14 },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: C.white, flex: 1 },
  giftHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1a1a1a', marginHorizontal: 16, marginBottom: 16, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.gold + '44' },
  balanceText: { color: C.gold, fontSize: 14, fontWeight: '700', flex: 1 },
  topUpBtn: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 12 },
  topUpBtnText: { color: C.green, fontSize: 12, fontWeight: '700' },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16, paddingBottom: 16, justifyContent: 'space-between' },
  giftItem: { width: (SW - 52) / 3, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center', gap: 4 },
  giftName: { fontSize: 11, fontWeight: '700', color: C.white, textAlign: 'center' },
  giftCostBadge: { backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8, marginTop: 2 },
  giftCostText: { fontSize: 11, fontWeight: '700' },
  giftNgnText: { fontSize: 9.5, color: C.muted, marginTop: 1 },
  customGiftContainer: { padding: 20 },
  customGiftLabel: { color: C.muted, fontSize: 13, marginBottom: 12 },
  customGiftInput: { backgroundColor: C.card, color: C.white, fontSize: 22, fontWeight: '700', padding: 16, borderRadius: 14, borderWidth: 1.5, borderColor: C.green, textAlign: 'center', marginBottom: 8 },
  customGiftPreview: { color: C.gold, fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 8 },
  customGiftActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  customGiftBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  customGiftTrigger: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: C.green, borderStyle: 'dashed', marginTop: 4 },
  customGiftTriggerText: { color: C.green, fontSize: 14, fontWeight: '700' },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center', paddingVertical: 20 },
  commentRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  commentName: { fontSize: 11.5, fontWeight: '700', color: C.green, marginBottom: 2 },
  commentText: { fontSize: 13, color: C.white, lineHeight: 18 },
  replyLink: { fontSize: 11, color: C.muted, marginTop: 4 },
  replyingBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.card2, borderTopWidth: 1, borderTopColor: C.border },
  replyingText: { color: C.green, fontSize: 12, fontStyle: 'italic' },
  commentInputRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderColor: C.border, marginTop: 8 },
  commentInput: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10, color: C.white, fontSize: 14 },
  commentSendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
});

const floatStyles = StyleSheet.create({
  bubble: { position: 'absolute', bottom: 100, fontSize: 28, zIndex: 100 },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  loadingScreen: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingTitle:    { fontSize: 16, fontWeight: '800', color: C.white, marginTop: 8 },
  loadingSubtitle: { fontSize: 13, color: C.muted },
  feedContainer: { flex: 1, backgroundColor: '#000', position: 'relative' },
  feedLoadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  feedLoadingText: { fontSize: 13, color: C.muted },
  emptyFeed: { width: SW, height: SH * 0.6, alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyFeedText: { fontSize: 14, color: C.muted },
  retryBtn: { backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 24 },
  retryBtnText: { fontSize: 13, color: C.green, fontWeight: '700' },
  topBarWrap: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 22 },
  topBarRow1: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: Platform.OS === 'ios' ? 12 : 10, paddingBottom: 6, backgroundColor: 'rgba(0,0,0,0.5)', gap: 8 },
  topBarRow2: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'space-between' },
  backBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 13, fontWeight: '700', color: C.white },
  topBarSub:   { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 1 },
  syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green, borderRadius: 20, paddingVertical: 3, paddingHorizontal: 8 },
  syncBadgeText: { fontSize: 9.5, fontWeight: '700', color: C.green },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.red, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 },
  liveBadgeText: { fontSize: 9.5, fontWeight: '800', color: C.white, letterSpacing: 0.8 },
  postCounter: { backgroundColor: 'rgba(0,0,0,0.5)', paddingVertical: 3, paddingHorizontal: 10, borderRadius: 20 },
  postCounterText: { fontSize: 10, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
  bottomPanel: { backgroundColor: '#080808', borderTopWidth: 1, borderTopColor: C.border },
  reactionsBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  reactionBtn: { flex: 1, alignItems: 'center', paddingVertical: 5, backgroundColor: C.card2, borderRadius: 10 },
  chatToggleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  chatArea: { maxHeight: SH * 0.22 },
  systemMsg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 2 },
  systemMsgText: { fontSize: 11, color: C.muted, backgroundColor: C.card, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 10 },
  cwMsg:   { flexDirection: 'row', gap: 7, alignItems: 'flex-end' },
  cwMsgMe: { flexDirection: 'row-reverse' },
  cwBubble: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10, maxWidth: SW * 0.62 },
  cwBubbleMe:   { backgroundColor: C.green, borderColor: C.green },
  cwSenderName: { fontSize: 9.5, color: C.green, fontWeight: '700', marginBottom: 2 },
  cwBubbleText: { fontSize: 13, color: C.white },
  inputRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 6 : 12, borderTopWidth: 1, borderTopColor: C.border },
  inputWrap: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 14 },
  inputField: { color: C.white, fontSize: 14, paddingVertical: 10 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
});