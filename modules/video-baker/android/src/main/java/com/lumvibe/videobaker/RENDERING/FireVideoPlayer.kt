package com.lumvibe.videobaker.RENDERING

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.opengl.Matrix
import android.util.Log
import android.view.Surface
import java.io.File

/**
 * Decodes the fire video onto its own GL_TEXTURE_EXTERNAL_OES texture via
 * MediaPlayer + SurfaceTexture - the exact same mechanism the camera preview
 * itself already uses (see LiveEffectPreviewView/EglCore), just decoding a
 * video file instead of a live camera feed. Used by MOUTH_FIRE and FIRE_BOOK
 * to layer real fire detail on top of their existing procedural/particle
 * flames - see those shaders' own comments in EffectShaders.kt for how the
 * sampling is blended in.
 *
 * SOURCE OF THE VIDEO FILE, REWRITTEN: originally always read from the
 * bundled assets/fire_loop.mp4, which meant shipping the fire footage in
 * every install regardless of whether the person ever opens these two
 * effects - not worth it for an 80+MB asset. Now prefers [cachedFilePath] -
 * a real file already downloaded and cached by the JS side (expo-file-system,
 * FileSystem.cacheDirectory) on first use of either effect - and only falls
 * back to a bundled assets/fire_loop.mp4 if that path is null/missing, which
 * keeps local dev/testing working without needing the download step wired up
 * yet. In production, once the JS-side download+cache is in place, the
 * bundled asset can be removed from assets/ entirely and this always takes
 * the cachedFilePath branch. MediaPlayer doesn't care where a file physically
 * lives once it's on disk - setDataSource(path) is actually simpler than the
 * AssetFileDescriptor path it replaces here.
 *
 * The source video ships on a plain BLACK background (not a real alpha
 * channel, per how it was sourced - see fireBook/mouthFire's shader comments).
 * That's actually convenient here: sampling is gated by the video's own luma
 * in the shader, so black background pixels contribute nothing, getting the
 * same visual result as true alpha with zero extra masking work.
 *
 * LIVE PREVIEW vs BAKED EXPORT: MediaPlayer's SurfaceTexture is driven by real
 * wall-clock playback, which is exactly right for live preview. During baked/
 * exported transcoding (VideoTranscoder, which reuses this same FrameRenderer
 * class - see its own doc comment), frames are processed one at a time and
 * NOT necessarily at 1x real-time speed, so updateTexImage() hands back
 * "whatever frame the wall-clock decoder happens to be on" rather than the
 * frame that precisely matches the output timestamp. For a continuously
 * looping ambient flame texture this is a genuinely low-risk simplification -
 * one frame of a fire loop looks about as good as any neighboring frame -
 * flagging it explicitly rather than silently assuming frame-accurate sync,
 * since that assumption would NOT be safe for anything with real narrative
 * timing.
 *
 * FLAG FOR ON-DEVICE VERIFICATION: this is genuinely new code with no prior
 * working version in this codebase to diff against. Verify: (1) the file
 * actually decodes and updateTexImage() produces new frames each call; (2)
 * looping is seamless - MediaPlayer.isLooping handles restart, but a visible
 * "jump" at the loop point depends on the source clip itself, trim/re-encode
 * it if so; (3) the video's own audio track (if it has one) stays muted -
 * setVolume(0f, 0f) below - so it never bleeds into an actual recording; (4)
 * a corrupted/partial cachedFilePath (interrupted download) fails gracefully
 * here rather than crashing - the try/catch below covers it, but confirm on
 * a real interrupted-download test, not just a normal one.
 */
class FireVideoPlayer(
    context: Context,
    cachedFilePath: String? = null,
    assetFileName: String = "fire_loop.mp4",
) {
    private val tag = "FireVideoPlayer"

    val textureId: Int = GlUtil.createExternalTexture()
    private val surfaceTexture = SurfaceTexture(textureId)
    private val surface = Surface(surfaceTexture)
    private val transformMatrix = FloatArray(16).also { Matrix.setIdentityM(it, 0) }
    private var mediaPlayer: MediaPlayer? = null

    /** True once the decoder has produced at least one real frame. Sample
     * [textureId] only after this is true - before that, its content is
     * undefined GL texture memory, not necessarily black. */
    var hasFrame: Boolean = false
        private set

    init {
        try {
            val cachedFile = cachedFilePath?.let { File(it) }
            val usingCachedFile = cachedFile != null && cachedFile.exists() && cachedFile.length() > 0
            mediaPlayer = MediaPlayer().apply {
                if (usingCachedFile) {
                    setDataSource(cachedFilePath) // simplest overload - just a path on disk
                } else {
                    val afd = context.assets.openFd(assetFileName)
                    setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    afd.close()
                }
                setSurface(surface)
                isLooping = true
                setVolume(0f, 0f) // mute - decorative texture only, never audio
                setOnPreparedListener { it.start() }
                setOnErrorListener { _, what, extra ->
                    val source = if (usingCachedFile) cachedFilePath else "bundled asset $assetFileName"
                    Log.w(tag, "MediaPlayer error for $source: what=$what extra=$extra - " +
                        "MOUTH_FIRE/FIRE_BOOK will run on their procedural flame only")
                    true
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            val source = cachedFilePath ?: "bundled asset $assetFileName"
            Log.w(tag, "Could not open fire video from '$source'. Falling back to " +
                "procedural flame only.", e)
        }
    }

    /** Call once per rendered frame, on the GL thread, before sampling [textureId]. */
    fun updateTexImage() {
        try {
            surfaceTexture.updateTexImage()
            surfaceTexture.getTransformMatrix(transformMatrix)
            hasFrame = true
        } catch (e: Exception) {
            Log.w(tag, "updateTexImage failed", e)
        }
    }

    fun getTransformMatrix(): FloatArray = transformMatrix

    fun release() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (e: Exception) {
            Log.w(tag, "release() cleanup failed (non-fatal)", e)
        }
        mediaPlayer = null
        surface.release()
        surfaceTexture.release()
        GlUtil.deleteTexture(textureId)
    }
}
