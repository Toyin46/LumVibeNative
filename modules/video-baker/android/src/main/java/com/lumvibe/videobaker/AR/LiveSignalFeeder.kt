package com.lumvibe.videobaker

import android.content.Context
import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLUtils
import android.os.SystemClock
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import org.json.JSONObject

/**
 * STAGE A. Reads effects.manifest.json (the same file the C++ engine loads) so the live
 * preview knows, per effect: does the engine know it, and which trackers does it need.
 */
object EngineManifest {
    private var loaded = false
    private val requiresById = HashMap<String, Set<String>>()
    private val motionIds = HashSet<String>()

    /**
     * Effects that still run on the OLD Kotlin renderer in Stage A because they need
     * Kotlin-side overlays/assets the engine can't draw yet (frozen frame, text bubbles,
     * looping fire video, portal/space images, face mesh texture).
     */
    val LEGACY_ONLY: Set<String> = setOf(
        "blink_freeze", "fire_book", "hand_portal", "mouth_fire", "space_background",
        "stickers_react", "mouth_words", "rock_paper_scissors", "face_morph",
    )

    /** Emergency switch: add an effect id here to send it back to the old renderer without other changes. */
    val ENGINE_DISABLED: Set<String> = emptySet()

    @Synchronized
    fun ensureLoaded(context: Context) {
        if (loaded) return
        try {
            val text = context.assets.open("effects.manifest.json").bufferedReader().use { it.readText() }
            val effects = JSONObject(text).getJSONArray("effects")
            for (i in 0 until effects.length()) {
                val e = effects.getJSONObject(i)
                val id = e.getString("id")
                val req = HashSet<String>()
                e.optJSONArray("requires")?.let { a -> for (j in 0 until a.length()) req.add(a.getString(j)) }
                requiresById[id] = req
                val b = e.optJSONObject("bindings")
                if (b != null) {
                    val keys = b.keys()
                    while (keys.hasNext()) {
                        val path = b.optString(keys.next())
                        if (path.startsWith("motion.") || path.startsWith("stillness.")) motionIds.add(id)
                    }
                }
            }
            loaded = true
        } catch (t: Throwable) {
            android.util.Log.e("EngineManifest", "could not read effects.manifest.json - engine path disabled", t)
        }
    }

    /** Returns the engine effect id for a JS effect key, or null if this effect stays on the old renderer. */
    fun engineIdFor(rawKey: String?): String? {
        if (rawKey == null) return null
        val id = rawKey.trim().lowercase().removePrefix("fx_gl_")
        if (!requiresById.containsKey(id)) return null
        if (id in LEGACY_ONLY || id in ENGINE_DISABLED) return null
        return id
    }

    fun requires(id: String): Set<String> = requiresById[id] ?: emptySet()
    fun needsMotion(id: String): Boolean = id in motionIds
}

/**
 * STAGE A. Turns the raw MediaPipe results the live preview already receives into the flat
 * arrays the C++ engine wants. Self-contained on purpose: it does NOT create a FaceTracker/
 * HandTracker (those own a second MediaPipe model each); the maths below is copied from
 * FaceTracker.kt / HandTracker.kt / LumVibeEngineBridge.updateSignals().
 *
 * Threading: onFace/onHands are called from MediaPipe's callback thread (just store the
 * newest result). Everything else runs on the view's render thread.
 */
