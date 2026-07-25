// ═══════════════════════════════════════════════════════════
// AudioStudioPanel.tsx — Full Professional Audio Studio
// FIXED: StudioWave isActive prop, vu.isActive, rec state comparison
// ═══════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { useVUMeter }        from '../../hooks/useVUMeter';
import { usePitchDetection } from '../../hooks/usePitchDetection';
import { useRecording }      from '../../hooks/useRecording';
import StudioWave            from './StudioWave';
import MetronomePanel        from './MetronomePanel';
import VoiceEffectsPanel     from './VoiceEffectsPanel';
import StudioEditPanel       from './StudioEditPanel';
import AIVocalCoach          from '../coach/AIVocalCoach';
import BeatPicker from './BeatPicker';
import { bakeVoiceEffect }   from '../../utils/dsp/bakeEngine';
import { VOICE_EFFECTS }     from '../../utils/constants';
import type { VoiceEffect, StudioEdit } from '../../utils/types';

type StudioTab = 'record' | 'effects' | 'edit' | 'metronome' | 'coach';

interface Props {
  vibe:       string;
  onComplete: (uri: string) => void;
  onClose:    () => void;
  username?:  string;
}

const DEFAULT_EDIT: StudioEdit = {
  trimStart:   0,
  trimEnd:     0,
  reverse:     false,
  chorus:      false,
  normalise:   true,
  noiseGate:   true,
  delay:       0,
  reverbLevel: 0,
  pitchShift:  0,
};

