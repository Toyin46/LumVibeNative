// ─────────────────────────────────────────────────────────────
// src/crowdcam/syncEngine.ts
// Pure TypeScript. No native modules, no React, no network.
// Job: given the audio of several phones that filmed the same event,
// work out how far each phone's recording is shifted from the others.
//
// How: turn each phone's audio into a small "loudness pattern" (100 values
// per second), then slide the patterns against each other and see where they
// line up best (cross-correlation). Coarse pass first (25/sec) for speed,
// then a fine pass (100/sec = 10 ms precision) around the best spot.
// ─────────────────────────────────────────────────────────────

export const FINE_HZ = 100;
const COARSE_FACTOR = 4;
const COARSE_HZ = FINE_HZ / COARSE_FACTOR;

// Thresholds. Calibrated on simulated audio only -- TUNE with real recordings.
// "strict": search the whole timeline. "hinted": we already know roughly where the
// answer must be (the phones pressed record within seconds of each other), so a
// much smaller search window is used and a weaker match is trustworthy.
export const MIN_SCORE = 0.7;
export const MIN_CONFIDENCE = 7;
// near window (+-3 s around the start-time guess): a wrong match can never be worse
// than 3 s off, so a weaker match is acceptable. far window (+-10 s): stricter.
export const NEAR_RADIUS_SEC = 3;
export const NEAR_MIN_SCORE = 0.45;
export const NEAR_MIN_CONFIDENCE = 3;
export const FAR_RADIUS_SEC = 10;
export const FAR_MIN_SCORE = 0.65;
export const FAR_MIN_CONFIDENCE = 5;

export interface WavData { samples: Float32Array; sampleRate: number }

export interface OffsetEstimate {
  /** where clip B's t=0 sits on clip A's timeline (seconds; can be negative) */
  offsetSec: number;
  /** fine-pass match score (about -1..1, higher = better) */
  score: number;
  /** how many standard deviations the best match stands above every other possible alignment */
  confidence: number;
  /** coarse-pass best score */
  coarseScore: number;
}

export interface ClipInput {
  id: string;
  env: Float32Array;
  /** when the phone pressed record (device clock, ms since 1970). Optional but very useful. */
  recordedAtMs?: number;
}

export type SyncMethod = 'reference' | 'audio' | 'audio-hinted' | 'start-time';

export interface SyncedClip {
  id: string;
  /** seconds from the start of the film timeline (>= 0) */
  startSec: number;
  durationSec: number;
  confidence: number;
  /** which already-synced clip this one was matched against (null = reference) */
  syncedTo: string | null;
  /** how the position was found; 'start-time' = approximate (no reliable sound match) */
  method: SyncMethod;
}

export interface PairReport {
  clipId: string;
  anchorId: string;
  hintSec: number | null;
  full: { offsetSec: number; score: number; prominence: number } | null;
  near: { offsetSec: number; score: number; prominence: number } | null;
  far: { offsetSec: number; score: number; prominence: number } | null;
}

export interface SyncResult {
  clips: SyncedClip[];
  failed: string[];
  /** numbers behind every decision, for debugging with real clips */
  reports: PairReport[];
}

export interface SyncOptions {
  maxLagSec?: number;
  /** if true (default) a clip that cannot be matched by sound is placed by its start time */
  startTimeFallback?: boolean;
}

export interface SearchOptions {
  maxLagSec?: number;
  /** only look for the answer near centerSec +/- radiusSec */
  centerSec?: number;
  radiusSec?: number;
}

