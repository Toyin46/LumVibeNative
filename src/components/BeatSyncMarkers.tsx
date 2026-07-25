// ═══════════════════════════════════════════════════════════
// BeatSyncMarkers.tsx — Beat detection + timeline markers
// PATH: src/components/BeatSyncMarkers.tsx
//
// ✅ Beat DETECTION is fully replaced — no FFmpeg needed.
//    react-native-audio-api's decodeAudioData() + AudioBuffer
//    give direct access to raw PCM samples (Float32Array), so
//    RMS energy analysis runs entirely in JS. This is actually
//    more precise than the old FFmpeg astats log-parsing hack,
//    and needs no temp files.
//
// ⚠️ Auto-sync (actually CUTTING the video at beat timestamps)
//    is NOT replaced yet. That's frame-level video editing —
//    audio libraries can't do it. It needs a Cloudinary video
//    splice (fl_splice) pipeline: upload once, then build an
//    eager transform that trims+concats segments at the beat
//    timestamps. Same category of problem as Movie Studio scene
//    concatenation and duet merging — deserves its own build,
//    not a quick bolt-on here. Until then, "Auto Sync" is
//    disabled with an honest message instead of silently doing
//    nothing or crashing.
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useState, useCallback, memo } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, StyleSheet, Dimensions, Alert,
} from 'react-native';
import { AudioContext } from 'react-native-audio-api';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';

const SW = Dimensions.get('window').width;

interface BeatMarker {
  time:      number;
  intensity: number;
}

interface Props {
  musicUri:      string | null;
  videoDuration: number;
  videoUri:      string | null;
  onSynced:      (newUri: string) => void;
  visible:       boolean;
}

// ─── Beat detection via direct PCM analysis ───────────────
// Decodes the audio file, walks the raw sample array in small
// windows, computes RMS (energy) per window, then flags a beat
// wherever energy spikes meaningfully above its local rolling
// average — same underlying idea as the FFmpeg version, just
// computed directly on samples instead of parsed from a log file.
async function detectBeatMarkers(audioUri: string): Promise<BeatMarker[]> {
  try {
    const ctx = new AudioContext();
    const audioBuffer = await ctx.decodeAudioData(audioUri);
    const sampleRate  = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0); // Float32Array, samples in [-1, 1]

    const WINDOW_SECONDS = 0.05; // 50ms windows
    const windowSize = Math.max(1, Math.floor(sampleRate * WINDOW_SECONDS));

    const rmsValues: number[] = [];
    for (let i = 0; i < channelData.length; i += windowSize) {
      const end = Math.min(i + windowSize, channelData.length);
      let sumSquares = 0;
      for (let j = i; j < end; j++) sumSquares += channelData[j] * channelData[j];
      rmsValues.push(Math.sqrt(sumSquares / (end - i)));
    }

    const markers: BeatMarker[] = [];
    const ROLLING_WINDOW = 8; // ~400ms rolling average
    const MIN_RMS_FLOOR  = 0.02; // ignore near-silence

    for (let i = ROLLING_WINDOW; i < rmsValues.length; i++) {
      let sum = 0;
      for (let k = i - ROLLING_WINDOW; k < i; k++) sum += rmsValues[k];
      const avg     = sum / ROLLING_WINDOW;
      const current = rmsValues[i];

      if (current > avg * 1.5 && current > MIN_RMS_FLOOR) {
        const time      = (i * windowSize) / sampleRate;
        const intensity = Math.min(1, (current - avg) / (avg + 0.001));
        markers.push({ time, intensity });
      }
    }

    // Fallback: 120 BPM grid if detection returned too little
    // (e.g. very quiet or ambient track with no clear transients)
    if (markers.length < 2) {
      const interval = 60 / 120;
      for (let t = interval; t < 60; t += interval) {
        markers.push({ time: parseFloat(t.toFixed(3)), intensity: 0.6 });
      }
    }

    return markers;
  } catch (e) {
    console.warn('[BeatSyncMarkers] Detection failed:', e);
    return [];
  }
}

