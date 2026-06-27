// components/LeaderboardWinnerCelebration.tsx
// ✅ Full-screen confetti burst when weekly winner is announced
// ✅ Shimmer/shine animation on winner's profile card
// ✅ Persistent winner banner visible on winner's profile to ALL users
// ✅ Crown floating animation
// ✅ Auto-dismisses after 6 seconds, or user taps to dismiss
// ✅ Non-destructive — drop this component anywhere, pass winner data as props

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Dimensions, TouchableOpacity,
  Modal, Image, Easing,
} from 'react-native';

const { width, height } = Dimensions.get('window');

// ── Confetti particle config ──────────────────────────────────────────────
const CONFETTI_COUNT = 60;
const CONFETTI_COLORS = [
  '#00ff88', '#ffd700', '#ff6b6b', '#8888ff',
  '#ff88cc', '#00cfff', '#ffaa00', '#ffffff',
];

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

// ── Single confetti particle ──────────────────────────────────────────────
function ConfettiPiece({ delay }: { delay: number }) {
  const startX   = randomBetween(0, width);
  const color    = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  const size     = randomBetween(6, 14);
  const duration = randomBetween(2000, 3500);
  const isCircle = Math.random() > 0.5;

  const translateY = useRef(new Animated.Value(-20)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const rotate     = useRef(new Animated.Value(0)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const drift = randomBetween(-60, 60);
    Animated.sequence([
      Animated.delay(delay),
      Animated.parallel([
        Animated.timing(opacity,     { toValue: 1,    duration: 200,     useNativeDriver: true }),
        Animated.timing(translateY,  { toValue: height + 40, duration, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(translateX,  { toValue: drift, duration, easing: Easing.sin,    useNativeDriver: true }),
        Animated.loop(
          Animated.timing(rotate,    { toValue: 1,    duration: 800,     easing: Easing.linear, useNativeDriver: true })
        ),
      ]),
    ]).start();
  }, []);

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={{
        position:  'absolute',
        left:      startX,
        top:       -20,
        width:     size,
        height:    size,
        borderRadius: isCircle ? size / 2 : 2,
        backgroundColor: color,
        opacity,
        transform: [{ translateY }, { translateX }, { rotate: spin }],
      }}
    />
  );
}

// ── Shimmer animation for winner card ────────────────────────────────────
function ShimmerBar() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
        Animated.delay(800),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const translateX = shimmer.interpolate({
    inputRange:  [0, 1],
    outputRange: [-width, width],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        {
          transform:   [{ translateX }],
          overflow:    'hidden',
          borderRadius: 16,
        },
      ]}
    >
      <View style={ss.shimmerBar} />
    </Animated.View>
  );
}

// ── Floating crown animation ──────────────────────────────────────────────
function FloatingCrown() {
  const float = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, { toValue: -12, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(float, { toValue: 0,   duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      ),
    ]).start();
  }, []);

  return (
    <Animated.Text style={[ss.crownEmoji, { transform: [{ translateY: float }, { scale }] }]}>
      👑
    </Animated.Text>
  );
}

// ── Pulsing glow ring ─────────────────────────────────────────────────────
function GlowRing() {
  const pulse = useRef(new Animated.Value(1)).current;
  const fade  = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.18, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1,    duration: 900, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(fade,  { toValue: 0.3, duration: 900, useNativeDriver: true }),
          Animated.timing(fade,  { toValue: 0.8, duration: 900, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[ss.glowRing, { transform: [{ scale: pulse }], opacity: fade }]}
    />
  );
}

// ── Props ─────────────────────────────────────────────────────────────────
interface WinnerData {
  userId:      string;
  username:    string;
  displayName: string;
  avatarUrl?:  string;
  points:      number;
  weekLabel:   string; // e.g. "Week of May 5, 2026"
}

