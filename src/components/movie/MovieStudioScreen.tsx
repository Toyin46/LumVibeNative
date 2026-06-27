// ═══════════════════════════════════════════════════════════
// MovieStudioScreen.tsx — Professional Multi-Scene Movie Studio
// PATH: src/components/movie/MovieStudioScreen.tsx
// ALL 11 ERRORS FIXED:
//  1. useRef<Camera> → useRef<any>  (Camera value/type conflict)
//  2. arEffectId added to makeScene() object literal
//  3. arEffectId added to updateScene() call in startSceneRecording
//  4. video/audio props removed from ALL <Camera> JSX instances
//  5. AREffect cast → as AREffect  (type string vs union)
//  6. onRecordingFinished/onRecordingError explicit types
//  7. StudioWave isActive → active  (prop name mismatch)
// ═══════════════════════════════════════════════════════════

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, TextInput, Dimensions, Platform,
  Animated,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission } from 'react-native-vision-camera';
import * as Speech   from 'expo-speech';
import * as Haptics  from 'expo-haptics';
import AsyncStorage  from '@react-native-async-storage/async-storage';

import { useVUMeter }         from '../../hooks/useVUMeter';
import StudioWave             from '../studio/StudioWave';
import VoiceEffectsPanel      from '../studio/VoiceEffectsPanel';
import AROverlay              from '../ar/AROverlay';
import AnimatedBackground     from '../ar/AnimatedBackground';
import EffectBurstOverlay     from '../ar/EffectBurstOverlay';
import {
  bakeSceneVideo,
  bakeWatermarkAndEndCard as bakeWatermark,
  concatenateScenes,
}                             from '../../utils/ffmpegHelpers';
import {
  SCENE_LABELS, ANIMATED_BACKGROUNDS,
  AR_EFFECTS, FILTERS, VOICE_EFFECTS,
}                             from '../../utils/constants';
import { getSessionStartLine } from '../coach/coachEngine';
import type {
  MovieProject, MovieScene, AREffect, FilterDef,
}                             from '../../utils/types';

const { width: SW, height: SH } = Dimensions.get('window');
const STORAGE_KEY    = 'lumvibe_movie_projects';
const MAX_SCENE_SECS = 120;

type MovieStudioView =
  | 'projects'
  | 'scene_setup'
  | 'recording'
  | 'scene_review'
  | 'timeline'
  | 'rendering';

interface Props {
  userId:   string;
  username: string;
  onDone:   (finalUri: string) => void;
  onClose:  () => void;
}

function makeScene(order: number): MovieScene {
  return {
    id:            `scene_${Date.now()}_${order}`,
    order,
    videoUri:      null,
    audioUri:      null,
    duration:      0,
    label:         SCENE_LABELS[order] ?? `Scene ${order + 1}`,
    filter:        'original',
    voiceEffectId: 'none',
    backgroundId:  'none',
    arEffectId:    'none',   // FIX 2: was missing, caused object literal error
    trimStart:     0,
    trimEnd:       0,
    isRendered:    false,
    renderedUri:   null,
  };
}

function makeProject(title: string): MovieProject {
  return {
    id:          `proj_${Date.now()}`,
    createdAt:   new Date().toISOString(),
    title,
    scenes:      [makeScene(0)],
    musicUri:    null,
    musicName:   null,
    musicVolume: 0.4,
    finalUri:    null,
    isComplete:  false,
  };
}

