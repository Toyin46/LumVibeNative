// ═══════════════════════════════════════════════════════════════════
// LiveViewerScreen.tsx — LumVibe Viewer Experience
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { RoomEvent, VideoView } from '@livekit/react-native';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import LiveViewerFeatures from './LiveViewerFeatures';

// ─── TYPES ─────────────────────────────────────────────────────────

type RootStackParamList = {
  LiveViewer: {
    sessionId: string;
    roomName: string;
    hostId: string;
    hostUsername: string;
    hostAvatar: string;
  };
};

type LiveViewerRouteProp = RouteProp<RootStackParamList, 'LiveViewer'>;

interface Comment {
  id: string;
  user_id: string;
  username: string;
  text: string;
}

const C = {
  g: '#00ff88', dk: '#000000', wh: '#ffffff', rd: '#ff4444', go: '#ffd700',
  cd: 'rgba(0,0,0,0.6)', overlay: 'rgba(0,0,0,0.3)',
};

// ─── COMPONENT ─────────────────────────────────────────────────────

export default function LiveViewerScreen() {
  const route = useRoute<LiveViewerRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { sessionId, roomName, hostId, hostUsername, hostAvatar } = route.params;
  const { user, userProfile } = useAuthStore();

  // ─── STATE: LIVEKIT ──────────────────────────────────────────────
  const [room] = useState(() => new (require('@livekit/react-native').Room)({ adaptiveStream: true, dynacast: true }));
  const [remoteVideoTrack, setRemoteVideoTrack] = useState<any>(null);
  const reconnectCount = useRef<number>(0);
  const maxReconnectAttempts = 3;
  const [isReconnecting, setIsReconnecting] = useState(false);

  // ─── STATE: STREAM DATA ──────────────────────────────────────────
  const [comments, setComments] = useState<Comment[]>([]);
  const [viewerCount, setViewerCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [isCommentModalOpen, setIsCommentModalOpen] = useState(false);

  // ─── STATE: MODALS ───────────────────────────────────────────────
  const [showGiftPanel, setShowGiftPanel] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');

  // ─── EFFECTS: LIVEKIT CONNECTION ─────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    const setupViewerConnection = async () => {
      try {
        const { data: tokenData, error: tokenError } = await supabase.functions.invoke('create-livekit-token', {
          body: {
            roomName,
            participantIdentity: userProfile?.username || user?.id,
            isHost: false,
          },
        });

        if (tokenError || !tokenData?.token) throw new Error('Token generation failed.');

        await room.connect('wss://lumvibe-die9oz6e.livekit.cloud', tokenData.token);

        room.on(RoomEvent.TrackSubscribed, (track: any) => {
          if (track.kind === 'video' && isMounted) {
            setRemoteVideoTrack(track as any);
          }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
          if (track.kind === 'video' && isMounted) setRemoteVideoTrack(null);
        });

        room.on(RoomEvent.Disconnected, handleDisconnect);
      } catch (err) {
        console.error('[LiveKit Connect Error]', err);
        Alert.alert('Connection Failed', 'Could not join the stream.');
      }
    };

    setupViewerConnection();
    checkFollowStatus();

    return () => {
      isMounted = false;
      room.disconnect();
    };
  }, []);

  // ─── HANDLERS: RECONNECT ─────────────────────────────────────────

  const handleDisconnect = async () => {
    if (reconnectCount.current >= maxReconnectAttempts) {
      Alert.alert('Stream Offline', 'The broadcast has ended or connection was lost.');
      navigation.goBack();
      return;
    }

    setIsReconnecting(true);
    reconnectCount.current += 1;

    setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke('create-livekit-token', {
          body: {
            roomName,
            participantIdentity: userProfile?.username || user?.id,
            isHost: false,
          },
        });
        if (data?.token) {
          await room.connect('wss://lumvibe-die9oz6e.livekit.cloud', data.token);
          setIsReconnecting(false);
          reconnectCount.current = 0;
        }
      } catch (e) {
        handleDisconnect();
      }
    }, 4000);
  };

  // ─── EFFECTS: SUPABASE SUBSCRIPTIONS ─────────────────────────────

  useEffect(() => {
    const commentSub = supabase.channel(`viewer_comments:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        setComments(prev => [payload.new as Comment, ...prev].slice(0, 150));
      }).subscribe();

    const viewerSub = supabase.channel(`viewer_count:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'livestreams',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        setViewerCount(payload.new.viewer_count || 0);
      }).subscribe();

    return () => {
      supabase.removeChannel(commentSub);
      supabase.removeChannel(viewerSub);
    };
  }, [sessionId]);

  // ─── HANDLERS: FOLLOW ────────────────────────────────────────────

  const checkFollowStatus = async () => {
    if (!user?.id) return;
    try {
      const { data } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', hostId)
        .single();
      if (data) setIsFollowing(true);
    } catch (e) { /* no rows = not following */ }
  };

  const handleFollow = async () => {
    if (!user?.id || isFollowing) return;
    try {
      await supabase.from('follows').insert({
        follower_id: user.id,
        following_id: hostId,
      });
      setIsFollowing(true);
    } catch (err) {
      console.error('[Follow Error]', err);
    }
  };

  // ─── HANDLERS: COMMENT ───────────────────────────────────────────

  const handleSendComment = async (text: string) => {
    if (!text.trim() || !user?.id) return;
    try {
      await supabase.from('live_comments').insert({
        stream_id: sessionId,
        user_id: user.id,
        username: userProfile?.username || 'Viewer',
        text: text.trim(),
        is_pinned: false,
      });
      setCommentInput('');
      setIsCommentModalOpen(false);
    } catch (err) {
      console.error('[Comment Error]', err);
    }
  };

  // ─── HANDLERS: REPORT ────────────────────────────────────────────

  const handleReport = async () => {
    if (!reportReason.trim() || !user?.id) return;
    try {
      await supabase.from('reports').insert({
        reporter_id: user.id,
        stream_id: sessionId,
        reason: reportReason.trim(),
      });
      setShowReportModal(false);
      setReportReason('');
      Alert.alert('Report Submitted', 'Our moderation team will review this broadcast.');
    } catch (err) {
      console.error('[Report Error]', err);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Video Background */}
      {remoteVideoTrack ? (
        <VideoView videoTrack={remoteVideoTrack} style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={styles.placeholderBg}>
          <Text style={{ color: C.wh }}>
            {isReconnecting ? 'Reconnecting...' : 'Waiting for video...'}
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.hostBadge}>
          {hostAvatar ? (
            <Image source={{ uri: hostAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: C.go }]} />
          )}
          <View style={{ marginLeft: 8 }}>
            <Text style={styles.hostName}>{hostUsername}</Text>
            <View style={styles.viewerRow}>
              <View style={styles.liveDot} />
              <Text style={styles.viewerText}>{viewerCount.toLocaleString()}</Text>
            </View>
          </View>
          {!isFollowing && (
            <TouchableOpacity style={styles.followBtn} onPress={handleFollow}>
              <Text style={styles.followText}>Follow</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowReportModal(true)}>
            <Feather name="flag" size={18} color={C.wh} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
            <Feather name="x" size={20} color={C.wh} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Feature Overlays */}
      <LiveViewerFeatures
        sessionId={sessionId}
        hostId={hostId}
        showGiftPanel={showGiftPanel}
        setShowGiftPanel={setShowGiftPanel}
        sendComment={handleSendComment}
      />

      {/* Comment Feed */}
      <View style={styles.commentsWrapper}>
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          inverted
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.commentItem}>
              <Text style={styles.commentUser}>{item.username}</Text>
              <Text style={styles.commentText}>{item.text}</Text>
            </View>
          )}
        />
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.commentTrigger}
          onPress={() => setIsCommentModalOpen(true)}
        >
          <Text style={{ color: '#aaa' }}>Say something...</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.giftTriggerBtn}
          onPress={() => setShowGiftPanel(true)}
        >
          <Feather name="gift" size={20} color={C.dk} />
        </TouchableOpacity>
      </View>

      {/* Comment Input Modal */}
      <Modal visible={isCommentModalOpen} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalBg}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setIsCommentModalOpen(false)} />
          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.textInput}
              autoFocus
              placeholder="Add a comment..."
              placeholderTextColor="#888"
              value={commentInput}
              onChangeText={setCommentInput}
              onSubmitEditing={() => handleSendComment(commentInput)}
              returnKeyType="send"
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Report Modal */}
      <Modal visible={showReportModal} transparent animationType="fade">
        <View style={styles.centeredModal}>
          <View style={styles.reportCard}>
            <Text style={styles.reportTitle}>Report Broadcast</Text>
            <TextInput
              style={styles.reportInput}
              placeholder="Reason for reporting..."
              placeholderTextColor="#888"
              value={reportReason}
              onChangeText={setReportReason}
              multiline
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 16 }}>
              <TouchableOpacity onPress={() => setShowReportModal(false)}>
                <Text style={{ color: C.wh }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleReport}>
                <Text style={{ color: C.rd, fontWeight: '700' }}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.dk },
  placeholderBg: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#111',
    justifyContent: 'center', alignItems: 'center',
  },
  header: {
    position: 'absolute', top: Platform.OS === 'ios' ? 50 : 20,
    left: 16, right: 16, flexDirection: 'row',
    justifyContent: 'space-between', zIndex: 10,
  },
  hostBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.cd, padding: 6, paddingRight: 16, borderRadius: 30,
  },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  hostName: { color: C.wh, fontWeight: '700', fontSize: 13 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.rd, marginRight: 4 },
  viewerText: { color: '#ccc', fontSize: 11 },
  followBtn: {
    backgroundColor: C.g, paddingHorizontal: 10,
    paddingVertical: 4, borderRadius: 12, marginLeft: 12,
  },
  followText: { color: C.dk, fontWeight: '700', fontSize: 11 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.cd, justifyContent: 'center', alignItems: 'center',
  },
  commentsWrapper: {
    position: 'absolute', bottom: 80, left: 16,
    width: '70%', height: 250, zIndex: 10,
  },
  commentItem: {
    backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 12,
    padding: 8, marginBottom: 6, alignSelf: 'flex-start',
  },
  commentUser: { color: '#aaa', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  commentText: { color: C.wh, fontSize: 13 },
  footer: {
    position: 'absolute', bottom: Platform.OS === 'ios' ? 30 : 16,
    left: 16, right: 16, flexDirection: 'row',
    alignItems: 'center', gap: 12, zIndex: 10,
  },
  commentTrigger: {
    flex: 1, backgroundColor: C.cd, paddingHorizontal: 16,
    height: 44, justifyContent: 'center', borderRadius: 22,
  },
  giftTriggerBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: C.go, justifyContent: 'center', alignItems: 'center',
  },
  modalBg: { flex: 1, justifyContent: 'flex-end' },
  commentInputRow: {
    backgroundColor: '#1a1a1a', padding: 12,
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
  },
  textInput: {
    backgroundColor: '#000', color: C.wh,
    borderRadius: 20, paddingHorizontal: 16, height: 40,
  },
  centeredModal: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  reportCard: { width: '80%', backgroundColor: '#1a1a1a', padding: 20, borderRadius: 16 },
  reportTitle: { color: C.wh, fontSize: 16, fontWeight: '700', marginBottom: 16 },
  reportInput: {
    backgroundColor: '#000', color: C.wh, height: 80,
    borderRadius: 8, padding: 10, textAlignVertical: 'top', marginBottom: 16,
  },
}); 
