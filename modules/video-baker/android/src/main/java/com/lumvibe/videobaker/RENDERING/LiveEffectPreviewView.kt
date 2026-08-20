package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.os.Handler
import android.os.HandlerThread
import android.util.AttributeSet
import android.util.Size
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenterResult
import com.google.mediapipe.framework.image.ByteBufferExtractor
import java.nio.ByteBuffer
import com.google.mediapipe.framework.image.BitmapImageBuilder

/**
* Live camera preview with the SAME effect shaders as VideoTranscoder's bake
* pass  -  this is what makes an effect visible BEFORE posting, not just after.
*
* Architecture, mirrors VideoTranscoder exactly, source/output swapped:
*   VideoTranscoder:  decoder SurfaceTexture -> FrameRenderer -> encoder input Surface
*   this class:       camera  SurfaceTexture -> FrameRenderer -> screen (SurfaceView)
*
* Same EglCore, same GlUtil, same FrameRenderer.drawEffectFrame() call. Nothing
* about the shaders themselves changes.
*
* KEY DIFFERENCE FROM THE BAKE PATH  -  tracking mode:
* FaceTracker/SegmentationTracker use RunningMode.VIDEO, which is a blocking
* call meant for sequential, offline processing of a finished file. Calling
* that 30x/sec on a live camera feed would stall the render thread and drop
* frames. Live tracking below uses RunningMode.LIVE_STREAM instead, which is
* async: you feed a frame in, and a callback fires later (maybe 1-3 frames
* later) with the result. That lag is normal  -  every live-AR app has it, it's
* not a bug to chase here.
*
* NOT YET INCLUDED, to keep this file reviewable  -  add the same way if needed:
*  - AudioAmplitudeReader hookup for the effects that pulse on mic volume
*    (Voice Halo, Thermal Pulse)  -  AudioAmplitudeReader already runs
*    independently of video, so just call its existing read into
*    renderer.effectIntensity or wherever each shader expects it, same as
*    VideoTranscoder does.
*
* WIRING INTO REACT NATIVE: this is a plain Android View, not a native module.
* Expose it via a ViewManager (createViewInstance returns
* LiveEffectPreviewView(context)), then from the JS side render it as a host
* component and call setEffect(...)/setFacing(...) through the ref, same
* pattern VisionCamera's own <Camera> component uses. I haven't written that
* bridge file  -  say the word and I'll do that next, it's a much smaller file
* than this one.
*
* I can't compile or run this in my environment (no Android SDK, no device)  -
* treat this as a strong first draft, not a "definitely builds" guarantee.
* Build it, and if logcat shows something specific breaking, send it to me
* and I'll fix that exact line instead of guessing blind.
*/
class LiveEffectPreviewView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : SurfaceView(context), SurfaceHolder.Callback {

    // ---- Public control surface, called from the RN bridge / ViewManager ----

    // Whatever effect was last requested, even if it arrived before renderer
    // existed  -  applied in setupEgl() once the renderer is actually created.
    // Fixes a real race: Expo's Prop setter can call setEffect() synchronously
    // right after view creation, well before surfaceCreated()/setupEgl() have
    // run  -  without this, that first selection silently no-ops and the effect
    // never reaches the renderer at all.
    private var pendingEffect: VisualEffect = VisualEffect.NONE

    /** Same VisualEffect enum EffectShaders/FrameRenderer already use  -  no new effect vocabulary. */
    fun setEffect(effect: VisualEffect) {
        pendingEffect = effect
        renderHandler?.post { renderer?.setEffect(effect) }
    }

    fun setFacing(facing: String) {
        pendingFacing = if (facing == "front") CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
        renderHandler?.post { reopenCamera() }
    }

    // ---- Render thread + EGL ----

    private var renderThread: HandlerThread? = null
    private var renderHandler: Handler? = null
    private var eglCore: EglCore? = null
    private var eglSurface: android.opengl.EGLSurface? = null
    private var renderer: FrameRenderer? = null

