// ═══════════════════════════════════════════════════════════
// CameraScreen.tsx — Camera recording with AR/effects
// Handles video/photo capture, AR overlays, filters,
// animated backgrounds, effect bursts, dual cam stub.
// ═══════════════════════════════════════════════════════════

import React, {
  useRef, useState, useCallback, useEffect,
} from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, Platform, Alert, ScrollView, Animated,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';

import AROverlay          from '../../components/ar/AROverlay';
import AnimatedBackground from '../../components/ar/AnimatedBackground';
import EffectBurstOverlay from '../../components/ar/EffectBurstOverlay';

import {
  AR_EFFECTS, ANIMATED_BACKGROUNDS,
  FILTERS, FX_EFFECTS, SPEED_OPTIONS,
  VIBE_TYPES,
}                         from '../../utils/constants';
import type {
  CameraMode, FacingMode, FlashMode,
  AREffect, FilterDef, FxEffect, Draft,
}                         from '../../utils/types';

const { height: SH } = Dimensions.get('window');
const MAX_VIDEO_SECS = 180;

interface Props {
  onMediaCaptured:  (uri: string, type: 'video' | 'image') => void;
  onOpenDrafts:     () => void;
  onOpenStudio:     () => void;
  onOpenMovie:      () => void;
  onOpenVibeShift:  () => void;
  draft?:           Draft | null;
}

