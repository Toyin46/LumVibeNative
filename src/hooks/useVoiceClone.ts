// ═══════════════════════════════════════════════════════════
// useVoiceClone.ts — ElevenLabs Voice Cloning + TTS
// src/hooks/useVoiceClone.ts
// ═══════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  cacheDirectory,
  writeAsStringAsync,
  deleteAsync,
  getInfoAsync,
  EncodingType,
} from 'expo-file-system/legacy'
import { useAudioPlayer } from 'expo-audio';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? '';

export interface VoiceCloneResult {
  cloneVoice:  (audioUri: string, userName: string) => Promise<{ voiceId: string } | null>;
  demonstrate: (text: string) => Promise<void>;
  isCloning:   boolean;
  isPlaying:   boolean;
  voiceId:     string | null;
  error:       string | null;
  reset:       () => void;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 30000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return response;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw err;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes     = new Uint8Array(buffer);
  let binary      = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function useVoiceClone(): VoiceCloneResult {
  const [isCloning, setIsCloning] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [voiceId,   setVoiceId]   = useState<string | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const voiceIdRef     = useRef<string | null>(null);
  const mountedRef     = useRef<boolean>(true);
  const currentFileRef = useRef<string | null>(null);

  const player = useAudioPlayer(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (currentFileRef.current) {
        deleteAsync(currentFileRef.current, { idempotent: true }).catch(() => null);
      }
    };
  }, []);

  const reset = useCallback((): void => {
    try { player.pause(); } catch { /* ignore */ }
    if (currentFileRef.current) {
      deleteAsync(currentFileRef.current, { idempotent: true }).catch(() => null);
      currentFileRef.current = null;
    }
    voiceIdRef.current = null;
    if (mountedRef.current) {
      setVoiceId(null);
      setIsCloning(false);
      setIsPlaying(false);
      setError(null);
    }
  }, [player]);

  const cloneVoice = useCallback(async (
    audioUri: string,
    userName: string,
  ): Promise<{ voiceId: string } | null> => {
    if (!ELEVENLABS_API_KEY) {
      console.warn('[useVoiceClone] ELEVENLABS_API_KEY not set.');
      return null;
    }
    if (mountedRef.current) { setIsCloning(true); setError(null); }

    try {
      const fileInfo = await getInfoAsync(audioUri);
      if (!fileInfo.exists) throw new Error('Audio file not found.');

      const formData = new FormData();
      formData.append('name', `${userName} — LumVibe Voice`);
      formData.append('description', 'Voice clone created by LumVibe AI Vocal Coach');
      formData.append('files', {
        uri: audioUri, type: 'audio/m4a', name: `voice_sample_${Date.now()}.m4a`,
      } as unknown as Blob);

      const response = await fetchWithTimeout(
        'https://api.elevenlabs.io/v1/voices/add',
        {
          method: 'POST',
          headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Accept': 'application/json' },
          body: formData,
        },
        30000,
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail?.message ?? `ElevenLabs error: ${response.status}`);
      }

      const data        = await response.json();
      const newVoiceId  = data.voice_id as string;
      voiceIdRef.current = newVoiceId;
      if (mountedRef.current) setVoiceId(newVoiceId);
      return { voiceId: newVoiceId };

    } catch (err: any) {
      if (mountedRef.current) setError(err.message ?? 'Voice clone failed');
      return null;
    } finally {
      if (mountedRef.current) setIsCloning(false);
    }
  }, []);

  const demonstrate = useCallback(async (text: string): Promise<void> => {
    if (!ELEVENLABS_API_KEY) return;
    const currentVoiceId = voiceIdRef.current;
    if (!currentVoiceId) {
      if (mountedRef.current) setError('No voice cloned yet. Record a sample first.');
      return;
    }
    if (mountedRef.current) { setIsPlaying(true); setError(null); }

    try {
      const response = await fetchWithTimeout(
        `https://api.elevenlabs.io/v1/text-to-speech/${currentVoiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key':   ELEVENLABS_API_KEY,
            'Accept':       'audio/mpeg',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.5, similarity_boost: 0.85,
              style: 0.3, use_speaker_boost: true,
            },
          }),
        },
        30000,
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(errData?.detail?.message ?? `ElevenLabs TTS error: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64      = arrayBufferToBase64(arrayBuffer);

      if (currentFileRef.current) {
        await deleteAsync(currentFileRef.current, { idempotent: true }).catch(() => null);
      }

      // FIX: cacheDirectory imported directly — no FileSystem namespace
      const fileUri = `${cacheDirectory}lv_demo_${Date.now()}.mp3`;
      await writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
      currentFileRef.current = fileUri;

      player.replace({ uri: fileUri });
      player.play();

      const checkDone = setInterval(() => {
        if (!mountedRef.current) { clearInterval(checkDone); return; }
        if (!player.playing) {
          clearInterval(checkDone);
          if (mountedRef.current) setIsPlaying(false);
        }
      }, 200);

    } catch (err: any) {
      if (mountedRef.current) { setError(err.message ?? 'Playback failed'); setIsPlaying(false); }
    }
  }, [player]);

  return { cloneVoice, demonstrate, isCloning, isPlaying, voiceId, error, reset };
}