package com.lumvibe.videobaker

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.view.Surface
import java.nio.ByteBuffer

/**
* Decodes [inputPath], draws watermark/caption/filter on every frame via OpenGL,
* and encodes a brand-new MP4 at [outputPath]. Audio is copied through untouched
* (no re-encode needed since we're not changing it).
*
* The watermark logo bounces around the frame DVD-screensaver style; the
* caption text (if any) stays in a fixed position at the bottom.
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
        val captionText: String? = null,
        val brightness: Float = 0f,
        val contrast: Float = 1f,
        val saturation: Float = 1f,
        val videoBitRate: Int = -1 // -1 = auto (width*height*4)
    )

    fun transcode(
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
        renderer.brightness = options.brightness
        renderer.contrast = options.contrast
        renderer.saturation = options.saturation

        val captionTextureId = OverlayBuilder.buildCaptionOverlay(width, height, options.captionText)
        val logoTargetWidthPx = width * 0.18f
        val logoTexture = OverlayBuilder.buildLogoTexture(options.watermarkPngPath, logoTargetWidthPx)

        // Bouncing logo state (DVD-screensaver style). Speed scales with frame
        // width so it feels consistent regardless of video resolution.
        var logoPosX = 0f
        var logoPosY = 0f
        val logoVelX = width * 0.09f  // pixels/second
        val logoVelY = width * 0.07f  // pixels/second
        var logoDirX = 1f
        var logoDirY = 1f
        var lastPtsUs = -1L

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

            // 2) Pull decoded frames, draw them (+overlay) into the encoder's input surface.
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
                        renderer.drawVideoFrame(decoderTextureId, texMatrix)

                        if (captionTextureId != null) {
                            renderer.drawOverlay(captionTextureId)
                        }

                        if (logoTexture != null) {
                            val nowUs = bufferInfo.presentationTimeUs
                            val dt = if (lastPtsUs < 0) 0f else (nowUs - lastPtsUs).coerceAtLeast(0).toFloat() / 1_000_000f
                            lastPtsUs = nowUs

                            logoPosX += logoVelX * logoDirX * dt
                            logoPosY += logoVelY * logoDirY * dt

                            if (logoPosX < 0f) { logoPosX = 0f; logoDirX = 1f }
                            if (logoPosX + logoTexture.widthPx > width) { logoPosX = width - logoTexture.widthPx; logoDirX = -1f }
                            if (logoPosY < 0f) { logoPosY = 0f; logoDirY = 1f }
                            if (logoPosY + logoTexture.heightPx > height) { logoPosY = height - logoTexture.heightPx; logoDirY = -1f }

                            // Pixel position (top-left origin, Y-down) → GL clip space (-1..1, Y-up)
                            val clipLeft = (logoPosX / width) * 2f - 1f
                            val clipRight = ((logoPosX + logoTexture.widthPx) / width) * 2f - 1f
                            val clipTop = 1f - (logoPosY / height) * 2f
                            val clipBottom = 1f - ((logoPosY + logoTexture.heightPx) / height) * 2f

                            renderer.drawOverlayAt(logoTexture.textureId, clipLeft, clipBottom, clipRight, clipTop)
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
        eglCore.releaseSurface(windowSurface)
        eglCore.release()
        surfaceTexture.release()
        decoderOutputSurface.release()
        extractor.release()

        onProgress?.invoke(1f)
    }
} 
