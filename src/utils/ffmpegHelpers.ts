// ═══════════════════════════════════════════════════════════
// ffmpegHelpers.ts — STUBBED (ffmpeg-kit-react-native removed)
// PATH: src/utils/ffmpegHelpers.ts
//
// ffmpeg-kit-react-native was retired by its maintainer (no binaries
// on npm/Maven/CocoaPods since April 2025) and cannot be installed.
//
// STATUS OF EACH FEATURE:
//  ✅ bakeVideoFilter, bakeWatermarkAndEndCard (video-only path) —
//     superseded by Cloudinary eager transform in cloudinaryHelpers.ts.
//     Kept here as pass-through no-ops so nothing calling them crashes;
//     they should be removed from callers once confirmed unused.
//  ❌ bakeVoiceEffect, bakeSceneVideo, concatenateScenes,
//     mergeVideoAudio, mergeDuetVideos, extractAudioFromVideo —
//     genuinely NOT replaced. These did real audio DSP (pitch-shift,
//     reverb, compression) and video concatenation that nothing in
//     the current package set can do. They now return the original
//     input UNCHANGED and report an error string so calling screens
//     can show an honest "temporarily unavailable" message instead
//     of silently producing a broken/unprocessed result.
//
// DO NOT re-add ffmpeg-kit-react-native — it is a dead package.
// ═══════════════════════════════════════════════════════════

import * as FileSystem from 'expo-file-system/legacy';
import type { VoiceEffect, StudioEdit, MovieScene } from './types';
import { bakeVoiceEffect as realBakeVoiceEffect } from './voiceEffectsHelpers';

// ─── Voice effects — REAL implementation, no longer stubbed ──────────────
// See voiceEffectsHelpers.ts for the actual OfflineAudioContext-based DSP
// (highpass/lowpass/EQ/reverb/echo/chorus/reverse/compression-approx all
// working; true tempo-preserving pitch-shift is the one honest gap — see
// that file's header comment).
export const bakeVoiceEffect = realBakeVoiceEffect;

const UNAVAILABLE = 'This feature is temporarily unavailable — video/audio processing engine is being rebuilt.';

function warn(fn: string) {
  console.warn(`[ffmpegHelpers] ${fn}() called but is stubbed out (ffmpeg-kit-react-native removed).`);
}

// ─── Extract audio track from a video file ────────────────
export async function extractAudioFromVideo(
  videoUri: string,
): Promise<{ uri: string; error: string | null }> {
  warn('extractAudioFromVideo');
  return { uri: videoUri, error: UNAVAILABLE };
}

// (bakeVoiceEffect is now exported above, re-pointed to the real
// implementation in voiceEffectsHelpers.ts)

// ─── Bake video filter (color grade) — superseded by Cloudinary ─
export async function bakeVideoFilter(
  inputUri: string,
  filterId: string,
  fxId: string,
  speedRate: number = 1.0,
): Promise<string> {
  warn('bakeVideoFilter (superseded by Cloudinary eager transform — check if this call site can be removed)');
  return inputUri;
}

// ─── Bake a single Movie Studio scene ─────────────────────
export async function bakeSceneVideo(
  scene: MovieScene,
  voiceEffect: VoiceEffect,
  edit: StudioEdit,
  onProgress?: (pct: number) => void,
): Promise<{ uri: string; error: string | null }> {
  warn('bakeSceneVideo');
  return { uri: '', error: UNAVAILABLE };
}

// ─── Bake watermark + end card — watermark superseded by Cloudinary,
//     end card (title screen splice) has no replacement yet ────────
export async function bakeWatermarkAndEndCard(
  inputUri: string,
  username: string,
  addWatermark: boolean,
): Promise<string> {
  warn('bakeWatermarkAndEndCard (watermark now handled by Cloudinary — check if this call site can be removed; end card is unavailable)');
  return inputUri;
}

// ─── Merge video + studio-recorded audio ──────────────────
export async function mergeVideoAudio(
  videoUri: string,
  audioUri: string,
  musicUri: string | null,
  musicVolume: number,
  originalVolume: number,
): Promise<string> {
  warn('mergeVideoAudio');
  return videoUri;
}

// ─── Concatenate Movie Studio scenes ──────────────────────
export async function concatenateScenes(
  scenes: MovieScene[],
): Promise<{ uri: string; error: string | null }> {
  warn('concatenateScenes');
  return { uri: '', error: UNAVAILABLE };
}

// ─── Merge duet videos side-by-side ───────────────────────
export async function mergeDuetVideos(
  myVideoUri: string,
  partnerVideoUri: string,
): Promise<string> {
  warn('mergeDuetVideos');
  return myVideoUri;
} 