export default function AudioStudioPanel({ vibe, onComplete, onClose, username }: Props) {
  const [activeTab,      setActiveTab]      = useState<StudioTab>('record');
  const [selectedEffect, setSelectedEffect] = useState<VoiceEffect>(VOICE_EFFECTS[0]);
  const [studioEdit,     setStudioEdit]     = useState<StudioEdit>(DEFAULT_EDIT);
  const [isBaking,       setIsBaking]       = useState(false);
  const [bakedUri,       setBakedUri]       = useState<string | null>(null);
  const [takes,          setTakes]          = useState(0);

  // WHY: FX/Edit changes no longer auto-bake on every change — they just
  // flip this flag so the persistent "Apply Effects" bar shows up. The
  // user decides when to actually re-process, instead of every slider
  // drag firing a full render pass.
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(false);

  // WHY: hidden by default — Note/Freq/Cents reads like DAW software to a
  // first-time user. "Advanced" reveals it for anyone who wants it.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ─── BEAT (sing-over backing track) ──────────────────────
  const [beatUri,    setBeatUri]    = useState<string | null>(null);
  const [beatName,   setBeatName]   = useState<string | null>(null);
  const [beatVolume, setBeatVolume] = useState(0.5);

  const vu    = useVUMeter();
  const rec   = useRecording();
  const pitch = usePitchDetection(vu.getBuffer);

  // Same "create once, .replace() on change" pattern as the take preview
  // player below — useAudioPlayer does not react to its argument changing.
  const beatPlayer = useAudioPlayer(null);
  useEffect(() => {
    if (beatUri) {
      try { beatPlayer.replace(beatUri); beatPlayer.loop = true; }
      catch (err) { console.warn('[AudioStudioPanel] beatPlayer.replace failed:', err); }
    }
  }, [beatUri, beatPlayer]);

  // ─── PLAYBACK PREVIEW ────────────────────────────────────
  // WHY: useAudioPlayer only reads its argument ONCE on creation — it does
  // NOT react to the uri changing later (confirmed via Expo's own source +
  // a known open issue on this exact behavior). So we create the player
  // once with a null source, then imperatively .replace() it whenever the
  // playable uri changes, instead of passing the uri directly.
  const playbackUri = bakedUri ?? rec.uri;
  const player       = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);

  useEffect(() => {
    if (playbackUri) {
      try { player.replace(playbackUri); } catch (err) { console.warn('[AudioStudioPanel] player.replace failed:', err); }
    }
  }, [playbackUri, player]);

  function handlePlayPreview() {
    if (!playbackUri) return;
    // expo-audio does NOT auto-reset position after playback finishes —
    // seekTo(0) first so repeated preview taps always play from the start.
    try {
      player.seekTo(0);
      player.play();
    } catch (err) {
      console.warn('[AudioStudioPanel] playback failed:', err);
    }
  }

  function handleStopPreview() {
    try { player.pause(); } catch { /* ignore */ }
  }

  // WHY: Start VU + pitch when recording, stop otherwise
  // FIX: compare rec.state string directly — avoids boolean overlap error
  useEffect(() => {
    if (rec.state === 'recording') {
      vu.start();
      pitch.start();
    } else {
      pitch.stop();
      vu.stop();
    }
  }, [rec.state]);

  async function handleRecord() {
    if (rec.state === 'idle' || rec.state === 'done') {
      setBakedUri(null);
      setHasUnappliedChanges(false);
      await rec.start();
      if (beatUri) { try { beatPlayer.seekTo(0); beatPlayer.play(); } catch { /* ignore */ } }
    } else if (rec.state === 'recording') {
      await rec.pause();
      if (beatUri) { try { beatPlayer.pause(); } catch { /* ignore */ } }
    } else if (rec.state === 'paused') {
      await rec.resume();
      if (beatUri) { try { beatPlayer.play(); } catch { /* ignore */ } }
    }
  }

  async function handleStop() {
    const uri = await rec.stop();
    if (beatUri) { try { beatPlayer.pause(); } catch { /* ignore */ } }
    if (!uri) return;
    setTakes(t => t + 1);
    await handleBake(uri);
  }

  async function handleBake(rawUri: string) {
    setIsBaking(true);
    try {
      const result = await bakeVoiceEffect(
        rawUri, selectedEffect, studioEdit,
        beatUri ? { uri: beatUri, volume: beatVolume } : null,
      );
      if (result.error) {
        Alert.alert('Processing issue', `Used original audio. Error: ${result.error}`);
      } else if (result.warning) {
        Alert.alert('Heads up', result.warning);
      }
      setBakedUri(result.uri);
      setHasUnappliedChanges(false);
    } catch (err) {
      Alert.alert('Processing issue', `Used original audio. Error: ${err instanceof Error ? err.message : String(err)}`);
      setBakedUri(rawUri);
    } finally {
      setIsBaking(false);
    }
  }

  async function handleDiscard() {
    await rec.discard();
    setBakedUri(null);
    pitch.stop();
    vu.stop();
  }

  function handleQuickFire() {
    // Excludes 'none' (no effect, defeats the point) and 'autotune'
    // (not baked yet — see bakeEngine.ts) — everything else is fair game.
    const funEffects = VOICE_EFFECTS.filter(e => e.id !== 'none' && e.id !== 'autotune');
    const pick = funEffects[Math.floor(Math.random() * funEffects.length)];
    setSelectedEffect(pick);
    setHasUnappliedChanges(true);
  }

  function handleDone() {
    const uri = bakedUri ?? rec.uri;
    if (!uri) {
      Alert.alert('No Recording', 'Record something first.');
      return;
    }
    onComplete(uri);
  }

  function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
  }

  const isRecording = rec.state === 'recording';
  const hasTake     = rec.uri !== null || bakedUri !== null;

  const TABS: { id: StudioTab; label: string; emoji: string }[] = [
    { id: 'record',    label: 'Record', emoji: '🎤' },
    { id: 'effects',   label: 'FX',     emoji: '🎛' },
    { id: 'edit',      label: 'Edit',   emoji: '✂️' },
    { id: 'metronome', label: 'Beat',   emoji: '🥁' },
    { id: 'coach',     label: 'Coach',  emoji: '🎙️' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🎚 Audio Studio</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.tab, activeTab === tab.id && styles.tabActive]}
            onPress={() => setActiveTab(tab.id)}
          >
            <Text style={styles.tabEmoji}>{tab.emoji}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.id && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {activeTab === 'record' && (
          <View style={styles.recordTab}>
            {/* WHY: isActive prop fixed — StudioWave uses isActive not active */}
            <View style={styles.vuContainer}>
              <StudioWave
                level={vu.level}
                isActive={vu.isActive}
                barCount={40}
                height={80}
              />
            </View>

            {rec.state === 'idle' && (
              <TouchableOpacity style={styles.quickFireBtn} onPress={handleQuickFire}>
                <Text style={styles.quickFireText}>🔥 Quick Fire — surprise me with a fun voice</Text>
              </TouchableOpacity>
            )}

            {showAdvanced ? (
              <View style={styles.pitchRow}>
                <View style={styles.pitchBox}>
                  <Text style={styles.pitchLabel}>Note</Text>
                  <Text style={styles.pitchValue}>{pitch.note}</Text>
                </View>
                <View style={styles.pitchBox}>
                  <Text style={styles.pitchLabel}>Freq</Text>
                  <Text style={styles.pitchValue}>
                    {pitch.frequency > 0 ? `${Math.round(pitch.frequency)}Hz` : '—'}
                  </Text>
                </View>
                <View style={styles.pitchBox}>
                  <Text style={styles.pitchLabel}>Cents</Text>
                  <Text style={[styles.pitchValue, { color: Math.abs(pitch.cents) < 15 ? '#00FF88' : '#FF6B35' }]}>
                    {pitch.cents > 0 ? `+${pitch.cents}` : pitch.cents}
                  </Text>
                </View>
                <View style={styles.pitchBox}>
                  <Text style={styles.pitchLabel}>Takes</Text>
                  <Text style={styles.pitchValue}>{takes}</Text>
                </View>
              </View>
            ) : (
              <View style={styles.simpleRow}>
                <Text style={styles.simpleTakes}>
                  {takes > 0 ? `🎙 Take ${takes}` : '🎙 Ready to record'}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.advancedToggle}
              onPress={() => setShowAdvanced(v => !v)}
            >
              <Text style={styles.advancedToggleText}>
                {showAdvanced ? '▲ Hide advanced' : '▼ Advanced'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.duration}>{formatDuration(rec.durationMs)}</Text>

            {rec.permissionError && (
              <Text style={styles.errorText}>{rec.permissionError}</Text>
            )}

            <View style={styles.transport}>
              <TouchableOpacity
                style={[styles.recBtn, isRecording && styles.recBtnActive]}
                onPress={handleRecord}
                disabled={isBaking}
              >
                <Text style={styles.recBtnText}>
                  {rec.state === 'idle'      ? '⏺ Record'
                   : rec.state === 'recording' ? '⏸ Pause'
                   : rec.state === 'paused'    ? '▶ Resume'
                   : '⏺ New Take'}
                </Text>
              </TouchableOpacity>

              {(rec.state === 'recording' || rec.state === 'paused') && (
                <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
                  <Text style={styles.stopBtnText}>⏹ Done Recording</Text>
                </TouchableOpacity>
              )}

              {hasTake && rec.state === 'done' && !isBaking && (
                <TouchableOpacity style={styles.discardBtn} onPress={handleDiscard}>
                  <Text style={styles.discardText}>🗑 Discard</Text>
                </TouchableOpacity>
              )}
            </View>

            {isBaking && (
              <View style={styles.bakingRow}>
                <ActivityIndicator color="#6B4FFF" />
                <Text style={styles.bakingText}>Applying effects…</Text>
              </View>
            )}

            {selectedEffect.id !== 'none' && (
              <View style={styles.effectBadge}>
                <Text style={styles.effectBadgeText}>
                  {selectedEffect.emoji} {selectedEffect.name} applied
                </Text>
              </View>
            )}

            {hasTake && rec.state === 'done' && !isBaking && (
              <TouchableOpacity
                style={styles.playBtn}
                onPress={playerStatus?.playing ? handleStopPreview : handlePlayPreview}
              >
                <Text style={styles.playBtnText}>
                  {playerStatus?.playing ? '⏸ Pause Preview' : '▶️ Play Take'}
                </Text>
              </TouchableOpacity>
            )}

            {hasTake && !isBaking && (
              <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
                <Text style={styles.doneBtnText}>✅ Use This Take</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {activeTab === 'effects' && (
          <VoiceEffectsPanel
            selectedId={selectedEffect.id}
            onSelect={effect => {
              setSelectedEffect(effect);
              setHasUnappliedChanges(true);
            }}
          />
        )}

        {activeTab === 'edit' && (
          <StudioEditPanel
            edit={studioEdit}
            duration={rec.durationMs / 1000}
            onChange={edit => {
              setStudioEdit(edit);
              setHasUnappliedChanges(true);
            }}
          />
        )}

        {activeTab === 'metronome' && (
          <>
            <MetronomePanel isVisible />
            <BeatPicker
              beatUri={beatUri}
              beatName={beatName}
              beatVolume={beatVolume}
              onSelect={(uri, name) => { setBeatUri(uri); setBeatName(name); }}
              onRemove={() => {
                setBeatUri(null);
                setBeatName(null);
                try { beatPlayer.pause(); } catch { /* ignore */ }
              }}
              onVolumeChange={setBeatVolume}
            />
          </>
        )}

        {/* AIVocalCoach is now ALWAYS mounted (not gated by activeTab) so it
            keeps listening and speaking no matter which tab you're viewing.
            isVisible now reflects the REAL tab state — it only controls
            whether the visual panel renders; the coach engine itself
            (pitch processing + speech) runs regardless. See AIVocalCoach.tsx
            for the matching change to its internal effect guards. */}
        <AIVocalCoach
          isRecording={isRecording}
          isVisible={activeTab === 'coach'}
          frequency={pitch.frequency}
          note={pitch.note}
          vuLevel={vu.level}
          vibe={vibe}
          onPauseRequest={() => { rec.pause(); if (beatUri) { try { beatPlayer.pause(); } catch { /* ignore */ } } }}
          onResumeRequest={() => { rec.resume(); if (beatUri) { try { beatPlayer.play(); } catch { /* ignore */ } } }}
          onClose={() => setActiveTab('record')}
        />
      </ScrollView>

      {/* Persistent Apply bar — shows on ANY tab whenever FX/Edit changed
          since the last bake, so the user never has to hunt for a way to
          actually hear their new settings. */}
      {hasUnappliedChanges && rec.uri && rec.state === 'done' && !isBaking && (
        <View style={styles.applyBar}>
          <Text style={styles.applyBarText}>🎛 You changed effects — apply to hear them</Text>
          <TouchableOpacity
            style={styles.applyBtn}
            onPress={() => handleBake(rec.uri!)}
          >
            <Text style={styles.applyBtnText}>Apply Effects</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0A0A1A' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A3A' },
  title:          { color: '#FFF', fontWeight: '800', fontSize: 18 },
  closeBtn:       { color: '#888', fontSize: 20, padding: 4 },
  tabBar:         { flexDirection: 'row', backgroundColor: '#0D0D20', borderBottomWidth: 1, borderBottomColor: '#1A1A3A' },
  tab:            { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 3 },
  tabActive:      { borderBottomWidth: 2, borderBottomColor: '#6B4FFF' },
  tabEmoji:       { fontSize: 16 },
  tabLabel:       { color: '#666', fontSize: 10, fontWeight: '600' },
  tabLabelActive: { color: '#FFF' },
  scroll:         { flex: 1 },
  recordTab:      { padding: 16, gap: 14 },
  vuContainer:    { backgroundColor: '#111124', borderRadius: 14, padding: 12, alignItems: 'center' },
  pitchRow:       { flexDirection: 'row', gap: 8 },
  pitchBox:       { flex: 1, backgroundColor: '#111124', borderRadius: 12, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2A2A4A' },
  pitchLabel:     { color: '#555', fontSize: 10, marginBottom: 4 },
  pitchValue:     { color: '#FFF', fontWeight: '800', fontSize: 16 },
  duration:       { color: '#FFF', fontSize: 48, fontWeight: '200', textAlign: 'center', letterSpacing: 2 },
  errorText:      { color: '#FF4040', textAlign: 'center', fontSize: 13, backgroundColor: '#1A0A0A', borderRadius: 8, padding: 10 },
  transport:      { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  recBtn:         { backgroundColor: '#6B4FFF', borderRadius: 50, paddingHorizontal: 28, paddingVertical: 16, alignItems: 'center', minWidth: 140 },
  recBtnActive:   { backgroundColor: '#FF4040' },
  recBtnText:     { color: '#FFF', fontWeight: '800', fontSize: 15 },
  stopBtn:        { backgroundColor: '#1E1E3A', borderRadius: 50, paddingHorizontal: 20, paddingVertical: 16, alignItems: 'center', borderWidth: 1, borderColor: '#3A3A5A' },
  stopBtnText:    { color: '#FFF', fontWeight: '700' },
  discardBtn:     { justifyContent: 'center', padding: 12 },
  discardText:    { color: '#FF6B35', fontWeight: '600' },
  bakingRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10 },
  bakingText:     { color: '#AAA', fontSize: 13 },
  effectBadge:    { backgroundColor: '#1A1A3A', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'center', borderWidth: 1, borderColor: '#6B4FFF' },
  effectBadgeText:{ color: '#AAF', fontSize: 12, fontWeight: '600' },
  doneBtn:        { backgroundColor: '#00AA55', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  doneBtnText:    { color: '#FFF', fontWeight: '800', fontSize: 16 },

  simpleRow:      { alignItems: 'center', paddingVertical: 6 },
  simpleTakes:    { color: '#AAA', fontSize: 14, fontWeight: '600' },
  advancedToggle: { alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 10 },
  advancedToggleText: { color: '#6B4FFF', fontSize: 12, fontWeight: '700' },

  quickFireBtn: {
    backgroundColor: '#2A1030', borderRadius: 20, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#FF6B35',
  },
  quickFireText: { color: '#FF9F5B', fontWeight: '700', fontSize: 13 },

  playBtn:        { backgroundColor: '#1E1E3A', borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#6B4FFF' },
  playBtnText:    { color: '#FFF', fontWeight: '700', fontSize: 14 },

  applyBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1A1A3A', borderTopWidth: 1, borderTopColor: '#6B4FFF',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  applyBarText: { color: '#DDD', fontSize: 12, flex: 1 },
  applyBtn:     { backgroundColor: '#6B4FFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  applyBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
});  
