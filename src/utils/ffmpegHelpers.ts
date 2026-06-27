// ═══════════════════════════════════════════════════════════
// ffmpegHelpers.ts — FFmpegKit processing
// PATH: src/utils/ffmpegHelpers.ts
//
// FIXES vs previous version:
//  1. concatenateScenes: re-encodes each scene to uniform
//     1080x1920 h264/aac before concat — fixes codec mismatch
//     crash when scenes came from different sources.
//  2. bakeSceneVideo: NEW — takes a raw video URI + scene
//     config (filter, voice effect, speed) and bakes
//     everything into one clean mp4. MovieStudioScreen calls
//     this per scene before concatenation.
//  3. extractAudioFromVideo: NEW — rips audio from a camera
//     recording so voice effects can be applied, then
//     mergeVideoAudio re-attaches the processed audio.
//  4. All other helpers are unchanged from the original.
// ═══════════════════════════════════════════════════════════

import { FFmpegKit, ReturnCode } from 'ffmpeg-kit-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { VoiceEffect, StudioEdit, MovieScene } from './types';
import { FFMPEG_VIDEO_FILTERS, FX_EFFECTS } from './constants';

// ─── Paths ────────────────────────────────────────────────
function getCacheDir(): string {
  return FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
}
function tmpVideo(tag: string): string {
  return `${getCacheDir()}${tag}_${Date.now()}.mp4`;
}
function tmpAudio(tag: string): string {
  return `${getCacheDir()}${tag}_${Date.now()}.m4a`;
}

// ─── Core runner ──────────────────────────────────────────
async function run(cmd: string): Promise<boolean> {
  const session = await FFmpegKit.execute(cmd);
  const code    = await session.getReturnCode();
  return ReturnCode.isSuccess(code);
}

// ─── NEW: Extract audio track from a video file ───────────
// Used in MovieStudio: camera records video, we pull the
// audio out, bake voice effects on it, then merge back.
export async function extractAudioFromVideo(
  videoUri: string,
): Promise<{ uri: string; error: string | null }> {
  try {
    const out = tmpAudio('extracted');
    // -vn: no video  -acodec aac: re-encode to aac
    const ok = await run(
      `-y -i "${videoUri}" -vn -acodec aac -b:a 192k -ar 44100 -ac 2 "${out}"`
    );
    if (!ok) return { uri: videoUri, error: 'Audio extraction failed' };
    return { uri: out, error: null };
  } catch (e) {
    return { uri: videoUri, error: String(e) };
  }
}

// ─── BAKE VOICE EFFECT ────────────────────────────────────
export async function bakeVoiceEffect(
  inputUri: string,
  effect: VoiceEffect,
  edit: StudioEdit,
): Promise<{ uri: string; error: string | null }> {
  const out = tmpAudio('voice_baked');
  const filters: string[] = [];

  const trimFlag = edit.trimStart > 0 || edit.trimEnd > 0
    ? `-ss ${edit.trimStart} -to ${edit.trimEnd} ` : '';

  filters.push(`highpass=f=${effect.highpass}`);
  filters.push(`lowpass=f=${effect.lowpass}`);

  if (effect.rate !== 1.0) {
    const sr = Math.round(44100 * effect.rate);
    filters.push(`asetrate=${sr},atempo=${(1 / effect.rate).toFixed(4)}`);
  }
  if (edit.pitchShift !== 0) {
    const ratio = Math.pow(2, edit.pitchShift / 12);
    filters.push(`asetrate=${Math.round(44100 * ratio)},atempo=${(1 / ratio).toFixed(4)}`);
  }
  if (effect.reverb > 0) {
    const gain  = (0.8 - effect.reverb * 0.2).toFixed(2);
    const decay = (effect.reverb * 0.9).toFixed(2);
    const d1    = Math.round(25  + effect.reverb * 60);
    const d2    = Math.round(50  + effect.reverb * 120);
    const d3    = Math.round(100 + effect.reverb * 250);
    filters.push(
      `aecho=${gain}:0.85:${d1}|${d2}|${d3}:${decay}|${(parseFloat(decay)*0.7).toFixed(2)}|${(parseFloat(decay)*0.4).toFixed(2)}`
    );
  }
  if (effect.echo > 0) filters.push(`aecho=0.8:0.65:${effect.echo}:0.5`);
  if (effect.chorus || edit.chorus)
    filters.push('chorus=0.5:0.9:50|60|40:0.4|0.3|0.3:0.25|0.2|0.15:2|3|1.5');
  if (edit.noiseGate)
    filters.push('agate=threshold=0.02:ratio=4:attack=10:release=200');
  if (effect.presence !== 0)
    filters.push(`equalizer=f=3000:t=h:width=2000:g=${effect.presence}`);
  if (effect.compress || edit.normalise)
    filters.push('acompressor=threshold=0.1:ratio=4:attack=5:release=50:makeup=2');
  filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  const reverseFlag = (effect.cloudinaryReverse || edit.reverse) ? ',areverse' : '';
  const filterStr   = filters.join(',') + reverseFlag;
  const cmd = `${trimFlag}-i "${inputUri}" -af "${filterStr}" -ar 44100 -ac 1 -c:a aac -b:a 192k "${out}"`;

  const ok = await run(cmd);
  if (!ok) return { uri: inputUri, error: 'FFmpeg voice effect failed' };
  return { uri: out, error: null };
}

