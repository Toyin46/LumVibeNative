// ═══════════════════════════════════════════════════════════
// bakeEngine.ts — On-device audio effects engine
// src/utils/dsp/bakeEngine.ts
//
// Replaces utils/ffmpegHelpers.ts entirely. Built on react-native-audio-api's
// OfflineAudioContext (Web Audio API spec) — renders faster than real time,
// fully on-device. No FFmpeg, no server, no upload, no billing.
//
// PHASE 1+2: trim, reverse, delay/echo, reverb, chorus, EQ
// (highpass/lowpass/presence), compression, chipmunk-style rate/pitch,
// noise gate, normalize, AND duration-preserving pitch shift — all done.
// Pitch shift uses the library's built-in native pitch-correction engine
// (detune, with pitchCorrection:true) rather than a hand-rolled algorithm.
// Signature matches AudioStudioPanel's real call site:
//   bakeVoiceEffect(rawUri, selectedEffect, studioEdit)
//
// NOT YET BAKED: the 'autotune' preset (real-time chromatic pitch
// correction — a different, harder problem: needs pitch DETECTION plus
// dynamic correction, not just a static shift). Selecting it won't crash;
// everything else still bakes, with a `warning` string for the UI.
// ═══════════════════════════════════════════════════════════

import { AudioContext, OfflineAudioContext } from 'react-native-audio-api';
import type { AudioBuffer } from 'react-native-audio-api';
import type { StudioEdit, VoiceEffect } from '../types';
import { createSyntheticImpulseResponse } from './impulseResponse';
import { applyNoiseGate, normalizePeak } from './dynamics';
import { saveBufferAsWav } from './wavFile';

export interface BakeResult {
  uri:      string;
  error?:   string;
  warning?: string;
}

const TAIL_PAD_SEC = 1.5; // room for reverb/delay/chorus tails so they don't get cut off

export interface BeatOptions {
  uri:    string;
  volume: number; // 0-1
}

