// ═══════════════════════════════════════════════════════════
// VibeShiftScreen.tsx
// PATH: src/screens/create/VibeShiftScreen.tsx
// Fixed: useRef<typeof Camera> instead of CameraType alias
//        AREffect cast, explicit callback types, no video/audio props
// ═══════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Animated, Dimensions, Platform,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as Haptics from 'expo-haptics';

import AROverlay          from '../../components/ar/AROverlay';
import EffectBurstOverlay from '../../components/ar/EffectBurstOverlay';
import { concatenateScenes } from '../../utils/ffmpegHelpers';
import { AR_EFFECTS }        from '../../utils/constants';
import type { AREffect }     from '../../utils/types';

const { width: SW, height: SH } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────
// VIBE SHIFT LOOKS — 24 cinematic transformation themes
// ─────────────────────────────────────────────────────────
export interface VibeShiftLook {
  id:            string;
  name:          string;
  emoji:         string;
  category:      'goddess' | 'dark' | 'afro' | 'fantasy';
  tintColor:     string;
  ffmpegFilter:  string;
  glowColor:     string;
  cinematicBars: boolean;
  arEffectId:    string;
  description:   string;
}

export const VIBE_SHIFT_LOOKS: VibeShiftLook[] = [
  // ── GODDESS
  { id: 'autumn_queen',   name: 'Autumn Queen',   emoji: '🍂', category: 'goddess', tintColor: 'rgba(200,80,0,0.22)',   ffmpegFilter: 'warm',      glowColor: '#FF6B00', cinematicBars: true,  arEffectId: 'ar_flowers',  description: 'Burnt orange warmth, fall goddess energy' },
  { id: 'jungle_empress', name: 'Jungle Empress', emoji: '🌿', category: 'goddess', tintColor: 'rgba(0,120,40,0.20)',   ffmpegFilter: 'cool',      glowColor: '#00C853', cinematicBars: true,  arEffectId: 'ar_flowers',  description: 'Deep emerald, nature deity vibes' },
  { id: 'solar_deity',    name: 'Solar Deity',    emoji: '☀️', category: 'goddess', tintColor: 'rgba(255,210,0,0.18)',  ffmpegFilter: 'golden',    glowColor: '#FFD700', cinematicBars: true,  arEffectId: 'ar_sunflower',description: 'Golden light, sun goddess awakening' },
  { id: 'ice_queen',      name: 'Ice Queen',      emoji: '❄️', category: 'goddess', tintColor: 'rgba(140,210,255,0.22)',ffmpegFilter: 'cool',      glowColor: '#80DFFF', cinematicBars: false, arEffectId: 'ar_stars',    description: 'Crystal blue frost, winter royalty' },
  { id: 'desert_siren',   name: 'Desert Siren',   emoji: '🏜️', category: 'goddess', tintColor: 'rgba(210,150,60,0.20)', ffmpegFilter: 'vintage',   glowColor: '#D4845A', cinematicBars: true,  arEffectId: 'ar_sparkle',  description: 'Sand-gold warmth, ancient desert power' },
  { id: 'ocean_goddess',  name: 'Ocean Goddess',  emoji: '🌊', category: 'goddess', tintColor: 'rgba(0,100,180,0.22)',  ffmpegFilter: 'cool',      glowColor: '#0099FF', cinematicBars: false, arEffectId: 'ar_sparkle',  description: 'Deep ocean hues, sea deity reborn' },
  // ── DARK
  { id: 'dia_de_muertos', name: 'Día de Muertos', emoji: '💀', category: 'dark',    tintColor: 'rgba(160,0,30,0.20)',   ffmpegFilter: 'dramatic',  glowColor: '#CC0033', cinematicBars: true,  arEffectId: 'ar_flowers',  description: 'Red roses & skull art — hauntingly beautiful' },
  { id: 'dark_angel',     name: 'Dark Angel',     emoji: '🖤', category: 'dark',    tintColor: 'rgba(80,0,120,0.25)',   ffmpegFilter: 'noir',      glowColor: '#9B00FF', cinematicBars: true,  arEffectId: 'ar_stars',    description: 'Violet darkness, fallen celestial' },
  { id: 'phantom',        name: 'Phantom',        emoji: '🎭', category: 'dark',    tintColor: 'rgba(20,20,40,0.30)',   ffmpegFilter: 'noir',      glowColor: '#FFFFFF', cinematicBars: true,  arEffectId: 'ar_sparkle',  description: 'Monochrome mystery, theatrical menace' },
  { id: 'noir_assassin',  name: 'Noir Assassin',  emoji: '🕶️', category: 'dark',    tintColor: 'rgba(0,0,0,0.35)',     ffmpegFilter: 'noir',      glowColor: '#444444', cinematicBars: true,  arEffectId: 'ar_glasses',  description: 'Pure black & white, spy-film tension' },
  { id: 'blood_moon',     name: 'Blood Moon',     emoji: '🌕', category: 'dark',    tintColor: 'rgba(180,20,0,0.28)',   ffmpegFilter: 'dramatic',  glowColor: '#FF2200', cinematicBars: true,  arEffectId: 'ar_fire',     description: 'Crimson eclipse, supernatural glow' },
  { id: 'shadow_queen',   name: 'Shadow Queen',   emoji: '👑', category: 'dark',    tintColor: 'rgba(50,0,80,0.28)',    ffmpegFilter: 'dramatic',  glowColor: '#7B00CC', cinematicBars: false, arEffectId: 'ar_crown',    description: 'Deep purple authority, unmatched power' },
  // ── AFRO
  { id: 'yoruba_royale',  name: 'Yoruba Royale',  emoji: '👘', category: 'afro',    tintColor: 'rgba(180,120,0,0.20)',  ffmpegFilter: 'golden',    glowColor: '#DAA520', cinematicBars: false, arEffectId: 'ar_crown',    description: 'Royal Yoruba gold, aso-oke elegance' },
  { id: 'ankara_queen',   name: 'Ankara Queen',   emoji: '🌺', category: 'afro',    tintColor: 'rgba(200,60,0,0.18)',   ffmpegFilter: 'warm',      glowColor: '#FF4500', cinematicBars: false, arEffectId: 'ar_flowers',  description: 'Vibrant Ankara print energy, bold & unapologetic' },
  { id: 'afro_warrior',   name: 'Afro Warrior',   emoji: '⚔️', category: 'afro',    tintColor: 'rgba(100,60,0,0.22)',   ffmpegFilter: 'vintage',   glowColor: '#8B4513', cinematicBars: true,  arEffectId: 'ar_fire',     description: 'Earth tones, ancient warrior strength' },
  { id: 'lagos_nights',   name: 'Lagos Nights',   emoji: '🌃', category: 'afro',    tintColor: 'rgba(0,20,80,0.28)',    ffmpegFilter: 'neon',      glowColor: '#0033FF', cinematicBars: false, arEffectId: 'ar_stars',    description: 'Night city neon, Lagos after dark' },
  { id: 'naija_gold',     name: 'Naija Gold',     emoji: '🇳🇬', category: 'afro',   tintColor: 'rgba(0,130,0,0.18)',    ffmpegFilter: 'golden',    glowColor: '#008000', cinematicBars: false, arEffectId: 'ar_sparkle',  description: 'Green & gold pride, Nigerian excellence' },
  { id: 'savanna_spirit', name: 'Savanna Spirit', emoji: '🦁', category: 'afro',    tintColor: 'rgba(190,140,40,0.22)', ffmpegFilter: 'sunset',    glowColor: '#CC8800', cinematicBars: true,  arEffectId: 'ar_sunflower',description: 'Warm savanna dusk, primal grace' },
  // ── FANTASY
  { id: 'liberty',        name: 'Lady Liberty',   emoji: '🗽', category: 'fantasy', tintColor: 'rgba(80,160,140,0.22)', ffmpegFilter: 'cool',      glowColor: '#40B8A0', cinematicBars: true,  arEffectId: 'ar_crown',    description: 'Verdigris tones, iconic living statue' },
  { id: 'celestial',      name: 'Celestial',      emoji: '🌌', category: 'fantasy', tintColor: 'rgba(40,0,120,0.25)',   ffmpegFilter: 'cinematic', glowColor: '#6600FF', cinematicBars: true,  arEffectId: 'ar_stars',    description: 'Galaxy deep purple, cosmic being' },
  { id: 'cyber_vibe',     name: 'Cyber Vibe',     emoji: '🤖', category: 'fantasy', tintColor: 'rgba(0,255,200,0.15)', ffmpegFilter: 'neon',      glowColor: '#00FFD0', cinematicBars: false, arEffectId: 'ar_glasses',  description: 'Matrix teal, cyberpunk identity' },
  { id: 'neon_tokyo',     name: 'Neon Tokyo',     emoji: '🏙️', category: 'fantasy', tintColor: 'rgba(255,0,150,0.20)', ffmpegFilter: 'neon',      glowColor: '#FF0099', cinematicBars: false, arEffectId: 'ar_neon',     description: 'Hot pink neon, anime street energy' },
  { id: 'golden_cinema',  name: 'Golden Cinema',  emoji: '🎬', category: 'fantasy', tintColor: 'rgba(200,160,40,0.18)',ffmpegFilter: 'cinematic', glowColor: '#FFB800', cinematicBars: true,  arEffectId: 'ar_sparkle',  description: 'Hollywood golden hour, cinematic prestige' },
  { id: 'storm_rider',    name: 'Storm Rider',    emoji: '⚡', category: 'fantasy', tintColor: 'rgba(100,160,255,0.22)',ffmpegFilter: 'dramatic',  glowColor: '#5599FF', cinematicBars: true,  arEffectId: 'ar_rainbow',  description: 'Electric blue storm, elemental energy' },
  { id: 'rose_myth',      name: 'Rose Myth',      emoji: '🌹', category: 'fantasy', tintColor: 'rgba(220,60,120,0.20)',ffmpegFilter: 'rose',      glowColor: '#FF3399', cinematicBars: false, arEffectId: 'ar_hearts',   description: 'Romantic rose gold, mythical lover' },
];

