// LumVibe Audio Studio — the TypeScript side (React Native: Android + iOS).
// One call turns "raw voice + free beat" into a finished, mastered song:
//   noise removal -> autotune -> compression/EQ -> effects -> mix with the beat -> normalise
// All of the audio work happens in the shared C++ engine (audio-core/); this file only
// prepares settings and files. Drop-in next to index.ts; does not modify it.
import { requireNativeModule } from 'expo-modules-core';
import * as FileSystem from 'expo-file-system/legacy';

// ── Parameter indices. MUST match the enum in audio-core/include/lumvibe/audio/lva.h
// (tests/check_param_sync.py verifies this, including the defaults below). ──────────────
export const LVA_PARAM = {
  DENOISE_MODE: 0,
  DENOISE_STRENGTH: 1,
  NOISE_GATE: 2,
  AUTOTUNE: 3,
  SCALE_ROOT: 4,
  SCALE_TYPE: 5,
  TUNE_STRENGTH: 6,
  TUNE_SPEED_MS: 7,
  PITCH_SEMITONES: 8,
  HIGHPASS_HZ: 9,
  LOWPASS_HZ: 10,
  PRESENCE_DB: 11,
  COMPRESS: 12,
  REVERB_MIX: 13,
  ECHO_MIX: 14,
  ECHO_MS: 15,
  CHORUS: 16,
  REVERSE: 17,
  TRIM_START_SEC: 18,
  TRIM_END_SEC: 19,
  VOICE_GAIN: 20,
  BEAT_GAIN: 21,
  VOICE_OFFSET_MS: 22,
  NORMALIZE: 23,
  TAIL_SEC: 24,
  AUTO_BALANCE: 25,
  CANCEL_BLEED: 26,
} as const;
export type LvaParamName = keyof typeof LVA_PARAM;

export const LVA_DEFAULTS: number[] = [
  1, 0.8, 0, 0, -1, 0, 0.85, 35, 0, 80, 20000, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0.85, 0, 1, 1.5, 1, 0,
];

export function buildParams(overrides: Partial<Record<LvaParamName, number>> = {}): number[] {
  const p = LVA_DEFAULTS.slice();
  for (const k of Object.keys(overrides) as LvaParamName[]) {
    const v = overrides[k];
    if (typeof v === 'number' && isFinite(v)) p[LVA_PARAM[k]] = v;
  }
  return p;
}

// ── Mapping from the Audio Studio screen's own types (create.tsx) ───────────────────────
export interface VoiceEffectLike {
  id: string; rate: number; reverb: number; echo: number; chorus: boolean; compress: boolean;
  highpass: number; lowpass: number; presence: number; cloudinaryReverse?: boolean;
}
export interface StudioEditLike {
  trimStart: number; trimEnd: number; reverse: boolean; chorus: boolean;
  delay: number; normalise: boolean; noiseGate: boolean;
}

// These presets change the pitch of the voice. Their `rate` field (0.82 = deeper, 1.35 = higher)
// is converted to semitones: 12 * log2(rate).
const PITCH_EFFECT_IDS = new Set(['deep', 'chipmunk', 'giant', 'helium', 'robot', 'horror', 'whisper']);

export interface BakeOptions {
  effect: VoiceEffectLike;
  studio: StudioEditLike;
  /** the Auto-Tune switch on the Effects tab (the 'autotune' preset also turns it on) */
  autoTune: boolean;
  voiceVolume: number;   // 0..1 sliders from the Mix tab
  beatVolume: number;
  /** remove background noise (fan, breeze, room hiss). Default true — this is the "studio clean" step. */
  cleanVoice?: boolean;
  /**
   * Milliseconds the recorded voice arrives LATE compared with the beat (headphone/Bluetooth output
   * delay + mic delay). Positive moves the voice earlier. Default 0 — see README_AUDIO.md
   * ("Getting the voice exactly on the beat") for how to find the right number for your phone.
   */
  latencyMs?: number;
}

