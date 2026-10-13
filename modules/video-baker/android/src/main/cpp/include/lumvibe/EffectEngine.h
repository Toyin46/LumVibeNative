#pragma once
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

#include "BeatDetector.h"
#include "EffectDefinition.h"
#include "Signals.h"

namespace lumvibe {

// Abstracts the actual GPU calls so this header has ZERO Filament/bgfx/GLES
// dependency — swap rendering backends without touching the interpreter
// below. Start with a thin implementation ported directly from
// GlUtil.kt/FrameRenderer.kt (proves the interpreter design cheaply on
// Android before adopting Filament/bgfx for the real cross-platform build).
class IRenderBackend {
public:
    virtual ~IRenderBackend() = default;
    virtual uint32_t compileProgram(const std::string& vs, const std::string& fs) = 0;
    virtual void useProgram(uint32_t program) = 0;
    virtual void setUniformFloat(uint32_t program, const std::string& name, float v) = 0;
    virtual void setUniformVec2(uint32_t program, const std::string& name, Vec2 v) = 0;
    virtual void setUniformVec4(uint32_t program, const std::string& name, Vec4 v) = 0;
    virtual void setUniformFloatArray(uint32_t program, const std::string& name, const float* v, int count) = 0;
    virtual void setUniformVec2Array(uint32_t program, const std::string& name, const Vec2* v, int count) = 0;
    virtual void setUniformInt(uint32_t program, const std::string& name, int v) = 0;
    virtual void bindTexture(uint32_t program, const std::string& samplerName, uint32_t textureUnit, uint32_t textureId) = 0;
    // The camera frame needs its own method (not the generic bindTexture
    // above) because on Android it's GL_TEXTURE_EXTERNAL_OES, not a plain
    // 2D texture — a platform-specific binding target, same reason
    // GlUtil.kt had a separate createExternalTexture() from
    // createTexture2D(). Always bound to the fixed uniform name "uTexture"
    // at unit 0, matching every ported shader's convention.
    virtual void bindCameraTexture(uint32_t program, uint32_t externalTextureId) = 0;
    virtual uint32_t loadTextureAsset(const std::string& path) = 0;
    virtual void drawFullscreenQuad() = 0;
    // STAGE A FIX: the camera's SurfaceTexture transform (rotation/mirror) must reach the
    // vertex shader's `uTexMatrix`; the engine never set it, so every effect sampled one texel.
    // Default no-op keeps the iOS/Metal and Web backends compiling unchanged.
    virtual void setUniformMat4(uint32_t /*program*/, const std::string& /*name*/, const float* /*m16*/) {}
    // Centre-crop texture coordinates for the camera quad (4 corners, s,t each) so the live
    // preview fills the screen without stretching, same as the legacy FrameRenderer.
    virtual void setCameraTexCoords(const float* /*uv8*/) {}
};

// Direct port of ParticleSystem.kt — same physics, same MAX_PARTICLES
// contract with the fixed-size uniform arrays. Owned per particleSystems[]
// entry declared in an EffectDefinition, not per-effect-hand-written.
class ParticleSystem {
public:
    ParticleSystem(float gravity, int maxParticles);
    void spawnBurst(Vec2 origin, int count, float speed, float lifetimeSec);
    void update(float dtSec);
    void toUniforms(std::vector<Vec2>& positions, std::vector<float>& rotations,
                     std::vector<float>& life, std::vector<float>& colorIndex, int& count) const;

private:
    struct Particle { Vec2 pos, vel; float rotationDeg, rotationSpeed, lifetime, age; int colorIndex; };
    std::vector<Particle> particles_;
    float gravity_;
    int maxParticles_;
};

// The generic per-frame interpreter. Every mode — bake-to-file, live
// preview, bake-a-single-photo — constructs ONE of these and calls
// renderFrame(). This is what replaces the old VideoTranscoder /
// LiveEffectPreviewView / EffectRequirements triplication: one evaluator,
// data-driven from the manifest, instead of three hand-written switches.
class EffectEngine {
public:
    explicit EffectEngine(std::shared_ptr<IRenderBackend> backend);

    // Parses the JSON manifest produced by compile-manifest.ts, reading it
    // from a real filesystem path. Used on Android/iOS, where the
    // manifest ships as a bundled app asset. Call once at startup.
    bool loadManifest(const std::string& jsonPath);

    // Same parsing, but from an already-in-memory JSON string — used on
    // Web, where there's no arbitrary filesystem to fopen() and the
    // website instead `fetch()`es effects.manifest.json and passes its
    // text content straight through (see web_bridge.cpp). Both overloads
    // share the same parsing body; only how the text gets acquired
    // differs.
    bool loadManifestFromString(const std::string& jsonText);

    // Selects the active effect by id — matches the existing
    // "vintage_flicker" / "mood_ring" / etc. keys used today, so the JS
    // call sites (bakeVideo/bakeImage/<LiveEffectPreview effect prop>)
    // don't change at all. Lazily compiles the shader program and
    // constructs any declared particle systems the first time an effect is
    // selected. Returns false (and leaves the previous effect active) if
    // the id declares a requiresSubsystem this build doesn't have yet.
    bool setEffect(const std::string& effectId);

