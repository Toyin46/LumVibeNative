// src/lib/incomingRing.ts   (NEW FILE)
//
// The single place that knows "is something ringing right now?".
// Every source feeds it:
//   • Supabase realtime (per-user channel)      -> globalIncomingSignal.tsx
//   • FCM / Expo push while the app is open     -> ringBackground.ts
//   • notification taps (Answer / Join / body)  -> ringBackground.ts
// and every UI reads from it (top banner + full-screen screen), so:
//   • it can never show twice (chat screen + home screen used to each pop
//     their own modal — visible behind the modal in your screenshot)
//   • it rings exactly once (ringtone + vibration loop) and stops the moment
//     the call is answered / declined / cancelled / 30 s pass
//   • a late duplicate (push arriving after the realtime signal) is ignored

import { useSyncExternalStore } from 'react';
import { AppState, Platform, Vibration } from 'react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { supabase } from '../config/supabase';
import { sendBroadcastOnce } from './realtimeSend';
import { RingPayload } from './ringPayload';
import { cancelRingNotification, displayIncomingCallNotifee } from './incomingCallNotifee';

const RING_MS = 90000; // rings for 1 min 30 s, then stops by itself
const HANDLED_TTL_UNIQUE_MS = 120000; // id includes a per-call id: safe to remember for long
const HANDLED_TTL_LEGACY_MS = 15000;  // old clients without callId: keep short

export interface IncomingState {
  payload: RingPayload;
  /** false = small top banner (image 6), true = full screen (image 3) */
  expanded: boolean;
}

// ─────────────────────────────────────────────────────────────
// state store
// ─────────────────────────────────────────────────────────────
let state: IncomingState | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const handled = new Map<string, number>();

function emit() { listeners.forEach(l => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useIncoming(): IncomingState | null {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function getIncoming() { return state; }

function wasHandled(p: RingPayload) {
  const t = handled.get(p.id);
  if (!t) return false;
  return Date.now() - t < (p.unique ? HANDLED_TTL_UNIQUE_MS : HANDLED_TTL_LEGACY_MS);
}

// ─────────────────────────────────────────────────────────────
// ringtone + vibration (in-app ring; the closed-app ring is the
// notification channel's own looping sound)
// ─────────────────────────────────────────────────────────────
let player: any = null;

function startRing(kind: 'call' | 'cowatch') {
  stopRing();
  try {
    // required lazily so importing this file from index.js (headless) is free
    const { createAudioPlayer, AudioModule } = require('expo-audio');
    AudioModule.setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'duckOthers',
    }).catch(() => {});
    // Static require()s so Metro bundles both files. Voice + video calls use
    // "ringtone.mp3.wav"; Watch Together invites use "cowatch ringtone.mp3".
    const source = kind === 'cowatch'
      ? require('../assets/sounds/cowatch ringtone.mp3')
      : require('../assets/sounds/ringtone.mp3.wav');
    player = createAudioPlayer(source);
    player.loop = true;
    // The ringtones are ~11 s long. `loop` alone is not reliable on every
    // phone, so also restart by hand the moment it finishes.
    try {
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish && player) {
          try { player.seekTo(0); player.play(); } catch (_) {}
        }
      });
    } catch (_) {}
    player.play();
  } catch (e) {
    console.warn('[ring] in-app ringtone failed:', e);
  }
  try { Vibration.vibrate([0, 900, 700], true); } catch (_) {}
}

function stopRing() {
  if (player) {
    try { player.pause(); player.remove(); } catch (_) {}
    player = null;
  }
  try { Vibration.cancel(); } catch (_) {}
}

function clearLocal() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  stopRing();
  state = null;
  emit();
}

// ─────────────────────────────────────────────────────────────
// show / resolve
// ─────────────────────────────────────────────────────────────
/**
 * Show the ring UI. Returns false when ignored (duplicate, already handled,
 * or the app is not in the foreground — the push notification covers that).
 * `force` is for user-initiated opens (they tapped a notification, so the
 * app is by definition in the foreground even if AppState hasn't caught up).
 */
