package com.lumvibe.videobaker

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.GLES20
import android.view.Surface
import java.nio.ByteBuffer

/**
* Decodes [inputPath], draws watermark/caption/filter on every frame via OpenGL,
* and encodes a brand-new MP4 at [outputPath]. Audio is copied through untouched
* (no re-encode needed since we're not changing it).
*
* This class only uses android.media.* and android.opengl.* — no FFmpeg, no
* third-party binary, no network call, no cost.
*/
class VideoTranscoder {

    private class FrameWaiter {
        private val lock = Object()
        private var frameAvailable = false

        fun listener(): SurfaceTexture.OnFrameAvailableListener =
            SurfaceTexture.OnFrameAvailableListener {
                synchronized(lock) {
                    frameAvailable = true
                    lock.notifyAll()
                }
            }

        fun await() {
            synchronized(lock) {
                var waits = 0
                while (!frameAvailable) {
                    lock.wait(500)
                    waits++
                    if (waits > 20) throw RuntimeException("Timed out waiting for decoder frame")
                }
                frameAvailable = false
            }
        }
    }

    data class Options(
        val watermarkPngPath: String? = null,
        val watermarkUsername: String? = null,         // if set (with watermarkPngPath), bakes the branded
                                                        // "logo + LumVibe + @username" card instead of a plain logo
        val watermarkBounce: Boolean = true,          // false = static bottom-right, like before
        val watermarkWidthFraction: Float = 0.18f,     // plain-logo width as a fraction of video width (no username)
        val watermarkCardWidthFraction: Float = 0.42f, // branded-card width as a fraction of video width
        val watermarkSpeedXPxPerSec: Float = 90f,
        val watermarkSpeedYPxPerSec: Float = 65f,
        val captionText: String? = null,
        val brightness: Float = 0f,
        val contrast: Float = 1f,
        val saturation: Float = 1f,
        // "vintage_flicker" | "neon_edge" | "duotone_pulse" | "liquid_chrome" | "ink_wash" | null
        val effect: String? = null,
        val effectIntensity: Float = 1f, // 0..1
        val videoBitRate: Int = -1 // -1 = auto (width*height*4)
    )

    fun transcode(
        context: Context,
        inputPath: String,
        outputPath: String,
        options: Options,
        onProgress: ((Float) -> Unit)? = null
    ) {
        val extractor = MediaExtractor()
        extractor.setDataSource(inputPath)

        var videoTrackIndex = -1
        var audioTrackIndex = -1
        for (i in 0 until extractor.trackCount) {
            val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("video/") && videoTrackIndex < 0) videoTrackIndex = i
            if (mime.startsWith("audio/") && audioTrackIndex < 0) audioTrackIndex = i
        }
        require(videoTrackIndex >= 0) { "No video track found in $inputPath" }

        val videoFormat = extractor.getTrackFormat(videoTrackIndex)
        val width = videoFormat.getInteger(MediaFormat.KEY_WIDTH)
        val height = videoFormat.getInteger(MediaFormat.KEY_HEIGHT)
        val durationUs = if (videoFormat.containsKey(MediaFormat.KEY_DURATION))
            videoFormat.getLong(MediaFormat.KEY_DURATION) else 0L
        val decoderMime = videoFormat.getString(MediaFormat.KEY_MIME)!!

        // ---- Encoder setup ----
        val encoder = MediaCodec.createEncoderByType("video/avc")
        val encFormat = MediaFormat.createVideoFormat("video/avc", width, height)
        encFormat.setInteger(
            MediaFormat.KEY_COLOR_FORMAT,
            MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
        )
        val bitRate = if (options.videoBitRate > 0) options.videoBitRate else width * height * 4
        encFormat.setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
        encFormat.setInteger(MediaFormat.KEY_FRAME_RATE, 30)
        encFormat.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val encoderInputSurface: Surface = encoder.createInputSurface()
        encoder.start()

        // ---- GL / EGL setup, targeting the encoder's input surface ----
        val eglCore = EglCore()
        val windowSurface = eglCore.createWindowSurface(encoderInputSurface)
        eglCore.makeCurrent(windowSurface)

        val renderer = FrameRenderer()
        renderer.setup()
        renderer.setFrameSize(width, height)
        renderer.brightness = options.brightness
        renderer.contrast = options.contrast
        renderer.saturation = options.saturation
        renderer.effectIntensity = options.effectIntensity
        renderer.setEffect(VisualEffect.fromKey(options.effect))

