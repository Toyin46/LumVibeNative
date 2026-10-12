#pragma once
// Pure C declarations — add this file to your module's bridging header
// (or Swift's auto-generated umbrella header, if using a Swift Package)
// so LumVibeEngineBridge.swift can call these directly.
#ifdef __cplusplus
extern "C" {
#endif

void* lumvibe_create(const char* manifestPath, void* metalLayer);
_Bool lumvibe_setEffect(void* handle, const char* effectId);
_Bool lumvibe_isEffectAvailable(void* handle, const char* effectId);
void lumvibe_updateSignals(
    void* handle, float timeElapsed, float timeDelta,
    const float* faceSignal,
    const float* gazeTrailPoints, const float* gazeTrailAges, int gazeTrailCount,
    const float* handSignals, int handCount,
    const float* fingerTrailPoints, const float* fingerTrailAges, int fingerTrailCount,
    float audioAmplitude, float motionMagnitude, float stillnessSeconds,
    _Bool bodyDetected, const float* bodyBox,
    _Bool touchActive, float touchX, float touchY);
void lumvibe_renderFrame(void* handle, void* cvPixelBuffer);
void lumvibe_release(void* handle);

#ifdef __cplusplus
}
#endif
