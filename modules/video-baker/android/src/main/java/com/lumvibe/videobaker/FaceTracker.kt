package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
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

    private val faceLandmarker: FaceLandmarker = run {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("face_landmarker.task")
            .build()
        val options = FaceLandmarker.FaceLandmarkerOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.VIDEO)
            .setOutputFaceBlendshapes(true)
            .setNumFaces(1)
            .build()
        FaceLandmarker.createFromOptions(context, options)
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

    /** Call once when done baking — releases the model's native resources. */
    fun close() {
        faceLandmarker.close()
    }
} 