// ── WAV parsing ───────────────────────────────────────────────
export function parseWav(buf: ArrayBuffer): WavData {
  if (buf.byteLength < 44) throw new Error('WAV file too small');
  const v = new DataView(buf);
  const tag = (o: number) =>
    String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');

  let pos = 12;
  let format = 1, channels = 1, sampleRate = 8000, bits = 16;
  let dataStart = -1, dataLen = 0;
  while (pos + 8 <= buf.byteLength) {
    const id = tag(pos);
    let size = v.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      format = v.getUint16(body, true);
      channels = v.getUint16(body + 2, true);
      sampleRate = v.getUint32(body + 4, true);
      bits = v.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = v.getUint16(body + 24, true);
    } else if (id === 'data') {
      // streamed WAVs write 0 or 0xFFFFFFFF as the size
      if (size === 0 || size === 0xffffffff || body + size > buf.byteLength) size = buf.byteLength - body;
      dataStart = body;
      dataLen = size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (dataStart < 0) throw new Error('WAV has no data chunk');
  if (channels < 1) throw new Error('WAV has no channels');

  const bytes = bits / 8;
  const frames = Math.floor(dataLen / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const o = dataStart + (i * channels + c) * bytes;
      let s = 0;
      if (format === 3 && bits === 32) s = v.getFloat32(o, true);
      else if (bits === 16) s = v.getInt16(o, true) / 32768;
      else if (bits === 8) s = (v.getUint8(o) - 128) / 128;
      else if (bits === 24) {
        let x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16);
        if (x & 0x800000) x |= ~0xffffff;
        s = x / 8388608;
      } else if (bits === 32) s = v.getInt32(o, true) / 2147483648;
      else throw new Error('Unsupported WAV bit depth: ' + bits);
      sum += s;
    }
    samples[i] = sum / channels;
  }
  return { samples, sampleRate };
}

// ── Loudness pattern ("envelope") ────────────────────────────
function zscore(x: Float32Array): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) { const d = x[i] - mean; v += d * d; }
  const std = Math.sqrt(v / n);
  if (std < 1e-6) return out; // silence / flat -> all zeros, can never match
  for (let i = 0; i < n; i++) out[i] = (x[i] - mean) / std;
  return out;
}

function removeLocalMean(x: Float32Array, win: number): Float32Array {
  const n = x.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  const h = Math.floor(win / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n - 1, i + h);
    out[i] = x[i] - (pre[b + 1] - pre[a]) / (b - a + 1);
  }
  return out;
}

/** audio samples -> 100-per-second loudness-change pattern */
export function computeEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
  const hop = sampleRate / FINE_HZ;
  const n = Math.floor(samples.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * hop);
    const e = Math.min(samples.length, Math.floor((i + 1) * hop));
    let acc = 0;
    for (let j = s; j < e; j++) {
      const d = samples[j] - prev; // first difference = crude high-pass (drops rumble/wind)
      prev = samples[j];
      acc += d * d;
    }
    env[i] = Math.log(Math.sqrt(acc / Math.max(1, e - s)) + 1e-4); // log = ignore loudness differences between phones
  }
  return zscore(removeLocalMean(env, FINE_HZ)); // 1 s window: keep changes, drop steady level
}

export function envelopeFromWav(buf: ArrayBuffer): Float32Array {
  const { samples, sampleRate } = parseWav(buf);
  return computeEnvelope(samples, sampleRate);
}

// ── Sliding match ────────────────────────────────────────────
function pool(x: Float32Array, f: number): Float32Array {
  const n = Math.floor(x.length / f);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < f; k++) acc += x[i * f + k];
    out[i] = acc / f;
  }
  return zscore(out);
}

/** prefix sums so window sums cost O(1) */
function prefix(x: Float32Array, square: boolean): Float64Array {
  const p = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) p[i + 1] = p[i] + (square ? x[i] * x[i] : x[i]);
  return p;
}

/**
 * Pearson correlation of the overlapping part, for each lag
 * (a[i] vs b[i - lag]). Normalised per overlap, so a short lucky overlap
 * can't beat a long honest one.
 */
function scoreLags(a: Float32Array, b: Float32Array, lagMin: number, lagMax: number, minOverlap: number): Float32Array {
  const out = new Float32Array(Math.max(0, lagMax - lagMin + 1));
  out.fill(-2); // -2 = "not comparable" (real scores are within -1..1)
  const pa = prefix(a, false), paa = prefix(a, true);
  const pb = prefix(b, false), pbb = prefix(b, true);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const i0 = Math.max(0, lag);
    const i1 = Math.min(a.length, b.length + lag);
    const n = i1 - i0;
    if (n < minOverlap) continue;
    const sa = pa[i1] - pa[i0], saa = paa[i1] - paa[i0];
    const j0 = i0 - lag, j1 = i1 - lag;
    const sb = pb[j1] - pb[j0], sbb = pbb[j1] - pbb[j0];
    let sab = 0;
    for (let i = i0; i < i1; i++) sab += a[i] * b[i - lag];
    const den = (n * saa - sa * sa) * (n * sbb - sb * sb);
    out[lag - lagMin] = den > 1e-9 ? (n * sab - sa * sb) / Math.sqrt(den) : 0;
  }
  return out;
}

