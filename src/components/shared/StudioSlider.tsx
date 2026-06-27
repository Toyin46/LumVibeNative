// ═══════════════════════════════════════════════════════════
// StudioSlider.tsx — EXACT original from create.tsx
// This was the missing file — now delivered
// src/components/shared/StudioSlider.tsx
// ═══════════════════════════════════════════════════════════

import React, { useRef, useEffect, memo } from 'react';
import { View, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';

const { width: SW } = Dimensions.get('window');

interface Props {
  value:    number;   // 0.0 – 1.0
  onChange: (v: number) => void;
  color:    string;
}

const StudioSlider = memo(function StudioSlider({ value, onChange, color }: Props) {
  const TW = SW - 100;
  const tx = useRef(new Animated.Value(value * TW)).current;
  const cv = useRef(value);

  useEffect(() => {
    tx.setValue(value * TW);
    cv.current = value;
  }, [value]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: () => { cv.current = value; },
    onPanResponderMove: (_, gs) => {
      const x = Math.min(Math.max(cv.current * TW + gs.dx, 0), TW);
      tx.setValue(x);
      onChange(Math.round(x / TW * 100) / 100);
    },
    onPanResponderRelease: (_, gs) => {
      const x = Math.min(Math.max(cv.current * TW + gs.dx, 0), TW);
      const v = Math.round(x / TW * 100) / 100;
      cv.current = v;
      onChange(v);
    },
  })).current;

  const pct = Math.round(value * 100);

  return (
    <View style={{ height: 6, backgroundColor: '#2a2a2a', borderRadius: 3, marginVertical: 8 }}>
      <View style={{
        position: 'absolute', left: 0, top: 0,
        height: 6, width: `${pct}%` as any,
        backgroundColor: color, borderRadius: 3,
      }} />
      <Animated.View
        style={{
          position: 'absolute', top: -7,
          width: 20, height: 20, borderRadius: 10,
          backgroundColor: color,
          transform: [{ translateX: Animated.subtract(tx, 10) }],
        }}
        {...pan.panHandlers}
      />
    </View>
  );
});

export default StudioSlider; 

 
