package com.lumvibe.videobaker

import android.opengl.GLES20
import android.opengl.GLES11Ext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
* Draws layers, in order, into whichever GL surface is currently current:
*   1. The decoded video frame (external OES texture) — either the plain
*      pass-through (with brightness/contrast/saturation), or, if a
*      VisualEffect is selected, one of the shaders in EffectShaders.kt.
*   2. The caption overlay (normal 2D texture, full-frame, alpha-blended, static position).
*   3. The watermark logo (normal 2D texture, drawn at a POSITIONED sub-rectangle —
*      see drawWatermarkAt — which is what makes bouncing possible).
*
* This is intentionally simple GL — no third-party rendering library required.
*/
class FrameRenderer {

    // ---- Video (external texture) shader — plain pass-through with color adjust ----
    private val videoVertexShader = """
        uniform mat4 uTexMatrix;
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = aPosition;
            vTexCoord = (uTexMatrix * aTexCoord).xy;
        }
    """.trimIndent()

    private val videoFragmentShader = """
        #extension GL_OES_EGL_image_external : require
        precision mediump float;
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uBrightness; // -1.0 .. 1.0, 0 = no change
        uniform float uContrast;   // 0.0 .. 2.0, 1 = no change
        uniform float uSaturation; // 0.0 .. 2.0, 1 = no change
        void main() {
            vec4 color = texture2D(uTexture, vTexCoord);
            // contrast + brightness
            color.rgb = (color.rgb - 0.5) * uContrast + 0.5 + uBrightness;
            // saturation
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(vec3(gray), color.rgb, uSaturation);
            gl_FragColor = color;
        }
    """.trimIndent()

    // ---- Overlay (normal texture, alpha blended) shader — used for BOTH caption
    // (full-screen quad) and watermark (positioned sub-rectangle quad) ----
    private val overlayVertexShader = """
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = aPosition;
            vTexCoord = aTexCoord.xy;
        }
    """.trimIndent()

    private val overlayFragmentShader = """
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uTexture;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    """.trimIndent()

    private var videoProgram = 0
    private var overlayProgram = 0

    // Lazily-compiled effect programs, keyed by effect. Only the effect(s) actually
    // used get compiled.
    private val effectPrograms = mutableMapOf<VisualEffect, Int>()

    // full-screen quad, position (x,y) + tex coord (s,t) — used for video/effect/caption
    private val vertexCoords = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val textureCoords = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

    private val vertexBuffer: FloatBuffer = makeBuffer(vertexCoords)
    private val texCoordBuffer: FloatBuffer = makeBuffer(textureCoords)

    // Caption/watermark textures come from an Android Canvas Bitmap uploaded via
    // GLUtils.texImage2D, drawn onto a fixed, un-rotated quad — they're already in
    // correct upright screen orientation and should be drawn with the plain
    // texCoordBuffer, same as everything else. overlayTexCoordBuffer below is a
    // 180°-flipped UV set that USED to be applied here as a "fix" for a front-camera
    // rotation issue — it was fixing the wrong layer, and instead mirrored every
    // caption/watermark on every video regardless of camera or source (see
    // drawOverlay/drawWatermarkAt fix). Kept unused for now in case a genuine
    // overlay-orientation bug shows up on a specific device/pipeline and this is
    // needed again — but don't wire it back in without confirming the actual
    // symptom first, the same mistake is easy to repeat.
    private val overlayTexCoordBuffer: FloatBuffer = makeBuffer(floatArrayOf(1f, 1f, 0f, 1f, 1f, 0f, 0f, 0f))

    // Separate, MUTABLE position buffer for the watermark — rewritten every frame
    // with whatever rectangle WatermarkBounce.position() computes.
    private val watermarkPositionBuffer: FloatBuffer = makeBuffer(FloatArray(8))

    var brightness: Float = 0f   // -1..1
    var contrast: Float = 1f     // 0..2
    var saturation: Float = 1f   // 0..2

