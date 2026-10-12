package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult

/**
* Thin wrapper around MediaPipe's Face Landmarker, running in VIDEO mode — that's
* the correct mode for us specifically because we're processing already-recorded
* frames one at a time in order (not a live camera feed, which would be LIVE_STREAM).
*
* REQUIRES, as real setup steps outside this file (not something code can do for you):
*   1. Add to build.gradle:  implementation 'com.google.mediapipe:tasks-vision:0.10.26'
*      (confirm the newest 0.10.x patch on Maven Central before building)
*   2. Download face_landmarker.task from:
*      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
*      and place it in app/src/main/assets/ (a real ~10MB+ binary model file)
*/
class FaceTracker(context: Context) {

    // SPEED: GPU delegate first, falling back to CPU if the device/driver doesn't
    // support it — MediaPipe on GPU is typically several times faster than CPU for
    // these vision models. Wrapped in try/catch rather than assumed-safe because
    // GPU delegate support varies by device/GPU driver; a device that can't
    // initialize it should still bake (slower), not crash outright.
    private val faceLandmarker: FaceLandmarker = createLandmarker(context, useGpu = true)
        ?: createLandmarker(context, useGpu = false)
        ?: throw IllegalStateException("FaceLandmarker failed to initialize on both GPU and CPU delegates")

