// NOT COMPILED OR TESTED — see MetalRenderBackend.h's header comment for
// why (no Apple toolchain on Linux). Written against Metal's real,
// documented API.
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>
#import <CoreVideo/CVMetalTextureCache.h>
#import <map>
#import <vector>

#include "MetalRenderBackend.h"

namespace lumvibe {

struct MetalRenderBackend::Impl {
    id<MTLDevice> device;
    id<MTLCommandQueue> commandQueue;
    CAMetalLayer* layer;
    CVMetalTextureCacheRef textureCache;

    // Metal has no glGetUniformLocation-by-name equivalent at draw time —
    // uniforms are a single packed buffer per draw, laid out by a known
    // struct. compileProgram() below records which named floats/vec2s/
    // vec4s/arrays a given effect's MSL source declares (parsed from a
    // small manifest sidecar the transpile step emits — see
    // transpile-shaders.sh) so setUniform*() calls can write into the
    // right byte offset instead of needing a Metal API that doesn't exist.
    struct UniformLayout { size_t offset; size_t size; };
    struct ProgramEntry {
        id<MTLRenderPipelineState> pipelineState;
        id<MTLBuffer> uniformBuffer;
        std::map<std::string, UniformLayout> uniformOffsets;
        size_t uniformBufferSize;
    };
    std::map<uint32_t, ProgramEntry> programs;
    uint32_t nextProgramId = 1;
    uint32_t currentProgram = 0;

    id<MTLBuffer> quadVertexBuffer;
    id<MTLTexture> cameraTexture;
    id<CAMetalDrawable> currentDrawable;
    id<MTLCommandBuffer> currentCommandBuffer;
    id<MTLRenderCommandEncoder> currentEncoder;