export function showIncoming(
  payload: RingPayload,
  opts: { expanded?: boolean; ring?: boolean; force?: boolean } = {},
): boolean {
  if (!opts.force && AppState.currentState === 'background') return false;
  if (!opts.force && wasHandled(payload)) return false;

  if (state && state.payload.id === payload.id) {
    if (opts.expanded && !state.expanded) { state = { ...state, expanded: true }; emit(); }
    return true;
  }
  if (state) clearLocal(); // newest one wins

  state = { payload, expanded: !!opts.expanded };
  if (opts.ring !== false) startRing(payload.type === 'cowatch_invite' ? 'cowatch' : 'call');
  ringTimer = setTimeout(() => resolveIncoming(payload, 'timeout'), RING_MS);
  emit();
  return true;
}

export function setExpanded(expanded: boolean) {
  if (!state) return;
  state = { ...state, expanded };
  emit();
}

/** Stops everything for this ring and remembers it so a late duplicate can't re-ring. */
export function resolveIncoming(p: RingPayload, _reason: 'answered' | 'declined' | 'cancelled' | 'timeout' | 'joined') {
  handled.set(p.id, Date.now());
  cancelRingNotification(p).catch(() => {});
  if (state && state.payload.id === p.id) clearLocal();
}

/** Caller hung up before we answered (push or realtime says so). */
export function cancelIncomingByTarget(t: { roomName?: string; sessionId?: string }) {
  cancelRingNotification(
    t.sessionId ? { type: 'cowatch_invite', sessionId: t.sessionId } : { type: 'incoming_call', roomName: t.roomName },
  ).catch(() => {});
  const cur = state?.payload;
  if (!cur) return;
  const same = t.sessionId ? cur.sessionId === t.sessionId : !!t.roomName && cur.roomName === t.roomName;
  if (same) resolveIncoming(cur, 'cancelled');
}

// If the person leaves the app while it is ringing, hand the ring to the
// system notification so it keeps ringing on the lock screen / home screen.
let appStateSub: { remove: () => void } | null = null;
export function initIncomingRing() {
  if (appStateSub) return;
  appStateSub = AppState.addEventListener('change', (next) => {
    if (next === 'active' || !state) return;
    const p = state.payload;
    clearLocal();
    if (Platform.OS === 'android') displayIncomingCallNotifee(p).catch(() => {});
  });
}

// ─────────────────────────────────────────────────────────────
// navigation (all targets already exist in your navigators)
// ─────────────────────────────────────────────────────────────
type NavRef = React.RefObject<NavigationContainerRef<any> | null>;
let navRef: NavRef | null = null;
export function setRingNavRef(r: NavRef) { navRef = r; }

/** Cold start: the navigator exists a moment before 'Main' (logged-in area)
 *  does. Navigating too early is silently dropped, so wait for it. */
function whenNavReady(fn: (nav: NavigationContainerRef<any>) => void, tries = 80) {
  const attempt = (left: number) => {
    const nav = navRef?.current;
    let ready = false;
    try { ready = !!nav && nav.isReady() && !!nav.getRootState()?.routeNames?.includes('Main'); } catch (_) {}
    if (ready) { fn(nav!); return; }
    if (left > 0) setTimeout(() => attempt(left - 1), 250);
  };
  attempt(tries);
}

function chatParams(p: RingPayload, extra: Record<string, any> = {}) {
  return {
    id: p.conversationId,
    otherUserId: p.fromId,
    otherName: p.fromName,
    otherPhoto: p.fromPhoto,
    ...extra,
  };
}

function goChat(p: RingPayload, extra: Record<string, any> = {}) {
  whenNavReady(nav => nav.navigate('Main', {
    screen: 'Messages',
    params: { screen: 'ChatDM', params: chatParams(p, extra) },
  }));
}

/** Answer a call: opens the chat with that person and joins the LiveKit room. */
export function answerIncoming(p: RingPayload) {
  resolveIncoming(p, 'answered');
  goChat(p, {
    autoAnswerCall: true,
    autoAnswerCallType: p.callType === 'video' ? 'video' : 'voice',
    autoAnswerNonce: Date.now(), // lets the same chat answer a 2nd call later
  });
}

