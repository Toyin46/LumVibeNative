// ─────────────────────────────────────────────────────────────
// src/crowdcam/autoDirector.ts
// Pure TypeScript. Takes the synced clips and decides the cuts,
// like a TV director switching between cameras.
// Same seed + same clips = same film (repeatable).
// ─────────────────────────────────────────────────────────────
import type { SyncedClip } from './syncEngine';

export interface Segment {
  clipId: string;
  /** which part of the ORIGINAL clip to use (seconds into that clip) */
  srcStartSec: number;
  srcEndSec: number;
  /** where this piece sits in the finished film */
  filmStartSec: number;
  filmEndSec: number;
}

export interface FilmPlan {
  segments: Segment[];
  durationSec: number;
  /** true if nobody was filming for some stretch, so film time no longer equals event time */
  hasGaps: boolean;
}

export interface DirectorOptions {
  minSegSec?: number;   // shortest shot
  maxSegSec?: number;   // longest shot
  maxFilmSec?: number;  // cap so the finished file stays small enough to upload
  seed?: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planFilm(clips: SyncedClip[], opts: DirectorOptions = {}): FilmPlan {
  const minSeg = opts.minSegSec ?? 2.5;
  const maxSeg = Math.max(minSeg, opts.maxSegSec ?? 6);
  const maxFilm = opts.maxFilmSec ?? 60;
  const rand = mulberry32(opts.seed ?? 1);
  if (clips.length === 0) return { segments: [], durationSec: 0, hasGaps: false };

  const eventEnd = Math.max(...clips.map(c => c.startSec + c.durationSec));
  const end = Math.min(maxFilm, eventEnd);
  const uses = new Map<string, number>();
  const raw: Segment[] = [];
  let t = 0;
  let filmT = 0;
  let prev: string | null = null;
  let hasGaps = false;
  const MIN_COVER = 0.75;

  let guard = 0;
  while (t < end - 0.25 && guard++ < 1000) {
    let cands = clips.filter(c => c.startSec <= t + 1e-6 && c.startSec + c.durationSec >= t + MIN_COVER);
    if (cands.length === 0) {
      // nobody covers this moment: jump to the next clip that starts later
      const later = clips.filter(c => c.startSec > t).sort((a, b) => a.startSec - b.startSec)[0];
      if (!later || later.startSec >= end) break;
      hasGaps = true;
      t = later.startSec;
      continue;
    }
    if (cands.length > 1 && prev) cands = cands.filter(c => c.id !== prev);

    // prefer angles we have used less
    const weights = cands.map(c => 1 / (1 + (uses.get(c.id) ?? 0)));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = rand() * total;
    let chosen = cands[0];
    for (let i = 0; i < cands.length; i++) {
      pick -= weights[i];
      if (pick <= 0) { chosen = cands[i]; break; }
    }

    const cover = chosen.startSec + chosen.durationSec - t;
    let len = minSeg + rand() * (maxSeg - minSeg);
    len = Math.min(len, cover, end - t);
    // don't leave a tiny sliver at the end
    if (end - t - len < minSeg * 0.6 && cover >= end - t) len = end - t;

    raw.push({
      clipId: chosen.id,
      srcStartSec: r2(t - chosen.startSec),
      srcEndSec: r2(t - chosen.startSec + len),
      filmStartSec: r2(filmT),
      filmEndSec: r2(filmT + len),
    });
    uses.set(chosen.id, (uses.get(chosen.id) ?? 0) + 1);
    prev = chosen.id;
    t += len;
    filmT += len;
  }

  // merge neighbours that are the same clip and continuous
  const segments: Segment[] = [];
  for (const s of raw) {
    const last = segments[segments.length - 1];
    if (last && last.clipId === s.clipId && Math.abs(last.srcEndSec - s.srcStartSec) < 0.02) {
      last.srcEndSec = s.srcEndSec;
      last.filmEndSec = s.filmEndSec;
    } else segments.push({ ...s });
  }
  return { segments, durationSec: r2(filmT), hasGaps };
}

/**
 * A clip that can provide ONE steady soundtrack for the whole film:
 * starts at film time 0 and lasts (almost) the whole film. Otherwise null.
 */
export function chooseBaseAudioClip(clips: SyncedClip[], plan: FilmPlan): SyncedClip | null {
  if (plan.hasGaps || plan.durationSec <= 0) return null;
  const ok = clips.filter(c => c.startSec <= 0.05 && c.durationSec >= plan.durationSec * 0.98);
  if (ok.length === 0) return null;
  return ok.sort((a, b) => b.confidence - a.confidence || b.durationSec - a.durationSec)[0];
}
