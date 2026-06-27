// ═══════════════════════════════════════════════════════════
// MetronomePanel.tsx — BPM Metronome with haptic beat
// Real oscillator tick via react-native-audio-api
// ═══════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { AudioContext } from 'react-native-audio-api';
import { METRONOME_MIN_BPM, METRONOME_MAX_BPM } from '../../utils/constants';

interface Props {
  isVisible: boolean;
  onBpmChange?: (bpm: number) => void;
}

const COUNT_IN_BEATS = 4;

export default function MetronomePanel({ isVisible, onBpmChange }: Props) {
  const [bpm,         setBpm]         = useState(100);
  const [isRunning,   setIsRunning]   = useState(false);
  const [beatIndex,   setBeatIndex]   = useState(-1);   // which beat lit up
  const [countIn,     setCountIn]     = useState(false);
  const [countBeat,   setCountBeat]   = useState(0);

  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const mountedRef   = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopMetronome();
    };
  }, []);

  function playTick(isAccent: boolean) {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext({ sampleRate: 44100 });
      }
      const ctx  = audioCtxRef.current;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.value = isAccent ? 1000 : 800;

      gain.gain.setValueAtTime(isAccent ? 0.4 : 0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.07);
    } catch {
      // Fallback — haptic only
    }
  }

  const tick = useCallback((beat: number, total: number) => {
    const isAccent = beat % total === 0;
    playTick(isAccent);
    if (isAccent) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (mountedRef.current) setBeatIndex(beat % 4);
  }, []);

  function startMetronome(withCountIn: boolean = false) {
    stopMetronome();

    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext({ sampleRate: 44100 });
    }

    const msPerBeat = (60 / bpm) * 1000;
    let beat = 0;

    if (withCountIn) {
      setCountIn(true);
      let countBeats = 0;
      const countInterval = setInterval(() => {
        countBeats++;
        setCountBeat(countBeats);
        playTick(countBeats === 1);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

        if (countBeats >= COUNT_IN_BEATS) {
          clearInterval(countInterval);
          if (mountedRef.current) {
            setCountIn(false);
            setCountBeat(0);
            startLoop(beat, msPerBeat);
          }
        }
      }, msPerBeat);
    } else {
      startLoop(beat, msPerBeat);
    }

    setIsRunning(true);
  }

  function startLoop(startBeat: number, msPerBeat: number) {
    let beat = startBeat;
    intervalRef.current = setInterval(() => {
      tick(beat, 4);
      beat++;
    }, msPerBeat);
  }

  function stopMetronome() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (mountedRef.current) {
      setIsRunning(false);
      setBeatIndex(-1);
      setCountIn(false);
      setCountBeat(0);
    }
  }

  function adjustBpm(delta: number) {
    setBpm(prev => {
      const next = Math.min(METRONOME_MAX_BPM, Math.max(METRONOME_MIN_BPM, prev + delta));
      onBpmChange?.(next);
      // Restart if running
      if (isRunning) {
        stopMetronome();
        setTimeout(() => startMetronome(), 50);
      }
      return next;
    });
  }

  if (!isVisible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🥁 Metronome</Text>

      {/* BPM display */}
      <View style={styles.bpmRow}>
        <TouchableOpacity style={styles.adjBtn} onPress={() => adjustBpm(-5)}>
          <Text style={styles.adjText}>−5</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.adjBtn} onPress={() => adjustBpm(-1)}>
          <Text style={styles.adjText}>−1</Text>
        </TouchableOpacity>

        <View style={styles.bpmDisplay}>
          <Text style={styles.bpmNumber}>{bpm}</Text>
          <Text style={styles.bpmLabel}>BPM</Text>
        </View>

        <TouchableOpacity style={styles.adjBtn} onPress={() => adjustBpm(1)}>
          <Text style={styles.adjText}>+1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.adjBtn} onPress={() => adjustBpm(5)}>
          <Text style={styles.adjText}>+5</Text>
        </TouchableOpacity>
      </View>

      {/* Beat visualiser — 4 dots */}
      {isRunning && (
        <View style={styles.beatRow}>
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={[
                styles.beatDot,
                beatIndex === i && styles.beatDotActive,
                i === 0 && beatIndex === 0 && styles.beatDotAccent,
              ]}
            />
          ))}
        </View>
      )}

      {/* Count-in indicator */}
      {countIn && (
        <Text style={styles.countInText}>
          Count in: {countBeat} / {COUNT_IN_BEATS}
        </Text>
      )}

      {/* Controls */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.ctrlBtn, isRunning && styles.ctrlBtnActive]}
          onPress={() => isRunning ? stopMetronome() : startMetronome()}
        >
          <Text style={styles.ctrlBtnText}>
            {isRunning ? '⏹ Stop' : '▶ Start'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.ctrlBtn}
          onPress={() => startMetronome(true)}
          disabled={isRunning}
        >
          <Text style={[styles.ctrlBtnText, isRunning && { color: '#555' }]}>
            🎯 Count In
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111124',
    borderRadius: 16,
    padding: 16,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#2A2A4A',
  },
  title: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 12,
  },
  bpmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 14,
  },
  adjBtn: {
    backgroundColor: '#1E1E3A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  adjText: { color: '#AAF', fontWeight: '700', fontSize: 13 },
  bpmDisplay: { alignItems: 'center', minWidth: 80 },
  bpmNumber: { color: '#FFF', fontWeight: '900', fontSize: 36 },
  bpmLabel:  { color: '#666', fontSize: 11, marginTop: -4 },

  beatRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 12,
  },
  beatDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2A2A4A',
  },
  beatDotActive: {
    backgroundColor: '#6B4FFF',
    shadowColor: '#6B4FFF',
    shadowOpacity: 0.8,
    shadowRadius: 6,
    elevation: 4,
  },
  beatDotAccent: {
    backgroundColor: '#FF6B35',
    shadowColor: '#FF6B35',
  },

  countInText: {
    color: '#FFD700',
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 8,
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ctrlBtn: {
    flex: 1,
    backgroundColor: '#1E1E3A',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3A3A5A',
  },
  ctrlBtnActive: {
    borderColor: '#6B4FFF',
    backgroundColor: '#1A1A40',
  },
  ctrlBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
}); 
