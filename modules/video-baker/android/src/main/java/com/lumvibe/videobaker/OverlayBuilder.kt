package com.lumvibe.videobaker

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.opengl.GLES20
import android.opengl.GLUtils

/**
* Builds the watermark + caption overlay as a single transparent Bitmap using
* Android's normal 2D Canvas (CPU, cheap, runs once — not per frame), then
* uploads it to a GL texture that FrameRenderer draws on top of every frame.
*
* Stickers can be added the same way: draw their bitmaps onto this canvas too.
*/
object OverlayBuilder {

    /**
     * @param width / height must match the output video's dimensions.
     * @param watermarkPngPath absolute file path to a PNG with transparency, or null to skip.
     * @param captionText optional text burned onto the video, or null to skip.
     */
    fun build(
        width: Int,
        height: Int,
        watermarkPngPath: String?,
        captionText: String?,
        watermarkMarginPx: Int = 24
    ): Int {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        if (watermarkPngPath != null) {
            val wm = BitmapFactory.decodeFile(watermarkPngPath)
            if (wm != null) {
                // Scale watermark to ~18% of video width, keep aspect ratio, bottom-right corner.
                val targetW = (width * 0.18f)
                val scale = targetW / wm.width
                val targetH = wm.height * scale
                val left = width - targetW - watermarkMarginPx
                val top = height - targetH - watermarkMarginPx
                val destRect = android.graphics.RectF(left, top, left + targetW, top + targetH)
                canvas.drawBitmap(wm, null, destRect, null)
                wm.recycle()
            }
        }

        if (!captionText.isNullOrEmpty()) {
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = height * 0.045f
                setShadowLayer(6f, 0f, 0f, Color.BLACK)
                textAlign = Paint.Align.CENTER
            }
            val x = width / 2f
            val y = height * 0.90f
            canvas.drawText(captionText, x, y, paint)
        }

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        bitmap.recycle()
        return textureId
    }
} 
