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
}

export interface FilmResult {
  filmUrl: string;
  localUri: string;
  contributors: string[];
  durationSec: number;
  shots: number;
  angles: Angle[];
  usedBaseAudio: boolean;
}

export interface RenderOptions extends DirectorOptions {
  /** EXPERIMENTAL one-soundtrack mode. Default false until tested on real clips. */
  useBaseAudio?: boolean;
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
  for (let i = 0; i < rows.length; i++) {
    stage('audio', `${i + 1}/${rows.length}`);
    const { env, rms } = await loadClipAudio(rows[i].cloudinary_public_id); // one at a time = low memory
    if (rms < SILENT_RMS) silent.push(rows[i].id);
    const t = Date.parse(rows[i].recorded_at);
    inputs.push({ id: rows[i].id, env, recordedAtMs: Number.isFinite(t) ? t : undefined });
  }

  stage('syncing');
  const synced = syncClips(inputs);
  const analysis: RoomAnalysis = { roomId, rows, synced, silentClipIds: silent };
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
  const plan = planFilm(a.synced.clips, opts);
  if (plan.segments.length === 0) throw new Error('Nothing to cut.');

  const publicIds: Record<string, string> = {};
  a.rows.forEach(r => { publicIds[r.id] = r.cloudinary_public_id; });
  const base = opts.useBaseAudio ? chooseBaseAudioClip(a.synced.clips, plan) : null;
  const filmUrl = buildFilmUrl({
    cloudName: CROWD_CLOUD_NAME,
    publicIds,
    segments: plan.segments,
    baseAudioClipId: base?.id ?? null,
  });

  stage('rendering');
  try {
    await waitForFilm(filmUrl, { onTick: s => stage('rendering', `${s}s`) });
  } catch (e: any) {
    throw Object.assign(e instanceof Error ? e : new Error(String(e)), { details: filmUrl });
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
  return { filmUrl, localUri: dl.uri, contributors, durationSec: plan.durationSec, shots: plan.segments.length, angles, usedBaseAudio: !!base };
}