export default function CameraScreen({
  onMediaCaptured, onOpenDrafts, onOpenStudio, onOpenMovie,
  onOpenVibeShift, draft,
}: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [facing,          setFacing]          = useState<FacingMode>('front');
  const [flash,           setFlash]           = useState<FlashMode>('off');
  const [cameraMode,      setCameraMode]      = useState<CameraMode>('video');
  const [isRecording,     setIsRecording]     = useState(false);
  const [recordSecs,      setRecordSecs]      = useState(0);
  const [selectedAR,      setSelectedAR]      = useState<AREffect>(AR_EFFECTS[0]);
  const [selectedFilter,  setSelectedFilter]  = useState<FilterDef>(FILTERS[0]);
  const [selectedFx,      setSelectedFx]      = useState<FxEffect>(FX_EFFECTS[0]);
  const [selectedBgId,    setSelectedBgId]    = useState<string>('none');
  const [selectedSpeedId, setSelectedSpeedId] = useState<string>('1x');
  const [selectedVibe,    setSelectedVibe]    = useState<string | null>(null);
  const [burstTrigger,    setBurstTrigger]    = useState(false);
  const [showARPanel,     setShowARPanel]     = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [showBgPanel,     setShowBgPanel]     = useState(false);
  const [showVibePanel,   setShowVibePanel]   = useState(false);

  // Suppress unused variable warnings for state setters not yet wired to UI
  void selectedFx; void setSelectedFx;
  void showARPanel; void showFilterPanel; void showBgPanel; void showVibePanel;
  void setShowARPanel; void setShowFilterPanel; void setShowBgPanel; void setShowVibePanel;
  void draft;

  const cameraRef    = useRef<any>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  // ── Permission check ──
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  // ── Timer ──
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setRecordSecs(s => {
          if (s >= MAX_VIDEO_SECS - 1) {
            stopRecording();
            return s;
          }
          return s + 1;
        });
      }, 1000);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: MAX_VIDEO_SECS * 1000,
        useNativeDriver: false,
      }).start();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      progressAnim.setValue(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRecording]);

  // ── Start recording ──
  const startRecording = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      setRecordSecs(0);
      setIsRecording(true);
      setBurstTrigger(true);
      setTimeout(() => setBurstTrigger(false), 1200);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      cameraRef.current.startRecording({
        flash: flash === 'on' ? 'on' : 'off',
        onRecordingFinished: (video: { path: string }) => {
          setIsRecording(false);
          setRecordSecs(0);
          onMediaCaptured(video.path, 'video');
        },
        onRecordingError: (err: { message: string }) => {
          setIsRecording(false);
          setRecordSecs(0);
          Alert.alert('Recording Error', err.message);
        },
      });
    } catch (err: unknown) {
      setIsRecording(false);
      Alert.alert('Cannot record', 'Camera error. Please try again.');
    }
  }, [flash, onMediaCaptured]);

  // ── Stop recording ──
  const stopRecording = useCallback(async () => {
    if (!isRecording || !cameraRef.current) return;
    try {
      await cameraRef.current.stopRecording();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch {
      setIsRecording(false);
    }
  }, [isRecording]);

  // ── Take photo ──
  const takePhoto = useCallback(async () => {
    if (!cameraRef.current) return;
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const photo = await cameraRef.current.takePhoto({
        flash: flash === 'on' ? 'on' : 'off',
      });
      onMediaCaptured(photo.path, 'image');
    } catch {
      Alert.alert('Error', 'Could not take photo.');
    }
  }, [flash, onMediaCaptured]);

  // ── Flip camera ──
  function flipCamera() {
    setFacing(f => f === 'front' ? 'back' : 'front');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // ── Format time ──
  function formatSecs(s: number): string {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  }

  const device = useCameraDevice(facing);

  if (!hasPermission) {
    return (
      <View style={styles.permContainer}>
        <Text style={styles.permText}>Camera access is required to record.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permContainer}>
        <Text style={styles.permText}>No camera device found.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* Camera */}
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
      />

      {/* Animated background */}
      {selectedBgId !== 'none' && (
        <AnimatedBackground backgroundId={selectedBgId} intensity={0.45} />
      )}

      {/* Filter tint overlay */}
      {selectedFilter.tintColor != null && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: selectedFilter.tintColor },
          ]}
          pointerEvents="none"
        />
      )}

      {/* AR overlay */}
      <AROverlay effect={selectedAR} />

      {/* Effect burst */}
      <EffectBurstOverlay trigger={burstTrigger} />

      {/* Cinematic bars */}
      {selectedFilter.cinematicBars && (
        <>
          <View style={styles.cinematicTop} pointerEvents="none" />
          <View style={styles.cinematicBottom} pointerEvents="none" />
        </>
      )}

      {/* Recording progress bar */}
      {isRecording && (
        <Animated.View
          style={[
            styles.progressBar,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      )}

      {/* Top controls */}
      <View style={styles.topControls}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => setFlash(f => f === 'off' ? 'on' : 'off')}
        >
          <Text style={styles.iconBtnText}>{flash === 'on' ? '⚡' : '🔦'}</Text>
        </TouchableOpacity>

        {isRecording ? (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{formatSecs(recordSecs)}</Text>
          </View>
        ) : (
          <View style={styles.modeSwitcher}>
            {(['video', 'picture'] as CameraMode[]).map(m => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, cameraMode === m && styles.modeBtnActive]}
                onPress={() => setCameraMode(m)}
              >
                <Text style={[styles.modeBtnText, cameraMode === m && styles.modeBtnTextActive]}>
                  {m === 'video' ? '🎬 Video' : '📷 Photo'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.iconBtn} onPress={flipCamera}>
          <Text style={styles.iconBtnText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomControls}>

        {/* Shortcut row — Studio, Movie, Vibe Shift, Drafts */}
        {!isRecording && (
          <View style={styles.shortcutRow}>
            <TouchableOpacity style={styles.shortcut} onPress={onOpenStudio}>
              <Text style={styles.shortcutEmoji}>🎚</Text>
              <Text style={styles.shortcutLabel}>Studio</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shortcut} onPress={onOpenMovie}>
              <Text style={styles.shortcutEmoji}>🎬</Text>
              <Text style={styles.shortcutLabel}>Movie</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shortcut} onPress={onOpenVibeShift}>
              <View style={styles.vibeShiftBadge}>
                <Text style={styles.shortcutEmoji}>✨</Text>
              </View>
              <Text style={[styles.shortcutLabel, styles.vibeShiftLabel]}>Vibe Shift</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shortcut} onPress={onOpenDrafts}>
              <Text style={styles.shortcutEmoji}>📝</Text>
              <Text style={styles.shortcutLabel}>Drafts</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Speed selector */}
        {!isRecording && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.speedRow}
          >
            {SPEED_OPTIONS.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.speedChip, selectedSpeedId === s.id && styles.speedChipActive]}
                onPress={() => setSelectedSpeedId(s.id)}
              >
                <Text style={[styles.speedText, selectedSpeedId === s.id && styles.speedTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Capture button */}
        <View style={styles.captureRow}>
          {cameraMode === 'video' ? (
            <TouchableOpacity
              style={[styles.captureBtn, isRecording && styles.captureBtnRecording]}
              onPress={isRecording ? stopRecording : startRecording}
            >
              <View style={[
                styles.captureInner,
                isRecording && styles.captureInnerRecording,
              ]} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.captureBtn}
              onPress={takePhoto}
            >
              <View style={styles.captureInner} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── PANELS ── */}

      {/* AR effects panel */}
      {showARPanel && !isRecording && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>✨ Effects</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {AR_EFFECTS.map(e => (
              <TouchableOpacity
                key={e.id}
                style={[styles.panelChip, selectedAR.id === e.id && styles.panelChipActive]}
                onPress={() => { setSelectedAR(e); setShowARPanel(false); }}
              >
                <Text style={styles.panelChipEmoji}>{e.emoji}</Text>
                <Text style={styles.panelChipName}>{e.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filter panel */}
      {showFilterPanel && !isRecording && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>🎨 Filters</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.id}
                style={[styles.panelChip, selectedFilter.id === f.id && styles.panelChipActive]}
                onPress={() => { setSelectedFilter(f); setShowFilterPanel(false); }}
              >
                <Text style={styles.panelChipEmoji}>{f.emoji}</Text>
                <Text style={styles.panelChipName}>{f.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Background panel */}
      {showBgPanel && !isRecording && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>🌈 Background</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {ANIMATED_BACKGROUNDS.map(bg => (
              <TouchableOpacity
                key={bg.id}
                style={[
                  styles.panelChip,
                  selectedBgId === bg.id && styles.panelChipActive,
                  bg.colors[0] ? { backgroundColor: bg.colors[0] + '33' } : {},
                ]}
                onPress={() => { setSelectedBgId(bg.id); setShowBgPanel(false); }}
              >
                <Text style={styles.panelChipName}>{bg.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Vibe panel */}
      {showVibePanel && !isRecording && (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>🎵 Vibe</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(Array.isArray(VIBE_TYPES) ? VIBE_TYPES as unknown as string[] : Object.keys(VIBE_TYPES)).map((v: string) => (
              <TouchableOpacity
                key={v}
                style={[styles.panelChip, selectedVibe === v && styles.panelChipActive]}
                onPress={() => { setSelectedVibe(v); setShowVibePanel(false); }}
              >
                <Text style={styles.panelChipName}>{v}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#000' },
  permContainer: { flex: 1, backgroundColor: '#0A0A1A', alignItems: 'center', justifyContent: 'center', padding: 24 },
  permText:      { color: '#FFF', fontSize: 16, textAlign: 'center', marginBottom: 20 },
  permBtn:       { backgroundColor: '#6B4FFF', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText:   { color: '#FFF', fontWeight: '700' },

  progressBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 3,
    backgroundColor: '#FF4040',
    zIndex: 10,
  },

  topControls: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 36,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
  },
  iconBtn:     { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  iconBtnText: { fontSize: 18 },

  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(200,0,0,0.8)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  recDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  recTime: { color: '#FFF', fontWeight: '800', fontSize: 14, fontVariant: ['tabular-nums'] },

  modeSwitcher: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 20,
    overflow: 'hidden',
  },
  modeBtn:           { paddingHorizontal: 14, paddingVertical: 7 },
  modeBtnActive:     { backgroundColor: '#FFF' },
  modeBtnText:       { color: '#FFF', fontSize: 12, fontWeight: '600' },
  modeBtnTextActive: { color: '#000' },

  bottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    zIndex: 5,
  },

  shortcutRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginBottom: 12,
  },
  shortcut:      { alignItems: 'center', gap: 3 },
  shortcutEmoji: { fontSize: 22 },
  shortcutLabel: { color: '#FFF', fontSize: 10, fontWeight: '600', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  vibeShiftBadge: {
    borderWidth: 1.5,
    borderColor: '#A78BFA',
    borderRadius: 10,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: 'rgba(107,79,255,0.15)',
  },
  vibeShiftLabel: {
    color: '#A78BFA',
  },

  speedRow:        { paddingHorizontal: 16, gap: 8, marginBottom: 14 },
  speedChip: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  speedChipActive: { backgroundColor: '#FFF' },
  speedText:       { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
  speedTextActive: { color: '#000' },

  captureRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  captureBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnRecording: { borderColor: '#FF4040' },
  captureInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF',
  },
  captureInnerRecording: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FF4040',
  },

  cinematicTop:    { position: 'absolute', top: 0, left: 0, right: 0, height: SH * 0.1, backgroundColor: '#000', zIndex: 2 } as object,
  cinematicBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: SH * 0.1, backgroundColor: '#000', zIndex: 2 } as object,

  panel: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 170 : 150,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,10,26,0.92)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    zIndex: 10,
  },
  panelTitle:      { color: '#FFF', fontWeight: '700', fontSize: 13, marginBottom: 10 },
  panelChip: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: 'center',
    minWidth: 70,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  panelChipActive: { borderColor: '#6B4FFF', backgroundColor: 'rgba(107,79,255,0.2)' },
  panelChipEmoji:  { fontSize: 20, marginBottom: 3 },
  panelChipName:   { color: '#EEE', fontSize: 10, fontWeight: '600' },
}); 
