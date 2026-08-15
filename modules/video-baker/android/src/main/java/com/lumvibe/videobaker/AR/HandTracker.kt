package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

/**
* Same pattern as FaceTracker  -  thin VIDEO-mode wrapper, one bitmap in, landmarks
* out. Kept as a SEPARATE class/model rather than folded into FaceTracker because
* MediaPipe ships hand and face landmarking as two separate .task models; running
* both means two readbacks + two inferences per frame for any effect that needs
* both (none of the current 22 do at once, but HAND_PORTAL needs hands only).
*
* REQUIRES, as real setup steps outside this file:
*   1. Add to build.gradle:  implementation 'com.google.mediapipe:tasks-vision:0.10.26'
*      (same artifact as FaceTracker  -  one dependency covers both landmarkers;
*      confirm the version already in your build.gradle matches, don't add a
*      second tasks-vision line)
*   2. Download hand_landmarker.task from:
*      https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
*      and place it in app/src/main/assets/ alongside face_landmarker.task
*
* Landmark indices used below follow MediaPipe's 21-point hand model
* (https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)  -
* WRIST=0, THUMB_TIP=4, INDEX_TIP=8, MIDDLE_TIP=12, RING_TIP=16, PINKY_TIP=20,
* and each finger's *_MCP (knuckle) is TIP_INDEX - 3.
*/
class HandTracker(context: Context) {

    // SPEED: same GPU-with-CPU-fallback pattern as FaceTracker  -  see its comment
    // for why this is wrapped in try/catch instead of assumed safe.
    private val handLandmarker: HandLandmarker = createLandmarker(context, useGpu = true)
        ?: createLandmarker(context, useGpu = false)
        ?: throw IllegalStateException("HandLandmarker failed to initialize on both GPU and CPU delegates")

    private fun createLandmarker(context: Context, useGpu: Boolean): HandLandmarker? = try {
        val baseOptionsBuilder = BaseOptions.builder().setModelAssetPath("hand_landmarker.task")
        if (useGpu) baseOptionsBuilder.setDelegate(Delegate.GPU)
        val options = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(baseOptionsBuilder.build())
            .setRunningMode(RunningMode.VIDEO)
            .setNumHands(2) // TWO_HAND_FRAME needs both hands visible at once
            .build()
        HandLandmarker.createFromOptions(context, options)
    } catch (e: Exception) {
        if (useGpu) android.util.Log.w("HandTracker", "GPU delegate init failed, falling back to CPU", e)
        null
    }

