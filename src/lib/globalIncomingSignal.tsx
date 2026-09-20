// src/lib/globalIncomingSignal.tsx   (REPLACES the old file)
//
// In-app half of the ringing experience (the app is OPEN):
//
//   • useGlobalIncomingSignal(userId)  listens on the per-user realtime channel
//   • <GlobalIncomingBanner />         renders, above every screen:
//        – "image 6": a small heads-up banner at the top of the screen
//          [avatar] Name / Incoming voice call   Decline  Answer
//          (video call: Decline / Video, watch invite: Decline / Join)
//        – "image 3": tap the banner (or open from a notification) and it
//          becomes the full-screen call screen:
//          Decline · Swipe up to accept · Message
//     both ring (ringtone + vibration) until answered / declined / 30 s.
//
// All state lives in incomingRing.ts, so this can never double-show, and
// chat/[id].tsx no longer pops its own second modal + second ringtone.

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  Animated, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { parseRingData, RingPayload } from './ringPayload';
import {
  useIncoming, showIncoming, cancelIncomingByTarget, setExpanded,
  answerIncoming, joinIncomingCowatch, declineIncoming, messageIncoming,
} from './incomingRing';
import { ringBodyText, ringAcceptLabel } from './incomingCallNotifee';
// ✅ NEW: the full-screen view is shared with the lock-screen screen.
import { IncomingCallView, Avatar } from './IncomingCallView';

const GREEN = '#00e676';

// ─────────────────────────────────────────────────────────────
// realtime: per-USER channel, alive as long as the app is open
// ─────────────────────────────────────────────────────────────
export function useGlobalIncomingSignal(currentUserId: string | null | undefined) {
  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase.channel(`call_signal_user:${currentUserId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'incoming_call' }, ({ payload }: any) => {
        const p = parseRingData({ type: 'incoming_call', ...payload });
        if (p) showIncoming(p);
      })
      .on('broadcast', { event: 'call_cancelled_global' }, ({ payload }: any) => {
        cancelIncomingByTarget({ roomName: payload?.roomName });
      })
      .on('broadcast', { event: 'cowatch_invite' }, ({ payload }: any) => {
        const p = parseRingData({ type: 'cowatch_invite', ...payload });
        if (p) showIncoming(p);
      })
      .on('broadcast', { event: 'cowatch_cancelled' }, ({ payload }: any) => {
        cancelIncomingByTarget({ sessionId: payload?.sessionId });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId]);
}

/** fire-and-forget one-shot broadcast to someone's user channel */
export function broadcastToUserChannel(userId: string, event: string, payload: any) {
  const channel = supabase.channel(`call_signal_user:${userId}`, {
    config: { broadcast: { self: false } },
  });
  channel.subscribe((status: string) => {
    if (status === 'SUBSCRIBED') {
      channel.send({ type: 'broadcast', event, payload })
        .catch(() => {})
        .finally(() => { supabase.removeChannel(channel); });
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      supabase.removeChannel(channel);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// shared bits
// ─────────────────────────────────────────────────────────────
function onAccept(p: RingPayload) {
  if (p.type === 'cowatch_invite') joinIncomingCowatch(p);
  else answerIncoming(p);
}

// ─────────────────────────────────────────────────────────────
// "image 6" — heads-up banner at the top
// ─────────────────────────────────────────────────────────────
function IncomingBanner({ p }: { p: RingPayload }) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-180)).current;

  useEffect(() => {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6, speed: 14 }).start();
  }, [slide]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.bannerWrap, { top: insets.top + 8, transform: [{ translateY: slide }] }]}
    >
      <TouchableOpacity activeOpacity={0.92} style={styles.banner} onPress={() => setExpanded(true)}>
        <View style={styles.bannerRow}>
          <Avatar uri={p.fromPhoto} name={p.fromName} size={44} />
          <View style={styles.bannerTextCol}>
            <View style={styles.bannerTitleRow}>
              <Text style={styles.bannerName} numberOfLines={1}>{p.fromName}</Text>
              <Text style={styles.bannerApp}>LumVibe · now</Text>
            </View>
            <Text style={styles.bannerBody} numberOfLines={1}>{ringBodyText(p)}</Text>
          </View>
        </View>
        <View style={styles.bannerActions}>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 20 }} onPress={() => declineIncoming(p)}>
            <Text style={styles.bannerBtn}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }} onPress={() => onAccept(p)}>
            <Text style={styles.bannerBtn}>{ringAcceptLabel(p)}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// "image 3" — full-screen call screen (app open)
// ─────────────────────────────────────────────────────────────
function IncomingFullScreen({ p }: { p: RingPayload }) {
  return (
    <Modal visible transparent={false} animationType="slide" statusBarTranslucent onRequestClose={() => setExpanded(false)}>
      <StatusBar barStyle="light-content" backgroundColor="#0b141a" />
      <IncomingCallView
        p={p}
        onAccept={() => onAccept(p)}
        onDecline={() => declineIncoming(p)}
        onMessage={() => messageIncoming(p)}
      />
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// mounted once in App.tsx, above the navigator
// ─────────────────────────────────────────────────────────────
export function GlobalIncomingBanner() {
  const incoming = useIncoming();
  if (!incoming) return null;
  return incoming.expanded
    ? <IncomingFullScreen key={incoming.payload.id} p={incoming.payload} />
    : <IncomingBanner key={incoming.payload.id} p={incoming.payload} />;
}

const styles = StyleSheet.create({
  // banner (image 6)
  bannerWrap: { position: 'absolute', left: 10, right: 10, zIndex: 9999, elevation: 40 },
  banner: {
    backgroundColor: '#2a2a2c', borderRadius: 26, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerTextCol: { flex: 1 },
  bannerTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bannerName: { color: '#fff', fontSize: 17, fontWeight: '700', flexShrink: 1 },
  bannerApp: { color: '#9a9a9f', fontSize: 12 },
  bannerBody: { color: '#e6e6e8', fontSize: 15, marginTop: 2 },
  bannerActions: { flexDirection: 'row', gap: 40, marginTop: 14, paddingLeft: 2 },
  bannerBtn: { color: GREEN, fontSize: 16, fontWeight: '700' },
});