const CATEGORY_LABELS: Record<string, string> = {
  goddess: '✨ Goddess',
  dark:    '🖤 Dark',
  afro:    '🌍 Afro',
  fantasy: '🌌 Fantasy',
};

const MAX_CLIPS      = 6;
const MIN_CLIP_MS    = 1500;
const MAX_CLIP_MS    = 15000;
const COUNTDOWN_SECS = 3;

interface RecordedClip {
  uri:        string;
  lookId:     string;
  durationMs: number;
}

type VSView = 'look_select' | 'countdown' | 'recording' | 'review';

interface Props {
  userId:   string;
  username: string;
  onDone:   (stitchedUri: string) => void;
  onClose:  () => void;
}

export default function VibeShiftScreen({ userId, username, onDone, onClose }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [vsView,         setVsView]         = useState<VSView>('look_select');
  const [selectedLooks,  setSelectedLooks]  = useState<VibeShiftLook[]>([]);
  const [currentLookIdx, setCurrentLookIdx] = useState(0);
  const [recordedClips,  setRecordedClips]  = useState<RecordedClip[]>([]);
  const [isRecording,    setIsRecording]    = useState(false);
  const [recordMs,       setRecordMs]       = useState(0);
  const [countdown,      setCountdown]      = useState(COUNTDOWN_SECS);
  const [burstTrigger,   setBurstTrigger]   = useState(false);
  const [isStitching,    setIsStitching]    = useState(false);
  const [stitchProgress, setStitchProgress] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('goddess');
  const [facing,         setFacing]         = useState<'front' | 'back'>('front');

  // FIX: use InstanceType<typeof Camera> — avoids the 'value used as type' error
  const cameraRef    = useRef<any>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim    = useRef(new Animated.Value(1)).current;

  const device = useCameraDevice(facing);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, []);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const currentLook = selectedLooks[currentLookIdx] ?? null;

  // FIX: cast result as AREffect to satisfy strict union type
  const arEffect = (
    AR_EFFECTS.find(e => e.id === currentLook?.arEffectId) ?? AR_EFFECTS[0]
  ) as AREffect;

  // ── LOOK SELECTION ──────────────────────────────────────
  function toggleLook(look: VibeShiftLook) {
    setSelectedLooks(prev => {
      const exists = prev.find(l => l.id === look.id);
      if (exists) return prev.filter(l => l.id !== look.id);
      if (prev.length >= MAX_CLIPS) {
        Alert.alert('Max Looks', `You can add up to ${MAX_CLIPS} looks.`);
        return prev;
      }
      return [...prev, look];
    });
    Haptics.selectionAsync();
  }

  function removeLookAtIndex(idx: number) {
    setSelectedLooks(prev => prev.filter((_, i) => i !== idx));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  // ── COUNTDOWN ──────────────────────────────────────────
  function startCountdown() {
    if (selectedLooks.length < 2) {
      Alert.alert('Choose More Looks', 'Pick at least 2 looks to create a transformation.');
      return;
    }
    setCurrentLookIdx(recordedClips.length);
    setCountdown(COUNTDOWN_SECS);
    setVsView('countdown');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    let c = COUNTDOWN_SECS;
    const interval = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(interval);
        startRecording();
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }
    }, 1000);
  }

  // ── RECORDING ──────────────────────────────────────────
  async function startRecording() {
    if (!cameraRef.current) return;
    setRecordMs(0);
    setIsRecording(true);
    setVsView('recording');
    setBurstTrigger(true);
    setTimeout(() => setBurstTrigger(false), 1000);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1, duration: MAX_CLIP_MS, useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      setRecordMs(ms => {
        if (ms + 100 >= MAX_CLIP_MS) { stopRecording(); return ms; }
        return ms + 100;
      });
    }, 100);

    try {
      // FIX: explicit types on callbacks; no video/audio boolean props on <Camera>
      cameraRef.current.startRecording({
        flash: 'off',
        onRecordingFinished: (video: { path: string; duration: number }) => {
          handleClipCaptured(video.path);
        },
        onRecordingError: (err: Error) => {
          setIsRecording(false);
          setVsView('look_select');
          Alert.alert('Recording Error', err.message);
        },
      });
    } catch {
      setIsRecording(false);
      setVsView('look_select');
    }
  }

  async function stopRecording() {
    if (!isRecording || !cameraRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    progressAnim.setValue(0);
    setIsRecording(false);

    if (recordMs < MIN_CLIP_MS) {
      Alert.alert('Too Short', `Hold for at least ${MIN_CLIP_MS / 1000} seconds.`);
      try { await cameraRef.current.stopRecording(); } catch {}
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await cameraRef.current.stopRecording(); } catch {}
  }

  function handleClipCaptured(uri: string) {
    const look = selectedLooks[currentLookIdx];
    if (!look) return;
    const newClip: RecordedClip = { uri, lookId: look.id, durationMs: recordMs };
    setRecordedClips(prev => [...prev, newClip]);
    setVsView('review');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function retakeCurrentClip() {
    setRecordedClips(prev => prev.slice(0, -1));
    startCountdown();
  }

  function recordNextClip() {
    const nextIdx = currentLookIdx + 1;
    if (nextIdx >= selectedLooks.length) {
      stitchClips();
    } else {
      setCurrentLookIdx(nextIdx);
      startCountdown();
    }
  }

  // ── STITCH ─────────────────────────────────────────────
  async function stitchClips() {
    if (recordedClips.length < 2) {
      Alert.alert('Not Enough Clips', 'Record at least 2 looks to create your transformation.');
      return;
    }
    setIsStitching(true);
    setStitchProgress(0);

    try {
      const scenes = recordedClips.map((clip, i) => ({
        id:            `vs_clip_${i}`,
        order:         i,
        videoUri:      clip.uri,
        audioUri:      clip.uri,
        duration:      clip.durationMs / 1000,
        label:         selectedLooks.find(l => l.id === clip.lookId)?.name ?? `Clip ${i + 1}`,
        filter:        selectedLooks.find(l => l.id === clip.lookId)?.ffmpegFilter ?? 'normal',
        voiceEffectId: 'none',
        backgroundId:  'none',
        arEffectId:    'none',
        trimStart:     0,
        trimEnd:       0,
        isRendered:    false,
        renderedUri:   clip.uri,
      }));

      setStitchProgress(30);
      const { uri: finalUri, error } = await concatenateScenes(scenes as any);
      if (error || !finalUri) throw new Error(error ?? 'Stitch failed');

      setStitchProgress(100);
      setTimeout(() => { setIsStitching(false); onDone(finalUri); }, 600);
    } catch (err: unknown) {
      setIsStitching(false);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Stitch Failed', msg);
    }
  }

  // ── PERMISSION GATE ────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.gateScreen}>
        <Text style={styles.gateEmoji}>🎬</Text>
        <Text style={styles.gateTitle}>Camera needed</Text>
        <Text style={styles.gateDesc}>Vibe Shift records your transformation looks.</Text>
        <TouchableOpacity style={styles.gateBtn} onPress={requestPermission}>
          <Text style={styles.gateBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── STITCHING ──────────────────────────────────────────
  if (isStitching) {
    return (
      <View style={styles.stitchScreen}>
        <Text style={styles.stitchEmoji}>✨</Text>
        <Text style={styles.stitchTitle}>Creating Your Transformation</Text>
        <Text style={styles.stitchSub}>Stitching {recordedClips.length} looks together…</Text>
        <View style={styles.stitchTrack}>
          <View style={[styles.stitchFill, { width: `${stitchProgress}%` as any }]} />
        </View>
        <Text style={styles.stitchPct}>{stitchProgress}%</Text>
      </View>
    );
  }

  // ── LOOK SELECTION ─────────────────────────────────────
  if (vsView === 'look_select') {
    const categories = ['goddess', 'dark', 'afro', 'fantasy'] as const;
    const filtered   = VIBE_SHIFT_LOOKS.filter(l => l.category === activeCategory);

    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerClose}>
            <Text style={styles.headerCloseText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>✨ Vibe Shift</Text>
            <Text style={styles.headerSub}>Transform your look, clip by clip</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {selectedLooks.length > 0 && (
          <View style={styles.tray}>
            <Text style={styles.trayLabel}>YOUR LOOKS  {selectedLooks.length}/{MAX_CLIPS}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.trayScroll}>
              {selectedLooks.map((look, i) => (
                <TouchableOpacity
                  key={look.id}
                  style={[styles.trayChip, { borderColor: look.glowColor }]}
                  onPress={() => removeLookAtIndex(i)}
                >
                  <Text style={styles.trayChipEmoji}>{look.emoji}</Text>
                  <Text style={styles.trayChipName}>{look.name}</Text>
                  <Text style={styles.trayChipRemove}>✕</Text>
                </TouchableOpacity>
              ))}
              <View style={{ width: 16 }} />
            </ScrollView>
          </View>
        )}

        <ScrollView
          horizontal showsHorizontalScrollIndicator={false}
          style={styles.catTabRow}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {categories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.catTab, activeCategory === cat && styles.catTabActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.catTabText, activeCategory === cat && styles.catTabTextActive]}>
                {CATEGORY_LABELS[cat]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.lookGrid}>
          {filtered.map(look => {
            const isSelected = !!selectedLooks.find(l => l.id === look.id);
            const orderNum   = selectedLooks.findIndex(l => l.id === look.id) + 1;
            return (
              <TouchableOpacity
                key={look.id}
                style={[styles.lookCard, isSelected && { borderColor: look.glowColor, borderWidth: 2 }]}
                onPress={() => toggleLook(look)}
                activeOpacity={0.75}
              >
                <View style={[styles.lookCardBar, { backgroundColor: look.glowColor }]} />
                <View style={styles.lookCardTop}>
                  <Text style={styles.lookEmoji}>{look.emoji}</Text>
                  {isSelected && (
                    <View style={[styles.lookOrderBadge, { backgroundColor: look.glowColor }]}>
                      <Text style={styles.lookOrderText}>{orderNum}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.lookName}>{look.name}</Text>
                <Text style={styles.lookDesc}>{look.description}</Text>
                <View style={[styles.lookPreviewSwatch, { backgroundColor: look.tintColor.replace(/[\d.]+\)$/, '0.6)') }]} />
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {selectedLooks.length >= 2 && (
          <View style={styles.startBar}>
            <TouchableOpacity style={styles.startBtn} onPress={startCountdown}>
              <Text style={styles.startBtnText}>🎬  Start Recording  ({selectedLooks.length} looks)</Text>
            </TouchableOpacity>
          </View>
        )}
        {selectedLooks.length === 1 && (
          <View style={styles.startBar}>
            <Text style={styles.startHint}>Pick at least one more look to start 👆</Text>
          </View>
        )}
      </View>
    );
  }

  // ── COUNTDOWN ──────────────────────────────────────────
  if (vsView === 'countdown' && currentLook) {
    return (
      <View style={[styles.screen, { backgroundColor: '#000' }]}>
        {device && (
          // FIX: no video/audio boolean props — VisionCamera v4 doesn't accept them
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive
          />
        )}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: currentLook.tintColor }]} pointerEvents="none" />
        {currentLook.cinematicBars && (
          <>
            <View style={styles.cinTop} pointerEvents="none" />
            <View style={styles.cinBot} pointerEvents="none" />
          </>
        )}
        <View style={styles.countdownOverlay}>
          <Text style={styles.countdownLookName}>{currentLook.emoji}  {currentLook.name}</Text>
          <Text style={styles.countdownDesc}>{currentLook.description}</Text>
          <Text style={[styles.countdownNum, { color: currentLook.glowColor }]}>{countdown}</Text>
          <Text style={styles.countdownLabel}>GET READY</Text>
        </View>
        <TouchableOpacity style={styles.cancelOverlay} onPress={() => setVsView('look_select')}>
          <Text style={styles.cancelOverlayText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── RECORDING ──────────────────────────────────────────
  if (vsView === 'recording' && currentLook && device) {
    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 1], outputRange: ['0%', '100%'],
    });

    return (
      <View style={[styles.screen, { backgroundColor: '#000' }]}>
        {/* FIX: no video/audio boolean props */}
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: currentLook.tintColor }]} pointerEvents="none" />
        {currentLook.cinematicBars && (
          <>
            <View style={styles.cinTop} pointerEvents="none" />
            <View style={styles.cinBot} pointerEvents="none" />
          </>
        )}
        <AROverlay effect={arEffect} />
        <EffectBurstOverlay trigger={burstTrigger} />
        <View style={[styles.glowRing, { borderColor: currentLook.glowColor + '99' }]} pointerEvents="none" />
        <Animated.View
          style={[styles.recProgressBar, { width: progressWidth, backgroundColor: currentLook.glowColor }]}
          pointerEvents="none"
        />
        <View style={styles.recTop}>
          <View style={[styles.recBadge, { borderColor: currentLook.glowColor }]}>
            <Animated.View style={[styles.recDot, { backgroundColor: currentLook.glowColor, transform: [{ scale: pulseAnim }] }]} />
            <Text style={[styles.recBadgeText, { color: currentLook.glowColor }]}>
              LOOK {currentLookIdx + 1}/{selectedLooks.length}
            </Text>
          </View>
          <Text style={styles.recLookName}>{currentLook.emoji}  {currentLook.name}</Text>
          <TouchableOpacity style={styles.flipBtn} onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
            <Text style={styles.flipBtnText}>🔄</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.recTimer}>
          <Text style={styles.recTimerText}>{(recordMs / 1000).toFixed(1)}s</Text>
          <Text style={styles.recTimerMax}>/ {MAX_CLIP_MS / 1000}s</Text>
        </View>
        <View style={styles.recControls}>
          <TouchableOpacity
            style={[styles.stopBtn, { borderColor: currentLook.glowColor }]}
            onPress={stopRecording}
            activeOpacity={0.7}
          >
            <View style={[styles.stopBtnInner, { backgroundColor: currentLook.glowColor }]} />
          </TouchableOpacity>
          <Text style={styles.stopHint}>Tap to stop</Text>
        </View>
      </View>
    );
  }

  // ── CLIP REVIEW ────────────────────────────────────────
  if (vsView === 'review' && currentLook) {
    const isDone   = currentLookIdx + 1 >= selectedLooks.length;
    const nextLook = !isDone ? selectedLooks[currentLookIdx + 1] : null;
    // FIX: wrap optional chain in parens before dividing to avoid unreachable ??
    const clipDuration = ((recordedClips.at(-1)?.durationMs ?? 0) / 1000).toFixed(1);

    return (
      <View style={styles.reviewScreen}>
        <View style={[styles.reviewGlow, { backgroundColor: currentLook.glowColor + '22' }]} />
        <Text style={styles.reviewEmoji}>{currentLook.emoji}</Text>
        <Text style={styles.reviewLookName}>{currentLook.name}</Text>
        <Text style={styles.reviewSub}>
          Clip {currentLookIdx + 1} of {selectedLooks.length} · {clipDuration}s
        </Text>
        <View style={styles.clipDots}>
          {selectedLooks.map((look, i) => (
            <View
              key={look.id}
              style={[
                styles.clipDot,
                i <= currentLookIdx
                  ? { backgroundColor: look.glowColor, width: 24 }
                  : { backgroundColor: '#2A2A4A' },
              ]}
            />
          ))}
        </View>
        <View style={styles.reviewBtns}>
          <TouchableOpacity style={styles.retakeBtn} onPress={retakeCurrentClip}>
            <Text style={styles.retakeBtnText}>🔄  Re-take</Text>
          </TouchableOpacity>
          {isDone ? (
            <TouchableOpacity style={[styles.nextBtn, { backgroundColor: currentLook.glowColor }]} onPress={stitchClips}>
              <Text style={styles.nextBtnText}>✨  Create Video</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[styles.nextBtn, { backgroundColor: nextLook?.glowColor ?? '#6B4FFF' }]} onPress={recordNextClip}>
              <Text style={styles.nextBtnText}>Next: {nextLook?.emoji}  {nextLook?.name}  ›</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={styles.exitReviewBtn} onPress={() => setVsView('look_select')}>
          <Text style={styles.exitReviewBtnText}>‹ Back to Look Selector</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

// ── STYLES ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: '#070714' },
  gateScreen:  { flex: 1, backgroundColor: '#070714', alignItems: 'center', justifyContent: 'center', padding: 32 },
  gateEmoji:   { fontSize: 56, marginBottom: 16 },
  gateTitle:   { color: '#FFF', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  gateDesc:    { color: '#888', fontSize: 15, textAlign: 'center', marginBottom: 28 },
  gateBtn:     { backgroundColor: '#6B4FFF', borderRadius: 14, paddingHorizontal: 28, paddingVertical: 14 },
  gateBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },

  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#16163A' },
  headerClose:     { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCloseText: { color: '#666', fontSize: 20 },
  headerCenter:    { flex: 1, alignItems: 'center' },
  headerTitle:     { color: '#FFF', fontWeight: '900', fontSize: 18, letterSpacing: 0.5 },
  headerSub:       { color: '#555', fontSize: 11, marginTop: 2 },

  tray:           { backgroundColor: '#0D0D22', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#16163A' },
  trayLabel:      { color: '#555', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 16, marginBottom: 8 },
  trayScroll:     { paddingLeft: 16 },
  trayChip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#13132E', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, marginRight: 8, borderWidth: 1.5, gap: 5 },
  trayChipEmoji:  { fontSize: 14 },
  trayChipName:   { color: '#DDD', fontSize: 12, fontWeight: '600' },
  trayChipRemove: { color: '#666', fontSize: 11, marginLeft: 2 },

  catTabRow:        { maxHeight: 44, marginVertical: 10 },
  catTab:           { backgroundColor: '#111128', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: '#2A2A4A' },
  catTabActive:     { backgroundColor: '#1E1E4A', borderColor: '#6B4FFF' },
  catTabText:       { color: '#666', fontSize: 12, fontWeight: '700' },
  catTabTextActive: { color: '#FFF' },

  lookGrid:        { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10, paddingBottom: 120 },
  lookCard:        { width: (SW - 44) / 2, backgroundColor: '#0F0F26', borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: '#1E1E3A', overflow: 'hidden', position: 'relative' },
  lookCardBar:     { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  lookCardTop:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  lookEmoji:       { fontSize: 28 },
  lookOrderBadge:  { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  lookOrderText:   { color: '#000', fontWeight: '900', fontSize: 11 },
  lookName:        { color: '#FFF', fontWeight: '800', fontSize: 13, marginBottom: 4 },
  lookDesc:        { color: '#666', fontSize: 10, lineHeight: 14, marginBottom: 8 },
  lookPreviewSwatch: { height: 6, borderRadius: 3 },

  startBar:     { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: Platform.OS === 'ios' ? 36 : 20, backgroundColor: 'rgba(7,7,20,0.96)', borderTopWidth: 1, borderTopColor: '#16163A' },
  startBtn:     { backgroundColor: '#6B4FFF', borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  startBtnText: { color: '#FFF', fontWeight: '900', fontSize: 16 },
  startHint:    { color: '#555', textAlign: 'center', fontSize: 13 },

  cinTop: { position: 'absolute', top: 0, left: 0, right: 0, height: SH * 0.08, backgroundColor: '#000', zIndex: 3 } as any,
  cinBot: { position: 'absolute', bottom: 0, left: 0, right: 0, height: SH * 0.08, backgroundColor: '#000', zIndex: 3 } as any,

  countdownOverlay:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 10 },
  countdownLookName: { color: '#FFF', fontWeight: '900', fontSize: 22, marginBottom: 8, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  countdownDesc:     { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 28, textAlign: 'center', paddingHorizontal: 32 },
  countdownNum:      { fontWeight: '900', fontSize: 96, lineHeight: 100 },
  countdownLabel:    { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '700', letterSpacing: 3, marginTop: 8 },
  cancelOverlay:     { position: 'absolute', bottom: Platform.OS === 'ios' ? 50 : 30, alignSelf: 'center', zIndex: 20, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  cancelOverlayText: { color: '#AAA', fontWeight: '600' },

  glowRing:       { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 3, borderRadius: 0, zIndex: 2 },
  recProgressBar: { position: 'absolute', top: 0, left: 0, height: 4, zIndex: 10 },
  recTop:         { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  recBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  recDot:         { width: 8, height: 8, borderRadius: 4 },
  recBadgeText:   { fontWeight: '800', fontSize: 12 },
  recLookName:    { color: '#FFF', fontWeight: '800', fontSize: 15, textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  flipBtn:        { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  flipBtnText:    { fontSize: 18 },
  recTimer:       { position: 'absolute', bottom: 160, alignSelf: 'center', flexDirection: 'row', alignItems: 'baseline', gap: 4, zIndex: 10 },
  recTimerText:   { color: '#FFF', fontWeight: '900', fontSize: 36, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 },
  recTimerMax:    { color: 'rgba(255,255,255,0.5)', fontWeight: '600', fontSize: 16 },
  recControls:    { position: 'absolute', bottom: Platform.OS === 'ios' ? 60 : 40, alignSelf: 'center', alignItems: 'center', zIndex: 10 },
  stopBtn:        { width: 80, height: 80, borderRadius: 40, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  stopBtnInner:   { width: 32, height: 32, borderRadius: 6 },
  stopHint:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 10, fontWeight: '600' },

  reviewScreen:     { flex: 1, backgroundColor: '#070714', alignItems: 'center', justifyContent: 'center', padding: 28 },
  reviewGlow:       { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 },
  reviewEmoji:      { fontSize: 72, marginBottom: 12, zIndex: 1 },
  reviewLookName:   { color: '#FFF', fontWeight: '900', fontSize: 26, marginBottom: 6, zIndex: 1 },
  reviewSub:        { color: '#666', fontSize: 14, marginBottom: 28, zIndex: 1 },
  clipDots:         { flexDirection: 'row', gap: 8, marginBottom: 36, zIndex: 1 },
  clipDot:          { height: 6, borderRadius: 3, backgroundColor: '#2A2A4A' },
  reviewBtns:       { flexDirection: 'row', gap: 12, zIndex: 1 },
  retakeBtn:        { backgroundColor: '#111128', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, borderColor: '#2A2A4A' },
  retakeBtnText:    { color: '#AAA', fontWeight: '700', fontSize: 14 },
  nextBtn:          { borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
  nextBtnText:      { color: '#000', fontWeight: '900', fontSize: 14 },
  exitReviewBtn:    { marginTop: 20, zIndex: 1 },
  exitReviewBtnText:{ color: '#555', fontSize: 13, fontWeight: '600' },

  stitchScreen: { flex: 1, backgroundColor: '#070714', alignItems: 'center', justifyContent: 'center', padding: 32 },
  stitchEmoji:  { fontSize: 56, marginBottom: 16 },
  stitchTitle:  { color: '#FFF', fontWeight: '900', fontSize: 22, marginBottom: 8, textAlign: 'center' },
  stitchSub:    { color: '#666', fontSize: 14, marginBottom: 28 },
  stitchTrack:  { width: '100%', height: 8, backgroundColor: '#1E1E3A', borderRadius: 4, overflow: 'hidden', marginBottom: 12 },
  stitchFill:   { height: '100%', backgroundColor: '#6B4FFF', borderRadius: 4 },
  stitchPct:    { color: '#6B4FFF', fontWeight: '900', fontSize: 32 },
}); 