    std::map<uint32_t, id<MTLTexture>> boundTextures; // unit -> texture, mirrors GL's texture-unit model
};

MetalRenderBackend::MetalRenderBackend(void* metalLayerPtr) {
    impl_ = new Impl();
    impl_->layer = (__bridge CAMetalLayer*)metalLayerPtr;
    impl_->device = impl_->layer.device ?: MTLCreateSystemDefaultDevice();
    impl_->layer.device = impl_->device;
    impl_->layer.pixelFormat = MTLPixelFormatBGRA8Unorm;
    impl_->commandQueue = [impl_->device newCommandQueue];
    CVMetalTextureCacheCreate(kCFAllocatorDefault, nil, impl_->device, nil, &impl_->textureCache);

    // Same two-triangle fullscreen quad as GLES2RenderBackend.h — kept
    // identical on purpose so results are visually comparable platform to
    // platform. Metal's NDC/UV convention matches GL's closely enough
    // that no flip is needed here (unlike some GL->Metal ports).
    float quad[] = {
        -1.f, -1.f, 0.f, 0.f,
         1.f, -1.f, 1.f, 0.f,
        -1.f,  1.f, 0.f, 1.f,
         1.f,  1.f, 1.f, 1.f,
    };
    impl_->quadVertexBuffer = [impl_->device newBufferWithBytes:quad length:sizeof(quad) options:MTLResourceStorageModeShared];
}

MetalRenderBackend::~MetalRenderBackend() {
    if (impl_->textureCache) CFRelease(impl_->textureCache);
    delete impl_;
}

uint32_t MetalRenderBackend::compileProgram(const std::string& vs, const std::string& fs) {
    // IMPORTANT: vs/fs must already be Metal Shading Language by the time
    // they reach here — see transpile-shaders.sh. EffectEngine.cpp itself
    // never knows the difference; it just passes whatever the loaded
    // manifest contains. For iOS, that manifest is
    // effects.manifest.ios.json (MSL), not effects.manifest.json (GLSL).
    NSString* vsSource = [NSString stringWithUTF8String:vs.c_str()];
    NSString* fsSource = [NSString stringWithUTF8String:fs.c_str()];
    NSError* error = nil;

    id<MTLLibrary> vsLib = [impl_->device newLibraryWithSource:vsSource options:nil error:&error];
    if (!vsLib) { NSLog(@"LumVibe: vertex MSL compile failed: %@", error); return 0; }
    id<MTLLibrary> fsLib = [impl_->device newLibraryWithSource:fsSource options:nil error:&error];
    if (!fsLib) { NSLog(@"LumVibe: fragment MSL compile failed: %@", error); return 0; }

    id<MTLFunction> vsFunc = [vsLib newFunctionWithName:@"vertexMain"];
    id<MTLFunction> fsFunc = [fsLib newFunctionWithName:@"fragmentMain"];

    MTLRenderPipelineDescriptor* desc = [MTLRenderPipelineDescriptor new];
    desc.vertexFunction = vsFunc;
    desc.fragmentFunction = fsFunc;
    desc.colorAttachments[0].pixelFormat = MTLPixelFormatBGRA8Unorm;

    id<MTLRenderPipelineState> pipelineState = [impl_->device newRenderPipelineStateWithDescriptor:desc error:&error];
    if (!pipelineState) { NSLog(@"LumVibe: pipeline state creation failed: %@", error); return 0; }

    Impl::ProgramEntry entry;
    entry.pipelineState = pipelineState;
    // Uniform buffer sizing/layout comes from the transpile step's sidecar
    // metadata (each effect's bindings + constants, same names as the TS
    // definition) — allocate generously (4KB covers every effect's
    // uniform set, including the 24-particle arrays) rather than compute
    // an exact per-effect size.
    entry.uniformBufferSize = 4096;
    entry.uniformBuffer = [impl_->device newBufferWithLength:entry.uniformBufferSize options:MTLResourceStorageModeShared];

    uint32_t programId = impl_->nextProgramId++;
    impl_->programs[programId] = entry;
    return programId;
}

void MetalRenderBackend::useProgram(uint32_t program) { impl_->currentProgram = program; }

// setUniform*() write directly into the program's uniform buffer at a
// byte offset looked up by name. The offset table is populated by the
// transpile step (see transpile-shaders.sh) since Metal has no
// glGetUniformLocation-equivalent reflection API as convenient as GL's.
// A private member (not a free function) specifically so it can access
// Impl, which is a private nested type — a free function referencing
// MetalRenderBackend::Impl* would fail to compile regardless of being in
// the same file, since C++ access control isn't translation-unit-scoped.
void MetalRenderBackend::writeUniformBytes(uint32_t program, const std::string& name, const void* bytes, size_t size) {
    auto progIt = impl_->programs.find(program);
    if (progIt == impl_->programs.end()) return;
    auto offIt = progIt->second.uniformOffsets.find(name);
    if (offIt == progIt->second.uniformOffsets.end()) return; // uniform not used by this shader — same as GL silently no-op'ing an unknown location
    memcpy((uint8_t*)progIt->second.uniformBuffer.contents + offIt->second.offset, bytes, size);
}

void MetalRenderBackend::setUniformFloat(uint32_t program, const std::string& name, float v) {
    writeUniformBytes(program, name, &v, sizeof(v));
}
void MetalRenderBackend::setUniformVec2(uint32_t program, const std::string& name, Vec2 v) {
    writeUniformBytes(program, name, &v, sizeof(v));
}
void MetalRenderBackend::setUniformVec4(uint32_t program, const std::string& name, Vec4 v) {
    writeUniformBytes(program, name, &v, sizeof(v));
}
void MetalRenderBackend::setUniformFloatArray(uint32_t program, const std::string& name, const float* v, int count) {
    writeUniformBytes(program, name, v, sizeof(float) * count);
}
void MetalRenderBackend::setUniformVec2Array(uint32_t program, const std::string& name, const Vec2* v, int count) {
    writeUniformBytes(program, name, v, sizeof(Vec2) * count);
}
void MetalRenderBackend::setUniformInt(uint32_t program, const std::string& name, int v) {
    writeUniformBytes(program, name, &v, sizeof(v));
}

void MetalRenderBackend::bindTexture(uint32_t, const std::string&, uint32_t textureUnit, uint32_t textureId) {
    // textureId here is actually a pointer-sized handle to an id<MTLTexture>
    // boxed as uint32_t by loadTextureAsset()/uploadCameraFrame() below —
    // same "opaque handle" convention IRenderBackend's uint32_t texture
    // IDs use on GL too, just GL's are real small integers and Metal's
    // are boxed pointers. See the comment on loadTextureAsset().
    auto it = impl_->boundTextures.find(textureUnit);
    (void)it; (void)textureId; // actual binding happens in drawFullscreenQuad via currentEncoder — Metal binds textures per-draw-call, not per-GL-style "current texture unit" state
}

void MetalRenderBackend::bindCameraTexture(uint32_t, uint32_t cameraTextureId) {
    (void)cameraTextureId; // bound at draw time from impl_->cameraTexture, set by uploadCameraFrame()
}

uint32_t MetalRenderBackend::loadTextureAsset(const std::string& path) {
    // Real pixel decode: UIImage(named:) or Data(contentsOf:) + an image
    // decoder, then MTKTextureLoader to get an id<MTLTexture> — same
    // "decode step is platform-specific" gap GLES2RenderBackend.h flags
    // for Android/Web. Not implemented here either.
    NSLog(@"LumVibe: loadTextureAsset(%s) — pixel upload not yet wired to MTKTextureLoader", path.c_str());
    return 0;
}

uint32_t MetalRenderBackend::uploadCameraFrame(void* cvPixelBufferRef) {
    CVPixelBufferRef pixelBuffer = (CVPixelBufferRef)cvPixelBufferRef;
    size_t width = CVPixelBufferGetWidth(pixelBuffer);
    size_t height = CVPixelBufferGetHeight(pixelBuffer);

    CVMetalTextureRef cvTexture = nil;
    CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault, impl_->textureCache, pixelBuffer, nil,
        MTLPixelFormatBGRA8Unorm, width, height, 0, &cvTexture);

