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
* pass — this is what makes an effect visible BEFORE posting, not just after.
*
* Architecture, mirrors VideoTranscoder exactly, source/output swapped:
*   VideoTranscoder:  decoder SurfaceTexture -> FrameRenderer -> encoder input Surface
*   this class:       camera  SurfaceTexture -> FrameRenderer -> screen (SurfaceView)
*
* Same EglCore, same GlUtil, same FrameRenderer.drawEffectFrame() call. Nothing
* about the shaders themselves changes.
*
* KEY DIFFERENCE FROM THE BAKE PATH — tracking mode:
* FaceTracker/SegmentationTracker use RunningMode.VIDEO, which is a blocking
* call meant for sequential, offline processing of a finished file. Calling
* that 30x/sec on a live camera feed would stall the render thread and drop
* frames. Live tracking below uses RunningMode.LIVE_STREAM instead, which is
* async: you feed a frame in, and a callback fires later (maybe 1-3 frames
* later) with the result. That lag is normal — every live-AR app has it, it's
* not a bug to chase here.
*
* NOT YET INCLUDED, to keep this file reviewable — add the same way if needed:
*  - AudioAmplitudeReader hookup for the effects that pulse on mic volume
*    (Voice Halo, Thermal Pulse) — AudioAmplitudeReader already runs
*    independently of video, so just call its existing read into
*    renderer.effectIntensity or wherever each shader expects it, same as
*    VideoTranscoder does.
*
* WIRING INTO REACT NATIVE: this is a plain Android View, not a native module.
* Expose it via a ViewManager (createViewInstance returns
* LiveEffectPreviewView(context)), then from the JS side render it as a host
* component and call setEffect(...)/setFacing(...) through the ref, same
* pattern VisionCamera's own <Camera> component uses. I haven't written that
* bridge file — say the word and I'll do that next, it's a much smaller file
* than this one.
*
* I can't compile or run this in my environment (no Android SDK, no device) —
* treat this as a strong first draft, not a "definitely builds" guarantee.
* Build it, and if logcat shows something specific breaking, send it to me
* and I'll fix that exact line instead of guessing blind.
*/
class LiveEffectPreviewView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : SurfaceView(context), SurfaceHolder.Callback {

    // ---- Public control surface, called from the RN bridge / ViewManager ----

    /** Same VisualEffect enum EffectShaders/FrameRenderer already use — no new effect vocabulary. */
    fun setEffect(effect: VisualEffect) {
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
    // external-OES texture the decoder writes into during baking — FrameRenderer
    // doesn't know or care whether the pixels came from a camera or a video file.
    private var cameraTexId = -1
    private var cameraSurfaceTexture: SurfaceTexture? = null
    private var cameraSurface: Surface? = null
    private val texMatrix = FloatArray(16)

    private var displaySurface: Surface? = null
    private var surfaceW = 0
    private var surfaceH = 0
    private val startTimeNs = System.nanoTime()

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
    // per-device later if it feels laggy — this is a starting number, not a
    // measured one.
    private val trackingIntervalMs = 70L
    private var lastTrackingSubmitMs = 0L

    init {
        holder.addCallback(this)
        // Transparent-capable so this view can sit as an overlay above VisionCamera's
        // own preview if you go that route instead of replacing it outright — your call
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
        cameraTexId = GlUtil.createExternalTexture()
        cameraSurfaceTexture = SurfaceTexture(cameraTexId).apply {
            setDefaultBufferSize(surfaceW.coerceAtLeast(1), surfaceH.coerceAtLeast(1))
            setOnFrameAvailableListener({ drawFrame() }, renderHandler)
        }
        cameraSurface = Surface(cameraSurfaceTexture)

        openCamera()
    }

    private fun setupTrackers() {
        try {
            val faceOptions = FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("face_landmarker.task").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setOutputFaceBlendshapes(true)
                .setResultListener { result, _ -> onFaceResult(result) }
                .setErrorListener { /* transient — next frame will retry, nothing to surface here */ }
                .build()
            liveFaceLandmarker = FaceLandmarker.createFromOptions(context, faceOptions)

            val handOptions = HandLandmarker.HandLandmarkerOptions.builder()
                .setBaseOptions(BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build())
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumHands(2)
                .setResultListener { result, _ -> onHandResult(result) }
                .setErrorListener { }
                .build()
            liveHandLandmarker = HandLandmarker.createFromOptions(context, handOptions)

            // Same segmenter SegmentationTracker uses for baking (selfie_segmenter.tflite,
            // category 1 = person), just in LIVE_STREAM/async mode instead of VIDEO/blocking —
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
            // Model files missing from assets/, or MediaPipe init failed on this device.
            // Live tracking just won't update — base video/color-only effects still render.
            android.util.Log.e("LiveEffectPreview", "tracker init failed", e)
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

    // ---- Render loop (driven by camera's onFrameAvailable, not a fixed timer —
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
        eglC.setPresentationTime(eglS, System.nanoTime())
        eglC.swapBuffers(eglS)

        maybeSubmitForTracking()
    }

    /** Throttled bitmap grab for MediaPipe — see trackingIntervalMs comment above. */
    private fun maybeSubmitForTracking() {
        val now = System.currentTimeMillis()
        if (now - lastTrackingSubmitMs < trackingIntervalMs) return
        lastTrackingSubmitMs = now

        // Reuses the same GlUtil.readPixelsAsBitmap the freeze-frame effect uses —
        // real GPU->CPU cost, which is exactly why this is throttled and not
        // called every render frame.
        val bitmap: Bitmap = try {
            GlUtil.readPixelsAsBitmap(surfaceW, surfaceH)
        } catch (e: Exception) {
            return
        }
        val ts = now
        trackingHandler?.post {
            val mpImage = BitmapImageBuilder(bitmap).build()
            liveFaceLandmarker?.detectAsync(mpImage, ts)
            liveHandLandmarker?.detectAsync(mpImage, ts)
            liveSegmenter?.segmentAsync(mpImage, ts)
        }
    }

    // ---- Async tracking callbacks — cheap, just stash numbers for next drawFrame() ----

    private fun onFaceResult(result: FaceLandmarkerResult) {
        val r = renderer ?: return
        if (result.faceLandmarks().isEmpty()) return
        val landmarks = result.faceLandmarks()[0]
        // Bounding box from raw landmarks — same min/max approach FaceTracker.faceBoundingBox()
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
        renderHandler?.post {
            r.faceBox = floatArrayOf(minX, minY, maxX, maxY)
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
        renderHandler?.post {
            r.portalCenter = floatArrayOf(cx, cy)
        }
    }

    private fun onSegmentationResult(result: ImageSegmenterResult) {
        val r = renderer ?: return
        val categoryMask = result.categoryMask().orElse(null) ?: return
        val w = categoryMask.width
        val h = categoryMask.height

        // Same extraction/rebuild as SegmentationTracker.maskBitmap() in the bake
        // path — MPImage requires going through ByteBufferExtractor, no direct
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
        // calls for DEPTH_BLOOM/SPLIT_PRISM during baking — GL upload must happen
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