/** Join a Watch Together invite: opens the SAME session (same feed, in sync). */
export function joinIncomingCowatch(p: RingPayload) {
  resolveIncoming(p, 'joined');
  whenNavReady(nav => nav.navigate('Main', {
    screen: 'Messages',
    params: {
      screen: 'Cowatch',
      params: {
        conversationId: p.conversationId,
        sessionId: p.sessionId,
        otherUserId: p.fromId,
        otherName: p.fromName,
        otherPhoto: p.fromPhoto || '',
      },
    },
  }));
}

/** "Message" button on the full-screen screen: decline, then open the chat. */
export function messageIncoming(p: RingPayload) {
  declineIncoming(p);
  goChat(p);
}

/** Decline. For calls this also tells the caller (so their phone stops
 *  ringing) and writes "Declined" into the chat history. */
export async function declineIncoming(p: RingPayload) {
  resolveIncoming(p, 'declined');
  if (p.type !== 'incoming_call' || !p.roomName || !p.conversationId) return;
  try {
    sendBroadcastOnce(`call_signal:${p.conversationId}`, 'call_declined', { roomName: p.roomName });
    await supabase.from('messages').insert({
      conversation_id: p.conversationId,
      sender_id: p.fromId,
      message_type: 'call_log',
      content: JSON.stringify({ callType: p.callType, outcome: 'declined' }),
    });
  } catch (e) {
    console.warn('[ring] decline signalling error:', e);
  }
}

// ─────────────────────────────────────────────────────────────
// notification-tap actions coming from a headless / background context
// (the app may not be mounted yet, so they wait in a queue)
// ─────────────────────────────────────────────────────────────
// 'chat' = just open the conversation (the lock-screen "Message" button)
// 'peek' = the phone was locked and Android launched the app through the ring's
// full-screen action: show the screen but do NOT stop/duplicate the ring.
// 'openchat' = tap on a chat-message notification -> open that conversation.
export type RingAction =
  | { action: 'answer' | 'join' | 'open' | 'chat' | 'peek'; payload: RingPayload }
  | { action: 'openchat'; chat: { conversationId: string; senderId: string; senderName: string; senderPhoto?: string } };

const actionQueue: RingAction[] = [];
const actionSeen = new Map<string, number>();
const actionListeners = new Set<() => void>();

export function enqueueRingAction(a: RingAction) {
  const key = a.action === 'openchat' ? `chat:${a.chat.conversationId}` : `${a.payload.id}:${a.action}`;
  const window = a.action === 'openchat' ? 3000 : 60000; // initial-notification + event both fire
  const seen = actionSeen.get(key);
  if (seen && Date.now() - seen < window) return;
  actionSeen.set(key, Date.now());
  actionQueue.push(a);
  actionListeners.forEach(l => l());
}

function runAction(a: RingAction) {
  if (a.action === 'openchat') {
    const c = a.chat;
    whenNavReady(nav => nav.navigate('Main', {
      screen: 'Messages',
      params: {
        screen: 'ChatDM',
        params: { id: c.conversationId, otherUserId: c.senderId, otherName: c.senderName, otherPhoto: c.senderPhoto || '' },
      },
    }));
    return;
  }
  if (a.action === 'answer') answerIncoming(a.payload);
  else if (a.action === 'join') joinIncomingCowatch(a.payload);
  else if (a.action === 'chat') goChat(a.payload);
  else if (a.action === 'peek') showIncoming(a.payload, { expanded: true, ring: false, force: true });
  else showIncoming(a.payload, { expanded: true, force: true });
}

/** Mounted once from App.tsx. Drains anything queued before the app was ready. */
export function startRingActionRunner(): () => void {
  const run = () => { while (actionQueue.length) runAction(actionQueue.shift()!); };
  actionListeners.add(run);
  run();
  return () => { actionListeners.delete(run); };
}
