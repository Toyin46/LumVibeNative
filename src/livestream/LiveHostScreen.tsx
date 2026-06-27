// ═══════════════════════════════════════════════════════════════════
// LiveHostScreen.tsx — LumVibe Host Broadcasting Screen
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import {
  Room,
  RoomEvent,
  createLocalVideoTrack,
  createLocalAudioTrack,
  LocalVideoTrack,
  VideoView,
} from '@livekit/react-native';
import { supabase } from '../config/supabase';
import { useAuthStore } from '../store/authStore';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import LiveHostFeatures from './LiveHostFeatures';

// ─── TYPES ─────────────────────────────────────────────────────────

type RootStackParamList = {
  LiveHost: {
    sessionId: string;
    roomName: string;
    title: string;
    category: string;
    lkToken: string;
  };
};

type LiveRouteProp = RouteProp<RootStackParamList, 'LiveHost'>;

interface Comment {
  id: string;
  user_id: string;
  username: string;
  text: string;
  is_pinned: boolean;
  is_mentor: boolean;
}

const C = {
  g: '#00ff88', dk: '#000000', wh: '#ffffff', rd: '#ff4444', go: '#ffd700',
  cd: 'rgba(0,0,0,0.6)', overlay: 'rgba(0,0,0,0.3)',
};

// ─── COMPONENT ─────────────────────────────────────────────────────

