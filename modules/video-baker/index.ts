import { requireNativeModule, EventEmitter } from "expo-modules-core";

// FIXED (this pass): this type had drifted to only 5 of 61 real effect
// keys — the native side (and a stray duplicate of this file that ended
// up inside android/src/main/java/.../index.ts, which Gradle never even
// compiles since that's a Kotlin source root) had moved on without this,
// the file TypeScript actually resolves, catching up. Generated directly
// from effects-src/assets/effects.manifest.json — the compiled output of
// effects-src/registry.ts, which is now the single source of truth for
// this list. Regenerate this block any time you add a new effect there,
// rather than hand-editing it out of sync again.
export type VisualEffectKey =
  | "aura_glow"
  | "beat_reactor"
  | "beat_shake"
  | "big_head"
  | "blink_freeze"
  | "bokeh_lights"
  | "cinematic_glow"
  | "clap_burst"
  | "color_drain"
  | "demon_eyes"
  | "depth_bloom"
  | "double_take"
  | "drop_transform"
  | "duotone_pulse"
  | "eye_laser"
  | "face_explosion"
  | "face_morph"
  | "finger_draw"
  | "fire_book"
  | "fist_bump_boom"
  | "flash_camera"
  | "freeze_touch"
  | "gaze_trail"
  | "glitch_wave"
  | "gold_skin"
  | "golden_hour"
  | "hand_portal"
  | "head_tilt_zoom"
  | "ink_wash"
  | "light_leak"
  | "lightning_hands"
  | "liquid_chrome"
  | "mood_ring"
  | "mouth_fire"
  | "mouth_words"
  | "neon_edge"
  | "paint_splash"
  | "palm_magic"
  | "particle_flow"
  | "rain_fall"
  | "raise_eyebrow"
  | "retro_vhs"
  | "rich_camera"
  | "rock_paper_scissors"
  | "silence_ripple"
  | "skin_smooth"
  | "smile_shatter"
  | "snow_fall"
  | "space_background"
  | "spin_effect"
  | "split_prism"
  | "stickers_react"
  | "superpower"
  | "tap_shockwave"
  | "thermal_pulse"
  | "throw_confetti"
  | "tiny_body"
  | "two_hand_frame"
  | "vintage_flicker"
  | "voice_halo"
  | "wink_spark";

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
  // Carried over from the more complete duplicate found inside
  // android/src/main/java/.../index.ts this pass — real fields your
  // native side already expects, just missing from the file that's
  // actually imported until now.
  portalScenePngPath?: string; // only used when effect is "hand_portal"
  fireVideoPath?: string | null; // only used when effect is "mouth_fire" or "fire_book" — omit/null falls back to procedural flame only
};

// Image baking's options — same vocabulary as VideoBakerOptions minus the
// video-only bounce/speed fields, which don't mean anything for a single
// frame. Matches ImageBaker.Options.kt field-for-field.
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
  portalScenePngPath?: string;
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
