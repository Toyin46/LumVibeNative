// ═══════════════════════════════════════════════════════════
// usePitchDetection.ts — Real-time pitch detection via YIN
// src/hooks/usePitchDetection.ts
//
// Reads PCM buffer from useVUMeter every 80ms
// Runs YIN algorithm → frequency → note name + octave + cents
// Feeds AI Vocal Coach with accurate pitch data
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useEffect } from 'react';
import { yinPitchDetect } from '../utils/audioHelpers';
import { frequencyToNote } from '../utils/constants';

// Vocal fundamentals top out around 1200Hz (per yinPitchDetect's own docs),
// so we don't need 44100Hz resolution to track them accurately. Averaging
// every 4 samples into 1 (simple decimation) drops the effective rate to
// ~11025Hz — Nyquist ~5512Hz, comfortably above 1200Hz with real margin —
// while cutting YIN's O(n²) inner loop cost by ~16x (4 squared).
const DOWNSAMPLE_FACTOR = 4;

function downsample(buffer: Float32Array, factor: number): Float32Array {
  const outLength = Math.floor(buffer.length / factor);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const base = i * factor;
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += buffer[base + j];
    // Averaging (not just picking every Nth sample) acts as a crude
    // anti-alias filter, reducing noise from the decimation itself.
    out[i] = sum / factor;
  }
  return out;
}

// ─── INTERFACE ─────────────────────────────────────────────
// WHY: Exact names match AIVocalCoach.tsx and AudioStudioPanel.tsx callers
export interface PitchResult {
  frequency:  number;   // Hz detected, 0 if silent
  note:       string;   // Full note name e.g. "A4", "C#3", "—" if silent
  cents:      number;   // Deviation from perfect pitch: -50 to +50
  isActive:   boolean;  // true while detection loop is running
  confidence: number;   // 0.0 to 1.0
  start:      () => void;
  stop:       () => void;
}

// ─── HOOK ──────────────────────────────────────────────────
export function usePitchDetection(
  getBuffer: () => Float32Array | null,
  sampleRate: number = 44100,
): PitchResult {
  const [frequency,  setFrequency]  = useState<number>(0);
  const [note,       setNote]       = useState<string>('—');
  const [cents,      setCents]      = useState<number>(0);
  const [confidence, setConfidence] = useState<number>(0);
  const [isActive,   setIsActive]   = useState<boolean>(false);

  const intervalRef      = useRef<NodeJS.Timeout | null>(null);
  const lastFrequencyRef = useRef<number>(0);
  const mountedRef       = useRef<boolean>(true);

  // ─── MOUNT GUARD ─────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ─── STOP ────────────────────────────────────────────────
  const stop = useCallback((): void => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    lastFrequencyRef.current = 0;

    if (mountedRef.current) {
      setIsActive(false);
      setFrequency(0);
      setNote('—');
      setCents(0);
      setConfidence(0);
    }
  }, []);

  // ─── START ───────────────────────────────────────────────
  const start = useCallback((): void => {
    // WHY: Clear any existing interval to prevent double-running
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (mountedRef.current) setIsActive(true);

    intervalRef.current = setInterval(() => {
      try {
        const buffer = getBuffer();

        // WHY: If VUMeter is in fallback mode, buffer is null — skip silently
        if (!buffer || buffer.length === 0) return;

        const freq = yinPitchDetect(
          downsample(buffer, DOWNSAMPLE_FACTOR),
          sampleRate / DOWNSAMPLE_FACTOR,
          0.15,
        );

        // WHY: Only update if frequency changed by more than 2Hz — prevents jitter
        if (Math.abs(freq - lastFrequencyRef.current) <= 2) return;

        lastFrequencyRef.current = freq;

        if (!mountedRef.current) return;

        if (freq <= 0) {
          // Silence or unpitched sound
          setFrequency(0);
          setNote('—');
          setCents(0);
          setConfidence(0);
        } else {
          // WHY: frequencyToNote returns { note, octave, cents }
          // We must combine note + octave to get "A4" not just "A"
          const result = frequencyToNote(freq);
          const fullNote = `${result.note}${result.octave}`;

          setFrequency(freq);
          setNote(fullNote);
          setCents(result.cents);
          // WHY: 0.85 confidence — YIN is reliable but not perfect on noisy mic
          setConfidence(0.85);
        }
      } catch (err) {
        console.warn('[usePitchDetection] interval error:', err);
      }
    }, 80);
  }, [getBuffer, sampleRate]);

  return { frequency, note, cents, isActive, confidence, start, stop };
}  
