// ═══════════════════════════════════════════════════════════
// VolumeSlider.tsx — EXACT original design from create.tsx
// Uses PanResponder (original pattern, drag-reset bug fixed)
// src/components/shared/VolumeSlider.tsx
// ═══════════════════════════════════════════════════════════

import React, { useRef, useEffect, memo } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder, Dimensions } from 'react-native';

const { width: SW } = Dimensions.get('window');

interface Props {
  value:        number;
  onChange:     (v: number) => void;
  color?:       string;
  label:        string;
  emoji:        string;
}

const VolumeSlider = memo(function VolumeSlider({
  value, onChange, color = '#00ff88', label, emoji,
}: Props) {
  const TW = SW - 80;
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
      const startX = cv.current * TW;
      const x      = Math.min(Math.max(startX + gs.dx, 0), TW);
      tx.setValue(x);
      onChange(Math.round(x / TW * 100) / 100);
    },
    onPanResponderRelease: (_, gs) => {
      const startX = cv.current * TW;
      const x      = Math.min(Math.max(startX + gs.dx, 0), TW);
      const newVal = Math.round(x / TW * 100) / 100;
      cv.current   = newVal;
      onChange(newVal);
    },
  })).current;

  const pct = Math.round(value * 100);

  return (
    <View style={sl.row}>
      <Text style={sl.emoji}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <View style={sl.lblRow}>
          <Text style={sl.lbl}>{label}</Text>
          <Text style={[sl.pct, { color }]}>{pct}%</Text>
        </View>
        <View style={sl.track}>
          <View style={[sl.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
          <Animated.View
            style={[sl.thumb, { backgroundColor: color, transform: [{ translateX: Animated.subtract(tx, 10) }] }]}
            {...pan.panHandlers}
          />
        </View>
      </View>
    </View>
  );
});

export default VolumeSlider;

const sl = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14, paddingHorizontal: 4 },
  emoji:  { fontSize: 20, marginRight: 12, width: 28, textAlign: 'center' },
  lblRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  lbl:    { color: '#ccc', fontSize: 13, fontWeight: '600' },
  pct:    { fontSize: 13, fontWeight: '700' },
  track:  { height: 6, backgroundColor: '#2a2a2a', borderRadius: 3, position: 'relative', overflow: 'visible' },
  fill:   { position: 'absolute', left: 0, top: 0, height: 6, borderRadius: 3 },
  thumb:  { position: 'absolute', top: -7, width: 20, height: 20, borderRadius: 10, elevation: 4 },
}); 

 
