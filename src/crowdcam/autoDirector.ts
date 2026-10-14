// ─────────────────────────────────────────────────────────────
// src/crowdcam/autoDirector.ts
// Pure TypeScript. Takes the synced clips and decides the cuts,
// like a TV director switching between cameras.
// Same seed + same clips = same film (repeatable).
// ─────────────────────────────────────────────────────────────
import type { SyncedClip } from './syncEngine';
import type { BeatGrid } from './beatGrid';

export interface Segment {
  clipId: string;
  /** which part of the ORIGINAL clip to use (seconds into that clip) */
  srcStartSec: number;
  srcEndSec: number;
  /** where this piece sits in the finished film */
  filmStartSec: number;
  filmEndSec: number;
  /** beat mode only: zoom in a little on this piece (the crop is done by cloudinaryFilm) */
  punch?: boolean;
}

export interface FilmPlan {
  segments: Segment[];
  durationSec: number;
  /** true if nobody was filming for some stretch, so film time no longer equals event time */
  hasGaps: boolean;
  /** tempo the cuts were snapped to, or null when the old random cutting was used */
  beatBpm?: number | null;
}

export interface DirectorOptions {
  minSegSec?: number;   // shortest shot
  maxSegSec?: number;   // longest shot
  maxFilmSec?: number;  // cap so the finished file stays small enough to upload
  seed?: number;
  /** if given (and clear enough), cuts land on the beats. Otherwise the old random cutting runs, unchanged. */
  beatGrid?: BeatGrid | null;
  /** beat mode: most pieces in the film (keeps the film link short and the render quick) */
  maxCuts?: number;
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

/** how many beats a shot should last: the option (1, 2, 4 or 8) closest to the wanted length */
const BEAT_OPTIONS = [1, 2, 4, 8];
function pickBeatCount(wanted: number, jitter: number): number {
  let idx = 0, bestD = Infinity;
  BEAT_OPTIONS.forEach((o, i) => {
    const d = Math.abs(Math.log(o / Math.max(0.5, wanted)));
    if (d < bestD) { bestD = d; idx = i; }
  });
  if (jitter < 0.18) idx = Math.max(0, idx - 1);                         // now and then, a quicker shot
  else if (jitter > 0.88) idx = Math.min(BEAT_OPTIONS.length - 1, idx + 1); // or a longer one
  return BEAT_OPTIONS[idx];
}

export function planFilm(clips: SyncedClip[], opts: DirectorOptions = {}): FilmPlan {
  let minSeg = opts.minSegSec ?? 2.5;
  let maxSeg = Math.max(minSeg, opts.maxSegSec ?? 6);
  const maxFilm = opts.maxFilmSec ?? 60;
  const rand = mulberry32(opts.seed ?? 1);
  if (clips.length === 0) return { segments: [], durationSec: 0, hasGaps: false };

  const eventEnd = Math.max(...clips.map(c => c.startSec + c.durationSec));
  const end = Math.min(maxFilm, eventEnd);

  // ── beat mode (only when a clear beat was found) ──
  const grid = opts.beatGrid && opts.beatGrid.beats.length >= 4 && opts.beatGrid.bpm > 0 ? opts.beatGrid : null;
  const beatSec = grid ? 60 / grid.bpm : 0;
  let peakT: number | null = null;
  let peakDone = false;
  if (grid) {
    minSeg = Math.max(opts.minSegSec ?? 1.3, end / (opts.maxCuts ?? 24));
    maxSeg = Math.max(minSeg, maxSeg);
    if (grid.peakSec !== null) {
      const near = grid.beats.reduce((b, x) => (Math.abs(x - grid.peakSec!) < Math.abs(b - grid.peakSec!) ? x : b), grid.beats[0]);
      if (near > end * 0.25 && near < end * 0.9) peakT = near; // a punch right at the start or the very end would be pointless
    }
  }
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
    let punch: boolean | undefined;
    if (grid) {
      const c = grid.domain === 'film' ? filmT : t; // where we are, measured on the clock the beats use
      const p = c / Math.max(1, end);
      const want = p < 0.2 ? 4.5 : p > 0.85 ? 3.2 : 2.2; // slower at the start, faster in the middle
      const n = pickBeatCount(want / beatSec, rand());
      let i0 = grid.beats.findIndex(b => b >= c - 0.06);
      if (i0 < 0) i0 = grid.beats.length;
      for (let k = n; i0 + k < grid.beats.length; k++) {
        const b = grid.beats[i0 + k];
        if (b - c >= minSeg) { len = b - c; break; }
      }
      punch = raw.length % 2 === 1; // wide, punched-in, wide, punched-in ...
      if (peakT !== null && !peakDone) {
        if (Math.abs(c - peakT) < 0.08) {
          len = Math.min(len, Math.ceil((minSeg * 0.8) / beatSec) * beatSec); // short punchy shot on the big moment
          punch = true;
          peakDone = true;
        } else if (c < peakT && c + len > peakT + 0.05 && peakT - c >= minSeg * 0.6) {
          len = peakT - c; // finish this shot exactly on the big moment
        }
      }
    }
    len = Math.min(len, cover, end - t);
    // don't leave a tiny sliver at the end
    if (end - t - len < minSeg * 0.6 && cover >= end - t) len = end - t;

    raw.push({
      clipId: chosen.id,
      srcStartSec: r2(t - chosen.startSec),
      srcEndSec: r2(t - chosen.startSec + len),
      filmStartSec: r2(filmT),
      filmEndSec: r2(filmT + len),
      ...(punch ? { punch: true } : {}),
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
    if (last && last.clipId === s.clipId && !!last.punch === !!s.punch && Math.abs(last.srcEndSec - s.srcStartSec) < 0.02) {
      last.srcEndSec = s.srcEndSec;
      last.filmEndSec = s.filmEndSec;
    } else segments.push({ ...s });
  }
  return { segments, durationSec: r2(filmT), hasGaps, beatBpm: grid ? grid.bpm : null };
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
