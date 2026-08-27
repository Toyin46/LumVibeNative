//modules/video-baker/index.ts
import { requireNativeModule, EventEmitter } from "expo-modules-core";

// FIX: this was missing 19 of your 24 real effect keys (mood_ring, wink_spark,
// gold_skin, mouth_fire, etc. weren't here) — checked directly against
// EffectShaders.kt's VisualEffect.fromKey, which is the authoritative list, not
// guessed. Every options.effect value used anywhere in create.tsx should now
// actually type-check against what the native side really accepts.
export type VisualEffectKey =
  | "vintage_flicker"
  | "neon_edge"
  | "duotone_pulse"
  | "liquid_chrome"
  | "ink_wash"
  | "mood_ring"
  | "wink_spark"
  | "smile_shatter"
  | "head_tilt_zoom"
  | "aura_glow"
  | "color_drain"
  | "silence_ripple"
  | "voice_halo"
  | "thermal_pulse"
  | "depth_bloom"
  | "split_prism"
  | "hand_portal"
  | "fist_bump_boom"
  | "two_hand_frame"
  | "gaze_trail"
  | "double_take"
  | "blink_freeze"
  | "gold_skin"
  | "mouth_fire";

type VideoBakerOptions = {
  watermarkPngPath?: string; // absolute file path, e.g. from expo-asset / a bundled PNG copied to cache
  watermarkUsername?: string; // if set (with watermarkPngPath), bakes the branded "logo + LumVibe + @username" card
  watermarkBounce?: boolean; // default true — false = static bottom-right, like before
  watermarkWidthFraction?: number; // plain-logo width as a fraction of video width, default 0.18 (no username)
  watermarkCardWidthFraction?: number; // branded-card width as a fraction of video width, default 0.42
  watermarkSpeedXPxPerSec?: number; // default 90
  watermarkSpeedYPxPerSec?: number; // default 65 — different from X on purpose, see WatermarkBounce.kt
  captionText?: string;
  brightness?: number; // -1..1, default 0
  contrast?: number; // 0..2, default 1
  saturation?: number; // 0..2, default 1
  effect?: VisualEffectKey; // omit for no effect
  effectIntensity?: number; // 0..1, default 1
  // Downloaded/cached fire_loop.mp4 path from ensureFireVideoCached() —
  // only read when effect is "mouth_fire" or "fire_book". Omit/null falls
  // back to procedural flame only.
  fireVideoPath?: string | null;
};

// Image baking's options — same vocabulary as VideoBakerOptions minus the
// video-only bounce/speed fields, which don't mean anything for a single
// frame. Matches ImageBaker.Options.kt field-for-field — checked directly
// against that file, not assumed from the video options shape.
type ImageBakerOptions = {
  watermarkPngPath?: string;
  watermarkUsername?: string;
  watermarkWidthFraction?: number; // default 0.18
  watermarkCardWidthFraction?: number; // default 0.42
  captionText?: string;
  brightness?: number; // -1..1, default 0
  contrast?: number; // 0..2, default 1
  saturation?: number; // 0..2, default 1
  effect?: VisualEffectKey;
  effectIntensity?: number; // 0..1, default 1
  portalScenePngPath?: string; // only used when effect is "hand_portal"
  // Same meaning as VideoBakerOptions.fireVideoPath — only relevant for
  // "mouth_fire" (the only fire effect a still photo can realistically use).
  fireVideoPath?: string | null;
};

// Tells EventEmitter which events exist and what shape each payload is.
// Without this, TypeScript falls back to a default where the event-name
// parameter is typed as `never` — which is exactly the ts(2345) error this fixes.
type VideoBakerEvents = {
  onProgress: (event: { progress: number }) => void;
};

const NativeVideoBaker = requireNativeModule("VideoBaker");
const emitter = new EventEmitter<VideoBakerEvents>(NativeVideoBaker);

/**
* Decodes inputPath, draws watermark/caption/filter on every frame, and writes
* a brand-new MP4 to outputPath. Strip any "file://" prefix from both paths
* before calling this (expo-file-system paths already look like plain paths).
*
* Returns the outputPath once the file is fully written and safe to upload.
*/
export async function bakeVideo(
  inputPath: string,
  outputPath: string,
  options: VideoBakerOptions = {}
): Promise<string> {
  return NativeVideoBaker.bakeVideo(inputPath, outputPath, options);
}

/**
* Same idea as bakeVideo, for a single still image — loads inputPath, runs
* face/hand/segmentation tracking ONCE, bakes the same effect/watermark/caption
* pipeline into the pixels, writes a JPEG to outputPath. No onProgress events
* for this one — a single frame doesn't have a meaningful multi-step progress
* the way a full video transcode does.
*
* Strip any "file://" prefix from both paths before calling this, same as bakeVideo.
*/
export async function bakeImage(
  inputPath: string,
  outputPath: string,
  options: ImageBakerOptions = {}
): Promise<string> {
  return NativeVideoBaker.bakeImage(inputPath, outputPath, options);
}

export function onBakeProgress(callback: (progress: number) => void) {
  return emitter.addListener("onProgress", (event: { progress: number }) => {
    callback(event.progress);
  });
} 
