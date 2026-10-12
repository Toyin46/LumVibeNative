#pragma once
#include "lumvibe/EffectEngine.h"

// NOT COMPILED OR TESTED — flagged honestly, not glossed over. Metal and
// Objective-C++ require Apple's toolchain, which doesn't exist on Linux
// at all (unlike GLES2/EGL/JNI, which I could stub against real API
// shapes and actually compile). This header/implementation is written
// against Metal's real, documented API (MTLDevice, MTLRenderPipelineState,
// MTLBuffer, MTLTexture) from direct knowledge of that API, structured to
// mirror GLES2RenderBackend.h method-for-method so the two are easy to
// compare — but it will meet a real compiler for the first time in Xcode,
// not here. Budget real debugging time for this file specifically.
//
// Declared as a plain C++ class (not Objective-C) so EffectEngine.cpp
// never needs to know Objective-C exists — MetalRenderBackend.mm's
// implementation holds the Objective-C Metal objects (id<MTLDevice> etc.)
// as opaque void* members, bridging to real ObjC types only inside the
// .mm file. This keeps the engine core's "zero platform-specific code"
// property intact even though the backend underneath is ObjC++.
namespace lumvibe {

class MetalRenderBackend : public IRenderBackend {
public:
    // layerHandle: a CAMetalLayer* (passed as void* to keep this header
    // Objective-C-free) backing whatever UIView your camera preview uses.
    explicit MetalRenderBackend(void* metalLayer);
    ~MetalRenderBackend() override;

    uint32_t compileProgram(const std::string& vs, const std::string& fs) override;
    void useProgram(uint32_t program) override;
    void setUniformFloat(uint32_t program, const std::string& name, float v) override;
    void setUniformVec2(uint32_t program, const std::string& name, Vec2 v) override;
    void setUniformVec4(uint32_t program, const std::string& name, Vec4 v) override;
    void setUniformFloatArray(uint32_t program, const std::string& name, const float* v, int count) override;
    void setUniformVec2Array(uint32_t program, const std::string& name, const Vec2* v, int count) override;
    void setUniformInt(uint32_t program, const std::string& name, int v) override;
    void bindTexture(uint32_t program, const std::string& samplerName, uint32_t textureUnit, uint32_t textureId) override;
    void bindCameraTexture(uint32_t program, uint32_t cameraTextureId) override;
    uint32_t loadTextureAsset(const std::string& path) override;
    void drawFullscreenQuad() override;

    // Upload a CVPixelBuffer (what AVCaptureSession hands you per frame)
    // as the camera texture — the Metal equivalent of Android's
    // GL_TEXTURE_EXTERNAL_OES binding / Web's texImage2D(video) call. Uses
    // CVMetalTextureCache for a zero-copy GPU upload where the hardware
    // supports it, same technique AVFoundation sample code uses.
    uint32_t uploadCameraFrame(void* cvPixelBufferRef);

    // Call once per frame before drawFullscreenQuad() — Metal requires an
    // explicit command buffer / encoder per frame, unlike GL's implicit
    // current-context state machine. beginFrame creates both; endFrame
    // commits and presents the drawable.
    void beginFrame();
    void endFrame();

private:
    void writeUniformBytes(uint32_t program, const std::string& name, const void* bytes, size_t size);

    struct Impl; // PIMPL — holds id<MTLDevice>, id<MTLCommandQueue>, CAMetalLayer*,
                 // per-effect id<MTLRenderPipelineState>, etc. See the .mm file.
    Impl* impl_;
};

} // namespace lumvibe
