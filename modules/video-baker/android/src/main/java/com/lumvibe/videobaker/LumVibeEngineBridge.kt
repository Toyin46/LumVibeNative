package com.lumvibe.videobaker

import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLUtils
import android.view.Surface
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

/**
 * Kotlin-side handle to the native LumVibe AR Engine.
 *
 * REWRITTEN this pass against your REAL FaceTracker.kt/HandTracker.kt/
 * SegmentationTracker.kt (read directly from your actual module, not
 * assumed) — the first version of this file guessed a clean
 * FaceTracker.Result/HandTracker.Result data-class shape that doesn't
 * exist. Your trackers instead return raw FaceLandmarkerResult/
 * HandLandmarkerResult and expose separate helper functions
 * (blendshapeScore, headPoseDegrees, faceBoundingBox, mouthCenter,
 * eyeCenter, irisCenter / classifyGesture, palmCenter, handAngle,
 * fingerStates) — updateSignals() below now calls those helpers directly,
 * matching how VideoTranscoder.kt already uses your trackers.
 */
class LumVibeEngineBridge(context: android.content.Context, manifestAssetPath: String) {

    private var handle: Long = 0L
    private var lastYawDegrees: Float = 0f

    init {
        val manifestFile = java.io.File(context.cacheDir, "effects.manifest.json")
        context.assets.open(manifestAssetPath).use { input ->
            manifestFile.outputStream().use { output -> input.copyTo(output) }
        }
        handle = nativeCreate(manifestFile.absolutePath)
        check(handle != 0L) { "Failed to load effects manifest — check compile-manifest.ts output" }
    }

    fun attachWindowSurface(surface: Surface) = nativeAttachWindowSurface(handle, surface)
    fun attachOffscreenSurface(width: Int, height: Int) = nativeAttachOffscreenSurface(handle, width, height)
    fun cameraTextureId(): Int = nativeGetCameraTextureId(handle)
    fun setEffect(effectId: String): Boolean = nativeSetEffect(handle, effectId)

    // Uploads a Bitmap to a new GL_TEXTURE_2D — same pattern
    // OverlayBuilder.kt's buildCaptionTexture/buildWatermarkLogo already
    // use (GlUtil.createTexture2D() + GLUtils.texImage2D), reused here
    // for the segmentation mask and face-mesh overlay textures so this
    // stays consistent with your existing GL conventions rather than
    // inventing a second upload path.
    private fun uploadBitmapTexture(bitmap: Bitmap): Int {
        val texId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        return texId
    }