    // ---- Effect state ----
    var currentEffect: VisualEffect = VisualEffect.NONE
        private set
    var effectIntensity: Float = 1f
    var duotoneColorA: FloatArray = floatArrayOf(0.05f, 0.05f, 0.20f)
    var duotoneColorB: FloatArray = floatArrayOf(1.00f, 0.35f, 0.15f)
    var duotonePulseSpeed: Float = 0.35f
    var neonGlowColor: FloatArray = floatArrayOf(0.10f, 1.00f, 0.85f)
    // WINK_SPARK's fixed screen-space anchor point — see EffectShaders.winkSpark doc
    // for why this isn't a tracked eye position. (0.62, 0.4) sits upper-right of
    // center, a reasonable default for a front-camera selfie framing; expose as a
    // var so it can be tuned per-effect-config from the JS side later if needed.
    var sparkOrigin: FloatArray = floatArrayOf(0.62f, 0.40f)
    // HEAD_TILT_ZOOM's current zoom/pan, computed in VideoTranscoder from
    // FaceTracker.headPoseDegrees() each frame and written here right before draw.
    var headTiltZoom: Float = 1f
    var headTiltPan: FloatArray = floatArrayOf(0f, 0f)
    // VOICE_HALO's face box, written from FaceTracker.faceBoundingBox() each frame.
    // Defaults to a centered box so the ring has somewhere sensible to sit on a
    // frame where no face was detected, rather than snapping to (0,0,0,0).
    var faceBox: FloatArray = floatArrayOf(0.35f, 0.25f, 0.65f, 0.75f)
    // HAND_PORTAL's circle, normalized screen space, written from HandTracker.palmCenter().
    var portalCenter: FloatArray = floatArrayOf(0.5f, 0.5f)
    var portalRadius: Float = 0.18f
    var mouthCenter: FloatArray = floatArrayOf(0.5f, 0.6f) // GOLD_SKIN's mask needs no such property; this is MOUTH_FIRE's anchor
    // FIST_BUMP_BOOM's trigger point + decaying energy (1.0 = just punched, decays to 0).
    var boomCenter: FloatArray = floatArrayOf(0.5f, 0.5f)
    var boomEnergy: Float = 0f
    // TWO_HAND_FRAME's rectangle (left, top, right, bottom), from both palm positions.
    var frameRect: FloatArray = floatArrayOf(0.3f, 0.3f, 0.7f, 0.7f)
    // GAZE_TRAIL's position history — VideoTranscoder owns the actual history array
    // and writes it here each frame. gazePoints is flattened (x0,y0,x1,y1,...);
    // gazeCount says how many of the (up to 8) slots are valid this frame.
    var gazePoints: FloatArray = FloatArray(16) // 8 points * 2 floats
    var gazeAges: FloatArray = FloatArray(8)
    var gazeCount: Int = 0
    // DOUBLE_TAKE's turn direction, -1..1 — see EffectShaders.doubleTake doc.
    var doubleTakeDirection: Float = 0f

    // BLINK_FREEZE's captured-frame texture — separate from secondaryTextureId
    // above because it needs to coexist with a segmentation mask or portal image
    // in theory (not in practice today, since no effect combines them, but kept
    // as its own slot rather than aliased, to avoid a subtle future bug if that
    // ever changes). Filled via captureFreezeFrame(), read via drawFrozenFrame().
    private var frozenTextureId = 0
    private var freezeProgram = 0

    fun ensureFrozenTexture() {
        if (frozenTextureId == 0) frozenTextureId = GlUtil.createTexture2D()
    }

    // Shared "secondary" texture slot (GL_TEXTURE1) for whichever effect needs a
    // second image this frame: SegmentationTracker's per-frame mask (DEPTH_BLOOM,
    // SPLIT_PRISM — re-uploaded every frame, see uploadDynamicTexture) or
    // HAND_PORTAL's static scene image (uploaded once, see OverlayBuilder). Only
    // one of these effects is ever active at a time, so sharing one texture id
    // instead of allocating three is a deliberate simplification, not an oversight.
    private var secondaryTextureId = 0

