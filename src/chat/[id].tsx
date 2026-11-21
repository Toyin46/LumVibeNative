// src/chat/[id].tsx
// LumVibe — Direct Message Chat Screen

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, KeyboardAvoidingView,
  Platform, Modal, Alert, ActivityIndicator, Image,
  ScrollView, Dimensions, PermissionsAndroid, Linking, Share, Keyboard,
} from 'react-native';
import { useAudioPlayer, useAudioRecorder, AudioModule, RecordingPresets, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
// ✅ NEW: already in your package.json — used for the in-app photo/video viewer
// and a tiny tap-feedback buzz on the voice-note button.
import { useVideoPlayer, VideoView as ExpoVideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
// ✅ NEW: lets startCall also ring the callee's GLOBAL signal channel
// (any screen, not just this exact chat screen) — see
// globalIncomingSignal.tsx for the full picture. Purely additive
// alongside the existing per-conversation broadcast right below.
import { broadcastToUserChannel } from '../lib/globalIncomingSignal';
// ✅ NEW (ringing rework): this screen no longer draws its own incoming-call /
// watch-invite modal or plays its own ringtone (that popped a SECOND modal and
// a SECOND ring on top of the global one — visible behind the modal in the
// Home screenshot). It forwards to the one shared ring state instead.
import { showIncoming, cancelIncomingByTarget } from '../lib/incomingRing';
import { parseRingData } from '../lib/ringPayload';
// ✅ NEW: opening a chat removes its message notification from the shade
import { cancelChatNotification } from '../lib/chatNotifications';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ContextStoryBar from './components/ContextStoryBar';
// FIX: react-native's own SafeAreaView is iOS-only — on Android it's a
// no-op View, which is exactly why the header (back button, avatar, call
// icons) was rendering underneath the status bar/battery indicator.
// react-native-safe-area-context's SafeAreaView applies real insets on
// both platforms, so it replaces the 'react-native' import below.
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { notifyNewMessage } from '../utils/notificationHelpers';
import { useAuthStore } from '../store/authStore';
// FIX: this app uses @react-navigation, not expo-router. useRoute() replaces
// expo-router's useLocalSearchParams(), and useNavigation() must be called
// INSIDE the component (it was at module scope before, which is an invalid
// hook call and crashes the screen the instant it mounts).
import { useNavigation, useRoute } from '@react-navigation/native';

// LiveKit replaces Agora completely
// FIX: Room/RoomEvent/Track/ConnectionState are core classes from livekit-client.
// @livekit/react-native only wraps native WebRTC + provides RN-specific UI (VideoView).
import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import { VideoView, AudioSession, AndroidAudioTypePresets } from '@livekit/react-native';
import Constants from 'expo-constants';

// FIX: point this at whatever your navigator actually registered the
// CoWatch screen as (e.g. <Stack.Screen name="Cowatch" component={CowatchScreen} />).
// Keeping it as one constant means you only fix it in one place if it's wrong.
const COWATCH_SCREEN = 'Cowatch';

const { width: SCREEN_W } = Dimensions.get('window');
const HEADER_H = Platform.OS === 'ios' ? 110 : 60;

const LIVEKIT_URL: string =
  (Constants.expoConfig?.extra as any)?.livekitUrl ?? '';

const C = {
  black: '#000000', bg: '#0a0a0a', card: '#1a1a1a', card2: '#222222',
  border: '#2a2a2a', green: '#00e676', greenBg: 'rgba(0,230,118,0.1)',
  gold: '#f5c518', red: '#e53935', white: '#ffffff',
  muted: '#888888', muted2: '#555555',
};

// ✅ NEW: the SAME gifts, prices and coin→naira rate as the feed (videos.tsx),
// so a gift looks and costs the same wherever it is sent.
const COIN_TO_NGN = 150;
function coinsToNGN(coins: number): string {
  return `₦${(coins * COIN_TO_NGN).toLocaleString('en-NG')}`;
}
const GIFT_PACKAGES = [
  { id: 'spark',        name: 'Spark',        icon: '✨', coins: 1,   color: '#ffdd55' },
  { id: 'heart',        name: 'Heart',        icon: '❤️', coins: 3,   color: '#ff4757' },
  { id: 'smile',        name: 'Smile',        icon: '😊', coins: 5,   color: '#ffd93d' },
  { id: 'rose',         name: 'Rose',         icon: '🌹', coins: 10,  color: '#ff69b4' },
  { id: 'candy',        name: 'Candy',        icon: '🍬', coins: 15,  color: '#ff85c8' },
  { id: 'balloon',      name: 'Balloon',      icon: '🎈', coins: 20,  color: '#ff6b6b' },
  { id: 'star',         name: 'Star',         icon: '⭐', coins: 25,  color: '#ffd700' },
  { id: 'cupcake',      name: 'Cupcake',      icon: '🧁', coins: 30,  color: '#ffb6c1' },
  { id: 'bouquet',      name: 'Bouquet',      icon: '💐', coins: 40,  color: '#ff8fab' },
  { id: 'ice_cream',    name: 'Ice Cream',    icon: '🍦', coins: 50,  color: '#00bfff' },
  { id: 'gift_box',     name: 'Gift Box',     icon: '🎁', coins: 60,  color: '#ff4d6d' },
  { id: 'sparkler',     name: 'Sparkler',     icon: '🎇', coins: 70,  color: '#ffe066' },
  { id: 'diamond_ring', name: 'Diamond Ring', icon: '💍', coins: 80,  color: '#00e5ff' },
  { id: 'love_letter',  name: 'Love Letter',  icon: '💌', coins: 100, color: '#ff4d8f' },
  { id: 'crown',        name: 'Crown',        icon: '👑', coins: 150, color: '#ffd700' },
  { id: 'fireworks',    name: 'Fireworks',    icon: '🎆', coins: 200, color: '#ff6347' },
  { id: 'rocket',       name: 'Rocket',       icon: '🚀', coins: 250, color: '#00ff88' },
  { id: 'unicorn',      name: 'Unicorn',      icon: '🦄', coins: 300, color: '#c77dff' },
  { id: 'castle',       name: 'Castle',       icon: '🏰', coins: 400, color: '#9d4edd' },
  { id: 'trophy',       name: 'Trophy',       icon: '🏆', coins: 500, color: '#cd7f32' },
];

// ✅ NEW: voice notes are recorded in mono at 32 kbps (clear for speech) instead
// of stereo 128 kbps — about 4× smaller to upload and download.
const VOICE_PRESET = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, sampleRate: 22050, bitRate: 32000 };

const QUICK_EMOJIS = ['😂','❤️','🔥','😭','🙌','💀','👀','🎬','⚡','✨','🎵','😍','💯','🤩','😎','🤣'];
const REACTIONS    = ['❤️','😂','🔥','😮','😢','👏','💀','🙌'];

// ── PUSH NOTIFICATIONS (for ringing while the app is backgrounded/killed) ──
// FIX (audit item #1, continued): the realtime broadcast below only rings
// the other person if their chat screen happens to be mounted. To ring
// them while the app is backgrounded — or fully killed on Android — we
// also need a real push notification. This registers this device's Expo
// push token and asks the Edge Function `send-call-push` to fire one.
//
// ⚠️ IMPORTANT — this gets Android to a genuine "incoming call" push even
// from a killed state. Full iOS behavior like a real phone call (ringing
// through silent mode, native full-screen UI before unlock) needs PushKit
// VoIP pushes + CallKit, which is a separate native integration (Apple
// requires CallKit whenever you use VoIP pushes, plus a VoIP push
// certificate). That's a bigger, distinct project from this one — say the
// word if you want that built next. This gets you real ringing on Android
// today, and on iOS whenever the app is foregrounded/backgrounded (not
// force-quit).
async function registerCallPushToken(userId: string) {
  try {
    if (Platform.OS === 'android') {
      // ✅ FIX (notifications arriving silently, no ring/sound): Android
      // PERMANENTLY LOCKS a notification channel's sound/importance/
      // vibration the first time that channel ID is ever created on a
      // device — no later code change to the same ID can touch it again,
      // ever, short of the user manually deleting it in system settings
      // or uninstalling the app. The old 'calls' channel got created at
      // some point during testing without a working sound, and every
      // device that ever ran that code is now stuck silent on it forever.
      // Renaming to 'calls_v2' forces every device to create a brand-new
      // channel with the settings below actually applied. This must stay
      // in sync with the channelId used in send-call-push (edge function)
      // and lib/notifications.ts's cowatch invite push — all three now
      // say 'calls_v2'.
      await Notifications.setNotificationChannelAsync('calls_v2', {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        // 'default' is the documented, correct value for "play the
        // device's default notification sound" — safe to set explicitly
        // on a channel (as opposed to some other place a bad value may
        // have been passed before, causing the crash the removed comment
        // here described).
        sound: 'default',
        vibrationPattern: [0, 500, 250, 500],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
    // ✅ NEW: registers the "Answer"/"Decline" action buttons that appear
    // directly on the incoming-call notification itself, so it can be
    // handled without first opening the app — the "banner ... with answer
    // or decline" behavior. This is a heads-up notification with
    // interactive actions, not a true full-screen lock-takeover UI (that
    // level specifically needs Notifee or CallKeep — a separate, bigger
    // step). Registering the category is safe to call every session; it's
    // idempotent.
    await Notifications.setNotificationCategoryAsync('incoming_call', [
      {
        identifier: 'decline',
        buttonTitle: 'Decline',
        options: { opensAppToForeground: false, isDestructive: true },
      },
      {
        identifier: 'answer',
        buttonTitle: 'Answer',
        options: { opensAppToForeground: true },
      },
    ]);
    // ✅ NEW (fix #2, part 2 — missed-call notification): matches the
    // WhatsApp "Call back / Message" quick actions shown after a call goes
    // unanswered. Registering the category is the client-side half of
    // this; it only actually appears once whatever sends the push (see
    // sendMissedCallPush below) sets categoryIdentifier: 'missed_call' on
    // that notification.
    await Notifications.setNotificationCategoryAsync('missed_call', [
      {
        identifier: 'call_back',
        buttonTitle: 'Call back',
        options: { opensAppToForeground: true },
      },
      {
        identifier: 'message',
        buttonTitle: 'Message',
        options: { opensAppToForeground: true },
      },
    ]);
    // ✅ NEW (fix #3, notification half — cowatch invite): same
    // heads-up-with-actions treatment as calls, so a cowatch invite that
    // arrives while the app is backgrounded/killed shows as more than a
    // plain silent notification. Requires notifyCowatchInvite's push (in
    // lib/notifications.ts) to set categoryIdentifier: 'cowatch_invite'.
    await Notifications.setNotificationCategoryAsync('cowatch_invite', [
      {
        identifier: 'dismiss',
        buttonTitle: 'Dismiss',
        options: { opensAppToForeground: false, isDestructive: true },
      },
      {
        identifier: 'join',
        buttonTitle: 'Join',
        options: { opensAppToForeground: true },
      },
    ]);
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    // ✅ FIX (real root cause found): the `profiles` table this used to
    // write to has ZERO rows — confirmed via a direct schema query. Every
    // real user (display_name, photo_url, etc.) actually lives in
    // `users`, which had no push_token column at all until now. Writing
    // to `profiles` was a silent no-op the entire time: Supabase doesn't
    // error on an UPDATE that matches 0 rows, it just does nothing.
    // Requires: alter table public.users add column if not exists
    // push_token text;
    // ✅ NEW (iOS/Android divergent call push): send-call-push needs to
    // know which platform it's sending to, since Android gets a data-only
    // message (for the notifee full-screen ring) and iOS gets a normal
    // visible notification (no CallKit build exists for iOS yet — a
    // silent data-only push would show NOTHING on iOS, which would be
    // worse than what existed before). Requires: alter table public.users
    // add column if not exists push_platform text;
    await supabase.from('users').update({
      push_token: tokenResp.data,
      push_platform: Platform.OS,
    }).eq('id', userId);
  } catch (e) {
    console.error('registerCallPushToken error:', e);
  }
}

async function sendCallPush(payload: {
  calleeId: string; callerId: string; callerName: string;
  callType: 'voice' | 'video'; roomName: string; conversationId: string;
  callerPhoto?: string;
  callId?: string; // ✅ NEW: same id as the realtime broadcast -> receiver never rings twice
}) {
  try {
    await supabase.functions.invoke('send-call-push', { body: payload });
  } catch (e) {
    // Non-fatal — the realtime broadcast may still reach them if their
    // chat screen is open, so a push failure shouldn't block the call.
    console.error('sendCallPush error:', e);
  }
}

// ✅ NEW (fix #2, part 2 — "Missed voice call" banner like image 3): only
// the CALLER's device can reliably detect "nobody ever answered" for a
// callee whose app is fully killed (the callee's own 30s ring-timeout in
// the effect below never runs in that case, since no JS is executing on
// their device at all). So when the caller gives up, THIS device tells
// the send-call-push function to fire a second, distinct push at the
// callee — a "Missed voice call" notification with Call back/Message
// actions, instead of just letting the original ringing notification sit
// there or silently vanish.
// ⚠️ This assumes send-call-push accepts a `type` field and branches on
// it to build a different notification body/category for 'missed_call'
// vs the default 'incoming_call' case. I don't have that function's
// source in front of me — if it ignores unknown fields, this call is a
// harmless no-op until it's updated to handle `type: 'missed_call'`.
async function sendMissedCallPush(payload: {
  calleeId: string; callerId: string; callerName: string;
  callType: 'voice' | 'video'; roomName: string; conversationId: string;
}) {
  try {
    await supabase.functions.invoke('send-call-push', {
      body: { ...payload, type: 'missed_call' },
    });
  } catch (e) {
    console.error('sendMissedCallPush error:', e);
  }
}

// ── LIVEKIT CALL HOOK ─────────────────────────────────────────
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

interface CallState {
  isInCall:        boolean;
  callType:        'voice' | 'video';
  isMuted:         boolean;
  isVideoOff:      boolean;
  isSpeakerOn:     boolean;
  callDuration:    number;
  isConnecting:    boolean;
  remoteConnected: boolean;
  permDenied:      boolean;
}

const CALL_INITIAL: CallState = {
  isInCall: false, callType: 'voice',
  isMuted: false, isVideoOff: false, isSpeakerOn: false,
  callDuration: 0, isConnecting: false,
  remoteConnected: false, permDenied: false,
};

// ✅ NEW: an incoming call notice, delivered over a per-conversation
// Supabase realtime broadcast channel. This is signaling only — it just
// tells the other person's device "a call started, here's the room to
// join" — it doesn't touch push notifications, so it only rings while
// their app has this chat screen mounted (foreground/background), same
// as the rest of this screen's realtime features (messages, presence).
// A true "ring while the app is killed" experience needs a push
// notification provider wired in separately.
interface IncomingCall {
  callerId:    string;
  callerName:  string;
  callerPhoto?: string;
  callType:    'voice' | 'video';
  roomName:    string;
}

// ✅ NEW (fix #3 — cowatch invite): same shape as IncomingCall above, but
// for "come watch with me" invites, delivered over the same per-
// conversation signaling channel as calls so it works the instant both
// people have this chat screen open — no dependency on push delivery.
interface IncomingCowatch {
  inviterId:    string;
  inviterName:  string;
  inviterPhoto?: string;
  sessionId:    string;
  conversationId: string;
}

function useCall(currentUserId: string, displayName: string, conversationId: string | null, otherUserId: string | null, callerPhoto?: string) {
  const [callState,      setCallState]      = useState<CallState>(CALL_INITIAL);
  const [incomingCall,   setIncomingCall]   = useState<IncomingCall | null>(null);
  // ✅ NEW (fix #3): incoming cowatch invite banner state — lives here
  // because it rides the same already-open `call_signal:${conversationId}`
  // channel this hook already subscribes to (see the channel setup below).
  const [incomingCowatch, setIncomingCowatch] = useState<IncomingCowatch | null>(null);
  const [localVideoTrack,  setLocalVideoTrack]  = useState<Track | null>(null);
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<Track | null>(null);
  // ✅ NEW: the other person's camera / mic state. Switching a camera off only
  // MUTES its track in LiveKit — the picture freezes or goes black and nothing
  // told this screen — so these follow the mute events and the call screen can
  // show the avatar instead.
  const [remoteCamOff,   setRemoteCamOff]   = useState(false);
  const [remoteMicMuted, setRemoteMicMuted] = useState(false);
  const roomRef      = useRef<Room | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cowatchRingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef   = useRef(true);
  const signalRef    = useRef<RealtimeChannel | null>(null);
  // ✅ NEW (fix #1 — symmetric hangup): joinLiveKitRoom is defined (and its
  // RoomEvent handlers wired up) BEFORE endCall exists as a value further
  // down this hook, so its ParticipantDisconnected handler can't close over
  // endCall directly — that would be a stale/undefined reference at
  // definition time. Routing the call through a ref that's kept in sync
  // (see the effect right after endCall's definition) lets the room-event
  // handler always invoke whatever the CURRENT endCall closure is.
  const endCallRef = useRef<() => void>(() => {});
  // ✅ NEW: call-log support. isCallerRef distinguishes "I started this
  // call" from "I answered this call" — needed so a callee hanging up
  // fast during the connecting window isn't mislabeled as a missed call.
  // loggedRoomsRef prevents BOTH sides from independently inserting a
  // duplicate log row for the same call — whichever side logs first
  // broadcasts it, and the other side just marks it done locally instead
  // of inserting its own second row.
  const isCallerRef   = useRef(false);
  const loggedRoomsRef = useRef<Set<string>>(new Set());
  const logCallOnce = useCallback((roomName: string, callType: 'voice' | 'video', outcome: 'missed' | 'declined' | 'completed', durationSeconds?: number) => {
    if (loggedRoomsRef.current.has(roomName)) return;
    loggedRoomsRef.current.add(roomName);
    if (conversationId) {
      insertCallLogMessage(conversationId, currentUserId, callType, outcome, durationSeconds);
    }
    signalRef.current?.send({ type: 'broadcast', event: 'call_logged', payload: { roomName } }).catch(() => {});
  }, [conversationId, currentUserId]);
  // ✅ NEW: nothing anywhere played any sound at all for a ringing call —
  // neither the callee's actual ringtone nor a ringback tone for the
  // caller while waiting. Both use the same createAudioPlayer pattern
  // already established elsewhere in this app (see HomeScreen.tsx/
  // videos.tsx background-music playback).
  // ⚠️ REQUIRES TWO REAL SOUND FILES that don't exist yet — this can't
  // work until actual .mp3 files are added at these two paths. This part
  // needs a rebuild (adding new asset files that a require() call points
  // to needs Metro to bundle them fresh), unlike the accept-call fix
  // above which is pure JS logic.
  const ringtonePlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const ringbackPlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const stopRingtone = useCallback(() => {
    if (ringtonePlayerRef.current) {
      try { ringtonePlayerRef.current.pause(); ringtonePlayerRef.current.remove(); } catch (_) {}
      ringtonePlayerRef.current = null;
    }
  }, []);
  const stopRingback = useCallback(() => {
    if (ringbackPlayerRef.current) {
      try { ringbackPlayerRef.current.pause(); ringbackPlayerRef.current.remove(); } catch (_) {}
      ringbackPlayerRef.current = null;
    }
  }, []);

  // ✅ REMOVED (ringing rework): the callee's ringtone used to play from HERE,
  // only while this chat screen was mounted. The ringtone (and vibration) now
  // belongs to the shared ring state in src/lib/incomingRing.ts, so it rings on
  // every screen, exactly once.

  // Caller's ringback tone ("tun ... tun") — plays ONLY on the caller's phone,
  // from the moment the call is placed until the other person answers, declines
  // or the 90 s ring-out below ends it.
  // ✅ CHANGED: it used to fall back to the RECEIVER's ringtone file, so the
  // caller heard the full ringtone too. It now uses its own short "tun tun"
  // tone (src/assets/sounds/ringback.wav) and never the ringtone. It also used
  // to stop as soon as the connection to the room finished (isConnecting), i.e.
  // before the other person had answered — it now runs until they do.
  useEffect(() => {
    if (callState.isInCall && !callState.remoteConnected && isCallerRef.current) {
      if (!ringbackPlayerRef.current) {
        try {
          const player = createAudioPlayer(require('../assets/sounds/ringback.wav'));
          player.loop = true;
          player.play();
          ringbackPlayerRef.current = player;
        } catch (e) { console.warn('[LumVibe] ringback playback failed:', e); }
      }
    } else {
      stopRingback();
    }
    return stopRingback;
  }, [callState.isInCall, callState.remoteConnected, stopRingback]);

  useEffect(() => {
    mountedRef.current = true;
    if (currentUserId) registerCallPushToken(currentUserId);
    return () => {
      mountedRef.current = false;
      endCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ NEW: subscribe to this conversation's call-signaling channel so an
  // incoming call can actually surface on the receiving side.
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`call_signal:${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'incoming_call' }, ({ payload }: any) => {
        if (!mountedRef.current || payload?.callerId === currentUserId) return;
        // ✅ CHANGED: forward to the shared ring state (de-duplicated against
        // the per-user channel + the push, which carry the same callId).
        const p = parseRingData({ type: 'incoming_call', ...payload, conversationId });
        if (p) showIncoming(p);
      })
      .on('broadcast', { event: 'call_cancelled' }, ({ payload }: any) => {
        // ✅ FIX: clear the pending ring-timeout too — otherwise, if the
        // caller cancels before the 30s mark, this side's timer was still
        // running and could fire later and log a redundant "missed" entry
        // for a call that's already been logged by the caller's own hangup.
        if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
        setIncomingCall(prev => (prev?.roomName === payload?.roomName ? null : prev));
        cancelIncomingByTarget({ roomName: payload?.roomName });
      })
      .on('broadcast', { event: 'call_declined' }, ({ payload }: any) => {
        if (!mountedRef.current) return;
        setCallState(prev => {
          if (prev.isInCall && !prev.remoteConnected) {
            // We're the caller and the other side just declined — hang up.
            if (timerRef.current) clearInterval(timerRef.current);
            if (roomRef.current) { try { roomRef.current.disconnect(); } catch (_) {} roomRef.current = null; }
            Alert.alert('Call declined');
            return CALL_INITIAL;
          }
          return prev;
        });
      })
      // ✅ NEW: the other device already inserted the call-log row for this
      // call (e.g. they declined, or their ring timed out first) — mark it
      // logged here too so nothing on this side inserts a duplicate.
      .on('broadcast', { event: 'call_logged' }, ({ payload }: any) => {
        if (payload?.roomName) loggedRoomsRef.current.add(payload.roomName);
      })
      // ✅ NEW (fix #3 — cowatch invite): mirrors the 'incoming_call'
      // handler above exactly. cowatch.tsx broadcasts this the moment it
      // creates a brand-new session (see broadcastCowatchInvite there), so
      // whoever's on the other end of THIS conversation's chat screen sees
      // an in-app "invited you to watch together" banner immediately —
      // the same instant-delivery path calls already had, which is exactly
      // what was missing.
      .on('broadcast', { event: 'cowatch_invite' }, ({ payload }: any) => {
        if (!mountedRef.current || payload?.inviterId === currentUserId) return;
        const p = parseRingData({ type: 'cowatch_invite', ...payload, conversationId });
        if (p) showIncoming(p);
      })
      .on('broadcast', { event: 'cowatch_cancelled' }, ({ payload }: any) => {
        cancelIncomingByTarget({ sessionId: payload?.sessionId });
      })
      .subscribe();
    signalRef.current = channel;
    return () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      if (cowatchRingTimerRef.current) clearTimeout(cowatchRingTimerRef.current);
      supabase.removeChannel(channel);
      signalRef.current = null;
    };
  }, [conversationId, currentUserId]);

  // ✅ FIX (real root cause of "caller sees the incoming-call screen again
  // after the other person answers"): this room-joining logic used to be
  // inline inside startCall() itself, which meant EVERY call to startCall
  // — including from acceptCall() below — also re-ran the
  // "broadcast incoming_call + send a call push" step further up. When B
  // accepted a call, acceptCall() called startCall(), which re-broadcast
  // 'incoming_call' to the whole shared channel — reaching A too. A's own
  // listener only filters out ITS OWN broadcasts (payload.callerId ===
  // currentUserId), not ones from whoever they're already calling, so A's
  // screen incorrectly popped the incoming-call modal again, even though A
  // was the original caller mid-call. Splitting the actual LiveKit
  // room-join into its own function fixes this: acceptCall() now calls
  // ONLY this, never re-signaling a call that's already happening.
  const joinLiveKitRoom = useCallback(async (roomName: string, callType: 'voice' | 'video') => {
    try {
      // ✅ NEW: configure the native audio session before connecting, and
      // start it so mic/speaker routing behaves like a real call rather
      // than default media playback.
      await AudioSession.configureAudio({
        android: { audioTypeOptions: AndroidAudioTypePresets.communication },
      });
      await AudioSession.startAudioSession();

      const token = await fetchLiveKitToken(roomName, displayName || currentUserId);
      if (!token) throw new Error('Could not get call token');

      const room = new Room({
        adaptiveStream: true,
        dynacast:       true,
        // ✅ NEW: explicit audio processing settings (now matches Co-Watch) —
        // rather than leaving them at LiveKit's defaults, which can differ
        // silently between SDK versions and contribute to a crackly call.
        audioCaptureDefaults: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      roomRef.current = room;

      room.on(RoomEvent.Connected, () => {
        if (!mountedRef.current) return;
        setCallState(prev => ({ ...prev, isConnecting: false }));
        timerRef.current = setInterval(() => {
          setCallState(prev => ({ ...prev, callDuration: prev.callDuration + 1 }));
        }, 1000);
      });

      room.on(RoomEvent.ParticipantConnected, () => {
        if (mountedRef.current) setCallState(prev => ({ ...prev, remoteConnected: true }));
      });

      // ✅ FIX (bug #1 — hangup only ended the call for whoever pressed the
      // button): this used to just flip remoteConnected to false and clear
      // the video track, then stop — leaving THIS side's call screen open,
      // timer still running, still "connected" to a LiveKit room the other
      // person had already left. These are 1:1 calls (exactly one caller +
      // one callee), so the other participant disconnecting always means
      // the call is over, full stop — there's nobody left to talk to.
      // Routing through endCallRef runs the exact same teardown the red
      // hang-up button does (stop timer, disconnect our own room, log the
      // call as completed with its real duration, reset callState), so
      // both sides end up in the identical post-call state instead of one
      // side being stuck.
      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (!mountedRef.current) return;
        setRemoteVideoTrack(null);
        endCallRef.current();
      });

      room.on(RoomEvent.Disconnected, () => {
        if (mountedRef.current) setCallState(CALL_INITIAL);
        setLocalVideoTrack(null);
        setRemoteVideoTrack(null);
        setRemoteCamOff(false);
        setRemoteMicMuted(false);
      });

      // ✅ NEW: actually surface video tracks instead of only publishing them.
      room.on(RoomEvent.LocalTrackPublished, (publication) => {
        if (mountedRef.current && publication.kind === Track.Kind.Video && publication.videoTrack) {
          setLocalVideoTrack(publication.videoTrack);
        }
      });
      room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
        if (publication.kind === Track.Kind.Video) setLocalVideoTrack(null);
      });
      room.on(RoomEvent.TrackSubscribed, (track, pub) => {
        if (!mountedRef.current) return;
        if (track.kind === Track.Kind.Video) { setRemoteVideoTrack(track); setRemoteCamOff(!!pub?.isMuted); }
        else if (track.kind === Track.Kind.Audio) setRemoteMicMuted(!!pub?.isMuted);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Video) setRemoteVideoTrack(null);
      });
      // ✅ NEW: the other person hid / showed their camera, or muted / unmuted
      room.on(RoomEvent.TrackMuted, (pub, participant) => {
        if (!mountedRef.current || participant?.isLocal) return;
        if (pub.source === Track.Source.Camera) setRemoteCamOff(true);
        if (pub.source === Track.Source.Microphone) setRemoteMicMuted(true);
      });
      room.on(RoomEvent.TrackUnmuted, (pub, participant) => {
        if (!mountedRef.current || participant?.isLocal) return;
        if (pub.source === Track.Source.Camera) setRemoteCamOff(false);
        if (pub.source === Track.Source.Microphone) setRemoteMicMuted(false);
      });

      await room.connect(LIVEKIT_URL, token);

      // FIX: setMicrophoneEnabled / setCameraEnabled create AND publish the
      // track in one call — there's no separate createAudioTrack/createVideoTrack
      // method on LocalParticipant. This also matches toggleMute/toggleCamera below.
      await room.localParticipant.setMicrophoneEnabled(true);
      if (callType === 'video') {
        await room.localParticipant.setCameraEnabled(true);
      }

    } catch (err) {
      console.error('LiveKit call error:', err);
      if (mountedRef.current) setCallState(prev => ({ ...prev, isConnecting: false }));
    }
  }, [currentUserId, displayName]);

  const startCall = useCallback(async (convId: string, callType: 'voice' | 'video') => {
    if (!LIVEKIT_URL) {
      Alert.alert('Call Setup', 'LiveKit URL not configured. Set LIVEKIT_URL in app.config.js extras.');
      return;
    }

    if (Platform.OS === 'android') {
      const perms = callType === 'video'
        ? [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
        : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      const results = await PermissionsAndroid.requestMultiple(perms);
      const denied  = perms.some(p => results[p] !== PermissionsAndroid.RESULTS.GRANTED);
      if (denied) {
        setCallState(prev => ({ ...prev, permDenied: true }));
        return;
      }
    }

    const roomName = `call_${convId}`;
    // ✅ NEW: one id per call attempt, sent on ALL THREE channels below
    // (per-conversation broadcast, per-user broadcast, push) so the callee's
    // phone recognises them as the same call and rings only once.
    const callId = `${roomName}_${Date.now()}`;
    isCallerRef.current = true;
    setCallState(prev => ({
      ...prev, isInCall: true, callType,
      isConnecting: true, remoteConnected: false, permDenied: false,
    }));
    setIncomingCall(prev => (prev?.roomName === roomName ? null : prev));

    // ✅ NEW: tell the other participant a call is starting, so their
    // screen can show the incoming-call UI and join the same room.
    try {
      await signalRef.current?.send({
        type: 'broadcast', event: 'incoming_call',
        payload: {
          callerId: currentUserId, callerName: displayName || 'Someone', callerPhoto,
          callType, roomName, conversationId: convId, callId,
        },
      });
    } catch (e) { console.error('incoming_call broadcast error:', e); }

    // ✅ NEW: also ring the callee's GLOBAL signal channel, so the banner
    // shows up regardless of which screen they're currently on — not just
    // when this exact chat screen happens to be mounted (which is all the
    // per-conversation broadcast above can ever reach).
    if (otherUserId) {
      broadcastToUserChannel(otherUserId, 'incoming_call', {
        callerId: currentUserId, callerName: displayName || 'Someone',
        callerPhoto, callType, roomName, conversationId: convId, callId,
      });
    }

    // ✅ NEW: also ring them via push, so it reaches backgrounded/killed
    // devices, not just an already-open chat screen.
    if (otherUserId) {
      sendCallPush({
        calleeId: otherUserId, callerId: currentUserId,
        callerName: displayName || 'Someone', callType, roomName, conversationId: convId,
        callerPhoto, callId,
      });
    }

    try {
      await joinLiveKitRoom(roomName, callType);
    } catch (err) {
      console.error('LiveKit call error:', err);
      if (mountedRef.current) setCallState(prev => ({ ...prev, isConnecting: false }));
    }
  }, [currentUserId, displayName, otherUserId, joinLiveKitRoom]);

  const endCall = useCallback(() => {
    // If we're still ringing (nobody joined yet), let the other side know
    // to stop showing the incoming-call banner.
    setCallState(prev => {
      const roomName = conversationId ? `call_${conversationId}` : '';
      if (prev.isInCall && !prev.remoteConnected) {
        signalRef.current?.send({
          type: 'broadcast', event: 'call_cancelled',
          payload: { roomName },
        }).catch(() => {});
        // ✅ NEW: clears the GLOBAL banner too (see globalIncomingSignal.tsx)
        // — without this, giving up on a call before anyone answers would
        // leave the callee's any-screen banner ringing for the full 30s
        // even though the caller already hung up.
        if (otherUserId) {
          broadcastToUserChannel(otherUserId, 'call_cancelled_global', { roomName });
        }
        // ✅ NEW: only log "missed" if I'm the one who placed the call and
        // gave up before anyone answered — a callee backing out during the
        // brief connecting window right after accepting isn't a missed
        // call, so isCallerRef guards against mislabeling that case.
        if (roomName && isCallerRef.current) {
          logCallOnce(roomName, prev.callType, 'missed');
          // ✅ NEW (fix #2): fire the missed-call push described above —
          // see sendMissedCallPush's own comment for the one assumption
          // this depends on server-side.
          if (otherUserId) {
            sendMissedCallPush({
              calleeId: otherUserId, callerId: currentUserId,
              callerName: displayName || 'Someone', callType: prev.callType,
              roomName, conversationId: conversationId || '',
            });
          }
        }
      } else if (prev.isInCall && prev.remoteConnected && roomName) {
        // ✅ NEW: the call actually connected — log it as completed with
        // however long it ran. callDuration is already tracked to the
        // second by the existing timerRef interval, so no extra timing
        // logic is needed here.
        logCallOnce(roomName, prev.callType, 'completed', prev.callDuration);
      }
      return prev;
    });
    if (timerRef.current) clearInterval(timerRef.current);
    if (roomRef.current) {
      try { roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    AudioSession.stopAudioSession().catch(() => {});
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    isCallerRef.current = false;
    setCallState(CALL_INITIAL);
  }, [conversationId, logCallOnce, otherUserId, currentUserId, displayName]);

  // ✅ NEW (fix #1): keep endCallRef pointed at the current endCall closure
  // so the ParticipantDisconnected handler above (defined earlier, inside
  // joinLiveKitRoom) always calls the up-to-date version — see the comment
  // on endCallRef's declaration for why a ref is needed here at all.
  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  // ✅ NEW: the caller no longer rings forever. If nobody answers within
  // 1 min 30 s the call ends by itself — exactly like pressing hang-up before
  // an answer: it is logged as "No answer", the other phone stops ringing, and
  // they get a "Missed call" notification.
  const CALL_RING_TIMEOUT_MS = 90000;
  useEffect(() => {
    if (!(callState.isInCall && !callState.remoteConnected && isCallerRef.current)) return;
    const t = setTimeout(() => { endCallRef.current?.(); }, CALL_RING_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [callState.isInCall, callState.remoteConnected]);

  // ✅ NEW: accept an incoming call — joins the same LiveKit room the
  // caller created (deterministic room name from the conversation id).
  // ✅ FIX: this used to call startCall(), which unconditionally
  // re-broadcasts 'incoming_call' and re-sends a call push — exactly what
  // caused the caller's screen to see a bogus second "incoming call" the
  // moment the callee accepted. Accepting a call should only join the
  // room that's already ringing, never re-signal a new one.
  const acceptCall = useCallback(async () => {
    if (!incomingCall || !conversationId) return;
    const { callType, roomName } = incomingCall;
    isCallerRef.current = false;
    setIncomingCall(null);
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);

    if (Platform.OS === 'android') {
      const perms = callType === 'video'
        ? [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
        : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
      const results = await PermissionsAndroid.requestMultiple(perms);
      const denied  = perms.some(p => results[p] !== PermissionsAndroid.RESULTS.GRANTED);
      if (denied) {
        setCallState(prev => ({ ...prev, permDenied: true }));
        return;
      }
    }

    setCallState(prev => ({
      ...prev, isInCall: true, callType,
      isConnecting: true, remoteConnected: false, permDenied: false,
    }));
    await joinLiveKitRoom(roomName, callType);
  }, [incomingCall, conversationId, joinLiveKitRoom]);

  // ✅ NEW: decline an incoming call — tells the caller so they can stop
  // ringing instead of timing out.
  const declineCall = useCallback(() => {
    if (!incomingCall) return;
    signalRef.current?.send({
      type: 'broadcast', event: 'call_declined',
      payload: { roomName: incomingCall.roomName },
    }).catch(() => {});
    if (conversationId) logCallOnce(incomingCall.roomName, incomingCall.callType, 'declined');
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    setIncomingCall(null);
  }, [incomingCall, conversationId, logCallOnce]);

  // ✅ NEW (fix — plain notification tap should show the chooser, not
  // silently auto-answer): Android does not render the Decline/Answer
  // action buttons on a notification delivered while the app is
  // backgrounded/killed (a documented expo-notifications limitation, not
  // something fixable from this side — see expo/expo#36282, #31503).
  // That means, in practice, EVERY tap on a killed-app call notification
  // arrives here with no action identifier at all — previously that was
  // treated the same as "Answer", auto-joining LiveKit audio with zero UI
  // reflecting it (you'd just start hearing sound while looking at the
  // normal chat screen). This instead synthesizes the exact same
  // incomingCall state the realtime in-app banner uses, so the person
  // sees the real Answer/Decline choice once the app actually opens —
  // just one tap later than the buttons themselves would have been.
  const presentIncomingCallPrompt = useCallback((payload: IncomingCall) => {
    // ✅ CHANGED: opens the shared full-screen incoming screen instead of this
    // chat's own modal.
    const p = parseRingData({ type: 'incoming_call', ...payload, conversationId: conversationId || '' });
    if (p) showIncoming(p, { expanded: true, force: true });
  }, [conversationId]);

  const presentIncomingCowatchPrompt = useCallback((payload: IncomingCowatch) => {
    const p = parseRingData({ type: 'cowatch_invite', ...payload, conversationId: conversationId || '' });
    if (p) showIncoming(p, { expanded: true, force: true });
  }, [conversationId]);

  // ✅ NEW (fix #3): dismiss an incoming cowatch invite without joining —
  // the "Dismiss" side of the banner. Accepting is just openCowatch(
  // incomingCowatch.sessionId) from the screen component (below), which
  // reuses the existing "join an already-active session" path.
  const dismissCowatchInvite = useCallback(() => {
    if (cowatchRingTimerRef.current) clearTimeout(cowatchRingTimerRef.current);
    setIncomingCowatch(null);
  }, []);

  const toggleMute = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !callState.isMuted;
    await roomRef.current.localParticipant.setMicrophoneEnabled(!next);
    setCallState(p => ({ ...p, isMuted: next }));
  }, [callState.isMuted]);

  const toggleCamera = useCallback(async () => {
    if (!roomRef.current) return;
    const next = !callState.isVideoOff;
    await roomRef.current.localParticipant.setCameraEnabled(!next);
    setCallState(p => ({ ...p, isVideoOff: next }));
  }, [callState.isVideoOff]);

  // ✅ FIX: actually route audio output instead of only flipping an icon.
  // AudioSession.selectAudioOutput comes from @livekit/react-native and
  // switches the native call audio route (speaker vs. earpiece/default).
  const toggleSpeaker = useCallback(async () => {
    const next = !callState.isSpeakerOn;
    try {
      await AudioSession.selectAudioOutput(next ? 'force_speaker' : 'default');
    } catch (e) {
      console.error('selectAudioOutput error:', e);
    }
    setCallState(p => ({ ...p, isSpeakerOn: next }));
  }, [callState.isSpeakerOn]);

  return {
    callState, incomingCall, localVideoTrack, remoteVideoTrack,
    remoteCamOff, remoteMicMuted,
    startCall, endCall, acceptCall, declineCall,
    toggleMute, toggleCamera, toggleSpeaker,
    // ✅ NEW (fix #3): incoming cowatch invite banner state + dismiss.
    incomingCowatch, dismissCowatchInvite,
    // ✅ NEW: synthesize either prompt from route params (notification tap).
    presentIncomingCallPrompt, presentIncomingCowatchPrompt,
    // ✅ NEW: exposed so ChatScreen's autoAnswerCall effect (notification-
    // tap auto-answer) can join a room directly, the same safe way
    // acceptCall does, without needing incomingCall state to already be
    // populated locally (which it won't be on a cold start from a killed
    // app — the original broadcast fired before this screen even mounted).
    joinLiveKitRoom,
    // FIX: the auto-answer effect below calls setCallState directly (the
    // same isInCall/callType/isConnecting shape startCall/acceptCall already
    // use) but this was never actually returned from the hook, causing a
    // "Cannot find name 'setCallState'" TS error and a downstream implicit-
    // any error on its callback param. Exposing the real setter (already
    // correctly typed via useState<CallState> above) fixes both.
    setCallState,
  };
}

// ── TYPES ─────────────────────────────────────────────────────
interface ChatUser {
  id: string; username: string;
  display_name: string; photo_url?: string;
}
interface MessageReaction {
  id: string; message_id: string; user_id: string;
  emoji: string; created_at: string; user?: ChatUser;
}
interface Message {
  id: string; conversation_id: string; sender_id: string; created_at: string;
  // ✅ FIX: TS2678 — 'cowatch_log' (added for fix #4, the inline "Watch
  // Together" chat card) was used in the render switch below but never
  // added to this union, so TypeScript rejected the comparison. No DB
  // migration needed for this one specifically: 'call_log' cards are
  // already rendering correctly in your screenshots, which proves
  // messages.message_type accepts new string values fine (it's not a
  // locked-down Postgres enum) — 'cowatch_log' will insert the same way.
  message_type: 'text' | 'voice' | 'image' | 'video' | 'gif' | 'sticker' | 'system' | 'call_log' | 'cowatch_log' | 'gift';
  content?: string; media_url?: string; media_duration?: number;
  media_thumbnail?: string; shared_video_id?: string;
  shared_video_title?: string; shared_video_thumbnail?: string;
  shared_video_views?: string; is_read: boolean; is_deleted: boolean;
  delivered_at?: string | null; media_opened_at?: string | null;
  is_disappearing: boolean; disappears_at?: string;
  reply_to_message_id?: string; reply_to_message?: Message;
  reactions?: MessageReaction[]; sender?: ChatUser;
}

function safeReactions(msg: Message): MessageReaction[] {
  if (!msg.reactions || !Array.isArray(msg.reactions)) return [];
  return msg.reactions;
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

function formatSecs(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── SERVICE CALLS ─────────────────────────────────────────────
async function getMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
  if (!isValidUUID(conversationId)) return [];
  try {
    let query = (supabase as any)
      .from('messages').select('*')
      .eq('conversation_id', conversationId).eq('is_deleted', false)
      .order('created_at', { ascending: false }).limit(limit);
    if (before) query = query.lt('created_at', before);
    const { data: msgs, error } = await query;
    if (error) throw error;
    if (!msgs || msgs.length === 0) return [];
    const messages = [...msgs].reverse();

    const senderIds = [...new Set(messages.map((m: any) => m.sender_id).filter(Boolean))];
    const { data: senders } = await supabase
      .from('users').select('id, username, display_name, photo_url').in('id', senderIds);
    const senderMap: Record<string, any> = {};
    (senders || []).forEach((u: any) => { senderMap[u.id] = u; });

    const msgIds = messages.map((m: any) => m.id);
    const { data: reactions } = await supabase
      .from('message_reactions').select('*').in('message_id', msgIds);
    const reactionsMap: Record<string, any[]> = {};
    (reactions || []).forEach((r: any) => {
      if (!reactionsMap[r.message_id]) reactionsMap[r.message_id] = [];
      reactionsMap[r.message_id].push(r);
    });

    const replyIds = messages.map((m: any) => m.reply_to_message_id).filter(Boolean);
    const replyMap: Record<string, any> = {};
    if (replyIds.length > 0) {
      const { data: replies } = await supabase
        .from('messages').select('id, content, message_type, sender_id').in('id', replyIds);
      (replies || []).forEach((r: any) => { replyMap[r.id] = { ...r, sender: senderMap[r.sender_id] }; });
    }

    return messages.map((m: any) => ({
      ...m,
      sender:             senderMap[m.sender_id] || undefined,
      reactions:          reactionsMap[m.id] || [],
      reply_to_message:   m.reply_to_message_id ? replyMap[m.reply_to_message_id] : undefined,
    })) as Message[];
  } catch (error) { console.error('getMessages error:', error); return []; }
}

// ✅ NEW: every message gets its id on the PHONE before it is sent. If the
// network drops right after the server saved it and we retry, the server says
// "already exists" and we just fetch it — so a retry can never send it twice.
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
async function insertMessageRow(payload: any): Promise<Message> {
  const { data, error } = await supabase.from('messages').insert(payload).select('*').single();
  if (error) {
    if ((error as any).code === '23505' && payload.id) {
      const { data: existing } = await supabase.from('messages').select('*').eq('id', payload.id).single();
      if (existing) return { ...existing, reactions: [] } as Message;
    }
    throw error;
  }
  return { ...data, reactions: [] } as Message;
}

async function sendTextMessage(
  conversationId: string, senderId: string, content: string,
  replyToId?: string, isDisappearing?: boolean, duration?: number, id?: string,
): Promise<Message | null> {
  try {
    const payload: any = {
      conversation_id: conversationId, sender_id: senderId,
      message_type: 'text', content, is_disappearing: isDisappearing || false,
    };
    if (id) payload.id = id;
    if (replyToId) payload.reply_to_message_id = replyToId;
    if (isDisappearing && duration) {
      const exp = new Date(); exp.setSeconds(exp.getSeconds() + duration);
      payload.disappears_at = exp.toISOString();
    }
    return await insertMessageRow(payload);
  } catch (error) { console.error('sendTextMessage error:', error); return null; }
}

async function sendMediaMessage(
  conversationId: string, senderId: string,
  mediaUrl: string, mediaType: 'voice' | 'image' | 'video', duration?: number,
  replyToId?: string, caption?: string, id?: string,
): Promise<Message | null> {
  try {
    return await insertMessageRow({
      conversation_id: conversationId, sender_id: senderId,
      message_type: mediaType, media_url: mediaUrl, media_duration: duration,
      ...(id ? { id } : {}),
      ...(caption ? { content: caption } : {}),
      ...(replyToId ? { reply_to_message_id: replyToId } : {}),
    });
  } catch (error) { console.error('sendMediaMessage error:', error); return null; }
}

// ✅ NEW: call log entries in the chat thread — "Missed call", "Declined",
// or a completed call's duration, the same way WhatsApp shows them inline
// in the conversation. Deliberately reuses the existing `content` column
// (a small JSON string) and `media_duration` (already an int column, used
// today for voice-note length) instead of adding new DB columns — the
// only new thing is the 'call_log' message_type value itself. If your
// `messages.message_type` column is a Postgres ENUM (not a plain text
// column), this insert will fail with "invalid input value for enum"
// until you run:
//   ALTER TYPE message_type_enum ADD VALUE 'call_log';
// (exact type name may differ — check your schema). If it's a plain text
// column, which is the more common setup, this works with zero DB changes.
async function insertCallLogMessage(
  conversationId: string, senderId: string,
  callType: 'voice' | 'video', outcome: 'missed' | 'declined' | 'completed',
  durationSeconds?: number,
): Promise<void> {
  try {
    await supabase.from('messages').insert({
      conversation_id: conversationId, sender_id: senderId,
      message_type: 'call_log',
      content: JSON.stringify({ callType, outcome }),
      media_duration: outcome === 'completed' ? Math.max(0, durationSeconds || 0) : null,
    });
  } catch (e) { console.error('insertCallLogMessage error:', e); }
}

function formatCallDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const mins = Math.floor(totalSeconds / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs >= 1) {
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs} hr ${remMins} min` : `${hrs} hr`;
  }
  return `${mins} min`;
}

async function addReaction(messageId: string, userId: string, emoji: string): Promise<void> {
  try {
    await supabase.from('message_reactions').upsert({ message_id: messageId, user_id: userId, emoji });
  } catch (error) { console.error('addReaction error:', error); }
}

async function softDeleteMessage(messageId: string, userId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('messages')
      .update({ is_deleted: true }).eq('id', messageId).eq('sender_id', userId);
    return !error;
  } catch { return false; }
}

async function markAsRead(conversationId: string, userId: string): Promise<void> {
  try {
    // ✅ CHANGED: the old direct update was silently refused by the database
    // (only the SENDER may edit a message), so messages never became "read" and
    // the sender never saw green ticks. This server function does it properly.
    const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId });
    if (error) throw error;
  } catch (error) { console.error('markAsRead error:', error); }
}

async function toggleDisappearing(conversationId: string, enabled: boolean): Promise<void> {
  try {
    await supabase.from('conversations')
      .update({ disappearing_enabled: enabled, disappearing_duration: 86400 }).eq('id', conversationId);
  } catch (error) { console.error('toggleDisappearing error:', error); }
}

async function getStreak(userId: string, otherUserId: string): Promise<number> {
  try {
    const { data } = await supabase.from('user_streaks').select('streak_count')
      .eq('user_id', userId).eq('other_user_id', otherUserId).single();
    return data?.streak_count || 0;
  } catch { return 0; }
}

function subscribeToMessages(conversationId: string, onMessage: (msg: Message) => void, onUpdate?: (row: any) => void): RealtimeChannel {
  // FIX: same remount race fixed in circle/group/messages.tsx.
  const mountId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return supabase.channel(`messages:${conversationId}:${mountId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, async (payload: any) => {
      const { data } = await supabase.from('messages').select('*').eq('id', payload.new.id).single();
      if (data) onMessage({ ...data, reactions: [] } as Message);
    })
    // ✅ NEW: before, the chat never listened for UPDATEs, so the sender's ticks
    // only changed after reloading the chat. Now they change live.
    .on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload: any) => { try { onUpdate?.(payload.new); } catch (_) {} })
    .subscribe();
}

function subscribeToReactions(conversationId: string, onChange: () => void): RealtimeChannel {
  const mountId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return supabase.channel(`reactions:${conversationId}:${mountId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' },
      () => onChange()).subscribe();
}

// FIX: same wrong-cloud-name bug found and fixed in circle/[id].tsx and
// group/[id].tsx earlier this session — 'dvikzffqe'/'unsigned_preset_name'
// aren't your real Cloudinary account, hardcoding the proven values instead.
const CLOUD_NAME    = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    || 'dvllxm0wg';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'Kinsta_unsigned';

// ✅ CHANGED: XMLHttpRequest instead of fetch so we can report upload progress
// and give up after a timeout (before, a bad network could leave "Uploading…"
// spinning forever with no way to know).
function uploadToCloudinary(fileUri: string, type: 'voice' | 'image' | 'video', onProgress?: (pct: number) => void, handle?: { abort?: () => void }): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const ext      = type === 'voice' ? 'm4a' : type === 'video' ? 'mp4' : 'jpg';
      const mime     = type === 'voice' ? 'audio/m4a' : type === 'video' ? 'video/mp4' : 'image/jpeg';
      const resType  = type === 'image' ? 'image' : 'video';
      const formData = new FormData();
      formData.append('file', { uri: fileUri, type: mime, name: `${type}_${Date.now()}.${ext}` } as any);
      formData.append('upload_preset', UPLOAD_PRESET);
      formData.append('folder', `lumvibe_chat/${type}s`);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resType}/upload`);
      xhr.timeout = type === 'video' ? 180000 : 90000;
      xhr.upload.onprogress = (e: any) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        try {
          if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).secure_url || null);
          else { console.warn('Cloudinary upload failed', xhr.status, (xhr.responseText || '').slice(0, 200)); resolve(null); }
        } catch { resolve(null); }
      };
      xhr.onerror   = () => { console.warn('Cloudinary upload network error'); resolve(null); };
      xhr.onabort   = () => resolve(null);
      if (handle) handle.abort = () => { try { xhr.abort(); } catch (_) {} };
      xhr.ontimeout = () => { console.warn('Cloudinary upload timed out'); resolve(null); };
      xhr.send(formData);
    } catch (error) { console.error('uploadToCloudinary error:', error); resolve(null); }
  });
}

// ── usePresence ───────────────────────────────────────────────
function usePresence(currentUserId: string | null, otherUserId: string | null): boolean {
  const [isOnline, setIsOnline] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!currentUserId || !otherUserId) return;
    const channel = supabase.channel('presence:chat', {
      config: { presence: { key: currentUserId } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        const state  = channel.presenceState();
        setIsOnline(Object.keys(state).includes(otherUserId));
      })
      .on('presence', { event: 'join' }, ({ key }: { key: string }) => {
        if (key === otherUserId) setIsOnline(true);
      })
      .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
        if (key === otherUserId) setIsOnline(false);
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
        }
      });
    channelRef.current = channel;
    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [currentUserId, otherUserId]);

  return isOnline;
}

// ── useMessages ───────────────────────────────────────────────
function useMessages(
  conversationId: string | null, currentUserId: string | null,
  disappearingEnabled: boolean, disappearingDuration: number,
  // ✅ FIX: these two are what the "Cannot find name 'otherUserId'" /
  // "Cannot find name 'userProfile'" errors were pointing at — this hook
  // is a separate function from ChatScreen() below, so it never had access
  // to those two names at all; they only exist in ChatScreen()'s own
  // scope. Passing them in as parameters instead of referencing them
  // directly.
  otherUserId: string | null, senderUsername: string, senderDisplayName: string,
  // ✅ NEW: needed so the recipient's push-tap can show the real sender's
  // avatar instead of a generic placeholder — see notifyNewMessage below.
  senderPhoto: string,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const channelRef   = useRef<RealtimeChannel | null>(null);
  const reactionsRef = useRef<RealtimeChannel | null>(null);

  const cacheLoadedRef = useRef(false);
  const messagesRef    = useRef<Message[]>([]);
  const loadMessages = useCallback(async () => {
    if (!conversationId || !isValidUUID(conversationId)) { setLoading(false); return; }
    try {
      // ✅ NEW: show the last saved copy of this chat INSTANTLY (even with no
      // internet), then refresh it from the server.
      const cacheKey = `lumvibe_chat_cache_${conversationId}`;
      if (!cacheLoadedRef.current) {
        cacheLoadedRef.current = true;
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          if (raw) { setMessages(JSON.parse(raw)); setLoading(false); }
        } catch (_) {}
      }
      const data = await getMessages(conversationId);
      if (data.length > 0) {
        setMessages(data);
        AsyncStorage.setItem(cacheKey, JSON.stringify(data.slice(-60))).catch(() => {});
      } else {
        setMessages(prev => prev.length ? prev : data);   // offline: keep what we have
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [conversationId]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    loadMessages();
    if (conversationId && currentUserId) markAsRead(conversationId, currentUserId);
    if (conversationId) {
      channelRef.current = subscribeToMessages(conversationId, (newMsg) => {
        setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, {
          ...newMsg,
          reply_to_message: newMsg.reply_to_message_id ? prev.find(m => m.id === newMsg.reply_to_message_id) : undefined,
        }]);
        if (newMsg.sender_id !== currentUserId && conversationId && currentUserId)
          markAsRead(conversationId, currentUserId);
      }, (row) => {
        setMessages(prev => prev.map(m => m.id === row.id
          ? { ...m, is_read: row.is_read, delivered_at: row.delivered_at, media_opened_at: row.media_opened_at } as any
          : m));
      });
      reactionsRef.current = subscribeToReactions(conversationId, loadMessages);
    }
    return () => {
      if (channelRef.current)   { supabase.removeChannel(channelRef.current);   channelRef.current = null; }
      if (reactionsRef.current) { supabase.removeChannel(reactionsRef.current); reactionsRef.current = null; }
    };
  }, [conversationId, currentUserId, loadMessages]);

  // ═════════ ✅ NEW: OUTBOX — photos, videos and voice notes ═════════
  // Before: sending set one global "sending" flag (so you could not type while
  // a voice note uploaded), and a failed upload simply vanished. Now every
  // item uploads on its own: you can keep typing, recording and sending other
  // things; a failed item stays in the chat (playable) with a Retry button, is
  // saved on the phone so it survives closing the app, and is retried
  // automatically when the internet comes back.
  const [outbox, setOutbox] = useState<any[]>([]);
  const outboxRef       = useRef<any[]>([]);
  const abortersRef     = useRef<Record<string, { abort?: () => void }>>({});
  const cancelledRef    = useRef<Set<string>>(new Set());
  const uploadedUrlRef  = useRef<Record<string, string>>({});
  const persistChain    = useRef<Promise<void>>(Promise.resolve());
  const outboxKey       = conversationId ? `lumvibe_outbox_${conversationId}` : null;
  useEffect(() => { outboxRef.current = outbox; }, [outbox]);

  const persistOutbox = useCallback((mutate: (list: any[]) => any[]) => {
    if (!outboxKey) return;
    persistChain.current = persistChain.current.then(async () => {
      try {
        const raw = await AsyncStorage.getItem(outboxKey);
        await AsyncStorage.setItem(outboxKey, JSON.stringify(mutate(raw ? JSON.parse(raw) : [])));
      } catch (_) {}
    });
  }, [outboxKey]);

  const patchOutbox = useCallback((id: string, patch: any) =>
    setOutbox(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m)), []);

  const runJob = useCallback(async (job: any) => {
    if (!conversationId || !currentUserId) return;
    if (abortersRef.current[job.id]) return;            // already sending
    cancelledRef.current.delete(job.id);
    const handle: { abort?: () => void } = {};
    abortersRef.current[job.id] = handle;
    patchOutbox(job.id, { _uploading: true, _failed: false, _progress: 0 });
    let msg: Message | null = null;

    if (job.kind === 'text') {
      try {
        msg = await sendTextMessage(conversationId, currentUserId, job.text, job.replyToId, job.disappearing, job.dur, job.msgId);
      } catch (_) {}
      delete abortersRef.current[job.id];
    } else {
      let url: string | null = uploadedUrlRef.current[job.id] || null;
      try {
        if (!url) {
          const src = job.kind === 'image' ? await compressImage(job.uri) : job.uri;
          url = await uploadToCloudinary(src, job.kind, pct => patchOutbox(job.id, { _progress: pct }), handle);
          if (url) uploadedUrlRef.current[job.id] = url;
        }
      } catch (_) {}
      delete abortersRef.current[job.id];
      if (cancelledRef.current.has(job.id)) { cancelledRef.current.delete(job.id); return; }
      if (!url) { patchOutbox(job.id, { _uploading: false, _failed: true }); return; }
      msg = await sendMediaMessage(conversationId, currentUserId, url, job.kind, job.duration, job.replyToId, job.caption, job.msgId);
    }

    if (cancelledRef.current.has(job.id)) { cancelledRef.current.delete(job.id); return; }
    if (!msg) { patchOutbox(job.id, { _uploading: false, _failed: true }); return; }
    delete uploadedUrlRef.current[job.id];
    const done = msg;
    setOutbox(prev => prev.filter(m => m.id !== job.id));
    setMessages(prev => prev.find(m => m.id === done.id) ? prev : [...prev, done]);
    persistOutbox(list => list.filter(j => j.id !== job.id));
    if (otherUserId) {
      const label = job.kind === 'text' ? job.text
        : job.kind === 'voice' ? '🎤 Voice message'
        : job.kind === 'video' ? (job.replyToId ? '🎥 Video reply' : '🎥 Video') : '📷 Photo';
      notifyNewMessage(
        otherUserId, currentUserId, senderUsername, senderDisplayName, label, conversationId, senderPhoto
      ).catch(e => console.warn('Push notify (message) failed:', e));
    }
  }, [conversationId, currentUserId, otherUserId, senderUsername, senderDisplayName, senderPhoto, patchOutbox, persistOutbox]);

  const enqueueJob = useCallback((p: { kind: 'text' | 'voice' | 'image' | 'video'; uri?: string; text?: string; duration?: number; replyToId?: string; caption?: string }): boolean => {
    if (!conversationId || !currentUserId) return false;
    const job = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      msgId: uuidv4(), ...p,
      disappearing: disappearingEnabled, dur: disappearingDuration,
      createdAt: new Date().toISOString(),
    };
    const temp = jobToMessage(job, conversationId, currentUserId, false);
    if (p.replyToId) temp.reply_to_message = messagesRef.current.find(m => m.id === p.replyToId);
    setOutbox(prev => [...prev, temp]);
    persistOutbox(list => [...list, job]);
    runJob(job);
    return true;
  }, [conversationId, currentUserId, disappearingEnabled, disappearingDuration, persistOutbox, runJob]);

  const sendVoiceNote = useCallback(async (fileUri: string, duration: number): Promise<boolean> =>
    enqueueJob({ kind: 'voice', uri: fileUri, duration }), [enqueueJob]);
  const sendImage = useCallback(async (fileUri: string, caption?: string): Promise<boolean> =>
    enqueueJob({ kind: 'image', uri: fileUri, caption }), [enqueueJob]);
  const sendVideo = useCallback(async (fileUri: string, replyToId?: string, duration?: number, caption?: string): Promise<boolean> =>
    enqueueJob({ kind: 'video', uri: fileUri, duration, replyToId, caption }), [enqueueJob]);
  // ✅ CHANGED: text now shows in the chat the instant you press send (before,
  // it waited for the server and then for the realtime echo — slow, and with no
  // internet it simply never appeared). It waits in the outbox until it is saved.
  const sendText = useCallback(async (text: string, replyToId?: string): Promise<boolean> =>
    enqueueJob({ kind: 'text', text, replyToId }), [enqueueJob]);

  // receiver opened / watched / played a photo, video or voice note → green ticks for the sender
  const markMediaOpened = useCallback((m: Message) => {
    if (!currentUserId || m.sender_id === currentUserId || (m as any).media_opened_at || String(m.id).startsWith('temp-')) return;
    const now = new Date().toISOString();
    setMessages(prev => prev.map(x => x.id === m.id ? ({ ...x, media_opened_at: now, is_read: true } as any) : x));
    supabase.rpc('mark_media_opened', { p_message_id: m.id }).then(() => {}, () => {});
  }, [currentUserId]);

  const retryUpload = useCallback((m: any) => {
    const found = outboxRef.current.find(x => x.id === m.id);
    if (found?._job) runJob(found._job);
  }, [runJob]);

  const cancelUpload = useCallback((m: any) => {
    const id = m.id as string;
    cancelledRef.current.add(id);
    abortersRef.current[id]?.abort?.();
    delete abortersRef.current[id];
    delete uploadedUrlRef.current[id];
    setOutbox(prev => prev.filter(x => x.id !== id));
    persistOutbox(list => list.filter(j => j.id !== id));
  }, [persistOutbox]);

  // bring back anything that was still unsent when the app was closed
  useEffect(() => {
    if (!outboxKey || !conversationId || !currentUserId) return;
    let dead = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(outboxKey);
        const list: any[] = raw ? JSON.parse(raw) : [];
        if (dead || !list.length) return;
        setOutbox(prev => {
          const have = new Set(prev.map(m => m.id));
          return [...prev, ...list.filter(j => !have.has(j.id)).map(j => jobToMessage(j, conversationId, currentUserId, true))];
        });
        const net = await NetInfo.fetch();
        if (!dead && net.isConnected && net.isInternetReachable !== false) list.forEach(j => runJob(j));
      } catch (_) {}
    })();
    return () => { dead = true; };
  }, [outboxKey, conversationId, currentUserId, runJob]);

  // when the internet comes back, retry whatever failed
  useEffect(() => {
    let wasOnline: boolean | null = null;
    const unsub = NetInfo.addEventListener(state => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (online && wasOnline === false) {
        outboxRef.current.filter(m => m._failed && m._job).forEach(m => runJob(m._job));
      }
      wasOnline = online;
    });
    return () => { unsub(); };
  }, [runJob]);

  const allMessages = useMemo(() => outbox.length
    ? [...messages, ...outbox].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    : messages, [messages, outbox]);

  const reactToMessage = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    if (!currentUserId) return;
    await addReaction(messageId, currentUserId, emoji);
  }, [currentUserId]);

  // ✅ NEW: gifts in chat — same server rules as feed gifts (send_gift):
  // whole coins, 1–5,000. The receiver is decided on the SERVER.
  const sendGift = useCallback(async (amount: number, label: string, icon: string): Promise<{ ok: boolean; error?: string; newBalance?: number }> => {
    if (!conversationId || !currentUserId) return { ok: false, error: 'Chat not ready.' };
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('send_chat_gift', {
        p_conversation_id: conversationId, p_amount: amount, p_label: label, p_icon: icon,
      });
      if (error) return { ok: false, error: error.message };
      if (!data?.success) return { ok: false, error: data?.error || 'Could not send gift.' };
      const msg = { ...(data.message as Message), reactions: [] } as Message;
      setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      if (otherUserId) {
        notifyNewMessage(
          otherUserId, currentUserId, senderUsername, senderDisplayName,
          '🎁 Sent you a gift', conversationId, senderPhoto
        ).catch(e => console.warn('Push notify (gift) failed:', e));
      }
      return { ok: true, newBalance: data.new_balance };
    } finally { setSending(false); }
  }, [conversationId, currentUserId, otherUserId, senderUsername, senderDisplayName, senderPhoto]);

  const deleteMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!currentUserId) return;
    if (messageId.startsWith('temp-')) { cancelUpload({ id: messageId }); return; }
    const ok = await softDeleteMessage(messageId, currentUserId);
    if (ok) setMessages(prev => prev.filter(m => m.id !== messageId));
  }, [currentUserId, cancelUpload]);

  return { messages: allMessages, loading, sending, sendText, sendVoiceNote, sendImage, sendVideo, sendGift, retryUpload, cancelUpload, markMediaOpened, reactToMessage, deleteMessage };
}

// ── WAVEFORM ──────────────────────────────────────────────────
function Waveform({ isMe }: { isMe: boolean }) {
  const bars = [35, 55, 75, 50, 85, 65, 40, 80, 60, 45, 70, 55, 40, 68, 80];
  return (
    <View style={styles.waveform}>
      {bars.map((h, i) => (
        <View key={i} style={[styles.wbar, {
          height: `${h}%` as any,
          backgroundColor: isMe ? 'rgba(0,0,0,0.35)' : C.green,
          opacity: isMe ? 1 : 0.7,
        }]} />
      ))}
    </View>
  );
}

// ── CALL MODAL ────────────────────────────────────────────────
function CallModal({
  visible, otherName, otherPhoto, callState, localVideoTrack, remoteVideoTrack,
  remoteCamOff, remoteMicMuted, myName, myPhoto,
  onEnd, onToggleMute, onToggleSpeaker, onToggleCamera,
}: {
  visible: boolean; otherName: string; otherPhoto?: string;
  callState: CallState;
  localVideoTrack: Track | null; remoteVideoTrack: Track | null;
  remoteCamOff?: boolean; remoteMicMuted?: boolean;
  myName?: string; myPhoto?: string;
  onEnd: () => void; onToggleMute: () => void;
  onToggleSpeaker: () => void; onToggleCamera: () => void;
}) {
  const { callType } = callState;
  const insets = useSafeAreaInsets();
  // ✅ NEW: show live video once it's flowing; fall back to the avatar
  // card (still connecting, camera off, or plain voice call).
  // ✅ CHANGED: the remote picture is only shown while THEIR camera is on — when
  // they hide it, their avatar card shows instead of a frozen / black frame.
  const showRemoteVideo = callType === 'video' && !!remoteVideoTrack && !remoteCamOff;
  const showLocalPreview = callType === 'video' && !!localVideoTrack && !callState.isVideoOff;
  // ✅ NEW: when YOU hide your camera, your own small tile shows your avatar
  const showLocalAvatar = callType === 'video' && !showLocalPreview && callState.isVideoOff;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={[styles.callModal, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 30 }]}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {/* ✅ NEW: full-screen remote video feed */}
        {showRemoteVideo && (
          <VideoView videoTrack={remoteVideoTrack as any} style={StyleSheet.absoluteFillObject} objectFit="cover" />
        )}

        {/* ✅ NEW: local camera preview, picture-in-picture */}
        {showLocalPreview && (
          <View style={[styles.localPreview, { top: insets.top + 20 }]}>
            <VideoView videoTrack={localVideoTrack as any} style={StyleSheet.absoluteFillObject} objectFit="cover" mirror />
          </View>
        )}

        {showLocalAvatar && (
          <View style={[styles.localPreview, { top: insets.top + 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a1a1a' }]}>
            {myPhoto
              ? <Image source={{ uri: myPhoto }} style={StyleSheet.absoluteFillObject} />
              : <Text style={styles.callAvatarInitial}>{(myName || 'Y')[0].toUpperCase()}</Text>}
          </View>
        )}

        {/* Pulse rings — voice call only, or video before the feed connects */}
        {!showRemoteVideo && callType === 'voice' && callState.remoteConnected && !callState.isConnecting && (
          <>
            <View style={styles.callPulse1} />
            <View style={styles.callPulse2} />
            <View style={styles.callPulse3} />
          </>
        )}

        <View style={styles.callTop}>
          {/* Avatar card — hidden once the remote video feed is live */}
          {!showRemoteVideo && <View style={styles.callAvatarWrap}>
            {otherPhoto
              ? <Image source={{ uri: otherPhoto }} style={styles.callAvatar} />
              : <View style={styles.callAvatarPlaceholder}>
                  <Text style={styles.callAvatarInitial}>{(otherName || 'U')[0].toUpperCase()}</Text>
                </View>}
            {callState.remoteConnected && <View style={styles.callAvatarRing} />}
          </View>}
          <Text style={styles.callName}>{otherName}</Text>
          {/* ✅ NEW: they muted their microphone */}
          {remoteMicMuted && callState.remoteConnected && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <Ionicons name="mic-off" size={14} color={C.red} />
              <Text style={{ color: C.red, fontSize: 12, fontWeight: '600' }}>Muted</Text>
            </View>
          )}
          <Text style={styles.callStatus}>
            {callState.isConnecting ? 'Calling…'
              : callState.remoteConnected ? formatSecs(callState.callDuration)
              : 'Ringing…'}
          </Text>
          <View style={styles.callTypeBadge}>
            <Text style={styles.callTypeText}>
              {callType === 'video' ? 'Video Call' : 'Voice Call'}
            </Text>
          </View>
        </View>

        <View style={styles.callControls}>
          <View style={styles.callCtrl}>
            <TouchableOpacity
              style={[styles.callCtrlBtn, callState.isMuted && styles.callCtrlActive]}
              onPress={onToggleMute}
            >
              <Ionicons name={callState.isMuted ? 'mic-off' : 'mic-outline'} size={22}
                color={callState.isMuted ? C.red : C.white} />
            </TouchableOpacity>
            <Text style={styles.callCtrlLabel}>{callState.isMuted ? 'Unmute' : 'Mute'}</Text>
          </View>

          {callType === 'video' && (
            <View style={styles.callCtrl}>
              <TouchableOpacity
                style={[styles.callCtrlBtn, callState.isVideoOff && styles.callCtrlActive]}
                onPress={onToggleCamera}
              >
                <Ionicons name={callState.isVideoOff ? 'videocam-off' : 'videocam-outline'} size={22}
                  color={callState.isVideoOff ? C.muted : C.white} />
              </TouchableOpacity>
              <Text style={styles.callCtrlLabel}>{callState.isVideoOff ? 'Show' : 'Hide'}</Text>
            </View>
          )}

          <View style={styles.callCtrl}>
            <TouchableOpacity style={[styles.callCtrlBtn, styles.callEndBtn]} onPress={onEnd}>
              <Ionicons name="call" size={24} color={C.white} />
            </TouchableOpacity>
            <Text style={styles.callCtrlLabel}>End</Text>
          </View>

          <View style={styles.callCtrl}>
            <TouchableOpacity
              style={[styles.callCtrlBtn, callState.isSpeakerOn && styles.callCtrlActive]}
              onPress={onToggleSpeaker}
            >
              <Ionicons name={callState.isSpeakerOn ? 'volume-high' : 'volume-mute'} size={22}
                color={callState.isSpeakerOn ? C.green : C.white} />
            </TouchableOpacity>
            <Text style={styles.callCtrlLabel}>Speaker</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ✅ NEW: WhatsApp-style ticks.
//   ✓   saved on the server (sent)
//   ✓✓  grey  = reached the other person's phone (delivered)
//   ✓✓  green = read — and for photos / videos / voice notes, only once the
//               person actually opened, watched or played it.
// Messages from before this change count as "opened" so old chats don't go grey.
const MEDIA_TICK_CUTOFF = Date.parse('2026-11-20T00:00:00Z');
function tickState(m: any): { text: string; green: boolean } {
  const isMedia = (m.message_type === 'voice' || m.message_type === 'image' || m.message_type === 'video') && !m.shared_video_id;
  const legacy = Date.parse(m.created_at) < MEDIA_TICK_CUTOFF;
  if (m.is_read && (!isMedia || m.media_opened_at || legacy)) return { text: '✓✓', green: true };
  if (m.delivered_at || m.is_read) return { text: '✓✓', green: false };
  return { text: '✓', green: false };
}

// ✅ NEW: make a photo smaller BEFORE it uploads (less data, faster, works on weak
// networks). If anything goes wrong we just send the original.
async function compressImage(uri: string): Promise<string> {
  try {
    const M: any = ImageManipulator;
    if (M.ImageManipulator?.manipulate) {
      const ctx = M.ImageManipulator.manipulate(uri);
      ctx.resize({ width: 1280 });
      const ref = await ctx.renderAsync();
      const out = await ref.saveAsync({ compress: 0.7, format: M.SaveFormat?.JPEG || 'jpeg' });
      return out.uri || uri;
    }
    if (M.manipulateAsync) {
      const out = await M.manipulateAsync(uri, [{ resize: { width: 1280 } }], { compress: 0.7, format: M.SaveFormat?.JPEG || 'jpeg' });
      return out.uri || uri;
    }
  } catch (e) { console.warn('compressImage skipped:', e); }
  return uri;
}

type PickedAsset = { uri: string; type: 'image' | 'video'; duration?: number };
function toPickedAsset(a: any): PickedAsset {
  return {
    uri: a.uri, type: a.type === 'video' ? 'video' : 'image',
    duration: a.duration ? Math.round(a.duration > 1000 ? a.duration / 1000 : a.duration) : undefined,
  };
}

// ✅ NEW (outbox): a photo / video / voice note that is still sending, or that
// could not be sent yet. It lives in the chat like a normal message, keeps the
// LOCAL file so you can still look at it / play it, and shows Retry if it failed.
function jobToMessage(job: any, conversationId: string, senderId: string, failed: boolean) {
  return {
    id: job.id, conversation_id: conversationId, sender_id: senderId,
    message_type: job.kind,
    content: job.kind === 'text' ? job.text : job.caption,
    media_url: job.kind === 'text' ? undefined : job.uri,
    media_duration: job.duration,
    reply_to_message_id: job.replyToId, created_at: job.createdAt,
    is_read: false, is_deleted: false, is_disappearing: !!job.disappearing,
    _job: job, _uploading: !failed, _failed: failed, _progress: 0,
  } as any;
}

// ✅ NEW (outbox): the little control on a sending item — ✕ with % while it
// uploads, "Retry" if it failed (same idea as WhatsApp).
function UploadBadge({ message, onCancel, onRetry }: { message: Message; onCancel?: (m: Message) => void; onRetry?: (m: Message) => void }) {
  const m: any = message;
  if (m._failed) {
    return (
      <TouchableOpacity style={styles.retryPill} onPress={() => onRetry?.(message)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="cloud-upload-outline" size={16} color="#fff" />
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    );
  }
  if (m._uploading) {
    return (
      <TouchableOpacity style={styles.cancelPill} onPress={() => onCancel?.(message)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={16} color="#fff" />
        <Text style={styles.retryText}>{m._progress ? `${m._progress}%` : '…'}</Text>
      </TouchableOpacity>
    );
  }
  return null;
}

// ✅ NEW (video replies): one-line description of a message, used in reply
// previews so a replied-to photo / voice note / video doesn't show blank.
function replyPreviewText(m?: Message): string {
  if (!m) return '';
  switch (m.message_type) {
    case 'voice': return '🎤 Voice message';
    case 'image': return '📷 Photo';
    case 'video': return '🎥 Video';
    case 'gift':  return '🎁 Gift';
    default:      return m.content || '';
  }
}

// ✅ NEW (video replies): Cloudinary makes a small still picture from a video
// just by changing the link — no install, and the website can do the same.
function videoPosterUrl(url?: string): string | undefined {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/video/upload/')) return undefined;
  return url.replace('/video/upload/', '/video/upload/so_0,w_360,q_auto:low/').replace(/\.[a-z0-9]+(\?.*)?$/i, '.jpg');
}

// ✅ NEW: chat wallpaper — a very soft green-black gradient with small doodles
// (chat bubbles, hearts, music, gifts…) drawn faintly, a bit like WhatsApp's.
// Drawn once, never re-rendered, and it ignores touches.
const DOODLES = [
  'chatbubble-outline', 'heart-outline', 'musical-notes-outline', 'gift-outline', 'star-outline',
  'videocam-outline', 'camera-outline', 'flash-outline', 'leaf-outline', 'call-outline',
  'happy-outline', 'flame-outline', 'diamond-outline', 'paw-outline', 'planet-outline',
] as const;
const ChatWallpaper = React.memo(function ChatWallpaper() {
  const { width, height } = Dimensions.get('window');
  const size = 62;
  const cols = Math.ceil(width / size) + 1;
  const rows = Math.ceil(height / size) + 1;
  const items: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const name = DOODLES[(r * 4 + c * 7) % DOODLES.length];
      const x = c * size + (r % 2 ? size / 2 : 0) - 8;
      const y = r * size;
      const rot = (((r * 5 + c * 3) % 5) - 2) * 14;
      items.push(
        <Ionicons key={`${r}-${c}`} name={name as any} size={22 + ((r + c) % 3) * 2}
          color="#00ff88" style={{ position: 'absolute', left: x, top: y, opacity: 0.07, transform: [{ rotate: `${rot}deg` }] }} />
      );
    }
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={['#031a0f', '#020a06', '#000000']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill} />
      {items}
    </View>
  );
});

// ✅ NEW (keyboard fix): on newer Android (your Expo 55 / RN 0.83 build draws
// edge-to-edge) the screen is NOT shrunk when the keyboard opens, so the message
// bar ended up hidden BEHIND the keyboard and you could not see what you typed.
// This measures how much of the screen the keyboard really covers and lifts the
// content by exactly that much. If the phone already shrinks the screen itself,
// the overlap is 0 and nothing extra is added. (iPhone keeps using the normal
// KeyboardAvoidingView.)
function useKeyboardOverlap(onShow?: () => void) {
  const ref = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e: any) => {
      ref.current?.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        setOverlap(Math.max(0, Math.round(y + h - e.endCoordinates.screenY)));
        setTimeout(() => onShowRef.current?.(), 60);
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setOverlap(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return { ref, overlap };
}

// ✅ NEW: the "add a caption" screen shown after you pick photos / videos (or
// take one with the camera): preview, a caption for EACH item, remove items,
// then send. Same idea as WhatsApp.
function MediaComposer({ assets, onClose, onSend }: {
  assets: PickedAsset[]; onClose: () => void; onSend: (items: (PickedAsset & { caption: string })[]) => void;
}) {
  const { width, height } = Dimensions.get('window');
  const [list, setList]         = useState<PickedAsset[]>(assets);
  const [captions, setCaptions] = useState<string[]>(() => assets.map(() => ''));
  const [index, setIndex]       = useState(0);
  const safeIndex = Math.min(index, Math.max(list.length - 1, 0));
  const cur = list[safeIndex];
  const topPad = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 52;
  const { ref: kbRef, overlap: kbOverlap } = useKeyboardOverlap();
  const KbWrap: any = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  const removeAt = (i: number) => {
    if (list.length <= 1) { onClose(); return; }
    setList(prev => prev.filter((_, k) => k !== i));
    setCaptions(prev => prev.filter((_, k) => k !== i));
    setIndex(prev => Math.max(0, Math.min(prev, list.length - 2)));
  };
  const setCaption = (t: string) => setCaptions(prev => prev.map((c, k) => k === safeIndex ? t : c));
  const submit = () => onSend(list.map((a, i) => ({ ...a, caption: (captions[i] || '').trim() })));
  if (!cur) return null;

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KbWrap ref={kbRef} collapsable={false}
        style={{ flex: 1, backgroundColor: '#000', paddingBottom: Platform.OS === 'ios' ? 0 : kbOverlap }}
        {...(Platform.OS === 'ios' ? { behavior: 'padding' } : {})}>
        <View style={[styles.composerTop, { paddingTop: topPad }]}>
          <TouchableOpacity onPress={onClose} style={styles.viewerClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.viewerCount}>{list.length > 1 ? `${safeIndex + 1} / ${list.length}` : (cur.type === 'video' ? 'Video' : 'Photo')}</Text>
          <TouchableOpacity onPress={() => removeAt(safeIndex)} style={styles.viewerClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {cur.type === 'video'
            ? <ViewerVideo key={cur.uri} uri={cur.uri} active autoPlay={false} width={width} height={height * 0.9} />
            : <Image source={{ uri: cur.uri }} style={{ width, height: height * 0.62 }} resizeMode="contain" />}
        </View>
        {list.length > 1 && (
          <FlatList data={list} horizontal keyExtractor={(a, i) => a.uri + i} showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, paddingVertical: 8 }} contentContainerStyle={{ paddingHorizontal: 10, gap: 8 }}
            renderItem={({ item, index: i }) => (
              <TouchableOpacity onPress={() => setIndex(i)} style={[styles.composerThumb, i === safeIndex && { borderColor: C.green }]}>
                {item.type === 'video'
                  ? <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' }]}><Ionicons name="videocam" size={20} color="#fff" /></View>
                  : <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />}
                {!!captions[i] && <View style={styles.composerThumbDot} />}
              </TouchableOpacity>
            )} />
        )}
        <View style={styles.composerBar}>
          <TextInput style={styles.composerInput} value={captions[safeIndex] || ''} onChangeText={setCaption}
            placeholder="Add a caption…" placeholderTextColor="#777" multiline maxLength={500} />
          <TouchableOpacity style={styles.composerSend} onPress={submit}>
            <Ionicons name="send" size={19} color="#000" />
            {list.length > 1 && <View style={styles.composerBadge}><Text style={styles.composerBadgeText}>{list.length}</Text></View>}
          </TouchableOpacity>
        </View>
      </KbWrap>
    </Modal>
  );
}

// ✅ NEW: in-app photo / video viewer (like WhatsApp): full screen, swipe left
// and right through every photo and video in this chat, videos play with
// controls, photos pinch-zoom on iPhone (Android shows them full-screen).
function ViewerVideo({ uri, active, width, height, autoPlay = true }: { uri: string; active: boolean; width: number; height: number; autoPlay?: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = false; });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const sub: any = player.addListener('statusChange', (e: any) => { if (e?.status === 'error') setFailed(true); });
    return () => { try { sub?.remove?.(); } catch (_) {} };
  }, [player]);
  useEffect(() => {
    try { if (active && autoPlay) player.play(); else if (!active) player.pause(); } catch (_) {}
  }, [active, autoPlay, player]);
  if (failed) {
    return (
      <View style={{ width, height: height * 0.5, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <Ionicons name="alert-circle-outline" size={40} color="#aaa" />
        <Text style={{ color: '#ccc', fontSize: 14 }}>This video could not be played here.</Text>
        <TouchableOpacity onPress={() => Linking.openURL(uri).catch(() => {})}
          style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#222' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Open in browser</Text>
        </TouchableOpacity>
      </View>
    );
  }
  // surfaceType="textureView": on Android the default surface shows a BLACK
  // picture (only the controls) when the player sits inside a Modal.
  return <ExpoVideoView player={player} style={{ width, height: height * 0.8 }} contentFit="contain"
    nativeControls surfaceType="textureView" />;
}

function MediaViewer({ items, startIndex, onClose, onSeen }: { items: Message[]; startIndex: number; onClose: () => void; onSeen?: (m: Message) => void }) {
  const { width, height } = Dimensions.get('window');
  const [index, setIndex] = useState(startIndex);
  useEffect(() => { const m = items[index]; if (m) onSeen?.(m); }, [index]);
  const topPad = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 52;
  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={items} horizontal pagingEnabled keyExtractor={m => m.id}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          initialNumToRender={1} windowSize={3} showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              {item.message_type === 'video' ? (
                i === index
                  ? <ViewerVideo uri={item.media_url as string} active width={width} height={height} />
                  : <Image source={{ uri: videoPosterUrl(item.media_url) }} style={{ width, height: height * 0.6 }} resizeMode="contain" />
              ) : (
                <ScrollView maximumZoomScale={4} minimumZoomScale={1} centerContent
                  showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
                  <Image source={{ uri: item.media_url }} style={{ width, height: height * 0.85 }} resizeMode="contain" />
                </ScrollView>
              )}
            </View>
          )}
        />
        {!!items[index]?.content && (
          <View style={styles.viewerCaption} pointerEvents="none">
            <Text style={styles.viewerCaptionText}>{items[index].content}</Text>
          </View>
        )}
        <View style={[styles.viewerTop, { paddingTop: topPad }]} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.viewerClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.viewerCount}>{index + 1} / {items.length}</Text>
          <View style={{ width: 40 }} />
        </View>
      </View>
    </Modal>
  );
}

// ✅ NEW (low-data mode): Cloudinary can hand back a small, low-quality copy of
// an image just by changing the URL — no extra upload, no install, and the
// website can use the exact same trick. Non-Cloudinary URLs are left alone.
function lowDataImageUrl(url?: string): string | undefined {
  if (!url || !url.includes('res.cloudinary.com') || !url.includes('/image/upload/')) return url;
  if (/\/image\/upload\/[^/]*(w_|q_)/.test(url)) return url;
  return url.replace('/image/upload/', '/image/upload/w_320,q_auto:low,f_auto/');
}

// ── MESSAGE BUBBLE ────────────────────────────────────────────
function MessageBubble({ message, isMe, onLongPress, onCowatch, lowData, onOpenMedia, onRetryUpload, onCancelUpload, onSeen }: {
  message:     Message;
  isMe:        boolean;
  onLongPress: (msg: Message) => void;
  onCowatch?:  (msg: Message) => void;
  lowData?:    boolean;
  onOpenMedia?: (msg: Message) => void;
  onRetryUpload?: (msg: Message) => void;
  onCancelUpload?: (msg: Message) => void;
  onSeen?: (msg: Message) => void;
}) {
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [imgError,   setImgError]   = useState(false);

  // FIX: expo-audio player replaces expo-av Audio.Sound
  const player = useAudioPlayer(message.media_url ? { uri: message.media_url } : null);
  useEffect(() => { if (isPlaying && !isMe) onSeen?.(message); }, [isPlaying]);

  const playVoice = async () => {
    try {
      if (isPlaying) {
        player.pause();
        setIsPlaying(false);
      } else {
        player.play();
        setIsPlaying(true);
      }
    } catch (e) { console.error('playVoice error:', e); }
  };

  useEffect(() => {
    return () => { try { player.pause(); } catch (_) {} };
  }, []);

  const reactionList   = safeReactions(message);
  const reactionGroups = reactionList.reduce((acc: any, r) => {
    acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc;
  }, {});

  const renderContent = () => {
    switch (message.message_type) {
      case 'voice':
        return (
          <TouchableOpacity
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, styles.voiceBubble, (message as any)._uploading && { opacity: 0.55 }]}
            onPress={playVoice} onLongPress={() => onLongPress(message)}
          >
            {(message as any)._failed ? (
              <TouchableOpacity style={styles.voicePlayBtn} onPress={() => onRetryUpload?.(message)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="cloud-upload-outline" size={17} color={isMe ? '#000' : C.green} />
              </TouchableOpacity>
            ) : (message as any)._uploading ? (
              <View style={styles.voicePlayBtn}><ActivityIndicator size="small" color={isMe ? '#000' : C.green} /></View>
            ) : (
              <View style={styles.voicePlayBtn}>
                <Text style={{ fontSize: 13, color: isMe ? '#000' : C.green }}>{isPlaying ? '⏸' : '▶'}</Text>
              </View>
            )}
            <Waveform isMe={isMe} />
            <Text style={[styles.voiceDur, isMe && { color: '#000' }]}>
              {message.media_duration ? formatSecs(message.media_duration) : '0:00'}
            </Text>
            {(message as any)._failed && (
              <Text style={{ fontSize: 11, fontWeight: '700', color: isMe ? '#000' : C.green, marginLeft: 6 }}>Retry</Text>
            )}
            {(message as any)._uploading && (
              <TouchableOpacity onPress={() => onCancelUpload?.(message)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 6 }}>
                <Ionicons name="close-circle" size={18} color={isMe ? '#000' : C.muted} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        );

      case 'image':
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)} activeOpacity={0.9}
            onPress={() => { if (!imgError) onOpenMedia?.(message); }}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { padding: 3 }]}>
            {imgError
              ? <View style={styles.imgErrorBox}>
                  <Ionicons name="image-outline" size={28} color={C.muted2} />
                  <Text style={styles.imgErrorText}>Image unavailable</Text>
                </View>
              : (
                <View>
                  {lowData && !(message as any)._job ? (
                    <View>
                      <Image source={{ uri: lowDataImageUrl(message.media_url) }}
                        style={styles.msgImage} resizeMode="cover" blurRadius={6}
                        onError={() => setImgError(true)} />
                      <View style={styles.lowDataOverlay} pointerEvents="none">
                        <Ionicons name="cloud-download-outline" size={22} color="#fff" />
                        <Text style={styles.lowDataText}>Tap to view</Text>
                      </View>
                    </View>
                  ) : (
                  <Image source={{ uri: message.media_url }}
                    style={styles.msgImage} resizeMode="cover"
                    onError={() => setImgError(true)} />
                  )}
                  {((message as any)._uploading || (message as any)._failed) && (
                    <View style={styles.uploadingOverlay} pointerEvents="box-none">
                      <UploadBadge message={message} onCancel={onCancelUpload} onRetry={onRetryUpload} />
                    </View>
                  )}
                </View>
              )}
            {!!message.content && (
              <Text style={[styles.mediaCaption, isMe && { color: '#000' }]}>{message.content}</Text>
            )}
          </TouchableOpacity>
        );

      case 'video':
        if (message.shared_video_id) {
          return (
            <TouchableOpacity onLongPress={() => onLongPress(message)}
              style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, styles.videoCard]}>
              <View style={styles.videoThumb}>
                {message.shared_video_thumbnail
                  ? <Image source={{ uri: message.shared_video_thumbnail }} style={styles.videoThumbImg} />
                  : <View style={[styles.videoThumb, { backgroundColor: '#111' }]} />}
                <View style={styles.videoPlayIcon}>
                  <Text style={{ fontSize: 16, color: '#000', marginLeft: 2 }}>▶</Text>
                </View>
              </View>
              <View style={styles.videoInfo}>
                <Text style={[styles.videoTitle, isMe && { color: '#000' }]} numberOfLines={2}>
                  {message.shared_video_title}
                </Text>
                <Text style={[styles.videoViews, isMe && { color: 'rgba(0,0,0,0.6)' }]}>
                  {message.shared_video_views} views
                </Text>
                {onCowatch && (
                  <TouchableOpacity style={styles.cowatchMsgBtn} onPress={() => onCowatch(message)}>
                    <Ionicons name="film-outline" size={11} color="#000" />
                    <Text style={styles.cowatchMsgBtnText}>Watch Together</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        }
        {
          const uploading = !!(message as any)._uploading;
          const failed = !!(message as any)._failed;
          const pending = !!(message as any)._job;
          const poster = pending ? undefined : videoPosterUrl(message.media_url);
          return (
            <TouchableOpacity onLongPress={() => onLongPress(message)} activeOpacity={0.85}
              disabled={!message.media_url}
              onPress={() => message.media_url && onOpenMedia?.(message)}
              style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { padding: 3 }]}>
              {message.reply_to_message && (
                <View style={[styles.replyPreview, isMe && styles.replyPreviewMe, { marginBottom: 3 }]}>
                  <Text style={styles.replyName}>{message.reply_to_message.sender?.display_name || 'User'}</Text>
                  <Text style={styles.replyText} numberOfLines={1}>{replyPreviewText(message.reply_to_message)}</Text>
                </View>
              )}
              <View style={styles.videoPreviewBox}>
                {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} resizeMode="cover" /> : null}
                <Ionicons name={poster || pending ? 'play-circle' : 'videocam'} size={poster || pending ? 44 : 32} color={poster || pending ? '#fff' : C.green} />
                {(uploading || failed) && (
                  <View style={styles.uploadingOverlay} pointerEvents="box-none">
                    <UploadBadge message={message} onCancel={onCancelUpload} onRetry={onRetryUpload} />
                  </View>
                )}
                <Text style={styles.videoPreviewLabel}>{failed ? 'Not sent' : uploading ? 'Sending…' : (message.reply_to_message ? 'Video reply' : 'Video')}</Text>
              </View>
              {!!message.content && (
                <Text style={[styles.mediaCaption, isMe && { color: '#000' }]}>{message.content}</Text>
              )}
            </TouchableOpacity>
          );
        }

      case 'call_log': {
        let parsed: { callType?: 'voice' | 'video'; outcome?: 'missed' | 'declined' | 'completed' } = {};
        try { parsed = JSON.parse(message.content || '{}'); } catch (_) {}
        const isVideo = parsed.callType === 'video';
        const outcome = parsed.outcome || 'completed';
        const label = isVideo ? 'Video call' : 'Voice call';
        const isMissedOrDeclined = outcome === 'missed' || outcome === 'declined';
        const subtitle =
          outcome === 'missed' ? (isMe ? 'No answer' : 'Missed') :
          outcome === 'declined' ? 'Declined' :
          formatCallDuration(message.media_duration || 0);
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <View style={{
              width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
              backgroundColor: isMe ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)',
            }}>
              <Ionicons
                name={isVideo ? 'videocam' : (isMissedOrDeclined ? 'call' : 'call')}
                size={15}
                color={isMissedOrDeclined && !isMe ? '#ff5555' : (isMe ? '#000' : C.green)}
              />
            </View>
            <View>
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe, { fontWeight: '700' }]}>{label}</Text>
              <Text style={[styles.bubbleText, isMe ? { color: 'rgba(0,0,0,0.6)' } : { color: C.muted }, { fontSize: 12 }]}>
                {subtitle}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }

      // ✅ NEW (fix #4 — cowatch should log inline like a call does): mirrors
      // the 'call_log' case immediately above almost exactly. Inserted by
      // cowatch.tsx's setupSession() the moment a NEW session is created
      // (see insertCowatchLogMessage there) — joining an existing session
      // someone else started does not insert a second one.
      // ✅ NEW: gift card. content is JSON written by send_chat_gift.
      case 'gift': {
        let g: { name?: string; emoji?: string; coins?: number } = {};
        try { g = JSON.parse(message.content || '{}'); } catch (_) {}
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)} activeOpacity={0.9}
            style={[styles.giftCard, isMe ? styles.giftCardMe : styles.giftCardThem]}>
            <Text style={{ fontSize: 44 }}>{g.emoji || '🎁'}</Text>
            <Text style={styles.giftCardTitle}>
              {isMe ? `You sent ${g.name || 'a gift'}` : `${g.name || 'A gift'} for you`}
            </Text>
            <Text style={styles.giftCardCoins}>{g.coins ?? message.coin_amount ?? 0} coins</Text>
          </TouchableOpacity>
        );
      }

      case 'cowatch_log': {
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <View style={{
              width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
              backgroundColor: isMe ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)',
            }}>
              <Ionicons name="film-outline" size={15} color={isMe ? '#000' : C.green} />
            </View>
            <View>
              <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe, { fontWeight: '700' }]}>Watch Together</Text>
              <Text style={[styles.bubbleText, isMe ? { color: 'rgba(0,0,0,0.6)' } : { color: C.muted }, { fontSize: 12 }]}>
                {isMe ? 'You started a watch party' : 'Started a watch party'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }

      default:
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]} activeOpacity={0.85}>
            {message.reply_to_message && (
              <View style={[styles.replyPreview, isMe && styles.replyPreviewMe]}>
                <Text style={styles.replyName}>{message.reply_to_message.sender?.display_name || 'User'}</Text>
                <Text style={styles.replyText} numberOfLines={1}>{replyPreviewText(message.reply_to_message)}</Text>
              </View>
            )}
            {message.is_disappearing && (
              <Text style={[styles.disappearBadge, isMe && { color: 'rgba(0,0,0,0.5)' }]}>👻</Text>
            )}
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{message.content}</Text>
          </TouchableOpacity>
        );
    }
  };

  return (
    <View style={[styles.msgRow, isMe && styles.msgRowMe]}>
      {!isMe && (
        <View style={styles.msgAv}>
          {message.sender?.photo_url
            ? <Image source={{ uri: message.sender.photo_url }} style={styles.msgAvImg} />
            : <View style={styles.msgAvPlaceholder}>
                <Text style={{ color: C.green, fontSize: 10, fontWeight: '700' }}>
                  {(message.sender?.display_name || 'U')[0].toUpperCase()}
                </Text>
              </View>}
        </View>
      )}
      <View style={[styles.msgCol, isMe && styles.msgColMe]}>
        {renderContent()}
        {Object.keys(reactionGroups).length > 0 && (
          <View style={[styles.reactionsRow, isMe && styles.reactionsRowMe]}>
            {Object.entries(reactionGroups).map(([emoji, count]) => (
              <View key={emoji} style={styles.reactionPill}>
                <Text style={{ fontSize: 12 }}>{emoji}</Text>
                <Text style={styles.reactionCount}>{count as number}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={[styles.msgMeta, isMe && styles.msgMetaMe]}>
          <Text style={styles.msgTime}>{formatTime(message.created_at)}</Text>
          {isMe && ((message as any)._job
            ? (
              <TouchableOpacity disabled={!(message as any)._failed} onPress={() => onRetryUpload?.(message)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Ionicons name={(message as any)._failed ? 'alert-circle-outline' : 'time-outline'} size={12}
                  color={(message as any)._failed ? C.red : C.muted2} />
                {(message as any)._failed && <Text style={{ fontSize: 10, color: C.red, fontWeight: '700' }}>Tap to retry</Text>}
              </TouchableOpacity>
            )
            : (() => {
                const tk = tickState(message);
                return <Text style={[styles.readTick, tk.green && { color: C.green }]}>{tk.text}</Text>;
              })())}
        </View>
      </View>
    </View>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────
export default function ChatScreen() {
  // FIX: route params come from @react-navigation's useRoute(), not
  // expo-router's useLocalSearchParams(). This screen is reached via
  // navigation.navigate('Chat', { id, otherUserId, otherName, otherPhoto })
  // from wherever the conversation list lives.
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  // ✅ NEW (fix — plain notification tap → chooser, not silent auto-answer):
  // set by callPushNavigation.ts's navigateToIncomingPrompt when a call
  // notification is tapped WITHOUT an explicit Answer/Decline action
  // (the common case on Android, since those buttons don't render on a
  // backgrounded/killed app — see the comment on presentIncomingCallPrompt).
  const { id, otherUserId, otherName, otherPhoto, autoAnswerCall, autoAnswerCallType, autoAnswerNonce, autoStartCall, autoStartCallType, promptIncomingCall, promptCallType, promptRoomName, promptIncomingCowatch, promptCowatchSessionId, promptCowatchInviterName } = route.params || {};

  // FIX: MainTabBar was always visible on this screen — it never told the
  // parent tab navigator to hide it. MainTabBar itself already knows how to
  // read tabBarStyle.display === 'none' from the focused screen's options
  // (same pattern cowatch.tsx/create.tsx already use); this screen just
  // never called it. With the tab bar permanently eating ~68-80px at the
  // bottom, the message input bar was being squeezed out of the visible
  // viewport on shorter screens — which is what showed up as "no visible
  // place to type a normal message."
  useEffect(() => {
    navigation.getParent()?.setOptions({ tabBarStyle: { display: 'none' } });
    return () => {
      navigation.getParent()?.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation]);

  const { user, userProfile, loadProfile } = useAuthStore();
  const flatRef = useRef<FlatList>(null);

  const [inputText,      setInputText]      = useState('');
  const [showEmoji,      setShowEmoji]      = useState(false);
  const [vanishOn,       setVanishOn]       = useState(false);
  const [selectedMsg,    setSelectedMsg]    = useState<Message | null>(null);
  const [showReactions,  setShowReactions]  = useState(false);
  // NEW: chat settings menu (Block/Report), replacing the dead ... button
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [showReportReasons, setShowReportReasons] = useState(false);
  const [replyTo,        setReplyTo]        = useState<Message | null>(null);
  const [isRecording,    setIsRecording]    = useState(false);
  const [recordingDur,   setRecordingDur]   = useState(0);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  // ✅ NEW: low-data mode — saved on the user's row (users.low_data_mode) so
  // the app and the website share one setting.
  const [lowData, setLowData] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('users').select('low_data_mode').eq('id', user.id).single()
      .then(({ data }) => { if (data) setLowData(!!(data as any).low_data_mode); });
  }, [user?.id]);
  const toggleLowData = useCallback(async () => {
    if (!user?.id) return;
    const next = !lowData;
    setLowData(next);
    const { error } = await supabase.from('users').update({ low_data_mode: next }).eq('id', user.id);
    if (error) { setLowData(!next); Alert.alert('Could not save', error.message); }
  }, [lowData, user?.id]);


  // FIX: expo-audio recorder replaces expo-av Audio.Recording
  const recorder      = useAudioRecorder(VOICE_PRESET as any);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOnline = usePresence(user?.id || null, otherUserId || null);

  const {
    messages, loading, sending, sendText, sendVoiceNote,
    sendImage, sendVideo, sendGift, retryUpload, cancelUpload, markMediaOpened, reactToMessage, deleteMessage,
  } = useMessages(
    id, user?.id || null, vanishOn, 86400,
    otherUserId || null, userProfile?.username || '', userProfile?.display_name || 'Someone',
    // ✅ NEW: so the recipient's push notification (and its tap-to-open
    // navigation) can show your real avatar instead of a placeholder.
    // Matches the field name already used elsewhere in this same file
    // (see the `users` table select: '...display_name, photo_url').
    userProfile?.photo_url || '',
  );

  const displayName = userProfile?.display_name || userProfile?.username || 'LumVibe User';

  // ✅ NEW: share my chat invite link — anyone who opens it (after they log in or
  // sign up) lands in a one-to-one chat with me.
  const shareInvite = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('create_chat_invite', { p_rotate: false });
      if (error || !data) throw error || new Error('Could not create the link');
      const link = `https://lumvibe.site/chat/invite/${data}`;
      await Share.share({ message: `Chat with me on LumVibe 💬\n${link}`, url: link });
    } catch (e: any) { Alert.alert('Could not create link', e?.message || 'Please try again.'); }
  }, []);

  // ✅ NEW: in-app photo/video viewer
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [composerAssets, setComposerAssets] = useState<PickedAsset[] | null>(null);   // ✅ NEW: caption screen
  const mediaItems = useMemo(() => messages.filter(m =>
    (m.message_type === 'image' || m.message_type === 'video') &&
    !!m.media_url && !m.is_deleted && !m.shared_video_id), [messages]);
  const viewerStart = viewerId ? mediaItems.findIndex(m => m.id === viewerId) : -1;

  // ✅ NEW: gifts — same list, prices, custom amount and coin→naira preview as
  // the feed gift sheet in videos.tsx.
  const [showGifts,        setShowGifts]        = useState(false);
  const [customGiftMode,   setCustomGiftMode]   = useState(false);
  const [customGiftAmount, setCustomGiftAmount] = useState('');
  const [giftBusy,         setGiftBusy]         = useState(false);
  const myCoins = Number((userProfile as any)?.coins) || 0;

  const closeGifts = useCallback(() => { setShowGifts(false); setCustomGiftMode(false); setCustomGiftAmount(''); }, []);
  const goBuyCoins = useCallback(() => {
    closeGifts();
    setTimeout(() => navigation.navigate('BuyCoins'), 300);
  }, [closeGifts, navigation]);

  const sendGiftAmount = useCallback(async (amount: number, label: string, icon: string) => {
    if (giftBusy) return;
    if (amount > myCoins) {
      Alert.alert('Insufficient coins', `You need ${amount} coins but only have ${myCoins.toFixed(0)}.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Top up wallet', onPress: goBuyCoins },
      ]);
      return;
    }
    setGiftBusy(true);
    const r = await sendGift(amount, label, icon);
    setGiftBusy(false);
    if (!r.ok) { Alert.alert('Could not send gift', r.error || 'Please try again.'); return; }
    closeGifts();
    try { await loadProfile?.(); } catch (_) {}
  }, [giftBusy, myCoins, sendGift, closeGifts, goBuyCoins, loadProfile]);

  const handleSendCustomGift = useCallback(() => {
    const amount = parseFloat(customGiftAmount);
    if (isNaN(amount) || amount < 10)  { Alert.alert('Invalid Amount', 'Minimum 10 coins'); return; }
    if (!Number.isInteger(amount))     { Alert.alert('Invalid Amount', 'Please enter a whole number of coins'); return; }
    if (amount > 5000)                 { Alert.alert('Invalid Amount', 'Maximum 5,000 coins (₦750,000)'); return; }
    sendGiftAmount(amount, 'custom gift', '🎁');
  }, [customGiftAmount, sendGiftAmount]);

  const {
    callState, incomingCall, localVideoTrack, remoteVideoTrack,
    remoteCamOff, remoteMicMuted,
    startCall, endCall, acceptCall, declineCall,
    toggleMute, toggleCamera, toggleSpeaker, joinLiveKitRoom,
    setCallState,
    // ✅ NEW (fix #3): incoming cowatch invite.
    incomingCowatch, dismissCowatchInvite,
    presentIncomingCallPrompt, presentIncomingCowatchPrompt,
  } = useCall(user?.id || '', displayName, id || null, otherUserId || null, (userProfile as any)?.avatar_url || userProfile?.photo_url || undefined);

  // ✅ NEW: opening this chat clears its message notification (and the
  // "LumVibe" stack header if it was the last one).
  useEffect(() => {
    if (id) cancelChatNotification(String(id)).catch(() => {});
  }, [id]);

  // ✅ NEW: cold-start case — the app was fully killed, a call push arrived,
  // the user tapped it, and the root navigator (see the app-entry snippet)
  // relaunched straight into this screen with these params. Auto-join once.
  // This also covers a warm tap (app already running elsewhere) since the
  // same root-level handler drives both — see call-push-app-entry-snippet.
  //
  // ✅ FIX: this used to call startCall(id, ...) — the exact same bug just
  // fixed in acceptCall() above, via a different path. startCall()
  // unconditionally re-broadcasts 'incoming_call', which would make the
  // ORIGINAL caller's screen incorrectly pop the incoming-call modal again
  // the moment someone answered via a notification tap, same as it did via
  // the in-app Answer button before that fix. Joins the room directly
  // instead, deriving the same deterministic room name startCall() itself
  // uses (`call_${conversationId}`), never re-signaling a call that's
  // already ringing.
  // ✅ CHANGED (ringing rework): two fixes to the Answer path.
  //  1) it never asked for the microphone/camera permission — on a fresh
  //     install (or after the app was killed) you could "answer" and join the
  //     room with NO mic, so nobody could talk. It asks first now, exactly
  //     like acceptCall() does.
  //  2) it only worked ONCE per screen (autoAnsweredRef stayed true), so
  //     answering a second call in the same chat did nothing. It is now keyed
  //     on a fresh nonce sent with every Answer.
  const lastAnswerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoAnswerCall || !id) return;
    const key = String(autoAnswerNonce ?? 'once');
    if (lastAnswerKeyRef.current === key) return;
    lastAnswerKeyRef.current = key;
    const callType = autoAnswerCallType === 'video' ? 'video' : 'voice';
    (async () => {
      if (Platform.OS === 'android') {
        const perms = callType === 'video'
          ? [PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]
          : [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        const results = await PermissionsAndroid.requestMultiple(perms);
        if (perms.some(p => results[p] !== PermissionsAndroid.RESULTS.GRANTED)) {
          setCallState(prev => ({ ...prev, permDenied: true }));
          return;
        }
      }
      setCallState(prev => ({
        ...prev, isInCall: true, callType,
        isConnecting: true, remoteConnected: false, permDenied: false,
      }));
      joinLiveKitRoom(`call_${id}`, callType);
    })();
  }, [autoAnswerCall, autoAnswerCallType, autoAnswerNonce, id, joinLiveKitRoom]);

  // ✅ NEW (fix #2 — "Call back" action): unlike autoAnswerCall above
  // (which joins a room someone ELSE already opened), calling back means
  // WE are the caller this time — startCall() is the right function here
  // since it's the one that signals the other side + sends them a fresh
  // call push, not joinLiveKitRoom (which only ever joins, never rings
  // anyone).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartCall && !autoStartedRef.current && id) {
      autoStartedRef.current = true;
      startCall(id, autoStartCallType === 'video' ? 'video' : 'voice');
    }
  }, [autoStartCall, autoStartCallType, id, startCall]);

  // ✅ NEW (fix — plain call notification tap shows the real chooser):
  // synthesizes the exact same incomingCall banner the in-app realtime
  // path uses, once, from route params instead of requiring the
  // `call_signal` broadcast to have arrived while this screen was mounted.
  const promptedCallRef = useRef(false);
  useEffect(() => {
    if (promptIncomingCall && !promptedCallRef.current && id && otherUserId) {
      promptedCallRef.current = true;
      presentIncomingCallPrompt({
        callerId: otherUserId,
        callerName: otherName || 'Someone',
        callerPhoto: otherPhoto,
        callType: promptCallType === 'video' ? 'video' : 'voice',
        roomName: promptRoomName || `call_${id}`,
      });
    }
  }, [promptIncomingCall, promptCallType, promptRoomName, id, otherUserId, otherName, otherPhoto, presentIncomingCallPrompt]);

  // ✅ NEW (fix #3 — cowatch notification tap shows the real chooser):
  // same idea, for a cowatch invite tapped from the notification tray.
  const promptedCowatchRef = useRef(false);
  useEffect(() => {
    if (promptIncomingCowatch && !promptedCowatchRef.current && id && promptCowatchSessionId) {
      promptedCowatchRef.current = true;
      presentIncomingCowatchPrompt({
        inviterId: otherUserId || '',
        inviterName: promptCowatchInviterName || otherName || 'Someone',
        inviterPhoto: otherPhoto,
        sessionId: promptCowatchSessionId,
        conversationId: id,
      });
    }
  }, [promptIncomingCowatch, promptCowatchSessionId, promptCowatchInviterName, id, otherUserId, otherName, otherPhoto, presentIncomingCowatchPrompt]);

  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (user?.id && otherUserId) getStreak(user.id, otherUserId).then(setStreak);
  }, [user?.id, otherUserId]);

  useEffect(() => {
    if (messages.length > 0)
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim()) return;
    const text = inputText.trim();
    setInputText(''); setReplyTo(null); setShowEmoji(false);
    await sendText(text, replyTo?.id);
  }, [inputText, replyTo, sendText]);

  const handleLongPress = useCallback((msg: Message) => {
    setSelectedMsg(msg); setShowReactions(true);
  }, []);

  // NEW: block and report — the "..." button used to do nothing at all.
  const REPORT_REASONS = [
    { icon: 'ban-outline',              label: 'Spam or Misleading' },
    { icon: 'alert-circle-outline',     label: 'Nudity or Sexual Content' },
    { icon: 'flame-outline',            label: 'Hate Speech or Discrimination' },
    { icon: 'warning-outline',          label: 'Violence or Dangerous Acts' },
    { icon: 'person-remove-outline',    label: 'Harassment or Bullying' },
    { icon: 'document-text-outline',    label: 'Copyright Violation' },
    { icon: 'happy-outline',            label: 'Involves a Minor Inappropriately' },
    { icon: 'skull-outline',            label: 'Illegal Activity' },
  ];

  const handleBlockUser = () => {
    setShowChatSettings(false);
    Alert.alert(
      `Block ${otherName || 'this user'}?`,
      "They won't be able to message you, and you won't see each other's content.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive', onPress: async () => {
            if (!user?.id || !otherUserId) return;
            const { error } = await supabase.from('blocked_users')
              .insert({ blocker_id: user.id, blocked_id: otherUserId });
            if (error) { Alert.alert('Error', error.message); return; }
            navigation.goBack();
          },
        },
      ]
    );
  };

  const handleSubmitReport = async (reason: string) => {
    setShowReportReasons(false);
    if (!user?.id || !otherUserId) return;
    const { error } = await supabase.from('user_reports')
      .insert({ reporter_id: user.id, reported_user_id: otherUserId, reason });
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Report Submitted', "Thanks — we'll review this.");
  };

  const handleReaction = useCallback(async (emoji: string) => {
    if (!selectedMsg) return;
    setShowReactions(false);
    await reactToMessage(selectedMsg.id, emoji);
    setSelectedMsg(null);
  }, [selectedMsg, reactToMessage]);

  const handlePickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: lowData ? 0.4 : 0.8 });
    if (!result.canceled && result.assets[0]) await sendImage(result.assets[0].uri);
  }, [sendImage, lowData]);

  const handlePickCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, videoMaxDuration: 60, quality: lowData ? 0.4 : 0.8,
    });
    if (!result.canceled && result.assets[0]) setComposerAssets([toPickedAsset(result.assets[0])]);
  }, [lowData]);

  const sendComposed = useCallback((items: (PickedAsset & { caption: string })[]) => {
    setComposerAssets(null);
    for (const it of items) {
      if (it.type === 'video') sendVideo(it.uri, undefined, it.duration, it.caption || undefined);
      else sendImage(it.uri, it.caption || undefined);
    }
  }, [sendVideo, sendImage]);

  // ✅ NEW: reply to a specific message with a short video (max 30 s),
  // recorded right now. It stays inside this conversation — it is NOT posted
  // to the feed.
  const handleReplyWithVideo = useCallback(async (target: Message) => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 30, quality: lowData ? 0.3 : 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const a: any = result.assets[0];
    const secs = a.duration ? Math.round(a.duration > 1000 ? a.duration / 1000 : a.duration) : undefined;
    setUploadingVideo(true);
    try {
      const ok = await sendVideo(a.uri, target.id, secs);
      if (!ok) Alert.alert('Video not sent', 'Please check your connection and try again.');
    } finally { setUploadingVideo(false); }
  }, [sendVideo, lowData]);

  const handlePickVideo = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 120, quality: 0.7,
      allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true,
    } as any);
    if (result.canceled || !result.assets?.length) return;
    setComposerAssets((result.assets as any[]).map(toPickedAsset));
  }, []);

  // ✅ NEW: Gallery now takes up to 10 photos AND videos at once (mixed), like
  // WhatsApp. Each one uploads separately with its own progress / Retry.
  const handlePickGallery = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All, quality: lowData ? 0.4 : 0.8,
      allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true,
    } as any);
    if (result.canceled || !result.assets?.length) return;
    setComposerAssets((result.assets as any[]).map(toPickedAsset));
  }, [lowData]);

  // ✅ REWRITTEN (voice notes): the old version needed you to HOLD a tiny 40px
  // button, awaited permission + prepare on every press (slow start), used a
  // stale `recordingDur` from a closure, and never set the audio mode. Now:
  //   • TAP the mic once → it starts instantly (the recorder is pre-warmed),
  //   • TAP the green ✓ to send, or the red 🗑 to cancel,
  //   • duration comes from a clock (not a stale state value),
  //   • the voice note shows in the chat immediately while it uploads.
  const isRecordingRef = useRef(false);
  const recStartRef    = useRef(0);
  const recReadyRef    = useRef(false);
  const recLiveRef     = useRef(false);   // the recorder is REALLY recording
  const recBusyRef     = useRef(false);
  const finishRef      = useRef<(send: boolean) => void>(() => {});

  // ✅ CHANGED (instant start): the slow steps — mic permission, audio mode and
  // preparing the recorder — now happen when the chat OPENS (and again right
  // after each voice note), not when you tap. So the tap only has to press
  // "record", and the recording bar shows on the very first frame.
  const warmRecorder = useCallback(async (askPermission = true): Promise<boolean> => {
    try {
      let granted = false;
      try { granted = !!(await AudioModule.getRecordingPermissionsAsync()).granted; } catch (_) {}
      if (!granted) {
        if (!askPermission) return false;
        granted = !!(await AudioModule.requestRecordingPermissionsAsync()).granted;
      }
      if (!granted) return false;
      if (Platform.OS === 'android') {
        try { await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); } catch (_) {}
      }
      await recorder.prepareToRecordAsync();
      recReadyRef.current = true;
      return true;
    } catch (e) {
      console.warn('warmRecorder failed:', e);
      recReadyRef.current = false;
      return false;
    }
  }, [recorder]);
  useEffect(() => { warmRecorder(false); }, []);

  const startRecording = useCallback(async () => {
    if (recBusyRef.current || isRecordingRef.current) return;
    recBusyRef.current = true;
    isRecordingRef.current = true; recLiveRef.current = false;
    setRecordingDur(0); setIsRecording(true);                       // bar appears NOW
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
    try {
      if (!recReadyRef.current) {
        const ok = await warmRecorder(true);                         // only the very first time
        if (!ok) throw new Error('mic');
      }
      if (!isRecordingRef.current) return;                           // cancelled while getting ready
      if (Platform.OS === 'ios') {
        try { await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); } catch (_) {}
      }
      recorder.record();
      recReadyRef.current = false; recLiveRef.current = true;
      recStartRef.current = Date.now();
      recordTimerRef.current = setInterval(() => {
        const d = Math.floor((Date.now() - recStartRef.current) / 1000);
        setRecordingDur(d);
        if (d >= 300) finishRef.current(true);                       // 5-minute cap
      }, 250);
    } catch (e) {
      console.warn('startRecording error:', e);
      isRecordingRef.current = false; recLiveRef.current = false; recReadyRef.current = false;
      setIsRecording(false);
      Alert.alert('Microphone', 'Please allow microphone access to send voice notes.');
    } finally { recBusyRef.current = false; }
  }, [recorder, warmRecorder]);

  const finishRecording = useCallback(async (send: boolean) => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    if (recordTimerRef.current) { clearInterval(recordTimerRef.current); recordTimerRef.current = null; }
    setIsRecording(false);
    if (!recLiveRef.current) { setRecordingDur(0); return; }          // never really started
    recLiveRef.current = false;
    const dur = Math.max(0, Math.round((Date.now() - recStartRef.current) / 1000));
    try {
      await recorder.stop();
      const uri = recorder.uri;
      try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }); } catch (_) {}
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
      if (send && uri) {
        if (dur < 1) Alert.alert('Too short', 'Voice notes need at least 1 second.');
        else sendVoiceNote(uri, dur);
      }
    } catch (e) { console.error('finishRecording error:', e); }
    setRecordingDur(0);
    warmRecorder(false);                                              // ready for the next one
  }, [recorder, sendVoiceNote, warmRecorder]);
  useEffect(() => { finishRef.current = finishRecording; }, [finishRecording]);

  // stop cleanly if you leave the chat mid-recording
  useEffect(() => () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (isRecordingRef.current) { isRecordingRef.current = false; try { recorder.stop(); } catch (_) {} }
  }, []);

  const toggleVanish = useCallback(async () => {
    const newVal = !vanishOn; setVanishOn(newVal);
    if (id) await toggleDisappearing(id, newVal);
  }, [vanishOn, id]);

  // FIX: single place that opens CoWatch, using @react-navigation's
  // navigate(screenName, params) signature — matches what cowatch.tsx
  // reads via useRoute().params (conversationId / otherName / otherPhoto).
  const openCowatch = useCallback((sessionId?: string) => {
    navigation.navigate(COWATCH_SCREEN, {
      conversationId: id,
      // ✅ FIX (Co-Watch never rang): Co-Watch had to look up who the other person
      // is in columns that don't exist in `conversations`, found nobody, and so
      // never invited anyone. This screen already knows — hand it over.
      otherUserId: otherUserId || undefined,
      otherName: otherName || '',
      otherPhoto: otherPhoto || '',
      // ✅ FIX: cowatch.tsx reads this param as `sessionId`. It was passed as
      // `existingSessionId`, which cowatch.tsx ignores — so a JOINER thought it
      // had created the session and invited the inviter right back (the
      // duplicate "Started a watch party" bubbles in your chat screenshot).
      ...(sessionId ? { sessionId } : {}),
    });
  }, [navigation, id, otherUserId, otherName, otherPhoto]);

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={[styles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.green} size="large" />
      </SafeAreaView>
    );
  }

  const { ref: kbRef, overlap: kbOverlap } = useKeyboardOverlap(() => flatRef.current?.scrollToEnd?.({ animated: true }));
  const KbWrap: any = Platform.OS === 'ios' ? KeyboardAvoidingView : View;

  const charCount     = inputText.length;
  const showCharCount = charCount >= 1800;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* Header */}
      <View style={styles.chatHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color={C.white} />
        </TouchableOpacity>
        <TouchableOpacity style={{ position: 'relative' }}>
          {otherPhoto
            ? <Image source={{ uri: otherPhoto }} style={styles.chatAv} />
            : <View style={[styles.chatAv, { backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: C.green, fontSize: 15, fontWeight: '700' }}>{(otherName || 'U')[0]}</Text>
              </View>}
          <View style={[styles.chatOnlineDot, { backgroundColor: isOnline ? C.green : C.muted2 }]} />
        </TouchableOpacity>
        <View style={styles.chatUserInfo}>
          <Text style={styles.chatName} numberOfLines={1}>{otherName || 'Chat'}</Text>
          {isOnline
            ? <Text style={styles.chatOnlineText}>Online</Text>
            : streak > 0 ? <Text style={styles.chatStreak}>🔥 {streak} day streak</Text>
            : null}
        </View>
        <View style={styles.chatActions}>
          <TouchableOpacity
            style={styles.chatActBtn}
            onPress={() => (navigation as any).navigate('Story', {
              contextType: 'dm', contextId: id, contextLabel: otherName || 'this chat',
            })}
          >
            <Ionicons name="add-circle-outline" size={19} color={C.green} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatActBtn} onPress={() => startCall(id, 'voice')}>
            <Ionicons name="call-outline" size={17} color={C.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatActBtn} onPress={() => startCall(id, 'video')}>
            <Ionicons name="videocam-outline" size={17} color={C.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatActBtn} onPress={() => setShowChatSettings(true)}>
            <Ionicons name="ellipsis-horizontal" size={17} color={C.white} />
          </TouchableOpacity>
        </View>
      </View>

      <ContextStoryBar contextType="dm" contextId={id!} currentUserId={user?.id} />

      {/* Feature chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.featRow}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 14, alignItems: 'center' }}>
        <TouchableOpacity style={styles.featChip} onPress={() => openCowatch()}>
          <Ionicons name="film-outline" size={12} color={C.muted} />
          <Text style={styles.featChipText}>Co-Watch</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.featChip, vanishOn && styles.featChipOn]}
          onPress={toggleVanish}
        >
          <Ionicons name="glasses-outline" size={12} color={vanishOn ? C.green : C.muted} />
          <Text style={[styles.featChipText, vanishOn && styles.featChipTextOn]}>
            {vanishOn ? 'Vanish ON' : 'Vanish'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {vanishOn && (
        <View style={styles.vanishInd}>
          <Ionicons name="glasses-outline" size={11} color={C.green} />
          <Text style={styles.vanishIndText}>Disappearing messages ON · 24h</Text>
        </View>
      )}

      <KbWrap
        ref={kbRef} collapsable={false}
        style={{ flex: 1, paddingBottom: Platform.OS === 'ios' ? 0 : kbOverlap }}
        {...(Platform.OS === 'ios' ? { behavior: 'padding', keyboardVerticalOffset: HEADER_H } : {})}
      >
        <ChatWallpaper />
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMe={item.sender_id === user?.id}
              onLongPress={handleLongPress}
              onCowatch={(msg) => openCowatch()}
              lowData={lowData}
              onOpenMedia={(m) => setViewerId(m.id)}
              onRetryUpload={retryUpload}
              onCancelUpload={cancelUpload}
              onSeen={markMediaOpened}
            />
          )}
          contentContainerStyle={[styles.messagesList, { flexGrow: 1 }]}
          showsVerticalScrollIndicator={false}
          onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyChatWrap}>
              <View style={styles.emptyChatIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={48} color={C.muted2} />
              </View>
              <Text style={styles.emptyChatTitle}>No messages yet</Text>
              <Text style={styles.emptyChatText}>Say hi to {otherName || 'them'}! 👋</Text>
            </View>
          }
        />

        {replyTo && (
          <View style={styles.replyBanner}>
            <View style={styles.replyBannerBar} />
            <View style={styles.replyBannerContent}>
              <Text style={styles.replyBannerName}>Replying to {replyTo.sender?.display_name}</Text>
              <Text style={styles.replyBannerText} numberOfLines={1}>{replyPreviewText(replyTo)}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} style={styles.replyCloseBtn}>
              <Ionicons name="close" size={18} color={C.muted} />
            </TouchableOpacity>
          </View>
        )}

        {showEmoji && (
          <View style={styles.emojiPanel}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {QUICK_EMOJIS.map(e => (
                  <TouchableOpacity key={e} style={styles.emojiBtn}
                    onPress={() => setInputText(prev => prev + e)}>
                    <Text style={{ fontSize: 24 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={styles.attachRow}
          contentContainerStyle={{ gap: 7, paddingHorizontal: 14, alignItems: 'center' }}>
          <TouchableOpacity style={styles.attachChip} onPress={handlePickCamera}>
            <Ionicons name="camera-outline" size={13} color={C.muted} />
            <Text style={styles.attachChipText}>Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.attachChip} onPress={handlePickGallery}>
            <Ionicons name="image-outline" size={13} color={C.muted} />
            <Text style={styles.attachChipText}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachChip, uploadingVideo && { opacity: 0.5 }]}
            onPress={handlePickVideo} disabled={uploadingVideo}
          >
            {uploadingVideo
              ? <ActivityIndicator size="small" color={C.green} />
              : <Ionicons name="videocam-outline" size={13} color={C.muted} />}
            <Text style={styles.attachChipText}>{uploadingVideo ? 'Uploading…' : 'Video'}</Text>
          </TouchableOpacity>
          {/* ✅ NEW: real gift that turns into money for the receiver */}
          <TouchableOpacity style={styles.attachChip} onPress={() => setShowGifts(true)}>
            <Ionicons name="gift-outline" size={13} color={C.gold} />
            <Text style={[styles.attachChipText, { color: C.gold }]}>Gift</Text>
          </TouchableOpacity>
        </ScrollView>

        <View style={styles.inputBar}>
          <TouchableOpacity
            style={[styles.inputIconBtn, isRecording && { borderColor: C.red, backgroundColor: 'rgba(229,57,53,0.12)' }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={isRecording ? () => finishRecording(false) : startRecording}
          >
            {isRecording
              ? <Ionicons name="trash-outline" size={19} color={C.red} />
              : <Ionicons name="mic-outline" size={20} color={C.green} />}
          </TouchableOpacity>
          <View style={[styles.inputWrap, isRecording && { borderColor: C.red }]}>
            {isRecording
              ? <Text style={styles.recordingText}>🔴 {formatSecs(recordingDur)}  Recording… tap ✓ to send</Text>
              : <TextInput
                  style={styles.inputField}
                  placeholder={`Message ${(otherName || 'them').split(' ')[0]}…`}
                  placeholderTextColor={C.muted2}
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={handleSend}
                  multiline maxLength={2000}
                />}
            {!isRecording && (
              <View style={{ alignItems: 'flex-end' }}>
                {showCharCount && (
                  <Text style={[styles.charCounter, charCount >= 1950 && { color: C.red }]}>
                    {2000 - charCount}
                  </Text>
                )}
                <TouchableOpacity onPress={() => setShowEmoji(!showEmoji)}>
                  <Ionicons name="happy-outline" size={20} color={showEmoji ? C.green : C.muted} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.sendBtn, (isRecording ? false : (sending || !inputText.trim())) && { opacity: 0.45 }]}
            onPress={isRecording ? () => finishRecording(true) : handleSend}
            disabled={isRecording ? false : (sending || !inputText.trim())}
          >
            {sending && !isRecording
              ? <ActivityIndicator color="#000" size="small" />
              : <Ionicons name={isRecording ? 'checkmark' : 'send'} size={isRecording ? 22 : 17} color="#000" />}
          </TouchableOpacity>
        </View>
      </KbWrap>

      {/* Reaction Picker */}
      {composerAssets && (
        <MediaComposer assets={composerAssets} onClose={() => setComposerAssets(null)} onSend={sendComposed} />
      )}

      {viewerId && viewerStart >= 0 && (
        <MediaViewer items={mediaItems} startIndex={viewerStart} onClose={() => setViewerId(null)} onSeen={markMediaOpened} />
      )}

      {/* ✅ NEW: gift sheet — same look and flow as the feed (videos.tsx) */}
      <Modal visible={showGifts} transparent animationType="slide" onRequestClose={closeGifts}>
        <View style={styles.giftBackdrop}>
          <View style={styles.giftModal}>
            <View style={styles.giftModalHeader}>
              <Text style={styles.giftModalTitle} numberOfLines={1}>Send gift to {otherName || 'them'}</Text>
              <TouchableOpacity onPress={closeGifts} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.giftBalance}>
              <Ionicons name="diamond" size={18} color="#ffd700" />
              <Text style={styles.giftBalanceText}>{myCoins.toFixed(0)} coins ({coinsToNGN(myCoins)})</Text>
            </View>
            {!customGiftMode ? (
              <>
                <ScrollView style={{ padding: 16 }}>
                  {GIFT_PACKAGES.map(g => (
                    <TouchableOpacity key={g.id} disabled={giftBusy} activeOpacity={0.7}
                      style={[styles.giftPackage, { borderColor: g.color }, giftBusy && { opacity: 0.5 }]}
                      onPress={() => sendGiftAmount(g.coins, g.name, g.icon)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <Text style={{ fontSize: 40 }}>{g.icon}</Text>
                        <View style={{ gap: 4 }}>
                          <Text style={styles.giftName}>{g.name}</Text>
                          <Text style={styles.giftAmount}>{g.coins} coins</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={24} color={g.color} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <TouchableOpacity style={styles.customGiftButton} activeOpacity={0.7} onPress={() => setCustomGiftMode(true)}>
                  <Ionicons name="create-outline" size={20} color="#00ff88" />
                  <Text style={styles.customGiftButtonText}>Custom amount</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ padding: 20 }}>
                <Text style={styles.customGiftLabel}>Enter amount (coins)</Text>
                <TextInput style={styles.customGiftInput} value={customGiftAmount} onChangeText={setCustomGiftAmount}
                  placeholder="10" placeholderTextColor="#555" keyboardType="number-pad" autoFocus />
                {!!customGiftAmount && !isNaN(parseFloat(customGiftAmount)) && (
                  <Text style={styles.customGiftPreview}>{coinsToNGN(parseFloat(customGiftAmount))}</Text>
                )}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
                  <TouchableOpacity style={[styles.customGiftAction, { backgroundColor: '#222' }]}
                    onPress={() => { setCustomGiftMode(false); setCustomGiftAmount(''); }}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity disabled={giftBusy} style={[styles.customGiftAction, { backgroundColor: '#00ff88' }, giftBusy && { opacity: 0.5 }]}
                    onPress={handleSendCustomGift}>
                    {giftBusy ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: '800' }}>Send gift</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showReactions} transparent animationType="fade"
        onRequestClose={() => setShowReactions(false)}>
        <TouchableOpacity style={styles.reactionOverlay} onPress={() => setShowReactions(false)}>
          <View style={styles.reactionPicker}>
            {REACTIONS.map(r => (
              <TouchableOpacity key={r} onPress={() => handleReaction(r)}>
                <Text style={{ fontSize: 28 }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.msgOptions}>
            {selectedMsg?.sender_id === user?.id && (
              <TouchableOpacity style={styles.msgOption} onPress={() => {
                setShowReactions(false);
                if (selectedMsg) deleteMessage(selectedMsg.id);
              }}>
                <Ionicons name="trash-outline" size={14} color={C.red} />
                <Text style={{ color: C.red, fontSize: 14, fontWeight: '600', marginLeft: 6 }}>Delete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.msgOption} onPress={() => {
              setShowReactions(false);
              if (selectedMsg) setReplyTo(selectedMsg);
            }}>
              <Ionicons name="return-down-back-outline" size={14} color={C.white} />
              <Text style={{ color: C.white, fontSize: 14, fontWeight: '600', marginLeft: 6 }}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.msgOption} onPress={() => {
              setShowReactions(false);
              if (selectedMsg) handleReplyWithVideo(selectedMsg);
            }}>
              <Ionicons name="videocam-outline" size={14} color={C.green} />
              <Text style={{ color: C.green, fontSize: 14, fontWeight: '600', marginLeft: 6 }}>Reply with video</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* NEW: chat settings sheet — Block / Report, replacing the dead ... button */}
      <Modal visible={showChatSettings} transparent animationType="slide"
        onRequestClose={() => setShowChatSettings(false)}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setShowChatSettings(false)}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <TouchableOpacity style={styles.sheetRow} onPress={() => {
              setShowChatSettings(false);
              setTimeout(() => setShowReportReasons(true), 300);
            }}>
              <Ionicons name="flag-outline" size={20} color={C.white} />
              <Text style={styles.sheetRowText}>Report {otherName || 'User'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetRow} onPress={shareInvite}>
              <Ionicons name="link-outline" size={20} color={C.white} />
              <Text style={styles.sheetRowText}>Share my chat invite link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetRow} onPress={toggleLowData}>
              <Ionicons name="cellular-outline" size={20} color={lowData ? C.green : C.white} />
              <Text style={[styles.sheetRowText, lowData && { color: C.green }]}>
                Low-data mode: {lowData ? 'On' : 'Off'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetRow} onPress={handleBlockUser}>
              <Ionicons name="hand-left-outline" size={20} color={C.red} />
              <Text style={[styles.sheetRowText, { color: C.red }]}>Block {otherName || 'User'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowChatSettings(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* NEW: report reason picker — same categories as the existing video report flow */}
      <Modal visible={showReportReasons} transparent animationType="slide"
        onRequestClose={() => setShowReportReasons(false)}>
        <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setShowReportReasons(false)}>
          <View style={styles.sheetContent}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>Report {otherName || 'User'}</Text>
              <TouchableOpacity onPress={() => setShowReportReasons(false)}>
                <Ionicons name="close" size={22} color={C.white} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetSubtitle}>Why are you reporting @{otherName}?</Text>
            {REPORT_REASONS.map(r => (
              <TouchableOpacity key={r.label} style={styles.sheetRow} onPress={() => handleSubmitReport(r.label)}>
                <Ionicons name={r.icon as any} size={20} color={C.white} />
                <Text style={styles.sheetRowText}>{r.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={C.muted} style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowReportReasons(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Call Modal */}
      <CallModal
        visible={callState.isInCall}
        otherName={otherName || 'Them'}
        otherPhoto={otherPhoto}
        callState={callState}
        localVideoTrack={localVideoTrack}
        remoteVideoTrack={remoteVideoTrack}
        remoteCamOff={remoteCamOff}
        remoteMicMuted={remoteMicMuted}
        myName={displayName}
        myPhoto={(userProfile as any)?.avatar_url || userProfile?.photo_url || undefined}
        onEnd={endCall}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
        onToggleCamera={toggleCamera}
      />

      {/* ✅ REMOVED (ringing rework): the incoming-call and watch-invite modals
          that used to live here. They popped up on top of the global banner
          (two popups, two ringtones) and were the reason the ring looked
          different on every screen. See globalIncomingSignal.tsx. */}
    </SafeAreaView>
  );
}

// ── STYLES ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.black },
  chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.black },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  chatAv:  { width: 40, height: 40, borderRadius: 20 },
  chatOnlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 5.5, borderWidth: 2, borderColor: C.black },
  chatUserInfo:   { flex: 1 },
  chatName:       { fontSize: 15.5, fontWeight: '700', color: C.white },
  chatOnlineText: { fontSize: 11, color: C.green, fontWeight: '600' },
  chatStreak:     { fontSize: 11, color: C.gold,  fontWeight: '600' },
  chatActions:    { flexDirection: 'row', gap: 6 },
  chatActBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  featRow: { flexShrink: 0, maxHeight: 44, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.black },
  featChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, height: 30 },
  featChipOn:     { backgroundColor: C.greenBg, borderColor: C.green },
  featChipText:   { fontSize: 11.5, fontWeight: '600', color: C.muted },
  featChipTextOn: { color: C.green },
  vanishInd: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'center', backgroundColor: C.greenBg, borderWidth: 1, borderColor: C.green, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10, marginVertical: 4 },
  vanishIndText: { fontSize: 11.5, color: C.green, fontWeight: '600' },
  messagesList: { padding: 14, gap: 6, paddingBottom: 10 },
  emptyChatWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyChatIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyChatTitle: { fontSize: 17, fontWeight: '700', color: C.white, marginBottom: 6 },
  emptyChatText:  { fontSize: 14, color: C.muted },
  msgRow:   { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  msgRowMe: { flexDirection: 'row-reverse' },
  msgAv:    { width: 28, height: 28, marginBottom: 4 },
  msgAvImg: { width: 28, height: 28, borderRadius: 14 },
  msgAvPlaceholder: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.green },
  msgCol:   { maxWidth: '74%', gap: 2 },
  msgColMe: { alignItems: 'flex-end' },
  bubble:     { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleThem: { backgroundColor: '#0f1a14', borderWidth: 1, borderColor: '#1b3427', borderBottomLeftRadius: 5 },
  bubbleMe:   { backgroundColor: C.green, borderBottomRightRadius: 5 },
  bubbleText:   { fontSize: 14, lineHeight: 21, color: C.white },
  bubbleTextMe: { color: '#000', fontWeight: '500' },
  disappearBadge: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 2 },
  replyPreview:   { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, borderLeftWidth: 3, borderLeftColor: C.white, padding: 6, marginBottom: 6 },
  replyPreviewMe: { borderLeftColor: 'rgba(0,0,0,0.4)', backgroundColor: 'rgba(0,0,0,0.15)' },
  replyName:      { fontSize: 10, color: C.green, fontWeight: '700', marginBottom: 2 },
  replyText:      { fontSize: 12, color: C.muted },
  voiceBubble:  { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 175 },
  voicePlayBtn: { width: 33, height: 33, borderRadius: 16.5, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center' },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 26 },
  wbar:     { flex: 1, borderRadius: 2, minHeight: 3 },
  voiceDur: { fontSize: 10.5, color: C.muted, flexShrink: 0 },
  msgImage: { width: 180, height: 200, borderRadius: 14 },
  uploadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  imgErrorBox: { width: 180, height: 120, borderRadius: 14, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 8 },
  imgErrorText: { fontSize: 12, color: C.muted2 },
  videoCard:     { padding: 0, overflow: 'hidden', borderRadius: 14, width: 210 },
  videoThumb:    { height: 120, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  videoThumbImg: { width: '100%', height: '100%', position: 'absolute' },
  videoPlayIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,230,118,0.9)', alignItems: 'center', justifyContent: 'center' },
  videoInfo:     { padding: 10 },
  videoTitle:    { fontSize: 12, fontWeight: '600', color: C.white, marginBottom: 2 },
  videoViews:    { fontSize: 11, color: C.muted },
  cowatchMsgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 7, backgroundColor: C.green, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8, alignSelf: 'flex-start' },
  cowatchMsgBtnText: { fontSize: 11, fontWeight: '700', color: '#000' },
  videoPreviewBox: { width: 150, height: 100, borderRadius: 12, overflow: 'hidden', backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 6 },
  videoPreviewLabel: { fontSize: 12, color: C.muted, fontWeight: '600' },
  reactionsRow:   { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  reactionsRowMe: { justifyContent: 'flex-end' },
  reactionPill:   { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 6 },
  reactionCount:  { fontSize: 11, color: C.white, fontWeight: '600' },
  msgMeta:   { flexDirection: 'row', gap: 4, alignItems: 'center', paddingHorizontal: 4, marginTop: 4 },
  msgMetaMe: { justifyContent: 'flex-end' },
  msgTime:   { fontSize: 10.5, color: C.muted2 },
  readTick:  { fontSize: 11, color: C.muted2 },
  replyBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 14, paddingVertical: 8 },
  replyBannerBar:     { width: 3, height: 36, borderRadius: 2, backgroundColor: C.green },
  replyBannerContent: { flex: 1 },
  replyBannerName:    { fontSize: 11, color: C.green, fontWeight: '700', marginBottom: 2 },
  replyBannerText:    { fontSize: 13, color: C.muted },
  replyCloseBtn:      { padding: 4 },
  viewerTop:   { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10, backgroundColor: 'rgba(0,0,0,0.35)' },
  viewerClose: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  viewerCount: { color: '#fff', fontSize: 14, fontWeight: '700' },
  mediaCaption: { color: C.white, fontSize: 14.5, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 3, maxWidth: 230 },
  viewerCaption: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 34, backgroundColor: 'rgba(0,0,0,0.55)' },
  viewerCaptionText: { color: '#fff', fontSize: 15 },
  composerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingBottom: 10 },
  composerThumb: { width: 54, height: 54, borderRadius: 8, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  composerThumbDot: { position: 'absolute', right: 3, top: 3, width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  composerBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 30 : 16 },
  composerInput: { flex: 1, maxHeight: 110, backgroundColor: '#1c1c1c', color: '#fff', fontSize: 15, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  composerSend: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  composerBadge: { position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  composerBadgeText: { fontSize: 11, fontWeight: '800', color: '#000' },
  retryPill:  { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)' },
  cancelPill: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.62)' },
  retryText:  { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  lowDataOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12 },
  lowDataText:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  giftBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  giftModal: { backgroundColor: '#0a0a0a', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 30, maxHeight: '85%' },
  giftModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  giftModalTitle: { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  giftBalance: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
  giftBalanceText: { color: '#ffd700', fontSize: 14, fontWeight: '700' },
  giftPackage: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, backgroundColor: '#1a1a1a', borderWidth: 1.5, borderRadius: 16, marginBottom: 12 },
  giftName: { color: '#fff', fontSize: 18, fontWeight: '600' },
  giftAmount: { color: '#00ff88', fontSize: 14, fontWeight: '500' },
  customGiftButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, marginHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#00ff88' },
  customGiftButtonText: { color: '#00ff88', fontSize: 16, fontWeight: '600' },
  customGiftLabel: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  customGiftInput: { backgroundColor: '#1a1a1a', color: '#fff', fontSize: 24, fontWeight: '600', padding: 16, borderRadius: 12, borderWidth: 2, borderColor: '#00ff88' },
  customGiftPreview: { color: '#ffd700', fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  customGiftAction: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16, borderRadius: 12 },
  giftCard:     { alignItems: 'center', gap: 4, paddingVertical: 14, paddingHorizontal: 22, borderRadius: 18, borderWidth: 1, minWidth: 150 },
  giftCardMe:   { backgroundColor: 'rgba(245,197,24,0.12)', borderColor: C.gold },
  giftCardThem: { backgroundColor: C.card, borderColor: C.gold },
  giftCardTitle:{ fontSize: 13, fontWeight: '700', color: C.white },
  giftCardCoins:{ fontSize: 11.5, fontWeight: '700', color: C.gold },
  emojiPanel: { backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.border, padding: 10 },
  emojiBtn:   { padding: 4, borderRadius: 8 },
  attachRow: { flexShrink: 0, maxHeight: 44, paddingVertical: 7 },
  attachChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 12, height: 30, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 20 },
  attachChipText: { fontSize: 11.5, fontWeight: '600', color: C.muted },
  charCounter: { fontSize: 10, color: C.muted, marginBottom: 2 },
  inputBar: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingBottom: Platform.OS === 'ios' ? 8 : 14, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.black },
  inputIconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 12 },
  inputField:    { flex: 1, color: C.white, fontSize: 14.5, paddingVertical: 10, maxHeight: 100 },
  recordingText: { flex: 1, color: C.red, fontSize: 13, paddingVertical: 10 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  reactionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  reactionPicker: { flexDirection: 'row', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 28, paddingVertical: 10, paddingHorizontal: 14, gap: 12 },
  msgOptions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  msgOption:  { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 20 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetContent: { backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30 },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 14 },
  sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: C.white },
  sheetSubtitle: { fontSize: 13, color: C.muted, marginBottom: 12 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sheetRowText: { fontSize: 15, fontWeight: '600', color: C.white },
  sheetCancel: { marginTop: 14, backgroundColor: C.card2, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  sheetCancelText: { fontSize: 15, fontWeight: '700', color: C.white },
  callModal: { flex: 1, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  callPulse1: { position: 'absolute', top: 110, alignSelf: 'center', width: 180, height: 180, borderRadius: 90, borderWidth: 1, borderColor: 'rgba(0,230,118,0.25)' },
  callPulse2: { position: 'absolute', top: 85,  alignSelf: 'center', width: 230, height: 230, borderRadius: 115, borderWidth: 1, borderColor: 'rgba(0,230,118,0.15)' },
  callPulse3: { position: 'absolute', top: 60,  alignSelf: 'center', width: 280, height: 280, borderRadius: 140, borderWidth: 1, borderColor: 'rgba(0,230,118,0.07)' },
  callTop:    { alignItems: 'center', gap: 12, zIndex: 1 },
  callAvatarWrap:        { position: 'relative' },
  callAvatar:            { width: 110, height: 110, borderRadius: 55 },
  callAvatarRing:        { position: 'absolute', top: -5, left: -5, width: 120, height: 120, borderRadius: 60, borderWidth: 2.5, borderColor: C.green },
  callAvatarPlaceholder: { width: 110, height: 110, borderRadius: 55, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.green },
  callAvatarInitial:     { fontSize: 42, fontWeight: '800', color: C.green },
  callName:              { fontSize: 26, fontWeight: '800', color: C.white, letterSpacing: -0.5 },
  callStatus:            { fontSize: 14, color: C.muted, letterSpacing: 0.3 },
  callTypeBadge:         { backgroundColor: 'rgba(0,230,118,0.08)', borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 16 },
  callTypeText:          { fontSize: 12, color: C.green, fontWeight: '600', letterSpacing: 0.5 },
  callControls:          { flexDirection: 'row', alignItems: 'center', gap: 18, zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' },
  callCtrl:              { alignItems: 'center', gap: 8 },
  callCtrlBtn:           { width: 60, height: 60, borderRadius: 30, backgroundColor: '#1c1c1c', borderWidth: 1, borderColor: '#2e2e2e', alignItems: 'center', justifyContent: 'center' },
  callCtrlActive:        { backgroundColor: 'rgba(0,230,118,0.12)', borderColor: C.green },
  callEndBtn:            { backgroundColor: C.red, borderColor: '#c62828', width: 68, height: 68, borderRadius: 34 },
  callCtrlLabel:         { fontSize: 11, color: '#666', fontWeight: '500', letterSpacing: 0.2 },

  // ✅ NEW: local camera picture-in-picture preview during a video call
  localPreview: { position: 'absolute', right: 16, width: 100, height: 140, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111', borderWidth: 1, borderColor: '#2e2e2e', zIndex: 2 },

  // ✅ NEW: incoming call banner
  incomingOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  incomingCard:         { width: '100%', backgroundColor: '#111', borderRadius: 28, paddingVertical: 36, paddingHorizontal: 24, alignItems: 'center', borderWidth: 1, borderColor: '#242424' },
  incomingAvatar:              { width: 88, height: 88, borderRadius: 44, marginBottom: 16 },
  incomingAvatarPlaceholder:   { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.green },
  incomingAvatarInitial:       { fontSize: 32, fontWeight: '800', color: C.green },
  incomingName:         { fontSize: 20, fontWeight: '800', color: C.white },
  incomingSubtitle:     { fontSize: 13, color: C.muted, marginTop: 4, marginBottom: 28 },
  incomingActions:      { flexDirection: 'row', gap: 40 },
  incomingBtn:          { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  incomingDecline:      { backgroundColor: C.red },
  incomingAccept:       { backgroundColor: C.green },
});