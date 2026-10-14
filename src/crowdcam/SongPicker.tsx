// ─────────────────────────────────────────────────────────────
// src/crowdcam/SongPicker.tsx   (NEW FILE)
// "Add a song" for the host. Shows the same Trending list as Compose > Add Music
// (Supabase table `trending_sounds`) plus "From my phone". Tap the play button to
// preview, tap the row to choose. The chosen song is put on Cloudinary (the film
// builder needs it there) and handed back as { publicId, title }.
// It is a plain overlay (not a second <Modal>) so it works on top of Crowd Cam on iOS too.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { supabase } from '../config/supabase';
import { CROWD_CLOUD_NAME } from './crowdCamApi';

const UPLOAD_PRESET = 'Kinsta_unsigned';   // same unsigned preset create.tsx uses
const MAX_SONG_MB = 15;                    // same limit as Compose
const ACCENT = '#00ff88';

export interface PickedSong { publicId: string; title?: string }
interface Sound { id: string; name: string; artist: string; url: string; uses_count: number }

/** if the url is already a plain Cloudinary video/audio of OUR cloud, reuse it instead of uploading again */
function cloudinaryIdOf(url: string): string | null {
  const m = url.match(new RegExp(`^https://res\\.cloudinary\\.com/${CROWD_CLOUD_NAME}/video/upload/(?:v\\d+/)?([^?#]+?)\\.[A-Za-z0-9]{2,4}(?:[?#].*)?$`));
  return m && !m[1].includes(',') ? decodeURIComponent(m[1]) : null; // a "," means it has transformations: do not guess
}

async function putOnCloudinary(file: any): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CROWD_CLOUD_NAME}/video/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Could not upload the song (${res.status})`);
  const j = await res.json();
  if (!j.public_id) throw new Error('Could not upload the song');
  return j.public_id as string;
}

export default function SongPicker(props: { visible: boolean; onClose: () => void; onPick: (s: PickedSong) => void }) {
  const { visible, onClose, onPick } = props;
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);   // text shown while a song is being prepared
  const [playingId, setPlayingId] = useState<string | null>(null);
  const player = useRef<AudioPlayer | null>(null);

  const stopPreview = () => {
    try { player.current?.pause(); player.current?.remove(); } catch { /* already gone */ }
    player.current = null;
    setPlayingId(null);
  };

  useEffect(() => {
    if (!visible) { stopPreview(); return; }
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.from('trending_sounds').select('id, name, artist, url, uses_count')
          .order('uses_count', { ascending: false }).limit(30);
        if (live) setSounds((data as Sound[]) ?? []);
      } catch { if (live) setSounds([]); }
    })();
    return () => { live = false; stopPreview(); };
  }, [visible]);

  if (!visible) return null;

  const preview = (s: Sound) => {
    if (playingId === s.id) return stopPreview();
    stopPreview();
    try {
      const p = createAudioPlayer({ uri: s.url } as any);
      player.current = p;
      p.play();
      setPlayingId(s.id);
    } catch { Alert.alert('Preview failed', 'This sound could not be played.'); }
  };

  const choose = async (s: Sound) => {
    stopPreview();
    setWorking(`Getting “${s.name}” ready…`);
    try {
      const publicId = cloudinaryIdOf(s.url) ?? (await putOnCloudinary(s.url)); // Cloudinary fetches the url itself
      onPick({ publicId, title: s.name });
    } catch (e: any) { Alert.alert('Could not add the song', String(e?.message || '')); }
    setWorking(null);
  };

  const fromPhone = async () => {
    stopPreview();
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const info = await FileSystem.getInfoAsync(a.uri);
      const mb = info.exists && 'size' in info ? (info.size as number) / 1024 / 1024 : 0;
      if (mb > MAX_SONG_MB) return Alert.alert('Song too large', `This file is ${mb.toFixed(1)}MB. The limit is ${MAX_SONG_MB}MB.`);
      const title = (a.name || 'My song').replace(/\.[^.]+$/, '');
      setWorking(`Getting “${title}” ready…`);
      const ext = (a.name || '').split('.').pop()?.toLowerCase();
      const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'aac' ? 'audio/aac' : ext === 'wav' ? 'audio/wav' : 'audio/mp4';
      const publicId = await putOnCloudinary({ uri: a.uri, type, name: a.name || `song_${Date.now()}.${ext || 'm4a'}` });
      onPick({ publicId, title });
    } catch (e: any) { Alert.alert('Could not add the song', String(e?.message || '')); }
    setWorking(null);
  };

  return (
    <View style={st.overlay}>
      <View style={st.head}>
        <TouchableOpacity onPress={() => { stopPreview(); onClose(); }} disabled={!!working} style={st.back}>
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={st.title}>Add a song</Text>
        <View style={{ width: 40 }} />
      </View>

      {working ? (
        <View style={st.center}>
          <ActivityIndicator color={ACCENT} />
          <Text style={st.hint}>{working}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
          <TouchableOpacity style={st.phoneBtn} onPress={fromPhone}>
            <Ionicons name="phone-portrait-outline" size={18} color="#000" />
            <Text style={st.phoneTxt}>  From my phone</Text>
          </TouchableOpacity>

          <Text style={st.cap}>🔥 Trending</Text>
          {sounds === null ? (
            <ActivityIndicator color="#ffd700" style={{ marginTop: 20 }} />
          ) : sounds.length === 0 ? (
            <Text style={st.hint}>No trending sounds yet. You can still use a song from your phone.</Text>
          ) : (
            sounds.map(s => (
              <View key={s.id} style={st.row}>
                <TouchableOpacity style={st.playBtn} onPress={() => preview(s)}>
                  <Ionicons name={playingId === s.id ? 'pause' : 'play'} size={18} color={ACCENT} />
                </TouchableOpacity>
                <TouchableOpacity style={{ flex: 1 }} onPress={() => choose(s)}>
                  <Text style={st.name} numberOfLines={1}>{s.name}</Text>
                  <Text style={st.artist} numberOfLines={1}>{s.artist} · {(s.uses_count ?? 0).toLocaleString()} uses</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.useBtn} onPress={() => choose(s)}><Text style={st.useTxt}>Use</Text></TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050b09', zIndex: 50 },
  head: { paddingTop: 44, paddingHorizontal: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  hint: { color: '#7f958c', fontSize: 13, textAlign: 'center', marginTop: 10 },
  phoneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14, marginBottom: 18 },
  phoneTxt: { color: '#000', fontSize: 15, fontWeight: '800' },
  cap: { color: '#9bb0a8', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b1512', borderRadius: 12, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: 'rgba(0,255,136,0.18)', gap: 10 },
  playBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ACCENT },
  name: { color: '#fff', fontSize: 14, fontWeight: '700' },
  artist: { color: '#7f958c', fontSize: 11, marginTop: 2 },
  useBtn: { backgroundColor: 'rgba(0,255,136,0.15)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  useTxt: { color: ACCENT, fontSize: 13, fontWeight: '800' },
});
