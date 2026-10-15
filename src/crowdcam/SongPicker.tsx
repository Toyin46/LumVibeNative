// ─────────────────────────────────────────────────────────────
// src/crowdcam/SongPicker.tsx   (REPLACES the earlier version)
// "Add a song" for the host:
//   1) choose a song: Trending list (Supabase `trending_sounds`) or From my phone
//   2) TRIM it: drag the two handles (or tap the -/+ buttons) to pick the part you want,
//      e.g. 0:56 to 1:03, and tap Listen to hear exactly that part
//   3) "Use this part" puts the song on Cloudinary (if it is not there yet) and hands back
//      { publicId, title, startSec, endSec, ... }. Only that part plays under the film,
//      and the film is as long as that part (max `maxSec`).
// It is a plain overlay (not a second <Modal>) so it works on top of Crowd Cam on iOS too.
// ─────────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, StyleSheet, Alert, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { supabase } from '../config/supabase';
import { CROWD_CLOUD_NAME } from './crowdCamApi';

const UPLOAD_PRESET = 'Kinsta_unsigned';   // same unsigned preset create.tsx uses
const MAX_SONG_MB = 15;                    // same limit as Compose
const MIN_PART_SEC = 3;                    // shortest part you can pick
const ACCENT = '#00ff88';

export interface PickedSong {
  publicId: string;
  title?: string;
  /** the part of the song to use, in seconds into the song */
  startSec?: number;
  endSec?: number;
  durationSec?: number;
  /** where to listen to it again when the host taps "Change part" */
  previewUri?: string;
}
interface Sound { id: string; name: string; artist: string; url: string; uses_count: number }
type UploadFile = string | { uri: string; type: string; name: string };
interface Source { uri: string; title: string; publicId: string | null; file: UploadFile }

/** 56 -> "0:56", 63.5 -> "1:03.5" */
export function fmtTime(sec: number): string {
  const t = Math.max(0, Math.round(sec * 2) / 2);
  const m = Math.floor(t / 60);
  const r = t - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)}`;
}

/** if the url is already a plain Cloudinary video/audio of OUR cloud, reuse it instead of uploading again */
function cloudinaryIdOf(url: string): string | null {
  const m = url.match(new RegExp(`^https://res\\.cloudinary\\.com/${CROWD_CLOUD_NAME}/video/upload/(?:v\\d+/)?([^?#]+?)\\.[A-Za-z0-9]{2,4}(?:[?#].*)?$`));
  return m && !m[1].includes(',') ? decodeURIComponent(m[1]) : null; // a "," means it has transformations: do not guess
}

