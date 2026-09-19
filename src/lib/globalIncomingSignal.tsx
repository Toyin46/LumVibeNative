// src/lib/globalIncomingSignal.tsx
//
// ✅ NEW: fixes "I have to already be on the chat screen for the ring to
// show" — chat/[id].tsx's useCall() hook only subscribes to
// `call_signal:${conversationId}` while THAT screen is mounted, so a call
// arriving while someone is watching a video, on their profile, in
// marketplace, etc. produced nothing in-app at all (they only had the
// native push/notifee layer to rely on, which is a separate, heavier
// path). This adds a SECOND, app-level signal: a per-USER channel
// (not per-conversation) that's subscribed to for as long as the app is
// open, regardless of which screen is showing — rendered as an overlay
// from App.tsx, above the navigator, so it can appear over anything.
//
// Deliberately does NOT duplicate any call-connection logic. Accepting
// just navigates into the real chat screen with the exact same
// autoAnswerCall route params callPushNavigation.ts already uses —
// chat/[id].tsx's existing, proven LiveKit join code takes it from there.
// This file only ever shows a banner and hands off; it never touches
// LiveKit directly.
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, Image, StyleSheet } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../config/supabase';
import { navigateToCall } from './callPushNavigation';

interface GlobalIncomingCall {
  kind: 'call';
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  callType: 'voice' | 'video';
  roomName: string;
  conversationId: string;
}

interface GlobalIncomingCowatch {
  kind: 'cowatch';
  inviterId: string;
  inviterName: string;
  inviterPhoto?: string;
  sessionId: string;
  conversationId: string;
}

type GlobalIncoming = GlobalIncomingCall | GlobalIncomingCowatch;

/**
 * Subscribes to this user's personal signal channel for as long as the
 * app is mounted — independent of which screen is currently showing.
 * Broadcasting to `call_signal_user:${userId}` (from chat/[id].tsx's
 * startCall and cowatch.tsx's broadcastCowatchInvite) is what reaches
 * this, alongside — not instead of — the existing per-conversation
 * channels those files already use for the "already on that exact
 * screen" case.
 */