function findPeak(scores: Float32Array, exclude: number) {
  let idx = 0, best = -Infinity;
  for (let i = 0; i < scores.length; i++) if (scores[i] > best) { best = scores[i]; idx = i; }
  // "prominence": how many standard deviations the best lag stands above all the OTHER lags
  let n = 0, sum = 0, sum2 = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] <= -2 || Math.abs(i - idx) <= exclude) continue;
    n++; sum += scores[i]; sum2 += scores[i] * scores[i];
  }
  let prominence = 0;
  if (n > 5) {
    const mean = sum / n;
    const std = Math.sqrt(Math.max(1e-9, sum2 / n - mean * mean));
    prominence = (best - mean) / std;
  }
  return { idx, best, prominence };
}

/** quick sanity numbers about a clip's sound (to spot silent clips) */
export function audioStats(samples: Float32Array): { rms: number; peak: number } {
  let acc = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    acc += samples[i] * samples[i];
    if (a > peak) peak = a;
  }
  return { rms: samples.length ? Math.sqrt(acc / samples.length) : 0, peak };
}

/**
 * Where does clip B start on clip A's timeline?
 * Pass a number (max lag in seconds) or SearchOptions. Returns null if the clips
 * are too short / cannot be compared.
 */
export function estimateOffset(refEnv: Float32Array, clipEnv: Float32Array, options: number | SearchOptions = {}): OffsetEstimate | null {
  const o: SearchOptions = typeof options === 'number' ? { maxLagSec: options } : options;
  const aC = pool(refEnv, COARSE_FACTOR);
  const bC = pool(clipEnv, COARSE_FACTOR);
  if (Math.min(aC.length, bC.length) < 2 * COARSE_HZ) return null;

  const minOv = Math.max(8, Math.min(Math.round(6 * COARSE_HZ), Math.floor(0.5 * Math.min(aC.length, bC.length))));
  let lo: number, hi: number;
  if (o.centerSec !== undefined && o.radiusSec !== undefined) {
    lo = Math.round((o.centerSec - o.radiusSec) * COARSE_HZ);
    hi = Math.round((o.centerSec + o.radiusSec) * COARSE_HZ);
  } else {
    const m = Math.round((o.maxLagSec ?? 120) * COARSE_HZ);
    lo = -m; hi = m;
  }
  const lagMin = Math.max(lo, -(bC.length - minOv));
  const lagMax = Math.min(hi, aC.length - minOv);
  if (lagMin > lagMax) return null;

  const coarse = scoreLags(aC, bC, lagMin, lagMax, minOv);
  const cp = findPeak(coarse, COARSE_HZ);
  const lagC = lagMin + cp.idx;

  const fLo = lagC * COARSE_FACTOR - (COARSE_FACTOR + 2);
  const fHi = lagC * COARSE_FACTOR + (COARSE_FACTOR + 2);
  const fine = scoreLags(refEnv, clipEnv, fLo, fHi, minOv * COARSE_FACTOR);
  let fi = 0, fb = -Infinity;
  for (let i = 0; i < fine.length; i++) if (fine[i] > fb) { fb = fine[i]; fi = i; }
  if (fb <= -2) return null;

  return {
    offsetSec: (fLo + fi) / FINE_HZ,
    score: fb,
    confidence: cp.prominence,
    coarseScore: cp.best,
  };
}

export function isReliable(e: OffsetEstimate | null): e is OffsetEstimate {
  return !!e && e.coarseScore >= MIN_SCORE && e.confidence >= MIN_CONFIDENCE;
}
const okNear = (e: OffsetEstimate | null): e is OffsetEstimate =>
  !!e && e.coarseScore >= NEAR_MIN_SCORE && e.confidence >= NEAR_MIN_CONFIDENCE;
const okFar = (e: OffsetEstimate | null): e is OffsetEstimate =>
  !!e && e.coarseScore >= FAR_MIN_SCORE && e.confidence >= FAR_MIN_CONFIDENCE;

// ── Sync a whole room ────────────────────────────────────────
/**
 * The longest clip becomes the reference. Each other clip is matched against
 * clips that are already placed. Three levels of evidence, best first:
 *   1. audio, whole timeline, strict thresholds              -> 'audio'
 *   2. audio within +-3 s / +-10 s of the start-time guess    -> 'audio-hinted'
 *   3. (optional) just trust the phones' start times          -> 'start-time'
 */
