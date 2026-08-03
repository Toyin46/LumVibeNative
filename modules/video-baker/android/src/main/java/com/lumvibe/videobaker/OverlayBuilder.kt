package com.lumvibe.videobaker

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.opengl.GLES20
import android.opengl.GLUtils
import android.util.Log

/**
* Caption and watermark are now two SEPARATE textures instead of one flattened
* bitmap. That's the change that makes bouncing possible: the caption stays a
* static full-frame texture (drawn in the same spot every frame, cheap), but
* the watermark logo is its own small texture with known pixel dimensions, so
* VideoTranscoder can move it to a different position every frame.
*/
object OverlayBuilder {

    /** Pixel dimensions of the watermark texture — needed for bounce-boundary math. */
    data class LogoTexture(val textureId: Int, val widthPx: Float, val heightPx: Float)

    /**
     * Full-frame transparent texture with just the caption text on it, or null if
     * there's no caption. Static position, computed once and reused every frame.
     */
    fun buildCaptionTexture(width: Int, height: Int, captionText: String?): Int? {
        if (captionText.isNullOrEmpty()) return null

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = height * 0.045f
            setShadowLayer(6f, 0f, 0f, Color.BLACK)
            textAlign = Paint.Align.CENTER
        }
        canvas.drawText(captionText, width / 2f, height * 0.90f, paint)

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        bitmap.recycle()
        return textureId
    }

    /**
     * The watermark logo as its own small texture (transparent background, natural
     * aspect ratio, scaled so it's [targetWidthPx] wide). Returns null if no path
     * given or the file can't be decoded.
     *
     * [LogoTexture.widthPx]/[heightPx] are the ACTUAL bitmap pixel dimensions used to
     * build the texture (not the raw un-rounded request) — that match matters, because
     * WatermarkBounce.position() uses these numbers to compute the bounce boundary, and
     * any mismatch there would show up as the logo drifting slightly past the edge.
     */
    fun buildWatermarkLogo(watermarkPngPath: String?, targetWidthPx: Float): LogoTexture? {
        if (watermarkPngPath == null) return null
        val src = BitmapFactory.decodeFile(watermarkPngPath) ?: run {
            Log.w("OverlayBuilder", "buildWatermarkLogo: BitmapFactory.decodeFile returned null for path: $watermarkPngPath (not a plain filesystem path, or file missing?)")
            return null
        }

        val scale = targetWidthPx / src.width
        val targetW = targetWidthPx.toInt().coerceAtLeast(1)
        val targetH = (src.height * scale).toInt().coerceAtLeast(1)

        val scaledBitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(scaledBitmap)
        canvas.drawBitmap(src, null, RectF(0f, 0f, targetW.toFloat(), targetH.toFloat()), null)
        src.recycle()

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, scaledBitmap, 0)
        val result = LogoTexture(textureId, targetW.toFloat(), targetH.toFloat())
        scaledBitmap.recycle()
        return result
    }

    /**
     * A branded watermark "card" — dark rounded background, small logo on the left,
     * "LumVibe" + "@username" text on the right — matching the videos.tsx
     * watermarkOverlay component's design (rgba(0,0,0,0.7) background, 8px radius,
     * row layout, logo + two-line text) so the baked-in version looks the same as
     * the in-app UI overlay, instead of the plain text that was baked before.
     *
     * Returns the whole card as ONE texture, so WatermarkBounce moves the logo and
     * text together as a single unit — same as the Animated.View wrapping both in
     * the RN component.
     */
    fun buildWatermarkCard(logoPngPath: String?, username: String, cardWidthPx: Float): LogoTexture? {
        if (logoPngPath == null) return null
        val logoSrc = BitmapFactory.decodeFile(logoPngPath) ?: run {
            Log.w("OverlayBuilder", "buildWatermarkCard: BitmapFactory.decodeFile returned null for path: $logoPngPath (not a plain filesystem path, or file missing?)")
            return null
        }

        // Scale factor relative to a 220px-wide reference design, so padding/text/icon
        // size stay proportional whatever cardWidthPx ends up being.
        val density = cardWidthPx / 220f
        val paddingPx = 10f * density
        val gapPx = 6f * density
        val iconSizePx = 40f * density
        val cornerRadiusPx = 8f * density
        val titleSizePx = 15f * density
        val usernameSizePx = 12f * density
        val cardHeightPx = iconSizePx + paddingPx * 2

        val cardW = cardWidthPx.toInt().coerceAtLeast(1)
        val cardH = cardHeightPx.toInt().coerceAtLeast(1)
        val bitmap = Bitmap.createBitmap(cardW, cardH, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        // Dark rounded background — same rgba(0,0,0,0.7) as watermarkOverlay's style.
        val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(178, 0, 0, 0) }
        canvas.drawRoundRect(RectF(0f, 0f, cardW.toFloat(), cardH.toFloat()), cornerRadiusPx, cornerRadiusPx, bgPaint)

        // Logo icon, left-aligned, vertically centered in the card.
        val logoDest = RectF(paddingPx, paddingPx, paddingPx + iconSizePx, paddingPx + iconSizePx)
        canvas.drawBitmap(logoSrc, null, logoDest, null)
        logoSrc.recycle()

        // "LumVibe" (bold white) + "@username" (smaller light grey), stacked to the
        // right of the logo — same two-line structure as the RN component.
        val textX = paddingPx + iconSizePx + gapPx
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = titleSizePx
            isFakeBoldText = true
            textAlign = Paint.Align.LEFT
        }
        val usernamePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(255, 190, 190, 190)
            textSize = usernameSizePx
            textAlign = Paint.Align.LEFT
        }
        canvas.drawText("LumVibe", textX, cardH / 2f - 4f * density, titlePaint)
        canvas.drawText("@$username", textX, cardH / 2f + usernameSizePx, usernamePaint)

        val textureId = GlUtil.createTexture2D()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
        val result = LogoTexture(textureId, cardW.toFloat(), cardH.toFloat())
        bitmap.recycle()
        return result
    }
} 