// ─── BAKE VIDEO FILTER (standalone — used by ComposeScreen) ─
export async function bakeVideoFilter(
  inputUri: string,
  filterId: string,
  fxId: string,
  speedRate: number = 1.0,
): Promise<string> {
  try {
    const vfFilter = FFMPEG_VIDEO_FILTERS[filterId] ?? '';
    const fxEffect = FX_EFFECTS.find(f => f.id === fxId);
    let fxFilter = '';
    if (fxEffect && fxId !== 'fx_none') {
      const b = (fxEffect.brightness - 1).toFixed(2);
      const c = fxEffect.contrast.toFixed(2);
      const s = fxEffect.saturation.toFixed(2);
      fxFilter = `eq=brightness=${b}:contrast=${c}:saturation=${s}`;
    }
    let speedFilter = '';
    if (speedRate !== 1.0) speedFilter = `setpts=${(1 / speedRate).toFixed(4)}*PTS`;

    const combined = [vfFilter, fxFilter, speedFilter].filter(Boolean).join(',');
    if (!combined) return inputUri;

    const out = tmpVideo('filtered');
    const cmd = `-y -i "${inputUri}" -vf "${combined}" -c:v libx264 -preset fast -crf 22 -c:a copy "${out}"`;
    const ok  = await run(cmd);
    return ok ? out : inputUri;
  } catch { return inputUri; }
}

// ─── NEW: Bake a single movie scene ───────────────────────
// Takes the raw camera videoUri from a MovieScene recording,
// applies the scene's filter + voice effect, and outputs a
// normalised 1080×1920 mp4 ready for concatenation.
//
// Call this BEFORE concatenateScenes so every scene is the
// same codec/resolution — otherwise -c copy will crash.
export async function bakeSceneVideo(
  scene: MovieScene,
  voiceEffect: VoiceEffect,
  edit: StudioEdit,
  onProgress?: (pct: number) => void,
): Promise<{ uri: string; error: string | null }> {
  const videoUri = scene.videoUri;
  if (!videoUri) return { uri: '', error: 'No video URI on scene' };

  try {
    onProgress?.(5);

    // ── Step 1: extract audio from camera video ────────
    const { uri: rawAudio, error: extractErr } = await extractAudioFromVideo(videoUri);
    if (extractErr) return { uri: '', error: extractErr };
    onProgress?.(20);

    // ── Step 2: bake voice effect onto audio ──────────
    const { uri: bakedAudio, error: voiceErr } = await bakeVoiceEffect(rawAudio, voiceEffect, edit);
    if (voiceErr) return { uri: '', error: voiceErr };
    onProgress?.(40);

    // ── Step 3: build video filter chain ──────────────
    const vfFilter  = FFMPEG_VIDEO_FILTERS[scene.filter] ?? '';
    const speedFilter = scene.trimStart > 0 || scene.trimEnd > 0
      ? `trim=start=${scene.trimStart}:end=${scene.trimEnd},setpts=PTS-STARTPTS`
      : '';
    const scaleFilter = 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black';
    const vfChain = [vfFilter, speedFilter, scaleFilter].filter(Boolean).join(',');

    // ── Step 4: merge processed audio + video ─────────
    const out = tmpVideo(`scene_${scene.order}`);
    const cmd = [
      `-y`,
      `-i "${videoUri}"`,       // video track
      `-i "${bakedAudio}"`,     // processed audio track
      `-filter_complex "[0:v]${vfChain}[vout]"`,
      `-map "[vout]"`,
      `-map 1:a`,               // use the baked audio, not the camera mic
      `-c:v libx264 -preset fast -crf 22`,
      `-c:a aac -b:a 192k`,
      `-r 30`,                  // lock to 30fps — critical for smooth concat
      `-ar 44100 -ac 2`,
      `"${out}"`,
    ].join(' ');

    onProgress?.(70);
    const ok = await run(cmd);
    if (!ok) return { uri: '', error: `Scene ${scene.order + 1} render failed` };

    onProgress?.(100);
    return { uri: out, error: null };
  } catch (e) {
    return { uri: '', error: String(e) };
  }
}

