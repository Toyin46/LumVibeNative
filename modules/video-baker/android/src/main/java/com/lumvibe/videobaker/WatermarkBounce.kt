package com.lumvibe.videobaker

/**
* DVD-logo-style bounce, computed as a pure function of elapsed time — no
* per-frame stateful position updates, no accumulation error. Independent X
* and Y speeds are what make it look like a real bouncing-logo path instead
* of a straight diagonal line that just repeats.
*
* Because this is driven by presentation time (see VideoTranscoder), the
* bounce path is identical every time you re-bake the same input video —
* it doesn't depend on how fast the decode/encode loop happens to run on a
* given device.
*/
object WatermarkBounce {

    /**
     * Returns (leftPx, topPx) — the watermark's top-left corner in pixels — for
     * the given elapsed time.
     *
     * @param logoWidthPx / logoHeightPx the ACTUAL watermark texture size (from
     *   OverlayBuilder.LogoTexture), so the logo never bounces past the edge.
     * @param speedXPxPerSec / speedYPxPerSec deliberately different by default —
     *   equal speeds make the logo trace the same diagonal line back and forth,
     *   which reads as fake; different speeds give the classic wandering path.
     */
    fun position(
        elapsedSec: Float,
        canvasWidth: Int,
        canvasHeight: Int,
        logoWidthPx: Float,
        logoHeightPx: Float,
        speedXPxPerSec: Float = 90f,
        speedYPxPerSec: Float = 65f,
        startLeftPx: Float = 0f,
        startTopPx: Float = 0f
    ): Pair<Float, Float> {
        val rangeX = (canvasWidth - logoWidthPx).coerceAtLeast(1f)
        val rangeY = (canvasHeight - logoHeightPx).coerceAtLeast(1f)

        val left = triangleWave(startLeftPx + speedXPxPerSec * elapsedSec, rangeX)
        val top = triangleWave(startTopPx + speedYPxPerSec * elapsedSec, rangeY)
        return left to top
    }

    /** Folds an unbounded distance back and forth between 0 and [range], ping-pong style. */
    private fun triangleWave(distance: Float, range: Float): Float {
        val period = 2f * range
        var m = distance % period
        if (m < 0f) m += period
        return if (m <= range) m else period - m
    }
}  
