// ═══════════════════════════════════════════════════════════
// StudioEditPanel.tsx — Trim, Pitch, Reverb, FX controls
// Uses StudioSlider (PanResponder) — NO @react-native-community/slider
// src/components/studio/StudioEditPanel.tsx
// ═══════════════════════════════════════════════════════════

import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch } from 'react-native';
import StudioSlider from '../shared/StudioSlider';
import type { StudioEdit } from '../../utils/types';

interface Props {
  edit:     StudioEdit;
  duration: number;
  onChange: (updated: StudioEdit) => void;
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const StudioEditPanel = memo(function StudioEditPanel({ edit, duration, onChange }: Props) {
  function update(partial: Partial<StudioEdit>) {
    onChange({ ...edit, ...partial });
  }

  const toggles: [keyof StudioEdit, string][] = [
    ['chorus',    '🎶 Chorus'],
    ['reverse',   '🔄 Reverse'],
    ['normalise', '📊 Normalise'],
    ['noiseGate', '🔕 Noise Gate'],
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎛 Studio Edit</Text>

      {/* Trim */}
      {duration > 0 && (
        <View style={styles.section}>
          <View style={styles.labelRow}>
            <Text style={styles.label}>✂️ Trim Start</Text>
            <Text style={styles.value}>{fmt(edit.trimStart)}</Text>
          </View>
          <StudioSlider
            value={duration > 0 ? edit.trimStart / (duration * 0.5) : 0}
            onChange={v => update({ trimStart: v * duration * 0.5 })}
            color="#6B4FFF"
          />
          <View style={styles.labelRow}>
            <Text style={styles.label}>✂️ Trim End</Text>
            <Text style={styles.value}>{fmt(duration - edit.trimEnd)}</Text>
          </View>
          <StudioSlider
            value={duration > 0 ? edit.trimEnd / (duration * 0.5) : 0}
            onChange={v => update({ trimEnd: v * duration * 0.5 })}
            color="#6B4FFF"
          />
        </View>
      )}

      {/* Pitch shift — -12 to +12 semitones mapped 0–1 */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>🎵 Pitch Shift</Text>
          <Text style={styles.value}>
            {edit.pitchShift > 0 ? `+${edit.pitchShift}` : edit.pitchShift} st
          </Text>
        </View>
        <StudioSlider
          value={(edit.pitchShift + 12) / 24}
          onChange={v => update({ pitchShift: Math.round(v * 24 - 12) })}
          color="#FF6B35"
        />
      </View>

      {/* Reverb */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>🌊 Reverb</Text>
          <Text style={styles.value}>{Math.round(edit.reverbLevel * 100)}%</Text>
        </View>
        <StudioSlider
          value={edit.reverbLevel}
          onChange={v => update({ reverbLevel: v })}
          color="#00B4D8"
        />
      </View>

      {/* Delay */}
      <View style={styles.section}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>🔁 Echo Delay</Text>
          <Text style={styles.value}>{edit.delay}ms</Text>
        </View>
        <StudioSlider
          value={edit.delay / 600}
          onChange={v => update({ delay: Math.round(v * 600) })}
          color="#FFD700"
        />
      </View>

      {/* Toggles */}
      <View style={styles.toggleGrid}>
        {toggles.map(([key, label]) => (
          <View key={key} style={styles.toggleItem}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Switch
              value={edit[key] as boolean}
              onValueChange={v => update({ [key]: v })}
              trackColor={{ false: '#2A2A4A', true: '#00ff88' }}
              thumbColor={edit[key] ? '#FFF' : '#666'}
            />
          </View>
        ))}
      </View>
    </View>
  );
});

export default StudioEditPanel;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111124',
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  title:    { color: '#FFF', fontWeight: '700', fontSize: 15, marginBottom: 14 },
  section:  { marginBottom: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  label:    { color: '#AAA', fontSize: 12, fontWeight: '600' },
  value:    { color: '#00ff88', fontSize: 12, fontWeight: '700' },
  toggleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  toggleItem: {
    backgroundColor: '#1E1E3A',
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minWidth: '47%',
    flex: 1,
  },
  toggleLabel: { color: '#AAA', fontSize: 11, flex: 1 },
}); 

 
