// ═══════════════════════════════════════════════════════════
// VoiceEffectsPanel.tsx — Voice Effect Picker
// ═══════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet,
} from 'react-native';
import { VOICE_EFFECTS } from '../../utils/constants';
import type { VoiceEffect } from '../../utils/types';

interface Props {
  selectedId: string;
  onSelect:   (effect: VoiceEffect) => void;
}

const CATEGORIES = ['All', 'Basic', 'Pitch', 'Studio', 'Space', 'FX'];

export default function VoiceEffectsPanel({ selectedId, onSelect }: Props) {
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = activeCategory === 'All'
    ? VOICE_EFFECTS
    : VOICE_EFFECTS.filter(e => e.category === activeCategory);

  return (
    <View style={styles.container}>
      {/* Category tabs */}
      <FlatList
        horizontal
        data={CATEGORIES}
        keyExtractor={c => c}
        showsHorizontalScrollIndicator={false}
        style={styles.catList}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.catTab, activeCategory === item && styles.catTabActive]}
            onPress={() => setActiveCategory(item)}
          >
            <Text style={[styles.catText, activeCategory === item && styles.catTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* Effect grid */}
      <FlatList
        horizontal
        data={filtered}
        keyExtractor={e => e.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.effectList}
        renderItem={({ item }) => {
          const selected = item.id === selectedId;
          return (
            <TouchableOpacity
              style={[styles.effectCard, selected && styles.effectCardSelected]}
              onPress={() => onSelect(item)}
            >
              <Text style={styles.effectEmoji}>{item.emoji}</Text>
              <Text style={[styles.effectName, selected && styles.effectNameSelected]}>
                {item.name}
              </Text>
              <Text style={styles.effectDesc} numberOfLines={2}>
                {item.desc}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 8 },
  catList: { marginBottom: 10 },
  catTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1E1E3A',
    marginRight: 8,
  },
  catTabActive: { backgroundColor: '#6B4FFF' },
  catText:      { color: '#888', fontSize: 12, fontWeight: '600' },
  catTextActive:{ color: '#FFF' },

  effectList: { paddingHorizontal: 4, gap: 10 },
  effectCard: {
    backgroundColor: '#111124',
    borderRadius: 14,
    padding: 12,
    width: 90,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2A2A4A',
  },
  effectCardSelected: {
    borderColor: '#6B4FFF',
    backgroundColor: '#1A1A3A',
    shadowColor: '#6B4FFF',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  effectEmoji: { fontSize: 26, marginBottom: 4 },
  effectName: {
    color: '#AAA',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  effectNameSelected: { color: '#FFF' },
  effectDesc: {
    color: '#555',
    fontSize: 9,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 12,
  },
}); 

 
