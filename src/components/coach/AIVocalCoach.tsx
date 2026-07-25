// ═══════════════════════════════════════════════════════════
// AIVocalCoach.tsx — Vocal Coach UI + Engine
// src/components/coach/AIVocalCoach.tsx
// utils at: ../../utils/
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, ActivityIndicator, Switch,
} from 'react-native';
import * as Speech from 'expo-speech';

import type { AICoachState } from '../../utils/types';
import { EFFECT_BURSTS } from '../../utils/constants';
import { pitchAccuracyScore, noteNameToFrequency, analyseVocalRange } from '../../utils/audioHelpers';
import {
  runCoachEngine, shouldCoachPause, getDemonstrationLine,
  getSessionStartLine, generateContentAdvice, initialCoachState,
} from './coachEngine';

// Optional AudioContext for tone demonstration
let AudioContext: any = null;
try { AudioContext = require('react-native-audio-api').AudioContext; } catch { AudioContext = null; }

// ─── FUN MODE (default) ────────────────────────────────────
// WHY: coachEngine.ts's strict/correcting lines ("You sang X — target is Y.
// Listen again.") and numeric scoring are exactly right for a serious
// vocalist doing focused practice, but they read as harsh grading for a
// casual creator making a 20-second clip. Fun Mode keeps the SAME
// underlying pitch tracking, just swaps the tone of what gets spoken/shown
// and never auto-pauses the recording. Practice Mode (opt-in) restores the
// full strict coach exactly as coachEngine.ts already defines it.
const FUN_NUDGE_LINES = [
  "Ooh, let's try that bit again — you got this! 🎤",
  'Close one! Run it back 🔁',
  "Almost! One more time, you're close.",
  'Reset and go again — no stress.',
];

const FUN_SESSION_END_LINES = [
  'That was a vibe! Nice take 🔥',
  "Loved that energy — that's a wrap!",
  'Great session! That one felt good 🎶',
  "That's a solid take — proud of that one!",
];

