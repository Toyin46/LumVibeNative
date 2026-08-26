package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.opengl.GLES20
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

    // NEW: Two Hand Frame auto-capture. FIX: originally used expo-modules-
    // kotlin's EventDispatcher property delegate, but checked against Expo's
    // own documentation/examples and every one of them requires the
    // enclosing class to extend ExpoView(context, appContext) - this class
    // extends plain SurfaceView(context), so that was a real, confirmed
    // mismatch, not a hypothetical risk. Replaced with a plain callback field
    // instead; LiveEffectPreviewModule.kt wires it to sendEvent(), which only
    // needs appContext (already proven accessible/working in that file's
    // AsyncFunctions) and carries no ExpoView requirement at all.
    var onFrameCapturedListener: ((Map<String, String>) -> Unit)? = null

    // NEW: Two Hand Frame auto-capture handoff. FIX: originally read pixels via
    // its own separately-queued renderHandler.post call, which could run AFTER
    // a swap - the exact "back buffer contents undefined post-swap" trap
    // already documented and fixed for tracking readback below. This is now
    // just a flag; the actual read happens at drawFrame's one safe pre-swap
    // point (see the pendingPhotoCapturePath check there).
    @Volatile private var pendingPhotoCapturePath: String? = null
    // NEW: JS-initiated capture (Photo mode's shutter button) needs to await
    // an actual result, unlike the gesture-triggered path above which just
    // fires an event. Same underlying read, just also resolves/rejects this
    // when present, instead of only emitting onFrameCaptured.
    @Volatile private var pendingPhotoCapturePromise: expo.modules.kotlin.Promise? = null

    private fun capturePhotoAndEmit(outputPath: String) {
        pendingPhotoCapturePath = outputPath
    }

    /** JS-initiated single-photo capture, used by Photo mode's shutter button
     * when a GL effect is active (the regular Camera component isn't mounted
     * in that case, so its own takePhoto() can't be used - see create.tsx's
     * handleTakePhoto for the full story on why this exists). */
    fun capturePhotoNow(outputPath: String, promise: expo.modules.kotlin.Promise) {
        pendingPhotoCapturePath = outputPath
        pendingPhotoCapturePromise = promise
    }

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
    // FIX (EGL crash): remembers what setupEgl() last actually built for, so a
    // repeat surfaceChanged() call with the identical surface/size can be
    // recognized as a genuine no-op instead of tearing everything down and
    // rebuilding for no reason.
    private var setupSurface: Surface? = null
    private var setupW = 0
    private var setupH = 0
    // FIX (real root cause of the eglMakeCurrent crash from device testing):
    // openCamera()'s callbacks (onOpened, onConfigured) run on cameraHandler's
    // OWN thread, fully async, with zero coordination against setupEgl()/
    // teardownEgl() on renderHandler's thread. If a resize/rotation triggers
    // a second setupEgl() cycle while the FIRST camera is still mid-opening,
    // that stale callback can land AFTER teardown has already moved on -
    // assigning a now-irrelevant camera device into live fields and racing
    // against the new EGL surface. My earlier fix (the no-op guard + full
    // teardown-before-rebuild above) closed the "double-create without
    // releasing" problem, but not this one - this is a genuinely different
    // race. Standard fix for this exact class of Camera2 bug: a monotonic
    // generation counter. Every real setupEgl() cycle gets its own id;
    // any async camera callback that fires after a newer cycle has already
    // started checks its stamped generation against the current one and
    // discards itself if stale, instead of touching shared state.
    @Volatile private var setupGeneration = 0

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
    // FIX: VOICE_HALO/THERMAL_PULSE/DEPTH_BLOOM had NOTHING feeding them live -
    // AudioAmplitudeReader.kt only decodes a FINISHED file (analyze(inputPath)),
    // it has no live-microphone mode, so on live camera these three effects sat
    // at whatever default effectIntensity happened to be, permanently flat. New
    // LiveAudioReader.kt is a real AudioRecord mic tap for this path specifically.
    private var liveAudioReader: LiveAudioReader? = null
    // FIX: initial pass only caught 3 of what should have been 5 audio-driven
    // effects - AURA_GLOW and SILENCE_RIPPLE were missed entirely (they don't
    // crash or look obviously broken since faceBox still gets set generically,
    // so their flatness is easy to miss without checking VideoTranscoder's
    // audioScoreEffects/silenceEffects sets directly, which is what caught
    // this). SILENCE_RIPPLE is inverted - VideoTranscoder uses 1-amplitude for
    // it specifically (intensifies as things go QUIET, opposite of the other
    // four), split into its own set rather than lumped in with the rest.
    private val audioDirectEffects = setOf(VisualEffect.VOICE_HALO, VisualEffect.THERMAL_PULSE, VisualEffect.DEPTH_BLOOM, VisualEffect.AURA_GLOW)
    private val audioInvertedEffects = setOf(VisualEffect.SILENCE_RIPPLE)
    // FIX: DOUBLE_TAKE was a hardcoded no-op even live, on the reasoning that "a
    // still photo has no motion" - true for the bake path, false here, since live
    // camera genuinely has consecutive frames. Real yaw-delta history, same
    // pattern as gazeHistory/fingerHistory above.
    private var lastYawDeg: Float? = null
    // FIX: BLINK_FREEZE never triggered live at all - captureFreezeFrame()/
    // drawFrozenFrame() exist in FrameRenderer and work correctly, but nothing
    // in the live path ever called them. Same hold-state/duration/punch-curve
    // as VideoTranscoder's bake-path implementation, just keyed to wall-clock
    // elapsedSec instead of presentationTimeUs since there's no decoded
    // timeline here, only the live camera's own clock.
    @Volatile private var freezeActive = false
    private var freezeStartSec = 0f
    private val freezeDurationSec = 0.3f
    // FIX: hand-gesture effects state. onHandResult previously only ever read
    // result.landmarks()[0] even though the tracker is configured for 2 hands
    // (setNumHands(2)) - TWO_HAND_FRAME and CLAP_BURST structurally cannot
    // work without both hands' positions, so that discarded second hand was
    // the actual root cause for both, not a tuning issue.
    private val BOOM_DECAY_PER_SEC = 4.87f // same constant/reasoning as VideoTranscoder's
    @Volatile private var boomEnergy = 0f
    @Volatile private var clapBoomEnergy = 0f
    @Volatile private var tapBoomEnergy = 0f
    private var lastFrameTimeNs = 0L
    private var lastPalmPos: Pair<Float, Float>? = null
    private var lastPalmTimeMs: Long? = null
    private var confettiCooldown = false
    private var lastTapFingerPos: Triple<Float, Float, Float>? = null
    private var lastTapTimeMs: Long? = null
    private var tapCooldown = false
    private var lastClapDistance: Float? = null
    private var clapCooldown = false
    // FIX: FIST_BUMP_BOOM was missing this entirely (unlike its siblings
    // CLAP_BURST/TAP_SHOCKWAVE, which already had a cooldown gate) - see the
    // fix at its actual trigger site for what this caused.
    private var fistCooldown = false
    // TWO_HAND_FRAME auto-capture: per your call, forming the frame triggers a
    // photo, but only after a deliberate hold (not the instant hands line up)
    // to avoid false-positive captures from a hand just passing through frame.
    private var frameHoldStartSec: Float? = null
    private val frameHoldRequiredSec = 1.2f
    @Volatile private var frameCaptureRequested = false
    private val confettiParticles = ParticleSystem()
    private val palmMagicParticles = ParticleSystem(gravity = -0.15f)
    private val clapBurstParticles = ParticleSystem()
    // FIX: MOUTH_WORDS/ROCK_PAPER_SCISSORS/STICKERS_REACT/FACE_MORPH state -
    // all four had zero live signal before. Word/label decision state
    // (mouthWordCascade below) is only ever touched from trackingHandler's
    // thread (onFaceResult/onHandResult both run there), so these are plain
    // fields, not @Volatile - texture IDs are only touched from the render
    // thread (built + read there), same single-thread-per-field discipline.
    // REWRITTEN for the multi-word cascade (was single-word state: current
    // MouthWord and a matching lastBuilt tracking variable). Each entry is
    // (word, color, spawnTimeMs).
    // Same single-thread-per-field discipline as before - only ever touched
    // from trackingHandler's thread.
    private val mouthWordCascade = mutableListOf<Triple<String, Int, Long>>()
    private var lastMouthWordSpawnMs = 0L
    private var mouthWordTextureId = 0
    private var mouthWordWidthPx = 0f
    private var mouthWordHeightPx = 0f
    private var mouthWordAnchorX = 0.5f
    private var mouthWordAnchorY = 0.5f
    private var currentRpsLabel: String? = null
    private var lastBuiltRpsLabel: String? = null
    private var rpsTextureId = 0
    private var rpsWidthPx = 0f
    private var rpsHeightPx = 0f
    private var rpsAnchorX = 0.5f
    private var rpsAnchorY = 0.5f
    // ADDED: Stickers React's Surprise/Laugh reactions - text+emoji bubbles,
    // same single-word hysteresis pattern MOUTH_WORDS used before its cascade
    // rewrite (this effect's reference shows one reaction at a time, not a
    // flowing stream, so the simpler single-bubble pattern is the right fit
    // here, not a copy of the cascade). Smile/Love (hearts) are unchanged -
    // this only adds two more reactions alongside them.
    private var currentStickerText: String? = null
    private var lastBuiltStickerText: String? = null
    private var stickerTextureId = 0
    private var stickerWidthPx = 0f
    private var stickerHeightPx = 0f
    private var stickerAnchorX = 0.5f
    private var stickerAnchorY = 0.5f
    private val stickersParticles = ParticleSystem(gravity = -0.2f)
    // NEW: Mouth Fire's real embers. Strong negative gravity (buoyancy, not
    // "falling up" - embers accelerate upward like heat plume, same
    // repurposing of the gravity param PALM_MAGIC/STICKERS_REACT already use
    // for float-upward instead of fall-down) so even the spawnBurst's mostly-
    // random initial angle gets pulled into a convincing upward stream within
    // a few frames.
    private val mouthFireParticles = ParticleSystem(gravity = -0.9f)
    private var faceMorphFrameCounter = 0
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

        liveAudioReader = LiveAudioReader(context).also { it.start() }
    }

    private fun setupEgl() {
        val surface = displaySurface ?: return

        // FIX (EGL crash - root cause): surfaceChanged() is NOT a one-time
        // event. It re-fires on rotation, on the app backgrounding/
        // foregrounding, and as a genuine duplicate on some devices right
        // after surfaceCreated(). This function used to unconditionally build
        // a brand-new EglCore + EGLSurface + camera + SurfaceTexture on every
        // single call, without ever releasing the previous set. A second
        // eglCreateWindowSurface/eglMakeCurrent against a Surface that
        // already has a live EGL producer attached to it fails - that is
        // exactly the "eglMakeCurrent failed" RuntimeException from the crash
        // screenshot - and each occurrence also leaked a camera handle and a
        // full GL context.
        //
        // Two-part fix:
        //  1. If this is a genuine no-op (same surface, same size, already
        //     set up), skip entirely - nothing changed, nothing to rebuild.
        //  2. Otherwise, fully release whatever setupEgl() built last time
        //     BEFORE building the new set, via teardownEgl() below.
        if (eglCore != null && surface == setupSurface && surfaceW == setupW && surfaceH == setupH) {
            return
        }
        // Don't tear down EGL/camera out from under an in-progress recording.
        // LiveRecorder owns its own separate encoder surface (encoderEglSurface),
        // so it isn't directly destroyed by this, but ripping out the shared
        // eglCore/renderer/camera mid-recording would still corrupt whatever
        // is currently being recorded. A resize firing mid-recording is rare;
        // skipping is safer than guessing at a live re-setup.
        if (liveRecorder?.isRecording == true) {
            android.util.Log.w("LiveEffectPreview", "setupEgl() re-triggered during an active recording - skipping re-setup to avoid corrupting it")
            return
        }
        teardownEgl()

        setupSurface = surface
        setupW = surfaceW
        setupH = surfaceH

        eglCore = EglCore()
        eglSurface = eglCore!!.createWindowSurface(surface)
        eglCore!!.makeCurrent(eglSurface!!)

        renderer = FrameRenderer(context).apply { setup() }
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
        // FIX (major, confirmed root cause of the Neon Edge/Ink Wash "crack"
        // pattern, and part of why Aura Glow/Depth Bloom/Split Prism looked
        // unpolished): setFrameSize() was NEVER called anywhere on the live
        // path - only VideoTranscoder's bake path called it. frameWidth/
        // frameHeight stayed stuck at FrameRenderer's 1x1 DEFAULT for the
        // entire live session. Every shader that reads uTexelSize (all 5
        // effects above) was computing texel offsets of a full 1.0/1.0 -
        // sampling a full image-width away for every single "neighbor" pixel,
        // instead of one real pixel away. That's the actual cause of the
        // grid/moire pattern: wildly out-of-range coordinates on an external
        // OES camera texture is undefined-behavior territory on real GPU
        // drivers, and this is what it looks like on your device. Using
        // surfaceW/surfaceH here matches exactly what setDefaultBufferSize
        // configures the camera capture buffer to below, so this is the
        // correct real size, not an approximation.
        renderer?.setFrameSize(surfaceW.coerceAtLeast(1), surfaceH.coerceAtLeast(1))
        // Apply whatever effect was requested before the renderer existed  -  see
        // pendingEffect's doc for why this line is the actual fix, not just belt-and-braces.
        renderer?.setEffect(pendingEffect)
        cameraTexId = GlUtil.createExternalTexture()
        cameraSurfaceTexture = SurfaceTexture(cameraTexId).apply {
            setDefaultBufferSize(surfaceW.coerceAtLeast(1), surfaceH.coerceAtLeast(1))
            setOnFrameAvailableListener({ drawFrame() }, renderHandler)
        }
        cameraSurface = Surface(cameraSurfaceTexture)

        // NEW: mint a fresh generation for the camera this cycle is about to
        // open, and pass it through - openCamera()'s async callbacks stamp
        // themselves with this value and check it against setupGeneration
        // before touching anything, so a stale callback from a superseded
        // cycle can't corrupt current state.
        val myGeneration = ++setupGeneration
        openCamera(myGeneration)
    }

    // FIX (EGL crash): released here, BEFORE setupEgl() creates the
    // replacement set - see setupEgl()'s doc for why this was missing.
    // Deliberately does NOT touch liveRecorder/encoderEglSurface (that's a
    // separate, independently-owned surface - see LiveRecorder.kt) or the
    // MediaPipe trackers/threads (those don't depend on the display surface
    // at all and stay alive across a resize).
    private fun teardownEgl() {
        // NEW: bump the generation FIRST, before releasing anything below -
        // any openCamera() callback already in flight for the OLD generation
        // that fires from this point on (even mid-teardown) will see its
        // stamped generation no longer matches and discard itself instead of
        // racing the teardown/rebuild happening here.
        setupGeneration++
        captureSession?.close()
        captureSession = null
        cameraDevice?.close()
        cameraDevice = null
        cameraSurface?.release()
        cameraSurface = null
        cameraSurfaceTexture?.release()
        cameraSurfaceTexture = null
        if (cameraTexId != -1) {
            GlUtil.deleteTexture(cameraTexId)
            cameraTexId = -1
        }
        eglSurface?.let { eglCore?.releaseSurface(it) }
        eglSurface = null
        renderer = null
        eglCore?.release()
        eglCore = null
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
                // FIX: was missing entirely. Without this, facialTransformationMatrixes()
                // is always absent on the live path, so headPoseDegreesFrom() would return
                // null forever regardless of anything else wired below - HEAD_TILT_ZOOM,
                // DOUBLE_TAKE, and SPIN_EFFECT would all stay silently dead even after
                // fixing their onFaceResult cases, since they'd never get real pose data.
                .setOutputFacialTransformationMatrixes(true)
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

    private fun openCamera(generation: Int) {
        cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val camId = findCameraId(pendingFacing) ?: return
        try {
            @Suppress("MissingPermission") // caller's RN layer must have already requested CAMERA permission
            cameraManager!!.openCamera(camId, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    // FIX: stale-generation guard - see setupGeneration's doc.
                    // If a newer setupEgl() cycle has already started, this
                    // device belongs to a torn-down cycle; close it and stop,
                    // don't assign it into cameraDevice/start a session.
                    if (generation != setupGeneration) { device.close(); return }
                    cameraDevice = device
                    startCaptureSession(device, generation)
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

    private fun startCaptureSession(device: CameraDevice, generation: Int) {
        if (generation != setupGeneration) { return } // stale - superseded before this even started
        val target = cameraSurface ?: return
        val builder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
        builder.addTarget(target)

        device.createCaptureSession(listOf(target), object : CameraCaptureSession.StateCallback() {
            override fun onConfigured(session: CameraCaptureSession) {
                if (generation != setupGeneration) { session.close(); return } // same stale-guard, see above
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
        // Same generation discipline as setupEgl() - this is a fresh camera
        // cycle too (used for the front/back flip), so it needs its own id.
        val myGeneration = ++setupGeneration
        openCamera(myGeneration)
    }

    // ---- Render loop (driven by camera's onFrameAvailable, not a fixed timer  -
    //      matches whatever FPS the camera actually delivers) ----

    // NEW: packs a ParticleSystem's current state into FrameRenderer's fixed-
    // size uniform arrays - same shape VideoTranscoder feeds after calling
    // .update()/.toUniforms() in the bake path, just called every live frame
    // instead of every decoded frame.
    private fun pushParticles(r: FrameRenderer, system: ParticleSystem) {
        val u = system.toUniforms()
        r.particlePositions = u.positions
        r.particleRotations = u.rotations
        r.particleLifeRemaining = u.lifeRemaining
        r.particleColorIndices = u.colorIndices
        r.particleCount = u.count
    }

    private fun drawFrame() {
        val eglC = eglCore ?: return
        val eglS = eglSurface ?: return
        val r = renderer ?: return
        val tex = cameraSurfaceTexture ?: return

        eglC.makeCurrent(eglS)
        tex.updateTexImage()
        tex.getTransformMatrix(texMatrix)

        // FIX: VOICE_HALO/THERMAL_PULSE/DEPTH_BLOOM/AURA_GLOW's real signal
        // (direct amplitude) + SILENCE_RIPPLE's (inverted - see the set
        // declarations above for why), read every frame - cheap, just a
        // volatile float read, no thread hop needed since LiveAudioReader's
        // own read thread already did the smoothing work.
        val amp = liveAudioReader?.currentAmplitude() ?: 0f
        if (r.currentEffect in audioDirectEffects) {
            r.effectIntensity = amp
        } else if (r.currentEffect in audioInvertedEffects) {
            r.effectIntensity = 1f - amp
        }

        // FIX: FIST_BUMP_BOOM/CLAP_BURST/TAP_SHOCKWAVE's decay + THROW_CONFETTI/
        // PALM_MAGIC/CLAP_BURST's particle simulation, advanced every real
        // frame - same exp(-BOOM_DECAY_PER_SEC*dt) decay VideoTranscoder uses,
        // just driven by actual wall-clock time between frames instead of
        // presentationTimeUs (there's no decoded timeline here).
        val nowNs = System.nanoTime()
        val frameDtSec = if (lastFrameTimeNs == 0L) 0f else ((nowNs - lastFrameTimeNs) / 1_000_000_000f).coerceIn(0f, 0.2f)
        lastFrameTimeNs = nowNs
        val boomDecayFactor = kotlin.math.exp(-BOOM_DECAY_PER_SEC * frameDtSec)
        boomEnergy *= boomDecayFactor
        clapBoomEnergy *= boomDecayFactor
        tapBoomEnergy *= boomDecayFactor
        confettiParticles.update(frameDtSec)
        palmMagicParticles.update(frameDtSec)
        clapBurstParticles.update(frameDtSec)
        stickersParticles.update(frameDtSec)
        mouthFireParticles.update(frameDtSec)
        when (r.currentEffect) {
            VisualEffect.FIST_BUMP_BOOM -> r.boomEnergy = boomEnergy
            VisualEffect.CLAP_BURST -> {
                r.boomEnergy = clapBoomEnergy
                pushParticles(r, clapBurstParticles)
            }
            VisualEffect.TAP_SHOCKWAVE -> r.boomEnergy = tapBoomEnergy
            VisualEffect.THROW_CONFETTI -> pushParticles(r, confettiParticles)
            VisualEffect.PALM_MAGIC -> pushParticles(r, palmMagicParticles)
            VisualEffect.STICKERS_REACT -> pushParticles(r, stickersParticles)
            VisualEffect.MOUTH_FIRE -> pushParticles(r, mouthFireParticles)
            else -> {}
        }

        val elapsedSec = (System.nanoTime() - startTimeNs) / 1_000_000_000f
        // FIX: BLINK_FREEZE's hold - mirrors VideoTranscoder's exact punch curve
        // (quick zoom-in for the first half of the hold, ease back for the second,
        // giving a "photo capture" snap rather than a flat static zoom).
        if (freezeActive && elapsedSec - freezeStartSec < freezeDurationSec) {
            val freezeProgress = (elapsedSec - freezeStartSec) / freezeDurationSec
            val punch = if (freezeProgress < 0.5f) freezeProgress * 2f else (1f - freezeProgress) * 2f
            r.drawFrozenFrame(1f + punch * 0.15f)
        } else {
            if (freezeActive) freezeActive = false // hold just ended this frame
            // FIX (confirmed from your screenshot showing a flat color instead
            // of a frozen photo — this was actually TWO stacked bugs, not one):
            // (1) captureFreezeFrame() was called BEFORE drawEffectFrame(), so
            // glCopyTexImage2D grabbed whatever stale/empty content was
            // already in the framebuffer instead of the real camera image —
            // fixed by reordering below. (2) glCopyTexImage2D's copy region
            // uses frameWidth/frameHeight, which were stuck at FrameRenderer's
            // 1x1 default the entire live session (see the setFrameSize fix
            // above) — meaning even with (1) fixed, it would have copied a
            // single 1x1 pixel, not the full photo. Both are now fixed.
            r.drawEffectFrame(cameraTexId, texMatrix, elapsedSec)
            if (r.currentEffect == VisualEffect.BLINK_FREEZE) r.captureFreezeFrame()
            // FIX: MOUTH_WORDS/ROCK_PAPER_SCISSORS overlay draw - was never
            // drawn live even on the rare chance the texture got built, since
            // nothing called drawWatermarkAt for either. Same reused
            // drawWatermarkAt call the bake path uses for both.
            if (r.currentEffect == VisualEffect.MOUTH_WORDS && mouthWordTextureId != 0) {
                val bubbleLeft = mouthWordAnchorX * surfaceW - mouthWordWidthPx / 2f
                val bubbleTop = mouthWordAnchorY * surfaceH - mouthWordHeightPx - (0.03f * surfaceH)
                r.drawWatermarkAt(mouthWordTextureId, bubbleLeft, bubbleTop, mouthWordWidthPx, mouthWordHeightPx, surfaceW, surfaceH)
            }
            if (r.currentEffect == VisualEffect.ROCK_PAPER_SCISSORS && rpsTextureId != 0) {
                val bubbleLeft = rpsAnchorX * surfaceW - rpsWidthPx / 2f
                val bubbleTop = rpsAnchorY * surfaceH - rpsHeightPx - (0.05f * surfaceH)
                r.drawWatermarkAt(rpsTextureId, bubbleLeft, bubbleTop, rpsWidthPx, rpsHeightPx, surfaceW, surfaceH)
            }
            // ADDED: draw call for Stickers React's new Surprise/Laugh text
            // bubble - same drawWatermarkAt reuse as the two blocks above.
            if (r.currentEffect == VisualEffect.STICKERS_REACT && stickerTextureId != 0) {
                val bubbleLeft = stickerAnchorX * surfaceW - stickerWidthPx / 2f
                val bubbleTop = stickerAnchorY * surfaceH - stickerHeightPx - (0.02f * surfaceH)
                r.drawWatermarkAt(stickerTextureId, bubbleLeft, bubbleTop, stickerWidthPx, stickerHeightPx, surfaceW, surfaceH)
            }
        }

        // NEW: Two Hand Frame auto-capture - this IS the safe pre-swap read
        // point (see the comment right below on why post-swap is unsafe).
        // Only the GPU readback happens here on the render thread; JPEG
        // encode + file write + event emission are handed off to
        // trackingHandler so a slow encode never stalls the render loop.
        pendingPhotoCapturePath?.let { path ->
            pendingPhotoCapturePath = null
            val promise = pendingPhotoCapturePromise
            pendingPhotoCapturePromise = null
            try {
                val bitmap = GlUtil.readPixelsAsBitmap(surfaceW, surfaceH)
                trackingHandler?.post {
                    try {
                        java.io.FileOutputStream(path).use { out ->
                            bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
                        }
                        post {
                            onFrameCapturedListener?.invoke(mapOf("path" to path))
                            promise?.resolve(path)
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("LiveEffectPreview", "Photo capture: JPEG encode/save failed", e)
                        post { promise?.reject("ERR_PHOTO_SAVE", "Failed to encode/save photo", e) }
                    } finally {
                        bitmap.recycle()
                    }
                }
            } catch (e: Exception) {
                android.util.Log.e("LiveEffectPreview", "Photo capture: pixel readback failed", e)
                promise?.reject("ERR_PHOTO_READBACK", "Failed to read frame pixels", e)
            }
        }
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
        val rec = LiveRecorder(context, w, h, videoOnlyPath, pcmPath)
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
            // FIX (major finding, explains two symptoms at once): none of
            // these three calls had any error handling. MediaPipe's
            // "failed precondition" exception (the one from your crash
            // screenshot) throws SYNCHRONOUSLY from inside detectAsync/
            // segmentAsync, not from some later callback - an uncaught
            // exception on a background HandlerThread kills that thread's
            // Looper PERMANENTLY. Once that happens, this entire posted
            // block never runs again for the rest of the session, which
            // means tracking-dependent effects (Gold Skin's segmentation
            // mask, any face/hand effect) silently stop receiving updates
            // forever - exactly "shows the effect for a second, then
            // reverts to plain camera." It also explains why the crash was
            // intermittent: sometimes the exception propagates all the way
            // up and visibly crashes the app; other times it just silently
            // kills this one thread instead, with no visible error at all.
            // Wrapping each call individually so one tracker's failure
            // can't take down the others, and so a single bad frame just
            // gets logged and skipped instead of permanently breaking
            // tracking for the rest of the session.
            if (wantsFace) {
                try { liveFaceLandmarker?.detectAsync(mpImage, ts) }
                catch (e: Exception) { android.util.Log.e("LiveEffectPreview", "face detectAsync failed, skipping this frame", e) }
            }
            if (wantsHand) {
                try { liveHandLandmarker?.detectAsync(mpImage, ts) }
                catch (e: Exception) { android.util.Log.e("LiveEffectPreview", "hand detectAsync failed, skipping this frame", e) }
            }
            if (wantsSeg) {
                try { liveSegmenter?.segmentAsync(mpImage, ts) }
                catch (e: Exception) { android.util.Log.e("LiveEffectPreview", "segmentAsync failed, skipping this frame", e) }
            }
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

    // NEW: mirrors FaceTracker.headPoseDegrees() exactly (same column-major
    // matrix decomposition, same [roll, pitch, yaw] order) - duplicated rather
    // than calling FaceTracker directly for the same reason the bounding-box
    // computation above is duplicated (see its comment): this file works from
    // the raw FaceLandmarkerResult rather than holding a FaceTracker instance.
    // If FaceTracker's math ever changes, this needs to change with it.
    private fun headPoseDegreesFrom(result: FaceLandmarkerResult): FloatArray? {
        val matrices = result.facialTransformationMatrixes().orElse(null)
        val m = matrices?.firstOrNull() ?: return null
        val yaw = Math.toDegrees(kotlin.math.atan2((-m[8]).toDouble(), m[0].toDouble())).toFloat()
        val pitch = Math.toDegrees(kotlin.math.asin(m[9].toDouble().coerceIn(-1.0, 1.0))).toFloat()
        val roll = Math.toDegrees(kotlin.math.atan2(m[1].toDouble(), m[5].toDouble())).toFloat()
        return floatArrayOf(roll, pitch, yaw)
    }

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
        var sparkX = 0f
        var sparkY = 0f
        var sparkUpdated = false
        var blinkTriggered = false
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
                val winkedLeft = left > 0.6f && right < 0.3f
                val winkedRight = right > 0.6f && left < 0.3f
                intensityOverride = when {
                    winkedLeft -> left
                    winkedRight -> right
                    else -> 0f
                }
                // Real anchor now too - was a fixed screen-space point before.
                // Same landmark indices (159 left / 386 right) FaceTracker.
                // eyeCenter() uses for the other two paths, mirrored directly
                // here since this function reads raw landmarks rather than
                // going through FaceTracker (see the faceBox comment above).
                if ((winkedLeft || winkedRight) && landmarks.size > 386) {
                    val idx = if (winkedLeft) 159 else 386
                    sparkX = landmarks[idx].x()
                    sparkY = landmarks[idx].y()
                    sparkUpdated = true
                }
            }
            // FIX: was completely unwired live - r.headTiltZoom/headTiltPan never
            // changed from their defaults, so the effect showed no zoom/pan at all
            // no matter how you tilted your head. Same roll->zoom/pan mapping
            // VideoTranscoder uses (see its HEAD_TILT_ZOOM case) for a matching feel
            // between live preview and the baked-photo/video result.
            VisualEffect.HEAD_TILT_ZOOM -> {
                val pose = headPoseDegreesFrom(result)
                val roll = pose?.get(0) ?: 0f
                val maxRollDeg = 25f
                val maxZoom = 1.35f
                val t = (kotlin.math.abs(roll) / maxRollDeg).coerceIn(0f, 1f)
                r.headTiltZoom = 1f + t * (maxZoom - 1f)
                r.headTiltPan = floatArrayOf((roll / maxRollDeg).coerceIn(-1f, 1f) * 0.15f, 0f)
            }
            // FIX: previously hardcoded to a no-op live, on the (correct-for-bake,
            // wrong-for-live) reasoning that "a still photo has no motion to
            // compare against." Live camera has real consecutive frames, so this
            // now does the real thing per the "build the real ghost trail" design
            // decision: compares this frame's yaw against lastYawDeg every call.
            VisualEffect.DOUBLE_TAKE -> {
                val pose = headPoseDegreesFrom(result)
                val yaw = pose?.get(2)
                if (yaw != null && lastYawDeg != null) {
                    val yawDelta = yaw - lastYawDeg!!
                    val speed = (kotlin.math.abs(yawDelta) / 15f).coerceIn(0f, 1f)
                    intensityOverride = speed
                    r.doubleTakeDirection = kotlin.math.sign(yawDelta)
                } else {
                    intensityOverride = 0f
                }
                if (yaw != null) lastYawDeg = yaw
            }
            // FIX: was completely unwired live - r.effectIntensity never reflected
            // an actually-raised eyebrow, so the effect either never triggered or
            // stayed stuck at whatever intensity the previously-selected effect
            // left behind. Same three blendshapes/maxOf VideoTranscoder uses.
            VisualEffect.RAISE_EYEBROW -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                val innerUp = shapes?.firstOrNull { it.categoryName() == "browInnerUp" }?.score() ?: 0f
                val outerL = shapes?.firstOrNull { it.categoryName() == "browOuterUpLeft" }?.score() ?: 0f
                val outerR = shapes?.firstOrNull { it.categoryName() == "browOuterUpRight" }?.score() ?: 0f
                intensityOverride = maxOf(innerUp, outerL, outerR)
            }
            // FIX: was completely unwired live - the ring never actually spun
            // faster/slower with head turn like it's supposed to. Same yaw->speed
            // mapping VideoTranscoder uses (30deg = "meaningfully turned").
            VisualEffect.SPIN_EFFECT -> {
                val pose = headPoseDegreesFrom(result)
                val yaw = pose?.get(2) ?: 0f
                intensityOverride = (kotlin.math.abs(yaw) / 30f).coerceIn(0f, 1f)
            }
            // FIX: was never triggered live at all - captureFreezeFrame()/
            // drawFrozenFrame() worked correctly but nothing ever called them.
            // Same both-eyes-closed gate and !freezeActive re-entry guard as
            // the bake path (guard matters here even more than there - live
            // runs continuously, so without it a single sustained blink could
            // re-trigger the hold every tracking tick).
            VisualEffect.BLINK_FREEZE -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                val left = shapes?.firstOrNull { it.categoryName() == "eyeBlinkLeft" }?.score() ?: 0f
                val right = shapes?.firstOrNull { it.categoryName() == "eyeBlinkRight" }?.score() ?: 0f
                if (!freezeActive && left > 0.6f && right > 0.6f) {
                    blinkTriggered = true
                }
            }
            VisualEffect.MOUTH_FIRE -> {
                val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
                val jawOpen = shapes?.firstOrNull { it.categoryName() == "jawOpen" }?.score() ?: 0f
                intensityOverride = jawOpen
                // Same landmark 13/14 midpoint FaceTracker.mouthCenter() uses in the
                // bake path  -  see that method's doc for why 13/14 are safe here.
                if (landmarks.size > 14) {
                    val upper = landmarks[13]
                    val lower = landmarks[14]
                    mouthX = (upper.x() + lower.x()) / 2f
                    mouthY = (upper.y() + lower.y()) / 2f
                    mouthUpdated = true
                }
                // FIX (Mouth Fire rewrite, part 1): real rising embers instead of
                // a purely procedural shader shape - this is the actual "real
                // particle physics... is what sells fire" upgrade discussed
                // earlier. Spawned from a jittered x-position across roughly the
                // mouth's width (landmarks 61/291 = left/right mouth corners) so
                // embers don't all stream from one single point, only while the
                // mouth is open enough to be worth it.
                if (jawOpen > 0.15f && landmarks.size > 291) {
                    val cornerL = landmarks[61].x()
                    val cornerR = landmarks[291].x()
                    val mouthHalfWidth = kotlin.math.abs(cornerR - cornerL) / 2f
                    val emberCount = (1 + (jawOpen * 2.5f).toInt()).coerceAtMost(3)
                    val emberX = mouthX
                    val emberY = mouthY
                    val emberHalfWidth = mouthHalfWidth
                    renderHandler?.post {
                        repeat(emberCount) {
                            val jitterX = emberX + (kotlin.random.Random.nextFloat() - 0.5f) * emberHalfWidth * 1.6f
                            mouthFireParticles.spawnBurst(jitterX, emberY, count = 1, speed = 0.25f, lifetimeSec = 0.7f)
                        }
                    }
                }
            }
            else -> {}
        }

        // FIX: MOUTH_WORDS was completely unwired live. Same hysteresis logic
        // as the bake path (only clear the active word once jawOpen drops well
        // below trigger, only pick a new word while none is active - prevents
        // flicker if jawOpen oscillates right around the threshold). Outside
        // the when() above since it needs its own texture-rebuild side effect,
        // not just a single intensityOverride float.
        // REWRITTEN for the multi-word cascade - matches the app's own
        // reference image (several words flowing up and away from the mouth
        // over time), not a single static bubble. Word SELECTION logic is
        // unchanged (still real jawOpen/smile/browUp combinations, not
        // arbitrary) - what changed is that a NEW instance spawns every
        // ~450ms while the mouth stays open, instead of once, and every
        // still-alive instance (< 1.8s old) gets composited together each
        // frame via OverlayBuilder.buildWordCascade.
        if (r.currentEffect == VisualEffect.MOUTH_WORDS) {
            val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
            val jawOpen = shapes?.firstOrNull { it.categoryName() == "jawOpen" }?.score() ?: 0f
            val smileL = shapes?.firstOrNull { it.categoryName() == "mouthSmileLeft" }?.score() ?: 0f
            val smileR = shapes?.firstOrNull { it.categoryName() == "mouthSmileRight" }?.score() ?: 0f
            val smile = maxOf(smileL, smileR)
            val browUp = shapes?.firstOrNull { it.categoryName() == "browInnerUp" }?.score() ?: 0f

            if (landmarks.size > 14) {
                val upper = landmarks[13]; val lower = landmarks[14]
                mouthWordAnchorX = (upper.x() + lower.x()) / 2f
                mouthWordAnchorY = (upper.y() + lower.y()) / 2f
            }

            val nowMs = System.currentTimeMillis()
            val word = when {
                jawOpen > 0.6f && smile > 0.3f -> "HAHA!"
                jawOpen > 0.5f && browUp > 0.4f -> "OMG!"
                jawOpen > 0.4f -> "WOW!"
                else -> null
            }
            if (word != null && nowMs - lastMouthWordSpawnMs > 450L) {
                lastMouthWordSpawnMs = nowMs
                val color = when (word) {
                    "HAHA!" -> Color.rgb(255, 214, 51)
                    "OMG!" -> Color.rgb(255, 71, 153)
                    else -> Color.rgb(64, 200, 255)
                }
                mouthWordCascade.add(Triple(word, color, nowMs))
                if (mouthWordCascade.size > 5) mouthWordCascade.removeAt(0) // cap concurrent words
            }
            mouthWordCascade.removeAll { nowMs - it.third > 1800L }

            val activeWords = mouthWordCascade.map { (text, color, spawnMs) ->
                OverlayBuilder.CascadeWord(text, color, (nowMs - spawnMs) / 1800f)
            }
            renderHandler?.post {
                if (mouthWordTextureId != 0) { GLES20.glDeleteTextures(1, intArrayOf(mouthWordTextureId), 0); mouthWordTextureId = 0 }
                if (activeWords.isNotEmpty()) {
                    val cascade = OverlayBuilder.buildWordCascade(activeWords, surfaceH * 0.06f)
                    if (cascade != null) {
                        mouthWordTextureId = cascade.textureId
                        mouthWordWidthPx = cascade.widthPx
                        mouthWordHeightPx = cascade.heightPx
                    }
                }
            }
        }

        // FIX: STICKERS_REACT was completely unwired live - same smile
        // threshold + spawn-near-upper-right-of-face as the bake path.
        // REWRITTEN to add Surprise and Laugh (the app's reference shows 5
        // reactions total; only Smile and Love existed before this) with a
        // clean priority order so they don't fire redundantly over each
        // other: Surprise (jawOpen+browUp) and Laugh (jawOpen+smile) are
        // checked first; Smile's own trigger now excludes high jawOpen so it
        // doesn't ALSO fire every time Laugh does.
        if (r.currentEffect == VisualEffect.STICKERS_REACT) {
            val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull()
            val smileL = shapes?.firstOrNull { it.categoryName() == "mouthSmileLeft" }?.score() ?: 0f
            val smileR = shapes?.firstOrNull { it.categoryName() == "mouthSmileRight" }?.score() ?: 0f
            val smile = maxOf(smileL, smileR)
            val jawOpen = shapes?.firstOrNull { it.categoryName() == "jawOpen" }?.score() ?: 0f
            val browUp = shapes?.firstOrNull { it.categoryName() == "browInnerUp" }?.score() ?: 0f

            val reactionText = when {
                jawOpen > 0.5f && browUp > 0.4f -> "\uD83D\uDE2E WOW!"       // 😮 surprised
                jawOpen > 0.4f && smile > 0.3f -> "\uD83D\uDE02 HA HA"       // 😂 laughing
                else -> null
            }
            if (currentStickerText != null && jawOpen < 0.25f) {
                currentStickerText = null
            } else if (currentStickerText == null && reactionText != null) {
                currentStickerText = reactionText
            }
            if (landmarks.size > 14) {
                stickerAnchorX = (landmarks[13].x() + landmarks[14].x()) / 2f
                stickerAnchorY = minY // above the face, same spirit as MOUTH_WORDS sitting above the mouth
            }
            val textToBuild = currentStickerText
            if (textToBuild != null && textToBuild != lastBuiltStickerText) {
                lastBuiltStickerText = textToBuild
                renderHandler?.post {
                    if (stickerTextureId != 0) GLES20.glDeleteTextures(1, intArrayOf(stickerTextureId), 0)
                    val bubble = OverlayBuilder.buildWordBubble(textToBuild, Color.rgb(255, 220, 90), surfaceH * 0.055f)
                    stickerTextureId = bubble.textureId
                    stickerWidthPx = bubble.widthPx
                    stickerHeightPx = bubble.heightPx
                }
            } else if (textToBuild == null && lastBuiltStickerText != null) {
                lastBuiltStickerText = null
                renderHandler?.post {
                    if (stickerTextureId != 0) { GLES20.glDeleteTextures(1, intArrayOf(stickerTextureId), 0); stickerTextureId = 0 }
                }
            }

            // Smile (hearts) now excludes high jawOpen, so it doesn't also
            // fire every time Laugh does above.
            if (smile > 0.35f && jawOpen < 0.4f) {
                val spawnX = maxX - (maxX - minX) * 0.15f
                val spawnY = minY + (maxY - minY) * 0.2f
                renderHandler?.post { stickersParticles.spawnBurst(spawnX, spawnY, count = 1, speed = 0.12f, lifetimeSec = 1.2f) }
            }
            // ADDED: Love reaction, mirroring the video-bake path exactly -
            // see that file's STICKERS_REACT block for the full reasoning.
            val pucker = shapes?.firstOrNull { it.categoryName() == "mouthPucker" }?.score() ?: 0f
            if (pucker > 0.45f && landmarks.size > 14) {
                val mouthX = (landmarks[13].x() + landmarks[14].x()) / 2f
                val mouthY = (landmarks[13].y() + landmarks[14].y()) / 2f
                renderHandler?.post { stickersParticles.spawnBurst(mouthX, mouthY, count = 1, speed = 0.1f, lifetimeSec = 1.3f) }
            }
        }

        // FIX: FACE_MORPH was completely unwired live - same 2-frame throttle
        // and mesh-bitmap build as the bake path (FaceMeshRenderer.buildMeshBitmap
        // is a real per-vertex mesh build, not free - see its own doc for why
        // throttling matters).
        if (r.currentEffect == VisualEffect.FACE_MORPH) {
            faceMorphFrameCounter++
            if (faceMorphFrameCounter % 2 == 0) {
                val w = surfaceW; val h = surfaceH
                if (w > 0 && h > 0) {
                    val meshBitmap = FaceMeshRenderer.buildMeshBitmap(w, h, landmarks, splitX = 0.5f)
                    renderHandler?.post {
                        r.uploadSecondaryTexture(meshBitmap)
                        meshBitmap.recycle()
                    }
                }
            }
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
            if (sparkUpdated) r.sparkOrigin = floatArrayOf(sparkX, sparkY)
            if (blinkTriggered) {
                freezeActive = true
                freezeStartSec = (System.nanoTime() - startTimeNs) / 1_000_000_000f
            }
            if (gazeFlat != null) {
                r.gazePoints = gazeFlat
                r.gazeAges = gazeAgesArr!!
                r.gazeCount = gazeCountVal
            }
        }
    }

    // NEW: mirror HandTracker's pure classification logic exactly (same
    // tip-vs-knuckle-distance-from-wrist heuristic, same finger indices) -
    // duplicated rather than instantiating a HandTracker here for the same
    // reason headPoseDegreesFrom() duplicates FaceTracker's math above:
    // HandTracker's constructor builds its OWN HandLandmarker model instance,
    // and this view already has its own (liveHandLandmarker) - instantiating
    // a second one would double the hand-tracking model's memory/init cost
    // for zero benefit.
    private fun isExtendedFrom(lm: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>, tipIdx: Int): Boolean {
        val wrist = lm[0]; val tip = lm[tipIdx]; val knuckle = lm[tipIdx - 3]
        fun d(x1: Float, y1: Float, x2: Float, y2: Float) = kotlin.math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))
        return d(tip.x(), tip.y(), wrist.x(), wrist.y()) >= d(knuckle.x(), knuckle.y(), wrist.x(), wrist.y())
    }
    private fun isFistFrom(lm: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Boolean =
        !isExtendedFrom(lm, 8) && !isExtendedFrom(lm, 12) && !isExtendedFrom(lm, 16) && !isExtendedFrom(lm, 20)
    private fun isOpenPalmFrom(lm: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Boolean =
        isExtendedFrom(lm, 8) && isExtendedFrom(lm, 12) && isExtendedFrom(lm, 16) && isExtendedFrom(lm, 20)
    // NEW: mirrors HandTracker.classifyGesture() exactly (same four-finger-only
    // classification, thumb deliberately excluded - see HandTracker's own doc
    // for why). Local RPS label enum, not HandTracker.HandGesture, to avoid
    // needing a HandTracker import just for one enum type.
    private fun classifyGestureFrom(lm: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): String {
        val index = isExtendedFrom(lm, 8); val middle = isExtendedFrom(lm, 12)
        val ring = isExtendedFrom(lm, 16); val pinky = isExtendedFrom(lm, 20)
        return when {
            !index && !middle && !ring && !pinky -> "ROCK"
            index && middle && ring && pinky -> "PAPER"
            index && middle && !ring && !pinky -> "SCISSORS"
            else -> "UNKNOWN"
        }
    }
    private fun palmCenterFrom(lm: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Pair<Float, Float> {
        val idxs = intArrayOf(0, 5, 9, 13, 17)
        var sx = 0f; var sy = 0f
        for (i in idxs) { sx += lm[i].x(); sy += lm[i].y() }
        return (sx / idxs.size) to (sy / idxs.size)
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
            // 16 points now (was 8) - see EffectShaders.FINGER_TRAIL_POINTS's
            // rewrite comment for why (too few points/no segment-connecting
            // to read as a smooth drawn curve).
            while (fingerHistory.size > 16) fingerHistory.removeLast()
            val flat = FloatArray(32)
            val ages = FloatArray(16)
            fingerHistory.forEachIndexed { i, (x, y) ->
                flat[i * 2] = x; flat[i * 2 + 1] = y
                ages[i] = i / 16f
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

        // FIX: everything below is genuinely new - these six effects had zero
        // live signal before. Uses ALL detected hands (result.landmarks()),
        // not just hand[0] - the actual root cause for TWO_HAND_FRAME/
        // CLAP_BURST, which structurally need both hands' positions and
        // silently couldn't work no matter what else got wired.
        val allHands = result.landmarks()
        val nowMs = (System.nanoTime() - startTimeNs) / 1_000_000L

        when (r.currentEffect) {
            VisualEffect.FIST_BUMP_BOOM -> {
                val first = allHands.firstOrNull()
                val isFist = first != null && isFistFrom(first)
                // FIX: was re-triggering boomEnergy=1f on EVERY tracking tick
                // the fist stayed closed - since that happens roughly every
                // 70-100ms, faster than the energy could meaningfully decay,
                // this meant a held fist looked like a constant, sustained
                // glow instead of one sharp impact on the moment the fist
                // closes. Same edge-trigger + cooldown pattern its siblings
                // (CLAP_BURST/TAP_SHOCKWAVE) already correctly use.
                if (isFist && !fistCooldown) {
                    val palm = palmCenterFrom(first!!)
                    renderHandler?.post {
                        boomEnergy = 1f
                        r.boomCenter = floatArrayOf(palm.first, palm.second)
                    }
                    fistCooldown = true
                } else if (!isFist) {
                    fistCooldown = false
                }
            }
            VisualEffect.TWO_HAND_FRAME -> {
                if (allHands.size >= 2) {
                    val c1 = palmCenterFrom(allHands[0])
                    val c2 = palmCenterFrom(allHands[1])
                    val spread = kotlin.math.abs(c1.first - c2.first) + kotlin.math.abs(c1.second - c2.second)
                    val framed = spread > 0.15f
                    val nowSec = nowMs / 1000f
                    renderHandler?.post {
                        r.frameRect = floatArrayOf(
                            minOf(c1.first, c2.first), minOf(c1.second, c2.second),
                            maxOf(c1.first, c2.first), maxOf(c1.second, c2.second)
                        )
                        r.effectIntensity = if (framed) 1f else 0f
                        // Hold-to-confirm auto-capture (design decision: 1.2s
                        // hold, not instant, to avoid a hand just passing
                        // through frame accidentally triggering a photo).
                        if (framed) {
                            val start = frameHoldStartSec ?: nowSec.also { frameHoldStartSec = it }
                            if (!frameCaptureRequested && nowSec - start >= frameHoldRequiredSec) {
                                frameCaptureRequested = true
                                val path = "${context.cacheDir.absolutePath}/two_hand_frame_${System.currentTimeMillis()}.jpg"
                                capturePhotoAndEmit(path)
                            }
                        } else {
                            frameHoldStartSec = null
                            frameCaptureRequested = false
                        }
                    }
                } else {
                    renderHandler?.post {
                        r.effectIntensity = 0f
                        frameHoldStartSec = null
                        frameCaptureRequested = false
                    }
                }
            }
            VisualEffect.THROW_CONFETTI -> {
                val first = allHands.firstOrNull()
                if (first != null) {
                    val palm = palmCenterFrom(first)
                    val prevPos = lastPalmPos
                    val prevTs = lastPalmTimeMs
                    if (prevPos != null && prevTs != null && nowMs > prevTs) {
                        val dtSec = (nowMs - prevTs) / 1000f
                        val dx = palm.first - prevPos.first
                        val dy = palm.second - prevPos.second
                        val velocity = kotlin.math.sqrt(dx * dx + dy * dy) / dtSec
                        if (!confettiCooldown && velocity > 1.8f) {
                            renderHandler?.post { confettiParticles.spawnBurst(palm.first, palm.second, count = 16, speed = 0.9f, lifetimeSec = 1.1f) }
                            confettiCooldown = true
                        } else if (confettiCooldown && velocity < 0.6f) {
                            confettiCooldown = false
                        }
                    }
                    lastPalmPos = palm
                    lastPalmTimeMs = nowMs
                }
            }
            VisualEffect.PALM_MAGIC -> {
                val first = allHands.firstOrNull()
                if (first != null && isOpenPalmFrom(first) && first.size > 20) {
                    // FIX (real coverage bug you reported): was always
                    // spawning from a single palm-center point, which is why
                    // it read as "one touch" instead of covering the hand.
                    // ParticleSystem has a shared, fixed particle budget
                    // across all effects (can't just spawn far more per
                    // tick without exceeding it and causing thrash/eviction),
                    // so the real fix is spreading spawns ACROSS the palm and
                    // all 5 fingertips over successive ticks, rather than
                    // clustering every spawn at one point - same total spawn
                    // rate, genuinely covers the whole hand shape over time.
                    val palm = palmCenterFrom(first)
                    val handPoints = listOf(
                        palm,
                        first[4].x() to first[4].y(),   // thumb tip
                        first[8].x() to first[8].y(),   // index tip
                        first[12].x() to first[12].y(), // middle tip
                        first[16].x() to first[16].y(), // ring tip
                        first[20].x() to first[20].y()  // pinky tip
                    )
                    val spawnPoint = handPoints.random()
                    renderHandler?.post {
                        palmMagicParticles.spawnBurst(spawnPoint.first, spawnPoint.second, count = 2, speed = 0.12f, lifetimeSec = 1.4f)
                        // Real palm position for the new ring core (see
                        // palmMagicSparkle's rewrite comment) - the exact
                        // value already computed above for particle spawning,
                        // no new tracking logic needed.
                        r.palmCenter = floatArrayOf(palm.first, palm.second)
                    }
                }
            }
            VisualEffect.CLAP_BURST -> {
                if (allHands.size >= 2) {
                    val c1 = palmCenterFrom(allHands[0])
                    val c2 = palmCenterFrom(allHands[1])
                    val dist = kotlin.math.sqrt((c1.first - c2.first) * (c1.first - c2.first) + (c1.second - c2.second) * (c1.second - c2.second))
                    val prevDist = lastClapDistance
                    // FIX: tightened from >0.25/<0.08 - at a sparse ~70-100ms
                    // tracking rate, the exact instant hands are closest can
                    // easily fall BETWEEN two samples, meaning neither one ever
                    // sees the "very close" moment. Widened the window so a
                    // real clap is much more likely to be caught by at least
                    // one sample.
                    val closingFast = prevDist != null && prevDist > 0.2f && dist < 0.12f
                    if (!clapCooldown && closingFast) {
                        val midX = (c1.first + c2.first) / 2f
                        val midY = (c1.second + c2.second) / 2f
                        renderHandler?.post {
                            clapBurstParticles.spawnBurst(midX, midY, count = 14, speed = 0.7f, lifetimeSec = 0.8f)
                            r.boomCenter = floatArrayOf(midX, midY)
                            clapBoomEnergy = 1f
                        }
                        clapCooldown = true
                    } else if (clapCooldown && dist > 0.3f) {
                        clapCooldown = false
                    }
                    lastClapDistance = dist
                }
            }
            VisualEffect.TAP_SHOCKWAVE -> {
                val first = allHands.firstOrNull()
                if (first != null && first.size > 8) {
                    val tip = first[8]
                    val fingertip = Triple(tip.x(), tip.y(), tip.z())
                    val prevPos = lastTapFingerPos
                    val prevTs = lastTapTimeMs
                    if (prevPos != null && prevTs != null && nowMs > prevTs) {
                        val dtSec = (nowMs - prevTs) / 1000f
                        val dx = fingertip.first - prevPos.first
                        val dy = fingertip.second - prevPos.second
                        val dz = fingertip.third - prevPos.third
                        val lateralVelocity = kotlin.math.sqrt(dx * dx + dy * dy) / dtSec
                        // FIX: a real "tap"/poke is motion TOWARD the camera
                        // (Z-depth), not sideways - the original code could only
                        // ever catch a fast horizontal/vertical swipe, never an
                        // actual poke, since a poke barely moves in X/Y at all.
                        // depthVelocity catches the poke directly; lateralVelocity
                        // is kept (threshold loosened slightly) as a fallback for
                        // a fast swipe-style tap too.
                        val depthVelocity = kotlin.math.abs(dz) / dtSec
                        if (!tapCooldown && (lateralVelocity > 1.6f || depthVelocity > 0.9f)) {
                            renderHandler?.post {
                                r.boomCenter = floatArrayOf(fingertip.first, fingertip.second)
                                tapBoomEnergy = 1f
                            }
                            tapCooldown = true
                        } else if (tapCooldown && lateralVelocity < 0.6f && depthVelocity < 0.3f) {
                            tapCooldown = false
                        }
                    }
                    lastTapFingerPos = fingertip
                    lastTapTimeMs = nowMs
                }
            }
            // FIX: was completely unwired live - same gesture->label mapping
            // and "cache texture until label changes" pattern as MOUTH_WORDS,
            // driven by hand shape instead of blendshapes. Clears the label
            // texture the moment no hand is detected, same as the bake path,
            // so a stale label doesn't sit frozen over nothing.
            VisualEffect.ROCK_PAPER_SCISSORS -> {
                val first = allHands.firstOrNull()
                if (first != null) {
                    val gesture = classifyGestureFrom(first)
                    if (gesture != "UNKNOWN") currentRpsLabel = gesture
                    val palm = palmCenterFrom(first)
                    rpsAnchorX = palm.first
                    rpsAnchorY = palm.second
                    val labelToBuild = currentRpsLabel
                    if (labelToBuild != null && labelToBuild != lastBuiltRpsLabel) {
                        lastBuiltRpsLabel = labelToBuild
                        renderHandler?.post {
                            if (rpsTextureId != 0) GLES20.glDeleteTextures(1, intArrayOf(rpsTextureId), 0)
                            val bubble = OverlayBuilder.buildWordBubble(labelToBuild, Color.rgb(255, 255, 255), surfaceH * 0.055f)
                            rpsTextureId = bubble.textureId
                            rpsWidthPx = bubble.widthPx
                            rpsHeightPx = bubble.heightPx
                        }
                    }
                } else if (rpsTextureId != 0 || currentRpsLabel != null) {
                    currentRpsLabel = null
                    lastBuiltRpsLabel = null
                    renderHandler?.post {
                        if (rpsTextureId != 0) { GLES20.glDeleteTextures(1, intArrayOf(rpsTextureId), 0); rpsTextureId = 0 }
                    }
                }
            }
            else -> {}
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
        liveAudioReader?.stop()
        liveAudioReader = null
        renderHandler?.post {
            // FIX: same stale-callback protection as teardownEgl() above -
            // without this, an async openCamera() callback already in flight
            // could still fire after this teardown and assign a live camera
            // device into fields this block just closed.
            setupGeneration++
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
            captureSession = null
            cameraDevice?.close()
            cameraDevice = null
            cameraSurface?.release()
            cameraSurface = null
            cameraSurfaceTexture?.release()
            cameraSurfaceTexture = null
            eglSurface?.let { eglCore?.releaseSurface(it) }
            eglSurface = null
            eglCore?.release()
            eglCore = null
        }
        liveFaceLandmarker?.close()
        liveHandLandmarker?.close()
        liveSegmenter?.close()
        cameraThread?.quitSafely()
        trackingThread?.quitSafely()
        renderThread?.quitSafely()
    }
}   
