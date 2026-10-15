// ─────────────────────────────────────────────────────────────
// src/crowdcam/buildFilm.ts
// Two steps so "try a different cut" is fast:
//   analyzeRoom()  - download each clip's audio, line the clips up   (slow, once)
//   renderFilm()   - choose the cuts, let Cloudinary build the film  (repeatable)
// Run both on the HOST's phone after everyone has uploaded.
// ─────────────────────────────────────────────────────────────
import * as FileSystem from 'expo-file-system/legacy';
import { listClips, contributorNames, CrowdClipRow, CROWD_CLOUD_NAME } from './crowdCamApi';
import { parseWav, computeEnvelope, audioStats, syncClips, SyncResult, SyncMethod } from './syncEngine';
import { detectBeats, timelineEnvelope, windowGrid, BeatGrid } from './beatGrid';
import { planFilm, chooseBaseAudioClip, DirectorOptions } from './autoDirector';
import { buildFilmUrl, audioUrlFor, angleThumbUrl, waitForFilm } from './cloudinaryFilm';

export type BuildStage = 'listing' | 'audio' | 'syncing' | 'cutting' | 'rendering' | 'downloading' | 'done';

export interface Angle {
  clipId: string;
  userId: string;
  publicId: string;
  thumbUrl: string;
  method: SyncMethod;
  startSec: number;
  durationSec: number;
  silent: boolean;
  usedInFilm: boolean;
}

export interface RoomAnalysis {
  roomId: string;
  rows: CrowdClipRow[];
  synced: SyncResult;
  silentClipIds: string[];
  /** each clip's loudness pattern, kept so the beat can be found without downloading anything again */
  envs?: Record<string, Float32Array>;
}

export interface FilmResult {
  filmUrl: string;
  localUri: string;
  contributors: string[];
  durationSec: number;
  shots: number;
  angles: Angle[];
  usedBaseAudio: boolean;
  /** which soundtrack the film has: one clip's room sound, the host's song, or each piece's own audio */
  soundtrack?: 'room' | 'song' | 'clips';
  /** tempo the cuts follow, or null if cuts are not on a beat */
  beatBpm?: number | null;
  /** something the host should know (for example: the soundtrack had to be dropped) */
  note?: string;
}

/** What plays under the film. 'room' = best clip's real sound. 'song' = a song that is already on Cloudinary. */
export type SoundChoice =
  | { mode: 'room' }
  // startSec/endSec = the part of the song the host picked (seconds into the song). Left out = the whole song.
  | { mode: 'song'; publicId: string; title?: string; startSec?: number; endSec?: number };

export interface RenderOptions extends DirectorOptions {
  /** EXPERIMENTAL one-soundtrack mode. Default false until tested on real clips. */
  useBaseAudio?: boolean;
  /**
   * Host's choice. If given: cuts land on the beat (when a clear beat is found) and ONE soundtrack plays.
   * If left out, Crowd Cam works exactly as before (random cuts, each piece keeps its own audio).
   */
  sound?: SoundChoice;
  onStage?: (stage: BuildStage, detail?: string) => void;
}

const SILENT_RMS = 0.002; // about -54 dB: basically no sound recorded

async function fetchWithRetry(url: string, tries = 8): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = res;
      if (res.status !== 423 && res.status !== 202) break; // 423 = Cloudinary still preparing it
    } catch { /* network hiccup */ }
    await new Promise(r => setTimeout(r, 1200 * (i + 1)));
  }
  throw new Error('Could not download audio for syncing' + (last ? ` (${last.status})` : ''));
}

async function loadClipAudio(publicId: string) {
  let res: Response;
  try {
    res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, true));
  } catch {
    res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, false)); // if the 8 kHz option is refused
  }
  const { samples, sampleRate } = parseWav(await res.arrayBuffer());
  return { env: computeEnvelope(samples, sampleRate), rms: audioStats(samples).rms };
}