function pickFun<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

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
  // WHY: Fun Mode (encouragement only, never interrupts) is the default —
  // Practice Mode (strict correction + auto-pause) is opt-in via the toggle.
  const [practiceMode, setPracticeMode] = useState(false);

  const freqHistory    = useRef<number[]>([]);
  const accuracyHist   = useRef<number[]>([]);
  const feedbackAnim   = useRef(new Animated.Value(0.7)).current;
  const pulseAnim      = useRef(new Animated.Value(1)).current;
  const mountedRef     = useRef(true);

  // WHY: EFFECT_BURSTS already existed in constants.ts, unused — reusing it
  // here so a genuinely good moment FEELS like something (a burst of emoji),
  // instead of a clinical percentage. Shown for real 'celebrating' moments
  // in both Fun and Practice Mode — that mood is never softened away.
  const [burstEmoji, setBurstEmoji] = useState<string | null>(null);
  const burstAnim = useRef(new Animated.Value(0)).current;

  function triggerBurst() {
    const burst = EFFECT_BURSTS[Math.floor(Math.random() * EFFECT_BURSTS.length)];
    setBurstEmoji(burst.emoji);
    burstAnim.setValue(0);
    Animated.sequence([
      Animated.timing(burstAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(burstAnim, { toValue: 0, duration: 550, delay: 400, useNativeDriver: true }),
    ]).start(() => setBurstEmoji(null));
  }

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

  // WHY: The mic stays hot the whole time you're recording — if the coach
  // talks through the speaker while it's live, the mic picks that voice
  // right back up and it ends up baked into your take. This silently
  // pauses actual capture around any spoken line (NOT the same as the
  // visible Practice Mode pause panel — no UI shown, just the mic muting
  // itself for the ~1-2 seconds the coach is talking, then resuming).
  const speakMicSafe = useCallback((text: string, priority = false) => {
    onPauseRequest();
    if (priority) Speech.stop();
    setIsSpeaking(true);
    Speech.speak(text, {
      language:  'en-NG',
      pitch:     1.0,
      rate:      0.95,
      onDone:    () => { if (mountedRef.current) setIsSpeaking(false); onResumeRequest(); },
      onStopped: () => { if (mountedRef.current) setIsSpeaking(false); onResumeRequest(); },
      onError:   () => { if (mountedRef.current) setIsSpeaking(false); onResumeRequest(); },
    });
  }, [onPauseRequest, onResumeRequest]);

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
  // WHY: isVisible removed from this guard — the coach should start talking
  // the moment recording begins, even if you're on the Record tab, not
  // only if you happen to already be on the Coach tab when you hit record.
  useEffect(() => {
    if (isRecording) {
      const line = getSessionStartLine();
      setCoachState(s => ({ ...s, isActive: true, feedback: line }));
      setTimeout(() => speakMicSafe(line), 500);
      freqHistory.current  = [];
      accuracyHist.current = [];
    }
    if (!isRecording && coachState.isActive) {
      handleSessionEnd();
    }
  }, [isRecording]);

  // Real-time pitch processing
  // WHY: isVisible removed here too — this is the loop that actually
  // speaks corrections mid-take. It needs to run continuously while
  // recording, not only while the Coach tab happens to be on screen.
  useEffect(() => {
    if (!isRecording || isPaused) return;

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
      // In Fun Mode, soften strict/correcting moments into an upbeat nudge
      // instead of technical grading — same underlying tracking, friendlier
      // surface. Practice Mode shows coachEngine's output exactly as-is.
      const isHarshMoment = updated.mood === 'strict' || updated.mood === 'correcting';
      const display = (!practiceMode && isHarshMoment)
        ? { ...updated, mood: 'encouraging' as const, feedback: pickFun(FUN_NUDGE_LINES), coachTip: '' }
        : updated;

      setCoachState({ ...display, vuLevel });
      flashFeedback();

      if (display.mood === 'strict' || display.mood === 'celebrating') {
        speakMicSafe(display.feedback, true);
        if (display.mood === 'celebrating') triggerBurst();
      } else if (!practiceMode && display.feedback !== coachState.feedback) {
        // Fun Mode still talks on the softened nudge/encouraging lines —
        // just never the harsh technical ones.
        speakMicSafe(display.feedback, true);
      }

      // Demonstration + auto-pause are Practice Mode only — Fun Mode never
      // interrupts a take. willHardPause tracks whether the modal-driven
      // pause (below) is about to fire this same pass — if so, skip this
      // lighter silent pause/resume entirely, since the hard pause already
      // covers it and its resume is manual (user taps "Got it"), not timed.
      const willHardPause = practiceMode && shouldCoachPause(accuracyHist.current);

      if (practiceMode && updated.mood === 'strict' && updated.correctionCount >= 1 && !willHardPause) {
        onPauseRequest();
        setTimeout(() => {
          speak(getDemonstrationLine());
          setTimeout(() => {
            demonstrateNote(targetNote);
            setTimeout(() => onResumeRequest(), 1500);
          }, 1500);
        }, 2000);
      }

      if (willHardPause) {
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
  }, [frequency, note, isRecording, practiceMode]);

  function handleSessionEnd() {
    const range  = analyseVocalRange(freqHistory.current);
    const advice = generateContentAdvice(
      vibe, coachState.sessionScore, range, coachState.recordingTakes,
    );
    const score   = coachState.sessionScore;
    const endLine = practiceMode
      ? `Session done. Score: ${score} out of 100. ${
          score > 75 ? 'That was solid work.' :
          score > 50 ? 'Decent session. Keep practising.' :
          'We need to work on consistency. But good effort for showing up.'
        }`
      : pickFun(FUN_SESSION_END_LINES);
    setCoachState(s => ({ ...s, isActive: false, contentAdvice: advice, feedback: endLine }));
    setShowAdvice(true);
    speak(endLine);
  }

  function handleResume() {
    setIsPaused(false);
    onResumeRequest();
    speak('Okay. Your turn. Go from the top of that phrase.');
  }

  const moodColor: Record<string, string> = {
    celebrating: '#00ff88', encouraging: '#FFD700',
    strict: '#FF4040', correcting: '#FF8C00', idle: '#888',
  };
  const ac = coachState.pitchAccuracy;
  const accuracyColor = ac >= 80 ? '#00ff88' : ac >= 50 ? '#FFD700' : '#FF4040';

  // WHY: the burst renders REGARDLESS of isVisible/tab — you should see the
  // celebration even from the Record tab, not only if you happen to be on
  // Coach. Only the full panel below stays gated behind isVisible.
  const burstOverlay = burstEmoji ? (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.burstOverlay,
        {
          opacity: burstAnim,
          transform: [{
            scale: burstAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.8] }),
          }],
        },
      ]}
    >
      <Text style={styles.burstEmoji}>{burstEmoji}</Text>
    </Animated.View>
  ) : null;

  if (!isVisible) return burstOverlay;

  return (
    <>
      {burstOverlay}
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
        <View style={styles.headerControls}>
          <View style={styles.practiceToggle}>
            <Text style={styles.practiceToggleLabel}>Practice{'\n'}Mode</Text>
            <Switch
              value={practiceMode}
              onValueChange={setPracticeMode}
              trackColor={{ false: '#2A2A4A', true: '#6B4FFF' }}
              thumbColor={practiceMode ? '#FFF' : '#666'}
            />
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats — full technical readout only in Practice Mode. Fun Mode
          keeps it simple: just what note you're on and the target. */}
      <View style={styles.statsRow}>
        {(practiceMode
          ? [
              { label: 'Your Note', value: coachState.currentNote, color: accuracyColor },
              { label: 'Target',    value: coachState.targetNote,  color: '#AAF'         },
              { label: 'Accuracy',  value: `${Math.round(ac)}%`,   color: accuracyColor  },
              { label: 'Score',     value: String(coachState.sessionScore), color: '#FFD700' },
            ]
          : [
              { label: 'Your Note', value: coachState.currentNote, color: accuracyColor },
              { label: 'Target',    value: coachState.targetNote,  color: '#AAF'         },
            ]
        ).map(s => (
          <View key={s.label} style={styles.statBox}>
            <Text style={styles.statLabel}>{s.label}</Text>
            <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
          </View>
        ))}
      </View>

      {/* Accuracy bar — Practice Mode only, it's a precision cue that
          reads as a grade-in-progress, which Fun Mode intentionally avoids */}
      {practiceMode && (
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${ac}%` as any, backgroundColor: accuracyColor }]} />
        </View>
      )}

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
    </>
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
  headerControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  practiceToggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  practiceToggleLabel: { color: '#888', fontSize: 9, fontWeight: '600', textAlign: 'right', lineHeight: 11 },

  burstOverlay: {
    position: 'absolute', top: '35%', left: 0, right: 0,
    alignItems: 'center', justifyContent: 'center', zIndex: 999,
  },
  burstEmoji: { fontSize: 72 },
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
