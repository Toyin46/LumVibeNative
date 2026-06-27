// FILE: app/chat/group/[id].tsx
// ─────────────────────────────────────────────────────────────
// LumVibe — Group Chat Screen
// ✅ Full real-time group messaging
// ✅ Group info header with member count
// ✅ Send text, images, voice notes
// ✅ Message reactions
// ✅ Member avatars on messages
// ─────────────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, StatusBar, KeyboardAvoidingView,
  Platform, Image, ActivityIndicator, Alert, Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../config/supabase'; 
import { useAuthStore } from '../../store/authStore'; 

const C = {
  black: '#000000', card: '#1a1a1a', card2: '#222222',
  border: '#2a2a2a', green: '#00e676', greenBg: 'rgba(0,230,118,0.1)',
  red: '#e53935', white: '#ffffff', muted: '#888888', muted2: '#555555',
};

const REACTIONS = ['❤️','😂','🔥','😮','😢','👏','💀','🙌'];

interface GroupInfo {
  id: string; name: string; description?: string;
  avatar_url?: string; member_count: number; created_by: string;
}
interface GroupMessage {
  id: string; group_id: string; sender_id: string; created_at: string;
  content?: string; message_type: string;
  media_url?: string; media_duration?: number;
  is_deleted: boolean;
  reactions?: { emoji: string; user_id: string }[];
  sender?: { id: string; display_name: string; username: string; photo_url?: string };
}

const AV_COLORS = [
  { bg: '#1a2e1a', text: '#00e676' }, { bg: '#1a1a2e', text: '#7c8fff' },
  { bg: '#2e1a1a', text: '#ff7043' }, { bg: '#2a2a1a', text: '#f5c518' },
];
function getAvColor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AV_COLORS[Math.abs(hash) % AV_COLORS.length];
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const CLOUD_NAME    = process.env.EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME    || 'dvikzffqe';
const UPLOAD_PRESET = process.env.EXPO_PUBLIC_CLOUDINARY_UPLOAD_PRESET || 'unsigned_preset_name';

async function uploadImage(uri: string): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', { uri, type: 'image/jpeg', name: `img_${Date.now()}.jpg` } as any);
    formData.append('upload_preset', UPLOAD_PRESET);
    formData.append('folder', 'kinsta_chat/images');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.secure_url || null;
  } catch { return null; }
}

