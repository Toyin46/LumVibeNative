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
    // GLUtils.texImage2D, which uploads row 0 (the TOP of the bitmap) as texture
    // row 0 — but OpenGL's (s,t) convention treats t=0 as the BOTTOM of the image.
    // The video/effect texture doesn't have this problem because SurfaceTexture's
    // own transform matrix (uTexMatrix) already corrects for it — Canvas bitmaps
    // get no such correction, so without this flipped buffer, anything drawn via
    // drawOverlay/drawWatermarkAt renders upside down. This buffer is ONLY used
    // for overlay/watermark draws — texCoordBuffer above stays untouched so the
    // video/effect path (which is already correct) isn't affected.
    private val overlayTexCoordBuffer: FloatBuffer = makeBuffer(floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f))

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

        GLES20.glUniformMatrix4fv(uTexMatrix, 1, false, texMatrix, 0)
        GLES20.glUniform1i(uTexture, 0)
        if (uTime >= 0) GLES20.glUniform1f(uTime, elapsedSec)
        if (uIntensity >= 0) GLES20.glUniform1f(uIntensity, effectIntensity.coerceIn(0f, 1f))
        if (uTexelSize >= 0) GLES20.glUniform2f(uTexelSize, 1f / frameWidth, 1f / frameHeight)
        if (uColorA >= 0) GLES20.glUniform3fv(uColorA, 1, duotoneColorA, 0)
        if (uColorB >= 0) GLES20.glUniform3fv(uColorB, 1, duotoneColorB, 0)
        if (uPulseSpeed >= 0) GLES20.glUniform1f(uPulseSpeed, duotonePulseSpeed)
        if (uGlowColor >= 0) GLES20.glUniform3fv(uGlowColor, 1, neonGlowColor, 0)

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
        drawQuad(vertexBuffer, overlayTexCoordBuffer, aPosition, aTexCoord)
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
        drawQuad(watermarkPositionBuffer, overlayTexCoordBuffer, aPosition, aTexCoord)
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
    }
} 
