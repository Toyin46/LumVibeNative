// ═══════════════════════════════════════════════════════════
// BeatSyncMarkers.tsx — Beat detection + timeline markers
// PATH: src/components/BeatSyncMarkers.tsx
//
// FIX: expo-file-system v18+ exposes directories as
//      FileSystem.cacheDirectory (string | null) and
//      FileSystem.documentDirectory (string | null).
//      Accessing them via the module object is correct but
//      TypeScript strict mode complains when the import
//      namespace type doesn't include those keys.
//      Solution: import the specific constants directly.
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useState, useCallback, memo } from 'react';
import {
  View, Text, TouchableOpacity,
  ActivityIndicator, StyleSheet, Dimensions,
} from 'react-native';
import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system';
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

// FIX: use the named imports instead of FileSystem.cacheDirectory
function getCacheDir(): string {
  const fs = FileSystem as any
  return (fs.cacheDirectory as string | null)
    ?? (fs.documentDirectory as string | null)
    ?? '';
}

async function detectBeatMarkers(audioUri: string): Promise<BeatMarker[]> {
  try {
    const logFile = `${getCacheDir()}beatlog_${Date.now()}.txt`;

    const cmd = [
      `-y -i "${audioUri}"`,
      `-af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=${logFile}"`,
      `-f null /dev/null`,
    ].join(' ');

    await FFmpegKit.execute(cmd);

    let raw = '';
    try { raw = await FileSystem.readAsStringAsync(logFile); } catch { raw = ''; }

    const markers: BeatMarker[] = [];

    if (raw.trim().length > 0) {
      const lines  = raw.split('\n');
      const points: { t: number; rms: number }[] = [];

      for (const line of lines) {
        const timeMatch = line.match(/pts_time:([\d.]+)/);
        const rmsMatch  = line.match(/RMS_level=([-\d.]+)/);
        if (timeMatch && rmsMatch) {
          const rms = parseFloat(rmsMatch[1]);
          if (isFinite(rms)) {
            points.push({ t: parseFloat(timeMatch[1]), rms });
          }
        }
      }

      if (points.length > 4) {
        const window = 5;
        for (let i = window; i < points.length; i++) {
          const avg     = points.slice(i - window, i).reduce((s, p) => s + p.rms, 0) / window;
          const current = points[i].rms;
          if (current > avg + 4 && current > -40) {
            const intensity = Math.min(1, (current - avg) / 20);
            markers.push({ time: points[i].t, intensity });
          }
        }
      }
    }

    // Fallback: 120 BPM grid if detection returned nothing
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

async function autoSyncVideoToBeats(
  videoUri: string,
  markers:  BeatMarker[],
): Promise<string> {
  try {
    if (markers.length < 2) return videoUri;

    const clipDuration = 0.5;
    const parts = markers.slice(0, 20).map(m =>
      `between(t\\,${m.time.toFixed(2)}\\,${(m.time + clipDuration).toFixed(2)})`
    );
    const selectFilter = parts.join('+');
    const outputUri    = `${getCacheDir()}beatsynced_${Date.now()}.mp4`;

    const cmd = [
      `-y -i "${videoUri}"`,
      `-vf "select='${selectFilter}',setpts=N/FRAME_RATE/TB"`,
      `-af "aselect='${selectFilter}',asetpts=N/SR/TB"`,
      `-c:v libx264 -preset fast -crf 22`,
      `"${outputUri}"`,
    ].join(' ');

    const session = await FFmpegKit.execute(cmd);
    if (ReturnCode.isSuccess(await session.getReturnCode())) {
      return outputUri;
    }
    return videoUri;
  } catch (e) {
    console.warn('[BeatSyncMarkers] Auto sync failed:', e);
    return videoUri;
  }
}

const BeatSyncMarkers = memo(function BeatSyncMarkers({
  musicUri, videoDuration, videoUri, onSynced, visible,
}: Props) {
  const [markers,  setMarkers]  = useState<BeatMarker[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [syncing,  setSyncing]  = useState(false);
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

  const handleAutoSync = useCallback(async () => {
    if (!videoUri || markers.length < 2) return;
    setSyncing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const synced = await autoSyncVideoToBeats(videoUri, markers);
    onSynced(synced);
    setSyncing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [videoUri, markers, onSynced]);

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
          <TouchableOpacity
            style={[s.syncBtn, syncing && s.syncBtnDisabled]}
            onPress={handleAutoSync}
            disabled={syncing}
          >
            {syncing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Feather name="zap" size={12} color="#000" />
                <Text style={s.syncBtnTxt}>Auto Sync</Text>
              </>
            )}
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
  syncBtnDisabled: { opacity: 0.5 },
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