    /** Creates the secondary texture id once. Call after setup(), before the render loop. */
    fun ensureSecondaryTexture() {
        if (secondaryTextureId == 0) secondaryTextureId = GlUtil.createTexture2D()
    }

    /** Re-uploads [bitmap] into the secondary texture slot — call every frame for
     *  DEPTH_BLOOM/SPLIT_PRISM (a fresh segmentation mask each frame). For
     *  HAND_PORTAL's static scene image, call this ONCE instead, before the loop. */
    fun uploadSecondaryTexture(bitmap: android.graphics.Bitmap) {
        ensureSecondaryTexture()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, secondaryTextureId)
        android.opengl.GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0)
    }

    private var frameWidth = 1
    private var frameHeight = 1

    private fun makeBuffer(coords: FloatArray): FloatBuffer {
        val bb = ByteBuffer.allocateDirect(coords.size * 4)
        bb.order(ByteOrder.nativeOrder())
        val fb = bb.asFloatBuffer()
        fb.put(coords)
        fb.position(0)
        return fb
    }

    fun setup() {
        videoProgram = GlUtil.createProgram(videoVertexShader, videoFragmentShader)
        overlayProgram = GlUtil.createProgram(overlayVertexShader, overlayFragmentShader)
        // Compiled unconditionally (like video/overlay above) since it's small and
        // effect-independent — only actually used when BLINK_FREEZE is selected,
        // via captureFreezeFrame()/drawFrozenFrame() below, not through the normal
        // effectPrograms map (this program takes no external-OES texture at all,
        // so it doesn't fit the generic drawEffectFrame() path).
        val (freezeVs, freezeFs) = EffectShaders.source(VisualEffect.BLINK_FREEZE)
        freezeProgram = GlUtil.createProgram(freezeVs, freezeFs)
    }

    fun setFrameSize(width: Int, height: Int) {
        frameWidth = width.coerceAtLeast(1)
        frameHeight = height.coerceAtLeast(1)
    }

    fun setEffect(effect: VisualEffect) {
        currentEffect = effect
        if (effect == VisualEffect.NONE) return
        if (effectPrograms.containsKey(effect)) return
        val (vs, fs) = EffectShaders.source(effect)
        effectPrograms[effect] = GlUtil.createProgram(vs, fs)
    }

    fun drawVideoFrame(textureId: Int, texMatrix: FloatArray) {
        GLES20.glUseProgram(videoProgram)
        GlUtil.checkGlError("glUseProgram video")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

        val aPosition = GLES20.glGetAttribLocation(videoProgram, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(videoProgram, "aTexCoord")
        val uTexMatrix = GLES20.glGetUniformLocation(videoProgram, "uTexMatrix")
        val uTexture = GLES20.glGetUniformLocation(videoProgram, "uTexture")
        val uBrightness = GLES20.glGetUniformLocation(videoProgram, "uBrightness")
        val uContrast = GLES20.glGetUniformLocation(videoProgram, "uContrast")
        val uSaturation = GLES20.glGetUniformLocation(videoProgram, "uSaturation")

        GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniform1i(uTexture, 0)
        GLES20.glUniform1f(uBrightness, brightness)
        GLES20.glUniform1f(uContrast, contrast)
        GLES20.glUniform1f(uSaturation, saturation)

        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
    }

    /**
     * [elapsedSec] must come from the frame's presentation time (bufferInfo.presentationTimeUs
     * / 1_000_000f), not wall-clock time — keeps time-based effects locked to the video's
     * own timeline regardless of how fast the transcode pass runs.
     */
    fun drawEffectFrame(textureId: Int, texMatrix: FloatArray, elapsedSec: Float) {
        val program = effectPrograms[currentEffect] ?: run {
            drawVideoFrame(textureId, texMatrix)
            return
        }

        GLES20.glUseProgram(program)
        GlUtil.checkGlError("glUseProgram effect:$currentEffect")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

        val aPosition = GLES20.glGetAttribLocation(program, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(program, "aTexCoord")
        val uTexMatrix = GLES20.glGetUniformLocation(program, "uTexMatrix")
        val uTexture = GLES20.glGetUniformLocation(program, "uTexture")
        val uTime = GLES20.glGetUniformLocation(program, "uTime")
        val uIntensity = GLES20.glGetUniformLocation(program, "uIntensity")
        val uTexelSize = GLES20.glGetUniformLocation(program, "uTexelSize")
        val uColorA = GLES20.glGetUniformLocation(program, "uColorA")
        val uColorB = GLES20.glGetUniformLocation(program, "uColorB")
        val uPulseSpeed = GLES20.glGetUniformLocation(program, "uPulseSpeed")
        val uGlowColor = GLES20.glGetUniformLocation(program, "uGlowColor")
        val uSparkOrigin = GLES20.glGetUniformLocation(program, "uSparkOrigin")
        val uZoom = GLES20.glGetUniformLocation(program, "uZoom")
        val uPan = GLES20.glGetUniformLocation(program, "uPan")
        val uFaceBox = GLES20.glGetUniformLocation(program, "uFaceBox")
        val uMaskTexture = GLES20.glGetUniformLocation(program, "uMaskTexture")
        val uPortalTexture = GLES20.glGetUniformLocation(program, "uPortalTexture")
        val uPortalCenter = GLES20.glGetUniformLocation(program, "uPortalCenter")
        val uPortalRadius = GLES20.glGetUniformLocation(program, "uPortalRadius")
        val uBoomCenter = GLES20.glGetUniformLocation(program, "uBoomCenter")
        val uBoomEnergy = GLES20.glGetUniformLocation(program, "uBoomEnergy")
        val uFrameRect = GLES20.glGetUniformLocation(program, "uFrameRect")
        val uGazePoints = GLES20.glGetUniformLocation(program, "uGazePoints")
        val uGazeAges = GLES20.glGetUniformLocation(program, "uGazeAges")
        val uGazeCount = GLES20.glGetUniformLocation(program, "uGazeCount")
        val uDirection = GLES20.glGetUniformLocation(program, "uDirection")
        val uMouthCenter = GLES20.glGetUniformLocation(program, "uMouthCenter")

        GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniform1i(uTexture, 0)
        if (uTime >= 0) GLES20.glUniform1f(uTime, elapsedSec)
        if (uIntensity >= 0) GLES20.glUniform1f(uIntensity, effectIntensity.coerceIn(0f, 1f))
        if (uTexelSize >= 0) GLES20.glUniform2f(uTexelSize, 1f / frameWidth, 1f / frameHeight)
        if (uColorA >= 0) GLES20.glUniform3fv(uColorA, 1, duotoneColorA, 0)
        if (uColorB >= 0) GLES20.glUniform3fv(uColorB, 1, duotoneColorB, 0)
        if (uPulseSpeed >= 0) GLES20.glUniform1f(uPulseSpeed, duotonePulseSpeed)
        if (uGlowColor >= 0) GLES20.glUniform3fv(uGlowColor, 1, neonGlowColor, 0)
        if (uSparkOrigin >= 0) GLES20.glUniform2fv(uSparkOrigin, 1, sparkOrigin, 0)
        if (uZoom >= 0) GLES20.glUniform1f(uZoom, headTiltZoom.coerceAtLeast(1f))
        if (uPan >= 0) GLES20.glUniform2fv(uPan, 1, headTiltPan, 0)
        if (uFaceBox >= 0) GLES20.glUniform4fv(uFaceBox, 1, faceBox, 0)
        if (uBoomCenter >= 0) GLES20.glUniform2fv(uBoomCenter, 1, boomCenter, 0)
        if (uBoomEnergy >= 0) GLES20.glUniform1f(uBoomEnergy, boomEnergy.coerceIn(0f, 1f))
        if (uFrameRect >= 0) GLES20.glUniform4fv(uFrameRect, 1, frameRect, 0)
        if (uPortalCenter >= 0) GLES20.glUniform2fv(uPortalCenter, 1, portalCenter, 0)
        if (uPortalRadius >= 0) GLES20.glUniform1f(uPortalRadius, portalRadius)
        if (uGazePoints >= 0) GLES20.glUniform2fv(uGazePoints, 8, gazePoints, 0)
        if (uGazeAges >= 0) GLES20.glUniform1fv(uGazeAges, 8, gazeAges, 0)
        if (uGazeCount >= 0) GLES20.glUniform1i(uGazeCount, gazeCount.coerceIn(0, 8))
        if (uDirection >= 0) GLES20.glUniform1f(uDirection, doubleTakeDirection.coerceIn(-1f, 1f))
        if (uMouthCenter >= 0) GLES20.glUniform2fv(uMouthCenter, 1, mouthCenter, 0)
        // Secondary texture (mask or portal scene) goes on unit 1 — only bind it
        // when this program actually declares one of the two samplers that use it.
        if (uMaskTexture >= 0 || uPortalTexture >= 0) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, secondaryTextureId)
            if (uMaskTexture >= 0) GLES20.glUniform1i(uMaskTexture, 1)
            if (uPortalTexture >= 0) GLES20.glUniform1i(uPortalTexture, 1)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0) // restore, so the next draw's unit-0 bind isn't stale
        }

        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
    }

    /**
     * Snapshots whatever is CURRENTLY rendered on the bound framebuffer into the
     * frozen-capture texture, via glCopyTexImage2D. Call this immediately after
     * drawVideoFrame() (plain, no effect shader) so what gets frozen is the clean
     * video frame — not a half-composited overlay/effect frame. VideoTranscoder
     * calls this exactly once, on the frame a blink is first detected.
     */
    fun captureFreezeFrame() {
        ensureFrozenTexture()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, frozenTextureId)
        GLES20.glCopyTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, 0, 0, frameWidth, frameHeight, 0)
        GlUtil.checkGlError("captureFreezeFrame glCopyTexImage2D")
    }

    /**
     * Draws the previously-captured frozen frame with a zoom punch. [zoom] should
     * animate 1.0 -> ~1.15 -> 1.0 across the freeze's ~0.3s hold (VideoTranscoder
     * computes the curve; this just draws whatever zoom value it's given).
     */
    fun drawFrozenFrame(zoom: Float) {
        GLES20.glUseProgram(freezeProgram)
        GlUtil.checkGlError("glUseProgram freeze")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, frozenTextureId)

        val aPosition = GLES20.glGetAttribLocation(freezeProgram, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(freezeProgram, "aTexCoord")
        val uZoom = GLES20.glGetUniformLocation(freezeProgram, "uZoom")
        val uFrozenTexture = GLES20.glGetUniformLocation(freezeProgram, "uFrozenTexture")

        if (uZoom >= 0) GLES20.glUniform1f(uZoom, zoom.coerceAtLeast(1f))
        if (uFrozenTexture >= 0) GLES20.glUniform1i(uFrozenTexture, 0)

        // NOTE: frozen capture is a normal 2D texture with (0,0) at a different
        // corner convention than the decoder's SurfaceTexture in some GL
        // implementations — if the frozen frame appears upside-down or mirrored
        // on-device, that's a texcoord/V-flip issue to fix in this draw call
        // (flip texCoordBuffer's V here), not a sign your capture failed.
        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
    }

    /** Full-frame overlay draw — used for the caption (static position every frame). */
    fun drawOverlay(textureId: Int) {
        GLES20.glUseProgram(overlayProgram)
        GlUtil.checkGlError("glUseProgram overlay")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)

        val aPosition = GLES20.glGetAttribLocation(overlayProgram, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(overlayProgram, "aTexCoord")
        val uTexture = GLES20.glGetUniformLocation(overlayProgram, "uTexture")
        GLES20.glUniform1i(uTexture, 0)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        // FIX: caption/watermark textures come from an upright Android Canvas
        // Bitmap, not from the camera's SurfaceTexture — they never needed the
        // 180° correction overlayTexCoordBuffer applies. That flip was written
        // for a different symptom and got applied here too, which is why text
        // (TikTok logo, LumVibe badge, captions) was rendering mirrored on
        // saved/posted videos. Use the plain, un-flipped texCoordBuffer instead.
        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    /**
     * Draws the watermark logo at a specific pixel rectangle instead of full-screen —
     * this is what makes bouncing possible. (leftPx, topPx) is the rectangle's
     * top-left corner, in pixels, origin at the top-left of the frame — exactly what
     * WatermarkBounce.position() returns.
     */
    fun drawWatermarkAt(
        textureId: Int,
        leftPx: Float, topPx: Float,
        widthPx: Float, heightPx: Float,
        canvasWidth: Int, canvasHeight: Int
    ) {
        // Convert the pixel rectangle (origin top-left, y-down) into NDC (-1..1, y-up).
        val x0 = (leftPx / canvasWidth) * 2f - 1f
        val x1 = ((leftPx + widthPx) / canvasWidth) * 2f - 1f
        val yTop = 1f - (topPx / canvasHeight) * 2f
        val yBottom = 1f - ((topPx + heightPx) / canvasHeight) * 2f

        // Same vertex order as the static full-screen quad (BL, BR, TL, TR) so it
        // matches textureCoords without needing a second tex-coord buffer.
        watermarkPositionBuffer.clear()
        watermarkPositionBuffer.put(floatArrayOf(x0, yBottom, x1, yBottom, x0, yTop, x1, yTop))
        watermarkPositionBuffer.position(0)

        GLES20.glUseProgram(overlayProgram)
        GlUtil.checkGlError("glUseProgram watermark")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)

        val aPosition = GLES20.glGetAttribLocation(overlayProgram, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(overlayProgram, "aTexCoord")
        val uTexture = GLES20.glGetUniformLocation(overlayProgram, "uTexture")
        GLES20.glUniform1i(uTexture, 0)

        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        // Same fix as drawOverlay above — plain texCoordBuffer, no flip.
        drawQuad(watermarkPositionBuffer, texCoordBuffer, aPosition, aTexCoord)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawQuad(positions: FloatBuffer, texCoords: FloatBuffer, aPosition: Int, aTexCoord: Int) {
        positions.position(0)
        GLES20.glEnableVertexAttribArray(aPosition)
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 0, positions)

        texCoords.position(0)
        GLES20.glEnableVertexAttribArray(aTexCoord)
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 0, texCoords)

        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aTexCoord)
    }

    /** Deletes all compiled GL programs. Call once after the last frame is drawn. */
    fun release() {
        if (videoProgram != 0) GLES20.glDeleteProgram(videoProgram)
        if (overlayProgram != 0) GLES20.glDeleteProgram(overlayProgram)
        effectPrograms.values.forEach { GLES20.glDeleteProgram(it) }
        effectPrograms.clear()
        videoProgram = 0
        overlayProgram = 0
        if (freezeProgram != 0) { GLES20.glDeleteProgram(freezeProgram); freezeProgram = 0 }
        if (frozenTextureId != 0) {
            GLES20.glDeleteTextures(1, intArrayOf(frozenTextureId), 0)
            frozenTextureId = 0
        }
        if (secondaryTextureId != 0) {
            GLES20.glDeleteTextures(1, intArrayOf(secondaryTextureId), 0)
            secondaryTextureId = 0
        }
    }
}   
