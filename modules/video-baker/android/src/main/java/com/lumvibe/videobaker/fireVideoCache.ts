import * as FileSystem from 'expo-file-system/legacy';

// Host this wherever your fire_loop.mp4 (already compressed via
// compress-fire-video.js) ends up - Cloudinary, since that's already part of
// your stack for media, is the natural fit here. No new infrastructure.
//
// ✅ OPTIMIZED (was pointing at the raw 83.38MB 1920x1080 upload): this now
// requests a Cloudinary on-the-fly transformation of the SAME asset
// (public ID stays "fire_loop" - nothing was re-uploaded or renamed) instead
// of the original file. Cloudinary encodes and caches this derived version
// on its CDN the first time it's requested, so the device downloads only
// the small transformed file, never the 83MB source:
//   w_480      - scale to 480px wide (this is a small on-screen face-effect
//                texture, not the user's actual footage - 1080p was never
//                needed for it)
//   c_scale    - single-dimension scale, preserves aspect ratio
//   vc_h264    - force H.264 specifically (not VP9/AV1/auto), since that's
//                what FireVideoPlayer.kt's MediaCodec/OpenGL-texture pipeline
//                is built against - this is the one setting NOT to touch
//                without re-testing that pipeline
//   q_auto     - Cloudinary's automatic quality/compression optimization
//   br_500k    - 500kbps bitrate ceiling, in the 400-600kbps range that gets
//                a several-second loop into the ~1-2MB target
// Still a single authoritative URL/config, same as before - just a
// transformed delivery of "fire_loop" rather than the raw upload of it.
const FIRE_VIDEO_URL = 'https://res.cloudinary.com/dvllxm0wg/video/upload/w_480,c_scale,vc_h264,q_auto,br_500k/fire_loop.mp4';
const FIRE_VIDEO_CACHE_PATH = `${FileSystem.cacheDirectory}fire_loop.mp4`;

// A real, compressed fire loop (a few seconds, ~480px wide) should land
// somewhere in the low single-digit MB after the ffmpeg pass. This is a
// sanity floor, not an exact size check - it exists purely to catch a
// zero-byte or truncated file from an interrupted download, not to validate
// the file is precisely the right size.
const MIN_VALID_SIZE_BYTES = 200_000; // ~0.2MB - well below any real encode, well above "empty/corrupt"

/**
 * Returns a local file path to the fire video, downloading and caching it on
 * first call if it isn't already there. Every call after the first (this
 * session or a future one, until the OS clears the cache) returns instantly
 * from the existing cached file - no repeat download, no repeat data cost,
 * matching "should work perfectly without data" after the first open.
 *
 * Returns null on failure (no internet, download error, etc.) rather than
 * throwing - callers should treat null as "fall back to the procedural flame
 * only" (FireVideoPlayer.kt already does this gracefully on the native side
 * if no path is provided), not as a crash.
 */
export async function ensureFireVideoCached(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(FIRE_VIDEO_CACHE_PATH);
    if (info.exists && info.size >= MIN_VALID_SIZE_BYTES) {
      return FIRE_VIDEO_CACHE_PATH; // already cached from a previous run - zero data cost
    }
    if (info.exists) {
      // Exists but suspiciously small - almost certainly a partial file from
      // an interrupted download last time. Delete it and re-download rather
      // than handing a corrupt file to the native decoder.
      await FileSystem.deleteAsync(FIRE_VIDEO_CACHE_PATH, { idempotent: true });
    }

    const result = await FileSystem.downloadAsync(FIRE_VIDEO_URL, FIRE_VIDEO_CACHE_PATH);
    if (result.status !== 200) {
      await FileSystem.deleteAsync(FIRE_VIDEO_CACHE_PATH, { idempotent: true });
      return null;
    }

    // Verify what actually landed on disk, not just that the HTTP status was
    // 200 - a connection drop mid-download can still report success with a
    // truncated file.
    const verify = await FileSystem.getInfoAsync(FIRE_VIDEO_CACHE_PATH);
    if (!verify.exists || verify.size < MIN_VALID_SIZE_BYTES) {
      await FileSystem.deleteAsync(FIRE_VIDEO_CACHE_PATH, { idempotent: true });
      return null;
    }

    return FIRE_VIDEO_CACHE_PATH;
  } catch (err) {
    console.warn('Fire video download failed, falling back to procedural flame only:', err);
    return null;
  }
}
