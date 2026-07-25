package com.lumvibe.videobaker

import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.view.Surface

/**
* Thin wrapper around EGL14 for an off-screen (no window) rendering context that
* can render into: (a) a MediaCodec encoder's input Surface, used as the single
* render target for every frame in the transcode. This is standard Android EGL
* setup — same idea Android's own Grafika sample uses for transcoding.
*/
class EglCore {
    private var eglDisplay: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var eglContext: EGLContext = EGL14.EGL_NO_CONTEXT
    private var eglConfig: EGLConfig? = null

    init {
        eglDisplay = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        if (eglDisplay == EGL14.EGL_NO_DISPLAY) throw RuntimeException("eglGetDisplay failed")

        val version = IntArray(2)
        if (!EGL14.eglInitialize(eglDisplay, version, 0, version, 1)) {
            throw RuntimeException("eglInitialize failed")
        }

        val attribList = intArrayOf(
            EGL14.EGL_RED_SIZE, 8,
            EGL14.EGL_GREEN_SIZE, 8,
            EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            0x3142, 1, // EGL_RECORDABLE_ANDROID, required so the surface can feed a MediaCodec encoder
            EGL14.EGL_NONE
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val numConfigs = IntArray(1)
        if (!EGL14.eglChooseConfig(eglDisplay, attribList, 0, configs, 0, 1, numConfigs, 0)) {
            throw RuntimeException("eglChooseConfig failed")
        }
        eglConfig = configs[0]

        val contextAttribs = intArrayOf(
            EGL14.EGL_CONTEXT_CLIENT_VERSION, 2,
            EGL14.EGL_NONE
        )
        eglContext = EGL14.eglCreateContext(eglDisplay, eglConfig, EGL14.EGL_NO_CONTEXT, contextAttribs, 0)
        if (eglContext == EGL14.EGL_NO_CONTEXT) throw RuntimeException("eglCreateContext failed")
    }

    fun createWindowSurface(surface: Surface): EGLSurface {
        val attribs = intArrayOf(EGL14.EGL_NONE)
        val eglSurface = EGL14.eglCreateWindowSurface(eglDisplay, eglConfig, surface, attribs, 0)
        if (eglSurface == EGL14.EGL_NO_SURFACE) throw RuntimeException("eglCreateWindowSurface failed")
        return eglSurface
    }

    fun makeCurrent(eglSurface: EGLSurface) {
        if (!EGL14.eglMakeCurrent(eglDisplay, eglSurface, eglSurface, eglContext)) {
            throw RuntimeException("eglMakeCurrent failed")
        }
    }

    fun swapBuffers(eglSurface: EGLSurface): Boolean {
        return EGL14.eglSwapBuffers(eglDisplay, eglSurface)
    }

    fun setPresentationTime(eglSurface: EGLSurface, nsecs: Long) {
        android.opengl.EGLExt.eglPresentationTimeANDROID(eglDisplay, eglSurface, nsecs)
    }

    fun releaseSurface(eglSurface: EGLSurface) {
        EGL14.eglDestroySurface(eglDisplay, eglSurface)
    }

    fun release() {
        if (eglDisplay != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(eglDisplay, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            EGL14.eglDestroyContext(eglDisplay, eglContext)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(eglDisplay)
        }
        eglDisplay = EGL14.EGL_NO_DISPLAY
        eglContext = EGL14.EGL_NO_CONTEXT
    }
} 
