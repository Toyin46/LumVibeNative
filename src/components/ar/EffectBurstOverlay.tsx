// ═══════════════════════════════════════════════════════════
// EffectBurstOverlay.tsx — One-shot burst particle animation
// src/components/ar/EffectBurstOverlay.tsx
// No external deps needed
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useState, memo } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withDelay,
} from 'react-native-reanimated';

const { width: SW, height: SH } = Dimensions.get('window');
const EMOJIS = ['✨','🎵','🔥','💥','🌟','⚡','🎶','💫'];
const COUNT  = 16;

interface Particle { id: number; emoji: string; x: number; y: number; angle: number; dist: number; }

interface Props { trigger: boolean; onDone?: () => void; }

const EffectBurstOverlay = memo(function EffectBurstOverlay({ trigger, onDone }: Props) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!trigger) return;
    setParticles(Array.from({ length: COUNT }, (_, i) => ({
      id: i, emoji: EMOJIS[i % EMOJIS.length],
      x: SW / 2, y: SH / 2,
      angle: (360 / COUNT) * i,
      dist: 80 + Math.random() * 140,
    })));
    const t = setTimeout(() => { setParticles([]); onDone?.(); }, 1200);
    return () => clearTimeout(t);
  }, [trigger]);

  if (!particles.length) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map(p => <BurstParticle key={p.id} particle={p} />)}
    </View>
  );
});

export default EffectBurstOverlay;

function BurstParticle({ particle: p }: { particle: Particle }) {
  const rad   = (p.angle * Math.PI) / 180;
  const destX = p.x + Math.cos(rad) * p.dist;
  const destY = p.y + Math.sin(rad) * p.dist;

  const x       = useSharedValue(p.x);
  const y       = useSharedValue(p.y);
  const opacity = useSharedValue(1);
  const scale   = useSharedValue(0.3);

  useEffect(() => {
    x.value       = withTiming(destX,  { duration: 900 });
    y.value       = withTiming(destY,  { duration: 900 });
    scale.value   = withTiming(1.4,    { duration: 300 });
    opacity.value = withDelay(500, withTiming(0, { duration: 400 }));
  }, []);

  const style = useAnimatedStyle(() => ({
    position: 'absolute',
    left:     x.value,
    top:      y.value,
    opacity:  opacity.value,
    transform:[{ scale: scale.value }],
  }));

  return <Animated.Text style={[style, { fontSize: 22 }]}>{p.emoji}</Animated.Text>;
}