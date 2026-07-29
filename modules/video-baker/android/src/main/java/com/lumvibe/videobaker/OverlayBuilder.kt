package com.lumvibe.videobaker

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.opengl.GLES20
import android.opengl.GLUtils

/** Pixel dimensions of an uploaded logo texture, needed for bounce-position math. */
data class LogoTexture(val textureId: Int, val widthPx: Float, val heightPx: Float)

/**
* Builds overlay textures using Android's normal 2D Canvas (CPU, cheap).
*
* Two separate textures now, instead of one combined one:
*  - Caption text: still a single full-frame transparent bitmap (static position, drawn once).
*  - Watermark logo: its own small standalone texture, sized to its natural aspect
*    ratio, so VideoTranscoder can move it around frame-by-frame (bouncing
*    DVD-logo style) instead of it being burned into one fixed spot.
*/
object OverlayBuilder {

    /**
     * Full-frame transparent bitmap with just the caption text drawn on it (or null
     * if there's no caption). Static position — drawn the same every frame.
     */
    fun buildCaptionOverlay(
        width: Int,
        height: Int,
        captionText: String?
    ): Int? {
        if (captionText.isNullOrEmpty()) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = height * 0.045f
            setShadowLayer(6f, 0f, 0f, Color.BLACK)
            textAlign = Paint.Align.CENTER
        }
        val x = width / 2f
        val y = height * 0.90f
        canvas.drawText(captionText, x, y, paint)

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        bitmap.recycle()
        return textureId
    }

    /**
     * The watermark logo as its own small texture (transparent background, natural
     * aspect ratio, scaled to targetWidthPx wide). Returns null if no watermark
     * path given or the file can't be decoded.
     */
    fun buildLogoTexture(
        watermarkPngPath: String?,
        targetWidthPx: Float
    ): LogoTexture? {
        if (watermarkPngPath == null) return null
        val src = BitmapFactory.decodeFile(watermarkPngPath) ?: return null

        val scale = targetWidthPx / src.width
        val targetH = src.height * scale
        val scaledBitmap = Bitmap.createBitmap(targetWidthPx.toInt().coerceAtLeast(1), targetH.toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(scaledBitmap)
        canvas.drawBitmap(src, null, RectF(0f, 0f, targetWidthPx, targetH), null)
        src.recycle()

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, scaledBitmap, 0)
        val result = LogoTexture(textureId, targetWidthPx, targetH)
        scaledBitmap.recycle()
        return result
    }
} 
