// ═══════════════════════════════════════════════════════════
// AROverlay.tsx — Emoji AR particle overlay
// src/components/ar/AROverlay.tsx
// utils at: ../../utils/types
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef, memo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withTiming, withDelay, withSequence, Easing,
} from 'react-native-reanimated';
import type { AREffect } from '../../utils/types';

const { width: SW, height: SH } = Dimensions.get('window');

interface FaceLandmarks {
  noseTipX?: number;
  noseTipY?: number;
  bounds?:   { x: number; y: number; width: number; height: number };
}

interface Props {
  effect:     AREffect;
  landmarks?: FaceLandmarks | null;
  count?:     number;
}

const AROverlay = memo(function AROverlay({ effect, landmarks, count = 12 }: Props) {
  if (!effect || effect.type === 'none') return null;

  if (effect.type === 'float' || effect.type === 'top') {
    return <FloatingParticles effect={effect} count={count} />;
  }
  return <FaceAnchoredEffect effect={effect} landmarks={landmarks ?? null} />;
});

export default AROverlay;

function FloatingParticles({ effect, count }: { effect: AREffect; count: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: count }).map((_, i) => (
        <FloatingParticle key={i} effect={effect} index={i} total={count} />
      ))}
    </View>
  );
}

function FloatingParticle({
  effect, index, total,
}: { effect: AREffect; index: number; total: number }) {
  const startX     = (SW / total) * index + Math.random() * (SW / total);
  const startY     = effect.type === 'top' ? Math.random() * SH * 0.3 : Math.random() * SH;
  const translateY = useSharedValue(0);
  const opacity    = useSharedValue(0);
  const scale      = useSharedValue(0.5 + Math.random() * 0.8);
  const delay      = Math.random() * 2000;
  const duration   = 2500 + Math.random() * 2000;

  useEffect(() => {
    opacity.value    = withDelay(delay, withRepeat(withSequence(
      withTiming(1,   { duration: 500 }),
      withTiming(0.8, { duration: duration - 600 }),
      withTiming(0,   { duration: 200 }),
    ), -1, false));
    translateY.value = withDelay(delay, withRepeat(
      withTiming(effect.type === 'top' ? -SH * 0.5 : -150, { duration, easing: Easing.linear }),
      -1, false,
    ));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Animated.Text style={[
      { position: 'absolute', left: startX, top: startY, fontSize: effect.size },
      style,
    ]}>
      {effect.emoji}
    </Animated.Text>
  );
}

function FaceAnchoredEffect({
  effect, landmarks,
}: { effect: AREffect; landmarks: FaceLandmarks | null }) {
  const scale = useSharedValue(0.9);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 600 }),
        withTiming(0.95, { duration: 600 }),
      ), -1, true,
    );
  }, []);

  let x = SW / 2;
  let y = SH * 0.3;

  if (landmarks) {
    if (effect.skiaAnchor === 'noseTip' && landmarks.noseTipX != null) {
      x = landmarks.noseTipX;
      y = (landmarks.noseTipY ?? SH * 0.35) + effect.offsetY;
    } else if (landmarks.bounds) {
      x = landmarks.bounds.x + landmarks.bounds.width / 2;
      y = landmarks.bounds.y + effect.offsetY;
    }
  }

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.Text style={[
        { position: 'absolute', left: x - effect.size / 2, top: y, fontSize: effect.size },
        style,
      ]}>
        {effect.emoji}
      </Animated.Text>
    </View>
  );
} 
