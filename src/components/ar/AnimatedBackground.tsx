// ═══════════════════════════════════════════════════════════
// AnimatedBackground.tsx — Animated gradient background
// Pure React Native Animated — no native deps required
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
import { ANIMATED_BACKGROUNDS } from '../../utils/constants';

const { width: SW, height: SH } = Dimensions.get('window');

interface Props {
  backgroundId: string;
  intensity?:   number;   // 0–1
}

export default function AnimatedBackground({ backgroundId, intensity = 0.85 }: Props) {
  const bg = ANIMATED_BACKGROUNDS.find(b => b.id === backgroundId);
  if (!bg || bg.colors.length === 0) return null;

  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 3000, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 3000, useNativeDriver: false }),
      ])
    ).start();
  }, [backgroundId]);

  // Interpolate between first two colors
  const bgColor = bg.colors.length >= 2
    ? anim.interpolate({
        inputRange:  [0, 1],
        outputRange: [bg.colors[0], bg.colors[1]],
      })
    : bg.colors[0];

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: bgColor, opacity: intensity },
      ]}
      pointerEvents="none"
    />
  );
} 
