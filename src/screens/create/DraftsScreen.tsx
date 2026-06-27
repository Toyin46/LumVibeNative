// ═══════════════════════════════════════════════════════════
// DraftsScreen.tsx — Drafts list + restore
// ═══════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Draft } from '../../utils/types';

const DRAFTS_KEY = 'lumvibe_drafts';

interface Props {
  onRestore: (draft: Draft) => void;
  onClose:   () => void;
}

export default function DraftsScreen({ onRestore, onClose }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    loadDrafts();
  }, []);

  async function loadDrafts() {
    try {
      const raw = await AsyncStorage.getItem(DRAFTS_KEY);
      if (raw) setDrafts(JSON.parse(raw));
    } catch {
      // ignore
    }
  }

  async function deleteDraft(id: string) {
    Alert.alert('Delete Draft', 'Remove this draft permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const updated = drafts.filter(d => d.id !== id);
          setDrafts(updated);
          await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(updated));
        },
      },
    ]);
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  if (drafts.length === 0) {
    return (
      <View style={styles.empty}>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.emptyEmoji}>📝</Text>
        <Text style={styles.emptyTitle}>No Drafts</Text>
        <Text style={styles.emptyText}>
          Saved drafts will appear here. Start creating!
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>📝 Drafts</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[...drafts].reverse()}
        keyExtractor={d => d.id}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.cardMain}
              onPress={() => onRestore(item)}
            >
              <View style={styles.cardIcon}>
                <Text style={styles.cardIconText}>
                  {item.mediaType === 'video' ? '🎬'
                    : item.mediaType === 'image' ? '🖼️'
                    : item.mediaType === 'voice' ? '🎤'
                    : '✍️'}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardCaption} numberOfLines={2}>
                  {item.caption || '(No caption)'}
                </Text>
                <Text style={styles.cardDate}>{formatDate(item.createdAt)}</Text>
                {item.selectedVibe && (
                  <Text style={styles.cardVibe}>#{item.selectedVibe}</Text>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => deleteDraft(item.id)}
            >
              <Text style={styles.deleteBtnText}>🗑</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0A0A1A' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A3A',
  },
  title:        { color: '#FFF', fontWeight: '800', fontSize: 18 },
  closeBtnText: { color: '#888', fontSize: 20 },
  closeBtn:     { position: 'absolute', top: 16, right: 16 },

  empty: { flex: 1, backgroundColor: '#0A0A1A', alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyEmoji:   { fontSize: 56, marginBottom: 12 },
  emptyTitle:   { color: '#FFF', fontWeight: '800', fontSize: 20, marginBottom: 8 },
  emptyText:    { color: '#666', textAlign: 'center', fontSize: 14, lineHeight: 22 },

  card: {
    backgroundColor: '#111124',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A4A',
    overflow: 'hidden',
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#1A1A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText:   { fontSize: 22 },
  cardInfo:       { flex: 1 },
  cardCaption:    { color: '#FFF', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  cardDate:       { color: '#666', fontSize: 11 },
  cardVibe:       { color: '#6B4FFF', fontSize: 11, marginTop: 2 },
  deleteBtn:      { padding: 16 },
  deleteBtnText:  { fontSize: 20 },
}); 

 
