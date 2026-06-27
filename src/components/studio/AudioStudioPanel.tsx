// ═══════════════════════════════════════════════════════════
// AudioStudioPanel.tsx — Full Professional Audio Studio
// FIXED: StudioWave isActive prop, vu.isActive, rec state comparison
// ═══════════════════════════════════════════════════════════

import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';

import { useVUMeter }        from '../../hooks/useVUMeter';
import { usePitchDetection } from '../../hooks/usePitchDetection';
import { useRecording }      from '../../hooks/useRecording';
import StudioWave            from './StudioWave';
import MetronomePanel        from './MetronomePanel';
import VoiceEffectsPanel     from './VoiceEffectsPanel';
import StudioEditPanel       from './StudioEditPanel';
import AIVocalCoach          from '../coach/AIVocalCoach';
import { bakeVoiceEffect }   from '../../utils/ffmpegHelpers';
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

  const vu    = useVUMeter();
  const rec   = useRecording();
  const pitch = usePitchDetection(vu.getBuffer);

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
      await rec.start();
    } else if (rec.state === 'recording') {
      await rec.pause();
    } else if (rec.state === 'paused') {
      await rec.resume();
    }
  }

  async function handleStop() {
    const uri = await rec.stop();
    if (!uri) return;
    setTakes(t => t + 1);
    await handleBake(uri);
  }

  async function handleBake(rawUri: string) {
    setIsBaking(true);
    try {
      const result = await bakeVoiceEffect(rawUri, selectedEffect, studioEdit);
      if (result.error) {
        Alert.alert('Processing issue', `Used original audio. Error: ${result.error}`);
      }
      setBakedUri(result.uri);
    } catch {
      Alert.alert('Error', 'Could not process audio. Using original.');
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
                  <Text style={styles.stopBtnText}>⏹ Stop & Bake</Text>
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
              if (rec.uri) handleBake(rec.uri);
            }}
          />
        )}

        {activeTab === 'edit' && (
          <StudioEditPanel
            edit={studioEdit}
            duration={rec.durationMs / 1000}
            onChange={edit => {
              setStudioEdit(edit);
              if (rec.uri) handleBake(rec.uri);
            }}
          />
        )}

        {activeTab === 'metronome' && (
          <MetronomePanel isVisible />
        )}

        {activeTab === 'coach' && (
          <AIVocalCoach
            isRecording={isRecording}
            isVisible
            frequency={pitch.frequency}
            note={pitch.note}
            vuLevel={vu.level}
            vibe={vibe}
            onPauseRequest={() => rec.pause()}
            onResumeRequest={() => rec.resume()}
            onClose={() => setActiveTab('record')}
          />
        )}
      </ScrollView>
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
}); 