const songEnvCache = new Map<string, Float32Array>();
async function loadSongEnvelope(publicId: string): Promise<Float32Array> {
  const hit = songEnvCache.get(publicId);
  if (hit) return hit;
  let res: Response;
  try { res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, true)); }
  catch { res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, false)); }
  const { samples, sampleRate } = parseWav(await res.arrayBuffer());
  const env = computeEnvelope(samples, sampleRate);
  songEnvCache.set(publicId, env);
  return env;
}

/** the numbers behind the sync decisions, as plain text (for support / tuning) */
export function debugSummary(a: RoomAnalysis): string {
  const f = (x: { score: number; prominence: number } | null) => (x ? `${x.score.toFixed(2)}/${x.prominence.toFixed(1)}` : '-');
  const lines: string[] = [`clips: ${a.rows.length}`];
  a.rows.forEach((r, i) => {
    const c = a.synced.clips.find(x => x.id === r.id);
    lines.push(`#${i + 1} ${r.id.slice(0, 6)} dur ${r.duration_sec ?? '?'}s ${a.silentClipIds.includes(r.id) ? 'NO-SOUND ' : ''}${c ? c.method + ' start ' + c.startSec : 'NOT PLACED'}`);
  });
  a.synced.reports.slice(0, 12).forEach(p =>
    lines.push(`${p.clipId.slice(0, 4)}~${p.anchorId.slice(0, 4)} hint ${p.hintSec === null ? '-' : p.hintSec.toFixed(1)} full ${f(p.full)} near ${f(p.near)} far ${f(p.far)}`));
  return lines.join('\n');
}

export async function analyzeRoom(roomId: string, onStage?: (s: BuildStage, detail?: string) => void): Promise<RoomAnalysis> {
  const stage = onStage ?? (() => {});
  stage('listing');
  const rows = await listClips(roomId);
  if (rows.length < 2) throw new Error('You need at least 2 clips from different phones.');

  const inputs: { id: string; env: Float32Array; recordedAtMs?: number }[] = [];
  const silent: string[] = [];
  const envs: Record<string, Float32Array> = {};
  for (let i = 0; i < rows.length; i++) {
    stage('audio', `${i + 1}/${rows.length}`);
    const { env, rms } = await loadClipAudio(rows[i].cloudinary_public_id); // one at a time = low memory
    if (rms < SILENT_RMS) silent.push(rows[i].id);
    const t = Date.parse(rows[i].recorded_at);
    envs[rows[i].id] = env;
    inputs.push({ id: rows[i].id, env, recordedAtMs: Number.isFinite(t) ? t : undefined });
  }

  stage('syncing');
  const synced = syncClips(inputs);
  const analysis: RoomAnalysis = { roomId, rows, synced, silentClipIds: silent, envs };
  if (synced.clips.length < 2) {
    throw Object.assign(
      new Error("Couldn't line the clips up by sound, and there were no start times to fall back on."),
      { details: debugSummary(analysis) },
    );
  }
  return analysis;
}

