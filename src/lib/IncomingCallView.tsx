// src/lib/IncomingCallView.tsx   (NEW FILE)
//
// The "image 3" screen — name, big photo, Decline · Swipe up to accept ·
// Message — as a plain view with no logic of its own. Two places show it:
//   • globalIncomingSignal.tsx  (app open: inside a Modal)
//   • IncomingCallLockScreen.tsx (phone locked: over the lock screen)

import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image, StyleSheet,
  Animated, Easing, PanResponder, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { RingPayload } from './ringPayload';

const GREEN = '#00e676';

export function Avatar({ uri, name, size, ring }: { uri?: string; name: string; size: number; ring?: boolean }) {
  const style = {
    width: size, height: size, borderRadius: size / 2,
    ...(ring ? { borderWidth: 3, borderColor: 'rgba(255,255,255,0.12)' } : {}),
  };
  if (uri) return <Image source={{ uri }} style={style} />;
  return (
    <View style={[style, styles.avatarFallback]}>
      <Text style={[styles.avatarInitial, { fontSize: size * 0.4 }]}>
        {(name || 'U')[0].toUpperCase()}
      </Text>
    </View>
  );
}

export function IncomingCallView({
  p, onAccept, onDecline, onMessage,
}: {
  p: RingPayload;
  onAccept: () => void;
  onDecline: () => void;
  onMessage: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isCowatch = p.type === 'cowatch_invite';
  const isVideo = p.callType === 'video';
  const avatarSize = Math.min(width * 0.5, 240);

  const subtitle = isCowatch ? 'LumVibe Watch Together' : isVideo ? 'LumVibe video call' : 'LumVibe voice call';
  const subIcon = (isCowatch ? 'film' : isVideo ? 'videocam' : 'call') as any;
  const acceptIcon = (isCowatch ? 'play' : isVideo ? 'videocam' : 'call') as any;

  // swipe-up-to-accept (a plain tap works too)
  const acceptRef = useRef(onAccept);
  acceptRef.current = onAccept;
  const dy = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => dy.setValue(Math.min(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        const isTap = Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6;
        if (g.dy < -80 || isTap) acceptRef.current();
        else Animated.spring(dy, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dy, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  // travelling chevrons above the accept button
  const phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(phase, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase]);
  const chevronOpacity = (i: number) =>
    phase.interpolate({
      inputRange: [0, 0.12 * i, 0.12 * i + 0.3, 1],
      outputRange: [0.15, 0.15, 1, 0.15],
    });

  return (
    <View style={[styles.full, { paddingTop: insets.top + 70, paddingBottom: insets.bottom + 28 }]}>
      <View style={styles.fullTop}>
        <Text style={styles.fullName} numberOfLines={1}>{p.fromName}</Text>
        <View style={styles.fullSubRow}>
          <Ionicons name={subIcon} size={16} color="#aab4ba" />
          <Text style={styles.fullSub}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.fullAvatarWrap}>
        <Avatar uri={p.fromPhoto} name={p.fromName} size={avatarSize} ring />
      </View>

      <View style={styles.fullBottom}>
        {/* Decline */}
        <View style={styles.fullCol}>
          <TouchableOpacity style={[styles.roundBtn, { backgroundColor: '#e8194b' }]} onPress={onDecline}>
            <Ionicons name="call" size={30} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>
          <Text style={styles.fullLabel}>Decline</Text>
        </View>

        {/* Swipe up to accept */}
        <View style={styles.fullColCenter}>
          <View style={styles.chevrons}>
            {[0, 1, 2, 3].map(i => (
              <Animated.View key={i} style={{ opacity: chevronOpacity(i), marginBottom: -9 }}>
                <Ionicons name="chevron-up" size={22} color="#aab4ba" />
              </Animated.View>
            ))}
          </View>
          <Animated.View style={{ transform: [{ translateY: dy }] }} {...pan.panHandlers}>
            <View style={[styles.roundBtn, { backgroundColor: '#1fa855' }]}>
              <Ionicons name={acceptIcon} size={30} color="#fff" />
            </View>
          </Animated.View>
          <Text style={styles.fullLabel}>{isCowatch ? 'Swipe up to join' : 'Swipe up to accept'}</Text>
        </View>

        {/* Message */}
        <View style={styles.fullCol}>
          <TouchableOpacity style={[styles.roundBtn, { backgroundColor: '#1f2c34' }]} onPress={onMessage}>
            <Ionicons name="chatbubble-ellipses" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.fullLabel}>Message</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarFallback: { backgroundColor: 'rgba(0,230,118,0.16)', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: GREEN, fontWeight: '700' },

  full: { flex: 1, backgroundColor: '#0b141a', alignItems: 'center', justifyContent: 'space-between' },
  fullTop: { alignItems: 'center', paddingHorizontal: 24 },
  fullName: { color: '#fff', fontSize: 34, fontWeight: '600' },
  fullSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  fullSub: { color: '#aab4ba', fontSize: 17 },
  fullAvatarWrap: { alignItems: 'center', justifyContent: 'center' },
  fullBottom: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 34 },
  fullCol: { alignItems: 'center', width: 96 },
  fullColCenter: { alignItems: 'center', width: 150 },
  roundBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  fullLabel: { color: '#aab4ba', fontSize: 14, marginTop: 10, textAlign: 'center' },
  chevrons: { alignItems: 'center', marginBottom: 18 },
});
