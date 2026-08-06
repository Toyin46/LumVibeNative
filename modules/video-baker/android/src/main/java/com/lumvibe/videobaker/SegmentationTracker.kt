package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.ByteBufferExtractor
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.imagesegmenter.ImageSegmenter
import java.nio.ByteBuffer

/**
* Same VIDEO-mode wrapper pattern as FaceTracker/HandTracker, this time around
* MediaPipe's Image Segmenter — separates "person" (foreground) from everything
* else (background) per frame. Feeds DEPTH_BLOOM (background gets the bloom,
* foreground stays sharp) and SPLIT_PRISM (background splits into RGB layers,
* foreground doesn't).
*
* REQUIRES, as real setup steps outside this file:
*   1. Add to build.gradle:  implementation 'com.google.mediapipe:tasks-vision:0.10.26'
*      (same artifact as FaceTracker/HandTracker — one dependency line covers all three)
*   2. Download selfie_segmenter.tflite from:
*      https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
*      and place it in app/src/main/assets/ alongside the other two .task files.
*      (This one ships as a .tflite, not .task — that's correct, not a typo; confirm
*      against MediaPipe's current model index before building in case the hosted
*      path has moved.)
*
* COST NOTE: like FaceTracker/HandTracker, this needs a Bitmap readback of the
* current frame, and produces its OWN Bitmap (the mask) that then needs uploading
* to the GPU as a texture before the effect shader can use it. For any frame using
* DEPTH_BLOOM or SPLIT_PRISM that means: readback -> segment -> mask upload -> draw.
* Noticeably heavier per-frame than the blendshape-only effects — expect baking
* to run slower with these two selected. Confirm real-world speed on a test clip
* before assuming it's fast enough for your users' typical clip length.
*/
class SegmentationTracker(context: Context) {

    private val segmenter: ImageSegmenter = run {
        val baseOptions = BaseOptions.builder()
            .setModelAssetPath("selfie_segmenter.tflite")
            .build()
        val options = ImageSegmenter.ImageSegmenterOptions.builder()
            .setBaseOptions(baseOptions)
            .setRunningMode(RunningMode.VIDEO)
            .setOutputCategoryMask(true)
            .setOutputConfidenceMasks(false)
            .build()
        ImageSegmenter.createFromOptions(context, options)
    }

    /**
     * Returns a grayscale Bitmap the same size as [bitmap] — white (255) where the
     * segmenter thinks it's foreground/person, black (0) elsewhere. Caller uploads
     * this as a GL_TEXTURE_2D (see OverlayBuilder.buildCaptionTexture for the same
     * upload pattern) and passes it to the shader as uMaskTexture.
     *
     * Returns null if segmentation produced no mask this frame (rare, but the
     * result's categoryMask() is an Optional<> per MediaPipe's own API — treat
     * absence as "no confident split this frame," same skip-not-error policy as
     * FaceTracker/HandTracker.
     */
    fun maskBitmap(bitmap: Bitmap, timestampMs: Long): Bitmap? {
        val mpImage = BitmapImageBuilder(bitmap).build()
        val result = segmenter.segmentForVideo(mpImage, timestampMs)
        val categoryMask = result.categoryMask().orElse(null) ?: return null

        val w = categoryMask.width
        val h = categoryMask.height
        // MPImage doesn't expose pixel data as a direct property — MediaPipe requires
        // going through this extractor utility. (My earlier version used
        // `categoryMask.byteBuffer`, which doesn't exist and is what broke your build —
        // confirmed against MediaPipe's own sample code before writing this fix, not
        // guessed twice.)
        val maskBuffer: ByteBuffer = ByteBufferExtractor.extract(categoryMask)
        maskBuffer.rewind()

        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ALPHA_8)
        // ALPHA_8 rows must be copied through a ByteBuffer directly (no per-pixel
        // setPixel — that's ARGB-only and would silently fail on an alpha-only
        // bitmap). selfie_segmenter's category 0 = background, category 1 = person,
        // per its published label map — confirm against the model's own metadata
        // if you swap in a different segmentation model later, since category
        // indices are model-specific, not a MediaPipe-wide constant.
        val outBuffer = ByteBuffer.allocate(w * h)
        for (i in 0 until w * h) {
            val category = maskBuffer.get(i).toInt() and 0xFF
            outBuffer.put(i, if (category == 1) 0xFF.toByte() else 0x00.toByte())
        }
        outBuffer.rewind()
        out.copyPixelsFromBuffer(outBuffer)
        return out
    }

    /** Call once when done baking — releases the model's native resources. */
    fun close() {
        segmenter.close()
    }
} 
