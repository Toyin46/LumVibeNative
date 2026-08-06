package com.lumvibe.videobaker

import android.opengl.GLES20
import android.opengl.GLES11Ext
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import java.nio.ByteBuffer

/**
* Small collection of OpenGL ES 2.0 helpers used by the transcoder.
* No third-party GL library is used here — just android.opengl.*.
*/
object GlUtil {
    private const val TAG = "VideoBaker/GlUtil"

    fun checkGlError(op: String) {
        val error = GLES20.glGetError()
        if (error != GLES20.GL_NO_ERROR) {
            val msg = "$op: glError 0x${Integer.toHexString(error)}"
            Log.e(TAG, msg)
            throw RuntimeException(msg)
        }
    }

    fun createProgram(vertexSrc: String, fragmentSrc: String): Int {
        val vertexShader = loadShader(GLES20.GL_VERTEX_SHADER, vertexSrc)
        val fragmentShader = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSrc)

        val program = GLES20.glCreateProgram()
        checkGlError("glCreateProgram")
        GLES20.glAttachShader(program, vertexShader)
        checkGlError("glAttachShader vertex")
        GLES20.glAttachShader(program, fragmentShader)
        checkGlError("glAttachShader fragment")
        GLES20.glLinkProgram(program)

        val linkStatus = IntArray(1)
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, linkStatus, 0)
        if (linkStatus[0] != GLES20.GL_TRUE) {
            val log = GLES20.glGetProgramInfoLog(program)
            GLES20.glDeleteProgram(program)
            throw RuntimeException("Could not link program: $log")
        }
        return program
    }

    private fun loadShader(type: Int, src: String): Int {
        val shader = GLES20.glCreateShader(type)
        checkGlError("glCreateShader type=$type")
        GLES20.glShaderSource(shader, src)
        GLES20.glCompileShader(shader)

        val compiled = IntArray(1)
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
        if (compiled[0] == 0) {
            val log = GLES20.glGetShaderInfoLog(shader)
            GLES20.glDeleteShader(shader)
            throw RuntimeException("Could not compile shader $type: $log")
        }
        return shader
    }

    /** Creates a GL_TEXTURE_EXTERNAL_OES texture id (used to receive decoder output frames). */
    fun createExternalTexture(): Int {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        val texId = textures[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texId)
        checkGlError("bind external texture")
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE
        )
        GLES20.glTexParameteri(
            GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE
        )
        return texId
    }

    /** Creates a normal GL_TEXTURE_2D texture id (used for the watermark/text overlay bitmap). */
    fun createTexture2D(): Int {
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        val texId = textures[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texId)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        return texId
    }

    /**
     * NEW — Phase 2 only. Reads back the currently-bound framebuffer as a Bitmap, so it
     * can be fed into MediaPipe's Face Landmarker (which needs a Bitmap/MPImage, not a
     * GL texture). Real cost, being upfront: this is a GPU→CPU pixel readback, done once
     * per frame for any face-tracking effect — meaningfully more expensive than the
     * Phase 1 shader-only effects, which never leave the GPU. Expect baking to be
     * noticeably slower when a face-tracking effect is active.
     */
    fun readPixelsAsBitmap(width: Int, height: Int): Bitmap {
        val buffer = ByteBuffer.allocateDirect(width * height * 4)
        GLES20.glReadPixels(0, 0, width, height, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buffer)
        checkGlError("glReadPixels")
        buffer.rewind()
        val raw = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        raw.copyPixelsFromBuffer(buffer)
        // glReadPixels reads bottom-to-top (OpenGL convention); Bitmap/MediaPipe expect
        // top-to-bottom, so flip vertically before handing it off.
        val flip = Matrix().apply { postScale(1f, -1f) }
        return Bitmap.createBitmap(raw, 0, 0, width, height, flip, true)
    }
}  
