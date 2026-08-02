import { requireNativeModule, EventEmitter } from "expo-modules-core";

export type VisualEffectKey =
  | "vintage_flicker"
  | "neon_edge"
  | "duotone_pulse"
  | "liquid_chrome"
  | "ink_wash";

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

export function onBakeProgress(callback: (progress: number) => void) {
  return emitter.addListener("onProgress", (event: { progress: number }) => {
    callback(event.progress);
  });
} 
