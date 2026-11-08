package com.lumvibe.videobaker

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.opengl.GLES20
import android.util.Log
import android.view.Surface

/**
 * A SECOND video drawn on top of the main one (picture-in-picture), frame-accurate.
 *
 * Unlike FireVideoPlayer (which follows the wall clock and is fine for a decorative effect), this decodes the
 * second video in LOCK-STEP with the export: for every frame the baker writes, [prepareFrame] advances this decoder
 * to the frame that belongs at that exact moment, so the two videos stay perfectly in sync in the final file.
 *
 *  - Shorter than the main video  -> it loops.
 *  - Longer than the main video   -> it is cut at the end of the main video.
 *  - Its own sound is not used (the main video's sound is kept, as before).
 *
 * Must be created while the baker's GL context is current (it needs a GL texture).
 * The rectangle is given as fractions of the output frame, origin top-left.
 */
class PipVideoDecoder(
    path: String,
    private val xFrac: Float,
    private val yFrac: Float,
    private val wFrac: Float,
    private val hFrac: Float,
    private val borderFrac: Float = 0.006f
) {
    private val extractor = MediaExtractor()
    private val decoder: MediaCodec
    private val surfaceTexture: SurfaceTexture
    private val outputSurface: Surface
    private val textureId: Int
    private val texMatrix = FloatArray(16)
    private val info = MediaCodec.BufferInfo()
    private val durationUs: Long

    private val lock = Object()
    private var frameAvailable = false

    private var inputDone = false
    private var outputDone = false
    private var pendingIndex = -1          // a decoded frame we are holding, not shown yet
    private var pendingPtsUs = 0L
    private var haveFrame = false          // a frame is already in the texture
    private var lastTargetUs = -1L
    private var released = false

    init {
        extractor.setDataSource(path)
        var track = -1
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("video/")) { track = i; break }
        }
        require(track >= 0) { "The video placed on top has no video track" }
        val format = extractor.getTrackFormat(track)
        durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L

        textureId = GlUtil.createExternalTexture()
        surfaceTexture = SurfaceTexture(textureId)
        surfaceTexture.setOnFrameAvailableListener {
            synchronized(lock) {
                frameAvailable = true
                lock.notifyAll()
            }
        }
        outputSurface = Surface(surfaceTexture)

        decoder = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        decoder.configure(format, outputSurface, null, 0)
        decoder.start()
        extractor.selectTrack(track)
    }

    /** Feeds the decoder a few compressed samples (does nothing once the file has been read to the end). */
    private fun feedInput() {
        if (inputDone) return
        var guard = 0
        while (guard++ < 8) {
            val inIndex = decoder.dequeueInputBuffer(0)
            if (inIndex < 0) return
            val buf = decoder.getInputBuffer(inIndex) ?: return
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) {
                decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                inputDone = true
                return
            }
            decoder.queueInputBuffer(inIndex, 0, size, extractor.sampleTime, 0)
            extractor.advance()
        }
    }

    /** Takes the next decoded frame (held in [pendingIndex], not shown yet). Returns false when there are no more. */
    private fun nextOutput(): Boolean {
        var spins = 0
        while (spins++ < 400) {
            feedInput()
            val idx = decoder.dequeueOutputBuffer(info, 5_000L)
            if (idx >= 0) {
                val eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
                if (eos) outputDone = true
                if (info.size > 0 || !eos) {
                    pendingIndex = idx
                    pendingPtsUs = info.presentationTimeUs
                    return true
                }
                decoder.releaseOutputBuffer(idx, false)
                return false
            }
            // INFO_TRY_AGAIN_LATER, format changed, buffers changed: keep feeding and try again
        }
        outputDone = true   // gave up waiting: stop trying, so an export can never hang here
        return false
    }

    private fun awaitFrame() {
        synchronized(lock) {
            var waits = 0
            while (!frameAvailable) {
                lock.wait(500)
                waits++
                if (waits > 20) throw RuntimeException("Timed out waiting for the video placed on top")
            }
            frameAvailable = false
        }
    }

    /** Puts the held frame into the texture. */
    private fun showPending() {
        decoder.releaseOutputBuffer(pendingIndex, true)
        pendingIndex = -1
        awaitFrame()
        surfaceTexture.updateTexImage()
        surfaceTexture.getTransformMatrix(texMatrix)
        haveFrame = true
    }

    private fun restart() {
        if (pendingIndex >= 0) {
            decoder.releaseOutputBuffer(pendingIndex, false)
            pendingIndex = -1
        }
        extractor.seekTo(0L, MediaExtractor.SEEK_TO_CLOSEST_SYNC)
        decoder.flush()
        inputDone = false
        outputDone = false
    }

    /** Moves this video to the frame that belongs at [mainTimeUs] (time since the first exported frame). */
    fun prepareFrame(mainTimeUs: Long) {
        if (released) return
        val target = if (durationUs > 0L) mainTimeUs % durationUs else mainTimeUs
        // The main video is longer and we have wrapped around: play the small video again from the start.
        if (lastTargetUs >= 0L && target < lastTargetUs - 200_000L) restart()
        lastTargetUs = target

        var guard = 0
        while (guard++ < 600) {
            if (pendingIndex < 0) {
                if (outputDone) break
                if (!nextOutput()) break
            }
            if (pendingPtsUs <= target) showPending() else break
        }
        // Make sure something is on screen from the very first frame, even if this video starts slightly later.
        if (!haveFrame && pendingIndex >= 0) showPending()
    }

    /** Draws the current frame into its rectangle (with a thin white border). The GL state is restored afterwards. */
    fun drawOnto(renderer: FrameRenderer, outW: Int, outH: Int) {
        if (released || !haveFrame) return
        val w = (wFrac * outW).toInt().coerceIn(2, outW)
        val h = (hFrac * outH).toInt().coerceIn(2, outH)
        val x = (xFrac * outW).toInt().coerceIn(0, outW - w)
        val yTop = (yFrac * outH).toInt().coerceIn(0, outH - h)
        val y = outH - yTop - h                       // OpenGL counts from the bottom-left corner
        val b = (borderFrac * outW).toInt().coerceAtLeast(0)

        val viewport = IntArray(4)
        GLES20.glGetIntegerv(GLES20.GL_VIEWPORT, viewport, 0)
        if (b > 0) {
            val clear = FloatArray(4)
            GLES20.glGetFloatv(GLES20.GL_COLOR_CLEAR_VALUE, clear, 0)
            GLES20.glEnable(GLES20.GL_SCISSOR_TEST)
            GLES20.glScissor(x - b, y - b, w + 2 * b, h + 2 * b)
            GLES20.glClearColor(1f, 1f, 1f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glDisable(GLES20.GL_SCISSOR_TEST)
            GLES20.glClearColor(clear[0], clear[1], clear[2], clear[3])
        }
        GLES20.glViewport(x, y, w, h)
        renderer.drawVideoFrame(textureId, texMatrix)
        GLES20.glViewport(viewport[0], viewport[1], viewport[2], viewport[3])
    }

    fun release() {
        if (released) return
        released = true
        try { if (pendingIndex >= 0) decoder.releaseOutputBuffer(pendingIndex, false) } catch (e: Exception) { Log.w("PipVideoDecoder", "release: $e") }
        try { decoder.stop() } catch (e: Exception) { Log.w("PipVideoDecoder", "stop: $e") }
        try { decoder.release() } catch (e: Exception) { Log.w("PipVideoDecoder", "decoder.release: $e") }
        try { outputSurface.release() } catch (e: Exception) { /* ignore */ }
        try { surfaceTexture.release() } catch (e: Exception) { /* ignore */ }
        try { extractor.release() } catch (e: Exception) { /* ignore */ }
        try { GLES20.glDeleteTextures(1, intArrayOf(textureId), 0) } catch (e: Exception) { /* ignore */ }
    }
}
