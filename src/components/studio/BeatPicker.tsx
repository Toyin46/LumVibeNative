// ═══════════════════════════════════════════════════════════
// BeatPicker.tsx — Upload a beat to sing over
// src/components/studio/BeatPicker.tsx
// ═══════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { MUSIC_UPLOAD_LIMIT_MB } from '../../utils/constants';

interface Props {
  beatUri:        string | null;
  beatName:       string | null;
  beatVolume:     number;
  onSelect:       (uri: string, name: string) => void;
  onRemove:       () => void;
  onVolumeChange: (v: number) => void;
}

const VOLUME_PRESETS = [0.2, 0.4, 0.6, 0.8];

export default function BeatPicker({
  beatUri, beatName, beatVolume, onSelect, onRemove, onVolumeChange,
}: Props) {
  async function handlePick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;

      const file   = result.assets[0];
      const sizeMb = (file.size ?? 0) / (1024 * 1024);
      if (sizeMb > MUSIC_UPLOAD_LIMIT_MB) {
        Alert.alert(
          'File too large',
          `Beats must be under ${MUSIC_UPLOAD_LIMIT_MB}MB. This file is ${sizeMb.toFixed(1)}MB.`,
        );
        return;
      }
      onSelect(file.uri, file.name ?? 'Beat');
    } catch (err) {
      Alert.alert('Could not add beat', err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>🥁 Sing Over a Beat</Text>

      {beatUri ? (
        <View style={styles.selectedRow}>
          <Text style={styles.selectedName} numberOfLines={1}>🎵 {beatName}</Text>
          <TouchableOpacity onPress={onRemove}>
            <Text style={styles.removeText}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.pickBtn} onPress={handlePick}>
          <Text style={styles.pickBtnText}>+ Upload a Beat</Text>
        </TouchableOpacity>
      )}

      {beatUri && (
        <View style={styles.volumeRow}>
          <Text style={styles.volumeLabel}>Beat Volume in Final Mix</Text>
          <View style={styles.volumeButtons}>
            {VOLUME_PRESETS.map(v => (
              <TouchableOpacity
                key={v}
                style={[styles.volBtn, Math.abs(beatVolume - v) < 0.05 && styles.volBtnActive]}
                onPress={() => onVolumeChange(v)}
              >
                <Text style={[styles.volBtnText, Math.abs(beatVolume - v) < 0.05 && styles.volBtnTextActive]}>
                  {Math.round(v * 100)}%
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <Text style={styles.hint}>
        🎧 Wear headphones while recording so the beat doesn't bleed into your
        mic — either way, it gets properly mixed into your final take.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card:  { backgroundColor: '#111124', borderRadius: 16, padding: 16, marginTop: 14, borderWidth: 1, borderColor: '#2A2A4A' },
  title: { color: '#FFF', fontWeight: '800', fontSize: 15, marginBottom: 12 },

  pickBtn:     { backgroundColor: '#1E1E3A', borderRadius: 12, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#6B4FFF', borderStyle: 'dashed' },
  pickBtnText: { color: '#A78BFA', fontWeight: '700', fontSize: 14 },

  selectedRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#0A1A0A', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#00ff88' },
  selectedName: { color: '#00ff88', fontWeight: '700', fontSize: 13, flex: 1, marginRight: 10 },
  removeText:   { color: '#FF6B6B', fontWeight: '700', fontSize: 12 },

  volumeRow:      { marginTop: 14 },
  volumeLabel:    { color: '#AAA', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  volumeButtons:  { flexDirection: 'row', gap: 8 },
  volBtn:         { flex: 1, backgroundColor: '#1E1E3A', borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A4A' },
  volBtnActive:   { borderColor: '#6B4FFF', backgroundColor: '#22183F' },
  volBtnText:     { color: '#888', fontWeight: '700', fontSize: 12 },
  volBtnTextActive: { color: '#FFF' },

  hint: { color: '#666', fontSize: 11, marginTop: 12, lineHeight: 15 },
}); 