    /**
     * Call once per frame. Pass whatever your VideoTranscoder/
     * LiveEffectPreviewView already computed this frame — this function
     * does the "reduce raw MediaPipe results into the engine's flat
     * signal arrays" work your old FrameRenderer's per-effect `when`
     * branches used to do by hand, in ONE place instead of three.
     *
     * faceTracker/handTracker are passed in (not held by this class)
     * because they're stateless wrappers around their own landmarker
     * instances that VideoTranscoder/LiveEffectPreviewView already own —
     * this avoids creating a second set of MediaPipe landmarkers.
     */
    fun updateSignals(
        timeElapsedSec: Float,
        timeDeltaSec: Float,
        faceTracker: FaceTracker,
        faceResult: FaceLandmarkerResult?,
        handTracker: HandTracker,
        handResult: HandLandmarkerResult?,
        segmentationMaskBitmap: Bitmap?, // from SegmentationTracker.maskBitmap(...) — pass null if this effect doesn't need it (isEffectAvailable-style skip, same as your old EffectRequirements classification)
        faceMeshBitmap: Bitmap?,         // from FaceMeshRenderer.buildMeshBitmap(...) — pass null unless the active effect is face_morph
        audioAmplitude: Float,
        motionMagnitude: Float,
        stillnessSeconds: Float,
        bodyBox: FloatArray?,            // from PoseTracker.detect(...)?.boundingBox, or null
        touchActive: Boolean,
        touchX: Float,
        touchY: Float,
    ) {
        // ---- Face: compute every value via the real helper functions ----
        var smileScore = 0f; var browRaiseScore = 0f; var jawOpen = 0f; var winkScore = 0f
        var faceBox = floatArrayOf(0.35f, 0.25f, 0.65f, 0.75f)
        var mouthX = 0.5f; var mouthY = 0.6f
        var headRoll = 0f; var headPitch = 0f; var headYaw = 0f
        var eyeBlinkBoth = false
        var yawDelta = 0f
        var faceDetected = false
        var eyeLeftX = 0.4f; var eyeLeftY = 0.4f; var eyeRightX = 0.6f; var eyeRightY = 0.4f

        if (faceResult != null) {
            faceDetected = true
            val smileLeft = faceTracker.blendshapeScore(faceResult, "mouthSmileLeft")
            val smileRight = faceTracker.blendshapeScore(faceResult, "mouthSmileRight")
            smileScore = maxOf(smileLeft, smileRight)
            browRaiseScore = maxOf(
                faceTracker.blendshapeScore(faceResult, "browInnerUp"),
                faceTracker.blendshapeScore(faceResult, "browOuterUpLeft"),
                faceTracker.blendshapeScore(faceResult, "browOuterUpRight"),
            )
            jawOpen = faceTracker.blendshapeScore(faceResult, "jawOpen")
            val blinkLeft = faceTracker.blendshapeScore(faceResult, "eyeBlinkLeft")
            val blinkRight = faceTracker.blendshapeScore(faceResult, "eyeBlinkRight")
            eyeBlinkBoth = blinkLeft > 0.6f && blinkRight > 0.6f
            winkScore = when {
                blinkLeft > 0.6f && blinkRight < 0.3f -> blinkLeft
                blinkRight > 0.6f && blinkLeft < 0.3f -> -blinkRight
                else -> 0f
            }
            faceTracker.faceBoundingBox(faceResult)?.let { faceBox = it }
            faceTracker.mouthCenter(faceResult)?.let { mouthX = it.first; mouthY = it.second }
            faceTracker.eyeCenter(faceResult, true)?.let { eyeLeftX = it.first; eyeLeftY = it.second }
            faceTracker.eyeCenter(faceResult, false)?.let { eyeRightX = it.first; eyeRightY = it.second }
            // headPoseDegrees() returns [roll, pitch, yaw] per its own doc comment —
            // that exact order, not alphabetical, matches FaceTracker.kt's return.
            faceTracker.headPoseDegrees(faceResult)?.let { pose ->
                headRoll = pose[0]; headPitch = pose[1]; headYaw = pose[2]
                yawDelta = kotlin.math.min(kotlin.math.abs(headYaw - lastYawDegrees) / 25f, 1f)
                lastYawDegrees = headYaw
            }
        }

        val faceArray = floatArrayOf(
            if (faceDetected) 1f else 0f, smileScore, browRaiseScore, jawOpen, winkScore,
            faceBox[0], faceBox[1], faceBox[2], faceBox[3], mouthX, mouthY,
            headRoll, headPitch, headYaw, if (eyeBlinkBoth) 1f else 0f, yawDelta,
            eyeLeftX, eyeLeftY, eyeRightX, eyeRightY,
        )

        // ---- Gaze trail: left blank here (needs frame-to-frame history
        // your VideoTranscoder would maintain, not something FaceTracker
        // itself tracks) — pass empty until you're ready to wire gaze_trail. ----
        val gazePoints = FloatArray(0)
        val gazeAges = FloatArray(0)

        // ---- Hands: classifyGesture()'s enum order does NOT match the
        // engine's HandGesture enum (yours has no "NONE"; FIST=0 there vs
        // Fist=1 in Signals.h) — mapped explicitly, not by raw ordinal. ----
        val handLandmarksList = handResult?.landmarks() ?: emptyList()
        val handCount = minOf(handLandmarksList.size, 2)
        val handArray = FloatArray(handCount * 6)
        for (i in 0 until handCount) {
            val landmarks = handLandmarksList[i]
            val (px, py) = handTracker.palmCenter(landmarks)
            val gesture = mapHandGesture(handTracker.classifyGesture(landmarks))
            val angle = handTracker.handAngle(landmarks)
            val base = i * 6
            handArray[base] = 1f
            handArray[base + 1] = px
            handArray[base + 2] = py
            handArray[base + 3] = gesture
            handArray[base + 4] = angle
            handArray[base + 5] = 0f // throwVelocity: needs frame-to-frame palm history, same category as gazeTrail above — not computed here yet
        }

        // ---- Finger trail: same "needs frame history" gap as gaze trail ----
        val fingerPoints = FloatArray(0)
        val fingerAges = FloatArray(0)

        // EYE LASER: 8 extra floats appended to the face array (indices 20..27)
        val eyeLaser: FloatArray = (if (faceResult != null) faceTracker.eyeLaserSignals(faceResult, (timeElapsedSec * 1000f).toLong()) else null)
            ?: floatArrayOf(0.4f, 0.4f, 0.6f, 0.4f, 0f, 0f, 0f, 0f)

        val maskTextureId = segmentationMaskBitmap?.let { uploadBitmapTexture(it) } ?: 0
        val faceMeshTextureId = faceMeshBitmap?.let { uploadBitmapTexture(it) } ?: 0

        val bb = bodyBox ?: floatArrayOf(0.25f, 0.15f, 0.75f, 1.0f)

        nativeUpdateSignals(
            handle, timeElapsedSec, timeDeltaSec,
            faceArray + eyeLaser,
            gazePoints, gazeAges, 0,
            handArray, handCount,
            fingerPoints, fingerAges, 0,
            audioAmplitude, motionMagnitude, stillnessSeconds,
            bodyBox != null, bb,
            touchActive, touchX, touchY,
            maskTextureId, faceMeshTextureId,
        )

        // Textures uploaded above are short-lived (one frame) — delete
        // them after the native side has consumed this frame's signals,
        // same lifecycle OverlayBuilder's per-frame textures already
        // follow, to avoid leaking a texture object every frame.
        if (maskTextureId != 0) GlUtil.deleteTexture(maskTextureId)
        if (faceMeshTextureId != 0) GlUtil.deleteTexture(faceMeshTextureId)
    }

