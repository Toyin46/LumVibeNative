// ═══════════════════════════════════════════════════════════
// StudioWave.tsx — Real VU Meter Waveform
// Uses plain React Native Animated (matches original exactly)
// src/components/studio/StudioWave.tsx
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef, memo } from 'react';
import { View, Animated } from 'react-native';

interface Props {
  level:     number;   // 0.0 – 1.0 from useVUMeter
  isActive:  boolean;
  barCount?: number;
  height?:   number;
  color?:    string;
}

const StudioWave = memo(function StudioWave({
  level,
  isActive,
  barCount = 32,
  height   = 48,
  color    = '#00ff88',
}: Props) {
  const bars = useRef(
    Array.from({ length: barCount }, () => new Animated.Value(0.15))
  ).current;

  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (isActive) {
      animRef.current = Animated.parallel(
        bars.map((b, i) => {
          const centreBoost  = 1 - Math.abs(i - barCount / 2) / (barCount / 2);
          const target       = Math.max(0.08, level * centreBoost + Math.random() * 0.15);
          return Animated.timing(b, {
            toValue:         Math.min(target, 1),
            duration:        80,
            useNativeDriver: false,
          });
        })
      );
      animRef.current.start();
    } else {
      animRef.current?.stop();
      bars.forEach(b => b.setValue(0.15));
    }
    return () => { animRef.current?.stop(); };
  }, [isActive, level]);

  const barColor = isActive
    ? (level > 0.8 ? '#ff4444' : level > 0.5 ? '#ffd700' : color)
    : '#333';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height, gap: 2, paddingHorizontal: 4 }}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            width:           3,
            borderRadius:    2,
            backgroundColor: barColor,
            height:          b.interpolate({ inputRange: [0, 1], outputRange: [3, height - 4] }),
          }}
        />
      ))}
    </View>
  );
});

export default StudioWave; 
