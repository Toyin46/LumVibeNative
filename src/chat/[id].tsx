// src/chat/[id].tsx
// LumVibe — Direct Message Chat Screen

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, KeyboardAvoidingView,
  Platform, Modal, Alert, ActivityIndicator, Image,
  ScrollView, Dimensions, PermissionsAndroid,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAudioPlayer, useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';

// LiveKit replaces Agora completely
// FIX: Room/RoomEvent/Track/ConnectionState are core classes from livekit-client.
// @livekit/react-native only wraps native WebRTC + provides RN-specific UI (VideoView).
import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';
import { VideoView } from '@livekit/react-native';
import Constants from 'expo-constants';

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

const QUICK_EMOJIS = ['😂','❤️','🔥','😭','🙌','💀','👀','🎬','⚡','✨','🎵','😍','💯','🤩','😎','🤣'];
const REACTIONS    = ['❤️','😂','🔥','😮','😢','👏','💀','🙌'];

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

function useCall(currentUserId: string, displayName: string) {
  const [callState, setCallState] = useState<CallState>(CALL_INITIAL);
  const roomRef    = useRef<Room | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      endCall();
    };
  }, []);

  const startCall = useCallback(async (conversationId: string, callType: 'voice' | 'video') => {
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

    const roomName = `call_${conversationId}`;
    setCallState(prev => ({
      ...prev, isInCall: true, callType,
      isConnecting: true, remoteConnected: false, permDenied: false,
    }));

    try {
      const token = await fetchLiveKitToken(roomName, displayName || currentUserId);
      if (!token) throw new Error('Could not get call token');

      const room = new Room({
        adaptiveStream: true,
        dynacast:       true,
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

      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (mountedRef.current) setCallState(prev => ({ ...prev, remoteConnected: false }));
      });

      room.on(RoomEvent.Disconnected, () => {
        if (mountedRef.current) setCallState(CALL_INITIAL);
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

  const endCall = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (roomRef.current) {
      try { roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
    }
    setCallState(CALL_INITIAL);
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

  const toggleSpeaker = useCallback(() => {
    setCallState(p => ({ ...p, isSpeakerOn: !p.isSpeakerOn }));
  }, []);

  return { callState, startCall, endCall, toggleMute, toggleCamera, toggleSpeaker };
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
  message_type: 'text' | 'voice' | 'image' | 'video' | 'gif' | 'sticker' | 'system';
  content?: string; media_url?: string; media_duration?: number;
  media_thumbnail?: string; shared_video_id?: string;
  shared_video_title?: string; shared_video_thumbnail?: string;
  shared_video_views?: string; is_read: boolean; is_deleted: boolean;
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

async function sendTextMessage(
  conversationId: string, senderId: string, content: string,
  replyToId?: string, isDisappearing?: boolean, duration?: number,
): Promise<Message | null> {
  try {
    const payload: any = {
      conversation_id: conversationId, sender_id: senderId,
      message_type: 'text', content, is_disappearing: isDisappearing || false,
    };
    if (replyToId) payload.reply_to_message_id = replyToId;
    if (isDisappearing && duration) {
      const exp = new Date(); exp.setSeconds(exp.getSeconds() + duration);
      payload.disappears_at = exp.toISOString();
    }
    const { data, error } = await supabase.from('messages').insert(payload).select('*').single();
    if (error) throw error;
    return { ...data, reactions: [] };
  } catch (error) { console.error('sendTextMessage error:', error); return null; }
}

async function sendMediaMessage(
  conversationId: string, senderId: string,
  mediaUrl: string, mediaType: 'voice' | 'image' | 'video', duration?: number,
): Promise<Message | null> {
  try {
    const { data, error } = await supabase.from('messages')
      .insert({
        conversation_id: conversationId, sender_id: senderId,
        message_type: mediaType, media_url: mediaUrl, media_duration: duration,
      })
      .select('*').single();
    if (error) throw error;
    return { ...data, reactions: [] };
  } catch (error) { console.error('sendMediaMessage error:', error); return null; }
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
    await supabase.from('messages').update({ is_read: true })
      .eq('conversation_id', conversationId).neq('sender_id', userId).eq('is_read', false);
    await supabase.from('conversation_participants')
      .update({ unread_count: 0, last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId).eq('user_id', userId);
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

function subscribeToMessages(conversationId: string, onMessage: (msg: Message) => void): RealtimeChannel {
  return supabase.channel(`messages:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, async (payload: any) => {
      const { data } = await supabase.from('messages').select('*').eq('id', payload.new.id).single();
      if (data) onMessage({ ...data, reactions: [] } as Message);
    }).subscribe();
}

function subscribeToReactions(conversationId: string, onChange: () => void): RealtimeChannel {
  return supabase.channel(`reactions:${conversationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' },
      () => onChange()).subscribe();
}

const CLOUD_NAME    = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    || 'dvikzffqe';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'unsigned_preset_name';

async function uploadToCloudinary(fileUri: string, type: 'voice' | 'image' | 'video'): Promise<string | null> {
  try {
    const ext      = type === 'voice' ? 'm4a' : type === 'video' ? 'mp4' : 'jpg';
    const mime     = type === 'voice' ? 'audio/m4a' : type === 'video' ? 'video/mp4' : 'image/jpeg';
    const resType  = type === 'image' ? 'image' : 'video';
    const formData = new FormData();
    formData.append('file', { uri: fileUri, type: mime, name: `${type}_${Date.now()}.${ext}` } as any);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', `lumvibe_chat/${type}s`);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resType}/upload`, {
      method: 'POST', body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.secure_url || null;
  } catch (error) { console.error('uploadToCloudinary error:', error); return null; }
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
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const channelRef   = useRef<RealtimeChannel | null>(null);
  const reactionsRef = useRef<RealtimeChannel | null>(null);

  const loadMessages = useCallback(async () => {
    if (!conversationId || !isValidUUID(conversationId)) { setLoading(false); return; }
    try {
      const data = await getMessages(conversationId);
      setMessages(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
    if (conversationId && currentUserId) markAsRead(conversationId, currentUserId);
    if (conversationId) {
      channelRef.current = subscribeToMessages(conversationId, (newMsg) => {
        setMessages(prev => prev.find(m => m.id === newMsg.id) ? prev : [...prev, newMsg]);
        if (newMsg.sender_id !== currentUserId && conversationId && currentUserId)
          markAsRead(conversationId, currentUserId);
      });
      reactionsRef.current = subscribeToReactions(conversationId, loadMessages);
    }
    return () => {
      if (channelRef.current)   { supabase.removeChannel(channelRef.current);   channelRef.current = null; }
      if (reactionsRef.current) { supabase.removeChannel(reactionsRef.current); reactionsRef.current = null; }
    };
  }, [conversationId, currentUserId, loadMessages]);

  const sendText = useCallback(async (text: string, replyToId?: string): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const msg = await sendTextMessage(conversationId, currentUserId, text, replyToId, disappearingEnabled, disappearingDuration);
      return !!msg;
    } finally { setSending(false); }
  }, [conversationId, currentUserId, disappearingEnabled, disappearingDuration]);

  const sendVoiceNote = useCallback(async (fileUri: string, duration: number): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const url = await uploadToCloudinary(fileUri, 'voice');
      if (!url) return false;
      return !!(await sendMediaMessage(conversationId, currentUserId, url, 'voice', duration));
    } finally { setSending(false); }
  }, [conversationId, currentUserId]);

  const sendImage = useCallback(async (fileUri: string): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const url = await uploadToCloudinary(fileUri, 'image');
      if (!url) return false;
      return !!(await sendMediaMessage(conversationId, currentUserId, url, 'image'));
    } finally { setSending(false); }
  }, [conversationId, currentUserId]);

  const sendVideo = useCallback(async (fileUri: string): Promise<boolean> => {
    if (!conversationId || !currentUserId) return false;
    setSending(true);
    try {
      const url = await uploadToCloudinary(fileUri, 'video');
      if (!url) return false;
      return !!(await sendMediaMessage(conversationId, currentUserId, url, 'video'));
    } finally { setSending(false); }
  }, [conversationId, currentUserId]);

  const reactToMessage = useCallback(async (messageId: string, emoji: string): Promise<void> => {
    if (!currentUserId) return;
    await addReaction(messageId, currentUserId, emoji);
  }, [currentUserId]);

  const deleteMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!currentUserId) return;
    const ok = await softDeleteMessage(messageId, currentUserId);
    if (ok) setMessages(prev => prev.filter(m => m.id !== messageId));
  }, [currentUserId]);

  return { messages, loading, sending, sendText, sendVoiceNote, sendImage, sendVideo, reactToMessage, deleteMessage };
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
  visible, otherName, otherPhoto, callState,
  onEnd, onToggleMute, onToggleSpeaker, onToggleCamera,
}: {
  visible: boolean; otherName: string; otherPhoto?: string;
  callState: CallState;
  onEnd: () => void; onToggleMute: () => void;
  onToggleSpeaker: () => void; onToggleCamera: () => void;
}) {
  const { callType } = callState;
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={[styles.callModal, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 30 }]}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {/* Pulse rings — voice call only */}
        {callType === 'voice' && callState.remoteConnected && !callState.isConnecting && (
          <>
            <View style={styles.callPulse1} />
            <View style={styles.callPulse2} />
            <View style={styles.callPulse3} />
          </>
        )}

        <View style={styles.callTop}>
          <View style={styles.callAvatarWrap}>
            {otherPhoto
              ? <Image source={{ uri: otherPhoto }} style={styles.callAvatar} />
              : <View style={styles.callAvatarPlaceholder}>
                  <Text style={styles.callAvatarInitial}>{(otherName || 'U')[0].toUpperCase()}</Text>
                </View>}
            {callState.remoteConnected && <View style={styles.callAvatarRing} />}
          </View>
          <Text style={styles.callName}>{otherName}</Text>
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

// ── MESSAGE BUBBLE ────────────────────────────────────────────
// FIX: navigation removed from component — navigateToRoute callback passed as prop
function MessageBubble({ message, isMe, onLongPress, onCowatch, onNavigate }: {
  message:     Message;
  isMe:        boolean;
  onLongPress: (msg: Message) => void;
  onCowatch?:  (msg: Message) => void;
  onNavigate:  (route: string) => void;
}) {
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [imgError,   setImgError]   = useState(false);

  // FIX: expo-audio player replaces expo-av Audio.Sound
  const player = useAudioPlayer(message.media_url ? { uri: message.media_url } : null);

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
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, styles.voiceBubble]}
            onPress={playVoice} onLongPress={() => onLongPress(message)}
          >
            <View style={styles.voicePlayBtn}>
              <Text style={{ fontSize: 13, color: isMe ? '#000' : C.green }}>{isPlaying ? '⏸' : '▶'}</Text>
            </View>
            <Waveform isMe={isMe} />
            <Text style={[styles.voiceDur, isMe && { color: '#000' }]}>
              {message.media_duration ? formatSecs(message.media_duration) : '0:00'}
            </Text>
          </TouchableOpacity>
        );

      case 'image':
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { padding: 3 }]}>
            {imgError
              ? <View style={styles.imgErrorBox}>
                  <Ionicons name="image-outline" size={28} color={C.muted2} />
                  <Text style={styles.imgErrorText}>Image unavailable</Text>
                </View>
              : <Image source={{ uri: message.media_url }}
                  style={styles.msgImage} resizeMode="cover"
                  onError={() => setImgError(true)} />}
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
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem, { padding: 3 }]}>
            <View style={styles.videoPreviewBox}>
              <Ionicons name="videocam" size={32} color={C.green} />
              <Text style={styles.videoPreviewLabel}>Video</Text>
            </View>
          </TouchableOpacity>
        );

      default:
        return (
          <TouchableOpacity onLongPress={() => onLongPress(message)}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]} activeOpacity={0.85}>
            {message.reply_to_message && (
              <View style={[styles.replyPreview, isMe && styles.replyPreviewMe]}>
                <Text style={styles.replyName}>{message.reply_to_message.sender?.display_name || 'User'}</Text>
                <Text style={styles.replyText} numberOfLines={1}>{message.reply_to_message.content}</Text>
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
          {isMe && (
            <Text style={[styles.readTick, message.is_read && { color: C.green }]}>
              {message.is_read ? '✓✓' : '✓'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ── MAIN SCREEN ───────────────────────────────────────────────
export default function ChatScreen() {
  const { id, otherUserId, otherName, otherPhoto } = useLocalSearchParams<{
    id: string; otherUserId: string; otherName: string; otherPhoto: string;
  }>();

  const { user, userProfile } = useAuthStore();
  const flatRef = useRef<FlatList>(null);

  const [inputText,      setInputText]      = useState('');
  const [showEmoji,      setShowEmoji]      = useState(false);
  const [vanishOn,       setVanishOn]       = useState(false);
  const [selectedMsg,    setSelectedMsg]    = useState<Message | null>(null);
  const [showReactions,  setShowReactions]  = useState(false);
  const [replyTo,        setReplyTo]        = useState<Message | null>(null);
  const [isRecording,    setIsRecording]    = useState(false);
  const [recordingDur,   setRecordingDur]   = useState(0);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  // FIX: expo-audio recorder replaces expo-av Audio.Recording
  const recorder      = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isOnline = usePresence(user?.id || null, otherUserId || null);

  const {
    messages, loading, sending, sendText, sendVoiceNote,
    sendImage, sendVideo, reactToMessage, deleteMessage,
  } = useMessages(id, user?.id || null, vanishOn, 86400);

  const displayName = userProfile?.display_name || userProfile?.username || 'LumVibe User';

  const {
    callState, startCall, endCall, toggleMute, toggleCamera, toggleSpeaker,
  } = useCall(user?.id || '', displayName);

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

  const handleReaction = useCallback(async (emoji: string) => {
    if (!selectedMsg) return;
    setShowReactions(false);
    await reactToMessage(selectedMsg.id, emoji);
    setSelectedMsg(null);
  }, [selectedMsg, reactToMessage]);

  const handlePickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await sendImage(result.assets[0].uri);
  }, [sendImage]);

  const handlePickCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow camera access.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) await sendImage(result.assets[0].uri);
  }, [sendImage]);

  const handlePickVideo = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Please allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 120, quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingVideo(true);
    try { await sendVideo(result.assets[0].uri); }
    finally { setUploadingVideo(false); }
  }, [sendVideo]);

  // FIX: expo-audio recording pattern
  const startRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) { Alert.alert('Permission needed', 'Please allow microphone access.'); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setRecordingDur(0);
      recordTimerRef.current = setInterval(() => setRecordingDur(p => p + 1), 1000);
    } catch (e) { console.error('startRecording error:', e); }
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    try {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      await recorder.stop();
      const uri = recorder.uri;
      setIsRecording(false);
      if (uri && recordingDur > 0) await sendVoiceNote(uri, recordingDur);
      setRecordingDur(0);
    } catch (e) { console.error('stopRecording error:', e); }
  }, [recorder, recordingDur, sendVoiceNote]);

  const toggleVanish = useCallback(async () => {
    const newVal = !vanishOn; setVanishOn(newVal);
    if (id) await toggleDisappearing(id, newVal);
  }, [vanishOn, id]);

  // FIX: navigation callback passed down to MessageBubble components
  const handleNavigate = useCallback((route: string) => {
    router.push(route as any);
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.green} size="large" />
      </SafeAreaView>
    );
  }

  const charCount     = inputText.length;
  const showCharCount = charCount >= 1800;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* Header */}
      <View style={styles.chatHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
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
          <TouchableOpacity style={styles.chatActBtn} onPress={() => startCall(id, 'voice')}>
            <Ionicons name="call-outline" size={17} color={C.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatActBtn} onPress={() => startCall(id, 'video')}>
            <Ionicons name="videocam-outline" size={17} color={C.white} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatActBtn}>
            <Ionicons name="ellipsis-horizontal" size={17} color={C.white} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Feature chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={styles.featRow}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 14, alignItems: 'center' }}>
        <TouchableOpacity
          style={styles.featChip}
          onPress={() => router.push({
            pathname: '/chat/cowatch',
            params: { conversationId: id, otherName: otherName || '', otherPhoto: otherPhoto || '' },
          } as any)}
        >
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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={HEADER_H}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              isMe={item.sender_id === user?.id}
              onLongPress={handleLongPress}
              onNavigate={handleNavigate}
              onCowatch={() => router.push({
                pathname: '/chat/cowatch',
                params: { conversationId: id, otherName: otherName || '', otherPhoto: otherPhoto || '' },
              } as any)}
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
              <Text style={styles.replyBannerText} numberOfLines={1}>{replyTo.content}</Text>
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
          <TouchableOpacity style={styles.attachChip} onPress={handlePickImage}>
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
        </ScrollView>

        <View style={styles.inputBar}>
          <TouchableOpacity
            style={[styles.inputIconBtn, isRecording && { borderColor: C.red }]}
            onPressIn={startRecording} onPressOut={stopRecording}
          >
            {isRecording
              ? <Text style={{ color: C.red, fontSize: 10, fontWeight: '700' }}>
                  {formatSecs(recordingDur)}
                </Text>
              : <Ionicons name="mic-outline" size={18} color={C.muted} />}
          </TouchableOpacity>
          <View style={[styles.inputWrap, isRecording && { borderColor: C.red }]}>
            {isRecording
              ? <Text style={styles.recordingText}>🔴 Recording… release to send</Text>
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
            style={[styles.sendBtn, (sending || !inputText.trim()) && { opacity: 0.45 }]}
            onPress={handleSend} disabled={sending || !inputText.trim()}
          >
            {sending
              ? <ActivityIndicator color="#000" size="small" />
              : <Ionicons name="send" size={17} color="#000" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Reaction Picker */}
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
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Call Modal */}
      <CallModal
        visible={callState.isInCall}
        otherName={otherName || 'Them'}
        otherPhoto={otherPhoto}
        callState={callState}
        onEnd={endCall}
        onToggleMute={toggleMute}
        onToggleSpeaker={toggleSpeaker}
        onToggleCamera={toggleCamera}
      />
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
  bubbleThem: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 5 },
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
  videoPreviewBox: { width: 150, height: 100, borderRadius: 12, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', gap: 6 },
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
}); 