    private fun createLandmarker(context: Context, useGpu: Boolean): FaceLandmarker? = try {
        val baseOptionsBuilder = BaseOptions.builder().setModelAssetPath("face_landmarker.task")
        if (useGpu) baseOptionsBuilder.setDelegate(Delegate.GPU)
        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptionsBuilder.build())
            .setRunningMode(RunningMode.VIDEO)
            .setOutputFaceBlendshapes(true)
            // NEW: needed for HEAD_TILT_ZOOM / DOUBLE_TAKE — gives us a 4x4 head-pose
            // matrix per frame, which we decompose into roll/pitch/yaw below. Without
            // this flag the matrix list in the result is always empty.
            .setOutputFacialTransformationMatrixes(true)
            .setNumFaces(1)
            .build()
        FaceLandmarker.createFromOptions(context, options)
    } catch (e: Exception) {
        if (useGpu) android.util.Log.w("FaceTracker", "GPU delegate init failed, falling back to CPU", e)
        null
    }

    /**
     * Runs face landmark + blendshape detection on one decoded frame.
     * [timestampMs] must increase monotonically across calls in VIDEO mode — use the
     * same presentationTimeUs-derived value already driving the shader effects, so
     * everything in the pipeline stays on one consistent timeline.
     *
     * Returns null if no face was detected in this frame — treat that as "skip the
     * effect this frame," not an error; faces going in/out of frame is normal.
     */
    fun detect(bitmap: Bitmap, timestampMs: Long): FaceLandmarkerResult? {
        frameAspect = bitmap.width.toFloat() / bitmap.height.toFloat()
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = faceLandmarker.detectForVideo(mpImage, timestampMs)
        return if (result.faceLandmarks().isEmpty()) null else result
    }

    /**
     * Convenience: pulls one named blendshape score (0..1) out of a result, e.g.
     * "mouthSmileLeft". Returns 0f if not found — deliberately defensive, since exact
     * blendshape names should be confirmed against your actual model's output the
     * first time this runs on-device, rather than assumed from documentation alone.
     */
    fun blendshapeScore(result: FaceLandmarkerResult, name: String): Float {
        val shapes = result.faceBlendshapes().orElse(null)?.firstOrNull() ?: return 0f
        return shapes.firstOrNull { it.categoryName() == name }?.score() ?: 0f
    }

    /**
     * Head pose angles in degrees, decomposed from the facial transformation matrix.
     * roll = head tilt left/right (ear toward shoulder) — drives HEAD_TILT_ZOOM.
     * yaw = head turn left/right — drives DOUBLE_TAKE (compare against the previous
     * frame's yaw in VideoTranscoder to detect a "fast turn").
     * pitch = head nod up/down — exposed for completeness, unused by current effects.
     *
     * Returns null if no transformation matrix is present (shouldn't happen once
     * setOutputFacialTransformationMatrixes(true) is set above, but MediaPipe's own
     * docs list this as Optional<> so we treat absence as "skip this frame," same
     * policy as a missing face).
     *
     * NOTE ON UNITS: MediaPipe's matrix is column-major, same convention as
     * android.opengl.Matrix — do not transpose it before reading rotation terms.
     *
     * FLAG THIS FOR ON-DEVICE VERIFICATION: the sign of roll/yaw here depends on
     * MediaPipe's exact axis convention for this matrix, which is easy to get backwards
     * from documentation alone. First time you wire HEAD_TILT_ZOOM or DOUBLE_TAKE in,
     * log headPoseDegrees() while deliberately tilting/turning your head on a test clip
     * and confirm the sign matches the direction you actually moved — flip the sign in
     * VideoTranscoder's usage (not here) if it's inverted, rather than guessing twice.
     */
    fun headPoseDegrees(result: FaceLandmarkerResult): FloatArray? {
        val matrices = result.facialTransformationMatrixes().orElse(null)
        val m = matrices?.firstOrNull() ?: return null
        // m is column-major 4x4: m[col*4 + row]
        val yaw = Math.toDegrees(kotlin.math.atan2((-m[8]).toDouble(), m[0].toDouble())).toFloat()
        val pitch = Math.toDegrees(kotlin.math.asin(m[9].toDouble().coerceIn(-1.0, 1.0))).toFloat()
        val roll = Math.toDegrees(kotlin.math.atan2(m[1].toDouble(), m[5].toDouble())).toFloat()
        return floatArrayOf(roll, pitch, yaw)
    }

    /**
     * Normalized (0..1) bounding box of the detected face — (minX, minY, maxX, maxY) —
     * computed as the min/max of all 478 face-mesh landmark points. Used by
     * VOICE_HALO to position/size the glow ring around the head. This is a real
     * mesh-derived box, not an approximation like WINK_SPARK's fixed anchor point,
     * since face landmark positions (unlike blendshapes) ARE available here.
     */
    fun faceBoundingBox(result: FaceLandmarkerResult): FloatArray? {
        val points = result.faceLandmarks().firstOrNull() ?: return null
        if (points.isEmpty()) return null
        var minX = 1f; var minY = 1f; var maxX = 0f; var maxY = 0f
        for (p in points) {
            if (p.x() < minX) minX = p.x()
            if (p.y() < minY) minY = p.y()
            if (p.x() > maxX) maxX = p.x()
            if (p.y() > maxY) maxY = p.y()
        }
        return floatArrayOf(minX, minY, maxX, maxY)
    }

    /**
     * Normalized (0..1) midpoint between the two iris centers, for GAZE_TRAIL.
     *
     * FLAG THIS FOR ON-DEVICE VERIFICATION: indices 468 (left iris center) and 473
     * (right iris center) are only present if your face_landmarker.task outputs the
     * full 478-point refined mesh (which includes irises). The base 468-point mesh
     * does NOT include them. Before relying on this, log
     * result.faceLandmarks()[0].size on-device and confirm it's 478, not 468 — if
     * it's 468, this returns null rather than indexing out of bounds, but the
     * effect will simply never fire, which is worth noticing during testing.
     */
    fun irisCenter(result: FaceLandmarkerResult): Pair<Float, Float>? {
        val points = result.faceLandmarks().firstOrNull() ?: return null
        if (points.size <= 473) return null // guards the exact failure mode described above
        val left = points[468]
        val right = points[473]
        return ((left.x() + right.x()) / 2f) to ((left.y() + right.y()) / 2f)
    }

    // ── EYE LASER support (same maths as the website's calc.face) ───────────────
    /** width / height of the last frame given to detect(); keeps x and y distances comparable. */
    @Volatile var frameAspect: Float = 0.5625f

    private class OneEuro(private val minCut: Float, private val beta: Float) {
        private var x = 0f; private var dx = 0f; private var t = 0L; private var ready = false
        private fun alpha(cut: Float, dt: Float) = 1f / (1f + (1f / (2f * Math.PI.toFloat() * cut)) / dt)
        fun filter(v: Float, tMs: Long): Float {
            if (!ready) { x = v; dx = 0f; t = tMs; ready = true; return v }
            val dt = maxOf((tMs - t) / 1000f, 0.001f); t = tMs
            dx += alpha(1f, dt) * ((v - x) / dt - dx)
            x += alpha(minCut + beta * kotlin.math.abs(dx), dt) * (v - x)
            return x
        }
    }
    private val gazeFilterX = OneEuro(1.2f, 3f)
    private val gazeFilterY = OneEuro(1.2f, 3f)
    private var openLeft = -1f
    private var openRight = -1f

    /**
     * [irisLeftX, irisLeftY, irisRightX, irisRightY, gazeX, gazeY, openLeft, openRight].
     * "Left" = image-left (the user's right eye). gaze = head direction + eye direction,
     * x right / y down, ~0 when looking at the camera. null = no iris landmarks in this result.
     */
    fun eyeLaserSignals(result: FaceLandmarkerResult, nowMs: Long): FloatArray? {
        val lm = result.faceLandmarks().firstOrNull() ?: return null
        if (lm.size <= 473) return null
        val ar = frameAspect
        fun off(i: Int, a: Int, b: Int): FloatArray {
            val dx = (lm[b].x() - lm[a].x()) * ar
            val dy = lm[b].y() - lm[a].y()
            val w = maxOf(kotlin.math.hypot(dx, dy), 1e-4f)
            return floatArrayOf(
                (lm[i].x() - (lm[a].x() + lm[b].x()) / 2f) * ar / w,
                (lm[i].y() - (lm[a].y() + lm[b].y()) / 2f) / w,
            )
        }
        val o1 = off(468, 33, 133)
        val o2 = off(473, 362, 263)
        var gx = 2.4f * (o1[0] + o2[0]) / 2f
        var gy = 2.4f * (o1[1] + o2[1]) / 2f
        val m = result.facialTransformationMatrixes().orElse(null)?.firstOrNull()
        if (m != null && m.size >= 11) {
            val n = maxOf(kotlin.math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]), 1e-6f)
            gx += m[8] / n
            gy -= m[9] / n
        }
        val sx = gazeFilterX.filter(gx, nowMs)
        val sy = gazeFilterY.filter(gy, nowMs)
        fun openness(blink: Float) = 1f - ((blink - 0.30f) / 0.40f).coerceIn(0f, 1f)
        // image-left eye = the user's RIGHT eye -> eyeBlinkRight
        val tl = openness(blendshapeScore(result, "eyeBlinkRight"))
        val tr = openness(blendshapeScore(result, "eyeBlinkLeft"))
        openLeft = if (openLeft < 0f) tl else openLeft + (tl - openLeft) * 0.6f
        openRight = if (openRight < 0f) tr else openRight + (tr - openRight) * 0.6f
        return floatArrayOf(lm[468].x(), lm[468].y(), lm[473].x(), lm[473].y(), sx, sy, openLeft, openRight)
    }

    /** Call once when done baking — releases the model's native resources. */
    fun close() {
        faceLandmarker.close()
    }

    /**
     * Normalized (0..1) midpoint of the inner mouth opening, for MOUTH_FIRE's flame
     * anchor position. Landmarks 13 (upper inner lip) and 14 (lower inner lip) are
     * part of the base 468-point mesh — unlike irisCenter's 468/478-point split,
     * these are always present regardless of the refine_landmarks setting, so no
     * on-device size check/fallback is needed the way irisCenter has one.
     */
    fun mouthCenter(result: FaceLandmarkerResult): Pair<Float, Float>? {
        val points = result.faceLandmarks().firstOrNull() ?: return null
        if (points.size <= 14) return null
        val upper = points[13]
        val lower = points[14]
        return ((upper.x() + lower.x()) / 2f) to ((upper.y() + lower.y()) / 2f)
    }

    /** Real eye position for WINK_SPARK's anchor - upper-eyelid landmark, a
     * reasonable "center of this eye" proxy. 159 = left eye, 386 = right eye,
     * the exact indices winkSpark's own shader comment already named as the
     * intended upgrade before this method existed to provide them. */
    fun eyeCenter(result: FaceLandmarkerResult, isLeft: Boolean): Pair<Float, Float>? {
        val points = result.faceLandmarks().firstOrNull() ?: return null
        val index = if (isLeft) 159 else 386
        if (points.size <= index) return null
        val p = points[index]
        return p.x() to p.y()
    }
}   
