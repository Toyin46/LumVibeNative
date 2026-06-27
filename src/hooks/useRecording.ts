// ═══════════════════════════════════════════════════════════
// useRecording.ts — Audio recording with expo-audio
// src/hooks/useRecording.ts
// ═══════════════════════════════════════════════════════════

import { useRef, useCallback, useState } from 'react';
import { useAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import { deleteAsync } from 'expo-file-system/legacy'; 

export type RecordingState = 'idle' | 'recording' | 'paused' | 'done';

interface UseRecordingResult {
  state:           RecordingState;
  durationMs:      number;
  uri:             string | null;
  isActive:        boolean;
  start:           () => Promise<void>;
  pause:           () => Promise<void>;
  resume:          () => Promise<void>;
  stop:            () => Promise<string | null>;
  discard:         () => Promise<void>;
  permissionError: string | null;
}

export function useRecording(): UseRecordingResult {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [state,            setState]           = useState<RecordingState>('idle');
  const [durationMs,       setDurationMs]      = useState(0);
  const [uri,              setUri]             = useState<string | null>(null);
  const [permissionError,  setPermissionError] = useState<string | null>(null);

  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const startMs     = useRef(0);
  const accumulated = useRef(0);

  function startTick() {
    startMs.current = Date.now();
    tickRef.current = setInterval(() => {
      setDurationMs(accumulated.current + (Date.now() - startMs.current));
    }, 100);
  }

  function stopTick() {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  const start = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        setPermissionError('Microphone permission denied. Enable it in Settings.');
        return;
      }
      setPermissionError(null);
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState('recording');
      accumulated.current = 0;
      setDurationMs(0);
      setUri(null);
      startTick();
    } catch (err) {
      console.warn('[useRecording] start error:', err);
      setPermissionError('Could not start recording. Please try again.');
    }
  }, [recorder]);

  const pause = useCallback(async () => {
    if (state !== 'recording') return;
    try {
      recorder.pause();
      accumulated.current += Date.now() - startMs.current;
      stopTick();
      setState('paused');
    } catch (err) {
      console.warn('[useRecording] pause:', err);
    }
  }, [recorder, state]);

  const resume = useCallback(async () => {
    if (state !== 'paused') return;
    try {
      recorder.record();
      setState('recording');
      startTick();
    } catch (err) {
      console.warn('[useRecording] resume:', err);
    }
  }, [recorder, state]);

  const stop = useCallback(async (): Promise<string | null> => {
    if (state === 'idle') return null;
    try {
      stopTick();
      await recorder.stop();
      const recordedUri = recorder.uri ?? null;
      setUri(recordedUri);
      setState('done');
      return recordedUri;
    } catch (err) {
      console.warn('[useRecording] stop:', err);
      setState('done');
      return null;
    }
  }, [recorder, state]);

  const discard = useCallback(async () => {
    stopTick();
    try {
      if (state === 'recording' || state === 'paused') await recorder.stop();
      if (recorder.uri) {
        await deleteAsync(recorder.uri, { idempotent: true }).catch(() => null);
      }
    } catch { /* ignore */ }
    setState('idle');
    setDurationMs(0);
    setUri(null);
    accumulated.current = 0;
  }, [recorder, state]);

  const isActive = state === 'recording' || state === 'paused';

  return {
    state,
    durationMs,
    uri,
    isActive,
    start,
    pause,
    resume,
    stop,
    discard,
    permissionError,
  };
}
