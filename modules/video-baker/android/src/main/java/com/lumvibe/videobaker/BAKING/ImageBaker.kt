package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.ExifInterface
import android.opengl.GLES20
import android.view.Surface
import java.io.File
import java.io.FileOutputStream

/**
* Bakes an AR effect into a still image — same trackers (FaceTracker/HandTracker/
* SegmentationTracker), same EffectShaders, same FrameRenderer as VideoTranscoder
* uses for video, run ONCE instead of per-frame. This is deliberate: it's what
* "don't maintain separate effect implementations" (section 14) actually requires
* in practice, not just in principle.
*
* THE ONE REAL ARCHITECTURE DECISION HERE, worth restating: every effect shader
* expects `samplerExternalOES uTexture` (that's what video decoding produces). A
* plain Bitmap is a completely different, incompatible GLSL sampler type — you
* cannot bind a Bitmap-uploaded GL_TEXTURE_2D to a shader written for
* samplerExternalOES. So the source Bitmap gets bridged through a SurfaceTexture
* (draw it onto a Canvas-backed Surface, then updateTexImage() to read it back as
* an external OES texture) — a standard, real Android technique, not a hack. This
* means all 24+ existing shaders work completely unchanged; nothing was
* duplicated into a second sampler2D variant.
*/
class ImageBaker {

    data class Options(
        val watermarkPngPath: String? = null,
        val watermarkUsername: String? = null,
        val watermarkWidthFraction: Float = 0.18f,
        val watermarkCardWidthFraction: Float = 0.42f,
        val captionText: String? = null,
        val brightness: Float = 0f,
        val contrast: Float = 1f,
        val saturation: Float = 1f,
        // Same key vocabulary as VideoTranscoder.Options.effect — see
        // VisualEffect.fromKey for the authoritative list.
        val effect: String? = null,
        val effectIntensity: Float = 1f,
        val portalScenePngPath: String? = null
    )