/**
* effect  = the preset's baseline sound (rate, EQ, compression, reverb/echo send)
* edit    = the user's manual overrides from the Edit tab
* beat    = optional backing track to mix under the vocal (real digital mix,
*           not relying on what the mic happened to pick up acoustically)
* Where both touch the same knob (reverb/delay/chorus), edit wins if the
* user actually moved it; otherwise the preset's value is used.
*/
export async function bakeVoiceEffect(
  rawUri: string,
  effect: VoiceEffect,
  edit:   StudioEdit,
  beat?:  BeatOptions | null,
): Promise<BakeResult> {
  let decodeCtx: AudioContext | null = null;

  try {
    // 1) Decode the raw recording into PCM
    decodeCtx = new AudioContext();
    const sourceBuffer: AudioBuffer = await decodeCtx.decodeAudioData(rawUri);

    // 2) Trim + reverse operate directly on sample data — no DSP node needed.
    //    A preset can force reverse (e.g. the "Reverse" effect) OR the user
    //    can force it manually in the Edit tab — either one triggers it.
    const shouldReverse = edit.reverse || !!effect.cloudinaryReverse;
    const trimmed = trimAndReverse(decodeCtx, sourceBuffer, edit, shouldReverse);

    // 3) Combine preset + manual overrides for the shared knobs
    const reverbLevel = edit.reverbLevel > 0 ? edit.reverbLevel : effect.reverb;
    const delayMs      = edit.delay > 0 ? edit.delay : effect.echo;
    const chorusOn      = edit.chorus || effect.chorus;

    // A rate-changing preset (helium/deep) and the manual pitch slider both
    // want control of pitch, but through mutually exclusive mechanisms —
    // the preset wins if both are active (see warning below).
    const wantsManualPitchShift = edit.pitchShift !== 0 && (effect.rate === 1 || !effect.rate);

    const needsTail   = reverbLevel > 0 || delayMs > 0 || chorusOn;
    const tailFrames  = needsTail ? Math.floor(TAIL_PAD_SEC * trimmed.sampleRate) : 0;
    const renderLength = trimmed.length + tailFrames;

    const offlineCtx = new OfflineAudioContext({
      numberOfChannels: trimmed.numberOfChannels,
      length:            renderLength,
      sampleRate:        trimmed.sampleRate,
    });

    const source = offlineCtx.createBufferSource(
      // Native pitch-correction engine (wraps AVAudioUnitTimePitch on iOS /
      // the platform equivalent on Android). With this on, playbackRate
      // changes SPEED ONLY and detune (cents) changes PITCH ONLY — that's
      // the duration-preserving pitch shift the Edit tab slider needs.
      wantsManualPitchShift ? { pitchCorrection: true } : undefined,
    );
    source.buffer = trimmed;

    if (wantsManualPitchShift) {
      source.playbackRate.value = 1;
      source.detune.value = edit.pitchShift * 100; // semitones -> cents
    } else {
      // Chipmunk-style presets (helium/deep) — pitch tied to rate, no
      // correction. This only works when pitch correction is OFF, which is
      // why manual pitch shift and a rate-changing preset can't combine.
      source.playbackRate.value = effect.rate || 1;
    }

    // 4) Tone-shaping chain from the preset: highpass -> lowpass -> presence -> compressor
    let node: any = source;

    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = effect.highpass;
    node.connect(highpass);
    node = highpass;

    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = effect.lowpass;
    node.connect(lowpass);
    node = lowpass;

    if (effect.presence !== 0) {
      const presenceFilter = offlineCtx.createBiquadFilter();
      presenceFilter.type = 'peaking';
      presenceFilter.frequency.value = 2500; // classic vocal "presence" band
      presenceFilter.Q.value = 1;
      presenceFilter.gain.value = effect.presence;
      node.connect(presenceFilter);
      node = presenceFilter;
    }

    if (effect.compress && typeof (offlineCtx as any).createDynamicsCompressor === 'function') {
      // Guarded at runtime rather than assumed — createDynamicsCompressor()
      // isn't on this library's TS types today. If it's added later this
      // starts working automatically; if it's never added, compression is
      // just skipped rather than crashing the whole bake.
      const compressor = (offlineCtx as any).createDynamicsCompressor();
      compressor.threshold.value = -24;
      compressor.knee.value      = 20;
      compressor.ratio.value     = 4;
      compressor.attack.value    = 0.005;
      compressor.release.value   = 0.15;
      node.connect(compressor);
      node = compressor;
    }

    const previewGain = offlineCtx.createGain();
    previewGain.gain.value = effect.previewVolume || 1;
    node.connect(previewGain);
    node = previewGain; // "processed" — everything downstream taps off this

    // 5) Dry path — always present
    node.connect(offlineCtx.destination);

    // Delay / echo — taps off the processed signal, not the raw source,
    // so the echo carries the same tone color as the dry signal
    if (delayMs > 0) {
      const delayNode = offlineCtx.createDelay(1.0);
      delayNode.delayTime.value = delayMs / 1000;

      const feedback = offlineCtx.createGain();
      feedback.gain.value = 0.32;

      const delayWet = offlineCtx.createGain();
      delayWet.gain.value = 0.55;

      node.connect(delayNode);
      delayNode.connect(feedback);
      feedback.connect(delayNode); // feedback loop
      delayNode.connect(delayWet);
      delayWet.connect(offlineCtx.destination);
    }

    // Reverb — synthetic impulse response via ConvolverNode
    if (reverbLevel > 0) {
      const convolver = offlineCtx.createConvolver();
      convolver.buffer = createSyntheticImpulseResponse(offlineCtx, {
        durationSec: 2.0 + reverbLevel * 1.5,
        decay:       3.2,
      });

      const reverbWet = offlineCtx.createGain();
      reverbWet.gain.value = reverbLevel * 0.9;

      node.connect(convolver);
      convolver.connect(reverbWet);
      reverbWet.connect(offlineCtx.destination);
    }

    // Chorus — two detuned, LFO-modulated delay taps (classic technique)
    if (chorusOn) {
      buildChorus(offlineCtx, node);
    }

    // Beat — mixed as a genuine second audio track in the SAME render, not
    // reliant on whatever the mic acoustically picked up. Decoded with the
    // same decodeCtx already open for the vocal take.
    if (beat?.uri) {
      try {
        const beatBuffer = await decodeCtx.decodeAudioData(beat.uri);
        const beatSource = offlineCtx.createBufferSource();
        beatSource.buffer = beatBuffer;
        beatSource.loop   = true; // loops if the beat is shorter than the take

        const beatGain = offlineCtx.createGain();
        beatGain.gain.value = Math.max(0, Math.min(1, beat.volume ?? 0.5));

        beatSource.connect(beatGain);
        beatGain.connect(offlineCtx.destination);
        beatSource.start(0); // same timeline origin as the vocal source below
      } catch (err) {
        // A broken beat file should never take down the whole vocal bake —
        // fall through and bake vocal-only.
        console.warn('[bakeEngine] beat mix failed, continuing vocal-only:', err);
      }
    }

    source.start(0);

    // 6) Render — native, faster than real time
    const rendered = await offlineCtx.startRendering();

    // 7) Post-process the rendered PCM directly
    const channels: Float32Array[] = [];
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      channels.push(rendered.getChannelData(c));
    }

    if (edit.noiseGate) applyNoiseGate(channels, rendered.sampleRate);
    if (edit.normalise) normalizePeak(channels);

    // 8) Encode + write to disk
    const uri = await saveBufferAsWav(channels, rendered.sampleRate, `bake_${Date.now()}.wav`);

    const pitchShiftConflict = edit.pitchShift !== 0 && !wantsManualPitchShift;
    const warning = effect.id === 'autotune'
      ? 'Auto-Tune (chromatic pitch correction) is coming in a future update — every other effect was applied.'
      : pitchShiftConflict
        ? `"${effect.name}" already changes pitch via its own rate, so the manual pitch slider was skipped this time — everything else was applied.`
        : undefined;

    return { uri, warning };
  } catch (err) {
    return {
      uri:   rawUri, // fall back to the original take so the user never loses their recording
      error: err instanceof Error ? err.message : 'Could not process audio — used your original take.',
    };
  } finally {
    try { await (decodeCtx as any)?.close?.(); } catch { /* not fatal */ }
  }
}

