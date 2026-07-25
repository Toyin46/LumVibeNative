// ═══════════════════════════════════════════════════════════
// useVUMeter.ts — Real-time VU metering + PCM buffer access
// src/hooks/useVUMeter.ts
//
// REWRITE: the old "primary" path used navigator.mediaDevices.getUserMedia,
// which does not exist in React Native — it always failed, silently, on
// every device. That forced a "fallback" that spun up a SECOND, separate
// expo-audio AudioRecorder running in parallel with the real one in
// useRecording.ts — two native recorder sessions fighting over the mic,
// which is what caused the "shared object already released" crash.
//
// FIX: use react-native-audio-api's own native AudioRecorder in
// "data callback" mode (onAudioReady). It hands us real PCM Float32Array
// buffers directly — no browser API, no second file-recording session,
// no conflict with useRecording's expo-audio recorder.
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioModule } from 'expo-audio';
import { AudioRecorder as NativePcmRecorder, AudioManager } from 'react-native-audio-api';

const SAMPLE_RATE = 44100;
// YIN only needs enough samples to capture ~2-3 cycles of the lowest note
// it should detect. For an 80Hz vocal floor, one cycle is ~12.5ms — 35ms
// gives comfortable margin for low voices while keeping YIN's O(n²) inner
// loop cheap. The old 100ms buffer was ~8x more data than needed, which
// was the real cause of the slowdown (YIN's cost grows with the SQUARE
// of buffer length, so buffer size matters far more than the poll interval).
const BUFFER_LENGTH = Math.floor(SAMPLE_RATE * 0.035);

// ─── INTERFACE ─────────────────────────────────────────────
// WHY: Interface matches EXACTLY what all existing callers expect
// AudioStudioPanel, AIVocalCoach, StudioWave all use: level, isActive, start, stop, getBuffer
export interface VUMeterResult {
  level:     number;              // 0.0 – 1.0 smoothed RMS
  isActive:  boolean;             // true while metering is running
  start:     () => Promise<void>; // begin metering
  stop:      () => void;          // stop metering synchronously
  getBuffer: () => Float32Array | null; // latest PCM snapshot for pitch detection
}

// ─── HOOK ──────────────────────────────────────────────────
export function useVUMeter(): VUMeterResult {
  const [level,    setLevel]    = useState<number>(0);
  const [isActive, setIsActive] = useState<boolean>(false);

  const pcmRecorderRef = useRef<any>(null);

  const bufferRef      = useRef<Float32Array | null>(null);
  const levelRef       = useRef<number>(0);
  const lastUpdateRef  = useRef<number>(0);
  const isActiveRef    = useRef<boolean>(false);

  // ─── CLEANUP ─────────────────────────────────────────────
  // WHY: Synchronous cleanup — callers don't await stop()
  const cleanupAll = useCallback(() => {
    try {
      if (pcmRecorderRef.current) {
        try {
          // stop() may or may not be async depending on native impl —
          // guard both cases so a rejection can never surface as an
          // unhandled promise rejection.
          const result = pcmRecorderRef.current.stop?.();
          result?.catch?.(() => {});
        } catch { /* ignore */ }
        pcmRecorderRef.current = null;
      }

      bufferRef.current   = null;
      levelRef.current    = 0;
      isActiveRef.current = false;
    } catch (err) {
      console.warn('[useVUMeter] cleanup error:', err);
    }
  }, []);

  // ─── START ───────────────────────────────────────────────
  const start = useCallback(async (): Promise<void> => {
    if (isActiveRef.current) return;

    try {
      // Reuses the same permission expo-audio's recorder already needs —
      // requesting again here is safe/idempotent if already granted.
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        console.warn('[useVUMeter] Microphone permission denied.');
        return;
      }

      AudioManager.setAudioSessionOptions({
        iosCategory: 'playAndRecord', // 'record' blocks simultaneous playback
        iosMode:     'default',       // on iOS — coach speech/tones need this
        iosOptions:  ['defaultToSpeaker'],
      });

      const pcmRecorder = new NativePcmRecorder();
      pcmRecorderRef.current = pcmRecorder;

      pcmRecorder.onAudioReady(
        {
          sampleRate:   SAMPLE_RATE,
          bufferLength: BUFFER_LENGTH,
          channelCount: 1,
        },
        (event: { buffer: any; numFrames: number; when: number }) => {
          // TS confirmed the real shape: event.buffer is this library's own
          // AudioBuffer class (same one bakeEngine.ts uses), not a raw
          // Float32Array — so we read it the same way: getChannelData(0).
          const samples: Float32Array = event.buffer.getChannelData(0);
          if (!samples || samples.length === 0) return;

          bufferRef.current = new Float32Array(samples); // defensive copy

          const now = Date.now();
          if (now - lastUpdateRef.current >= 50) {
            lastUpdateRef.current = now;

            let sumSquares = 0;
            for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
            const rms = Math.sqrt(sumSquares / samples.length);

            const smoothed = levelRef.current * 0.35 + rms * 0.65;
            levelRef.current = smoothed;
            setLevel(smoothed);
          }
        },
      );

      pcmRecorder.start();

      isActiveRef.current = true;
      setIsActive(true);
    } catch (err) {
      console.warn('[useVUMeter] start failed:', err);
      cleanupAll();
    }
  }, [cleanupAll]);

  // ─── STOP ────────────────────────────────────────────────
  // WHY: Synchronous — all existing callers call vu.stop() without await
  const stop = useCallback((): void => {
    cleanupAll();
    setLevel(0);
    setIsActive(false);
  }, [cleanupAll]);

  // ─── GET BUFFER ──────────────────────────────────────────
  // WHY: Returns latest PCM snapshot — called by usePitchDetection every 80ms
  const getBuffer = useCallback((): Float32Array | null => {
    return bufferRef.current;
  }, []);

  // ─── UNMOUNT CLEANUP ─────────────────────────────────────
  useEffect(() => {
    return () => {
      cleanupAll();
    };
  }, [cleanupAll]);

  return { level, isActive, start, stop, getBuffer };
} 
