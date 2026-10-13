#pragma once
#include <GLES2/gl2.h>
#include <GLES2/gl2ext.h>
#include <cstdio>

#include "EffectEngine.h"

// CHANGED: moved here from engine-native/android/include/ — this file is
// now SHARED between Android and Web. Emscripten ships the same
// <GLES2/gl2.h>/<GLES2/gl2ext.h> headers and maps GLES2 calls onto WebGL,
// so the exact same compileProgram/glUniform*/drawFullscreenQuad code
// works unchanged on both. Only logging and shader preprocessing need a
// platform branch (both handled below) — everything else is one file, one
// implementation, for both platforms, which is the actual point of using
// a shared C++ core at all.
#if defined(__ANDROID__)
#include <android/log.h>
#define LUMVIBE_LOG(...) __android_log_print(ANDROID_LOG_ERROR, "LumVibe/GLES2Backend", __VA_ARGS__)
#else
#define LUMVIBE_LOG(...) fprintf(stderr, "[LumVibe/GLES2Backend] " __VA_ARGS__)
#endif

namespace lumvibe {

// Real GLES2 implementation of IRenderBackend — a direct port of
// GlUtil.kt's shader/program/texture helpers and FrameRenderer.kt's
// drawQuad() pattern (same fullscreen-quad vertex/texcoord arrays, same
// GL_TRIANGLE_STRIP draw call, same enable/disable-vertex-attrib bracketing).
class GLES2RenderBackend : public IRenderBackend {
public:
    GLES2RenderBackend() {
        static const float kVertexCoords[] = {-1.f, -1.f, 1.f, -1.f, -1.f, 1.f, 1.f, 1.f};
        static const float kTexCoords[] = {0.f, 0.f, 1.f, 0.f, 0.f, 1.f, 1.f, 1.f};
        vertexCoords_.assign(kVertexCoords, kVertexCoords + 8);
        texCoords_.assign(kTexCoords, kTexCoords + 8);
    }

    uint32_t compileProgram(const std::string& vs, const std::string& fs) override {
        GLuint vertexShader = loadShader(GL_VERTEX_SHADER, preprocessForPlatform(vs));
        GLuint fragmentShader = loadShader(GL_FRAGMENT_SHADER, preprocessForPlatform(fs));

        GLuint program = glCreateProgram();
        glAttachShader(program, vertexShader);
        glAttachShader(program, fragmentShader);
        glLinkProgram(program);

        GLint linkStatus = 0;
        glGetProgramiv(program, GL_LINK_STATUS, &linkStatus);
        if (linkStatus != GL_TRUE) {
            char log[1024];
            glGetProgramInfoLog(program, sizeof(log), nullptr, log);
            glDeleteProgram(program);
            LUMVIBE_LOG("Could not link program: %s\n", log);
            return 0;
        }
        glDeleteShader(vertexShader);
        glDeleteShader(fragmentShader);
        return program;
    }

    void useProgram(uint32_t program) override {
        glUseProgram(program);
        currentProgram_ = program;
    }

    void setUniformFloat(uint32_t program, const std::string& name, float v) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0) glUniform1f(loc, v);
    }

    void setUniformVec2(uint32_t program, const std::string& name, Vec2 v) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0) glUniform2f(loc, v.x, v.y);
    }

    void setUniformMat4(uint32_t program, const std::string& name, const float* m16) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0 && m16) glUniformMatrix4fv(loc, 1, GL_FALSE, m16);
    }

    void setCameraTexCoords(const float* uv8) override {
        if (uv8) texCoords_.assign(uv8, uv8 + 8);
    }

    void setUniformVec4(uint32_t program, const std::string& name, Vec4 v) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0) glUniform4f(loc, v.x, v.y, v.z, v.w);
    }

    void setUniformFloatArray(uint32_t program, const std::string& name, const float* v, int count) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0 && count > 0) glUniform1fv(loc, count, v);
    }

    void setUniformVec2Array(uint32_t program, const std::string& name, const Vec2* v, int count) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0 && count > 0) glUniform2fv(loc, count, reinterpret_cast<const float*>(v));
    }

    void setUniformInt(uint32_t program, const std::string& name, int v) override {
        GLint loc = glGetUniformLocation(program, name.c_str());
        if (loc >= 0) glUniform1i(loc, v);
    }

    void bindTexture(uint32_t program, const std::string& samplerName, uint32_t textureUnit, uint32_t textureId) override {
        glActiveTexture(GL_TEXTURE0 + textureUnit);
        glBindTexture(GL_TEXTURE_2D, textureId);
        GLint loc = glGetUniformLocation(program, samplerName.c_str());
        if (loc >= 0) glUniform1i(loc, textureUnit);
    }

    // On Android, the live camera frame is GL_TEXTURE_EXTERNAL_OES (a
    // platform-specific binding target — same reason GlUtil.kt had a
    // separate createExternalTexture() from createTexture2D()). On Web
    // there's no such extension: the browser uploads each video frame as
    // a plain GL_TEXTURE_2D via texImage2D/texSubImage2D (see
    // WebGLRenderBackend's uploadVideoFrame, called by the JS/TS side
    // before renderFrame() each frame). Both paths converge here — this
    // method just binds whatever's already been uploaded to "uTexture".
    void bindCameraTexture(uint32_t program, uint32_t cameraTextureId) override {
        glActiveTexture(GL_TEXTURE0);
#if defined(__ANDROID__)
        glBindTexture(GL_TEXTURE_EXTERNAL_OES, cameraTextureId);
#else
        glBindTexture(GL_TEXTURE_2D, cameraTextureId);
#endif
        GLint loc = glGetUniformLocation(program, "uTexture");
        if (loc >= 0) glUniform1i(loc, 0);
        GLint texelLoc = glGetUniformLocation(program, "uTexelSize");
        if (texelLoc >= 0 && frameWidth_ > 0 && frameHeight_ > 0) {
            glUniform2f(texelLoc, 1.0f / frameWidth_, 1.0f / frameHeight_);
        }
    }

    void setFrameSize(int width, int height) { frameWidth_ = width; frameHeight_ = height; }

    uint32_t loadTextureAsset(const std::string& path) override {
        // Real pixel decode is platform-specific (BitmapFactory via JNI on
        // Android, an <img>/createImageBitmap + texImage2D call on Web) —
        // left as a call-out point rather than faked, same as before.
        GLuint texId = createTexture2D();
        LUMVIBE_LOG("loadTextureAsset(%s): GL texture %u created, pixel upload not yet wired to a decoder\n", path.c_str(), texId);
        return texId;
    }

    void drawFullscreenQuad() override {
        GLint aPosition = glGetAttribLocation(currentProgram_, "aPosition");
        GLint aTexCoord = glGetAttribLocation(currentProgram_, "aTexCoord");

        glVertexAttribPointer(aPosition, 2, GL_FLOAT, GL_FALSE, 0, vertexCoords_.data());
        glEnableVertexAttribArray(aPosition);

        glVertexAttribPointer(aTexCoord, 2, GL_FLOAT, GL_FALSE, 0, texCoords_.data());
        glEnableVertexAttribArray(aTexCoord);

        glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

        glDisableVertexAttribArray(aPosition);
        glDisableVertexAttribArray(aTexCoord);
    }