interface Props {
  winner:    WinnerData;
  visible:   boolean;
  onDismiss: () => void;
  /** Pass true when rendering on the winner's own profile page */
  isProfileBanner?: boolean;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────
export function LeaderboardWinnerCelebration({ winner, visible, onDismiss, isProfileBanner = false }: Props) {
  const cardScale   = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const bgOpacity   = useRef(new Animated.Value(0)).current;
  const [autoDismissed, setAutoDismissed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setAutoDismissed(false);

    Animated.parallel([
      Animated.timing(bgOpacity,   { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(cardScale,   { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    // Auto-dismiss after 6 seconds
    const timer = setTimeout(() => {
      setAutoDismissed(true);
      onDismiss();
    }, 6000);
    return () => clearTimeout(timer);
  }, [visible]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(bgOpacity,   { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      Animated.timing(cardScale,   { toValue: 0.9, duration: 300, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  // ── PROFILE BANNER MODE (persistent, shown on profile to all visitors) ──
  if (isProfileBanner) {
    return (
      <View style={ss.bannerWrap}>
        <View style={ss.bannerInner}>
          <ShimmerBar />
          <Text style={ss.bannerCrown}>👑</Text>
          <View style={{ flex: 1 }}>
            <Text style={ss.bannerTitle}>Weekly Champion</Text>
            <Text style={ss.bannerSub}>{winner.weekLabel} · {winner.points.toLocaleString()} pts</Text>
          </View>
          <View style={ss.bannerBadge}>
            <Text style={ss.bannerBadgeText}>#1</Text>
          </View>
        </View>
      </View>
    );
  }

  // ── FULL-SCREEN CELEBRATION MODAL ────────────────────────────────────────
  return (
    <Modal transparent visible={visible && !autoDismissed} animationType="none" statusBarTranslucent>
      <Animated.View style={[ss.overlay, { opacity: bgOpacity }]}>
        {/* Confetti burst */}
        {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
          <ConfettiPiece key={i} delay={i * 40} />
        ))}

        {/* Winner card */}
        <Animated.View style={[ss.card, { transform: [{ scale: cardScale }], opacity: cardOpacity }]}>
          <ShimmerBar />

          <FloatingCrown />

          <Text style={ss.weekLabel}>{winner.weekLabel}</Text>
          <Text style={ss.headline}>🏆 Weekly Champion!</Text>

          {/* Avatar with glow */}
          <View style={ss.avatarWrap}>
            <GlowRing />
            {winner.avatarUrl
              ? <Image source={{ uri: winner.avatarUrl }} style={ss.avatar} />
              : (
                <View style={ss.avatarPh}>
                  <Text style={ss.avatarPhletter}>{(winner.displayName || winner.username)[0].toUpperCase()}</Text>
                </View>
              )
            }
          </View>

          <Text style={ss.winnerName}>{winner.displayName}</Text>
          <Text style={ss.winnerUsername}>@{winner.username}</Text>

          <View style={ss.pointsBadge}>
            <Text style={ss.pointsNum}>{winner.points.toLocaleString()}</Text>
            <Text style={ss.pointsLabel}>points this week</Text>
          </View>

          <Text style={ss.congratsText}>
            🎉 Congratulations! Your content topped the leaderboard this week!
          </Text>

          <TouchableOpacity style={ss.dismissBtn} onPress={handleDismiss}>
            <Text style={ss.dismissBtnText}>🙌 Amazing!</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Tap outside to dismiss */}
        <TouchableOpacity
          style={StyleSheet.absoluteFillObject}
          onPress={handleDismiss}
          activeOpacity={1}
        />
      </Animated.View>
    </Modal>
  );
}

// ── WINNER PROFILE BADGE ─────────────────────────────────────────────────
// Drop this on any profile screen. It shows a golden shimmer banner
// to ALL users who visit the winner's profile during the winner week.
interface WinnerBadgeProps {
  weekLabel: string;
  points:    number;
}

export function WinnerProfileBadge({ weekLabel, points }: WinnerBadgeProps) {
  const shimmer = useRef(new Animated.Value(0)).current;
  const pulse   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0,    useNativeDriver: true }),
        Animated.delay(600),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.03, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const translateX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-300, 300] });

  return (
    <Animated.View style={[ss.winnerBadgeWrap, { transform: [{ scale: pulse }] }]}>
      {/* Shimmer sweep */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { overflow: 'hidden', borderRadius: 14 }]}
      >
        <Animated.View style={[ss.shimmerSweep, { transform: [{ translateX }] }]} />
      </Animated.View>

      <Text style={ss.wbCrown}>👑</Text>
      <View style={{ flex: 1 }}>
        <Text style={ss.wbTitle}>🏆 Weekly Champion</Text>
        <Text style={ss.wbSub}>{weekLabel}</Text>
      </View>
      <View style={ss.wbPts}>
        <Text style={ss.wbPtsNum}>{points.toLocaleString()}</Text>
        <Text style={ss.wbPtsLabel}>pts</Text>
      </View>
    </Animated.View>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  // Full-screen overlay
  overlay:         { flex: 1, backgroundColor: 'rgba(0,0,0,0.88)', alignItems: 'center', justifyContent: 'center' },

  // Winner card
  card:            { backgroundColor: '#0a1a0a', borderRadius: 24, padding: 28, alignItems: 'center', marginHorizontal: 24, borderWidth: 2, borderColor: '#ffd700', overflow: 'hidden', maxWidth: 340, width: '100%' },
  crownEmoji:      { fontSize: 48, marginBottom: 6 },
  weekLabel:       { color: '#666', fontSize: 11, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 },
  headline:        { color: '#ffd700', fontSize: 22, fontWeight: '800', marginBottom: 20 },

  // Avatar
  avatarWrap:      { position: 'relative', marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  glowRing:        { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#ffd700', backgroundColor: 'transparent' },
  avatar:          { width: 84, height: 84, borderRadius: 42, borderWidth: 3, borderColor: '#ffd700' },
  avatarPh:        { width: 84, height: 84, borderRadius: 42, backgroundColor: '#ffd700', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#ffd700' },
  avatarPhletter:  { fontSize: 34, fontWeight: '800', color: '#000' },

  winnerName:      { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 2 },
  winnerUsername:  { color: '#666', fontSize: 14, marginBottom: 16 },

  // Points badge
  pointsBadge:     { backgroundColor: '#1a1200', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 16, borderWidth: 1, borderColor: '#ffd70044', alignItems: 'center' },
  pointsNum:       { color: '#ffd700', fontSize: 28, fontWeight: '800' },
  pointsLabel:     { color: '#888', fontSize: 12 },

  congratsText:    { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },

  dismissBtn:      { backgroundColor: '#ffd700', paddingHorizontal: 32, paddingVertical: 13, borderRadius: 30 },
  dismissBtnText:  { color: '#000', fontWeight: '800', fontSize: 15 },

  // Shimmer bar (inside card)
  shimmerBar:      { position: 'absolute', top: 0, bottom: 0, width: 80, backgroundColor: 'rgba(255,255,255,0.07)', transform: [{ skewX: '-20deg' }] },

  // Profile banner (compact, shown on profile page)
  bannerWrap:      { marginHorizontal: 16, marginBottom: 12 },
  bannerInner:     { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1a1200', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#ffd70066', overflow: 'hidden' },
  bannerCrown:     { fontSize: 22 },
  bannerTitle:     { color: '#ffd700', fontSize: 13, fontWeight: '800' },
  bannerSub:       { color: '#888', fontSize: 11, marginTop: 1 },
  bannerBadge:     { backgroundColor: '#ffd700', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  bannerBadgeText: { color: '#000', fontWeight: '800', fontSize: 13 },

  // Winner profile badge (larger, shown on profile screen for all visitors)
  winnerBadgeWrap: { marginHorizontal: 16, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a1200', borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: '#ffd700', overflow: 'hidden' },
  shimmerSweep:    { position: 'absolute', top: 0, bottom: 0, width: 60, backgroundColor: 'rgba(255,215,0,0.15)', transform: [{ skewX: '-20deg' }] },
  wbCrown:         { fontSize: 28 },
  wbTitle:         { color: '#ffd700', fontSize: 14, fontWeight: '800' },
  wbSub:           { color: '#888', fontSize: 11, marginTop: 2 },
  wbPts:           { alignItems: 'flex-end' },
  wbPtsNum:        { color: '#ffd700', fontSize: 20, fontWeight: '800' },
  wbPtsLabel:      { color: '#888', fontSize: 10 },
}); 