    // Call once per frame, BEFORE renderFrame(), from the tracker layer,
    // with this frame's real face/hand/audio/segmentation/motion readings.
    // This is the single write point for signals — no effect-specific code
    // reaches into trackers directly anymore.
    void updateSignals(const FrameSignals& signals);

    // Call once after attaching a surface (see jni_bridge.cpp's
    // nativeAttachWindowSurface/nativeAttachOffscreenSurface) so renderFrame()
    // knows which external texture to bind as "uTexture" every frame —
    // every ported effect's shader expects the live camera frame there
    // without declaring it as an explicit binding.
    void setCameraTexture(uint32_t externalTextureId) { cameraTextureId_ = externalTextureId; }

    // STAGE A: SurfaceTexture.getTransformMatrix() (16 floats, column-major) — applied to the
    // `uTexMatrix` uniform in every renderFrame(). Defaults to identity.
    void setTexMatrix(const float* m16) { if (m16) for (int i = 0; i < 16; ++i) texMatrix_[i] = m16[i]; }
    // STAGE A: 8 floats (4 corners x s,t), forwarded to the backend's quad.
    void setCameraTexCoords(const float* uv8) { if (backend_ && uv8) backend_->setCameraTexCoords(uv8); }

    // Runs the currently-selected effect: binds its program, resolves
    // every declared binding against the current signals, evaluates
    // triggers, steps any particle systems, and draws.
    void renderFrame();

    // For the single-photo bake path: applies staticFallback values for
    // any binding whose signal is temporal-only (audio/motion/stillness),
    // then renders once. Replaces EffectRequirements.applyStaticFrame's
    // per-effect switch with one generic function reading declared data.
    void renderStaticFrame(const FrameSignals& singleFrameSignals);

    // True if id exists in the loaded manifest and its requiresSubsystem
    // (if any) is registered as available — use this to gray out /
    // "coming soon" entries in the effect-picker UI instead of guessing.
    bool isEffectAvailable(const std::string& effectId) const;

    // Registers that a given subsystem now has a real native
    // implementation (e.g. once you build mesh warping), unlocking every
    // manifest effect that declares requiresSubsystem == name.
    void registerSubsystem(const std::string& name);

private:
    float texMatrix_[16] = {1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1};
    std::shared_ptr<IRenderBackend> backend_;
    std::vector<EffectDefinitionNative> effects_;
    std::unordered_map<std::string, bool> availableSubsystems_;
    std::string currentEffectId_;
    std::unordered_map<std::string, uint32_t> compiledPrograms_;
    std::unordered_map<std::string, std::unique_ptr<ParticleSystem>> particleSystems_;
    std::unordered_map<std::string, uint32_t> loadedAssetTextures_;
    FrameSignals currentSignals_;
    std::unordered_map<std::string, bool> triggerEdgeState_; // for edge() detection across frames
    float freezeFrameAge_ = -1.f; // <0 = not active; blink_freeze/freeze_touch's shared engine-level state
    float freezeHoldSeconds_ = 0.3f;
    float freezeZoomTarget_ = 1.15f;

    // Generic decaying "boom" (fist_bump_boom, clap_burst, tap_shockwave) —
    // one shared timer/position pair, same technique the original Kotlin
    // used (uBoomCenter/uBoomEnergy bound to ANY shader that declares them).
    Vec2 boomCenter_{0.5f, 0.5f};
    float boomEnergy_ = 0.f;
    float boomDecayRate_ = 2.f;

    float explosionProgress_ = 0.f; // face_explosion
    float explosionDecayRate_ = 0.f;

    float beatPulse_ = 0.f;  // beat_reactor
    Vec2 beatShakeOffset_{0.f, 0.f}; // beat_shake
    float dropEnergy_ = 0.f; // drop_transform
    float dropDecayRate_ = 0.f;

    BeatDetector beatDetector_;
    uint32_t cameraTextureId_ = 0;

    const EffectDefinitionNative* findEffect(const std::string& id) const;

    struct ResolvedValue {
        enum Kind { Float, Vec2Val, Vec4Val, Int, FloatArr, Vec2Arr } kind;
        float f = 0; Vec2 v2; Vec4 v4; int i = 0;
        std::vector<float> fArr; std::vector<Vec2> v2Arr;
    };
    // The ONE place SignalPath strings are interpreted. Every string in
    // engine-ts/types/EffectDefinition.ts's SignalPath union needs exactly
    // one case here — see EffectEngine.cpp for the reference
    // implementation covering the common cases; extending it to the full
    // ~40-path union is mechanical, not architectural.
    ResolvedValue resolveSignal(const std::string& path) const;

    void applyBindings(uint32_t program, const EffectDefinitionNative& def);
    void evaluateTriggers(const EffectDefinitionNative& def);
    bool evaluateCondition(const std::string& expr, const std::string& triggerKey);
    void runAction(const std::string& action);
};

} // namespace lumvibe