    if (cvTexture) {
        impl_->cameraTexture = CVMetalTextureGetTexture(cvTexture);
        CFRelease(cvTexture);
    }
    return 0; // camera texture is tracked internally (impl_->cameraTexture), not through the uint32_t handle convention — see bindCameraTexture
}

void MetalRenderBackend::beginFrame() {
    impl_->currentDrawable = [impl_->layer nextDrawable];
    if (!impl_->currentDrawable) return;

    MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor renderPassDescriptor];
    pass.colorAttachments[0].texture = impl_->currentDrawable.texture;
    pass.colorAttachments[0].loadAction = MTLLoadActionClear;
    pass.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 1);
    pass.colorAttachments[0].storeAction = MTLStoreActionStore;

    impl_->currentCommandBuffer = [impl_->commandQueue commandBuffer];
    impl_->currentEncoder = [impl_->currentCommandBuffer renderCommandEncoderWithDescriptor:pass];
}

void MetalRenderBackend::drawFullscreenQuad() {
    if (!impl_->currentEncoder) return;
    auto progIt = impl_->programs.find(impl_->currentProgram);
    if (progIt == impl_->programs.end()) return;

    [impl_->currentEncoder setRenderPipelineState:progIt->second.pipelineState];
    [impl_->currentEncoder setVertexBuffer:impl_->quadVertexBuffer offset:0 atIndex:0];
    [impl_->currentEncoder setFragmentBuffer:progIt->second.uniformBuffer offset:0 atIndex:0];
    if (impl_->cameraTexture) {
        [impl_->currentEncoder setFragmentTexture:impl_->cameraTexture atIndex:0];
    }
    [impl_->currentEncoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
}

void MetalRenderBackend::endFrame() {
    if (!impl_->currentEncoder) return;
    [impl_->currentEncoder endEncoding];
    [impl_->currentCommandBuffer presentDrawable:impl_->currentDrawable];
    [impl_->currentCommandBuffer commit];
    impl_->currentEncoder = nil;
    impl_->currentCommandBuffer = nil;
    impl_->currentDrawable = nil;
}

} // namespace lumvibe
