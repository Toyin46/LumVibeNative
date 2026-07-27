package com.lumvibe.videobaker

import android.opengl.GLES20
import android.opengl.GLES11Ext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
* Draws two layers, in order, into whichever GL surface is currently current:
*   1. The decoded video frame (external OES texture) — with optional brightness/
*      contrast/saturation adjustment (this is your "filter" extension point).
*   2. The watermark/text/sticker overlay (normal 2D texture, alpha-blended on top).
*
* This is intentionally simple GL — no third-party rendering library required.
*/
class FrameRenderer {

    // ---- Video (external texture) shader ----
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

    // ---- Overlay (normal texture, alpha blended) shader ----
    private val overlayVertexShader = """
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
        void main() {
            gl_Position = aPosition;
            // Flip V: Android Bitmap texture uploads (GLUtils.texImage2D) put
            // row 0 (top of the watermark image) at texture v=0, but this
            // quad's vertex mapping treats v=0 as the bottom of the frame in
            // GL clip space — without this flip the watermark/caption render
            // upside-down. The video layer doesn't need this because it
            // already gets a correcting transform matrix from the decoder.
            vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
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

    // full-screen quad, position (x,y) + tex coord (s,t)
    private val vertexCoords = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
    private val textureCoords = floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)

    private val vertexBuffer: FloatBuffer = makeBuffer(vertexCoords)
    private val texCoordBuffer: FloatBuffer = makeBuffer(textureCoords)

    var brightness: Float = 0f   // -1..1
    var contrast: Float = 1f     // 0..2
    var saturation: Float = 1f   // 0..2

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

    /** Draws the decoded camera/video frame. texMatrix comes from SurfaceTexture.getTransformMatrix(). */
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

        vertexBuffer.position(0)
        GLES20.glEnableVertexAttribArray(aPosition)
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)

        texCoordBuffer.position(0)
        GLES20.glEnableVertexAttribArray(aTexCoord)
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer)

        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)

        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aTexCoord)
    }

    /** Draws the watermark/text/sticker overlay on top of whatever is already in the framebuffer. */
    fun drawOverlay(textureId: Int) {
        GLES20.glUseProgram(overlayProgram)
        GlUtil.checkGlError("glUseProgram overlay")

        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId)

        val aPosition = GLES20.glGetAttribLocation(overlayProgram, "aPosition")
        val aTexCoord = GLES20.glGetAttribLocation(overlayProgram, "aTexCoord")
        val uTexture = GLES20.glGetUniformLocation(overlayProgram, "uTexture")
        GLES20.glUniform1i(uTexture, 0)

        vertexBuffer.position(0)
        GLES20.glEnableVertexAttribArray(aPosition)
        GLES20.glVertexAttribPointer(aPosition, 2, GLES20.GL_FLOAT, false, 0, vertexBuffer)

        texCoordBuffer.position(0)
        GLES20.glEnableVertexAttribArray(aTexCoord)
        GLES20.glVertexAttribPointer(aTexCoord, 2, GLES20.GL_FLOAT, false, 0, texCoordBuffer)

        // Overlay bitmap has real transparent pixels, so use standard alpha blending.
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisable(GLES20.GL_BLEND)

        GLES20.glDisableVertexAttribArray(aPosition)
        GLES20.glDisableVertexAttribArray(aTexCoord)
    }
} 