    // Offscreen texture the camera writes into. This is the SAME kind of
    // external-OES texture the decoder writes into during baking  -  FrameRenderer
    // doesn't know or care whether the pixels came from a camera or a video file.
    private var cameraTexId = -1
    private var cameraSurfaceTexture: SurfaceTexture? = null
    private var cameraSurface: Surface? = null
    private val texMatrix = FloatArray(16)

    private var displaySurface: Surface? = null
    private var surfaceW = 0
    private var surfaceH = 0
    private val startTimeNs = System.nanoTime()

    // ---- Recording (see LiveRecorder.kt for why this is a separate class) ----
    private var liveRecorder: LiveRecorder? = null
    private var encoderEglSurface: android.opengl.EGLSurface? = null

    // ---- Camera2 ----

    private var cameraManager: CameraManager? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var cameraThread: HandlerThread? = null
    private var cameraHandler: Handler? = null
    private var pendingFacing = CameraCharacteristics.LENS_FACING_FRONT

    // ---- Live tracking ----

    private var trackingThread: HandlerThread? = null
    private var trackingHandler: Handler? = null
    private var liveFaceLandmarker: FaceLandmarker? = null
    private var liveHandLandmarker: HandLandmarker? = null
    private var liveSegmenter: ImageSegmenter? = null
    // How often we hand a frame to MediaPipe, independent of the 30fps render
    // loop. Running full face+hand inference every render frame is more than
    // most mid-range Android GPUs/NPUs keep up with smoothly; 12-15fps tracking
    // is visually smooth enough for hue shifts, halos, portals etc. Tune this
    // per-device later if it feels laggy  -  this is a starting number, not a
    // measured one.
    private val trackingIntervalMs = 70L
    private var lastTrackingSubmitMs = 0L
    // FIX: COLOR_DRAIN/SPLIT_PRISM had no motion-detection in the live path at
    // all (VideoTranscoder's frame-to-frame luma-delta trick, which they both
    // depend on, was never replicated here) - meaning both looked completely
    // static live, only actually working once baked. PAINT_SPLASH needs the
    // exact same signal, so fixing this covers all three. Mirrors
    // VideoTranscoder's lastAvgLuma/stillnessAccumSec exactly, just as class
    // fields here since this view's functions are called repeatedly rather
    // than being one long-lived closure like VideoTranscoder.transcode().
    private var lastAvgLuma: Float? = null
    private var stillnessAccumSec = 0f
    private val stillnessEffects = setOf(VisualEffect.COLOR_DRAIN)
    private val motionEffects = setOf(VisualEffect.SPLIT_PRISM, VisualEffect.PAINT_SPLASH)
    // FIX: GAZE_TRAIL had this exact live-preview gap too (no case in
    // onFaceResult, so it showed no trail live even though it baked
    // correctly). Fixed using FaceTracker.kt's own verified iris indices
    // (468 left / 473 right, from the refined 478-point mesh) - see
    // onFaceResult's GAZE_TRAIL case below.
    private val gazeHistory = ArrayDeque<Pair<Float, Float>>()
    private val fingerHistory = ArrayDeque<Pair<Float, Float>>()

    init {
        holder.addCallback(this)
        // Transparent-capable so this view can sit as an overlay above VisionCamera's
        // own preview if you go that route instead of replacing it outright  -  your call
        // once you see how it looks on device.
        holder.setFormat(android.graphics.PixelFormat.TRANSLUCENT)
    }

    // ---- SurfaceHolder.Callback ----

    override fun surfaceCreated(holder: SurfaceHolder) {
        displaySurface = holder.surface
        startRenderThread()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        surfaceW = width
        surfaceH = height
        renderHandler?.post { setupEgl() }
    }

    override fun surfaceDestroyed(holder: SurfaceHolder) {
        stopEverything()
    }

    // ---- Setup ----

    private fun startRenderThread() {
        renderThread = HandlerThread("LiveEffectRender").also { it.start() }
        renderHandler = Handler(renderThread!!.looper)

        trackingThread = HandlerThread("LiveEffectTracking").also { it.start() }
        trackingHandler = Handler(trackingThread!!.looper)

        cameraThread = HandlerThread("LiveEffectCamera").also { it.start() }
        cameraHandler = Handler(cameraThread!!.looper)

        renderHandler?.post {
            setupTrackers()
        }
    }