        val captionTextureId = OverlayBuilder.buildCaptionTexture(width, height, options.captionText)
        val logoTexture = if (options.watermarkPngPath != null && options.watermarkUsername != null) {
            OverlayBuilder.buildWatermarkCard(
                options.watermarkPngPath, options.watermarkUsername, width * options.watermarkCardWidthFraction
            )
        } else {
            OverlayBuilder.buildWatermarkLogo(
                options.watermarkPngPath, width * options.watermarkWidthFraction
            )
        }
        // Fixed fallback position (bottom-right, same spot as the old static watermark)
        // used when watermarkBounce is false.
        val staticMarginPx = 24f
        val staticLeft = logoTexture?.let { width - it.widthPx - staticMarginPx } ?: 0f
        val staticTop = logoTexture?.let { height - it.heightPx - staticMarginPx } ?: 0f

        val decoderTextureId = GlUtil.createExternalTexture()
        val surfaceTexture = SurfaceTexture(decoderTextureId)
        surfaceTexture.setDefaultBufferSize(width, height)
        val frameWaiter = FrameWaiter()
        surfaceTexture.setOnFrameAvailableListener(frameWaiter.listener())
        val decoderOutputSurface = Surface(surfaceTexture)

        // ---- Decoder setup ----
        val decoder = MediaCodec.createDecoderByType(decoderMime)
        decoder.configure(videoFormat, decoderOutputSurface, null, 0)
        decoder.start()
        extractor.selectTrack(videoTrackIndex)

        // ---- Muxer setup (tracks added lazily once formats are known) ----
        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxerVideoTrack = -1
        var muxerAudioTrack = -1
        var muxerStarted = false
        val audioFormat = if (audioTrackIndex >= 0) extractor.getTrackFormat(audioTrackIndex) else null

        fun maybeStartMuxer() {
            if (muxerStarted) return
            if (muxerVideoTrack < 0) return
            if (audioFormat != null && muxerAudioTrack < 0) {
                muxerAudioTrack = muxer.addTrack(audioFormat)
            }
            muxer.start()
            muxerStarted = true
        }

        val bufferInfo = MediaCodec.BufferInfo()
        val timeoutUs = 10_000L
        var inputDone = false
        var decoderDone = false
        var encoderDone = false
        val texMatrix = FloatArray(16)
        val hasEffect = VisualEffect.fromKey(options.effect) != VisualEffect.NONE

        // Phase 2 — only pay the MediaPipe init/model-load cost when actually needed.
        val faceTracker: FaceTracker? =
            if (VisualEffect.fromKey(options.effect) == VisualEffect.MOOD_RING) FaceTracker(context) else null