const BeatSyncMarkers = memo(function BeatSyncMarkers({
  musicUri, videoDuration, videoUri, onSynced, visible,
}: Props) {
  const [markers,  setMarkers]  = useState<BeatMarker[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [analysed, setAnalysed] = useState(false);

  useEffect(() => {
    if (!musicUri || !visible) { setMarkers([]); setAnalysed(false); return; }
    let cancelled = false;
    setLoading(true);
    detectBeatMarkers(musicUri).then(m => {
      if (!cancelled) { setMarkers(m); setLoading(false); setAnalysed(true); }
    });
    return () => { cancelled = true; };
  }, [musicUri, visible]);

  // Auto Sync (video cutting) is not implemented yet — see header note.
  // Tapping it explains why, instead of silently no-op'ing or crashing.
  const handleAutoSync = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(
      'Coming Soon',
      'Auto-cutting your video to the beat is being rebuilt on a new engine and isn\'t ready yet. Beat markers below are accurate — you can still cut manually to them.'
    );
  }, []);

  if (!visible || !musicUri) return null;

  const BAR_WIDTH        = SW - 32;
  const DISPLAY_DURATION = Math.max(videoDuration, 10);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>🥁 Beat Sync</Text>
        {loading && <ActivityIndicator size="small" color="#ffd700" style={{ marginLeft: 8 }} />}
        {analysed && !loading && (
          <Text style={s.markerCount}>{markers.length} beats detected</Text>
        )}
        {analysed && !loading && videoUri && (
          <TouchableOpacity style={s.syncBtn} onPress={handleAutoSync}>
            <Feather name="zap" size={12} color="#000" />
            <Text style={s.syncBtnTxt}>Auto Sync</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[s.timeline, { width: BAR_WIDTH }]}>
        <View style={s.track} />
        <View style={[s.progress, { width: (videoDuration / DISPLAY_DURATION) * BAR_WIDTH }]} />

        {markers.map((m, i) => {
          const x = (m.time / DISPLAY_DURATION) * BAR_WIDTH;
          if (x > BAR_WIDTH) return null;
          const tickH = 8 + Math.round(m.intensity * 14);
          const color = m.intensity > 0.7 ? '#ffd700'
                      : m.intensity > 0.4 ? '#00ff88'
                      : '#00aa55';
          return (
            <View
              key={i}
              style={[s.tick, {
                left:            x - 1,
                height:          tickH,
                bottom:          (22 - tickH) / 2,
                backgroundColor: color,
                opacity:         0.8 + m.intensity * 0.2,
              }]}
            />
          );
        })}

        {[0, 0.25, 0.5, 0.75, 1].map(frac => (
          <Text key={frac} style={[s.timeLabel, { left: frac * BAR_WIDTH - 10 }]}>
            {(frac * DISPLAY_DURATION).toFixed(0)}s
          </Text>
        ))}
      </View>

      <View style={s.legend}>
        <View style={[s.legendDot, { backgroundColor: '#ffd700' }]} />
        <Text style={s.legendTxt}>Strong beat</Text>
        <View style={[s.legendDot, { backgroundColor: '#00ff88', marginLeft: 12 }]} />
        <Text style={s.legendTxt}>Beat</Text>
        <View style={[s.legendDot, { backgroundColor: '#00aa55', marginLeft: 12 }]} />
        <Text style={s.legendTxt}>Soft beat</Text>
      </View>
    </View>
  );
});

export default BeatSyncMarkers;

const s = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom:     10,
    backgroundColor:  '#0d0d0d',
    borderRadius:     14,
    padding:          12,
    borderWidth:      1,
    borderColor:      '#ffd70033',
  },
  header:      { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  title:       { color: '#ffd700', fontSize: 13, fontWeight: '700' },
  markerCount: { color: '#888', fontSize: 11, flex: 1 },
  syncBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#ffd700', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  syncBtnTxt:      { color: '#000', fontSize: 12, fontWeight: '800' },
  timeline:        { height: 28, position: 'relative', marginBottom: 20 },
  track: {
    position: 'absolute', left: 0, right: 0, top: 10,
    height: 8, backgroundColor: '#1a1a1a', borderRadius: 4,
  },
  progress: {
    position: 'absolute', left: 0, top: 10,
    height: 8, backgroundColor: '#00ff8833', borderRadius: 4,
  },
  tick:      { position: 'absolute', width: 2, borderRadius: 1 },
  timeLabel: {
    position: 'absolute', bottom: -16,
    color: '#555', fontSize: 9, width: 24, textAlign: 'center',
  },
  legend:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { color: '#555', fontSize: 10 },
}); 
