#pragma once
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <android/native_window.h>
#include <stdexcept>

namespace lumvibe {

// Direct C++ port of EglCore.kt — same config attributes, same two surface
// types (window + pbuffer), same method shapes. EGL is a C API so this
// ports almost mechanically; the only real change is Kotlin exceptions
// becoming std::runtime_error and EGLSurface/EGLDisplay/EGLContext using
// the native EGL headers instead of the android.opengl.* wrappers.
class EglContext {
public:
    EglContext() {
        eglDisplay_ = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        if (eglDisplay_ == EGL_NO_DISPLAY) throw std::runtime_error("eglGetDisplay failed");

        EGLint majorVersion, minorVersion;
        if (!eglInitialize(eglDisplay_, &majorVersion, &minorVersion)) {
            throw std::runtime_error("eglInitialize failed");
        }

        const EGLint kRecordableAndroid = 0x3142; // EGL_RECORDABLE_ANDROID
        const EGLint attribList[] = {
            EGL_RED_SIZE, 8,
            EGL_GREEN_SIZE, 8,
            EGL_BLUE_SIZE, 8,
            EGL_ALPHA_SIZE, 8,
            EGL_RENDERABLE_TYPE, EGL_OPENGL_ES2_BIT,
            // Same reasoning as the Kotlin original: request BOTH window and
            // pbuffer support on one config so it backs the live/bake path
            // (window surface) AND the image-bake path (pbuffer) without a
            // second config.
            EGL_SURFACE_TYPE, EGL_WINDOW_BIT | EGL_PBUFFER_BIT,
            kRecordableAndroid, 1, // required so the surface can feed a MediaCodec encoder
            EGL_NONE
        };
        EGLint numConfigs = 0;
        if (!eglChooseConfig(eglDisplay_, attribList, &eglConfig_, 1, &numConfigs) || numConfigs < 1) {
            throw std::runtime_error("eglChooseConfig failed");
        }

        const EGLint contextAttribs[] = { EGL_CONTEXT_CLIENT_VERSION, 2, EGL_NONE };
        eglContext_ = eglCreateContext(eglDisplay_, eglConfig_, EGL_NO_CONTEXT, contextAttribs);
        if (eglContext_ == EGL_NO_CONTEXT) throw std::runtime_error("eglCreateContext failed");
    }

    EGLSurface createWindowSurface(ANativeWindow* window) {
        const EGLint attribs[] = { EGL_NONE };
        EGLSurface surface = eglCreateWindowSurface(eglDisplay_, eglConfig_,
                                                     reinterpret_cast<EGLNativeWindowType>(window), attribs);
        if (surface == EGL_NO_SURFACE) throw std::runtime_error("eglCreateWindowSurface failed");
        return surface;
    }

    // For render targets with no real Android Surface behind them — image
    // baking specifically. Same reasoning as the Kotlin original: width/
    // height must be positive, pbuffers don't tolerate 0.
    EGLSurface createOffscreenSurface(int width, int height) {
        const EGLint attribs[] = {
            EGL_WIDTH, width < 1 ? 1 : width,
            EGL_HEIGHT, height < 1 ? 1 : height,
            EGL_NONE
        };
        EGLSurface surface = eglCreatePbufferSurface(eglDisplay_, eglConfig_, attribs);
        if (surface == EGL_NO_SURFACE) throw std::runtime_error("eglCreatePbufferSurface failed");
        return surface;
    }

    void makeCurrent(EGLSurface surface) {
        if (!eglMakeCurrent(eglDisplay_, surface, surface, eglContext_)) {
            throw std::runtime_error("eglMakeCurrent failed");
        }
    }

    bool swapBuffers(EGLSurface surface) {
        return eglSwapBuffers(eglDisplay_, surface);
    }

    void setPresentationTime(EGLSurface surface, int64_t nsecs) {
        eglPresentationTimeANDROID(eglDisplay_, surface, nsecs);
    }

    void releaseSurface(EGLSurface surface) {
        eglDestroySurface(eglDisplay_, surface);
    }

    void release() {
        if (eglDisplay_ != EGL_NO_DISPLAY) {
            eglMakeCurrent(eglDisplay_, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            eglDestroyContext(eglDisplay_, eglContext_);
            eglReleaseThread();
            eglTerminate(eglDisplay_);
        }
        eglDisplay_ = EGL_NO_DISPLAY;
        eglContext_ = EGL_NO_CONTEXT;
    }

    ~EglContext() { release(); }

private:
    EGLDisplay eglDisplay_ = EGL_NO_DISPLAY;
    EGLContext eglContext_ = EGL_NO_CONTEXT;
    EGLConfig eglConfig_ = nullptr;
};

} // namespace lumvibe
