// ═══════════════════════════════════════════════════════════
// audioHelpers.ts — Audio utilities
// YIN pitch detection, VU metering, oscillator tones
// ═══════════════════════════════════════════════════════════

import { NOTE_NAMES, frequencyToNote } from './constants';

// ─── YIN PITCH DETECTION ALGORITHM ───────────────────────
/**
* Estimates the fundamental frequency of a PCM audio buffer.
* YIN algorithm — accurate for vocal frequency range 80–1200 Hz.
* Returns frequency in Hz, or 0 if no pitch detected.
*/
export function yinPitchDetect(
  buffer: Float32Array,
  sampleRate: number,
  threshold: number = 0.15,
): number {
  const bufLen    = buffer.length;
  const halfLen   = Math.floor(bufLen / 2);
  const yinBuffer = new Float32Array(halfLen).fill(0);

  // Step 1: Difference function
  for (let tau = 1; tau < halfLen; tau++) {
    for (let i = 0; i < halfLen; i++) {
      const delta = buffer[i] - buffer[i + tau];
      yinBuffer[tau] += delta * delta;
    }
  }

  // Step 2: Cumulative mean normalised difference
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += yinBuffer[tau];
    yinBuffer[tau] *= tau / runningSum;
  }

  // Step 3: Absolute threshold — find first dip below threshold
  let tau = 2;
  while (tau < halfLen) {
    if (yinBuffer[tau] < threshold) {
      while (tau + 1 < halfLen && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      break;
    }
    tau++;
  }

  if (tau === halfLen || yinBuffer[tau] >= threshold) return 0;

  // Step 4: Parabolic interpolation for sub-sample accuracy
  let betterTau: number;
  if (tau > 0 && tau < halfLen - 1) {
    const s0 = yinBuffer[tau - 1];
    const s1 = yinBuffer[tau];
    const s2 = yinBuffer[tau + 1];
    betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
  } else {
    betterTau = tau;
  }

  return sampleRate / betterTau;
}

// ─── RMS LEVEL (VU METER) ─────────────────────────────────
/**
* Calculates the RMS (Root Mean Square) level of a PCM buffer.
* Returns 0–1, where 1 is maximum amplitude.
*/
export function calculateRMS(buffer: Float32Array): number {
  if (buffer.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

// ─── dBFS CONVERSION ─────────────────────────────────────
/**
* Converts linear 0–1 amplitude to dBFS.
* Returns -Infinity for silence, 0 for maximum.
*/
export function linearToDbFS(linear: number): number {
  if (linear <= 0) return -Infinity;
  return 20 * Math.log10(linear);
}

// ─── PITCH ACCURACY SCORE ─────────────────────────────────
/**
* Given a detected frequency and a target note string (e.g. "A4"),
* returns an accuracy score from 0–100.
*/
export function pitchAccuracyScore(
  detectedFreq: number,
  targetNote: string,
): number {
  if (detectedFreq <= 0) return 0;

  const detected = frequencyToNote(detectedFreq);
  const detectedName = `${detected.note}${detected.octave}`;

  if (detectedName === targetNote) {
    // Perfect note — score by cent deviation (±50 cents = 0 points)
    const centOff = Math.abs(detected.cents);
    return Math.max(0, 100 - centOff * 2);
  }

  // Wrong note — give partial credit if close
  const noteIndex     = getNoteIndex(detectedName);
  const targetIndex   = getNoteIndex(targetNote);
  const semitonesOff  = Math.abs(noteIndex - targetIndex);

  if (semitonesOff <= 1) return 40; // One semitone off
  if (semitonesOff <= 2) return 20; // Two semitones off
  return 0;
}

function getNoteIndex(noteName: string): number {
  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 0;
  const noteIdx   = NOTE_NAMES.indexOf(match[1]);
  const octave    = parseInt(match[2], 10);
  return octave * 12 + noteIdx;
}

// ─── GENERATE REFERENCE TONE ──────────────────────────────
/**
* Returns the frequency (Hz) for a note name like "A4", "C#3".
* Used by coach to "sing" the correct note to the user.
*/
export function noteNameToFrequency(noteName: string): number {
  const match = noteName.match(/^([A-G]#?)(\d+)$/);
  if (!match) return 440;
  const noteIdx  = NOTE_NAMES.indexOf(match[1]);
  const octave   = parseInt(match[2], 10);
  const semis    = (octave - 4) * 12 + (noteIdx - 9); // relative to A4
  return 440 * Math.pow(2, semis / 12);
}

// ─── VOCAL RANGE ANALYSIS ─────────────────────────────────
export interface VocalRangeResult {
  lowestNote:  string;
  highestNote: string;
  rangeLabel:  string; // 'Bass', 'Baritone', 'Tenor', 'Mezzo-Soprano', 'Soprano'
  rangeOctaves: number;
}

export function analyseVocalRange(frequencies: number[]): VocalRangeResult {
  const valid = frequencies.filter(f => f > 80 && f < 1200);
  if (valid.length === 0) {
    return { lowestNote: '—', highestNote: '—', rangeLabel: 'Unknown', rangeOctaves: 0 };
  }

  const lowest  = Math.min(...valid);
  const highest = Math.max(...valid);
  const lo      = frequencyToNote(lowest);
  const hi      = frequencyToNote(highest);

  const rangeOctaves = (hi.octave + hi.note.length) - (lo.octave + lo.note.length) > 0
    ? Math.round(((highest / lowest) / Math.log2(2)) * 10) / 10
    : 0;

  let rangeLabel = 'Unknown';
  if (lowest < 100)        rangeLabel = 'Bass';
  else if (lowest < 160)   rangeLabel = 'Baritone';
  else if (lowest < 220)   rangeLabel = 'Tenor';
  else if (lowest < 330)   rangeLabel = 'Mezzo-Soprano';
  else                     rangeLabel = 'Soprano';

  return {
    lowestNote:  `${lo.note}${lo.octave}`,
    highestNote: `${hi.note}${hi.octave}`,
    rangeLabel,
    rangeOctaves: Math.abs(Math.log2(highest / lowest)),
  };
} 