export default function GroupChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const flatRef = useRef<FlatList>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [group,       setGroup]       = useState<GroupInfo | null>(null);
  const [messages,    setMessages]    = useState<GroupMessage[]>([]);
  const [inputText,   setInputText]   = useState('');
  const [loading,     setLoading]     = useState(true);
  const [sending,     setSending]     = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recDur,      setRecDur]      = useState(0);
  const [selectedMsg, setSelectedMsg] = useState<GroupMessage | null>(null);
  const [showReact,   setShowReact]   = useState(false);

  useEffect(() => {
    if (!id || id === 'new-group' || id === 'undefined') {
      Alert.alert('Error', 'Invalid group.'); router.back(); return;
    }
    loadGroup();
    loadMessages();
    subscribeMessages();
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [id]);

  const loadGroup = async () => {
    try {
      const { data } = await supabase.from('groups').select('*').eq('id', id).single();
      setGroup(data);
    } catch (e) { console.error(e); }
  };

  const loadMessages = async () => {
    try {
      const { data: msgs } = await supabase
        .from('group_messages')
        .select('*')
        .eq('group_id', id)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .limit(50);

      if (!msgs || msgs.length === 0) { setLoading(false); return; }

      const senderIds = [...new Set(msgs.map((m: any) => m.sender_id))];
      const { data: senders } = await supabase
        .from('users').select('id, display_name, username, photo_url').in('id', senderIds);
      const senderMap: Record<string, any> = {};
      (senders || []).forEach((u: any) => { senderMap[u.id] = u; });

      const { data: reactions } = await supabase
        .from('group_message_reactions').select('*').in('message_id', msgs.map((m: any) => m.id));
      const reactMap: Record<string, any[]> = {};
      (reactions || []).forEach((r: any) => {
        if (!reactMap[r.message_id]) reactMap[r.message_id] = [];
        reactMap[r.message_id].push(r);
      });

      setMessages(msgs.map((m: any) => ({
        ...m,
        sender: senderMap[m.sender_id],
        reactions: reactMap[m.id] || [],
      })));
    } catch (e) { console.error('loadMessages error:', e); }
    finally { setLoading(false); }
  };

  const subscribeMessages = () => {
    if (!id) return;
    channelRef.current = supabase.channel(`group:${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${id}` },
        async (payload) => {
          const { data: sender } = await supabase.from('users')
            .select('id, display_name, username, photo_url').eq('id', payload.new.sender_id).single();
          setMessages(prev => [...prev, { ...payload.new as any, sender, reactions: [] }]);
          setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
        })
      .subscribe();
  };

  const sendText = async () => {
    const text = inputText.trim();
    if (!text || !user?.id || !id) return;
    setInputText(''); setSending(true);
    try {
      await supabase.from('group_messages').insert({
        group_id: id, sender_id: user.id, message_type: 'text', content: text,
      });
      await supabase.from('groups').update({ last_message: text, last_message_at: new Date().toISOString() }).eq('id', id);
    } catch (e) { Alert.alert('Error', 'Failed to send message.'); }
    finally { setSending(false); }
  };

  const sendImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow gallery access.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0] || !user?.id) return;
    setSending(true);
    try {
      const url = await uploadImage(result.assets[0].uri);
      if (!url) { Alert.alert('Upload failed', 'Try again.'); return; }
      await supabase.from('group_messages').insert({
        group_id: id, sender_id: user.id, message_type: 'image', media_url: url,
      });
    } catch (e) { Alert.alert('Error', 'Failed to send image.'); }
    finally { setSending(false); }
  };

  const startRecording = async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow microphone access to send voice notes.');
        return;
      }
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true); setRecDur(0);
      recordTimerRef.current = setInterval(() => setRecDur(p => p + 1), 1000);
    } catch (e) { console.error(e); }
  };

  const stopRecording = async () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (!user?.id) return;
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      setIsRecording(false);
      if (uri && recDur > 0) {
        setSending(true);
        const formData = new FormData();
        formData.append('file', { uri, type: 'audio/m4a', name: `voice_${Date.now()}.m4a` } as any);
        formData.append('upload_preset', UPLOAD_PRESET);
        formData.append('folder', 'kinsta_chat/voices');
        const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/video/upload`, { method: 'POST', body: formData });
        if (res.ok) {
          const data = await res.json();
          await supabase.from('group_messages').insert({
            group_id: id, sender_id: user.id, message_type: 'voice',
            media_url: data.secure_url, media_duration: recDur,
          });
        }
        setSending(false);
      }
    } catch (e) { console.error(e); }
    setRecDur(0);
  };

  const handleReaction = async (emoji: string) => {
    if (!selectedMsg || !user?.id) return;
    setShowReact(false);
    await supabase.from('group_message_reactions').upsert({
      message_id: selectedMsg.id, user_id: user.id, emoji,
    });
    await loadMessages();
    setSelectedMsg(null);
  };

  const deleteMsg = async (msg: GroupMessage) => {
    if (msg.sender_id !== user?.id) return;
    await supabase.from('group_messages').update({ is_deleted: true }).eq('id', msg.id);
    setMessages(prev => prev.filter(m => m.id !== msg.id));
  };

  const renderMessage = ({ item }: { item: GroupMessage }) => {
    const isMe = item.sender_id === user?.id;
    const av = getAvColor(item.sender_id);
    const reactionGroups = (item.reactions || []).reduce((acc: any, r: any) => {
      acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc;
    }, {});

    return (
      <View style={[ms.row, isMe && ms.rowMe]}>
        {!isMe && (
          <View style={ms.av}>
            {item.sender?.photo_url
              ? <Image source={{ uri: item.sender.photo_url }} style={ms.avImg} />
              : <View style={[ms.avImg, { backgroundColor: av.bg, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ color: av.text, fontSize: 10, fontWeight: '700' }}>
                    {(item.sender?.display_name || 'U')[0].toUpperCase()}
                  </Text>
                </View>}
          </View>
        )}
        <View style={[ms.col, isMe && ms.colMe]}>
          {!isMe && <Text style={ms.senderName}>{item.sender?.display_name || 'Member'}</Text>}
          <TouchableOpacity
            style={[ms.bubble, isMe ? ms.bubbleMe : ms.bubbleThem]}
            onLongPress={() => { setSelectedMsg(item); setShowReact(true); }}
            activeOpacity={0.85}
          >
            {item.message_type === 'image' && item.media_url
              ? <Image source={{ uri: item.media_url }} style={ms.msgImg} resizeMode="cover" />
              : item.message_type === 'voice'
              ? <View style={ms.voiceRow}>
                  <Ionicons name="mic-outline" size={16} color={isMe ? '#000' : C.green} />
                  <View style={ms.voiceBar} />
                  <Text style={[ms.voiceDur, isMe && { color: '#000' }]}>
                    {item.media_duration ? `${Math.floor(item.media_duration / 60)}:${(item.media_duration % 60).toString().padStart(2,'0')}` : '0:00'}
                  </Text>
                </View>
              : <Text style={[ms.bubbleText, isMe && { color: '#000', fontWeight: '500' }]}>{item.content}</Text>}
          </TouchableOpacity>
          {Object.keys(reactionGroups).length > 0 && (
            <View style={[ms.reactRow, isMe && ms.reactRowMe]}>
              {Object.entries(reactionGroups).map(([emoji, count]) => (
                <View key={emoji} style={ms.reactPill}>
                  <Text style={{ fontSize: 11 }}>{emoji}</Text>
                  <Text style={ms.reactCount}>{count as number}</Text>
                </View>
              ))}
            </View>
          )}
          <Text style={[ms.time, isMe && ms.timeMe]}>{formatTime(item.created_at)}</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.green} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={C.white} />
        </TouchableOpacity>
        <View style={s.groupAv}>
          <Ionicons name="people-outline" size={20} color={C.green} />
        </View>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={s.groupName} numberOfLines={1}>{group?.name || 'Group'}</Text>
          <Text style={s.memberCount}>{group?.member_count || 0} members</Text>
        </View>
        <TouchableOpacity style={s.infoBtn}
          onPress={() => router.push({ pathname: '/chat/group/info', params: { id } } as any)}>
          <Ionicons name="information-circle-outline" size={22} color={C.muted} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 14, gap: 6, paddingBottom: 10 }}
          showsVerticalScrollIndicator={false}
          onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80, gap: 10 }}>
              <Text style={{ fontSize: 36 }}>👋</Text>
              <Text style={{ fontSize: 16, color: C.muted }}>Say hello to the group!</Text>
            </View>
          }
        />

        {/* Attach row */}
        <View style={s.attachRow}>
          <TouchableOpacity style={s.attachBtn} onPress={sendImage}>
            <Ionicons name="image-outline" size={20} color={C.muted} />
          </TouchableOpacity>
        </View>

        {/* Input */}
        <View style={s.inputBar}>
          <TouchableOpacity
            style={[s.micBtn, isRecording && { borderColor: C.red }]}
            onPressIn={startRecording} onPressOut={stopRecording}
          >
            {isRecording
              ? <Text style={{ color: C.red, fontSize: 9, fontWeight: '700' }}>
                  {`${Math.floor(recDur/60)}:${(recDur%60).toString().padStart(2,'0')}`}
                </Text>
              : <Ionicons name="mic-outline" size={18} color={C.muted} />}
          </TouchableOpacity>
          <View style={[s.inputWrap, isRecording && { borderColor: C.red }]}>
            {isRecording
              ? <Text style={s.recordText}>🔴 Recording…</Text>
              : <TextInput
                  style={s.input}
                  placeholder="Message group…"
                  placeholderTextColor={C.muted2}
                  value={inputText}
                  onChangeText={setInputText}
                  onSubmitEditing={sendText}
                  multiline maxLength={2000}
                />}
          </View>
          <TouchableOpacity
            style={[s.sendBtn, (!inputText.trim() || sending) && { opacity: 0.4 }]}
            onPress={sendText} disabled={!inputText.trim() || sending}
          >
            {sending
              ? <ActivityIndicator size="small" color="#000" />
              : <Ionicons name="send" size={16} color="#000" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Reaction picker */}
      <Modal visible={showReact} transparent animationType="fade" onRequestClose={() => setShowReact(false)}>
        <TouchableOpacity style={s.reactOverlay} onPress={() => setShowReact(false)}>
          <View style={s.reactPicker}>
            {REACTIONS.map(r => (
              <TouchableOpacity key={r} onPress={() => handleReaction(r)}>
                <Text style={{ fontSize: 28 }}>{r}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {selectedMsg?.sender_id === user?.id && (
            <TouchableOpacity style={s.deleteBtn} onPress={() => { setShowReact(false); if (selectedMsg) deleteMsg(selectedMsg); }}>
              <Ionicons name="trash-outline" size={14} color={C.red} />
              <Text style={{ color: C.red, fontSize: 14, fontWeight: '600', marginLeft: 6 }}>Delete</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const ms = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginVertical: 2 },
  rowMe:    { flexDirection: 'row-reverse' },
  av:       { width: 28, height: 28, marginBottom: 18 },
  avImg:    { width: 28, height: 28, borderRadius: 14 },
  col:      { maxWidth: '74%', gap: 2 },
  colMe:    { alignItems: 'flex-end' },
  senderName: { fontSize: 10.5, color: C.green, fontWeight: '700', marginBottom: 2, marginLeft: 4 },
  bubble:   { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  bubbleThem: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 5 },
  bubbleMe:   { backgroundColor: C.green, borderBottomRightRadius: 5 },
  bubbleText: { fontSize: 14, lineHeight: 21, color: C.white },
  msgImg:   { width: 180, height: 200, borderRadius: 14 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 160 },
  voiceBar: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 2 },
  voiceDur: { fontSize: 11, color: C.muted },
  reactRow:    { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  reactRowMe:  { justifyContent: 'flex-end' },
  reactPill:   { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 2, paddingHorizontal: 6 },
  reactCount:  { fontSize: 10, color: C.white, fontWeight: '600' },
  time:     { fontSize: 10, color: C.muted2, marginLeft: 4 },
  timeMe:   { textAlign: 'right', marginRight: 4 },
});

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.black },
  header:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  groupAv:   { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,230,118,0.1)', borderWidth: 1, borderColor: 'rgba(0,230,118,0.3)', alignItems: 'center', justifyContent: 'center' },
  groupName: { fontSize: 15, fontWeight: '700', color: C.white },
  memberCount: { fontSize: 11, color: C.muted, marginTop: 1 },
  infoBtn:   { padding: 8 },
  attachRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.border, gap: 10 },
  attachBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  inputBar:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: Platform.OS === 'ios' ? 8 : 14, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  micBtn:    { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 22, paddingHorizontal: 12 },
  input:     { color: C.white, fontSize: 14, paddingVertical: 10, maxHeight: 100 },
  recordText:{ color: C.red, fontSize: 13, paddingVertical: 10 },
  sendBtn:   { width: 44, height: 44, borderRadius: 22, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  reactOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  reactPicker:  { flexDirection: 'row', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 28, paddingVertical: 10, paddingHorizontal: 14, gap: 12 },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', marginTop: 12, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 20 },
});