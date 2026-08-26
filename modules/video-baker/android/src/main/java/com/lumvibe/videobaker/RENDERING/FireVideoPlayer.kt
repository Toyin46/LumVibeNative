package com.lumvibe.videobaker.RENDERING

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.opengl.Matrix
import android.util.Log
import android.view.Surface

/**
 * Decodes the bundled looping fire video (assets/fire_loop.mp4) onto its own
 * GL_TEXTURE_EXTERNAL_OES texture via MediaPlayer + SurfaceTexture - the exact
 * same mechanism the camera preview itself already uses (see LiveEffectPreview
 * View/EglCore), just decoding a bundled file instead of a live camera feed.
 * Used by MOUTH_FIRE and FIRE_BOOK to layer real fire detail on top of their
 * existing procedural/particle flames - see those shaders' own comments in
 * EffectShaders.kt for how the sampling is blended in.
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
 * working version in this codebase to diff against. Verify: (1) the asset
 * actually decodes and updateTexImage() produces new frames each call: (2)
 * looping is seamless - MediaPlayer.isLooping handles restart, but a visible
 * "jump" at the loop point depends on the source clip itself, trim/re-encode
 * it if so; (3) the video's own audio track (if it has one) stays muted -
 * setVolume(0f, 0f) below - so it never bleeds into an actual recording.
 */
class FireVideoPlayer(context: Context, assetFileName: String = "fire_loop.mp4") {
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
            val afd = context.assets.openFd(assetFileName)
            mediaPlayer = MediaPlayer().apply {
                setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
                setSurface(surface)
                isLooping = true
                setVolume(0f, 0f) // mute - decorative texture only, never audio
                setOnPreparedListener { it.start() }
                setOnErrorListener { _, what, extra ->
                    Log.w(tag, "MediaPlayer error for $assetFileName: what=$what extra=$extra - " +
                        "MOUTH_FIRE/FIRE_BOOK will run on their procedural flame only")
                    true
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            Log.w(tag, "Could not open fire asset '$assetFileName' - was it added to " +
                "android/src/main/assets/? Falling back to procedural flame only.", e)
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
