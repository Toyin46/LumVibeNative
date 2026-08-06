package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

/**
* Same pattern as FaceTracker — thin VIDEO-mode wrapper, one bitmap in, landmarks
* out. Kept as a SEPARATE class/model rather than folded into FaceTracker because
* MediaPipe ships hand and face landmarking as two separate .task models; running
* both means two readbacks + two inferences per frame for any effect that needs
* both (none of the current 22 do at once, but HAND_PORTAL needs hands only).
*
* REQUIRES, as real setup steps outside this file:
*   1. Add to build.gradle:  implementation 'com.google.mediapipe:tasks-vision:0.10.26'
*      (same artifact as FaceTracker — one dependency covers both landmarkers;
*      confirm the version already in your build.gradle matches, don't add a
*      second tasks-vision line)
*   2. Download hand_landmarker.task from:
*      https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
*      and place it in app/src/main/assets/ alongside face_landmarker.task
*
* Landmark indices used below follow MediaPipe's 21-point hand model
* (https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) —
* WRIST=0, THUMB_TIP=4, INDEX_TIP=8, MIDDLE_TIP=12, RING_TIP=16, PINKY_TIP=20,
* and each finger's *_MCP (knuckle) is TIP_INDEX - 3.
*/
class HandTracker(context: Context) {

    private val handLandmarker: HandLandmarker = run {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("hand_landmarker.task")
            .build()
        val options = HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.VIDEO)
            .setNumHands(2) // TWO_HAND_FRAME needs both hands visible at once
            .build()
        HandLandmarker.createFromOptions(context, options)
    }

    /** Same monotonic-timestamp contract as FaceTracker.detect(). Returns null if
     *  zero hands were found this frame — treat as "no gesture this frame," not an error. */
    fun detect(bitmap: Bitmap, timestampMs: Long): HandLandmarkerResult? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = handLandmarker.detectForVideo(mpImage, timestampMs)
        return if (result.landmarks().isEmpty()) null else result
    }

    /**
     * A simple, explainable "is this a closed fist" heuristic for FIST_BUMP_BOOM:
     * true when all four non-thumb fingertips are closer to the wrist than their
     * own knuckle is — i.e. curled in, not extended. Deliberately not using a
     * pretrained gesture classifier (MediaPipe also ships one, GestureRecognizer)
     * to avoid a THIRD model/asset; this heuristic is a known simplification and
     * should be tuned against a real test clip (a fist held sideways or partly
     * out-of-frame may not trigger it) rather than assumed correct on paper.
     */
    fun isFist(landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>): Boolean {
        val wrist = landmarks[0]
        fun curled(tipIdx: Int): Boolean {
            val tip = landmarks[tipIdx]
            val knuckle = landmarks[tipIdx - 3]
            val tipDist = dist(tip.x(), tip.y(), wrist.x(), wrist.y())
            val knuckleDist = dist(knuckle.x(), knuckle.y(), wrist.x(), wrist.y())
            return tipDist < knuckleDist
        }
        return curled(8) && curled(12) && curled(16) && curled(20)
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

    private fun dist(x1: Float, y1: Float, x2: Float, y2: Float): Float {
        val dx = x1 - x2; val dy = y1 - y2
        return kotlin.math.sqrt(dx * dx + dy * dy)
    }

    /** Call once when done baking — releases the model's native resources. */
    fun close() {
        handLandmarker.close()
    }
} 