    private fun mapHandGesture(g: HandTracker.HandGesture): Float = when (g) {
        HandTracker.HandGesture.FIST -> 1f
        HandTracker.HandGesture.OPEN_PALM -> 2f
        HandTracker.HandGesture.SCISSORS -> 3f
        HandTracker.HandGesture.POINTING -> 4f
        HandTracker.HandGesture.UNKNOWN -> 5f
    }

    fun renderFrame() = nativeRenderFrame(handle)
    fun swapBuffers() = nativeSwapBuffers(handle)

    fun release() {
        if (handle != 0L) { nativeRelease(handle); handle = 0L }
    }

    private external fun nativeCreate(manifestPath: String): Long
    private external fun nativeAttachWindowSurface(handle: Long, surface: Surface)
    private external fun nativeAttachOffscreenSurface(handle: Long, width: Int, height: Int)
    private external fun nativeGetCameraTextureId(handle: Long): Int
    private external fun nativeSetEffect(handle: Long, effectId: String): Boolean
    private external fun nativeUpdateSignals(
        handle: Long, timeElapsed: Float, timeDelta: Float,
        faceSignal: FloatArray,
        gazeTrailPoints: FloatArray, gazeTrailAges: FloatArray, gazeTrailCount: Int,
        handSignals: FloatArray, handCount: Int,
        fingerTrailPoints: FloatArray, fingerTrailAges: FloatArray, fingerTrailCount: Int,
        audioAmplitude: Float, motionMagnitude: Float, stillnessSeconds: Float,
        bodyDetected: Boolean, bodyBox: FloatArray,
        touchActive: Boolean, touchX: Float, touchY: Float,
        segmentationMaskTextureId: Int, faceMeshTextureId: Int,
    )
    private external fun nativeRenderFrame(handle: Long)
    private external fun nativeSwapBuffers(handle: Long)
    private external fun nativeRelease(handle: Long)

    companion object {
        init { System.loadLibrary("lumvibe_engine") }
    }
}