#if defined(__ANDROID__)
    // Direct port of GlUtil.createExternalTexture() — Android only; Web
    // has no external-texture concept (see bindCameraTexture above).
    static uint32_t createExternalTexture() {
        GLuint texId;
        glGenTextures(1, &texId);
        glBindTexture(GL_TEXTURE_EXTERNAL_OES, texId);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_EXTERNAL_OES, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        return texId;
    }
#endif

    // Direct port of GlUtil.createTexture2D() — used on both platforms
    // (asset textures, and the Web camera-frame texture).
    static uint32_t createTexture2D() {
        GLuint texId;
        glGenTextures(1, &texId);
        glBindTexture(GL_TEXTURE_2D, texId);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        return texId;
    }

    static void deleteTexture(uint32_t texId) {
        GLuint id = texId;
        glDeleteTextures(1, &id);
    }

    static void checkGlError(const char* op) {
        GLenum error = glGetError();
        if (error != GL_NO_ERROR) LUMVIBE_LOG("%s: glError 0x%x\n", op, error);
    }

    // THE REAL CROSS-PLATFORM FIX: every shader in the 61-effect catalog
    // is written as EXT_HEADER + "uniform samplerExternalOES uTexture" —
    // Android's GL_OES_EGL_image_external extension, which doesn't exist
    // in WebGL (or Metal, on iOS). Rather than hand-edit 61 shader files
    // per platform, this does the one substitution automatically at
    // compile time: on non-Android builds, strip the OES extension
    // pragma and downgrade the sampler type to plain sampler2D — which is
    // exactly what bindCameraTexture() above binds for Web anyway. Every
    // TS effect definition stays platform-neutral; this is the only place
    // the Android-specific convention gets resolved.
    static std::string preprocessForPlatform(const std::string& src) {
#if defined(__ANDROID__)
        return src;
#else
        std::string out = src;
        const std::string extLine = "#extension GL_OES_EGL_image_external : require\n";
        size_t extPos = out.find(extLine);
        if (extPos != std::string::npos) out.erase(extPos, extLine.size());
        size_t samplerPos;
        while ((samplerPos = out.find("samplerExternalOES")) != std::string::npos) {
            out.replace(samplerPos, std::string("samplerExternalOES").size(), "sampler2D");
        }
        return out;
#endif
    }

    static GLuint loadShader(GLenum type, const std::string& src) {
        GLuint shader = glCreateShader(type);
        const char* srcPtr = src.c_str();
        glShaderSource(shader, 1, &srcPtr, nullptr);
        glCompileShader(shader);

        GLint compiled = 0;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
        if (compiled == 0) {
            char log[1024];
            glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
            LUMVIBE_LOG("Could not compile shader type=%d: %s\n", type, log);
            glDeleteShader(shader);
            return 0;
        }
        return shader;
    }

    std::vector<float> vertexCoords_;
    std::vector<float> texCoords_;
    uint32_t currentProgram_ = 0;
    int frameWidth_ = 0;
    int frameHeight_ = 0;
};

} // namespace lumvibe