async function putOnCloudinary(file: UploadFile): Promise<string> {
  const fd = new FormData();
  fd.append('file', file as any);
  fd.append('upload_preset', UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CROWD_CLOUD_NAME}/video/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Could not upload the song (${res.status})`);
  const j = await res.json();
  if (!j.public_id) throw new Error('Could not upload the song');
  return j.public_id as string;
}

// ═════════════════════════════════════════════════════════════
//  TRIMMER: listen, drag the handles, pick the part
// ═════════════════════════════════════════════════════════════
function Trimmer(props: {
  source: Source;
  maxSec: number;
  initStart?: number;
  initEnd?: number;
  onCancel: () => void;
  onConfirm: (r: { startSec: number; endSec: number; durationSec: number }) => void;
}) {
  const { source, maxSec, initStart, initEnd, onCancel, onConfirm } = props;
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [trackW, setTrackW] = useState(0);

  // the pan gestures live outside React's render, so they read the latest values from refs
  const player = useRef<AudioPlayer | null>(null);
  const durRef = useRef(0), startRef = useRef(0), endRef = useRef(0), wRef = useRef(0), xRef = useRef(0);
  const dragging = useRef<'start' | 'end' | null>(null);
  const playingRef = useRef(false);
  const trackRef = useRef<View>(null);
  const minPart = () => Math.min(MIN_PART_SEC, durRef.current || MIN_PART_SEC);
  const snap = (t: number) => Math.round(t * 2) / 2;

  const pause = () => { try { player.current?.pause(); } catch { /* gone */ } playingRef.current = false; setPlaying(false); };

  const moveStart = (t: number) => {
    let v = snap(t);
    v = Math.min(v, endRef.current - minPart());
    v = Math.max(v, endRef.current - maxSec, 0);
    startRef.current = v; setStart(v);
  };
  const moveEnd = (t: number) => {
    let v = snap(t);
    v = Math.max(v, startRef.current + minPart());
    v = Math.min(v, startRef.current + maxSec, durRef.current);
    endRef.current = v; setEnd(v);
  };

  // load the song and keep an eye on it (length, play position, stop at the end of the part)
  useEffect(() => {
    let alive = true;
    let p: AudioPlayer | null = null;
    try { p = createAudioPlayer({ uri: source.uri } as any); player.current = p; } catch { setFailed(true); }
    const started = Date.now();
    const timer = setInterval(() => {
      const pl = player.current;
      if (!alive || !pl) return;
      const d = pl.duration;
      if (d > 0 && durRef.current === 0) {
        durRef.current = d; setDuration(d);
        const s0 = Math.min(Math.max(0, initStart ?? 0), Math.max(0, d - Math.min(MIN_PART_SEC, d)));
        const e0 = Math.min(d, initEnd && initEnd > s0 ? initEnd : s0 + maxSec);
        startRef.current = s0; endRef.current = e0; setStart(s0); setEnd(e0);
      } else if (durRef.current === 0 && Date.now() - started > 15000) {
        setFailed(true);
      }
      if (durRef.current > 0) {
        setPos(pl.currentTime);
        if (playingRef.current && pl.currentTime >= endRef.current - 0.05) {
          try { pl.pause(); pl.seekTo(startRef.current); } catch { /* ignore */ }
          playingRef.current = false; setPlaying(false);
        }
      }
    }, 120);
    return () => {
      alive = false; clearInterval(timer);
      try { p?.pause(); p?.remove(); } catch { /* already gone */ }
      player.current = null;
    };
  }, [source.uri]);

  const listen = async () => {
    const pl = player.current;
    if (!pl || !durRef.current) return;
    if (playingRef.current) return pause();
    try { await pl.seekTo(startRef.current); pl.play(); playingRef.current = true; setPlaying(true); }
    catch { Alert.alert('Could not play', 'This song could not be played.'); }
  };

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => durRef.current > 0,
    onMoveShouldSetPanResponder: () => durRef.current > 0,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_e, g) => {
      pause();
      trackRef.current?.measureInWindow((x) => { xRef.current = x; });
      // grab the handle that is closest to the finger
      const w = wRef.current || 1;
      const x = g.x0 - xRef.current;
      const sPx = (startRef.current / durRef.current) * w, ePx = (endRef.current / durRef.current) * w;
      dragging.current = Math.abs(x - sPx) <= Math.abs(x - ePx) ? 'start' : 'end';
    },
    onPanResponderMove: (_e, g) => {
      const w = wRef.current || 1;
      const t = Math.max(0, Math.min(durRef.current, ((g.moveX - xRef.current) / w) * durRef.current));
      if (dragging.current === 'start') moveStart(t); else if (dragging.current === 'end') moveEnd(t);
    },
    onPanResponderRelease: () => { dragging.current = null; },
  })).current;

  const nudge = (which: 'start' | 'end', delta: number) => {
    pause();
    if (which === 'start') moveStart(startRef.current + delta); else moveEnd(endRef.current + delta);
  };

  const w = trackW || 1;
  const px = (t: number) => (duration > 0 ? (t / duration) * w : 0);
  const partLen = Math.max(0, end - start);

  if (failed) {
    return (
      <View style={st.center}>
        <Text style={st.hint}>This song could not be loaded. Check your internet, or pick another song.</Text>
        <TouchableOpacity style={st.ghostBtn} onPress={onCancel}><Text style={st.ghostTxt}>Back</Text></TouchableOpacity>
      </View>
    );
  }
  if (!duration) {
    return (
      <View style={st.center}>
        <ActivityIndicator color={ACCENT} />
        <Text style={st.hint}>Loading “{source.title}”…</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={st.songTitle} numberOfLines={2}>{source.title}</Text>
      <Text style={st.hint}>Drag the green handles to pick the part you want. The film will be as long as that part (up to {maxSec}s).</Text>

      <View style={st.timesRow}>
        <Text style={st.timeTxt}>{fmtTime(start)}</Text>
        <Text style={st.lenTxt}>{Math.round(partLen * 10) / 10}s part</Text>
        <Text style={st.timeTxt}>{fmtTime(end)}</Text>
      </View>

      <View
        ref={trackRef}
        style={st.track}
        onLayout={(e) => {
          const wd = e.nativeEvent.layout.width; wRef.current = wd; setTrackW(wd);
          trackRef.current?.measureInWindow((x) => { xRef.current = x; });
        }}
        {...pan.panHandlers}
      >
        <View style={st.trackBar} />
        <View style={[st.sel, { left: px(start), width: Math.max(2, px(end) - px(start)) }]} />
        {pos >= start && pos <= end ? <View style={[st.playhead, { left: px(pos) }]} /> : null}
        <View style={[st.handle, { left: px(start) - 14 }]} />
        <View style={[st.handle, { left: px(end) - 14 }]} />
      </View>
      <View style={st.timesRow}>
        <Text style={st.faint}>0:00</Text>
        <Text style={st.faint}>{fmtTime(duration)}</Text>
      </View>

      <View style={st.nudgeRow}>
        <View style={st.nudgeBox}>
          <Text style={st.nudgeCap}>Start</Text>
          <View style={st.nudgeBtns}>
            <TouchableOpacity style={st.nudge} onPress={() => nudge('start', -1)}><Text style={st.nudgeTxt}>−1s</Text></TouchableOpacity>
            <TouchableOpacity style={st.nudge} onPress={() => nudge('start', 1)}><Text style={st.nudgeTxt}>+1s</Text></TouchableOpacity>
          </View>
        </View>
        <View style={st.nudgeBox}>
          <Text style={st.nudgeCap}>End</Text>
          <View style={st.nudgeBtns}>
            <TouchableOpacity style={st.nudge} onPress={() => nudge('end', -1)}><Text style={st.nudgeTxt}>−1s</Text></TouchableOpacity>
            <TouchableOpacity style={st.nudge} onPress={() => nudge('end', 1)}><Text style={st.nudgeTxt}>+1s</Text></TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity style={st.listenBtn} onPress={listen}>
        <Ionicons name={playing ? 'pause' : 'play'} size={20} color={ACCENT} />
        <Text style={st.listenTxt}>  {playing ? 'Stop' : 'Listen to this part'}</Text>
      </TouchableOpacity>

      <View style={{ flex: 1 }} />
      <TouchableOpacity style={st.useBtnBig} onPress={() => { pause(); onConfirm({ startSec: start, endSec: end, durationSec: duration }); }}>
        <Text style={st.useBigTxt}>Use this part</Text>
      </TouchableOpacity>
      <TouchableOpacity style={st.ghostBtn} onPress={() => { pause(); onCancel(); }}>
        <Text style={st.ghostTxt}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ═════════════════════════════════════════════════════════════
//  THE PICKER (list -> trim)
// ═════════════════════════════════════════════════════════════
export default function SongPicker(props: {
  visible: boolean;
  onClose: () => void;
  onPick: (s: PickedSong) => void;
  /** longest part the host may pick (seconds). Crowd Cam passes its film length limit. */
  maxSec?: number;
  /** set when the host taps "Change part": opens the trim screen straight away for this song */
  editSong?: PickedSong | null;
}) {
  const { visible, onClose, onPick, maxSec = 45, editSong } = props;
  const [sounds, setSounds] = useState<Sound[] | null>(null);
  const [working, setWorking] = useState<string | null>(null);   // text shown while a song is being prepared
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);     // song being trimmed
  const player = useRef<AudioPlayer | null>(null);

  const stopPreview = () => {
    try { player.current?.pause(); player.current?.remove(); } catch { /* already gone */ }
    player.current = null;
    setPlayingId(null);
  };

  useEffect(() => {
    if (!visible) { stopPreview(); setSource(null); return; }
    if (editSong?.previewUri) {
      setSource({ uri: editSong.previewUri, title: editSong.title || 'Your song', publicId: editSong.publicId, file: editSong.previewUri });
    } else {
      setSource(null);
    }
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

  // choosing a song opens the trim screen (nothing is uploaded yet)
  const choose = (s: Sound) => {
    stopPreview();
    setSource({ uri: s.url, title: s.name, publicId: cloudinaryIdOf(s.url), file: s.url });
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
      const ext = (a.name || '').split('.').pop()?.toLowerCase();
      const type = ext === 'mp3' ? 'audio/mpeg' : ext === 'aac' ? 'audio/aac' : ext === 'wav' ? 'audio/wav' : 'audio/mp4';
      setSource({ uri: a.uri, title, publicId: null, file: { uri: a.uri, type, name: a.name || `song_${Date.now()}.${ext || 'm4a'}` } });
    } catch (e: any) { Alert.alert('Could not open the song', String(e?.message || '')); }
  };

  // "Use this part": upload the song now if it is not on Cloudinary yet, then hand it back
  const confirmPart = async (r: { startSec: number; endSec: number; durationSec: number }) => {
    if (!source) return;
    setWorking(`Getting “${source.title}” ready…`);
    try {
      const publicId = source.publicId ?? (await putOnCloudinary(source.file)); // Cloudinary fetches a url itself
      setSource({ ...source, publicId });
      onPick({ publicId, title: source.title, startSec: r.startSec, endSec: r.endSec, durationSec: r.durationSec, previewUri: source.uri });
    } catch (e: any) { Alert.alert('Could not add the song', String(e?.message || '')); }
    setWorking(null);
  };

  const backFromTrim = () => { if (editSong) onClose(); else setSource(null); };

  return (
    <View style={st.overlay}>
      <View style={st.head}>
        <TouchableOpacity onPress={() => { stopPreview(); if (source) backFromTrim(); else onClose(); }} disabled={!!working} style={st.back}>
          <Ionicons name={source ? 'chevron-back' : 'chevron-down'} size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={st.title}>{source ? 'Pick the part' : 'Add a song'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {source ? (
        <Trimmer
          key={source.uri}
          source={source}
          maxSec={maxSec}
          initStart={editSong?.startSec}
          initEnd={editSong?.endSec}
          onCancel={backFromTrim}
          onConfirm={confirmPart}
        />
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
                <TouchableOpacity style={st.useBtn} onPress={() => choose(s)}><Text style={st.useTxt}>Pick part</Text></TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      {working ? (
        <View style={st.workingCover}>
          <ActivityIndicator color={ACCENT} />
          <Text style={st.hint}>{working}</Text>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: '#050b09', zIndex: 50 },
  workingCover: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,11,9,0.92)', alignItems: 'center', justifyContent: 'center', padding: 30 },
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
  useBtn: { backgroundColor: 'rgba(0,255,136,0.15)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  useTxt: { color: ACCENT, fontSize: 13, fontWeight: '800' },

  // trimmer
  songTitle: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  timesRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  timeTxt: { color: ACCENT, fontSize: 20, fontWeight: '800' },
  lenTxt: { color: '#9bb0a8', fontSize: 13, fontWeight: '700' },
  faint: { color: '#5c6f68', fontSize: 11 },
  track: { height: 56, marginTop: 6, justifyContent: 'center' },
  trackBar: { position: 'absolute', left: 0, right: 0, height: 10, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.12)' },
  sel: { position: 'absolute', height: 10, borderRadius: 5, backgroundColor: ACCENT },
  playhead: { position: 'absolute', width: 2, height: 26, backgroundColor: '#fff' },
  handle: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 3, borderColor: ACCENT },
  nudgeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 12 },
  nudgeBox: { flex: 1, backgroundColor: '#0b1512', borderRadius: 12, padding: 10, borderWidth: 1, borderColor: 'rgba(0,255,136,0.18)' },
  nudgeCap: { color: '#9bb0a8', fontSize: 12, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
  nudgeBtns: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  nudge: { backgroundColor: 'rgba(0,255,136,0.15)', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  nudgeTxt: { color: ACCENT, fontSize: 14, fontWeight: '800' },
  listenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ACCENT, borderRadius: 14, paddingVertical: 14, marginTop: 18 },
  listenTxt: { color: ACCENT, fontSize: 15, fontWeight: '800' },
  useBtnBig: { backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  useBigTxt: { color: '#000', fontSize: 16, fontWeight: '800' },
  ghostBtn: { alignItems: 'center', paddingVertical: 14 },
  ghostTxt: { color: '#9bb0a8', fontSize: 14, fontWeight: '700' },
});
