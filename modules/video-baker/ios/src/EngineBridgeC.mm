// NOT COMPILED OR TESTED (see MetalRenderBackend.h). Plain C exports —
// Swift can call C functions directly via a bridging header, no Embind-
// or JNI-style binding generator needed, which is why this file is
// simpler than jni_bridge.cpp/web_bridge.cpp despite doing the same job.
#import <QuartzCore/CAMetalLayer.h>
#include <algorithm>
#include <memory>
#include "MetalRenderBackend.h"
#include "lumvibe/EffectEngine.h"

using namespace lumvibe;

struct EngineSession {
    std::shared_ptr<MetalRenderBackend> backend;
    std::unique_ptr<EffectEngine> engine;
};

extern "C" {

// metalLayer: pass your CAMetalLayer (the camera preview layer's
// .layer, cast to void*) from Swift — see LumVibeEngineBridge.swift.
void* lumvibe_create(const char* manifestPath, void* metalLayer) {
    auto* session = new EngineSession();
    session->backend = std::make_shared<MetalRenderBackend>(metalLayer);
    session->engine = std::make_unique<EffectEngine>(session->backend);
    if (!session->engine->loadManifest(manifestPath)) { delete session; return nullptr; }
    return session;
}

bool lumvibe_setEffect(void* handle, const char* effectId) {
    return ((EngineSession*)handle)->engine->setEffect(effectId);
}

bool lumvibe_isEffectAvailable(void* handle, const char* effectId) {
    return ((EngineSession*)handle)->engine->isEffectAvailable(effectId);
}

// Same flat-array convention as jni_bridge.cpp's nativeUpdateSignals and
// web_bridge.cpp's updateSignals — one call per frame, one contract
// across all three platforms. See LumVibeEngineBridge.swift for how
// Swift arrays get passed as C pointers.
void lumvibe_updateSignals(
    void* handle, float timeElapsed, float timeDelta,
    const float* faceSignal,
    const float* gazeTrailPoints, const float* gazeTrailAges, int gazeTrailCount,
    const float* handSignals, int handCount,
    const float* fingerTrailPoints, const float* fingerTrailAges, int fingerTrailCount,
    float audioAmplitude, float motionMagnitude, float stillnessSeconds,
    bool bodyDetected, const float* bodyBox,
    bool touchActive, float touchX, float touchY) {

    auto* session = (EngineSession*)handle;
    FrameSignals signals;
    signals.time.elapsedSec = timeElapsed;
    signals.time.deltaSec = timeDelta;

    signals.face.detected = faceSignal[0] > 0.5f;
    signals.face.smileScore = faceSignal[1];
    signals.face.browRaiseScore = faceSignal[2];
    signals.face.jawOpen = faceSignal[3];
    signals.face.winkScore = faceSignal[4];
    signals.face.boundingBox = {faceSignal[5], faceSignal[6], faceSignal[7], faceSignal[8]};
    signals.face.mouthCenter = {faceSignal[9], faceSignal[10]};
    signals.face.headRoll = faceSignal[11];
    signals.face.headPitch = faceSignal[12];
    signals.face.headYaw = faceSignal[13];
    signals.face.eyeBlinkBoth = faceSignal[14] > 0.5f;
    signals.face.yawDelta = faceSignal[15];

    signals.face.gazeTrailCount = std::min(gazeTrailCount, 8);
    for (int i = 0; i < signals.face.gazeTrailCount; i++) {
        signals.face.gazeTrail[i] = {gazeTrailPoints[i * 2], gazeTrailPoints[i * 2 + 1]};
        signals.face.gazeTrailAges[i] = gazeTrailAges[i];
    }

    for (int i = 0; i < handCount && i < 2; i++) {
        HandSignal h;
        int base = i * 6;
        h.detected = handSignals[base] > 0.5f;
        h.palmCenter = {handSignals[base + 1], handSignals[base + 2]};
        h.gesture = static_cast<HandGesture>((int)handSignals[base + 3]);
        h.angle = handSignals[base + 4];
        h.throwVelocity = handSignals[base + 5];
        signals.hands.push_back(h);
    }
    if (!signals.hands.empty()) {
        signals.hands[0].fingerTrailCount = std::min(fingerTrailCount, 16);
        for (int i = 0; i < signals.hands[0].fingerTrailCount; i++) {
            signals.hands[0].fingerTrail[i] = {fingerTrailPoints[i * 2], fingerTrailPoints[i * 2 + 1]};
            signals.hands[0].fingerTrailAges[i] = fingerTrailAges[i];
        }
    }

    signals.audio.amplitude = audioAmplitude;
    signals.motion.magnitude = motionMagnitude;
    signals.motion.stillnessSeconds = stillnessSeconds;
    signals.body.detected = bodyDetected;
    if (bodyDetected) signals.body.boundingBox = {bodyBox[0], bodyBox[1], bodyBox[2], bodyBox[3]};
    signals.touch.active = touchActive;
    signals.touch.position = {touchX, touchY};

    session->engine->updateSignals(signals);
}

// cvPixelBuffer: pass the CVPixelBufferRef from your
// AVCaptureVideoDataOutputSampleBufferDelegate callback, cast to void* —
// see CameraCapture.swift.
void lumvibe_renderFrame(void* handle, void* cvPixelBuffer) {
    auto* session = (EngineSession*)handle;
    session->backend->uploadCameraFrame(cvPixelBuffer);
    session->backend->beginFrame();
    session->engine->renderFrame();
    session->backend->endFrame();
}

void lumvibe_release(void* handle) { delete (EngineSession*)handle; }

} // extern "C"
