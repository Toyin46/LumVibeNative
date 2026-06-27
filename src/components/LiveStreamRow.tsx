// ═══════════════════════════════════════════════════════════════════
// LiveStreamRow.tsx — Horizontal Live Stream Cards
// LumVibe — Shows active live streams above the video feed
// ═══════════════════════════════════════════════════════════════════

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  Animated,
} from 'react-native';
import { supabase } from '../config/supabase';
import { useNavigation } from '@react-navigation/native';

// ─── TYPES ───────────────────────────────────────────────────────

interface LiveStream {
  id: string;
  host_id: string;
  host_username: string;
  host_avatar: string;
  title: string;
  livekit_room_name: string;
  viewer_count: number;
}

// ─── PULSING LIVE BADGE ──────────────────────────────────────────

function PulsingLiveBadge() {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.2, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View style={[styles.liveBadge, { transform: [{ scale: pulse }] }]}>
      <View style={styles.liveDot} />
      <Text style={styles.liveText}>LIVE</Text>
    </Animated.View>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────

export const LiveStreamRow = () => {
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const navigation = useNavigation<any>();

  const fetchStreams = async () => {
    try {
      const { data, error } = await supabase
        .from('livestreams')
        .select(`
          id, host_id, title, livekit_room_name, viewer_count,
          profiles ( username, avatar_url )
        `)
        .eq('status', 'live')
        .order('viewer_count', { ascending: false });

      if (error) throw error;

      const mapped: LiveStream[] = (data || []).map((s: any) => ({
        id: s.id,
        host_id: s.host_id,
        title: s.title,
        livekit_room_name: s.livekit_room_name,
        viewer_count: s.viewer_count || 0,
        host_username: s.profiles?.username || 'Creator',
        host_avatar: s.profiles?.avatar_url || '',
      }));

      setStreams(mapped);
    } catch (e) {
      console.error('[LiveStreamRow] Fetch error:', e);
    }
  };

  useEffect(() => {
    fetchStreams();

    // WHY: Realtime subscription so new live streams appear instantly
    const subscription = supabase
      .channel('live_feed_row')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'livestreams' },
        () => fetchStreams()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // WHY: Return null if no active streams — no empty space in feed
  if (streams.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>🔴 Live Now</Text>
      <FlatList
        horizontal
        data={streams}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() =>
              navigation.navigate('LiveViewer', {
                sessionId: item.id,
                roomName: item.livekit_room_name,
                hostId: item.host_id,
                hostUsername: item.host_username,
                hostAvatar: item.host_avatar,
              })
            }
          >
            {/* Avatar with red border */}
            <View style={styles.avatarWrapper}>
              {item.host_avatar ? (
                <Image source={{ uri: item.host_avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={{ color: '#00ff88', fontSize: 20 }}>🎤</Text>
                </View>
              )}
              <PulsingLiveBadge />
            </View>

            {/* Host name */}
            <Text style={styles.username} numberOfLines={1}>
              {item.host_username}
            </Text>

            {/* Viewer count */}
            <Text style={styles.viewers}>
              👁 {item.viewer_count.toLocaleString()}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};

// ─── STYLES ──────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0a',
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  list: {
    paddingHorizontal: 16,
    gap: 16,
  },
  card: {
    width: 72,
    alignItems: 'center',
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 6,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2.5,
    borderColor: '#ff0000',
  },
  avatarFallback: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  liveBadge: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: '#ff0000',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#fff',
  },
  liveText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  username: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
    width: '100%',
  },
  viewers: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
  },
}); 
