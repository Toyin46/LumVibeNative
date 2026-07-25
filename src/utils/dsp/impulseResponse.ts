// ═══════════════════════════════════════════════════════════
// impulseResponse.ts — Procedural reverb impulse response
// src/utils/dsp/impulseResponse.ts
// ConvolverNode needs an impulse-response buffer to create reverb.
// Rather than bundling a licensed recorded IR file, we synthesise one:
// exponentially-decaying white noise. This is a well-known, standard
// technique for a clean "room/plate" style reverb with zero asset
// licensing risk and zero network fetch.
// ═══════════════════════════════════════════════════════════

import type { BaseAudioContext, AudioBuffer } from 'react-native-audio-api';

export interface ImpulseResponseOptions {
  durationSec?: number; // length of the reverb tail
  decay?:       number; // higher = faster decay (tighter room)
}

export function createSyntheticImpulseResponse(
  context: BaseAudioContext,
  { durationSec = 2.2, decay = 3.2 }: ImpulseResponseOptions = {},
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length      = Math.max(1, Math.floor(sampleRate * durationSec));
  const impulse     = context.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // White noise shaped by an exponential decay envelope
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }

  return impulse;
} 
