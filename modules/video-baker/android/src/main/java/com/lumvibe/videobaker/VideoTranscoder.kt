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
        // "vintage_flicker" | "neon_edge" | "duotone_pulse" | "liquid_chrome" | "ink_wash" |
        // "mood_ring" | "wink_spark" | "smile_shatter" | "head_tilt_zoom" | "aura_glow" |
        // "color_drain" | "silence_ripple" | "voice_halo" | "thermal_pulse" | "depth_bloom" |
        // "split_prism" | "hand_portal" | "fist_bump_boom" | "two_hand_frame" | "gaze_trail" |
        // "double_take" | "blink_freeze" | null — see VisualEffect.fromKey for the
        // authoritative list. All 22 from the original pitch are now implemented.
        val effect: String? = null,
        val effectIntensity: Float = 1f, // 0..1
        // REQUIRED when effect == "hand_portal" — a plain filesystem path to the scene
        // image shown inside the portal circle. transcode() throws early if this
        // effect is selected without a path, rather than silently drawing nothing.
        val portalScenePngPath: String? = null,
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
        val selectedEffect = VisualEffect.fromKey(options.effect)
        val hasEffect = selectedEffect != VisualEffect.NONE

        // ---- Which per-frame data source does the selected effect need? ----
        // Generic dispatch replaces the old MOOD_RING-only hardcoded branch, so
        // adding a new blendshape-driven effect means adding it to one of these
        // sets, not writing a new "if (currentEffect == X)" block each time.
        val faceScoreEffects = setOf(VisualEffect.MOOD_RING, VisualEffect.WINK_SPARK, VisualEffect.SMILE_SHATTER)
        val facePoseEffects = setOf(VisualEffect.HEAD_TILT_ZOOM, VisualEffect.DOUBLE_TAKE) // both read headPoseDegrees
        val faceBoxEffects = setOf(VisualEffect.VOICE_HALO) // needs FaceTracker.faceBoundingBox, not blendshapes
        val irisEffects = setOf(VisualEffect.GAZE_TRAIL) // needs FaceTracker.irisCenter
        val blinkEffects = setOf(VisualEffect.BLINK_FREEZE) // needs both-eye blink blendshapes
        val audioScoreEffects = setOf(VisualEffect.AURA_GLOW, VisualEffect.THERMAL_PULSE) // uIntensity = amplitude directly
        val silenceEffects = setOf(VisualEffect.SILENCE_RIPPLE) // uIntensity = 1-amplitude
        val stillnessEffects = setOf(VisualEffect.COLOR_DRAIN)
        val motionEffects = setOf(VisualEffect.SPLIT_PRISM) // uIntensity = motion magnitude, not stillness
        val segmentationAudioEffects = setOf(VisualEffect.DEPTH_BLOOM) // needs mask AND amplitude
        val segmentationOnlyEffects = setOf(VisualEffect.SPLIT_PRISM) // needs mask, motion computed separately above
        val handGestureEffects = setOf(VisualEffect.HAND_PORTAL, VisualEffect.FIST_BUMP_BOOM, VisualEffect.TWO_HAND_FRAME)

        val needsFaceTracker = selectedEffect in faceScoreEffects || selectedEffect in facePoseEffects ||
            selectedEffect in faceBoxEffects || selectedEffect in irisEffects || selectedEffect in blinkEffects
        val needsHandTracker = selectedEffect in handGestureEffects
        val needsSegmentation = selectedEffect in segmentationAudioEffects || selectedEffect in segmentationOnlyEffects
        val needsAmplitude = selectedEffect in audioScoreEffects || selectedEffect in silenceEffects ||
            selectedEffect in segmentationAudioEffects || selectedEffect in faceBoxEffects
        val needsFrameReadback = needsFaceTracker || needsHandTracker || needsSegmentation || selectedEffect in stillnessEffects || selectedEffect in motionEffects

        if (selectedEffect == VisualEffect.HAND_PORTAL && options.portalScenePngPath == null) {
            throw IllegalArgumentException("VisualEffect.HAND_PORTAL requires options.portalScenePngPath")
        }

        // Phase 2 — only pay the MediaPipe init/model-load cost when actually needed.
        val faceTracker: FaceTracker? = if (needsFaceTracker) FaceTracker(context) else null
        val handTracker: HandTracker? = if (needsHandTracker) HandTracker(context) else null
        val segmentationTracker: SegmentationTracker? = if (needsSegmentation) SegmentationTracker(context) else null

        // Phase 3 — only decode audio to PCM (a real, separate cost — see class doc)
        // when an audio-reactive effect is actually selected.
        val audioReader: AudioAmplitudeReader? =
            if (needsAmplitude) AudioAmplitudeReader.analyze(inputPath) else null

        // HAND_PORTAL's scene image is static — loaded and uploaded ONCE, before the
        // loop, unlike DEPTH_BLOOM/SPLIT_PRISM's mask which is re-uploaded every frame.
        renderer.ensureSecondaryTexture()
        if (selectedEffect == VisualEffect.HAND_PORTAL) {
            val portalBitmap = OverlayBuilder.loadPortalSceneBitmap(options.portalScenePngPath)
                ?: throw IllegalArgumentException("HAND_PORTAL: could not decode portalScenePngPath: ${options.portalScenePngPath}")
            renderer.uploadSecondaryTexture(portalBitmap)
            portalBitmap.recycle()
        }

        // COLOR_DRAIN's "stillness" state and SPLIT_PRISM's "motion" state — both
        // derived from the SAME frame-to-frame average-luma delta (see averageLuma
        // below), just read differently: stillness accumulates while UNCHANGED,
        // motion is the raw delta itself. Deliberately simple (no optical flow)
        // since this only needs "did the frame change much," not tracked motion
        // vectors — see the "no live device-motion sensor during post-record baking"
        // note in EffectShaders.colorDrain's doc for why this substitution exists.
        var lastAvgLuma: Float? = null
        var stillnessAccumSec = 0f

        // FIST_BUMP_BOOM's decaying trigger energy — jumps to 1.0 the frame a fist
        // is detected, decays by 15% every subsequent processed frame otherwise.
        // Frame-count-based decay (not time-based) is a known simplification: the
        // decay's real-world duration will vary slightly with the source video's
        // actual frame rate. Fine for a ~0.5s punchy effect; revisit if you need
        // frame-rate-independent timing later.
        var boomEnergy = 0f

        // GAZE_TRAIL's position history — plain Kotlin list, newest first. Capped at
        // 8 entries (matches EffectShaders.GAZE_TRAIL_POINTS) since that's all the
        // shader's fixed-size uniform array holds; older points just fall off the end.
        val gazeHistory = ArrayDeque<Pair<Float, Float>>()

        // DOUBLE_TAKE's turn-speed state — yaw delta between consecutive frames.
        var lastYaw: Float? = null

        // BLINK_FREEZE's hold state. freezeActive stays true for freezeDurationSec
        // of VIDEO TIMELINE (not wall-clock/frame-count, unlike boomEnergy's decay —
        // presentationTimeUs gives us exact timing here, so we use it), during which
        // every frame draws the captured texture instead of the newly decoded one.
        var freezeActive = false
        var freezeStartSec = 0f
        val freezeDurationSec = 0.3f

        fun averageLuma(bitmap: android.graphics.Bitmap): Float {
            // Downsample hard before reading pixels back into Kotlin — we only need a
            // rough "how bright overall" number, not per-pixel accuracy, and iterating
            // every pixel of a full-res frame in Kotlin (not GL) would be far slower
            // than this shrink-then-average approach.
            val small = android.graphics.Bitmap.createScaledBitmap(bitmap, 32, 32, true)
            var sum = 0L
            val pixels = IntArray(32 * 32)
            small.getPixels(pixels, 0, 32, 0, 0, 32, 32)
            for (p in pixels) {
                val r = (p shr 16) and 0xFF
                val g = (p shr 8) and 0xFF
                val b = p and 0xFF
                sum += (0.299 * r + 0.587 * g + 0.114 * b).toLong()
            }
            small.recycle()
            return sum / (32f * 32f * 255f)
        }

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

                        if (freezeActive && elapsedSec - freezeStartSec < freezeDurationSec) {
                            // BLINK_FREEZE currently holding — draw the captured texture
                            // instead of this frame's newly decoded content, entirely
                            // bypassing the normal effect/readback path below. The decoder
                            // keeps advancing normally underneath; we're just choosing not
                            // to display its output for this stretch of the timeline.
                            val freezeProgress = (elapsedSec - freezeStartSec) / freezeDurationSec
                            // Punch in for the first half, ease back for the second —
                            // gives the "photo capture" snap feel from the pitch rather
                            // than a flat static zoom. Curve shape is a starting point,
                            // not tuned against real footage yet.
                            val punch = if (freezeProgress < 0.5f) freezeProgress * 2f else (1f - freezeProgress) * 2f
                            renderer.drawFrozenFrame(1f + punch * 0.15f)
                        } else {
                            if (freezeActive) freezeActive = false // hold just ended this frame

                        if (hasEffect) {
                            if (needsFrameReadback) {
                                // Any face/hand/segmentation/stillness-tracked effect needs
                                // a plain-rendered Bitmap of THIS frame first — draw plain,
                                // read back, analyze, THEN redraw with the real effect
                                // shader using the score(s) just found. That means these
                                // effects render each frame twice — a real, known extra
                                // cost versus the Phase 1 shader-only effects, which never
                                // leave the GPU. Same tradeoff MOOD_RING originally accepted;
                                // now shared by every effect in this category.
                                renderer.drawVideoFrame(decoderTextureId, texMatrix)
                                val frameBitmap = GlUtil.readPixelsAsBitmap(width, height)
                                val timestampMs = bufferInfo.presentationTimeUs / 1000

                                // BLINK_FREEZE's capture must happen from THIS plain frame,
                                // right after drawVideoFrame above and before anything else
                                // draws on top of it — see FrameRenderer.captureFreezeFrame's doc.
                                if (selectedEffect in blinkEffects) renderer.captureFreezeFrame()

                                if (needsFaceTracker && faceTracker != null) {
                                    val result = faceTracker.detect(frameBitmap, timestampMs)
                                    when (selectedEffect) {
                                        VisualEffect.MOOD_RING, VisualEffect.SMILE_SHATTER -> {
                                            val smile = if (result != null) maxOf(
                                                faceTracker.blendshapeScore(result, "mouthSmileLeft"),
                                                faceTracker.blendshapeScore(result, "mouthSmileRight")
                                            ) else 0f
                                            renderer.effectIntensity = smile
                                        }
                                        VisualEffect.WINK_SPARK -> {
                                            // A "clean wink" = one eye clearly closed while
                                            // the other stays open — plain |L - R| would also
                                            // fire on a full double-blink, so we gate on the
                                            // open eye actually being open (score below 0.3).
                                            val left = if (result != null) faceTracker.blendshapeScore(result, "eyeBlinkLeft") else 0f
                                            val right = if (result != null) faceTracker.blendshapeScore(result, "eyeBlinkRight") else 0f
                                            val wink = when {
                                                left > 0.6f && right < 0.3f -> left
                                                right > 0.6f && left < 0.3f -> right
                                                else -> 0f
                                            }
                                            renderer.effectIntensity = wink
                                        }
                                        VisualEffect.HEAD_TILT_ZOOM -> {
                                            val pose = result?.let { faceTracker.headPoseDegrees(it) }
                                            val roll = pose?.get(0) ?: 0f
                                            // Map roll degrees to zoom/pan. Clamped ranges
                                            // are a starting point tuned on paper, not on a
                                            // real clip — adjust maxRollDeg / maxZoom once
                                            // you've tested against actual head-tilt footage.
                                            val maxRollDeg = 25f
                                            val maxZoom = 1.35f
                                            val t = (kotlin.math.abs(roll) / maxRollDeg).coerceIn(0f, 1f)
                                            renderer.headTiltZoom = 1f + t * (maxZoom - 1f)
                                            renderer.headTiltPan = floatArrayOf(
                                                (roll / maxRollDeg).coerceIn(-1f, 1f) * 0.15f, 0f
                                            )
                                        }
                                        VisualEffect.DOUBLE_TAKE -> {
                                            val pose = result?.let { faceTracker.headPoseDegrees(it) }
                                            val yaw = pose?.get(2)
                                            if (yaw != null && lastYaw != null) {
                                                // deltaSec approx — see averageLuma's frameDur note;
                                                // exact per-frame duration would need the previous
                                                // frame's presentationTimeUs, not just this one's.
                                                val yawDelta = yaw - lastYaw!!
                                                val speed = (kotlin.math.abs(yawDelta) / 15f).coerceIn(0f, 1f) // 15deg/frame ~= max
                                                renderer.effectIntensity = speed
                                                renderer.doubleTakeDirection = kotlin.math.sign(yawDelta)
                                            } else {
                                                renderer.effectIntensity = 0f
                                            }
                                            if (yaw != null) lastYaw = yaw
                                        }
                                        VisualEffect.VOICE_HALO -> {
                                            val box = result?.let { faceTracker.faceBoundingBox(it) }
                                            if (box != null) renderer.faceBox = box
                                            // else: keep last-known box, avoids a jarring
                                            // snap-to-default on a single dropped-detection frame
                                        }
                                        VisualEffect.GAZE_TRAIL -> {
                                            val iris = result?.let { faceTracker.irisCenter(it) }
                                            if (iris != null) {
                                                gazeHistory.addFirst(iris)
                                                while (gazeHistory.size > 8) gazeHistory.removeLast()
                                            }
                                            val flat = FloatArray(16)
                                            val ages = FloatArray(8)
                                            gazeHistory.forEachIndexed { i, (x, y) ->
                                                flat[i * 2] = x; flat[i * 2 + 1] = y
                                                ages[i] = i / 8f
                                            }
                                            renderer.gazePoints = flat
                                            renderer.gazeAges = ages
                                            renderer.gazeCount = gazeHistory.size
                                        }
                                        VisualEffect.BLINK_FREEZE -> {
                                            val left = if (result != null) faceTracker.blendshapeScore(result, "eyeBlinkLeft") else 0f
                                            val right = if (result != null) faceTracker.blendshapeScore(result, "eyeBlinkRight") else 0f
                                            if (!freezeActive && left > 0.6f && right > 0.6f) {
                                                freezeActive = true
                                                freezeStartSec = elapsedSec
                                                // renderer.captureFreezeFrame() already called above,
                                                // right after this frame's plain draw — the frame WE
                                                // freeze on is the blink frame itself, matching the
                                                // pitch's "blink triggers freeze" (not the frame after).
                                            }
                                        }
                                        else -> {}
                                    }
                                }

                                if (needsHandTracker && handTracker != null) {
                                    val result = handTracker.detect(frameBitmap, timestampMs)
                                    val hands = result?.landmarks()
                                    when (selectedEffect) {
                                        VisualEffect.HAND_PORTAL -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null) renderer.portalCenter = handTracker.palmCenter(first).let { floatArrayOf(it.first, it.second) }
                                        }
                                        VisualEffect.FIST_BUMP_BOOM -> {
                                            val first = hands?.firstOrNull()
                                            val triggered = first != null && handTracker.isFist(first)
                                            if (triggered) {
                                                boomEnergy = 1f
                                                renderer.boomCenter = handTracker.palmCenter(first!!).let { floatArrayOf(it.first, it.second) }
                                            } else {
                                                boomEnergy *= 0.85f // decays toward 0 across subsequent frames
                                            }
                                            renderer.boomEnergy = boomEnergy
                                        }
                                        VisualEffect.TWO_HAND_FRAME -> {
                                            if (hands != null && hands.size >= 2) {
                                                val c1 = handTracker.palmCenter(hands[0])
                                                val c2 = handTracker.palmCenter(hands[1])
                                                renderer.frameRect = floatArrayOf(
                                                    minOf(c1.first, c2.first), minOf(c1.second, c2.second),
                                                    maxOf(c1.first, c2.first), maxOf(c1.second, c2.second)
                                                )
                                                // Confidence heuristic: a believable "frame" needs the
                                                // two hands reasonably far apart, not overlapping —
                                                // tune the 0.15f threshold against a real test clip.
                                                val spread = kotlin.math.abs(c1.first - c2.first) + kotlin.math.abs(c1.second - c2.second)
                                                renderer.effectIntensity = if (spread > 0.15f) 1f else 0f
                                            } else {
                                                renderer.effectIntensity = 0f
                                            }
                                        }
                                        else -> {}
                                    }
                                }

                                if (needsSegmentation && segmentationTracker != null) {
                                    val mask = segmentationTracker.maskBitmap(frameBitmap, timestampMs)
                                    if (mask != null) {
                                        renderer.uploadSecondaryTexture(mask)
                                        mask.recycle()
                                    }
                                    // else: keep last-uploaded mask rather than clearing it —
                                    // a momentary detection miss shouldn't blank the whole effect
                                }

                                if (selectedEffect in stillnessEffects || selectedEffect in motionEffects) {
                                    val luma = averageLuma(frameBitmap)
                                    val frameDur = 1f / 30f // approx; presentation-time deltas would be exact
                                    val delta = if (lastAvgLuma != null) kotlin.math.abs(luma - lastAvgLuma!!) else 0f
                                    if (selectedEffect in stillnessEffects) {
                                        if (delta > 0.01f) stillnessAccumSec = 0f else stillnessAccumSec += frameDur
                                        // Fully drained after 3s of stillness — matches the
                                        // "Stillness: 03.2s" example shown in the reference mock.
                                        renderer.effectIntensity = (stillnessAccumSec / 3f).coerceIn(0f, 1f)
                                    } else {
                                        // SPLIT_PRISM: scale the raw delta into a usable 0..1
                                        // range. 0.05 as "fully split" is a starting point tuned
                                        // on paper — adjust against real motion footage.
                                        renderer.effectIntensity = (delta / 0.05f).coerceIn(0f, 1f)
                                    }
                                    lastAvgLuma = luma
                                }

                                frameBitmap.recycle()

                                // VOICE_HALO and DEPTH_BLOOM need amplitude ON TOP OF the
                                // face/segmentation data just computed above — applied here
                                // so it isn't clobbered by (or clobber) the branches above.
                                if (audioReader != null && (selectedEffect in faceBoxEffects || selectedEffect in segmentationAudioEffects)) {
                                    renderer.effectIntensity = audioReader.amplitudeAt(elapsedSec)
                                }

                                // BLINK_FREEZE has no "normal" shader look of its own — outside
                                // an active freeze hold it's just plain video, which was ALREADY
                                // drawn above (before the blink-detection check) for the readback.
                                // Redrawing through drawEffectFrame here would incorrectly apply
                                // the freeze program (which expects a captured texture, not the
                                // live decoder texture) even on non-frozen frames — skip it.
                                if (selectedEffect !in blinkEffects) {
                                    renderer.drawEffectFrame(decoderTextureId, texMatrix, elapsedSec)
                                }
                            } else if (audioReader != null && (selectedEffect in audioScoreEffects || selectedEffect in silenceEffects)) {
                                val amplitude = audioReader.amplitudeAt(elapsedSec)
                                renderer.effectIntensity = if (selectedEffect in silenceEffects) 1f - amplitude else amplitude
                                renderer.drawEffectFrame(decoderTextureId, texMatrix, elapsedSec)
                            } else {
                                renderer.drawEffectFrame(decoderTextureId, texMatrix, elapsedSec)
                            }
                        } else {
                            renderer.drawVideoFrame(decoderTextureId, texMatrix)
                        }
                        } // closes the "else" branch opened at the freezeActive check above,
                          // a few dozen lines up — everything from "if (hasEffect)" down to
                          // here only runs when we're NOT currently holding a blink-freeze frame.

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
        handTracker?.close()
        segmentationTracker?.close()
        eglCore.releaseSurface(windowSurface)
        eglCore.release()
        surfaceTexture.release()
        decoderOutputSurface.release()
        extractor.release()

        onProgress?.invoke(1f)
    }
}  
