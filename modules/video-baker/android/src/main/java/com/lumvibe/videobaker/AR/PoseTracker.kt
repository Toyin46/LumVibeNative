package com.lumvibe.videobaker.AR

import android.content.Context
import android.graphics.Bitmap
import android.graphics.RectF
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker.PoseLandmarkerOptions

/**
 * New this pass — the one tracker your app didn't have yet (only
 * face/hand/segmentation existed). Needed for tiny_body, which needs a
 * body bounding box no existing tracker produces.
 *
 * NOTE: this is written against MediaPipe's real public PoseLandmarker
 * Kotlin API and follows the same GPU-delegate-with-CPU-fallback shape
 * your FaceTracker.kt/HandTracker.kt already use — but I wrote this from
 * the MediaPipe API directly, not by re-reading your FaceTracker.kt's
 * exact text this pass, so double check the try/catch delegate fallback
 * block matches your established convention exactly (it should be
 * structurally identical) before shipping. Model file: download
 * pose_landmarker_lite.task (fastest, sufficient for a bounding box) or
 * pose_landmarker_full.task from
 * https://storage.googleapis.com/mediapipe-models/pose_landmarker/ — same
 * bundling convention as your existing face_landmarker.task/
 * hand_landmarker.task (see this module's assets folder).
 */
class PoseTracker(context: Context) {

    data class Result(
        val boundingBox: RectF,
    )

    private var landmarker: PoseLandmarker? = null

    init {
        val baseOptionsBuilder = BaseOptions.builder().setModelAssetPath("pose_landmarker_lite.task")
        val baseOptions = try {
            baseOptionsBuilder.setDelegate(Delegate.GPU).build()
        } catch (e: Exception) {
            // Same fallback reasoning as your other trackers: some devices'
            // GPU delegate doesn't support every model; CPU always works.
            baseOptionsBuilder.setDelegate(Delegate.CPU).build()
        }

        val options = PoseLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.IMAGE)
            .setMinPoseDetectionConfidence(0.5f)
            .setMinTrackingConfidence(0.5f)
            .setMinPosePresenceConfidence(0.5f)
            .setNumPoses(1)
            .build()

        landmarker = try {
            PoseLandmarker.createFromOptions(context, options)
        } catch (e: Exception) {
            null // same "tracker unavailable, effects requiring it just get isEffectAvailable()==false" degradation as the rest of the engine
        }
    }

    /**
     * Returns null if no pose detected or the tracker failed to
     * initialize — callers should pass `body = null` to
     * LumVibeEngineBridge.updateSignals() in that case, which falls back
     * to Signals.h's default box rather than crashing.
     */
    fun detect(bitmap: Bitmap): Result? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = landmarker?.detect(mpImage) ?: return null
        val landmarksList = result.landmarks()
        if (landmarksList.isEmpty()) return null

        // Reduce the 33 pose landmarks to a single bounding box — the only
        // signal tiny_body.ts needs today. Extend this (return actual
        // joint positions) only if a future effect needs more than a box.
        val points = landmarksList[0]
        var minX = Float.MAX_VALUE; var minY = Float.MAX_VALUE
        var maxX = Float.MIN_VALUE; var maxY = Float.MIN_VALUE
        for (p in points) {
            if (p.x() < minX) minX = p.x()
            if (p.y() < minY) minY = p.y()
            if (p.x() > maxX) maxX = p.x()
            if (p.y() > maxY) maxY = p.y()
        }
        return Result(boundingBox = RectF(minX, minY, maxX, maxY))
    }

    fun close() { landmarker?.close() }
}