export default function LiveHostScreen() {
  const route = useRoute<LiveRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { sessionId, roomName, lkToken, title } = route.params;
  const { user } = useAuthStore();

  // ─── STATE & REFS: LIVEKIT & NETWORK ─────────────────────────────

  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  // WHY: useRef prevents stale closure bug in handleDisconnect
  const reconnectCount = useRef<number>(0);
  const maxReconnectAttempts = 3;

  // ─── STATE: STREAM DATA ──────────────────────────────────────────

  const [viewerCount, setViewerCount] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [vibeScore, setVibeScore] = useState(100);
  const [peakViewers, setPeakViewers] = useState(0);
  const streamStartTime = useRef<number>(Date.now());
  const totalCoinsEarned = useRef<number>(0);

  // ─── CONFIGURATION ────────────────────────────────────────────────

  const [shieldWords] = useState<string[]>(['spam', 'hate', 'scam']);
  const [mentors] = useState<string[]>([]);
  const lastGiftTime = useRef<number>(0);
  const streakCount = useRef<number>(0);

  // ─── EFFECTS: NETWORK & LIVEKIT ──────────────────────────────────

  useEffect(() => {
    const unsubscribeNet = NetInfo.addEventListener(state => {
      setIsOffline(!state.isConnected);
    });

    const setupLiveKit = async () => {
      try {
        // WHY: Connects to LumVibe's dedicated LiveKit cloud instance
        await room.connect('wss://lumvibe-die9oz6e.livekit.cloud', lkToken);

        const video = await createLocalVideoTrack();
        const audio = await createLocalAudioTrack();
        await room.localParticipant.publishTrack(video);
        await room.localParticipant.publishTrack(audio);
        setLocalVideoTrack(video);

        room.on(RoomEvent.Disconnected, handleDisconnect);
      } catch (error) {
        console.error('[LiveKit Init Error]', error);
        Alert.alert('Connection Failed', 'Could not connect to the live server.');
      }
    };

    setupLiveKit();

    return () => {
      unsubscribeNet();
      room.disconnect();
    };
  }, []);

  // ─── HANDLERS: RECONNECT ─────────────────────────────────────────

  const handleDisconnect = async () => {
    // WHY: ref always has latest value unlike useState in async callbacks
    if (reconnectCount.current >= maxReconnectAttempts) {
      Alert.alert('Stream Ended', 'Connection lost permanently.');
      endStream();
      return;
    }

    setIsReconnecting(true);
    reconnectCount.current += 1;

    setTimeout(async () => {
      try {
        await room.connect('wss://lumvibe-die9oz6e.livekit.cloud', lkToken);
        setIsReconnecting(false);
        reconnectCount.current = 0;
      } catch (e) {
        handleDisconnect();
      }
    }, 5000);
  };

  // ─── EFFECTS: SUPABASE REALTIME SUBSCRIPTIONS ────────────────────

  useEffect(() => {
    const commentSub = supabase.channel(`comments:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_comments',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        const newComment = payload.new as any;

        // Creator Shield: block configured keywords
        const blocked = shieldWords.some(word =>
          newComment.text.toLowerCase().includes(word.toLowerCase())
        );
        if (blocked) return;

        const isMentor = mentors.includes(newComment.user_id);
        setComments(prev => [{ ...newComment, is_mentor: isMentor }, ...prev].slice(0, 100));
        setVibeScore(v => Math.min(v + 1, 1000));
      }).subscribe();

    const viewerSub = supabase.channel(`stream_updates:${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'livestreams',
        filter: `id=eq.${sessionId}`,
      }, (payload) => {
        const count = payload.new.viewer_count || 0;
        setViewerCount(count);
        setPeakViewers(prev => Math.max(prev, count));
      }).subscribe();

    const giftSub = supabase.channel(`gifts:${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'live_gifts',
        filter: `stream_id=eq.${sessionId}`,
      }, (payload) => {
        handleIncomingGift(payload.new as any);
      }).subscribe();

    return () => {
      supabase.removeChannel(commentSub);
      supabase.removeChannel(viewerSub);
      supabase.removeChannel(giftSub);
    };
  }, [sessionId, shieldWords, mentors]);

  // ─── HANDLERS: ATOMIC GIFT ECONOMY ───────────────────────────────

  /*
    ⚡ RUN THIS SQL IN SUPABASE SQL EDITOR BEFORE USING:

    CREATE OR REPLACE FUNCTION credit_host_coins(host_id UUID, amount INT, description TEXT)
    RETURNS VOID AS $$
    BEGIN
      UPDATE profiles SET coins_balance = coins_balance + amount WHERE id = host_id;
      INSERT INTO transactions (user_id, amount, type, description, created_at)
      VALUES (host_id, amount, 'gift_received', description, NOW());
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;
  */
  const handleIncomingGift = async (giftData: any) => {
    const now = Date.now();
    let multiplier = 1;

    // WHY: Streak multiplier x2 if 3+ gifts arrive within 30 seconds
    if (now - lastGiftTime.current <= 30000) {
      streakCount.current += 1;
      if (streakCount.current >= 3) multiplier = 2;
    } else {
      streakCount.current = 1;
    }
    lastGiftTime.current = now;

    const finalCoinsToHost = Math.floor(giftData.coins * multiplier * 0.7); // 30% platform cut
    totalCoinsEarned.current += finalCoinsToHost;
    setVibeScore(v => Math.min(v + (giftData.coins * 0.5), 1000));

    if (!user?.id) return;

    try {
      // WHY: Atomic Postgres RPC — balance update + transaction log in one operation
      const { error } = await supabase.rpc('credit_host_coins', {
        host_id: user.id,
        amount: finalCoinsToHost,
        description: `Received ${giftData.gift_type} x${multiplier}`,
      });
      if (error) throw error;
    } catch (err) {
      console.error('[Gift RPC Error]', err);
    }
  };

  // ─── HANDLERS: END STREAM ─────────────────────────────────────────

  const endStream = async () => {
    try {
      room.disconnect();
      const durationMins = Math.floor((Date.now() - streamStartTime.current) / 60000);
      const legacyScore = (peakViewers * 2) + (totalCoinsEarned.current * 5) + (durationMins * 10);

      await supabase.functions.invoke('end-livestream', {
        body: {
          streamId: sessionId,
          legacyScore,
          endedAt: new Date().toISOString(),
        },
      });

      Alert.alert(
        'Stream Summary',
        `Peak Viewers: ${peakViewers}\nCoins Earned: ${totalCoinsEarned.current}\nLegacy Score: ${legacyScore}`,
        [{ text: 'Exit', onPress: () => navigation.navigate('Home' as never) }]
      );
    } catch (error) {
      console.error('[End Stream Error]', error);
      navigation.navigate('Home' as never);
    }
  };

  // ─── RENDER ──────────────────────────────────────────────────────

  return (
    <View style={styles.container}>

      {/* Camera Background */}
      {localVideoTrack ? (
        <VideoView videoTrack={localVideoTrack} style={StyleSheet.absoluteFillObject} />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#111' }]} />
      )}
      <View style={styles.darkOverlay} />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.hostBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.hostBadgeText}>{viewerCount.toLocaleString()}</Text>
          <Feather name="users" size={12} color={C.wh} style={{ marginLeft: 4 }} />
        </View>

        <View style={styles.vibeBadge}>
          <Text style={styles.vibeText}>🔥 {vibeScore}°</Text>
        </View>

        <TouchableOpacity style={styles.endBtn} onPress={endStream}>
          <Feather name="x" size={20} color={C.wh} />
        </TouchableOpacity>
      </View>

      {/* Offline Banner */}
      {isOffline && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.offlineBanner}>
          <Feather name="wifi-off" size={16} color={C.wh} />
          <Text style={styles.bannerText}>Network Connection Interrupted.</Text>
        </Animated.View>
      )}

      {/* Reconnecting Banner */}
      {isReconnecting && !isOffline && (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.reconnectBanner}>
          <Text style={styles.bannerText}>
            Reconnecting ({reconnectCount.current}/{maxReconnectAttempts})...
          </Text>
        </Animated.View>
      )}

      {/* Feature Overlays */}
      <View style={styles.featuresContainer}>
        <LiveHostFeatures
          sessionId={sessionId}
          room={room}
          vibeScore={vibeScore}
        />
      </View>

      {/* Comments Feed */}
      <View style={styles.commentsWrapper}>
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          inverted
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={[styles.commentItem, item.is_pinned && styles.pinnedComment]}>
              <Text style={styles.commentUser}>
                {item.username} {item.is_mentor && '🛡️'}
              </Text>
              <Text style={styles.commentText}>{item.text}</Text>
            </View>
          )}
        />
      </View>

    </View>
  );
}

// ─── STYLES ────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.dk },
  darkOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: C.overlay },

  header: {
    position: 'absolute', top: Platform.OS === 'ios' ? 50 : 20,
    left: 16, right: 16, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center', zIndex: 10,
  },
  hostBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.cd,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: '#333',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.rd, marginRight: 6 },
  hostBadgeText: { color: C.wh, fontWeight: '700', fontSize: 13 },

  vibeBadge: {
    backgroundColor: 'rgba(255, 68, 68, 0.2)', paddingHorizontal: 10,
    paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: C.rd,
  },
  vibeText: { color: C.wh, fontSize: 12, fontWeight: '800' },

  endBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center',
  },

  offlineBanner: {
    position: 'absolute', top: 100, left: 16, right: 16,
    backgroundColor: C.rd, padding: 12, borderRadius: 8,
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, zIndex: 10,
  },
  reconnectBanner: {
    position: 'absolute', top: 100, left: 16, right: 16,
    backgroundColor: C.go, padding: 12, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  bannerText: { color: C.dk, fontWeight: '700', fontSize: 14 },

  featuresContainer: {
    ...StyleSheet.absoluteFillObject, zIndex: 5, pointerEvents: 'box-none',
  },

  commentsWrapper: {
    position: 'absolute', bottom: 80, left: 16,
    width: '75%', height: 250, zIndex: 10,
  },
  commentItem: {
    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 12,
    padding: 10, marginBottom: 8, alignSelf: 'flex-start',
  },
  pinnedComment: {
    borderWidth: 1, borderColor: C.go,
    backgroundColor: 'rgba(255, 215, 0, 0.1)',
  },
  commentUser: { color: C.g, fontSize: 12, fontWeight: '800', marginBottom: 2 },
  commentText: { color: C.wh, fontSize: 14, lineHeight: 20 },
}); 