export function useGlobalIncomingSignal(currentUserId: string | null | undefined) {
  const [incoming, setIncoming] = useState<GlobalIncoming | null>(null);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentUserId) return;
    const channel = supabase.channel(`call_signal_user:${currentUserId}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on('broadcast', { event: 'incoming_call' }, ({ payload }: any) => {
        setIncoming({
          kind: 'call',
          callerId: payload.callerId,
          callerName: payload.callerName || 'Someone',
          callerPhoto: payload.callerPhoto,
          callType: payload.callType === 'video' ? 'video' : 'voice',
          roomName: payload.roomName,
          conversationId: payload.conversationId,
        });
        if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
        ringTimerRef.current = setTimeout(() => setIncoming(null), 30000);
      })
      .on('broadcast', { event: 'call_cancelled_global' }, ({ payload }: any) => {
        setIncoming(prev => (prev?.kind === 'call' && prev.roomName === payload?.roomName ? null : prev));
      })
      .on('broadcast', { event: 'cowatch_invite' }, ({ payload }: any) => {
        setIncoming({
          kind: 'cowatch',
          inviterId: payload.inviterId,
          inviterName: payload.inviterName || 'Someone',
          inviterPhoto: payload.inviterPhoto,
          sessionId: payload.sessionId,
          conversationId: payload.conversationId,
        });
        if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
        ringTimerRef.current = setTimeout(() => setIncoming(null), 30000);
      })
      .subscribe();

    return () => {
      if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  return { incoming, dismiss: () => setIncoming(null) };
}

// ✅ NEW: fire-and-forget helper — same one-shot subscribe→send→remove
// pattern already used elsewhere in this codebase (e.g. cowatch.tsx's
// broadcastCowatchInvite) for a channel that only needs to deliver a
// single message, not stay open.
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

/**
 * The actual overlay UI. Rendered once from App.tsx, above the
 * navigator, so it can appear regardless of which screen is active.
 * Deliberately minimal and self-contained — does not import or depend on
 * chat/[id].tsx's styles, so nothing there can be affected by this.
 */
export function GlobalIncomingBanner({
  incoming,
  dismiss,
  navRef,
}: {
  incoming: GlobalIncoming | null;
  dismiss: () => void;
  navRef: React.RefObject<NavigationContainerRef<any> | null>;
}) {
  const declineCall = useCallback(async (call: GlobalIncomingCall) => {
    dismiss();
    try {
      // Same broadcast shape chat/[id].tsx's declineCall and index.js's
      // background decline handler already use — the caller's screen (if
      // open) reacts to this exactly the same as any other decline.
      const channel = supabase.channel(`call_signal:${call.conversationId}`, {
        config: { broadcast: { self: false } },
      });
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast', event: 'call_declined',
            payload: { roomName: call.roomName },
          }).finally(() => { supabase.removeChannel(channel); });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          supabase.removeChannel(channel);
        }
      });
      await supabase.from('messages').insert({
        conversation_id: call.conversationId,
        sender_id: call.callerId,
        message_type: 'call_log',
        content: JSON.stringify({ callType: call.callType, outcome: 'declined' }),
      });
    } catch (e) { console.warn('global decline error:', e); }
  }, [dismiss]);

  const acceptCall = useCallback((call: GlobalIncomingCall) => {
    dismiss();
    if (!navRef.current?.isReady()) return;
    // Reuses the EXACT same navigation shape (and thus the exact same,
    // already-working autoAnswerCall handling in chat/[id].tsx) that a
    // tapped push notification's "Answer" action uses — this banner is
    // just a faster way to reach the same place.
    navigateToCall(navRef.current, {
      type: 'incoming_call',
      conversationId: call.conversationId,
      callerId: call.callerId,
      callerName: call.callerName,
      callType: call.callType,
      roomName: call.roomName,
    });
  }, [dismiss, navRef]);

  const dismissCowatch = useCallback(() => { dismiss(); }, [dismiss]);

  const joinCowatch = useCallback((cw: GlobalIncomingCowatch) => {
    dismiss();
    if (!navRef.current?.isReady()) return;
    navRef.current.navigate('Main', {
      screen: 'Messages',
      params: {
        screen: 'Cowatch',
        params: {
          conversationId: cw.conversationId,
          sessionId: cw.sessionId,
          otherName: cw.inviterName,
        },
      },
    });
  }, [dismiss, navRef]);

  if (!incoming) return null;

  const isCall = incoming.kind === 'call';
  const name = isCall ? incoming.callerName : incoming.inviterName;
  const photo = isCall ? incoming.callerPhoto : incoming.inviterPhoto;
  const subtitle = isCall
    ? `Incoming ${incoming.callType === 'video' ? 'video' : 'voice'} call…`
    : 'Wants to watch together…';

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {photo
            ? <Image source={{ uri: photo }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarInitial}>{(name || 'U')[0].toUpperCase()}</Text>
              </View>}
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.declineBtn]}
              onPress={() => isCall ? declineCall(incoming) : dismissCowatch()}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.acceptBtn]}
              onPress={() => isCall ? acceptCall(incoming) : joinCowatch(incoming)}
            >
              <Ionicons name={isCall ? (incoming.callType === 'video' ? 'videocam' : 'call') : 'play'} size={24} color="#000" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center' },
  card: { width: '80%', backgroundColor: '#1a1a1a', borderRadius: 24, padding: 28, alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 16, borderWidth: 2, borderColor: '#22c55e' },
  avatarPlaceholder: { backgroundColor: '#22c55e33', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: '#22c55e' },
  name: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#999', marginBottom: 24 },
  actions: { flexDirection: 'row', gap: 40 },
  btn: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  declineBtn: { backgroundColor: '#ef4444' },
  acceptBtn: { backgroundColor: '#22c55e' },
});