class LiveSignalFeeder(
    /** Live preview: a result older than this counts as "lost". Baking passes Long.MAX_VALUE (frames are processed faster than real time). */
    private val staleAfterMs: Long = 500L,
) {

    @Volatile private var face: FaceLandmarkerResult? = null
    @Volatile private var faceAtMs = 0L
    @Volatile private var hands: HandLandmarkerResult? = null
    @Volatile private var handsAtMs = 0L

    /** width/height of the image MediaPipe sees (keeps x and y distances comparable). */
    @Volatile var frameAspect = 0.5625f
    @Volatile var motionMagnitude = 0f
    @Volatile var stillnessSeconds = 0f

    fun onFace(r: FaceLandmarkerResult?) { face = r; faceAtMs = SystemClock.uptimeMillis() }
    fun onHands(r: HandLandmarkerResult?) { hands = r; handsAtMs = SystemClock.uptimeMillis() }

    // ---------------- render-thread state ----------------
    private var maskTexId = 0

    private var faceSrc: FaceLandmarkerResult? = null
    private val faceArr = FloatArray(28)
    private var lastYaw = 0f
    private var openLeft = -1f
    private var openRight = -1f
    private val gazeX = OneEuro(1.2f, 3f)
    private val gazeY = OneEuro(1.2f, 3f)

    private var handSrc: HandLandmarkerResult? = null
    private val handArr = FloatArray(12)
    private var handCount = 0
    private val fingerHistory = ArrayDeque<Pair<Float, Float>>()
    private val fingerPts = FloatArray(32)
    private val fingerAges = FloatArray(16)
    private var fingerCount = 0
    private var lastPalm: Pair<Float, Float>? = null
    private var lastPalmMs = 0L

    private val emptyArr = FloatArray(0)
    private val defaultBody = floatArrayOf(0.25f, 0.15f, 0.75f, 1.0f)

    init { setNoFace() }

    private fun setNoFace() {
        val d = floatArrayOf(
            0f, 0f, 0f, 0f, 0f,
            0.35f, 0.25f, 0.65f, 0.75f, 0.5f, 0.6f,
            0f, 0f, 0f, 0f, 0f,
            0.4f, 0.4f, 0.6f, 0.4f,
            0.4f, 0.4f, 0.6f, 0.4f, 0f, 0f, 0f, 0f,
        )
        System.arraycopy(d, 0, faceArr, 0, 28)
    }

    private class OneEuro(private val minCut: Float, private val beta: Float) {
        private var x = 0f; private var dx = 0f; private var t = 0L; private var ready = false
        private fun alpha(cut: Float, dt: Float) = 1f / (1f + (1f / (2f * Math.PI.toFloat() * cut)) / dt)
        fun filter(v: Float, tMs: Long): Float {
            if (!ready) { x = v; dx = 0f; t = tMs; ready = true; return v }
            val dt = maxOf((tMs - t) / 1000f, 0.001f); t = tMs
            dx += alpha(1f, dt) * ((v - x) / dt - dx)
            x += alpha(minCut + beta * kotlin.math.abs(dx), dt) * (v - x)
            return x
        }
    }

    // ---------------- face ----------------
    private fun computeFace(r: FaceLandmarkerResult, nowMs: Long) {
        val lm: List<NormalizedLandmark> = r.faceLandmarks().firstOrNull() ?: emptyList()
        if (lm.isEmpty()) { setNoFace(); return }

        val shapes = r.faceBlendshapes().orElse(null)?.firstOrNull()
        fun bs(name: String): Float = shapes?.firstOrNull { it.categoryName() == name }?.score() ?: 0f

        val smile = maxOf(bs("mouthSmileLeft"), bs("mouthSmileRight"))
        val brow = maxOf(bs("browInnerUp"), bs("browOuterUpLeft"), bs("browOuterUpRight"))
        val jaw = bs("jawOpen")
        val blinkL = bs("eyeBlinkLeft")
        val blinkR = bs("eyeBlinkRight")
        val blinkBoth = blinkL > 0.6f && blinkR > 0.6f
        val wink = when {
            blinkL > 0.6f && blinkR < 0.3f -> blinkL
            blinkR > 0.6f && blinkL < 0.3f -> -blinkR
            else -> 0f
        }

        var minX = 1f; var minY = 1f; var maxX = 0f; var maxY = 0f
        for (p in lm) {
            if (p.x() < minX) minX = p.x(); if (p.y() < minY) minY = p.y()
            if (p.x() > maxX) maxX = p.x(); if (p.y() > maxY) maxY = p.y()
        }

        var mouthX = 0.5f; var mouthY = 0.6f
        if (lm.size > 14) { mouthX = (lm[13].x() + lm[14].x()) / 2f; mouthY = (lm[13].y() + lm[14].y()) / 2f }
        var eLx = 0.4f; var eLy = 0.4f; var eRx = 0.6f; var eRy = 0.4f
        if (lm.size > 386) { eLx = lm[159].x(); eLy = lm[159].y(); eRx = lm[386].x(); eRy = lm[386].y() }

        var roll = 0f; var pitch = 0f; var yaw = 0f; var yawDelta = 0f
        val m: FloatArray? = r.facialTransformationMatrixes().orElse(null)?.firstOrNull()
        if (m != null && m.size >= 11) {
            yaw = Math.toDegrees(kotlin.math.atan2((-m[8]).toDouble(), m[0].toDouble())).toFloat()
            pitch = Math.toDegrees(kotlin.math.asin(m[9].toDouble().coerceIn(-1.0, 1.0))).toFloat()
            roll = Math.toDegrees(kotlin.math.atan2(m[1].toDouble(), m[5].toDouble())).toFloat()
            yawDelta = kotlin.math.min(kotlin.math.abs(yaw - lastYaw) / 25f, 1f)
            lastYaw = yaw
        }

        // ---- eye-laser extras (same maths as FaceTracker.eyeLaserSignals / website calc.face) ----
        var irLx = 0.4f; var irLy = 0.4f; var irRx = 0.6f; var irRy = 0.4f
        var gx = 0f; var gy = 0f
        if (lm.size > 473) {
            val ar = frameAspect
            fun off(i: Int, a: Int, b: Int): FloatArray {
                val dx = (lm[b].x() - lm[a].x()) * ar
                val dy = lm[b].y() - lm[a].y()
                val w = maxOf(kotlin.math.hypot(dx, dy), 1e-4f)
                return floatArrayOf(
                    (lm[i].x() - (lm[a].x() + lm[b].x()) / 2f) * ar / w,
                    (lm[i].y() - (lm[a].y() + lm[b].y()) / 2f) / w,
                )
            }
            val o1 = off(468, 33, 133)
            val o2 = off(473, 362, 263)
            var rawGx = 2.4f * (o1[0] + o2[0]) / 2f
            var rawGy = 2.4f * (o1[1] + o2[1]) / 2f
            if (m != null && m.size >= 11) {
                val n = maxOf(kotlin.math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]), 1e-6f)
                rawGx += m[8] / n
                rawGy -= m[9] / n
            }
            gx = gazeX.filter(rawGx, nowMs)
            gy = gazeY.filter(rawGy, nowMs)
            irLx = lm[468].x(); irLy = lm[468].y(); irRx = lm[473].x(); irRy = lm[473].y()
            fun openness(blink: Float) = 1f - ((blink - 0.30f) / 0.40f).coerceIn(0f, 1f)
            val tl = openness(blinkR)   // image-left eye = the user's RIGHT eye
            val tr = openness(blinkL)
            openLeft = if (openLeft < 0f) tl else openLeft + (tl - openLeft) * 0.6f
            openRight = if (openRight < 0f) tr else openRight + (tr - openRight) * 0.6f
        } else {
            openLeft = 1f; openRight = 1f
        }

        val a = faceArr
        a[0] = 1f; a[1] = smile; a[2] = brow; a[3] = jaw; a[4] = wink
        a[5] = minX; a[6] = minY; a[7] = maxX; a[8] = maxY; a[9] = mouthX; a[10] = mouthY
        a[11] = roll; a[12] = pitch; a[13] = yaw; a[14] = if (blinkBoth) 1f else 0f; a[15] = yawDelta
        a[16] = eLx; a[17] = eLy; a[18] = eRx; a[19] = eRy
        a[20] = irLx; a[21] = irLy; a[22] = irRx; a[23] = irRy
        a[24] = gx; a[25] = gy; a[26] = openLeft; a[27] = openRight
    }

    // ---------------- hands ----------------
    private fun dist(x1: Float, y1: Float, x2: Float, y2: Float): Float {
        val dx = x1 - x2; val dy = y1 - y2
        return kotlin.math.sqrt(dx * dx + dy * dy)
    }

    private fun extended(l: List<NormalizedLandmark>, tip: Int): Boolean {
        val w = l[0]; val t = l[tip]; val k = l[tip - 3]
        return dist(t.x(), t.y(), w.x(), w.y()) >= dist(k.x(), k.y(), w.x(), w.y())
    }

    /** Engine gesture ids: FIST=1, OPEN_PALM=2, SCISSORS=3, POINTING=4, UNKNOWN=5 (same as LumVibeEngineBridge). */
    private fun gestureOf(l: List<NormalizedLandmark>): Float {
        val i = extended(l, 8); val m = extended(l, 12); val r = extended(l, 16); val p = extended(l, 20)
        return when {
            !i && !m && !r && !p -> 1f
            i && m && r && p -> 2f
            i && m && !r && !p -> 3f
            i && !m && !r && !p -> 4f
            else -> 5f
        }
    }

    private fun computeHands(res: HandLandmarkerResult, nowMs: Long) {
        val lists = res.landmarks()
        handCount = minOf(lists.size, 2)
        for (h in 0 until handCount) {
            val l = lists[h]
            if (l.size < 21) { handCount = h; break }
            var sx = 0f; var sy = 0f
            for (idx in intArrayOf(0, 5, 9, 13, 17)) { sx += l[idx].x(); sy += l[idx].y() }
            val px = sx / 5f; val py = sy / 5f
            val angle = kotlin.math.atan2(l[5].y() - l[0].y(), l[5].x() - l[0].x())
            var vel = 0f
            if (h == 0) {
                val prev = lastPalm
                if (prev != null && nowMs > lastPalmMs) {
                    vel = dist(px, py, prev.first, prev.second) / ((nowMs - lastPalmMs) / 1000f)
                }
                lastPalm = px to py
                lastPalmMs = nowMs
            }
            val base = h * 6
            handArr[base] = 1f; handArr[base + 1] = px; handArr[base + 2] = py
            handArr[base + 3] = gestureOf(l); handArr[base + 4] = angle; handArr[base + 5] = vel
        }
        if (handCount > 0) {
            // finger trail (index fingertip, landmark 8), newest first, 16 points, ages i/16 — same as the old live path
            val tip = lists[0][8]
            fingerHistory.addFirst(tip.x() to tip.y())
            while (fingerHistory.size > 16) fingerHistory.removeLast()
            fingerCount = fingerHistory.size
            fingerHistory.forEachIndexed { i, p ->
                fingerPts[i * 2] = p.first; fingerPts[i * 2 + 1] = p.second
                fingerAges[i] = i / 16f
            }
        } else {
            lastPalm = null
        }
    }

    // ---------------- segmentation mask (render thread, GL context current) ----------------
    fun uploadMask(bitmap: Bitmap) {
        if (maskTexId == 0) maskTexId = GlUtil.createTexture2D()
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTexId)
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
    }

    // ---------------- per-frame push (render thread) ----------------
    /** [nowMs] is the time base for the smoothing filters / hand speed: wall clock live, video time (ms) when baking. */
    fun push(bridge: LumVibeEngineBridge, elapsedSec: Float, dtSec: Float, amplitude: Float, nowMs: Long = SystemClock.uptimeMillis()) {
        val now = nowMs
        val clock = SystemClock.uptimeMillis()
        val canGoStale = staleAfterMs != Long.MAX_VALUE

        val f = face
        if (f == null || (canGoStale && clock - faceAtMs > staleAfterMs)) {
            if (faceSrc != null) { faceSrc = null; setNoFace() }
        } else if (f !== faceSrc) {
            faceSrc = f
            computeFace(f, now)
        }

        val h = hands
        if (h == null || (canGoStale && clock - handsAtMs > staleAfterMs)) {
            if (handSrc != null || handCount != 0) { handSrc = null; handCount = 0; fingerCount = 0; lastPalm = null }
        } else if (h !== handSrc) {
            handSrc = h
            computeHands(h, now)
        }

        bridge.pushRawSignals(
            elapsedSec, dtSec, faceArr,
            emptyArr, emptyArr, 0,
            handArr, handCount,
            fingerPts, fingerAges, fingerCount,
            amplitude, motionMagnitude, stillnessSeconds,
            false, defaultBody,
            false, 0f, 0f,
            maskTexId, 0,
        )
    }

    fun release() {
        if (maskTexId != 0) { GlUtil.deleteTexture(maskTexId); maskTexId = 0 }
        faceSrc = null; handSrc = null
    }
}
