package com.lumvibe.videobaker

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint

/**
* FACE_MORPH's wireframe mesh. Connects each landmark to its own nearest
* neighbors, computed live from the REAL detected (x,y) positions this frame —
* not a hardcoded MediaPipe tesselation edge list. I don't have verified
* confidence in the exact ~900-edge official topology from memory, and
* getting indices subtly wrong would produce a visibly broken mesh (lines
* connecting unrelated face regions) — a genuine proximity graph sidesteps
* that risk entirely while still producing a real, recognizable wireframe
* built from real per-frame data.
*
* Runs on the Kotlin/CPU side (not a shader) specifically so it can use the
* FULL landmark set with no GLSL uniform-array size risk — see
* EffectShaders.faceMorphComposite's doc for why that mattered. Composited
* via the existing uploadSecondaryTexture/uMaskTexture mechanism, same as
* DEPTH_BLOOM/GOLD_SKIN already use.
*/
object FaceMeshRenderer {

    private const val NEIGHBORS_PER_POINT = 3
    // Every 3rd landmark, not all 468 — keeps the O(n²) neighbor search and
    // the Canvas draw-call count bounded per frame (a real per-frame CPU cost,
    // not free — see section 19's performance requirement). If this proves too
    // slow on a budget test device, the first thing to try is throttling this
    // to every 2nd/3rd PROCESSED frame and holding the last mesh bitmap in
    // between, same throttle pattern LiveEffectPreviewView already uses for
    // live tracking — not implemented here to keep this piece reviewable, but
    // flagged clearly rather than silently risking a stutter.
    private const val STRIDE = 3

    /**
     * [splitX] is normalized 0..1 — the mesh is drawn only for landmarks with
     * x() < splitX, producing the half-face split. The other half of the
     * returned bitmap is fully transparent (alpha 0), which is what makes the
     * composite shader's mix(base, mesh, mesh.a) leave that half untouched
     * without the shader needing to know anything about "halves" at all.
     */
    fun buildMeshBitmap(
        width: Int, height: Int,
        landmarks: List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>,
        splitX: Float
    ): Bitmap {
        val bitmap = Bitmap.createBitmap(width.coerceAtLeast(1), height.coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        // FIX (confirmed real bug from your screenshot - the mesh only
        // covered a small chunk near the mouth/chin, not "half the face"):
        // splitX was compared directly against each landmark's x() in
        // CAMERA-FRAME coordinate space (0..1 across the WHOLE image), not
        // relative to where the face itself actually sits. A face is rarely
        // dead-center in a handheld selfie, so "x < 0.5" was grabbing
        // whatever arbitrary sliver of the face happened to fall left of the
        // frame's exact horizontal center - could be a tenth of the face,
        // could be nearly all of it, depending entirely on framing. Fixed by
        // computing the split relative to the FACE'S OWN bounding box, so
        // splitX=0.5 now genuinely means "the middle of the face," always,
        // regardless of where the face sits in the camera frame. Both call
        // sites (live + bake) already pass 0.5f expecting exactly that
        // meaning, so this fix applies to both without touching either.
        if (landmarks.isEmpty()) return bitmap
        val faceMinX = landmarks.minOf { it.x() }
        val faceMaxX = landmarks.maxOf { it.x() }
        val faceSplitThreshold = faceMinX + (faceMaxX - faceMinX) * splitX

        val filtered = landmarks.filterIndexed { i, lm -> i % STRIDE == 0 && lm.x() < faceSplitThreshold }
        if (filtered.isEmpty()) return bitmap

        val pxPoints = filtered.map { it.x() * width to it.y() * height }

        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(160, 120, 220, 255)
            strokeWidth = 1.5f
        }
        val dotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.argb(220, 180, 240, 255)
        }

        for (i in pxPoints.indices) {
            val (x0, y0) = pxPoints[i]
            // Real computed nearest neighbors by squared distance (avoids a
            // sqrt per pair — only the ORDER matters for picking the closest
            // few, not the actual distance value).
            val nearest = pxPoints.indices.filter { it != i }
                .map { j ->
                    val dx = pxPoints[j].first - x0
                    val dy = pxPoints[j].second - y0
                    j to (dx * dx + dy * dy)
                }
                .sortedBy { it.second }
                .take(NEIGHBORS_PER_POINT)

            for ((j, _) in nearest) {
                val (x1, y1) = pxPoints[j]
                canvas.drawLine(x0, y0, x1, y1, linePaint)
            }
            canvas.drawCircle(x0, y0, 2f, dotPaint)
        }

        return bitmap
    }
} 
