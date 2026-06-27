// ═══════════════════════════════════════════════════════════
// useVUMeter.ts — Real-time VU metering + PCM buffer access
// src/hooks/useVUMeter.ts
//
// PRIMARY:  react-native-audio-api → real PCM Float32Array
// FALLBACK: expo-audio metering   → level only, buffer null
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useEffect } from 'react';
import { AudioModule, useAudioRecorder, useAudioRecorderState, RecordingPresets } from 'expo-audio';

// react-native-audio-api — safe optional import
let RNAudioContext: any = null;
try {
  const audioApi = require('react-native-audio-api');
  RNAudioContext = audioApi.AudioContext ?? audioApi.default?.AudioContext ?? null;
} catch {
  RNAudioContext = null;
}

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

  // Web Audio API node refs
  const audioCtxRef    = useRef<any>(null);
  const sourceRef      = useRef<any>(null);
  const analyserRef    = useRef<any>(null);
  const processorRef   = useRef<any>(null);
  const streamRef      = useRef<any>(null);

  // Shared state refs — read without re-render
  const bufferRef      = useRef<Float32Array | null>(null);
  const levelRef       = useRef<number>(0);
  const lastUpdateRef  = useRef<number>(0);
  const isActiveRef    = useRef<boolean>(false);

  // Fallback metering interval ref
  const fallbackRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  // Fallback recorder for expo-audio metering
  const fallbackRecorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  // FIX: metering isn't a property on the recorder instance — it comes from
  // this separate state hook. We mirror it into a ref because the interval
  // closure below is created once in start() and would otherwise read a
  // stale value forever instead of the live metering reading.
  const fallbackRecorderState = useAudioRecorderState(fallbackRecorder, 50);
  const recorderStateRef = useRef<any>(null);
  useEffect(() => {
    recorderStateRef.current = fallbackRecorderState;
  }, [fallbackRecorderState]);

  // ─── CLEANUP ─────────────────────────────────────────────
  // WHY: Synchronous cleanup — callers don't await stop()
  const cleanupAll = useCallback(() => {
    try {
      // Stop fallback interval
      if (fallbackRef.current) {
        clearInterval(fallbackRef.current);
        fallbackRef.current = null;
      }

      // Stop fallback recorder
      try { fallbackRecorder.stop(); } catch { /* ignore */ }

      // Disconnect Web Audio nodes
      if (processorRef.current) {
        try {
          processorRef.current.onaudioprocess = null;
          processorRef.current.disconnect();
        } catch { /* ignore */ }
        processorRef.current = null;
      }
      if (analyserRef.current) {
        try { analyserRef.current.disconnect(); } catch { /* ignore */ }
        analyserRef.current = null;
      }
      if (sourceRef.current) {
        try { sourceRef.current.disconnect(); } catch { /* ignore */ }
        sourceRef.current = null;
      }

      // Stop media stream tracks
      if (streamRef.current) {
        try {
          streamRef.current.getTracks?.().forEach((t: any) => t.stop());
        } catch { /* ignore */ }
        streamRef.current = null;
      }

      // Close AudioContext
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch { /* ignore */ }
        audioCtxRef.current = null;
      }

      // Reset all state
      bufferRef.current  = null;
      levelRef.current   = 0;
      isActiveRef.current = false;
    } catch (err) {
      console.warn('[useVUMeter] cleanup error:', err);
    }
  }, []);

  // ─── START ───────────────────────────────────────────────
  const start = useCallback(async (): Promise<void> => {
    if (isActiveRef.current) return;

    try {
      // Request microphone permission
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        console.warn('[useVUMeter] Microphone permission denied.');
        return;
      }

      let webAudioStarted = false;

      // ── ATTEMPT: react-native-audio-api (full PCM buffer) ──
      if (RNAudioContext) {
        try {
          // WHY: getUserMedia gives us live mic stream as Web Audio source
          const stream = await (
            navigator?.mediaDevices?.getUserMedia?.({ audio: true }) ??
            Promise.reject('getUserMedia unavailable')
          );
          streamRef.current = stream;

          const ctx = new RNAudioContext({ sampleRate: 44100 });
          audioCtxRef.current = ctx;

          // Build audio processing graph: Mic → Analyser → Processor → Destination
          const source   = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;

          // WHY: ScriptProcessorNode gives us raw PCM per audio frame
          // 2048 samples, 1 input channel, 1 output channel
          const processor = ctx.createScriptProcessor(2048, 1, 1);

          source.connect(analyser);
          analyser.connect(processor);
          // WHY: Must connect to destination or onaudioprocess never fires
          processor.connect(ctx.destination);

          sourceRef.current    = source;
          analyserRef.current  = analyser;
          processorRef.current = processor;

          processor.onaudioprocess = (event: any) => {
            const inputData: Float32Array = event.inputBuffer.getChannelData(0);

            // WHY: Always copy — never hold reference to inputBuffer (it's recycled)
            bufferRef.current = new Float32Array(inputData);

            const now = Date.now();
            // WHY: Throttle setLevel to 50ms — avoids React render storm
            if (now - lastUpdateRef.current >= 50) {
              lastUpdateRef.current = now;

              // Calculate RMS (true volume level)
              let sumSquares = 0;
              for (let i = 0; i < inputData.length; i++) {
                sumSquares += inputData[i] * inputData[i];
              }
              const rms = Math.sqrt(sumSquares / inputData.length);

              // Smooth: blend previous and current to remove jitter
              const smoothed = levelRef.current * 0.35 + rms * 0.65;
              levelRef.current = smoothed;
              setLevel(smoothed);
            }
          };

          webAudioStarted = true;
        } catch (err) {
          console.warn('[useVUMeter] react-native-audio-api failed, using fallback:', err);
          cleanupAll();
        }
      }

      // ── FALLBACK: expo-audio metering only (no PCM buffer) ──
      if (!webAudioStarted) {
        // WHY: bufferRef stays null — pitch detection won't work but level still works
        bufferRef.current = null;

        try {
          await fallbackRecorder.prepareToRecordAsync();
          fallbackRecorder.record();

          // Poll metering every 50ms
          fallbackRef.current = setInterval(() => {
            if (!isActiveRef.current) return;
            const db = recorderStateRef.current?.metering ?? -160;
            // WHY: Convert dBFS (-160 to 0) to linear 0-1
            const linear = Math.max(0, Math.min(1, (db + 60) / 60));
            const smoothed = levelRef.current * 0.35 + linear * 0.65;
            levelRef.current = smoothed;
            setLevel(smoothed);
          }, 50);
        } catch (err) {
          console.warn('[useVUMeter] expo-audio fallback also failed:', err);
        }
      }

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
