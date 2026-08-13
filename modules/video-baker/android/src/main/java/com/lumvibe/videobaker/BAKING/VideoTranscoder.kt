package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Color
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
        val facePoseEffects = setOf(VisualEffect.HEAD_TILT_ZOOM, VisualEffect.DOUBLE_TAKE, VisualEffect.SPIN_EFFECT) // all read headPoseDegrees
        val faceBoxEffects = setOf(VisualEffect.VOICE_HALO, VisualEffect.RAISE_EYEBROW, VisualEffect.SPIN_EFFECT) // all need FaceTracker.faceBoundingBox
        val irisEffects = setOf(VisualEffect.GAZE_TRAIL) // needs FaceTracker.irisCenter
        val blinkEffects = setOf(VisualEffect.BLINK_FREEZE) // needs both-eye blink blendshapes
        val mouthEffects = setOf(VisualEffect.MOUTH_FIRE, VisualEffect.MOUTH_WORDS) // both need FaceTracker.mouthCenter
        // Same reasoning as EffectRequirements.kt's dedicated set: both need the
        // FULL FaceTracker result (a smile score to trigger on, or the entire
        // landmark list), not a shared intensity/box/point value, so kept
        // separate from faceScoreEffects/faceBoxEffects rather than folded in.
        val faceLandmarkEffects = setOf(VisualEffect.STICKERS_REACT, VisualEffect.FACE_MORPH)
        val audioScoreEffects = setOf(VisualEffect.AURA_GLOW, VisualEffect.THERMAL_PULSE) // uIntensity = amplitude directly
        val silenceEffects = setOf(VisualEffect.SILENCE_RIPPLE) // uIntensity = 1-amplitude
        val stillnessEffects = setOf(VisualEffect.COLOR_DRAIN)
        val motionEffects = setOf(VisualEffect.SPLIT_PRISM) // uIntensity = motion magnitude, not stillness
        val segmentationAudioEffects = setOf(VisualEffect.DEPTH_BLOOM) // needs mask AND amplitude
        val segmentationOnlyEffects = setOf(VisualEffect.SPLIT_PRISM, VisualEffect.GOLD_SKIN) // needs mask, nothing else
        val handGestureEffects = setOf(
            VisualEffect.HAND_PORTAL, VisualEffect.FIST_BUMP_BOOM, VisualEffect.TWO_HAND_FRAME, VisualEffect.THROW_CONFETTI,
            VisualEffect.PALM_MAGIC, VisualEffect.ROCK_PAPER_SCISSORS, VisualEffect.CLAP_BURST, VisualEffect.TAP_SHOCKWAVE,
            VisualEffect.FIRE_BOOK
        )

        val needsFaceTracker = selectedEffect in faceScoreEffects || selectedEffect in facePoseEffects ||
            selectedEffect in faceBoxEffects || selectedEffect in irisEffects || selectedEffect in blinkEffects ||
            selectedEffect in mouthEffects || selectedEffect in faceLandmarkEffects
        val needsHandTracker = selectedEffect in handGestureEffects
        val needsSegmentation = selectedEffect in segmentationAudioEffects || selectedEffect in segmentationOnlyEffects
        val needsAmplitude = selectedEffect in audioScoreEffects || selectedEffect in silenceEffects ||
            selectedEffect in segmentationAudioEffects || selectedEffect in faceBoxEffects
        val needsFrameReadback = needsFaceTracker || needsHandTracker || needsSegmentation || selectedEffect in stillnessEffects || selectedEffect in motionEffects

        if (selectedEffect == VisualEffect.HAND_PORTAL && options.portalScenePngPath == null) {
            throw IllegalArgumentException("VisualEffect.HAND_PORTAL requires options.portalScenePngPath")
        }
        // FIRE_BOOK reuses the SAME portalScenePngPath option for its book image
        // (its shader also reuses uPortalTexture — see EffectShaders.fireBook's
        // doc) rather than adding a second, near-identical "static image asset
        // path" option. There's no book asset in this project — you supply one
        // here, same as HAND_PORTAL's scene image.
        if (selectedEffect == VisualEffect.FIRE_BOOK && options.portalScenePngPath == null) {
            throw IllegalArgumentException("VisualEffect.FIRE_BOOK requires options.portalScenePngPath (a book image — see EffectShaders.fireBook's doc)")
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
        if (selectedEffect == VisualEffect.FIRE_BOOK) {
            val bookBitmap = OverlayBuilder.loadPortalSceneBitmap(options.portalScenePngPath)
                ?: throw IllegalArgumentException("FIRE_BOOK: could not decode portalScenePngPath: ${options.portalScenePngPath}")
            renderer.uploadSecondaryTexture(bookBitmap)
            bookBitmap.recycle()
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

        // THROW_CONFETTI's real physics state — only allocated when actually
        // needed (this whole class costs nothing for any other effect).
        // lastPalmPos/lastPalmTimestampMs track frame-to-frame palm movement to
        // detect an actual "throw" (a velocity spike), not just "hand present" —
        // a meaningfully different trigger than FIST_BUMP_BOOM's static pose
        // check above, since a throw is inherently a MOTION, not a shape.
        val confettiSystem: ParticleSystem? = if (selectedEffect == VisualEffect.THROW_CONFETTI) ParticleSystem() else null
        var lastPalmPos: Pair<Float, Float>? = null
        var lastPalmTimestampMs: Long? = null
        var lastConfettiUpdateMs: Long? = null

        // MOUTH_WORDS's state — currentMouthWord drives the hysteresis (only
        // clear on a low "release" threshold, only pick a NEW word while none is
        // active — see the per-frame branch below), and the texture/dimensions
        // are cached so the GPU texture only gets rebuilt when the word actually
        // changes, not every frame.
        var currentMouthWord: String? = null
        var lastBuiltMouthWord: String? = null
        var mouthWordTextureId = 0
        var mouthWordWidthPx = 0f
        var mouthWordHeightPx = 0f
        var mouthWordAnchorX = 0.5f
        var mouthWordAnchorY = 0.6f

        // PALM_MAGIC's state — same ParticleSystem class as confetti, tuned
        // with near-zero gravity for a gentle upward drift instead of a falling
        // arc (see instantiation below). Continuous gentle emission while the
        // palm stays open, not a one-shot burst like confetti/clap.
        val palmMagicSystem: ParticleSystem? = if (selectedEffect == VisualEffect.PALM_MAGIC) ParticleSystem(gravity = -0.15f) else null
        var lastPalmMagicUpdateMs: Long? = null

        // CLAP_BURST's state — tracks the DISTANCE between both palms frame to
        // frame (not a single hand's velocity, unlike confetti/tap) to detect
        // them rapidly closing together.
        val clapBurstSystem: ParticleSystem? = if (selectedEffect == VisualEffect.CLAP_BURST) ParticleSystem() else null
        var lastClapBurstUpdateMs: Long? = null
        var lastClapDistance: Float? = null
        var clapCooldown = false
        var clapBoomEnergy = 0f

        // TAP_SHOCKWAVE's state — same velocity-spike-with-cooldown TECHNIQUE
        // confetti's throw-detection already proved, applied to the index
        // fingertip instead of the palm. Deliberately not attempting a stricter
        // "spike-then-deceleration" detector — that needs velocity HISTORY
        // across 3+ frames, meaningfully more state and risk for a gesture
        // (tap/poke) that's already well-served by the simpler, already-working
        // pattern.
        var lastTapFingerPos: Pair<Float, Float>? = null
        var lastTapTimestampMs: Long? = null
        var tapCooldown = false
        var tapBoomEnergy = 0f

        // ROCK_PAPER_SCISSORS's state — same "cache texture until the label
        // changes" pattern as MOUTH_WORDS, driven by HandTracker.classifyGesture()
        // instead of blendshapes.
        var currentRpsLabel: String? = null
        var lastBuiltRpsLabel: String? = null
        var rpsTextureId = 0
        var rpsWidthPx = 0f
        var rpsHeightPx = 0f
        var rpsAnchorX = 0.5f
        var rpsAnchorY = 0.5f

        // STICKERS_REACT's state — same ParticleSystem class, sixth tuning
        // (gentle upward float, short lifetime, spawned from real smile
        // detection — see the per-frame branch below).
        val stickersSystem: ParticleSystem? = if (selectedEffect == VisualEffect.STICKERS_REACT) ParticleSystem(gravity = -0.2f) else null
        var lastStickersUpdateMs: Long? = null

        // FIRE_BOOK's flame particles — fast upward flicker, short lifetime.
        // The book image itself is loaded/uploaded ONCE above (see
        // ensureSecondaryTexture block) — this system is only the animated
        // fire on top of it.
        val fireBookSystem: ParticleSystem? = if (selectedEffect == VisualEffect.FIRE_BOOK) ParticleSystem(gravity = -0.5f) else null
        var lastFireBookUpdateMs: Long? = null
        // Prevents one continuous throw motion from spawning a new burst every
        // single frame while velocity stays above threshold — requires velocity
        // to drop back down before the next throw can trigger, same "trigger
        // once, then require reset" spirit as FIST_BUMP_BOOM's cooldown, just
        // velocity-gated instead of frame-count-gated.
        var confettiCooldown = false

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
                                // SPEED: read at full resolution (required — glReadPixels
                                // reads a WxH region 1:1, it can't scale), then downscale
                                // BEFORE handing to MediaPipe. Face/hand/segmentation models
                                // all resize their input to a small fixed size internally
                                // anyway (roughly 192-256px) — feeding them a full 1080p+
                                // bitmap every frame wastes real CPU/GPU time on detail the
                                // model discards immediately. Capping the longer edge at
                                // 384px cuts that wasted work with no meaningful accuracy
                                // loss for visual effects (not precision measurement).
                                // averageLuma() below also runs on this smaller bitmap — an
                                // average brightness doesn't need full-res input to be accurate.
                                val rawBitmap = GlUtil.readPixelsAsBitmap(width, height)
                                val trackScale = 384f / maxOf(rawBitmap.width, rawBitmap.height).coerceAtLeast(1)
                                val frameBitmap = if (trackScale < 1f) {
                                    android.graphics.Bitmap.createScaledBitmap(
                                        rawBitmap,
                                        (rawBitmap.width * trackScale).toInt().coerceAtLeast(1),
                                        (rawBitmap.height * trackScale).toInt().coerceAtLeast(1),
                                        true
                                    ).also { rawBitmap.recycle() }
                                } else rawBitmap
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
                                        VisualEffect.RAISE_EYEBROW -> {
                                            val box = result?.let { faceTracker.faceBoundingBox(it) }
                                            if (box != null) renderer.faceBox = box
                                            val innerUp = if (result != null) faceTracker.blendshapeScore(result, "browInnerUp") else 0f
                                            val outerL = if (result != null) faceTracker.blendshapeScore(result, "browOuterUpLeft") else 0f
                                            val outerR = if (result != null) faceTracker.blendshapeScore(result, "browOuterUpRight") else 0f
                                            renderer.effectIntensity = maxOf(innerUp, outerL, outerR)
                                        }
                                        VisualEffect.SPIN_EFFECT -> {
                                            val box = result?.let { faceTracker.faceBoundingBox(it) }
                                            if (box != null) renderer.faceBox = box
                                            val pose = result?.let { faceTracker.headPoseDegrees(it) }
                                            val yaw = pose?.get(2) ?: 0f
                                            // Real yaw drives spin speed (see spinEffect shader) —
                                            // 30deg chosen as "meaningfully turned," same rough
                                            // scale HEAD_TILT_ZOOM's maxRollDeg uses for roll.
                                            renderer.effectIntensity = (kotlin.math.abs(yaw) / 30f).coerceIn(0f, 1f)
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
                                        VisualEffect.MOUTH_FIRE -> {
                                            // Standard MediaPipe blendshape name for how open the
                                            // jaw/mouth is — same "look it up by name, default 0"
                                            // pattern blendshapeScore already uses everywhere else
                                            // in this file (e.g. mouthSmileLeft/Right above).
                                            val jawOpen = if (result != null) faceTracker.blendshapeScore(result, "jawOpen") else 0f
                                            renderer.effectIntensity = jawOpen
                                            val mouth = result?.let { faceTracker.mouthCenter(it) }
                                            if (mouth != null) renderer.mouthCenter = floatArrayOf(mouth.first, mouth.second)
                                            // else: keep last-known position, same "don't snap to a
                                            // default on one dropped-detection frame" policy VOICE_HALO uses
                                        }
                                        VisualEffect.MOUTH_WORDS -> {
                                            val jawOpen = if (result != null) faceTracker.blendshapeScore(result, "jawOpen") else 0f
                                            val smileL = if (result != null) faceTracker.blendshapeScore(result, "mouthSmileLeft") else 0f
                                            val smileR = if (result != null) faceTracker.blendshapeScore(result, "mouthSmileRight") else 0f
                                            val smile = maxOf(smileL, smileR)
                                            val browUp = if (result != null) faceTracker.blendshapeScore(result, "browInnerUp") else 0f

                                            // Hysteresis: only clear the active word once jawOpen drops
                                            // well below the trigger level, and only pick a NEW word while
                                            // none is currently active — prevents flicker if jawOpen
                                            // oscillates right around a threshold.
                                            val releaseThreshold = 0.25f
                                            if (currentMouthWord != null && jawOpen < releaseThreshold) {
                                                currentMouthWord = null
                                            } else if (currentMouthWord == null) {
                                                currentMouthWord = when {
                                                    jawOpen > 0.6f && smile > 0.3f -> "HAHA!"   // wide open + smiling = laughing
                                                    jawOpen > 0.5f && browUp > 0.4f -> "OMG!"    // wide open + raised brows = shocked
                                                    jawOpen > 0.4f -> "WOW!"                     // open, neither strongly smiling nor browed
                                                    else -> null
                                                }
                                            }

                                            if (currentMouthWord != null && currentMouthWord != lastBuiltMouthWord) {
                                                // Word changed — rebuild the texture. Delete the OLD one
                                                // first so we don't leak a GPU texture every time the
                                                // reaction changes across a video.
                                                if (mouthWordTextureId != 0) {
                                                    GLES20.glDeleteTextures(1, intArrayOf(mouthWordTextureId), 0)
                                                }
                                                val color = when (currentMouthWord) {
                                                    "HAHA!" -> Color.rgb(255, 214, 51)  // gold
                                                    "OMG!" -> Color.rgb(255, 71, 153)   // hot pink
                                                    else -> Color.rgb(64, 200, 255)     // cyan — WOW!
                                                }
                                                val bubble = OverlayBuilder.buildWordBubble(currentMouthWord!!, color, height * 0.06f)
                                                mouthWordTextureId = bubble.textureId
                                                mouthWordWidthPx = bubble.widthPx
                                                mouthWordHeightPx = bubble.heightPx
                                                lastBuiltMouthWord = currentMouthWord
                                            } else if (currentMouthWord == null && mouthWordTextureId != 0) {
                                                // Word released — free the texture rather than holding a
                                                // dead GPU resource for the rest of the video.
                                                GLES20.glDeleteTextures(1, intArrayOf(mouthWordTextureId), 0)
                                                mouthWordTextureId = 0
                                                lastBuiltMouthWord = null
                                            }

                                            val mouth = result?.let { faceTracker.mouthCenter(it) }
                                            if (mouth != null) {
                                                mouthWordAnchorX = mouth.first
                                                mouthWordAnchorY = mouth.second
                                            }
                                        }
                                        VisualEffect.STICKERS_REACT -> {
                                            if (result != null && stickersSystem != null) {
                                                val smileL = faceTracker.blendshapeScore(result, "mouthSmileLeft")
                                                val smileR = faceTracker.blendshapeScore(result, "mouthSmileRight")
                                                val smile = maxOf(smileL, smileR)
                                                if (smile > 0.35f) {
                                                    val box = faceTracker.faceBoundingBox(result)
                                                    // FIX: faceBoundingBox() returns FloatArray? (can be
                                                    // null even with a valid result) — every other use of
                                                    // it in this file null-checks before indexing; this one
                                                    // didn't, which is exactly what broke the build.
                                                    if (box != null) {
                                                        // Spawn near the upper-right of the face — reads as a
                                                        // reaction floating up beside it, not glued to a fixed point.
                                                        val spawnX = box[2] - (box[2] - box[0]) * 0.15f
                                                        val spawnY = box[1] + (box[3] - box[1]) * 0.2f
                                                        stickersSystem.spawnBurst(spawnX, spawnY, count = 1, speed = 0.12f, lifetimeSec = 1.2f)
                                                    }
                                                }
                                            }
                                        }
                                        VisualEffect.FACE_MORPH -> {
                                            // Rebuilt EVERY frame — the mesh must track the real,
                                            // currently-detected landmark positions, not a cached
                                            // snapshot. See FaceMeshRenderer's doc for the real
                                            // per-frame CPU cost this carries and the throttling
                                            // option if it proves too slow on a budget test device.
                                            val landmarks = result?.faceLandmarks()?.firstOrNull()
                                            if (landmarks != null) {
                                                val meshBitmap = FaceMeshRenderer.buildMeshBitmap(width, height, landmarks, splitX = 0.5f)
                                                renderer.uploadSecondaryTexture(meshBitmap)
                                                meshBitmap.recycle()
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
                                        VisualEffect.THROW_CONFETTI -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null && confettiSystem != null) {
                                                val palm = handTracker.palmCenter(first)
                                                val prevPos = lastPalmPos
                                                val prevTs = lastPalmTimestampMs
                                                if (prevPos != null && prevTs != null && timestampMs > prevTs) {
                                                    val dtSec = (timestampMs - prevTs) / 1000f
                                                    val dx = palm.first - prevPos.first
                                                    val dy = palm.second - prevPos.second
                                                    val velocity = kotlin.math.sqrt(dx * dx + dy * dy) / dtSec
                                                    // Threshold tuned for normalized (0..1) screen-space
                                                    // coordinates — a real throw covers a meaningful
                                                    // fraction of the frame in well under a second, unlike
                                                    // normal hand drift. Verify against a real test clip
                                                    // and adjust if it triggers too eagerly/rarely.
                                                    val triggerVelocity = 1.8f
                                                    val resetVelocity = 0.6f
                                                    if (!confettiCooldown && velocity > triggerVelocity) {
                                                        confettiSystem.spawnBurst(palm.first, palm.second, count = 16, speed = 0.9f, lifetimeSec = 1.1f)
                                                        confettiCooldown = true
                                                    } else if (confettiCooldown && velocity < resetVelocity) {
                                                        confettiCooldown = false
                                                    }
                                                }
                                                lastPalmPos = palm
                                                lastPalmTimestampMs = timestampMs
                                            }
                                        }
                                        VisualEffect.PALM_MAGIC -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null && palmMagicSystem != null) {
                                                val gesture = handTracker.classifyGesture(first)
                                                if (gesture == HandTracker.HandGesture.OPEN_PALM) {
                                                    val palm = handTracker.palmCenter(first)
                                                    // Continuous gentle spawn, not a one-shot burst —
                                                    // 2 sparkles/frame keeps a steady shimmer without
                                                    // flooding MAX_PARTICLES (24) within a second or two.
                                                    palmMagicSystem.spawnBurst(palm.first, palm.second, count = 2, speed = 0.15f, lifetimeSec = 1.4f)
                                                }
                                            }
                                        }
                                        VisualEffect.ROCK_PAPER_SCISSORS -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null) {
                                                val gesture = handTracker.classifyGesture(first)
                                                currentRpsLabel = when (gesture) {
                                                    HandTracker.HandGesture.FIST -> "ROCK"
                                                    HandTracker.HandGesture.OPEN_PALM -> "PAPER"
                                                    HandTracker.HandGesture.SCISSORS -> "SCISSORS"
                                                    else -> currentRpsLabel // ambiguous frame — keep showing the last confident read rather than flicker to nothing
                                                }
                                                if (currentRpsLabel != null && currentRpsLabel != lastBuiltRpsLabel) {
                                                    if (rpsTextureId != 0) GLES20.glDeleteTextures(1, intArrayOf(rpsTextureId), 0)
                                                    val bubble = OverlayBuilder.buildWordBubble(currentRpsLabel!!, Color.rgb(255, 255, 255), height * 0.055f)
                                                    rpsTextureId = bubble.textureId
                                                    rpsWidthPx = bubble.widthPx
                                                    rpsHeightPx = bubble.heightPx
                                                    lastBuiltRpsLabel = currentRpsLabel
                                                }
                                                val palm = handTracker.palmCenter(first)
                                                rpsAnchorX = palm.first
                                                rpsAnchorY = palm.second
                                            } else if (rpsTextureId != 0) {
                                                // No hand at all this frame — clear so a lingering
                                                // label doesn't sit frozen over nothing.
                                                GLES20.glDeleteTextures(1, intArrayOf(rpsTextureId), 0)
                                                rpsTextureId = 0
                                                lastBuiltRpsLabel = null
                                                currentRpsLabel = null
                                            }
                                        }
                                        VisualEffect.CLAP_BURST -> {
                                            if (hands != null && hands.size >= 2 && clapBurstSystem != null) {
                                                val c1 = handTracker.palmCenter(hands[0])
                                                val c2 = handTracker.palmCenter(hands[1])
                                                val dist = kotlin.math.sqrt((c1.first - c2.first) * (c1.first - c2.first) + (c1.second - c2.second) * (c1.second - c2.second))
                                                val prevDist = lastClapDistance
                                                // Closing threshold + a minimum prior separation, so two
                                                // hands that START already close together (e.g. resting
                                                // near each other) don't false-trigger the instant tracking begins.
                                                val closingFast = prevDist != null && prevDist > 0.25f && dist < 0.08f
                                                if (!clapCooldown && closingFast) {
                                                    val midX = (c1.first + c2.first) / 2f
                                                    val midY = (c1.second + c2.second) / 2f
                                                    clapBurstSystem.spawnBurst(midX, midY, count = 14, speed = 0.7f, lifetimeSec = 0.8f)
                                                    renderer.boomCenter = floatArrayOf(midX, midY)
                                                    clapBoomEnergy = 1f
                                                    clapCooldown = true
                                                } else if (clapCooldown && dist > 0.3f) {
                                                    clapCooldown = false
                                                }
                                                lastClapDistance = dist
                                            }
                                            clapBoomEnergy *= 0.85f // decays every processed frame, same rate FIST_BUMP_BOOM already uses
                                            renderer.boomEnergy = clapBoomEnergy
                                        }
                                        VisualEffect.TAP_SHOCKWAVE -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null) {
                                                val fingertip = first[8].x() to first[8].y() // INDEX_TIP
                                                val prevPos = lastTapFingerPos
                                                val prevTs = lastTapTimestampMs
                                                if (prevPos != null && prevTs != null && timestampMs > prevTs) {
                                                    val dtSec = (timestampMs - prevTs) / 1000f
                                                    val dx = fingertip.first - prevPos.first
                                                    val dy = fingertip.second - prevPos.second
                                                    val velocity = kotlin.math.sqrt(dx * dx + dy * dy) / dtSec
                                                    val triggerVelocity = 2.2f // fingertip moves faster than a palm for the same gesture scale, hence a higher threshold than confetti's 1.8f
                                                    val resetVelocity = 0.6f
                                                    if (!tapCooldown && velocity > triggerVelocity) {
                                                        renderer.boomCenter = floatArrayOf(fingertip.first, fingertip.second)
                                                        tapBoomEnergy = 1f
                                                        tapCooldown = true
                                                    } else if (tapCooldown && velocity < resetVelocity) {
                                                        tapCooldown = false
                                                    }
                                                }
                                                lastTapFingerPos = fingertip
                                                lastTapTimestampMs = timestampMs
                                            }
                                            tapBoomEnergy *= 0.85f
                                            renderer.boomEnergy = tapBoomEnergy
                                        }
                                        VisualEffect.FIRE_BOOK -> {
                                            val first = hands?.firstOrNull()
                                            if (first != null) {
                                                val palm = handTracker.palmCenter(first)
                                                renderer.portalCenter = floatArrayOf(palm.first, palm.second)
                                                // Fixed reasonable book scale — no explicit hand-size-driven
                                                // zoom, keeping this bounded in scope; palm-distance-driven
                                                // scaling (like TWO_HAND_FRAME's rectangle) is a reasonable
                                                // follow-up if a fixed size doesn't read well on a real clip.
                                                renderer.portalRadius = 0.16f
                                                if (fireBookSystem != null) {
                                                    // Flames spawn from the book's top edge, not its center —
                                                    // halfH matches the shader's own book-rectangle math.
                                                    val halfH = 0.16f * 0.7f
                                                    fireBookSystem.spawnBurst(palm.first, palm.second - halfH, count = 2, speed = 0.25f, lifetimeSec = 0.6f)
                                                }
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

                                // THROW_CONFETTI's simulation must advance every processed frame
                                // regardless of whether a hand was detected THIS frame — particles
                                // already in the air still need gravity/fade applied, or motion
                                // would stutter every time the hand briefly leaves frame. Decoupled
                                // from the trigger-detection dt above on purpose — this dt is about
                                // "how much time passed for the physics," not "how fast did the
                                // hand move."
                                if (confettiSystem != null) {
                                    val prevUpdateTs = lastConfettiUpdateMs
                                    if (prevUpdateTs != null && timestampMs > prevUpdateTs) {
                                        confettiSystem.update((timestampMs - prevUpdateTs) / 1000f)
                                    }
                                    lastConfettiUpdateMs = timestampMs
                                    val packed = confettiSystem.toUniforms()
                                    renderer.particlePositions = packed.positions
                                    renderer.particleRotations = packed.rotations
                                    renderer.particleLifeRemaining = packed.lifeRemaining
                                    renderer.particleColorIndices = packed.colorIndices
                                    renderer.particleCount = packed.count
                                }

                                // Same "advance every processed frame regardless of detection
                                // this frame" reasoning as confetti's block above — particles
                                // already spawned shouldn't stutter if the hand briefly leaves frame.
                                if (palmMagicSystem != null) {
                                    val prevUpdateTs = lastPalmMagicUpdateMs
                                    if (prevUpdateTs != null && timestampMs > prevUpdateTs) {
                                        palmMagicSystem.update((timestampMs - prevUpdateTs) / 1000f)
                                    }
                                    lastPalmMagicUpdateMs = timestampMs
                                    val packed = palmMagicSystem.toUniforms()
                                    renderer.particlePositions = packed.positions
                                    renderer.particleRotations = packed.rotations
                                    renderer.particleLifeRemaining = packed.lifeRemaining
                                    renderer.particleColorIndices = packed.colorIndices
                                    renderer.particleCount = packed.count
                                }

                                if (clapBurstSystem != null) {
                                    val prevUpdateTs = lastClapBurstUpdateMs
                                    if (prevUpdateTs != null && timestampMs > prevUpdateTs) {
                                        clapBurstSystem.update((timestampMs - prevUpdateTs) / 1000f)
                                    }
                                    lastClapBurstUpdateMs = timestampMs
                                    val packed = clapBurstSystem.toUniforms()
                                    renderer.particlePositions = packed.positions
                                    renderer.particleRotations = packed.rotations
                                    renderer.particleLifeRemaining = packed.lifeRemaining
                                    renderer.particleColorIndices = packed.colorIndices
                                    renderer.particleCount = packed.count
                                }

                                if (stickersSystem != null) {
                                    val prevUpdateTs = lastStickersUpdateMs
                                    if (prevUpdateTs != null && timestampMs > prevUpdateTs) {
                                        stickersSystem.update((timestampMs - prevUpdateTs) / 1000f)
                                    }
                                    lastStickersUpdateMs = timestampMs
                                    val packed = stickersSystem.toUniforms()
                                    renderer.particlePositions = packed.positions
                                    renderer.particleRotations = packed.rotations
                                    renderer.particleLifeRemaining = packed.lifeRemaining
                                    renderer.particleColorIndices = packed.colorIndices
                                    renderer.particleCount = packed.count
                                }

                                if (fireBookSystem != null) {
                                    val prevUpdateTs = lastFireBookUpdateMs
                                    if (prevUpdateTs != null && timestampMs > prevUpdateTs) {
                                        fireBookSystem.update((timestampMs - prevUpdateTs) / 1000f)
                                    }
                                    lastFireBookUpdateMs = timestampMs
                                    val packed = fireBookSystem.toUniforms()
                                    renderer.particlePositions = packed.positions
                                    renderer.particleRotations = packed.rotations
                                    renderer.particleLifeRemaining = packed.lifeRemaining
                                    renderer.particleColorIndices = packed.colorIndices
                                    renderer.particleCount = packed.count
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

                        // MOUTH_WORDS's reactive text — positioned overlay draw,
                        // same drawWatermarkAt reused for a different texture, not
                        // duplicated draw code. mouthWordTextureId/Width/Height are
                        // rebuilt only when the WORD actually changes (see the
                        // face-tracking branch above), not every frame — same
                        // "don't recreate GPU resources needlessly" discipline
                        // section 19 asks for.
                        if (selectedEffect == VisualEffect.MOUTH_WORDS && mouthWordTextureId != 0) {
                            val bubbleLeft = mouthWordAnchorX * width - mouthWordWidthPx / 2f
                            val bubbleTop = mouthWordAnchorY * height - mouthWordHeightPx - (0.03f * height) // sits just above the mouth
                            renderer.drawWatermarkAt(
                                mouthWordTextureId, bubbleLeft, bubbleTop,
                                mouthWordWidthPx, mouthWordHeightPx,
                                width, height
                            )
                        }

                        // ROCK_PAPER_SCISSORS's gesture label — same drawWatermarkAt reuse,
                        // positioned above the detected hand instead of the mouth.
                        if (selectedEffect == VisualEffect.ROCK_PAPER_SCISSORS && rpsTextureId != 0) {
                            val bubbleLeft = rpsAnchorX * width - rpsWidthPx / 2f
                            val bubbleTop = rpsAnchorY * height - rpsHeightPx - (0.05f * height)
                            renderer.drawWatermarkAt(
                                rpsTextureId, bubbleLeft, bubbleTop,
                                rpsWidthPx, rpsHeightPx,
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
        if (mouthWordTextureId != 0) texturesToDelete.add(mouthWordTextureId)
        if (rpsTextureId != 0) texturesToDelete.add(rpsTextureId)
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
