package com.lumvibe.videobaker

import android.opengl.GLES20
import android.opengl.GLES11Ext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

class FrameRenderer {

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
        uniform float uBrightness;
        uniform float uContrast;
        uniform float uSaturation;
        void main() {
            vec4 color = texture2D(uTexture, vTexCoord);
            color.rgb = (color.rgb - 0.5) * uContrast + 0.5 + uBrightness;
            float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            color.rgb = mix(vec3(gray), color.rgb, uSaturation);
            gl_FragColor = color;
        }
    """.trimIndent()

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
    private val effectPrograms = mutableMapOf<VisualEffect, Int>()
    private val vertexCoords = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val textureCoords = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)
    private val vertexBuffer: FloatBuffer = makeBuffer(vertexCoords)
    private val texCoordBuffer: FloatBuffer = makeBuffer(textureCoords)
    private val overlayTexCoordBuffer: FloatBuffer = makeBuffer(floatArrayOf(1f, 1f, 0f, 1f, 1f, 0f, 0f, 0f))
    // ACTUAL FIX for the upside-down watermark: Canvas-drawn bitmaps put row 0 (the
    // top of the drawing) at texcoord v=0, but the BL-vertex-to-texcoord-index-0
    // mapping above treats v=0 as screen-bottom — so an upright canvas drawing
    // renders upside-down unless v is flipped. This is a VERTICAL-ONLY flip (u
    // stays the same) — NOT the same buffer as overlayTexCoordBuffer above, which
    // flips both axes and was the cause of the earlier (different) mirroring bug.
    private val verticalFlipTexCoordBuffer: FloatBuffer = makeBuffer(floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f))
    private val watermarkPositionBuffer: FloatBuffer = makeBuffer(FloatArray(8))

    var brightness: Float = 0f
    var contrast: Float = 1f
    var saturation: Float = 1f
    var currentEffect: VisualEffect = VisualEffect.NONE
        private set
    var effectIntensity: Float = 1f
    var duotoneColorA: FloatArray = floatArrayOf(0.05f, 0.05f, 0.20f)
    var duotoneColorB: FloatArray = floatArrayOf(1.00f, 0.35f, 0.15f)
    var duotonePulseSpeed: Float = 0.35f
    var neonGlowColor: FloatArray = floatArrayOf(0.10f, 1.00f, 0.85f)
    var sparkOrigin: FloatArray = floatArrayOf(0.62f, 0.40f)
    var headTiltZoom: Float = 1f
    var headTiltPan: FloatArray = floatArrayOf(0f, 0f)
    var faceBox: FloatArray = floatArrayOf(0.35f, 0.25f, 0.65f, 0.75f)
    var portalCenter: FloatArray = floatArrayOf(0.5f, 0.5f)
    var portalRadius: Float = 0.18f
    var mouthCenter: FloatArray = floatArrayOf(0.5f, 0.6f)
    var boomCenter: FloatArray = floatArrayOf(0.5f, 0.5f)
    var boomEnergy: Float = 0f
    var frameRect: FloatArray = floatArrayOf(0.3f, 0.3f, 0.7f, 0.7f)
    var gazePoints: FloatArray = FloatArray(16)
    var gazeAges: FloatArray = FloatArray(8)
    var gazeCount: Int = 0
    var doubleTakeDirection: Float = 0f

    private var frozenTextureId = 0
    private var freezeProgram = 0

    fun ensureFrozenTexture() {
        if (frozenTextureId == 0) frozenTextureId = GlUtil.createTexture2D()
    }

    private var secondaryTextureId = 0

    fun ensureSecondaryTexture() {
        if (secondaryTextureId == 0) secondaryTextureId = GlUtil.createTexture2D()
    }

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
        if (uMaskTexture >= 0 || uPortalTexture >= 0) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, secondaryTextureId)
            if (uMaskTexture >= 0) GLES20.glUniform1i(uMaskTexture, 1)
            if (uPortalTexture >= 0) GLES20.glUniform1i(uPortalTexture, 1)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        }
        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
    }

    fun captureFreezeFrame() {
        ensureFrozenTexture()
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, frozenTextureId)
        GLES20.glCopyTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, 0, 0, frameWidth, frameHeight, 0)
        GlUtil.checkGlError("captureFreezeFrame glCopyTexImage2D")
    }

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
        drawQuad(vertexBuffer, texCoordBuffer, aPosition, aTexCoord)
    }

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
        drawQuad(vertexBuffer, verticalFlipTexCoordBuffer, aPosition, aTexCoord)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    fun drawWatermarkAt(
        textureId: Int,
        leftPx: Float, topPx: Float,
        widthPx: Float, heightPx: Float,
        canvasWidth: Int, canvasHeight: Int
    ) {
        val x0 = (leftPx / canvasWidth) * 2f - 1f
        val x1 = ((leftPx + widthPx) / canvasWidth) * 2f - 1f
        val yTop = 1f - (topPx / canvasHeight) * 2f
        val yBottom = 1f - ((topPx + heightPx) / canvasHeight) * 2f
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
        drawQuad(watermarkPositionBuffer, verticalFlipTexCoordBuffer, aPosition, aTexCoord)
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
