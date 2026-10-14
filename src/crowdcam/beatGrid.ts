// ─────────────────────────────────────────────────────────────
// src/crowdcam/beatGrid.ts   (NEW FILE)
// Pure TypeScript. Finds a steady beat in audio we ALREADY download for syncing
// (the 100-per-second loudness-change pattern from syncEngine.computeEnvelope).
// Returns null when there is no steady beat (people talking, wind, a quiet room),
// and the director then cuts the old random way.
// ─────────────────────────────────────────────────────────────
import { FINE_HZ } from './syncEngine';
import type { SyncedClip } from './syncEngine';

export interface BeatGrid {
  bpm: number;
  /** beat times in seconds */
  beats: number[];
  /** how clear the beat is (higher = clearer) */
  strength: number;
  /** biggest-energy moment (seconds), or null */
  peakSec: number | null;
  /** 'event' = beats are on the shared event timeline (room sound); 'film' = beats are on film time (a song starting at 0) */
  domain: 'event' | 'film';
}

const MIN_BPM = 70;
const MAX_BPM = 180;
const MIN_ANALYSE_SEC = 8;
const MAX_ANALYSE_SEC = 120;
/** below this the beat is not trusted. Calibrated on synthetic audio only: TUNE with real clips. */
export const MIN_BEAT_STRENGTH = 1.2;

/** all phones laid on the shared timeline and averaged: one onset-friendly pattern for the whole event */
export function timelineEnvelope(clips: SyncedClip[], envs: Record<string, Float32Array>): Float32Array {
  let len = 0;
  for (const c of clips) {
    const e = envs[c.id];
    if (e) len = Math.max(len, Math.floor(c.startSec * FINE_HZ) + e.length);
  }
  len = Math.min(len, MAX_ANALYSE_SEC * FINE_HZ);
  const sum = new Float32Array(len), cnt = new Uint16Array(len);
  for (const c of clips) {
    const e = envs[c.id];
    if (!e) continue;
    const off = Math.floor(c.startSec * FINE_HZ);
    for (let i = 0; i < e.length && off + i < len; i++) { sum[off + i] += e[i]; cnt[off + i]++; }
  }
  for (let i = 0; i < len; i++) if (cnt[i] > 1) sum[i] /= cnt[i];
  return sum;
}

/** loudness-change pattern -> "something just got louder" pattern */
function onsetStrength(env: Float32Array): Float32Array {
  const n = env.length;
  const d = new Float32Array(n);
  for (let i = 3; i < n; i++) d[i] = Math.max(0, env[i] - env[i - 3]);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const g = (k: number) => (i + k >= 0 && i + k < n ? d[i + k] : 0);
    o[i] = (g(-2) + 2 * g(-1) + 3 * g(0) + 2 * g(1) + g(2)) / 9; // ~50 ms smoothing
  }
  return o;
}

interface Comb { bpm: number; phase: number; strength: number }

/** try every tempo and every start offset; keep the one whose beats land on the strongest onsets */
function bestComb(o: Float32Array, from: number, to: number): Comb | null {
  const n = to - from;
  if (n < MIN_ANALYSE_SEC * FINE_HZ) return null;
  let m = 0;
  for (let i = from; i < to; i++) m += o[i];
  m /= n;
  let v = 0;
  for (let i = from; i < to; i++) v += (o[i] - m) * (o[i] - m);
  const sd = Math.sqrt(v / n);
  if (sd < 1e-6) return null;

  let best: Comb | null = null;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const period = (60 * FINE_HZ) / bpm;
    const prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / 120) / 0.55, 2)); // gentle pull towards 120 BPM
    for (let ph = 0; ph < period; ph += 1) {
      let sum = 0, k = 0;
      for (let pos = from + ph; pos < to - 1; pos += period) { sum += o[Math.round(pos)]; k++; }
      if (k < 6) continue;
      const strength = ((sum / k - m) / sd) * prior;
      if (!best || strength > best.strength) best = { bpm, phase: ph, strength };
    }
  }
  return best;
}

/** like bestComb but the speed is fixed: only the start offset is searched */
function bestPhase(o: Float32Array, from: number, to: number, bpm: number): Comb | null {
  const n = to - from;
  let m = 0;
  for (let i = from; i < to; i++) m += o[i];
  m /= n;
  let v = 0;
  for (let i = from; i < to; i++) v += (o[i] - m) * (o[i] - m);
  const sd = Math.sqrt(v / n);
  if (sd < 1e-6) return null;
  const period = (60 * FINE_HZ) / bpm;
  let best: Comb | null = null;
  for (let ph = 0; ph < period; ph += 1) {
    let sum = 0, k = 0;
    for (let pos = from + ph; pos < to - 1; pos += period) { sum += o[Math.round(pos)]; k++; }
    if (k < 4) continue;
    const strength = (sum / k - m) / sd;
    if (!best || strength > best.strength) best = { bpm, phase: ph, strength };
  }
  return best;
}

export function detectBeats(env: Float32Array, domain: 'event' | 'film'): BeatGrid | null {
  const e = env.length > MAX_ANALYSE_SEC * FINE_HZ ? env.subarray(0, MAX_ANALYSE_SEC * FINE_HZ) : env;
  if (e.length < MIN_ANALYSE_SEC * FINE_HZ) return null;
  const o = onsetStrength(e);
  const n = o.length;

  const full = bestComb(o, 0, n);
  if (!full || full.strength < MIN_BEAT_STRENGTH) return null;

  // a real beat keeps the same speed AND stays on the same spot all the way through:
  // with the speed fixed, both halves must find their best beat positions where the full grid says
  if (n >= 2 * MIN_ANALYSE_SEC * FINE_HZ) {
    const period0 = (60 * FINE_HZ) / full.bpm;
    const mid = Math.floor(n / 2);
    for (const [from, to] of [[0, mid], [mid, n]]) {
      const h = bestPhase(o, from, to, full.bpm);
      if (!h || h.strength < MIN_BEAT_STRENGTH * 0.6) return null;
      // where the full grid has a beat close to this half's first beat
      const expected = (((full.phase - from) % period0) + period0) % period0;
      const diff = Math.abs(h.phase - expected);
      if (Math.min(diff, period0 - diff) > 5) return null; // more than 50 ms away: not the same beat
    }
  }

  const period = (60 * FINE_HZ) / full.bpm;
  const beats: number[] = [];
  for (let pos = full.phase; pos < n; pos += period) beats.push(Math.round((pos / FINE_HZ) * 1000) / 1000);

  // biggest moment = the 1.5 s window with the most "got louder" energy
  let peakSec: number | null = null;
  const w = Math.round(1.5 * FINE_HZ);
  if (n > 3 * w) {
    let run = 0, bestRun = -1, bestAt = 0;
    for (let i = 0; i < n; i++) {
      run += o[i];
      if (i >= w) run -= o[i - w];
      if (i >= w - 1 && run > bestRun) { bestRun = run; bestAt = i - w + 1; }
    }
    peakSec = Math.round((bestAt / FINE_HZ) * 100) / 100;
  }
  return { bpm: Math.round(full.bpm * 10) / 10, beats, strength: Math.round(full.strength * 100) / 100, peakSec, domain };
}