    /** Same monotonic-timestamp contract as FaceTracker.detect(). Returns null if
     *  zero hands were found this frame  -  treat as "no gesture this frame," not an error. */
    fun detect(bitmap: Bitmap, timestampMs: Long): HandLandmarkerResult? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = handLandmarker.detectForVideo(mpImage, timestampMs)
        return if (result.landmarks().isEmpty()) null else result
    }

    /**
     * A simple, explainable "is this a closed fist" heuristic for FIST_BUMP_BOOM:
     * true when all four non-thumb fingertips are closer to the wrist than their
     * own knuckle is  -  i.e. curled in, not extended. Deliberately not using a
     * pretrained gesture classifier (MediaPipe also ships one, GestureRecognizer)
     * to avoid a THIRD model/asset; this heuristic is a known simplification and
     * should be tuned against a real test clip (a fist held sideways or partly
     * out-of-frame may not trigger it) rather than assumed correct on paper.
     */
    fun isFist(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Boolean {
        return !isExtended(landmarks, 8) && !isExtended(landmarks, 12) && !isExtended(landmarks, 16) && !isExtended(landmarks, 20)
    }

    /**
     * Same tip-vs-knuckle-distance-from-wrist heuristic isFist() already used
     * (refactored out, not changed  -  isFist()'s behavior above is identical to
     * before), generalized to any single fingertip landmark index so it can
     * back a full per-finger classification, not just the one fist/not-fist
     * question. tipIdx must be one of the four non-thumb tips (8/12/16/20)  -
     * the thumb needs different geometry, handled separately by isThumbExtended.
     */
    private fun isExtended(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>, tipIdx: Int): Boolean {
        val wrist = landmarks[0]
        val tip = landmarks[tipIdx]
        val knuckle = landmarks[tipIdx - 3]
        val tipDist = dist(tip.x(), tip.y(), wrist.x(), wrist.y())
        val knuckleDist = dist(knuckle.x(), knuckle.y(), wrist.x(), wrist.y())
        return tipDist >= knuckleDist
    }

    /**
     * Thumb needs a DIFFERENT check than the other four fingers  -  it bends
     * sideways across the palm, not up/down, so tip-vs-wrist distance doesn't
     * work the same way. This compares the thumb tip's distance from the index
     * knuckle against the thumb's OWN base joint's distance from that same
     * point  -  extended means the tip has moved meaningfully farther away than
     * its own base sits. This is a genuinely harder classification than the
     * other four fingers (true even in professional hand-tracking work, not
     * just here)  -  treat it as a real but rougher signal, and don't gate a
     * whole gesture's core classification on it alone (see classifyGesture,
     * which deliberately doesn't require a correct thumb read).
     */
    private fun isThumbExtended(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Boolean {
        val tip = landmarks[4]
        val base = landmarks[2]
        val indexMcp = landmarks[5]
        val tipDist = dist(tip.x(), tip.y(), indexMcp.x(), indexMcp.y())
        val baseDist = dist(base.x(), base.y(), indexMcp.x(), indexMcp.y())
        return tipDist > baseDist * 1.3f
    }

    data class FingerStates(val thumb: Boolean, val index: Boolean, val middle: Boolean, val ring: Boolean, val pinky: Boolean)

    /** Real per-finger extended/curled read for a single detected hand. */
    fun fingerStates(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): FingerStates = FingerStates(
        thumb = isThumbExtended(landmarks),
        index = isExtended(landmarks, 8),
        middle = isExtended(landmarks, 12),
        ring = isExtended(landmarks, 16),
        pinky = isExtended(landmarks, 20)
    )

    enum class HandGesture { FIST, OPEN_PALM, SCISSORS, POINTING, UNKNOWN }

    /**
     * Classifies the overall hand shape from the four non-thumb fingers only  -
     * thumb state is available via fingerStates() for effects that want it, but
     * deliberately excluded from THIS classification's core conditions, since
     * isThumbExtended's heuristic is the least reliable of the five (see its
     * own doc) and none of FIST/OPEN_PALM/SCISSORS/POINTING structurally need
     * it to tell apart from each other.
     */
    fun classifyGesture(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): HandGesture {
        val f = fingerStates(landmarks)
        return when {
            !f.index && !f.middle && !f.ring && !f.pinky -> HandGesture.FIST
            f.index && f.middle && f.ring && f.pinky -> HandGesture.OPEN_PALM
            f.index && f.middle && !f.ring && !f.pinky -> HandGesture.SCISSORS
            f.index && !f.middle && !f.ring && !f.pinky -> HandGesture.POINTING
            else -> HandGesture.UNKNOWN
        }
    }

    /**
     * Center point (in normalized 0..1 image coords) of a hand's palm, approximated
     * as the average of wrist + all four MCP knuckles. Used as the portal center for
     * HAND_PORTAL and as one corner for TWO_HAND_FRAME's rectangle.
     */
    fun palmCenter(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Pair<Float, Float> {
        val idxs = intArrayOf(0, 5, 9, 13, 17)
        var sx = 0f; var sy = 0f
        for (i in idxs) { sx += landmarks[i].x(); sy += landmarks[i].y() }
        return (sx / idxs.size) to (sy / idxs.size)
    }

    /**
     * Angle (radians) of the wrist(0)->index-MCP(5) vector, in the same
     * normalized-image coordinate space palmCenter() uses. Used by FIRE_BOOK
     * to rotate the book quad to match how the hand is actually tilted,
     * instead of always drawing it screen-axis-aligned regardless of hand
     * orientation  -  that mismatch was the main reason the book previously
     * read as "pasted on" rather than "held." Y is inverted (image-space Y
     * grows downward, screen/GL rotation here follows the same convention
     * FrameRenderer's other angle math already uses)  -  negate if a caller
     * ever needs true screen-up-positive angles instead.
     */
    fun handAngle(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Float {
        val wrist = landmarks[0]
        val indexMcp = landmarks[5]
        return kotlin.math.atan2(indexMcp.y() - wrist.y(), indexMcp.x() - wrist.x())
    }

    private fun dist(x1: Float, y1: Float, x2: Float, y2: Float): Float {
        val dx = x1 - x2; val dy = y1 - y2
        return kotlin.math.sqrt(dx * dx + dy * dy)
    }

    /** Call once when done baking  -  releases the model's native resources. */
    fun close() {
        handLandmarker.close()
    }
}   