    private fun setupEgl() {
        val surface = displaySurface ?: return
        eglCore = EglCore()
        eglSurface = eglCore!!.createWindowSurface(surface)
        eglCore!!.makeCurrent(eglSurface!!)

        renderer = FrameRenderer().apply { setup() }
        // ROOT CAUSE FIX: VideoTranscoder (bake/compose path) always calls
        // ensureSecondaryTexture() right here, immediately after setup() -- this line
        // was simply missing on the live-preview path. Without it, secondaryTextureId
        // stays 0 (no real GL texture object) until the first async segmentation/hand
        // result lands. drawEffectFrame() binds and samples it the instant an effect
        // needing it is selected (GOLD_SKIN, THERMAL_PULSE, DEPTH_BLOOM, SPLIT_PRISM,
        // HAND_PORTAL, FIRE_BOOK), so for however many frames land before that first
        // async callback, the shader was sampling an unbound texture id -- undefined
        // behavior that this device's GPU driver renders as solid black, and on some
        // drivers leaves the pipeline in a state that never recovers even after
        // switching effects. Creating the (empty but valid) texture object up front
        // means the mask simply reads as "no effect yet" for those first few frames
        // instead of corrupting the pipeline.
        renderer?.ensureSecondaryTexture()
        // Apply whatever effect was requested before the renderer existed  -  see
        // pendingEffect's doc for why this line is the actual fix, not just belt-and-braces.
        renderer?.setEffect(pendingEffect)
        cameraTexId = GlUtil.createExternalTexture()
        cameraSurfaceTexture = SurfaceTexture(cameraTexId).apply {
            setDefaultBufferSize(surfaceW.coerceAtLeast(1), surfaceH.coerceAtLeast(1))
            setOnFrameAvailableListener({ drawFrame() }, renderHandler)
        }
        cameraSurface = Surface(cameraSurfaceTexture)

        openCamera()
    }

    private fun setupTrackers() {
        // FIX: each tracker now gets its OWN try/catch. Previously all three were
        // built inside one shared try/catch, in sequence (face, then hand, then
        // segmentation) -- if hand or segmentation threw during init, the
        // exception aborted everything after it in the block, but face (built
        // first) had already succeeded. Result: face-tracking effects worked,
        // hand and segmentation effects silently never tracked, indefinitely,
        // with zero visible sign of failure (Log.e alone doesn't surface in a
        // normal build). That symptom pattern is exactly what was reported.
        // Isolating each one means a failure in any single tracker can no
        // longer take the other two down with it.
        try {
            val faceOptions = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("face_landmarker.task").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setOutputFaceBlendshapes(true)
                .setResultListener { result, _ -> onFaceResult(result) }
                .setErrorListener { /* transient  -  next frame will retry, nothing to surface here */ }
                .build()
            liveFaceLandmarker = FaceLandmarker.createFromOptions(context, faceOptions)
        } catch (e: Exception) {
            android.util.Log.e("LiveEffectPreview", "face tracker init failed - is face_landmarker.task in app/src/main/assets/?", e)
        }

        try {
            val handOptions = HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumHands(2)
                .setResultListener { result, _ -> onHandResult(result) }
                .setErrorListener { }
                .build()
            liveHandLandmarker = HandLandmarker.createFromOptions(context, handOptions)
        } catch (e: Exception) {
            android.util.Log.e("LiveEffectPreview", "hand tracker init failed - is hand_landmarker.task in app/src/main/assets/?", e)
        }

        try {
            // Same segmenter SegmentationTracker uses for baking (selfie_segmenter.tflite,
            // category 1 = person), just in LIVE_STREAM/async mode instead of VIDEO/blocking  -
            // same reasoning as face/hand above. This is the heaviest of the three trackers
            // (SegmentationTracker's own comment flags it as "noticeably heavier per-frame"
            // even in the offline bake path), so it rides the same trackingIntervalMs throttle
            // as face/hand rather than getting its own separate, faster one.
            val segOptions = ImageSegmenter.ImageSegmenterOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("selfie_segmenter.tflite").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setOutputCategoryMask(true)
                .setOutputConfidenceMasks(false)
                .setResultListener { result, image -> onSegmentationResult(result) }
                .setErrorListener { }
                .build()
            liveSegmenter = ImageSegmenter.createFromOptions(context, segOptions)
        } catch (e: Exception) {
            android.util.Log.e("LiveEffectPreview", "segmentation tracker init failed - is selfie_segmenter.tflite in app/src/main/assets/?", e)
        }
    }

