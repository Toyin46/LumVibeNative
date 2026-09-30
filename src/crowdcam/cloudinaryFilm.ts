// ─────────────────────────────────────────────────────────────
// src/crowdcam/cloudinaryFilm.ts
// Builds ONE Cloudinary URL that trims each chosen piece and joins them
// (Cloudinary "splice"), so no FFmpeg and no server of our own is needed.
// The first request for the URL makes Cloudinary generate the film;
// waitForFilm() polls until it is ready.
// ─────────────────────────────────────────────────────────────
import type { Segment } from './autoDirector';

export interface FilmUrlOptions {
  cloudName: string;
  /** public ids of the uploaded clips, keyed by clip id */
  publicIds: Record<string, string>;
  segments: Segment[];
  width?: number;
  height?: number;
  /**
   * EXPERIMENTAL. If set, every piece is muted and this clip's audio plays
   * underneath the whole film (one steady soundtrack, no audio jumps).
   * Test on 2 clips first. Leave undefined to keep each piece's own audio.
   */
  baseAudioClipId?: string | null;
}

/** folders in a public id are written with ":" inside a layer */
const layerId = (publicId: string) => publicId.replace(/\//g, ':');
const num = (n: number) => String(Math.round(n * 100) / 100);

export function buildFilmUrl(o: FilmUrlOptions): string {
  const w = o.width ?? 720;
  const h = o.height ?? 1280;
  if (o.segments.length === 0) throw new Error('No segments to build a film from');
  const mute = !!o.baseAudioClipId;

  const pidOf = (clipId: string) => {
    const p = o.publicIds[clipId];
    if (!p) throw new Error('Missing Cloudinary id for clip ' + clipId);
    return p;
  };

  const parts: string[] = [];
  const first = o.segments[0];
  parts.push(`so_${num(first.srcStartSec)},eo_${num(first.srcEndSec)}`);
  parts.push(`c_fill,w_${w},h_${h},q_auto:good`);
  if (mute) parts.push('e_volume:mute');

  for (let i = 1; i < o.segments.length; i++) {
    const s = o.segments[i];
    parts.push(`fl_splice,l_video:${layerId(pidOf(s.clipId))}`);
    parts.push(`so_${num(s.srcStartSec)},eo_${num(s.srcEndSec)}`);
    parts.push(`c_fill,w_${w},h_${h}`);
    if (mute) parts.push('e_volume:mute');
    parts.push('fl_layer_apply');
  }

  if (mute && o.baseAudioClipId) {
    parts.push(`l_audio:${layerId(pidOf(o.baseAudioClipId))}`);
    parts.push('fl_layer_apply');
  }

  return `https://res.cloudinary.com/${o.cloudName}/video/upload/${parts.join('/')}/${pidOf(first.clipId)}.mp4`;
}

/** a still picture from an uploaded clip (used for the angle thumbnails) */
export function angleThumbUrl(cloudName: string, publicId: string, atSec = 1): string {
  return `https://res.cloudinary.com/${cloudName}/video/upload/so_${atSec},c_fill,w_240,h_426,q_auto,f_jpg/${publicId}.jpg`;
}

/** 8 kHz audio version of a clip, used only for syncing (small download) */
export function audioUrlFor(cloudName: string, publicId: string, lowRate = true): string {
  return `https://res.cloudinary.com/${cloudName}/video/upload/${lowRate ? 'af_8000/' : ''}${publicId}.wav`;
}

/** Cloudinary makes new derived videos on the first request; wait until it is ready */
export async function waitForFilm(
  url: string,
  opts: { timeoutMs?: number; onTick?: (secondsWaited: number) => void } = {},
): Promise<void> {
  const timeout = opts.timeoutMs ?? 150000;
  const started = Date.now();
  let delay = 1500;
  let lastNote = '';
  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return;
      const note = res.headers.get('x-cld-error') || '';
      if (note) lastNote = note;
      // 423 = still being generated. Anything else 4xx with a message = real error.
      if (res.status !== 423 && res.status !== 202 && res.status >= 400 && res.status < 500 && note) {
        throw new Error('Cloudinary could not build the film: ' + note);
      }
    } catch (e: any) {
      if (String(e?.message || '').startsWith('Cloudinary could not')) throw e;
      // network hiccup: just retry
    }
    opts.onTick?.(Math.round((Date.now() - started) / 1000));
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(6000, delay + 750);
  }
  throw new Error('The film took too long to build' + (lastNote ? ': ' + lastNote : ''));
}