        while (!encoderDone) {
            // 1) Feed the decoder from the extractor.
            if (!inputDone) {
                val inIndex = decoder.dequeueInputBuffer(timeoutUs)
                if (inIndex >= 0) {
                    val inputBuffer: ByteBuffer = decoder.getInputBuffer(inIndex)!!
                    val sampleSize = extractor.readSampleData(inputBuffer, 0)
                    if (sampleSize < 0) {
                        decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        val presentationTime = extractor.sampleTime
                        decoder.queueInputBuffer(inIndex, 0, sampleSize, presentationTime, 0)
                        extractor.advance()
                    }
                }
            }

            // 2) Pull decoded frames, draw them (+overlays) into the encoder's input surface.
            if (!decoderDone) {
                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, timeoutUs)
                if (outIndex >= 0) {
                    val doRender = bufferInfo.size > 0
                    decoder.releaseOutputBuffer(outIndex, doRender)
                    if (doRender) {
                        frameWaiter.await()
                        surfaceTexture.updateTexImage()
                        surfaceTexture.getTransformMatrix(texMatrix)

                        eglCore.makeCurrent(windowSurface)

                        // Presentation time, not wall-clock — keeps every time-based thing
                        // (shader effects AND the watermark bounce) locked to the video's
                        // own timeline, reproducible regardless of how fast this loop runs.
                        val elapsedSec = bufferInfo.presentationTimeUs / 1_000_000f

                        if (hasEffect) {
                            if (renderer.currentEffect == VisualEffect.MOOD_RING && faceTracker != null) {
                                // Face tracking needs a plain-rendered Bitmap of THIS frame
                                // first — draw plain, read back, detect, THEN redraw with
                                // the hue-shift shader using the score just found. This
                                // means mood_ring renders each frame twice — a real,
                                // known extra cost versus the Phase 1 shader-only effects,
                                // which never leave the GPU.
                                renderer.drawVideoFrame(decoderTextureId, texMatrix)
                                val frameBitmap = GlUtil.readPixelsAsBitmap(width, height)
                                val timestampMs = bufferInfo.presentationTimeUs / 1000
                                val result = faceTracker.detect(frameBitmap, timestampMs)
                                val smileScore = if (result != null) {
                                    maxOf(
                                        faceTracker.blendshapeScore(result, "mouthSmileLeft"),
                                        faceTracker.blendshapeScore(result, "mouthSmileRight")
                                    )
                                } else 0f
                                frameBitmap.recycle()

                                // Repurposes effectIntensity to carry the live smile score
                                // (0..1) instead of a static user-set strength for this
                                // effect specifically — options.effectIntensity is not
                                // used for mood_ring as a result, by design.
                                renderer.effectIntensity = smileScore
                                renderer.drawEffectFrame(decoderTextureId, texMatrix, elapsedSec)
                            } else {
                                renderer.drawEffectFrame(decoderTextureId, texMatrix, elapsedSec)
                            }
                        } else {
                            renderer.drawVideoFrame(decoderTextureId, texMatrix)
                        }

                        if (captionTextureId != null) {
                            renderer.drawOverlay(captionTextureId)
                        }

                        if (logoTexture != null) {
                            val (left, top) = if (options.watermarkBounce) {
                                WatermarkBounce.position(
                                    elapsedSec = elapsedSec,
                                    canvasWidth = width,
                                    canvasHeight = height,
                                    logoWidthPx = logoTexture.widthPx,
                                    logoHeightPx = logoTexture.heightPx,
                                    speedXPxPerSec = options.watermarkSpeedXPxPerSec,
                                    speedYPxPerSec = options.watermarkSpeedYPxPerSec
                                )
                            } else {
                                staticLeft to staticTop
                            }
                            renderer.drawWatermarkAt(
                                logoTexture.textureId, left, top,
                                logoTexture.widthPx, logoTexture.heightPx,
                                width, height
                            )
                        }

                        eglCore.setPresentationTime(windowSurface, bufferInfo.presentationTimeUs * 1000)
                        eglCore.swapBuffers(windowSurface)
                    }
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        decoderDone = true
                        encoder.signalEndOfInputStream()
                    }
                }
            }

            // 3) Drain the encoder and write to the muxer.
            val encOutIndex = encoder.dequeueOutputBuffer(bufferInfo, timeoutUs)
            when {
                encOutIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    muxerVideoTrack = muxer.addTrack(encoder.outputFormat)
                    maybeStartMuxer()
                }
                encOutIndex >= 0 -> {
                    val encodedData = encoder.getOutputBuffer(encOutIndex)!!
                    if (bufferInfo.size > 0 && muxerStarted) {
                        encodedData.position(bufferInfo.offset)
                        encodedData.limit(bufferInfo.offset + bufferInfo.size)
                        muxer.writeSampleData(muxerVideoTrack, encodedData, bufferInfo)
                        onProgress?.invoke(
                            if (durationUs > 0) (bufferInfo.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f) else 0f
                        )
                    }
                    encoder.releaseOutputBuffer(encOutIndex, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        encoderDone = true
                    }
                }
            }
        }

        // ---- Copy audio track through untouched ----
        if (audioTrackIndex >= 0 && muxerAudioTrack >= 0) {
            val audioExtractor = MediaExtractor()
            audioExtractor.setDataSource(inputPath)
            audioExtractor.selectTrack(audioTrackIndex)
            val audioBuffer = ByteBuffer.allocate(1 shl 20) // 1MB scratch buffer
            val audioBufferInfo = MediaCodec.BufferInfo()
            while (true) {
                val size = audioExtractor.readSampleData(audioBuffer, 0)
                if (size < 0) break
                audioBufferInfo.offset = 0
                audioBufferInfo.size = size
                audioBufferInfo.presentationTimeUs = audioExtractor.sampleTime
                audioBufferInfo.flags = audioExtractor.sampleFlags
                muxer.writeSampleData(muxerAudioTrack, audioBuffer, audioBufferInfo)
                audioExtractor.advance()
            }
            audioExtractor.release()
        }

        // ---- GL texture cleanup (caption + watermark) — do this while the EGL
        // context is still current, before eglCore.release() tears it down. ----
        val texturesToDelete = mutableListOf<Int>()
        captionTextureId?.let { texturesToDelete.add(it) }
        logoTexture?.let { texturesToDelete.add(it.textureId) }
        if (texturesToDelete.isNotEmpty()) {
            GLES20.glDeleteTextures(texturesToDelete.size, texturesToDelete.toIntArray(), 0)
        }

        // ---- Cleanup ----
        try {
            muxer.stop()
        } catch (e: Exception) {
            // If zero frames were ever written this can throw; surface a clear error.
            throw RuntimeException("Muxer stop failed — was any frame actually written?", e)
        }
        muxer.release()
        decoder.stop(); decoder.release()
        encoder.stop(); encoder.release()
        renderer.release()
        faceTracker?.close()
        eglCore.releaseSurface(windowSurface)
        eglCore.release()
        surfaceTexture.release()
        decoderOutputSurface.release()
        extractor.release()

        onProgress?.invoke(1f)
    }
} 