export function paramsFromStudio(o: BakeOptions): number[] {
  const e = o.effect, s = o.studio;
  const isAutotunePreset = e.id === 'autotune';
  const tune = o.autoTune || isAutotunePreset;
  const semitones = PITCH_EFFECT_IDS.has(e.id) && e.rate > 0 ? 12 * Math.log2(e.rate) : 0;
  const echoMix = Math.max(e.echo, s.delay > 0 ? 0.3 : 0);
  return buildParams({
    DENOISE_MODE: o.cleanVoice === false ? 0 : 1,
    DENOISE_STRENGTH: 0.5,          // gentle: heavy noise removal is what makes a voice sound watery/robotic
    NOISE_GATE: s.noiseGate ? 1 : 0,
    AUTOTUNE: tune ? 1 : 0,
    // the 'autotune' preset is the hard "T-Pain / Afrobeats" sound; the switch alone is natural
    TUNE_STRENGTH: isAutotunePreset ? 1 : 0.25,   // the plain Auto-Tune switch is now a light, natural touch (same as the website)
    TUNE_SPEED_MS: isAutotunePreset ? 4 : 120,
    PITCH_SEMITONES: semitones,
    HIGHPASS_HZ: e.highpass,
    LOWPASS_HZ: e.lowpass,
    PRESENCE_DB: e.presence,
    COMPRESS: e.compress ? 1 : 0,
    REVERB_MIX: e.reverb,
    ECHO_MIX: echoMix,
    ECHO_MS: s.delay > 0 ? s.delay : 0,
    CHORUS: e.chorus || s.chorus ? 1 : 0,
    REVERSE: e.cloudinaryReverse || s.reverse ? 1 : 0,
    TRIM_START_SEC: s.trimStart,
    TRIM_END_SEC: s.trimEnd,
    VOICE_GAIN: o.voiceVolume,
    BEAT_GAIN: o.beatVolume,
    VOICE_OFFSET_MS: o.latencyMs ?? 0,
    NORMALIZE: s.normalise ? 1 : 0,
  });
}

// ── Native call ─────────────────────────────────────────────────────────────────────────
type NativeAudioStudio = {
  bakeAudioStudio(voicePath: string, beatPath: string | null, params: number[], outputPath: string):
    Promise<{ uri: string; durationSec: number; elapsedMs: number }>;
  hasNoiseModel(): boolean;
};
let native: NativeAudioStudio | null = null;
function getNative(): NativeAudioStudio {
  if (!native) native = requireNativeModule('LumVibeAudioStudio') as NativeAudioStudio;
  return native;
}

/** true if the better RNNoise denoiser is compiled into this build */
export function hasNoiseModel(): boolean {
  try { return getNative().hasNoiseModel(); } catch { return false; }
}

const stripFile = (u: string) => (u.startsWith('file://') ? decodeURI(u.slice(7)) : u);

function hash(s: string): string {            // tiny stable hash for cache file names
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The Freesound preview beats are https URLs; the native side needs a local file. */
async function ensureLocalFile(uri: string): Promise<string> {
  if (!/^https?:\/\//i.test(uri)) return stripFile(uri);
  const ext = /\.(mp3|m4a|wav|ogg|aac)(\?|$)/i.exec(uri)?.[1]?.toLowerCase() ?? 'mp3';
  const dest = `${FileSystem.cacheDirectory}lva_beat_${hash(uri)}.${ext}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (!info.exists) {
    const r = await FileSystem.downloadAsync(uri, dest);
    if (r.status && r.status >= 400) throw new Error('Could not download the beat (HTTP ' + r.status + ')');
  }
  return stripFile(dest);
}

export interface BakeResult { uri: string; durationSec: number; elapsedMs: number }

/**
 * Mix + master. `voiceUri` is the raw recording, `beatUri` the beat (https or file; optional).
 * Resolves with a finished .m4a (AAC) in the cache folder. Takes a few seconds — show your
 * "Mastering your track…" state while awaiting it.
 */
export async function bakeAudioStudio(args: {
  voiceUri: string;
  beatUri?: string | null;
  params: number[];
}): Promise<BakeResult> {
  const beatPath = args.beatUri ? await ensureLocalFile(args.beatUri) : null;
  const params = args.params.slice();
  while (params.length <= LVA_PARAM.CANCEL_BLEED) params.push(0);
  if (beatPath) params[LVA_PARAM.CANCEL_BLEED] = 1;           // beat + voice: take the beat's leak out of the mic recording first (same as the website)
  const out = `${FileSystem.cacheDirectory}lumvibe_song_${Date.now()}.m4a`;
  return getNative().bakeAudioStudio(stripFile(args.voiceUri), beatPath, params, stripFile(out));
}
