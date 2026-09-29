// ─────────────────────────────────────────────────────────────
// src/crowdcam/buildFilm.ts
// The whole pipeline in one call:
//   clips in room -> 8 kHz audio -> sync -> director cuts -> Cloudinary URL
//   -> wait until ready -> download to the phone.
// Run it on the HOST's phone after everyone has uploaded.
// ─────────────────────────────────────────────────────────────
import * as FileSystem from 'expo-file-system/legacy';
import { listClips, contributorNames, CROWD_CLOUD_NAME } from './crowdCamApi';
import { envelopeFromWav, syncClips } from './syncEngine';
import { planFilm, chooseBaseAudioClip, DirectorOptions } from './autoDirector';
import { buildFilmUrl, audioUrlFor, waitForFilm } from './cloudinaryFilm';

export type BuildStage = 'listing' | 'audio' | 'syncing' | 'cutting' | 'rendering' | 'downloading' | 'done';

export interface BuildResult {
  filmUrl: string;
  localUri: string;
  contributors: string[];
  durationSec: number;
  shots: number;
  /** clips that could not be lined up with the others (left out of the film) */
  failedClipIds: string[];
  usedBaseAudio: boolean;
}

export interface BuildOptions extends DirectorOptions {
  /** EXPERIMENTAL one-soundtrack mode. Default false until tested on real clips. */
  useBaseAudio?: boolean;
  onStage?: (stage: BuildStage, detail?: string) => void;
}

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

async function loadEnvelope(publicId: string): Promise<Float32Array> {
  let res: Response;
  try {
    res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, true));
  } catch {
    // if the 8 kHz option is ever refused, take the normal WAV (bigger but works)
    res = await fetchWithRetry(audioUrlFor(CROWD_CLOUD_NAME, publicId, false));
  }
  return envelopeFromWav(await res.arrayBuffer());
}

export async function buildCrowdFilm(roomId: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const stage = opts.onStage ?? (() => {});

  stage('listing');
  const rows = await listClips(roomId);
  if (rows.length < 2) throw new Error('You need at least 2 clips from different phones.');

  stage('audio');
  const inputs: { id: string; env: Float32Array }[] = [];
  for (let i = 0; i < rows.length; i++) {
    stage('audio', `${i + 1}/${rows.length}`);
    inputs.push({ id: rows[i].id, env: await loadEnvelope(rows[i].cloudinary_public_id) }); // one at a time = low memory
  }

  stage('syncing');
  const synced = syncClips(inputs);
  if (synced.clips.length < 2) {
    throw new Error("Couldn't line the clips up. They may not overlap in time, or the sound was too different.");
  }

  stage('cutting');
  const plan = planFilm(synced.clips, opts);
  if (plan.segments.length === 0) throw new Error('Nothing to cut.');
  const publicIds: Record<string, string> = {};
  rows.forEach(r => { publicIds[r.id] = r.cloudinary_public_id; });
  const base = opts.useBaseAudio ? chooseBaseAudioClip(synced.clips, plan) : null;
  const filmUrl = buildFilmUrl({
    cloudName: CROWD_CLOUD_NAME,
    publicIds,
    segments: plan.segments,
    baseAudioClipId: base?.id ?? null,
  });

  stage('rendering');
  await waitForFilm(filmUrl, { onTick: s => stage('rendering', `${s}s`) });

  stage('downloading');
  const localUri = `${FileSystem.cacheDirectory}crowdcam_${Date.now()}.mp4`;
  const dl = await FileSystem.downloadAsync(filmUrl, localUri);
  if (dl.status !== 200) throw new Error('Could not download the finished film (' + dl.status + ')');

  const contributors = await contributorNames(roomId);
  stage('done');
  return {
    filmUrl,
    localUri: dl.uri,
    contributors,
    durationSec: plan.durationSec,
    shots: plan.segments.length,
    failedClipIds: synced.failed,
    usedBaseAudio: !!base,
  };
}