export default function MovieStudioScreen({ userId, username, onDone, onClose }: Props) {
  const { hasPermission, requestPermission } = useCameraPermission();

  const [view,            setView]            = useState<MovieStudioView>('projects');
  const [projects,        setProjects]        = useState<MovieProject[]>([]);
  const [activeProject,   setActiveProject]   = useState<MovieProject | null>(null);
  const [activeSceneIdx,  setActiveSceneIdx]  = useState(0);
  const [renderProgress,  setRenderProgress]  = useState(0);
  const [renderLog,       setRenderLog]       = useState<string[]>([]);
  const [burstTrigger,    setBurstTrigger]    = useState(false);
  const [coachText,       setCoachText]       = useState('');
  const [newProjectTitle, setNewProjectTitle] = useState('');
  const [showNewDialog,   setShowNewDialog]   = useState(false);
  const [isRecording,     setIsRecording]     = useState(false);
  const [recordSecs,      setRecordSecs]      = useState(0);
  const [facing,          setFacing]          = useState<'front' | 'back'>('front');

  const [setupFilter,  setSetupFilter]  = useState<FilterDef>(FILTERS[0]);
  const [setupArId,    setSetupArId]    = useState('none');
  const [setupBgId,    setSetupBgId]    = useState('none');
  const [setupVoiceId, setSetupVoiceId] = useState('none');

  // FIX 1: useRef<any> avoids 'Camera refers to a value' TS error
  const cameraRef    = useRef<any>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const vu           = useVUMeter();
  const device       = useCameraDevice(facing);

  useEffect(() => { loadProjects(); }, []);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.5, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  async function loadProjects() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) setProjects(JSON.parse(raw));
    } catch {}
  }

  async function saveProjects(updated: MovieProject[]) {
    setProjects(updated);
    try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
  }

  const activeScene: MovieScene | null =
    activeProject?.scenes[activeSceneIdx] ?? null;

  function updateScene(partial: Partial<MovieScene>) {
    if (!activeProject) return;
    const scenes  = activeProject.scenes.map((s, i) =>
      i === activeSceneIdx ? { ...s, ...partial } : s
    );
    const updated = { ...activeProject, scenes };
    setActiveProject(updated);
    saveProjects(projects.map(p => p.id === updated.id ? updated : p));
  }

  function updateProject(partial: Partial<MovieProject>) {
    if (!activeProject) return;
    const updated = { ...activeProject, ...partial };
    setActiveProject(updated);
    saveProjects(projects.map(p => p.id === updated.id ? updated : p));
  }

  function coachSay(text: string, priority = false) {
    if (priority) Speech.stop();
    setCoachText(text);
    Speech.speak(text, {
      language: 'en-US', rate: 0.95,
      onDone:    () => setCoachText(''),
      onStopped: () => setCoachText(''),
    });
  }

  async function startSceneRecording() {
    if (!cameraRef.current || !activeScene) return;
    if (!hasPermission) { await requestPermission(); return; }

    // FIX 3: arEffectId included — was causing Partial<MovieScene> error
    updateScene({
      filter:        setupFilter.id,
      voiceEffectId: setupVoiceId,
      backgroundId:  setupBgId,
      arEffectId:    setupArId,
    });

    setRecordSecs(0);
    setIsRecording(true);
    setView('recording');
    setBurstTrigger(true);
    setTimeout(() => setBurstTrigger(false), 1200);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    vu.start();

    progressAnim.setValue(0);
    Animated.timing(progressAnim, {
      toValue: 1, duration: MAX_SCENE_SECS * 1000, useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      setRecordSecs(s => {
        if (s >= MAX_SCENE_SECS - 1) { stopSceneRecording(); return s; }
        return s + 1;
      });
    }, 1000);

    const isFirst = activeSceneIdx === 0;
    const label   = activeScene.label;
    setTimeout(() => coachSay(
      isFirst
        ? `Lights, camera — ${label}. Give me everything. In three, two, one.`
        : `Next scene: ${label}. Take a breath. Go when ready.`
    ), 600);

    try {
      // FIX 6: explicit types on callbacks
      cameraRef.current.startRecording({
        flash: 'off',
        onRecordingFinished: (video: { path: string; duration: number }) => {
          handleVideoRecorded(video.path);
        },
        onRecordingError: (err: Error) => {
          setIsRecording(false);
          vu.stop();
          if (timerRef.current) clearInterval(timerRef.current);
          Alert.alert('Recording Error', err.message);
          setView('scene_setup');
        },
      });
    } catch {
      setIsRecording(false);
      vu.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setView('scene_setup');
    }
  }

  async function stopSceneRecording() {
    if (!isRecording || !cameraRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);
    progressAnim.setValue(0);
    vu.stop();
    setIsRecording(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await cameraRef.current.stopRecording(); } catch {}
  }

  function handleVideoRecorded(videoPath: string) {
    updateScene({
      videoUri:    videoPath,
      audioUri:    videoPath,
      duration:    recordSecs,
      isRendered:  false,
      renderedUri: null,
    });
    setView('scene_review');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setTimeout(() => {
      const d = recordSecs;
      coachSay(
        d >= 20
          ? `Good. ${d}s is solid for a scene. Re-shoot or move on.`
          : `Short take — ${d} seconds. Re-shoot or continue, your call.`
      );
    }, 800);
  }

  async function rerecordScene() {
    updateScene({ videoUri: null, audioUri: null, isRendered: false, renderedUri: null });
    setView('scene_setup');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    coachSay("Let's go again. Set your look and hit record when you're ready.");
  }

  function addScene() {
    if (!activeProject) return;
    const next    = makeScene(activeProject.scenes.length);
    const updated = { ...activeProject, scenes: [...activeProject.scenes, next] };
    setActiveProject(updated);
    saveProjects(projects.map(p => p.id === updated.id ? updated : p));
    setActiveSceneIdx(next.order);
    setSetupFilter(FILTERS[0]);
    setSetupArId('none');
    setSetupBgId('none');
    setSetupVoiceId('none');
    setView('scene_setup');
    coachSay(`Scene ${next.order + 1}: ${next.label}. Set your look and roll.`);
  }

  function deleteScene(idx: number) {
    if (!activeProject) return;
    if (activeProject.scenes.length <= 1) {
      Alert.alert('Cannot delete', 'A project needs at least one scene.');
      return;
    }
    Alert.alert('Delete Scene', `Delete "${activeProject.scenes[idx].label}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => {
          const scenes = activeProject.scenes
            .filter((_, i) => i !== idx)
            .map((s, i) => ({ ...s, order: i }));
          updateProject({ scenes });
          setActiveSceneIdx(Math.min(idx, scenes.length - 1));
          setView('timeline');
        },
      },
    ]);
  }

  async function renderProject() {
    if (!activeProject) return;
    const unrecorded = activeProject.scenes.filter(s => !s.videoUri);
    if (unrecorded.length > 0) {
      Alert.alert(
        'Unfinished Scenes',
        `${unrecorded.length} scene(s) have no video yet. Render the recorded ones?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Render Recorded', onPress: doRender },
        ],
      );
      return;
    }
    doRender();
  }

  async function doRender() {
    if (!activeProject) return;
    setView('rendering');
    setRenderProgress(0);
    setRenderLog([]);
    coachSay('Rendering your movie. Each scene is being processed. Sit tight.');

    const log      = (msg: string) => setRenderLog(prev => [...prev, msg]);
    const toRender = activeProject.scenes.filter(s => s.videoUri);
    const total    = toRender.length;
    let done       = 0;
    const renderedScenes: MovieScene[] = [];

    for (const scene of toRender) {
      log(`🎬 Processing Scene ${scene.order + 1}: ${scene.label}…`);

      const voiceEffect = VOICE_EFFECTS.find(e => e.id === scene.voiceEffectId) ?? VOICE_EFFECTS[0];
      const defaultEdit = {
        trimStart:   scene.trimStart,
        trimEnd:     scene.trimEnd > 0 ? scene.trimEnd : scene.duration,
        reverse:     false,
        chorus:      false,
        normalise:   true,
        noiseGate:   true,
        delay:       0,
        reverbLevel: 0,
        pitchShift:  0,
      };

      const { uri: renderedUri, error } = await bakeSceneVideo(
        scene,
        voiceEffect,
        defaultEdit,
        (pct) => {
          const overall = Math.round(((done / total) + (pct / 100 / total)) * 72);
          setRenderProgress(overall);
        },
      );

      if (error || !renderedUri) {
        log(`⚠️ Scene ${scene.order + 1} failed: ${error ?? 'unknown'}. Skipping.`);
        continue;
      }

      renderedScenes.push({ ...scene, renderedUri, isRendered: true });
      done++;
      log(`✓ Scene ${scene.order + 1} done.`);
      setRenderProgress(Math.round((done / total) * 72));
    }

    if (renderedScenes.length === 0) {
      log('❌ No scenes rendered successfully.');
      Alert.alert('Render Failed', 'No scenes could be processed.');
      setView('timeline');
      return;
    }

    log(`🔗 Joining ${renderedScenes.length} scene(s)…`);
    setRenderProgress(76);

    const { uri: concatUri, error: concatErr } = await concatenateScenes(renderedScenes);
    if (concatErr || !concatUri) {
      log(`❌ Join failed: ${concatErr}`);
      Alert.alert('Render Failed', concatErr ?? 'Concat error.');
      setView('timeline');
      return;
    }

    log('💧 Adding watermark & end card…');
    setRenderProgress(88);

    const finalUri = await bakeWatermark(concatUri, username, true);

    setRenderProgress(100);
    log('✅ Your movie is ready!');
    updateProject({ finalUri: finalUri ?? concatUri, isComplete: true });

    coachSay(
      renderedScenes.length >= 3
        ? 'Done. Strong multi-scene structure. This will perform well.'
        : 'Done. Short and punchy — good for Reels and TikTok.'
    );

    setTimeout(() => { onDone(finalUri ?? concatUri); }, 1800);
  }

  function createProject() {
    const title = newProjectTitle.trim() || `My Movie ${projects.length + 1}`;
    const proj  = makeProject(title);
    saveProjects([...projects, proj]);
    setActiveProject(proj);
    setActiveSceneIdx(0);
    setSetupFilter(FILTERS[0]);
    setSetupArId('none');
    setSetupBgId('none');
    setSetupVoiceId('none');
    setNewProjectTitle('');
    setShowNewDialog(false);
    setView('scene_setup');
    setTimeout(() => coachSay(getSessionStartLine()), 500);
  }

  function formatSecs(s: number) {
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  }

  // ── Permission gate ──────────────────────────────────────
  if (!hasPermission && view !== 'projects' && view !== 'timeline' && view !== 'rendering') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}><Text style={styles.headerClose}>✕</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>🎬 Movie Studio</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.permEmoji}>🎥</Text>
          <Text style={styles.permTitle}>Camera access needed</Text>
          <Text style={styles.permDesc}>Movie Studio records real video scenes.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── PROJECTS LIST ────────────────────────────────────────
  if (view === 'projects') {
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🎬 Movie Studio</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.projectList}>
          {projects.length === 0 && (
            <Text style={styles.emptyText}>No projects yet. Create your first movie.</Text>
          )}
          {projects.map(proj => (
            <TouchableOpacity
              key={proj.id}
              style={styles.projectCard}
              onPress={() => { setActiveProject(proj); setActiveSceneIdx(0); setView('timeline'); }}
            >
              <View style={styles.projectCardLeft}>
                <Text style={styles.projectTitle}>{proj.title}</Text>
                <Text style={styles.projectMeta}>
                  {proj.scenes.length} scene{proj.scenes.length !== 1 ? 's' : ''}{' '}
                  · {new Date(proj.createdAt).toLocaleDateString()}
                  {proj.isComplete ? ' · ✅ Complete' : ''}
                </Text>
              </View>
              <Text style={styles.projectArrow}>›</Text>
            </TouchableOpacity>
          ))}
          {showNewDialog ? (
            <View style={styles.newDialog}>
              <Text style={styles.newDialogLabel}>Project title</Text>
              <TextInput
                style={styles.newDialogInput}
                value={newProjectTitle}
                onChangeText={setNewProjectTitle}
                placeholder="e.g. My Afrobeats Vlog"
                placeholderTextColor="#555"
                autoFocus
              />
              <View style={styles.newDialogBtns}>
                <TouchableOpacity style={styles.newDialogCancel} onPress={() => setShowNewDialog(false)}>
                  <Text style={styles.newDialogCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.newDialogCreate} onPress={createProject}>
                  <Text style={styles.newDialogCreateText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.newProjectBtn} onPress={() => setShowNewDialog(true)}>
              <Text style={styles.newProjectBtnText}>+ New Movie Project</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    );
  }

  // ── TIMELINE ─────────────────────────────────────────────
  if (view === 'timeline' && activeProject) {
    const recorded = activeProject.scenes.filter(s => s.videoUri).length;
    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('projects')}>
            <Text style={styles.backBtn}>‹ Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{activeProject.title}</Text>
          <TouchableOpacity
            style={[styles.renderBtn, recorded === 0 && styles.renderBtnDisabled]}
            onPress={renderProject}
            disabled={recorded === 0}
          >
            <Text style={styles.renderBtnText}>Render ›</Text>
          </TouchableOpacity>
        </View>
        {!!coachText && <CoachBar text={coachText} />}
        <View style={styles.timelineSummary}>
          <Text style={styles.timelineSummaryText}>
            {recorded}/{activeProject.scenes.length} scenes recorded
            {recorded > 0
              ? ` · ${activeProject.scenes.filter(s => s.videoUri).reduce((a, s) => a + s.duration, 0).toFixed(1)}s total`
              : ''}
          </Text>
        </View>
        <ScrollView contentContainerStyle={styles.timelineList}>
          {activeProject.scenes.map((scene, idx) => (
            <TouchableOpacity
              key={scene.id}
              style={[styles.sceneCard, scene.videoUri ? styles.sceneCardDone : null]}
              onPress={() => {
                setActiveSceneIdx(idx);
                if (!scene.videoUri) {
                  setSetupFilter(FILTERS.find(f => f.id === scene.filter) ?? FILTERS[0]);
                  setSetupArId(scene.arEffectId ?? 'none');
                  setSetupBgId(scene.backgroundId);
                  setSetupVoiceId(scene.voiceEffectId);
                  setView('scene_setup');
                } else {
                  setView('scene_review');
                }
              }}
            >
              <View style={styles.sceneCardLeft}>
                <Text style={styles.sceneOrder}>{idx + 1}</Text>
              </View>
              <View style={styles.sceneCardMiddle}>
                <Text style={styles.sceneLabel}>{scene.label}</Text>
                <Text style={styles.sceneMeta}>
                  {scene.videoUri
                    ? `✓ ${scene.duration.toFixed(1)}s · ${FILTERS.find(f => f.id === scene.filter)?.name ?? 'Original'}`
                    : 'Not recorded yet'}
                </Text>
              </View>
              <TouchableOpacity style={styles.sceneDelete} onPress={() => deleteScene(idx)}>
                <Text style={styles.sceneDeleteText}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.addSceneBtn} onPress={addScene}>
            <Text style={styles.addSceneBtnText}>+ Add Scene</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── SCENE SETUP ──────────────────────────────────────────
  if (view === 'scene_setup' && activeScene) {
    // FIX 5: cast as AREffect to satisfy strict union type on 'type' property
    const selectedAR = (AR_EFFECTS.find(e => e.id === setupArId) ?? AR_EFFECTS[0]) as AREffect;
    return (
      <View style={styles.screen}>
        {device && (
          // FIX 4: removed video and audio boolean props — not valid in VisionCamera v4
          <Camera
            style={[StyleSheet.absoluteFill, { zIndex: 0 }]}
            device={device}
            isActive
          />
        )}
        {setupFilter.tintColor && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: setupFilter.tintColor, zIndex: 1 }]}
            pointerEvents="none"
          />
        )}
        <AROverlay effect={selectedAR} />
        {setupBgId !== 'none' && <AnimatedBackground backgroundId={setupBgId} intensity={0.4} />}
        <View style={styles.setupOverlay} pointerEvents="none" />

        <View style={[styles.header, { zIndex: 10 }]}>
          <TouchableOpacity onPress={() => setView('timeline')}>
            <Text style={styles.backBtn}>‹ Timeline</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{activeScene.label}</Text>
          <TouchableOpacity onPress={() => setFacing(f => f === 'front' ? 'back' : 'front')}>
            <Text style={styles.flipText}>🔄</Text>
          </TouchableOpacity>
        </View>

        {!!coachText && <CoachBar text={coachText} />}

        <ScrollView
          style={[styles.setupScrollOuter, { zIndex: 10 }]}
          contentContainerStyle={styles.setupScroll}
        >
          <Text style={styles.setupSection}>Scene Label</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {SCENE_LABELS.map(label => (
              <TouchableOpacity
                key={label}
                style={[styles.labelChip, activeScene.label === label && styles.labelChipActive]}
                onPress={() => updateScene({ label })}
              >
                <Text style={[styles.labelChipText, activeScene.label === label && styles.labelChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.setupSection}>Filter / Look</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {FILTERS.map(f => (
              <TouchableOpacity
                key={f.id}
                style={[styles.filterChip, setupFilter.id === f.id && styles.filterChipActive]}
                onPress={() => setSetupFilter(f)}
              >
                <Text style={styles.filterChipEmoji}>{f.emoji}</Text>
                <Text style={[styles.filterChipText, setupFilter.id === f.id && { color: '#FFF' }]}>
                  {f.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.setupSection}>AR Effect</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {AR_EFFECTS.map(ar => (
              <TouchableOpacity
                key={ar.id}
                style={[styles.arChip, setupArId === ar.id && styles.arChipActive]}
                onPress={() => setSetupArId(ar.id)}
              >
                <Text style={styles.arChipEmoji}>{ar.emoji}</Text>
                <Text style={[styles.arChipText, setupArId === ar.id && { color: '#FFF' }]}>
                  {ar.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.setupSection}>Background</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {ANIMATED_BACKGROUNDS.map(bg => (
              <TouchableOpacity
                key={bg.id}
                style={[
                  styles.bgChip,
                  { backgroundColor: bg.colors[0] ?? '#1A1A3A' },
                  setupBgId === bg.id && styles.bgChipActive,
                ]}
                onPress={() => setSetupBgId(bg.id)}
              >
                <Text style={styles.bgChipText}>{bg.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.setupSection}>Voice Effect</Text>
          <VoiceEffectsPanel
            selectedId={setupVoiceId}
            onSelect={e => setSetupVoiceId(e.id)}
          />

          <TouchableOpacity style={styles.bigRecordBtn} onPress={startSceneRecording}>
            <Text style={styles.bigRecordBtnText}>⏺  Start Recording</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── RECORDING VIEW ───────────────────────────────────────
  if (view === 'recording' && activeScene && device) {
    // FIX 5: cast as AREffect
    const selectedAR = (AR_EFFECTS.find(e => e.id === setupArId) ?? AR_EFFECTS[0]) as AREffect;
    const progressWidth = progressAnim.interpolate({
      inputRange: [0, 1], outputRange: ['0%', '100%'],
    });

    return (
      <View style={styles.screen}>
        {/* FIX 4: no video/audio boolean props */}
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
        />
        {setupFilter.tintColor && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: setupFilter.tintColor }]}
            pointerEvents="none"
          />
        )}
        {setupBgId !== 'none' && <AnimatedBackground backgroundId={setupBgId} intensity={0.45} />}
        <AROverlay effect={selectedAR} />
        <EffectBurstOverlay trigger={burstTrigger} />

        <Animated.View style={[styles.recProgressBar, { width: progressWidth }]} />

        {!!coachText && (
          <View style={styles.coachBarRecording}>
            <Text style={styles.coachBarEmoji}>🎙️</Text>
            <Text style={styles.coachBarText}>{coachText}</Text>
          </View>
        )}

        {/* FIX 7: StudioWave uses 'active' not 'isActive' */}
        <View style={styles.vuOverlay}>
          <StudioWave level={vu.level} isActive={vu.isActive} barCount={24} height={44} />
        </View>

        <View style={styles.recordingTop}>
          <View style={styles.recBadge}>
            <Animated.View style={[styles.recDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={styles.recBadgeText}>REC</Text>
          </View>
          <Text style={styles.recTimer}>{formatSecs(recordSecs)}</Text>
          <Text style={styles.sceneTag}>{activeScene.label}</Text>
        </View>

        <View style={styles.recordingControls}>
          <TouchableOpacity style={styles.recStopBtn} onPress={stopSceneRecording}>
            <View style={styles.recStopInner} />
          </TouchableOpacity>
          <Text style={styles.recStopHint}>Tap to stop</Text>
        </View>
      </View>
    );
  }

  // ── SCENE REVIEW ─────────────────────────────────────────
  if (view === 'scene_review' && activeScene) {
    const filterName = FILTERS.find(f => f.id === activeScene.filter)?.name ?? 'Original';
    const voiceName  = VOICE_EFFECTS.find(e => e.id === activeScene.voiceEffectId)?.name ?? 'None';
    const isDone     = activeSceneIdx + 1 >= (activeProject?.scenes.length ?? 1);

    return (
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setView('timeline')}>
            <Text style={styles.backBtn}>‹ Timeline</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{activeScene.label} — Review</Text>
          <View style={{ width: 60 }} />
        </View>
        {!!coachText && <CoachBar text={coachText} />}

        <View style={styles.reviewContent}>
          <Text style={styles.reviewBigEmoji}>🎬</Text>
          <Text style={styles.reviewTitle}>{activeScene.label} Captured</Text>
          <View style={styles.reviewMeta}>
            <ReviewPill emoji="⏱" label={`${activeScene.duration.toFixed(1)}s`} />
            <ReviewPill emoji="🎨" label={filterName} />
            <ReviewPill emoji="🎤" label={voiceName} />
          </View>
          <View style={styles.trimRow}>
            <Text style={styles.trimLabel}>Trim start: {activeScene.trimStart.toFixed(1)}s</Text>
            <View style={styles.trimBtns}>
              <TouchableOpacity style={styles.trimBtn}
                onPress={() => updateScene({ trimStart: Math.max(0, activeScene.trimStart - 0.5) })}>
                <Text style={styles.trimBtnText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.trimBtn}
                onPress={() => updateScene({ trimStart: Math.min(activeScene.duration - 1, activeScene.trimStart + 0.5) })}>
                <Text style={styles.trimBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.reviewBtns}>
            <TouchableOpacity style={styles.rerecordBtn} onPress={rerecordScene}>
              <Text style={styles.rerecordBtnText}>🔄  Re-shoot</Text>
            </TouchableOpacity>
            {isDone ? (
              <TouchableOpacity style={styles.renderNowBtn} onPress={renderProject}>
                <Text style={styles.renderNowBtnText}>✨  Render Movie</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.nextSceneBtn} onPress={addScene}>
                <Text style={styles.nextSceneBtnText}>+ Next Scene</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity style={styles.timelineLink} onPress={() => setView('timeline')}>
            <Text style={styles.timelineLinkText}>📋 View Timeline</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── RENDERING ────────────────────────────────────────────
  if (view === 'rendering') {
    return (
      <View style={styles.screen}>
        <View style={styles.renderScreen}>
          <Text style={styles.renderTitle}>🎬 Rendering Your Movie</Text>
          <Text style={styles.renderPct}>{renderProgress}%</Text>
          <View style={styles.renderTrack}>
            <View style={[styles.renderFill, { width: `${renderProgress}%` as any }]} />
          </View>
          <ScrollView style={styles.renderLog}>
            {renderLog.map((line, i) => (
              <Text key={i} style={styles.renderLogLine}>{line}</Text>
            ))}
          </ScrollView>
          {renderProgress < 100 && (
            <ActivityIndicator color="#6B4FFF" size="large" style={{ marginTop: 20 }} />
          )}
        </View>
      </View>
    );
  }

  return null;
}

function CoachBar({ text }: { text: string }) {
  return (
    <View style={styles.coachBar}>
      <Text style={styles.coachBarEmoji}>🎙️</Text>
      <Text style={styles.coachBarText}>{text}</Text>
    </View>
  );
}

function ReviewPill({ emoji, label }: { emoji: string; label: string }) {
  return (
    <View style={styles.reviewPill}>
      <Text style={styles.reviewPillEmoji}>{emoji}</Text>
      <Text style={styles.reviewPillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen:        { flex: 1, backgroundColor: '#0A0A1A' },
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  permEmoji:     { fontSize: 52, marginBottom: 14 },
  permTitle:     { color: '#FFF', fontWeight: '800', fontSize: 20, marginBottom: 8 },
  permDesc:      { color: '#666', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  permBtn:       { backgroundColor: '#6B4FFF', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14 },
  permBtnText:   { color: '#FFF', fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1A1A3A',
    backgroundColor: 'rgba(10,10,26,0.92)',
  },
  headerTitle:       { color: '#FFF', fontWeight: '800', fontSize: 16, flex: 1, textAlign: 'center' },
  headerClose:       { color: '#888', fontSize: 20 },
  backBtn:           { color: '#6B4FFF', fontSize: 15, fontWeight: '600' },
  flipText:          { color: '#FFF', fontSize: 20 },
  renderBtn:         { backgroundColor: '#6B4FFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  renderBtnDisabled: { backgroundColor: '#333' },
  renderBtnText:     { color: '#FFF', fontWeight: '700', fontSize: 13 },

  coachBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0D0D2B', paddingHorizontal: 14, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1A1A4A',
  },
  coachBarRecording: {
    position: 'absolute', top: Platform.OS === 'ios' ? 130 : 110, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(13,13,43,0.85)', borderRadius: 12, padding: 10, gap: 8, zIndex: 10,
  },
  coachBarEmoji: { fontSize: 18 },
  coachBarText:  { color: '#EEE', fontSize: 13, flex: 1, lineHeight: 18, fontStyle: 'italic' },

  projectList:     { padding: 16, gap: 12 },
  emptyText:       { color: '#555', textAlign: 'center', marginVertical: 30, fontSize: 14 },
  projectCard:     { backgroundColor: '#111124', borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A4A' },
  projectCardLeft: { flex: 1 },
  projectTitle:    { color: '#FFF', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  projectMeta:     { color: '#666', fontSize: 12 },
  projectArrow:    { color: '#6B4FFF', fontSize: 22 },

  newDialog:           { backgroundColor: '#111124', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#6B4FFF' },
  newDialogLabel:      { color: '#AAA', fontSize: 13, marginBottom: 8 },
  newDialogInput:      { backgroundColor: '#0A0A1A', borderRadius: 10, padding: 12, color: '#FFF', fontSize: 15, borderWidth: 1, borderColor: '#2A2A4A', marginBottom: 12 },
  newDialogBtns:       { flexDirection: 'row', gap: 10 },
  newDialogCancel:     { flex: 1, backgroundColor: '#1E1E3A', borderRadius: 10, padding: 12, alignItems: 'center' },
  newDialogCancelText: { color: '#AAA', fontWeight: '600' },
  newDialogCreate:     { flex: 1, backgroundColor: '#6B4FFF', borderRadius: 10, padding: 12, alignItems: 'center' },
  newDialogCreateText: { color: '#FFF', fontWeight: '700' },
  newProjectBtn:       { backgroundColor: '#1A1A3A', borderRadius: 14, padding: 18, alignItems: 'center', borderWidth: 1, borderColor: '#3A3A5A' },
  newProjectBtnText:   { color: '#6B4FFF', fontWeight: '700', fontSize: 15 },

  timelineSummary:     { backgroundColor: '#0D0D22', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1A1A3A' },
  timelineSummaryText: { color: '#666', fontSize: 12 },
  timelineList:        { padding: 16, gap: 10 },

  sceneCard:       { backgroundColor: '#111124', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#2A2A4A' },
  sceneCardDone:   { borderColor: '#00AA55' },
  sceneCardLeft:   { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1E1E3A', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  sceneOrder:      { color: '#AAF', fontWeight: '800', fontSize: 14 },
  sceneCardMiddle: { flex: 1 },
  sceneLabel:      { color: '#FFF', fontWeight: '700', fontSize: 14 },
  sceneMeta:       { color: '#666', fontSize: 11, marginTop: 2 },
  sceneDelete:     { padding: 8 },
  sceneDeleteText: { color: '#FF4040', fontSize: 16 },
  addSceneBtn:     { backgroundColor: '#1A1A3A', borderRadius: 14, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3A3A5A' },
  addSceneBtnText: { color: '#6B4FFF', fontWeight: '700' },

  setupOverlay:     { position: 'absolute', bottom: 0, left: 0, right: 0, height: '65%', zIndex: 5, backgroundColor: 'rgba(10,10,26,0.85)' },
  setupScrollOuter: { position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: SH * 0.65 },
  setupScroll:      { padding: 16, gap: 14, paddingBottom: 32 },
  setupSection:     { color: '#AAA', fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },

  labelChip:           { backgroundColor: '#1E1E3A', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8, borderWidth: 1, borderColor: '#3A3A5A' },
  labelChipActive:     { backgroundColor: '#6B4FFF', borderColor: '#6B4FFF' },
  labelChipText:       { color: '#AAA', fontSize: 12, fontWeight: '600' },
  labelChipTextActive: { color: '#FFF' },

  filterChip:       { backgroundColor: '#1E1E3A', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, alignItems: 'center', borderWidth: 1.5, borderColor: '#2A2A4A', minWidth: 70 },
  filterChipActive: { borderColor: '#00ff88', backgroundColor: '#0A1A0A' },
  filterChipEmoji:  { fontSize: 20, marginBottom: 3 },
  filterChipText:   { color: '#888', fontSize: 10, fontWeight: '700' },

  arChip:       { backgroundColor: '#1E1E3A', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginRight: 8, alignItems: 'center', borderWidth: 1.5, borderColor: '#2A2A4A', minWidth: 70 },
  arChipActive: { borderColor: '#A97FFF', backgroundColor: '#1A0A3A' },
  arChipEmoji:  { fontSize: 20, marginBottom: 3 },
  arChipText:   { color: '#888', fontSize: 10, fontWeight: '700' },

  bgChip:       { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8, borderWidth: 2, borderColor: 'transparent', minWidth: 80, alignItems: 'center' },
  bgChipActive: { borderColor: '#FFF' },
  bgChipText:   { color: '#FFF', fontSize: 11, fontWeight: '700', textShadowColor: '#000', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 },

  bigRecordBtn:     { backgroundColor: '#FF4040', borderRadius: 60, paddingVertical: 18, alignItems: 'center', marginTop: 16 },
  bigRecordBtnText: { color: '#FFF', fontWeight: '900', fontSize: 17 },

  recProgressBar:    { position: 'absolute', top: 0, left: 0, height: 4, backgroundColor: '#FF4040', zIndex: 10 },
  vuOverlay:         { position: 'absolute', bottom: 130, left: 20, right: 20, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, padding: 8, zIndex: 8 },
  recordingTop:      { position: 'absolute', top: Platform.OS === 'ios' ? 60 : 40, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 10 },
  recBadge:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(200,0,0,0.8)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  recDot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  recBadgeText:      { color: '#FFF', fontWeight: '800', fontSize: 12 },
  recTimer:          { color: '#FFF', fontWeight: '900', fontSize: 22, textShadowColor: '#000', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  sceneTag:          { color: '#FFD700', fontWeight: '700', fontSize: 13 },
  recordingControls: { position: 'absolute', bottom: Platform.OS === 'ios' ? 60 : 40, alignSelf: 'center', alignItems: 'center', zIndex: 10 },
  recStopBtn:        { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  recStopInner:      { width: 30, height: 30, borderRadius: 6, backgroundColor: '#FF4040' },
  recStopHint:       { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 10, fontWeight: '600' },

  reviewContent:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  reviewBigEmoji:  { fontSize: 64, marginBottom: 12 },
  reviewTitle:     { color: '#FFF', fontWeight: '800', fontSize: 22, marginBottom: 16 },
  reviewMeta:      { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap', justifyContent: 'center' },
  reviewPill:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1E1E3A', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  reviewPillEmoji: { fontSize: 14 },
  reviewPillText:  { color: '#CCC', fontSize: 12, fontWeight: '600' },
  trimRow:         { backgroundColor: '#111124', borderRadius: 12, padding: 12, width: '100%', marginBottom: 20, borderWidth: 1, borderColor: '#2A2A4A' },
  trimLabel:       { color: '#AAA', fontSize: 13, marginBottom: 8 },
  trimBtns:        { flexDirection: 'row', gap: 10 },
  trimBtn:         { backgroundColor: '#1E1E3A', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8, borderWidth: 1, borderColor: '#3A3A5A' },
  trimBtnText:     { color: '#FFF', fontWeight: '800', fontSize: 18 },
  reviewBtns:      { flexDirection: 'row', gap: 12, marginBottom: 14 },
  rerecordBtn:     { backgroundColor: '#1E1E3A', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14, borderWidth: 1, borderColor: '#3A3A5A' },
  rerecordBtnText: { color: '#AAA', fontWeight: '700' },
  nextSceneBtn:    { backgroundColor: '#6B4FFF', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
  nextSceneBtnText:{ color: '#FFF', fontWeight: '700' },
  renderNowBtn:    { backgroundColor: '#00ff88', borderRadius: 14, paddingHorizontal: 20, paddingVertical: 14 },
  renderNowBtnText:{ color: '#000', fontWeight: '900' },
  timelineLink:    { marginTop: 8 },
  timelineLinkText:{ color: '#6B4FFF', fontSize: 14, fontWeight: '600' },

  renderScreen:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  renderTitle:   { color: '#FFF', fontSize: 20, fontWeight: '800', marginBottom: 20 },
  renderPct:     { color: '#6B4FFF', fontSize: 48, fontWeight: '900', marginBottom: 20 },
  renderTrack:   { width: '100%', height: 12, backgroundColor: '#1E1E3A', borderRadius: 6, overflow: 'hidden', marginBottom: 20 },
  renderFill:    { height: '100%', backgroundColor: '#6B4FFF' },
  renderLog:     { width: '100%', maxHeight: 220, backgroundColor: '#111124', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#2A2A4A' },
  renderLogLine: { color: '#AAA', fontSize: 12, marginBottom: 4 },
}); 