export function syncClips(clips: ClipInput[], options: number | SyncOptions = {}): SyncResult {
  const opt: SyncOptions = typeof options === 'number' ? { maxLagSec: options } : options;
  const maxLag = opt.maxLagSec ?? 120;
  const useStartTime = opt.startTimeFallback ?? true;
  const reports: PairReport[] = [];
  if (clips.length === 0) return { clips: [], failed: [], reports };

  const byLen = [...clips].sort((a, b) => b.env.length - a.env.length);
  const ref = byLen[0];
  const pos = new Map<string, number>([[ref.id, 0]]);
  const conf = new Map<string, number>([[ref.id, 1]]);
  const via = new Map<string, string | null>([[ref.id, null]]);
  const how = new Map<string, SyncMethod>([[ref.id, 'reference']]);
  const byId = new Map(clips.map(c => [c.id, c] as const));
  let pending = byLen.slice(1);

  const hintFor = (a: ClipInput, c: ClipInput): number | null =>
    a.recordedAtMs !== undefined && c.recordedAtMs !== undefined ? (c.recordedAtMs - a.recordedAtMs) / 1000 : null;

  // Pass 1: audio evidence (strict, then hinted). Repeat so chains can form.
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    const still: ClipInput[] = [];
    for (const c of pending) {
      let best: { est: OffsetEstimate; anchor: string; method: SyncMethod } | null = null;
      for (const a of clips) {
        if (!pos.has(a.id)) continue;
        const hint = hintFor(a, c);
        const full = estimateOffset(a.env, c.env, maxLag);
        const near = hint !== null ? estimateOffset(a.env, c.env, { centerSec: hint, radiusSec: NEAR_RADIUS_SEC }) : null;
        const far = hint !== null ? estimateOffset(a.env, c.env, { centerSec: hint, radiusSec: FAR_RADIUS_SEC }) : null;
        const brief = (e: OffsetEstimate | null) => e && { offsetSec: e.offsetSec, score: e.coarseScore, prominence: e.confidence };
        reports.push({ clipId: c.id, anchorId: a.id, hintSec: hint, full: brief(full), near: brief(near), far: brief(far) });
        if (isReliable(full) && (!best || full.confidence > best.est.confidence)) best = { est: full, anchor: a.id, method: 'audio' };
        if (okFar(far) && (!best || far.confidence > best.est.confidence)) best = { est: far, anchor: a.id, method: 'audio-hinted' };
        if (okNear(near) && (!best || near.confidence > best.est.confidence)) best = { est: near, anchor: a.id, method: 'audio-hinted' };
      }
      if (best) {
        pos.set(c.id, (pos.get(best.anchor) as number) + best.est.offsetSec);
        conf.set(c.id, best.est.confidence);
        via.set(c.id, best.anchor);
        how.set(c.id, best.method);
        progress = true;
      } else still.push(c);
    }
    pending = still;
  }

  // Pass 2: no reliable sound match -> trust the phones' start times (approximate).
  if (pending.length) {
    const stillFailed: ClipInput[] = [];
    for (const c of pending) {
      let anyHint: { anchor: string; hint: number } | null = null;
      for (const a of clips) {
        if (!pos.has(a.id)) continue;
        const hint = hintFor(a, c);
        if (hint !== null) { anyHint = { anchor: a.id, hint }; break; }
      }
      if (useStartTime && anyHint) {
        pos.set(c.id, (pos.get(anyHint.anchor) as number) + anyHint.hint);
        conf.set(c.id, 0);
        via.set(c.id, anyHint.anchor);
        how.set(c.id, 'start-time');
      } else stillFailed.push(c);
    }
    pending = stillFailed;
  }

  let minStart = Infinity;
  pos.forEach(p => { if (p < minStart) minStart = p; });
  const out: SyncedClip[] = [];
  for (const c of clips) {
    if (!pos.has(c.id)) continue;
    out.push({
      id: c.id,
      startSec: Math.round(((pos.get(c.id) as number) - minStart) * 100) / 100,
      durationSec: Math.round((byId.get(c.id)!.env.length / FINE_HZ) * 100) / 100,
      confidence: conf.get(c.id) as number,
      syncedTo: via.get(c.id) ?? null,
      method: how.get(c.id) as SyncMethod,
    });
  }
  return { clips: out, failed: pending.map(p => p.id), reports };
}
