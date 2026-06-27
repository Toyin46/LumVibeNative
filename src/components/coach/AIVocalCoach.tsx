// ═══════════════════════════════════════════════════════════
// AIVocalCoach.tsx — Vocal Coach UI + Engine
// src/components/coach/AIVocalCoach.tsx
// utils at: ../../utils/
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, ActivityIndicator,
} from 'react-native';
import * as Speech from 'expo-speech';

import type { AICoachState } from '../../utils/types';
import { pitchAccuracyScore, noteNameToFrequency, analyseVocalRange } from '../../utils/audioHelpers';
import {
  runCoachEngine, shouldCoachPause, getDemonstrationLine,
  getSessionStartLine, generateContentAdvice, initialCoachState,
} from './coachEngine';

// Optional AudioContext for tone demonstration
let AudioContext: any = null;
try { AudioContext = require('react-native-audio-api').AudioContext; } catch { AudioContext = null; }

interface Props {
  isRecording:    boolean;
  isVisible:      boolean;
  frequency:      number;
  note:           string;
  vuLevel:        number;
  vibe:           string;
  targetNote?:    string;
  onPauseRequest: () => void;
  onResumeRequest:() => void;
  onClose:        () => void;
}

const AIVocalCoach = memo(function AIVocalCoach({
  isRecording, isVisible, frequency, note, vuLevel,
  vibe, targetNote = 'A4', onPauseRequest, onResumeRequest, onClose,
}: Props) {
  const [coachState,   setCoachState]   = useState<AICoachState>(initialCoachState());
  const [isPaused,     setIsPaused]     = useState(false);
  const [showAdvice,   setShowAdvice]   = useState(false);
  const [isSpeaking,   setIsSpeaking]   = useState(false);

  const freqHistory    = useRef<number[]>([]);
  const accuracyHist   = useRef<number[]>([]);
  const feedbackAnim   = useRef(new Animated.Value(0.7)).current;
  const pulseAnim      = useRef(new Animated.Value(1)).current;
  const mountedRef     = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; Speech.stop(); };
  }, []);

  // Pulse when speaking
  useEffect(() => {
    if (isSpeaking) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 400, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1.0,  duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isSpeaking]);

  const speak = useCallback((text: string, priority = false) => {
    if (priority) Speech.stop();
    setIsSpeaking(true);
    Speech.speak(text, {
      language:  'en-NG',
      pitch:     1.0,
      rate:      0.95,
      onDone:    () => { if (mountedRef.current) setIsSpeaking(false); },
      onStopped: () => { if (mountedRef.current) setIsSpeaking(false); },
      onError:   () => { if (mountedRef.current) setIsSpeaking(false); },
    });
  }, []);

  // Demonstrate note with oscillator
  const demonstrateNote = useCallback(async (n: string) => {
    if (!AudioContext) return;
    try {
      const ctx  = new AudioContext({ sampleRate: 44100 });
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type              = 'sine';
      osc.frequency.value   = noteNameToFrequency(n);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime + 0.8);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 1.3);
      setTimeout(() => ctx.close().catch(() => null), 1500);
    } catch { /* ignore */ }
  }, []);

  function flashFeedback() {
    Animated.sequence([
      Animated.timing(feedbackAnim, { toValue: 1,   duration: 200, useNativeDriver: true }),
      Animated.timing(feedbackAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
    ]).start();
  }

  // Session start / stop
  useEffect(() => {
    if (isRecording && isVisible) {
      const line = getSessionStartLine();
      setCoachState(s => ({ ...s, isActive: true, feedback: line }));
      setTimeout(() => speak(line), 500);
      freqHistory.current  = [];
      accuracyHist.current = [];
    }
    if (!isRecording && coachState.isActive) {
      handleSessionEnd();
    }
  }, [isRecording]);

  // Real-time pitch processing
  useEffect(() => {
    if (!isRecording || !isVisible || isPaused) return;

    const accuracy = pitchAccuracyScore(frequency, targetNote);

    if (frequency > 0) {
      freqHistory.current.push(frequency);
      if (freqHistory.current.length > 200) freqHistory.current.shift();
    }
    accuracyHist.current.push(accuracy);
    if (accuracyHist.current.length > 10) accuracyHist.current.shift();

    const updated = runCoachEngine(
      coachState, accuracy, frequency, note, targetNote, Date.now(),
    );

    if (updated.feedback !== coachState.feedback && updated.feedback) {
      setCoachState({ ...updated, vuLevel });
      flashFeedback();

      if (updated.mood === 'strict' || updated.mood === 'celebrating') {
        speak(updated.feedback, true);
      }

      if (updated.mood === 'strict' && updated.correctionCount >= 1) {
        setTimeout(() => {
          speak(getDemonstrationLine());
          setTimeout(() => demonstrateNote(targetNote), 1500);
        }, 2000);
      }

      if (shouldCoachPause(accuracyHist.current)) {
        setIsPaused(true);
        onPauseRequest();
        speak(`Stop. I'm pausing this. Listen — ${getDemonstrationLine()}`, true);
        setTimeout(() => demonstrateNote(targetNote), 2500);
      }
    } else {
      setCoachState(s => ({
        ...s, vuLevel, pitchAccuracy: accuracy, frequency, currentNote: note,
      }));
    }
  }, [frequency, note, isRecording]);

  function handleSessionEnd() {
    const range  = analyseVocalRange(freqHistory.current);
    const advice = generateContentAdvice(
      vibe, coachState.sessionScore, range, coachState.recordingTakes,
    );
    const score   = coachState.sessionScore;
    const endLine = `Session done. Score: ${score} out of 100. ${
      score > 75 ? 'That was solid work.' :
      score > 50 ? 'Decent session. Keep practising.' :
      'We need to work on consistency. But good effort for showing up.'
    }`;
    setCoachState(s => ({ ...s, isActive: false, contentAdvice: advice, feedback: endLine }));
    setShowAdvice(true);
    speak(endLine);
  }

  function handleResume() {
    setIsPaused(false);
    onResumeRequest();
    speak('Okay. Your turn. Go from the top of that phrase.');
  }

  if (!isVisible) return null;

  const moodColor: Record<string, string> = {
    celebrating: '#00ff88', encouraging: '#FFD700',
    strict: '#FF4040', correcting: '#FF8C00', idle: '#888',
  };
  const ac = coachState.pitchAccuracy;
  const accuracyColor = ac >= 80 ? '#00ff88' : ac >= 50 ? '#FFD700' : '#FF4040';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Animated.Text style={[styles.avatar, { transform: [{ scale: pulseAnim }] }]}>🎙️</Animated.Text>
        <View style={styles.headerText}>
          <Text style={styles.title}>AI Vocal Coach</Text>
          <Text style={[styles.mood, { color: moodColor[coachState.mood] ?? '#888' }]}>
            {coachState.mood === 'idle'        ? 'Listening…'
              : coachState.mood === 'celebrating' ? '🔥 On fire!'
              : coachState.mood === 'strict'      ? '⚡ Focus!'
              : coachState.mood === 'encouraging' ? '💪 Keep going'
              : '🎯 Analysing'}
          </Text>
        </View>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Your Note', value: coachState.currentNote, color: accuracyColor },
          { label: 'Target',    value: coachState.targetNote,  color: '#AAF'         },
          { label: 'Accuracy',  value: `${Math.round(ac)}%`,   color: accuracyColor  },
          { label: 'Score',     value: String(coachState.sessionScore), color: '#FFD700' },
        ].map(s => (
          <View key={s.label} style={styles.statBox}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
          </View>
        ))}
      </View>

      {/* Accuracy bar */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${ac}%` as any, backgroundColor: accuracyColor }]} />
      </View>

      {/* Feedback bubble */}
      {!!coachState.feedback && (
        <Animated.View style={[styles.bubble, { opacity: feedbackAnim }]}>
          <Text style={styles.bubbleText}>{coachState.feedback}</Text>
          {isSpeaking && <ActivityIndicator size="small" color="#00ff88" style={{ marginTop: 6 }} />}
        </Animated.View>
      )}

      {/* Coach tip */}
      {!!coachState.coachTip && (
        <Text style={styles.tip}>{coachState.coachTip}</Text>
      )}

      {/* Paused panel */}
      {isPaused && (
        <View style={styles.pausePanel}>
          <Text style={styles.pauseTitle}>⏸ Recording Paused</Text>
          <Text style={styles.pauseSub}>Coach is demonstrating the correct phrase</Text>
          <View style={styles.pauseBtns}>
            <TouchableOpacity style={styles.demoBtn} onPress={() => demonstrateNote(targetNote)}>
              <Text style={styles.demoBtnText}>🎵 Hear again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
              <Text style={styles.resumeBtnText}>✅ Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Content advice */}
      {showAdvice && coachState.contentAdvice && (
        <ScrollView style={styles.adviceScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.adviceTitle}>📊 Your Content Strategy</Text>

          {[
            { section: '🎯 Best Platforms',             items: coachState.contentAdvice.platforms,         color: '#FFF'     },
            { section: '🎬 Content Types For You',      items: coachState.contentAdvice.contentTypes,      color: '#FFF'     },
            { section: '🕐 Best Times to Post',         items: coachState.contentAdvice.postingTimes,      color: '#FFF'     },
            { section: '✍️ Caption Tips',               items: coachState.contentAdvice.captionTips,       color: '#FFF'     },
            { section: '#️⃣ Hashtags',                   items: coachState.contentAdvice.hashtagSets,       color: '#AAF'     },
            { section: '💪 Your Strengths',             items: coachState.contentAdvice.genreStrengths,    color: '#00ff88'  },
            { section: '📈 Work On This',               items: coachState.contentAdvice.improvementAreas,  color: '#FFD700'  },
          ].map(({ section, items, color }) =>
            items.length > 0 ? (
              <View key={section}>
                <Text style={styles.adviceSection}>{section}</Text>
                {items.map((item: string, i: number) => (
                  <Text key={i} style={[styles.adviceItem, { color }]}>• {item}</Text>
                ))}
              </View>
            ) : null
          )}

          <TouchableOpacity style={styles.closeAdviceBtn} onPress={() => setShowAdvice(false)}>
            <Text style={styles.closeAdviceText}>Close Advice</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
});

export default AIVocalCoach;

const styles = StyleSheet.create({
  container: { backgroundColor: '#0D0D1A', borderRadius: 18, padding: 16, margin: 10, borderWidth: 1, borderColor: '#2A2A4A' },
  header:    { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar:    { fontSize: 32, marginRight: 10 },
  headerText:{ flex: 1 },
  title:     { color: '#FFF', fontWeight: '700', fontSize: 16 },
  mood:      { fontSize: 12, marginTop: 2, fontWeight: '600' },
  closeBtn:  { padding: 6 },
  closeText: { color: '#888', fontSize: 18 },
  statsRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  statBox:   { alignItems: 'center', flex: 1, backgroundColor: '#1A1A2E', borderRadius: 10, paddingVertical: 8, marginHorizontal: 2 },
  statLabel: { color: '#666', fontSize: 10, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '800' },
  barTrack:  { height: 5, backgroundColor: '#1A1A2E', borderRadius: 3, overflow: 'hidden', marginBottom: 14 },
  barFill:   { height: '100%', borderRadius: 3 },
  bubble:    { backgroundColor: '#1A1A2E', borderRadius: 12, padding: 14, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#00ff88' },
  bubbleText:{ color: '#EEE', fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
  tip:       { color: '#888', fontSize: 12, marginBottom: 8, textAlign: 'center' },
  pausePanel:{ backgroundColor: '#1A0A0A', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#FF4040', alignItems: 'center' },
  pauseTitle:{ color: '#FF4040', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  pauseSub:  { color: '#AAA', fontSize: 12, marginBottom: 14, textAlign: 'center' },
  pauseBtns: { flexDirection: 'row', gap: 10 },
  demoBtn:   { backgroundColor: '#1A1A2E', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, borderColor: '#6B4FFF' },
  demoBtnText:  { color: '#AAF', fontWeight: '600' },
  resumeBtn:    { backgroundColor: '#00AA55', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  resumeBtnText:{ color: '#FFF', fontWeight: '700' },
  adviceScroll: { maxHeight: 320, marginTop: 10 },
  adviceTitle:  { color: '#FFF', fontWeight: '700', fontSize: 16, marginBottom: 12 },
  adviceSection:{ color: '#00ff88', fontWeight: '700', fontSize: 13, marginTop: 12, marginBottom: 4 },
  adviceItem:   { fontSize: 12, lineHeight: 20, paddingLeft: 4 },
  closeAdviceBtn:  { backgroundColor: '#1A1A2E', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  closeAdviceText: { color: '#AAA', fontWeight: '600' },
}); 