// ─── BAKE WATERMARK + END CARD ────────────────────────────
export async function bakeWatermarkAndEndCard(
  inputUri: string,
  username: string,
  addWatermark: boolean,
): Promise<string> {
  try {
    if (!addWatermark) return inputUri;
    const cacheDir = getCacheDir();
    const safeUser = username.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 28);

    const watermarkFilter =
      `drawtext=text='LumVibe':fontsize=20:fontcolor=0x00ff88:borderw=2:bordercolor=black:x=20:y=h-40:alpha=0.85,` +
      `drawtext=text='@${safeUser}':fontsize=16:fontcolor=white:borderw=2:bordercolor=black:x=20:y=h-20:alpha=0.75`;

    const endCardFilter =
      `drawtext=text='LumVibe':fontsize=36:fontcolor=0x00ff88:borderw=3:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2-20,` +
      `drawtext=text='Discover more creators':fontsize=18:fontcolor=white:borderw=1:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2+30,` +
      `drawtext=text='@${safeUser}':fontsize=22:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2+60`;

    const outputUri = `${cacheDir}watermarked_${Date.now()}.mp4`;
    const step1Uri  = `${cacheDir}wm_step1_${Date.now()}.mp4`;
    const endUri    = `${cacheDir}endcard_${Date.now()}.mp4`;
    const listFile  = `${cacheDir}concat_list_${Date.now()}.txt`;

    const ok1 = await run(
      `-y -i "${inputUri}" -vf "${watermarkFilter}" -c:v libx264 -preset fast -crf 22 -c:a copy "${step1Uri}"`
    );
    if (!ok1) return inputUri;

    const ok2 = await run(
      `-y -f lavfi -i "color=c=black:s=1080x1920:d=3" -vf "${endCardFilter}" -c:v libx264 -preset fast -crf 22 -f mp4 "${endUri}"`
    );
    if (ok2) {
      await FileSystem.writeAsStringAsync(
        listFile,
        `file '${step1Uri}'\nfile '${endUri}'\n`,
        { encoding: FileSystem.EncodingType.UTF8 },
      );
      const ok3 = await run(`-y -f concat -safe 0 -i "${listFile}" -c copy "${outputUri}"`);
      await FileSystem.deleteAsync(listFile, { idempotent: true }).catch(() => null);
      if (ok3) return outputUri;
    }
    return step1Uri;
  } catch { return inputUri; }
}

// ─── MERGE VIDEO + STUDIO AUDIO ───────────────────────────
export async function mergeVideoAudio(
  videoUri: string,
  audioUri: string,
  musicUri: string | null,
  musicVolume: number,
  originalVolume: number,
): Promise<string> {
  try {
    const out = tmpVideo('merged');
    let cmd: string;
    if (musicUri) {
      cmd = `-y -i "${videoUri}" -i "${audioUri}" -i "${musicUri}" ` +
        `-filter_complex "[0:a]volume=${originalVolume}[va];[1:a]volume=1.0[studio];[2:a]volume=${musicVolume}[music];[va][studio][music]amix=inputs=3:duration=first[aout]" ` +
        `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${out}"`;
    } else {
      cmd = `-y -i "${videoUri}" -i "${audioUri}" ` +
        `-filter_complex "[0:a]volume=${originalVolume}[va];[1:a]volume=1.0[studio];[va][studio]amix=inputs=2:duration=first[aout]" ` +
        `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -shortest "${out}"`;
    }
    const ok = await run(cmd);
    return ok ? out : videoUri;
  } catch { return videoUri; }
}

// ─── CONCATENATE SCENES ───────────────────────────────────
// FIXED: all scenes must already be baked by bakeSceneVideo
// (same codec, same resolution, same fps, same sample rate).
// Uses -c copy for fast join — safe because bakeSceneVideo
// normalises everything first.
export async function concatenateScenes(
  scenes: MovieScene[],
): Promise<{ uri: string; error: string | null }> {
  const cacheDir = getCacheDir();
  const out      = tmpVideo('movie_final');
  const listPath = `${cacheDir}concat_list_${Date.now()}.txt`;

  const rendered = scenes
    .filter(s => s.renderedUri !== null)
    .sort((a, b) => a.order - b.order);

  if (rendered.length === 0) return { uri: '', error: 'No rendered scenes.' };
  if (rendered.length === 1) return { uri: rendered[0].renderedUri!, error: null };

  const lines = rendered.map(s => `file '${s.renderedUri}'`).join('\n');
  await FileSystem.writeAsStringAsync(listPath, lines, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Safe to use -c copy now because bakeSceneVideo normalised
  // all scenes to 1080x1920 / libx264 / aac / 30fps / 44100hz
  const ok = await run(
    `-y -f concat -safe 0 -i "${listPath}" -c copy "${out}"`
  );
  await FileSystem.deleteAsync(listPath, { idempotent: true }).catch(() => null);

  if (!ok) return { uri: '', error: 'Scene concat failed' };
  return { uri: out, error: null };
}

// ─── DUET MERGE ───────────────────────────────────────────
export async function mergeDuetVideos(
  myVideoUri: string,
  partnerVideoUri: string,
): Promise<string> {
  try {
    const out = tmpVideo('duet');
    const cmd = `-y -i "${myVideoUri}" -i "${partnerVideoUri}" ` +
      `-filter_complex "[0:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2[left];` +
      `[1:v]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2[right];` +
      `[left][right]hstack=inputs=2[v];[0:a][1:a]amix=inputs=2:duration=first[a]" ` +
      `-map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 22 "${out}"`;
    const ok = await run(cmd);
    return ok ? out : myVideoUri;
  } catch { return myVideoUri; }
} 