    // ---- Camera2 ----

    private fun openCamera() {
        cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val camId = findCameraId(pendingFacing) ?: return
        try {
            @Suppress("MissingPermission") // caller's RN layer must have already requested CAMERA permission
            cameraManager!!.openCamera(camId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    startCaptureSession(device)
                }
                override fun onDisconnected(device: CameraDevice) { device.close() }
                override fun onError(device: CameraDevice, error: Int) { device.close() }
            }, cameraHandler)
        } catch (e: SecurityException) {
            android.util.Log.e("LiveEffectPreview", "camera permission missing", e)
        }
    }

    private fun findCameraId(facing: Int): String? {
        val mgr = cameraManager ?: return null
        return mgr.cameraIdList.firstOrNull {
            mgr.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == facing
        }
    }

    private fun startCaptureSession(device: CameraDevice) {
        val target = cameraSurface ?: return
        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
        builder.addTarget(target)

        device.createCaptureSession(listOf(target), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) {
                captureSession = session
                session.setRepeatingRequest(builder.build(), null, cameraHandler)
            }
            override fun onConfigureFailed(session: CameraCaptureSession) {
                android.util.Log.e("LiveEffectPreview", "capture session config failed")
            }
        }, cameraHandler)
    }

    private fun reopenCamera() {
        captureSession?.close()
        cameraDevice?.close()
        captureSession = null
        cameraDevice = null
        openCamera()
    }

    // ---- Render loop (driven by camera's onFrameAvailable, not a fixed timer  -
    //      matches whatever FPS the camera actually delivers) ----

    private fun drawFrame() {
        val eglC = eglCore ?: return
        val eglS = eglSurface ?: return
        val r = renderer ?: return
        val tex = cameraSurfaceTexture ?: return

        eglC.makeCurrent(eglS)
        tex.updateTexImage()
        tex.getTransformMatrix(texMatrix)

        val elapsedSec = (System.nanoTime() - startTimeNs) / 1_000_000_000f
        r.drawEffectFrame(cameraTexId, texMatrix, elapsedSec)

        // FIX: must read pixels for tracking BEFORE swapBuffers, not after  -  on
        // most EGL drivers the back buffer's contents become UNDEFINED right
        // after a swap (no EGL_BUFFER_PRESERVED here), so reading post-swap risks
        // grabbing garbage or a blank frame. That silently starves MediaPipe of
        // real input, which is a very plausible reason face/hand tracking looked
        // like it "wasn't working"  -  the frames it was fed may not have been the
        // frames actually on screen.
        maybeSubmitForTracking()

        eglC.setPresentationTime(eglS, System.nanoTime())
        eglC.swapBuffers(eglS)

        // FIX (live-effect recording): if a recording is in progress, draw the
        // SAME frame again to the encoder's input surface. Deliberately placed
        // here, after the display draw/swap above is fully complete, so none
        // of the tracking/display logic above is touched or risked - this is
        // pure addition. The next drawFrame() call re-selects the display
        // surface at its very top (eglC.makeCurrent(eglS) above), so there's
        // no need to restore it here before returning.
        val rec = liveRecorder
        val encSurface = encoderEglSurface
        if (rec != null && rec.isRecording && encSurface != null) {
            eglC.makeCurrent(encSurface)
            r.drawEffectFrame(cameraTexId, texMatrix, elapsedSec)
            eglC.setPresentationTime(encSurface, System.nanoTime())
            eglC.swapBuffers(encSurface)
            rec.drainVideo(endOfStream = false)
        }
    }

    /**
     * Starts recording the live effect to an actual video file - called from
     * LiveEffectPreviewModule.kt. Must be called from the render thread (the
     * caller wraps this in renderHandler?.post {} - see that module for why).
     * outputWidth/outputHeight should match the camera's actual capture size
     * (surfaceW/surfaceH) so the encoder and the live GL rendering agree on
     * dimensions.
     */
    fun startRecording(videoOnlyPath: String, pcmPath: String) {
        val eglC = eglCore ?: return
        if (liveRecorder?.isRecording == true) return // already recording, ignore
        val w = if (surfaceW > 0) surfaceW else 720
        val h = if (surfaceH > 0) surfaceH else 1280
        val rec = LiveRecorder(w, h, videoOnlyPath, pcmPath)
        val inputSurface = rec.startVideo()
        encoderEglSurface = eglC.createWindowSurface(inputSurface)
        rec.startAudio()
        liveRecorder = rec
    }

    /**
     * Stops recording and produces the final playable file. Returns the final
     * output path via [onFinished] - split into two steps internally (see
     * LiveRecorder.stop()/finalizeRecording() docs) so the fast part happens
     * immediately and the slightly-slower audio-encode+combine step doesn't
     * block anything on the render thread. [onFinished] is called on
     * whatever thread finalizeRecording() actually runs on - the caller
     * (LiveEffectPreviewModule.kt) is responsible for hopping back to the
     * correct thread if needed, same as it already does for other results.
     */
    fun stopRecording(finalOutputPath: String, onFinished: (String) -> Unit) {
        val rec = liveRecorder ?: run { onFinished(finalOutputPath); return }
        rec.stop()
        encoderEglSurface?.let { eglCore?.releaseSurface(it) }
        encoderEglSurface = null
        liveRecorder = null
        // finalizeRecording() does real (if brief) file I/O and MediaCodec
        // work - explicitly off the render thread so it can't jank the next
        // preview frame while it runs.
        Thread {
            val result = rec.finalizeRecording(finalOutputPath)
            onFinished(result)
        }.start()
    }

    /** Throttled bitmap grab for MediaPipe  -  see trackingIntervalMs comment above. */
    private fun maybeSubmitForTracking() {
        // PERF FIX: this used to submit to face+hand+segmentation EVERY throttled
        // tick regardless of the selected effect  -  meaning a pure-shader effect
        // like Neon Edge (which EffectRequirements says needs none of the three)
        // was still paying for all three MediaPipe inferences every ~70ms, for
        // no visual benefit at all. Gate each detectAsync/segmentAsync call to
        // only the tracker(s) EffectRequirements says the CURRENT effect
        // actually needs  -  same gating VideoTranscoder already does correctly
        // for the bake path, just missing here until now.
        val effect = renderer?.currentEffect ?: VisualEffect.NONE
        val wantsFace = EffectRequirements.needsFaceTracker(effect)
        val wantsHand = EffectRequirements.needsHandTracker(effect)
        val wantsSeg = EffectRequirements.needsSegmentation(effect)
        val wantsMotion = effect in stillnessEffects || effect in motionEffects
        if (!wantsFace && !wantsHand && !wantsSeg && !wantsMotion) return

        val now = System.currentTimeMillis()
        if (now - lastTrackingSubmitMs < trackingIntervalMs) return
        lastTrackingSubmitMs = now

        // Reuses the same GlUtil.readPixelsAsBitmap the freeze-frame effect uses  -
        // real GPU->CPU cost, which is exactly why this is throttled and not
        // called every render frame. Must read at the FULL framebuffer size  -
        // readPixelsAsBitmap(w,h) reads a WxH region at 1:1, it doesn't scale, so
        // passing a smaller size would just read a cropped corner, not a
        // downscaled frame. Scale down AFTER reading instead, since MediaPipe's
        // face/hand/segmentation models resize to a small fixed input internally
        // anyway (roughly 192-256px)  -  feeding them a full 1080p+ bitmap wastes
        // CPU on detail the model throws away immediately. Capping the longer
        // edge at 320px cuts that wasted work with no meaningful accuracy loss
        // for this use case (visual effects, not precision measurement).
        val fullBitmap: Bitmap = try {
            GlUtil.readPixelsAsBitmap(surfaceW, surfaceH)
        } catch (e: Exception) {
            return
        }
        val scale = 320f / maxOf(fullBitmap.width, fullBitmap.height).coerceAtLeast(1)
        val bitmap = if (scale < 1f) {
            Bitmap.createScaledBitmap(fullBitmap, (fullBitmap.width * scale).toInt().coerceAtLeast(1), (fullBitmap.height * scale).toInt().coerceAtLeast(1), true).also {
                fullBitmap.recycle()
            }
        } else fullBitmap
        // Motion-driven effects (COLOR_DRAIN/SPLIT_PRISM/PAINT_SPLASH) don't need
        // MediaPipe at all - just this frame's average brightness vs last frame's,
        // same averageLuma() trick VideoTranscoder uses. Safe to set
        // renderer.effectIntensity directly (not via renderHandler.post) since
        // this whole function already runs on the render thread - see
        // setOnFrameAvailableListener(..., renderHandler) where drawFrame()
        // (which calls this) is registered.
        if (wantsMotion) {
            val luma = averageLuma(bitmap)
            val frameDur = trackingIntervalMs / 1000f
            val delta = if (lastAvgLuma != null) kotlin.math.abs(luma - lastAvgLuma!!) else 0f
            if (effect in stillnessEffects) {
                if (delta > 0.01f) stillnessAccumSec = 0f else stillnessAccumSec += frameDur
                renderer?.effectIntensity = (stillnessAccumSec / 3f).coerceIn(0f, 1f)
            } else {
                renderer?.effectIntensity = (delta / 0.05f).coerceIn(0f, 1f)
            }
            lastAvgLuma = luma
        }
        val ts = now
        trackingHandler?.post {
            val mpImage = BitmapImageBuilder(bitmap).build()
            if (wantsFace) liveFaceLandmarker?.detectAsync(mpImage, ts)
            if (wantsHand) liveHandLandmarker?.detectAsync(mpImage, ts)
            if (wantsSeg) liveSegmenter?.segmentAsync(mpImage, ts)
        }
    }

    /** Same downsample-then-average approach as VideoTranscoder.averageLuma() - kept
     * identical on purpose so live and baked motion response feel the same. */
    private fun averageLuma(bitmap: Bitmap): Float {
        val small = Bitmap.createScaledBitmap(bitmap, 32, 32, true)
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

    // ---- Async tracking callbacks  -  cheap, just stash numbers for next drawFrame() ----

    private fun onFaceResult(result: FaceLandmarkerResult) {
        val r = renderer ?: return
        if (result.faceLandmarks().isEmpty()) return
        val landmarks = result.faceLandmarks()[0]
        // Bounding box from raw landmarks  -  same min/max approach FaceTracker.faceBoundingBox()
        // uses in the bake path; duplicated here rather than shared because FaceTracker's
        // version is a private instance method tied to VIDEO-mode results. Worth factoring
        // both into a shared top-level function later so this logic only lives in one place.
        var minX = 1f; var minY = 1f; var maxX = 0f; var maxY = 0f
        for (lm in landmarks) {
            if (lm.x() < minX) minX = lm.x()
            if (lm.y() < minY) minY = lm.y()
            if (lm.x() > maxX) maxX = lm.x()
            if (lm.y() > maxY) maxY = lm.y()
        }

        // Blendshape-driven effects  -  same scores/thresholds VideoTranscoder computes
        // in the bake path (see its faceScoreEffects/mouthEffects when-branches), just
        // gated per-effect here so effectIntensity (shared across all of them) never
        // gets clobbered by a score meant for a different effect. Only fetch
        // faceBlendshapes() once, when actually needed  -  it's not free.
        var intensityOverride: Float? = null
        var mouthX = 0.5f
        var mouthY = 0.6f
        var mouthUpdated = false
        when (r.currentEffect) {
            VisualEffect.MOOD_RING, VisualEffect.SMILE_SHATTER -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                val left = shapes?.firstOrNull { it.categoryName() == "mouthSmileLeft" }?.score() ?: 0f
                val right = shapes?.firstOrNull { it.categoryName() == "mouthSmileRight" }?.score() ?: 0f
                intensityOverride = maxOf(left, right)
            }
            VisualEffect.WINK_SPARK -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                val left = shapes?.firstOrNull { it.categoryName() == "eyeBlinkLeft" }?.score() ?: 0f
                val right = shapes?.firstOrNull { it.categoryName() == "eyeBlinkRight" }?.score() ?: 0f
                // Same "clean single-eye wink" gate VideoTranscoder uses  -  plain
                // |L - R| would also fire on a full double-blink.
                intensityOverride = when {
                    left > 0.6f && right < 0.3f -> left
                    right > 0.6f && left < 0.3f -> right
                    else -> 0f
                }
            }
            VisualEffect.MOUTH_FIRE -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                intensityOverride = shapes?.firstOrNull { it.categoryName() == "jawOpen" }?.score() ?: 0f
                // Same landmark 13/14 midpoint FaceTracker.mouthCenter() uses in the
                // bake path  -  see that method's doc for why 13/14 are safe here.
                if (landmarks.size > 14) {
                    val upper = landmarks[13]
                    val lower = landmarks[14]
                    mouthX = (upper.x() + lower.x()) / 2f
                    mouthY = (upper.y() + lower.y()) / 2f
                    mouthUpdated = true
                }
            }
            else -> {}
        }

        // GAZE_TRAIL  -  outside the when() above (not blendshape-driven, doesn't
        // touch intensityOverride) since it needs its own multi-value payload
        // (points/ages/count), same reason FINGER_DRAW is handled separately in
        // onHandResult rather than folded into that function's single cx/cy/angle
        // path. Landmarks 468 (left iris) / 473 (right iris) and the >473 size
        // guard match FaceTracker.irisCenter() exactly (see that method's doc for
        // why the guard matters - the base 468-point mesh doesn't include these).
        var gazeFlat: FloatArray? = null
        var gazeAgesArr: FloatArray? = null
        var gazeCountVal = 0
        if (r.currentEffect == VisualEffect.GAZE_TRAIL && landmarks.size > 473) {
            val left = landmarks[468]
            val right = landmarks[473]
            val ix = (left.x() + right.x()) / 2f
            val iy = (left.y() + right.y()) / 2f
            gazeHistory.addFirst(Pair(ix, iy))
            while (gazeHistory.size > 8) gazeHistory.removeLast()
            val flat = FloatArray(16)
            val ages = FloatArray(8)
            gazeHistory.forEachIndexed { i, (x, y) ->
                flat[i * 2] = x; flat[i * 2 + 1] = y
                ages[i] = i / 8f
            }
            gazeFlat = flat
            gazeAgesArr = ages
            gazeCountVal = gazeHistory.size
        }

        renderHandler?.post {
            r.faceBox = floatArrayOf(minX, minY, maxX, maxY)
            intensityOverride?.let { r.effectIntensity = it }
            if (mouthUpdated) r.mouthCenter = floatArrayOf(mouthX, mouthY)
            if (gazeFlat != null) {
                r.gazePoints = gazeFlat
                r.gazeAges = gazeAgesArr!!
                r.gazeCount = gazeCountVal
            }
        }
    }

    private fun onHandResult(result: HandLandmarkerResult) {
        val r = renderer ?: return
        if (result.landmarks().isEmpty()) return
        val hand = result.landmarks()[0]
        // Palm center ~= average of wrist(0) + index MCP(5) + pinky MCP(17),
        // same landmark indices HandTracker.palmCenter() already uses.
        val cx = (hand[0].x() + hand[5].x() + hand[17].x()) / 3f
        val cy = (hand[0].y() + hand[5].y() + hand[17].y()) / 3f
        // NEW: wrist(0)->index-MCP(5) angle, same convention/indices as
        // HandTracker.handAngle() in the bake path  -  used by FIRE_BOOK to
        // tilt the book quad to match the hand live, not just after baking.
        val angle = kotlin.math.atan2(hand[5].y() - hand[0].y(), hand[5].x() - hand[0].x())
        // FINGER_DRAW: index fingertip = landmark 8, same numbering
        // VideoTranscoder's FINGER_DRAW case uses. Built here in onHandResult
        // (not renderHandler.post below) since ArrayDeque mutation doesn't
        // touch GL state and doesn't need the render thread; only the
        // renderer.fingerPoints/Ages/Count assignment does.
        var fingerFlat: FloatArray? = null
        var fingerAgesArr: FloatArray? = null
        var fingerCountVal = 0
        if (r.currentEffect == VisualEffect.FINGER_DRAW && hand.size > 8) {
            val tip = hand[8]
            fingerHistory.addFirst(Pair(tip.x(), tip.y()))
            while (fingerHistory.size > 8) fingerHistory.removeLast()
            val flat = FloatArray(16)
            val ages = FloatArray(8)
            fingerHistory.forEachIndexed { i, (x, y) ->
                flat[i * 2] = x; flat[i * 2 + 1] = y
                ages[i] = i / 8f
            }
            fingerFlat = flat
            fingerAgesArr = ages
            fingerCountVal = fingerHistory.size
        }
        renderHandler?.post {
            r.portalCenter = floatArrayOf(cx, cy)
            r.portalAngle = angle
            if (fingerFlat != null) {
                r.fingerPoints = fingerFlat
                r.fingerAges = fingerAgesArr!!
                r.fingerCount = fingerCountVal
            }
        }
    }

    private fun onSegmentationResult(result: ImageSegmenterResult) {
        val r = renderer ?: return
        val categoryMask = result.categoryMask().orElse(null) ?: return
        val w = categoryMask.width
        val h = categoryMask.height

        // Same extraction/rebuild as SegmentationTracker.maskBitmap() in the bake
        // path  -  MPImage requires going through ByteBufferExtractor, no direct
        // pixel property. Category 1 = person per selfie_segmenter's label map.
        val maskBuffer: ByteBuffer = ByteBufferExtractor.extract(categoryMask)
        maskBuffer.rewind()
        val mask = Bitmap.createBitmap(w, h, Bitmap.Config.ALPHA_8)
        val outBuffer = ByteBuffer.allocate(w * h)
        for (i in 0 until w * h) {
            val category = maskBuffer.get(i).toInt() and 0xFF
            outBuffer.put(i, if (category == 1) 0xFF.toByte() else 0x00.toByte())
        }
        outBuffer.rewind()
        mask.copyPixelsFromBuffer(outBuffer)

        // uploadSecondaryTexture is the SAME FrameRenderer method VideoTranscoder
        // calls for DEPTH_BLOOM/SPLIT_PRISM during baking  -  GL upload must happen
        // on the render thread since it touches the current EGL context, so hop
        // over via renderHandler rather than uploading from this tracking-thread
        // callback directly.
        renderHandler?.post {
            r.uploadSecondaryTexture(mask)
            mask.recycle()
        }
    }

    // ---- Teardown ----

    private fun stopEverything() {
        renderHandler?.post {
            // FIX: if the view is torn down mid-recording (user backs out of
            // the camera screen while recording, for example), stop the
            // recorder here too so its encoder/muxer/audio thread don't leak.
            // Not calling finalizeRecording()'s post-process step here - if
            // the view is being destroyed, nobody's waiting for a result.
            liveRecorder?.let { rec ->
                if (rec.isRecording) rec.stop()
                encoderEglSurface?.let { eglCore?.releaseSurface(it) }
                encoderEglSurface = null
                liveRecorder = null
            }
            captureSession?.close()
            cameraDevice?.close()
            cameraSurface?.release()
            cameraSurfaceTexture?.release()
            eglSurface?.let { eglCore?.releaseSurface(it) }
            eglCore?.release()
        }
        liveFaceLandmarker?.close()
        liveHandLandmarker?.close()
        liveSegmenter?.close()
        cameraThread?.quitSafely()
        trackingThread?.quitSafely()
        renderThread?.quitSafely()
    }
}   