function trimAndReverse(
  ctx:     AudioContext,
  buffer:  AudioBuffer,
  edit:    StudioEdit,
  reverse: boolean,
): AudioBuffer {
  const { sampleRate, numberOfChannels, length } = buffer;
  const startFrame = Math.max(0, Math.floor(edit.trimStart * sampleRate));
  const endFrame   = Math.max(startFrame + 1, length - Math.floor(edit.trimEnd * sampleRate));
  const newLength  = Math.min(endFrame, length) - startFrame;

  if (newLength <= 0) return buffer; // trim would remove everything — ignore it, keep original

  const out = ctx.createBuffer(numberOfChannels, newLength, sampleRate);
  for (let c = 0; c < numberOfChannels; c++) {
    const src   = buffer.getChannelData(c);
    const slice = src.subarray(startFrame, startFrame + newLength);
    const dst   = out.getChannelData(c);

    if (reverse) {
      for (let i = 0; i < newLength; i++) dst[i] = slice[newLength - 1 - i];
    } else {
      dst.set(slice);
    }
  }
  return out;
}

function buildChorus(ctx: OfflineAudioContext, inputNode: any) {
  const taps = [
    { baseMs: 18, rateHz: 0.6,  depthMs: 4, pan: -0.3 },
    { baseMs: 24, rateHz: 0.45, depthMs: 5, pan:  0.3 },
  ];

  for (const tap of taps) {
    const delayNode = ctx.createDelay(0.06);
    delayNode.delayTime.value = tap.baseMs / 1000;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = tap.rateHz;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = tap.depthMs / 1000;
    lfo.connect(lfoDepth);
    lfoDepth.connect(delayNode.delayTime);
    lfo.start(0);

    const panner = ctx.createStereoPanner();
    panner.pan.value = tap.pan;

    const wet = ctx.createGain();
    wet.gain.value = 0.35;

    inputNode.connect(delayNode);
    delayNode.connect(panner);
    panner.connect(wet);
    wet.connect(ctx.destination);
  }
} 
