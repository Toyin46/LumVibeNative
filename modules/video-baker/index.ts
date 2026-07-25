import { requireNativeModule, EventEmitter } from "expo-modules-core";

type VideoBakerOptions = {
  watermarkPngPath?: string; // absolute file path, e.g. from expo-asset / a bundled PNG copied to cache
  captionText?: string;
  brightness?: number; // -1..1, default 0
  contrast?: number; // 0..2, default 1
  saturation?: number; // 0..2, default 1
};

const NativeVideoBaker = requireNativeModule("VideoBaker");
const emitter = new EventEmitter(NativeVideoBaker);

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