export async function renderFilm(a: RoomAnalysis, opts: RenderOptions = {}): Promise<FilmResult> {
  const stage = opts.onStage ?? (() => {});
  stage('cutting');
  const sound = opts.sound;
  const silentSet = new Set(a.silentClipIds);

  // the picked part of the song also sets how long the film is (the film is never longer than its music)
  const songStart = sound && sound.mode === 'song' ? Math.max(0, sound.startSec ?? 0) : 0;
  const songEnd = sound && sound.mode === 'song' && sound.endSec && sound.endSec > songStart ? sound.endSec : 0;
  const partSec = songEnd ? songEnd - songStart : 0;

  // 1) find a beat to cut on (only when the host chose a soundtrack mode)
  let grid: BeatGrid | null = null;
  if (sound) {
    try {
      if (sound.mode === 'song') {
        const env = await loadSongEnvelope(sound.publicId);
        grid = detectBeats(env, 'film');                      // beat of the WHOLE song (more reliable)
        if (grid && songEnd) grid = windowGrid(grid, env, songStart, songEnd); // then only the picked part, re-timed to start at 0
      }
      else if (a.envs) grid = detectBeats(timelineEnvelope(a.synced.clips.filter(c => !silentSet.has(c.id)), a.envs), 'event');
    } catch { grid = null; /* no beat found: cut the old random way */ }
  }
  const plan = planFilm(a.synced.clips, { ...opts, maxFilmSec: partSec ? Math.min(opts.maxFilmSec ?? partSec, partSec) : opts.maxFilmSec, beatGrid: grid });
  if (plan.segments.length === 0) throw new Error('Nothing to cut.');

  // 2) pick the soundtrack
  const publicIds: Record<string, string> = {};
  a.rows.forEach(r => { publicIds[r.id] = r.cloudinary_public_id; });
  const wantsRoom = sound ? sound.mode === 'room' : !!opts.useBaseAudio;
  const base = wantsRoom ? chooseBaseAudioClip(a.synced.clips.filter(c => !silentSet.has(c.id)), plan) : null;
  const songId = sound && sound.mode === 'song' ? sound.publicId : null;
  const urlWith = (audio: boolean) => buildFilmUrl({
    cloudName: CROWD_CLOUD_NAME,
    publicIds,
    segments: plan.segments,
    baseAudioClipId: audio ? base?.id ?? null : null,
    songPublicId: audio ? songId : null,
    songStartSec: audio && songEnd ? songStart : null,
    songEndSec: audio && songEnd ? songEnd : null,
  });
  let filmUrl = urlWith(true);
  let usedBase = !!base;
  let usedSong = !!songId;
  let note: string | undefined;

  stage('rendering');
  try {
    await waitForFilm(filmUrl, { onTick: s => stage('rendering', `${s}s`) });
  } catch (e: any) {
    // the one-soundtrack layer is the new, untested part: if Cloudinary refuses it, build the film the way it always worked
    const refused = String(e?.message || '').startsWith('Cloudinary could not');
    if (refused && (usedBase || usedSong)) {
      filmUrl = urlWith(false);
      note = usedSong ? "The song couldn't be added, so each camera's own sound is used." : "One steady soundtrack didn't work, so each camera's own sound is used.";
      usedBase = false; usedSong = false;
      try { await waitForFilm(filmUrl, { onTick: s => stage('rendering', `${s}s`) }); }
      catch (e2: any) { throw Object.assign(e2 instanceof Error ? e2 : new Error(String(e2)), { details: filmUrl }); }
    } else {
      throw Object.assign(e instanceof Error ? e : new Error(String(e)), { details: filmUrl });
    }
  }

  stage('downloading');
  const localUri = `${FileSystem.cacheDirectory}crowdcam_${Date.now()}.mp4`;
  const dl = await FileSystem.downloadAsync(filmUrl, localUri);
  if (dl.status !== 200) throw new Error('Could not download the finished film (' + dl.status + ')');

  const used = new Set(plan.segments.map(s => s.clipId));
  const angles: Angle[] = a.rows.map(r => {
    const c = a.synced.clips.find(x => x.id === r.id);
    return {
      clipId: r.id,
      userId: r.user_id,
      publicId: r.cloudinary_public_id,
      thumbUrl: angleThumbUrl(CROWD_CLOUD_NAME, r.cloudinary_public_id, 1),
      method: c ? c.method : 'start-time',
      startSec: c ? c.startSec : 0,
      durationSec: c ? c.durationSec : 0,
      silent: a.silentClipIds.includes(r.id),
      usedInFilm: used.has(r.id),
    };
  });

  const contributors = await contributorNames(a.roomId);
  stage('done');
  return { filmUrl, localUri: dl.uri, contributors, durationSec: plan.durationSec, shots: plan.segments.length, angles, usedBaseAudio: usedBase, soundtrack: usedSong ? 'song' : usedBase ? 'room' : 'clips', beatBpm: plan.beatBpm ?? null, note };
}