    /**
     * Synchronous, single-shot — no progress callback the way video baking has
     * one, since this is a single frame, not thousands. Throws on real failure
     * (bad input path, GL init failure) rather than silently producing a broken
     * output — matches section 21's "never crash, but never silently pretend it
     * worked" requirement: the caller's try/catch (see VideoBakerModule's
     * bakeImage) decides what the user sees.
     */
    fun bake(context: Context, inputPath: String, outputPath: String, options: Options) {
        val decodedBitmap = BitmapFactory.decodeFile(inputPath)
            ?: throw IllegalArgumentException("Could not decode image at $inputPath — not a valid image file, or path is not a plain filesystem path")

        // FIX: BitmapFactory.decodeFile does NOT auto-correct EXIF orientation —
        // phone cameras very commonly store pixel data in landscape plus a
        // rotation flag rather than physically rotating the pixels. Without this,
        // a portrait photo could bake sideways or mirrored. Applied once, up
        // front, so every tracker/shader/output step downstream works on
        // correctly-oriented pixels without needing to know EXIF exists.
        val sourceBitmap = correctOrientation(decodedBitmap, inputPath)

        val width = sourceBitmap.width
        val height = sourceBitmap.height
        val selectedEffect = VisualEffect.fromKey(options.effect)

        val needsFace = EffectRequirements.needsFaceTracker(selectedEffect)
        val needsHand = EffectRequirements.needsHandTracker(selectedEffect)
        val needsSeg = EffectRequirements.needsSegmentation(selectedEffect)

        val faceTracker = if (needsFace) FaceTracker(context) else null
        val handTracker = if (needsHand) HandTracker(context) else null
        val segmentationTracker = if (needsSeg) SegmentationTracker(context) else null

        var eglCore: EglCore? = null
        var pbufferSurface: android.opengl.EGLSurface? = null
        var renderer: FrameRenderer? = null
        var bridgeSurface: Surface? = null
        var surfaceTexture: SurfaceTexture? = null

        try {
            eglCore = EglCore()
            pbufferSurface = eglCore.createOffscreenSurface(width, height)
            eglCore.makeCurrent(pbufferSurface)

            renderer = FrameRenderer().apply {
                setup()
                setFrameSize(width, height)
                ensureSecondaryTexture()
            }

            // Bridge: draw the source bitmap onto a SurfaceTexture-backed Surface,
            // then read it back as an external OES texture — see class doc above
            // for why this step exists at all.
            val oesTexId = GlUtil.createExternalTexture()
            surfaceTexture = SurfaceTexture(oesTexId).apply {
                setDefaultBufferSize(width, height)
            }
            bridgeSurface = Surface(surfaceTexture)
            val waiter = FrameWaiter()
            surfaceTexture.setOnFrameAvailableListener(waiter.listener())

            val canvas = bridgeSurface.lockCanvas(null)
            canvas.drawBitmap(sourceBitmap, 0f, 0f, null)
            bridgeSurface.unlockCanvasAndPost(canvas)
            waiter.await()
            surfaceTexture.updateTexImage()
            val texMatrix = FloatArray(16)
            surfaceTexture.getTransformMatrix(texMatrix)

            // Tracking — a single call with timestamp 0 is valid: these trackers
            // run in RunningMode.VIDEO, which only requires timestamps to
            // increase across calls to the SAME instance, and this instance has
            // never been called before. No separate IMAGE-mode tracker needed.
            val faceResult = faceTracker?.detect(sourceBitmap, 0L)
            val handResult = handTracker?.detect(sourceBitmap, 0L)
            val handLandmarksList = handResult?.landmarks()

            renderer.brightness = options.brightness
            renderer.contrast = options.contrast
            renderer.saturation = options.saturation
            renderer.setEffect(selectedEffect)
            renderer.effectIntensity = options.effectIntensity

            EffectRequirements.applyStaticFrame(renderer, selectedEffect, faceTracker, faceResult, handTracker, handLandmarksList)

            if (needsSeg && segmentationTracker != null) {
                val mask = segmentationTracker.maskBitmap(sourceBitmap, 0L)
                if (mask != null) {
                    renderer.uploadSecondaryTexture(mask)
                    mask.recycle()
                }
                // else: no mask this call — GOLD_SKIN/SPLIT_PRISM/DEPTH_BLOOM's
                // shaders sample uMaskTexture as an all-zero/uninitialized
                // texture in that case, which reads as "no person detected,"
                // not a crash — consistent with section 21's fallback intent.
            }

            if (selectedEffect == VisualEffect.HAND_PORTAL && options.portalScenePngPath != null) {
                val portalBitmap = OverlayBuilder.loadPortalSceneBitmap(options.portalScenePngPath)
                if (portalBitmap != null) {
                    renderer.uploadSecondaryTexture(portalBitmap)
                    portalBitmap.recycle()
                }
            }

            renderer.drawEffectFrame(oesTexId, texMatrix, 0f)

            if (!options.captionText.isNullOrBlank()) {
                val capTexId = OverlayBuilder.buildCaptionTexture(width, height, options.captionText)
                if (capTexId != null) {
                    renderer.drawOverlay(capTexId)
                    GLES20.glDeleteTextures(1, intArrayOf(capTexId), 0)
                }
            }

            if (options.watermarkPngPath != null) {
                val logo = if (options.watermarkUsername != null) {
                    OverlayBuilder.buildWatermarkCard(options.watermarkPngPath, options.watermarkUsername, width * options.watermarkCardWidthFraction)
                } else {
                    OverlayBuilder.buildWatermarkLogo(options.watermarkPngPath, width * options.watermarkWidthFraction)
                }
                if (logo != null) {
                    // Static bottom-right placement — a still image has nowhere
                    // to bounce to, matching VideoTranscoder's watermarkBounce=false
                    // static-corner behaviour, not a new convention invented here.
                    val margin = width * 0.03f
                    val left = width - logo.widthPx - margin
                    val top = height - logo.heightPx - margin
                    renderer.drawWatermarkAt(logo.textureId, left, top, logo.widthPx, logo.heightPx, width, height)
                    GLES20.glDeleteTextures(1, intArrayOf(logo.textureId), 0)
                }
            }

            val resultBitmap = GlUtil.readPixelsAsBitmap(width, height)
            File(outputPath).parentFile?.mkdirs()
            FileOutputStream(outputPath).use { out ->
                resultBitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
            }
            resultBitmap.recycle()
        } finally {
            // Cleanup order matches VideoTranscoder's own release pattern:
            // renderer/GL resources first (still need a current EGL context to
            // delete GL objects cleanly), then the EGL context itself, then
            // plain Android objects that don't depend on GL being current.
            renderer?.release()
            pbufferSurface?.let { eglCore?.releaseSurface(it) }
            eglCore?.release()
            bridgeSurface?.release()
            surfaceTexture?.release()
            sourceBitmap.recycle()
            faceTracker?.close()
            handTracker?.close()
            segmentationTracker?.close()
        }
    }

    /**
     * Applies the EXIF orientation tag as an actual pixel transform, covering all
     * 8 defined EXIF orientation values (not just the 3 common rotations) —
     * FLIP_HORIZONTAL/VERTICAL and the two transpose cases exist and do occur,
     * mainly from certain scanning apps and some older device firmwares. Returns
     * a NEW bitmap in every non-identity case and recycles the input, so the
     * caller always ends up with exactly one correctly-oriented bitmap, never two
     * copies alive at once.
     */
    private fun correctOrientation(bitmap: Bitmap, path: String): Bitmap {
        val orientation = try {
            ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (e: Exception) {
            ExifInterface.ORIENTATION_NORMAL // unreadable EXIF — treat as already-correct rather than fail the whole bake
        }
        if (orientation == ExifInterface.ORIENTATION_NORMAL || orientation == ExifInterface.ORIENTATION_UNDEFINED) return bitmap

        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.postScale(-1f, 1f) }
            else -> return bitmap
        }
        val corrected = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (corrected !== bitmap) bitmap.recycle()
        return corrected
    }
} 
