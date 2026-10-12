#include <android/native_window_jni.h>
#include <jni.h>

#include <algorithm>
#include <memory>

#include "EglContext.h"
#include "lumvibe/EffectEngine.h"
#include "lumvibe/GLES2RenderBackend.h" // shared with Web — see engine-native/include/lumvibe/

// One engine instance per JNI "session" (a VideoTranscoder run, a
// LiveEffectPreviewView surface, or an ImageBaker call) — matches how the
// Kotlin classes each own their own FrameRenderer instance today. Held as
// a raw pointer boxed into a jlong handle, same convention MediaCodec/
// EGL14 JNI wrappers use for native object handles.
struct EngineSession {
    std::unique_ptr<lumvibe::EglContext> egl;
    std::shared_ptr<lumvibe::GLES2RenderBackend> backend;
    std::unique_ptr<lumvibe::EffectEngine> engine;
    EGLSurface surface = EGL_NO_SURFACE;
    uint32_t cameraTextureId = 0;
};

extern "C" {

JNIEXPORT jlong JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeCreate(JNIEnv* env, jobject, jstring manifestPath) {
    auto* session = new EngineSession();
    session->egl = std::make_unique<lumvibe::EglContext>();
    session->backend = std::make_shared<lumvibe::GLES2RenderBackend>();
    session->engine = std::make_unique<lumvibe::EffectEngine>(session->backend);

    const char* path = env->GetStringUTFChars(manifestPath, nullptr);
    bool ok = session->engine->loadManifest(path);
    env->ReleaseStringUTFChars(manifestPath, path);
    if (!ok) { delete session; return 0; }
    return reinterpret_cast<jlong>(session);
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeAttachWindowSurface(
    JNIEnv* env, jobject, jlong handle, jobject surface) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    ANativeWindow* window = ANativeWindow_fromSurface(env, surface);
    session->surface = session->egl->createWindowSurface(window);
    session->egl->makeCurrent(session->surface);
    session->cameraTextureId = lumvibe::GLES2RenderBackend::createExternalTexture();
    session->engine->setCameraTexture(session->cameraTextureId);
    ANativeWindow_release(window);
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeAttachOffscreenSurface(
    JNIEnv*, jobject, jlong handle, jint width, jint height) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    session->surface = session->egl->createOffscreenSurface(width, height);
    session->egl->makeCurrent(session->surface);
    session->backend->setFrameSize(width, height);
    session->cameraTextureId = lumvibe::GLES2RenderBackend::createExternalTexture();
    session->engine->setCameraTexture(session->cameraTextureId);
}

JNIEXPORT jint JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeGetCameraTextureId(JNIEnv*, jobject, jlong handle) {
    return reinterpret_cast<EngineSession*>(handle)->cameraTextureId;
}

JNIEXPORT jboolean JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeSetEffect(JNIEnv* env, jobject, jlong handle, jstring effectId) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    const char* id = env->GetStringUTFChars(effectId, nullptr);
    bool ok = session->engine->setEffect(id);
    env->ReleaseStringUTFChars(effectId, id);
    return ok;
}

// CHANGED (this pass): the first version of this function silently
// dropped eyeBlinkBoth, yawDelta, gaze trail, finger trail, throwVelocity,
// body, touch, and the segmentation mask — none of those ever reached the
// engine, which meant blink_freeze's trigger, gaze_trail, finger_draw,
// double_take, throw_confetti's trigger, tiny_body, freeze_touch, and
// every segmentation-based effect (aura_glow, depth_bloom, split_prism,
// gold_skin, thermal_pulse, face_explosion, space_background) would have
// silently rendered wrong on a real device. Fixed by actually passing
// everything FrameSignals declares.
//
// faceSignal layout (20 floats): [detected, smileScore, browRaiseScore,
//   jawOpen, winkScore, boxMinX, boxMinY, boxMaxX, boxMaxY, mouthX, mouthY,
//   headRoll, headPitch, headYaw, eyeBlinkBoth, yawDelta,
//   eyeLeftX, eyeLeftY, eyeRightX, eyeRightY]
// handSignals layout (6 floats per hand): [detected, palmX, palmY,
//   gesture, angle, throwVelocity]
// fingerTrailPoints/Ages describe hand 0 only (the only hand finger_draw
// needs) — 16 points max, flattened as x0,y0,x1,y1,...
JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeUpdateSignals(
    JNIEnv* env, jobject, jlong handle,
    jfloat timeElapsed, jfloat timeDelta,
    jfloatArray faceSignal,
    jfloatArray gazeTrailPoints, jfloatArray gazeTrailAges, jint gazeTrailCount,
    jfloatArray handSignals, jint handCount,
    jfloatArray fingerTrailPoints, jfloatArray fingerTrailAges, jint fingerTrailCount,
    jfloat audioAmplitude, jfloat motionMagnitude, jfloat stillnessSeconds,
    jboolean bodyDetected, jfloatArray bodyBox,
    jboolean touchActive, jfloat touchX, jfloat touchY,
    jint segmentationMaskTextureId, jint faceMeshTextureId) {

    auto* session = reinterpret_cast<EngineSession*>(handle);
    lumvibe::FrameSignals signals;
    signals.time.elapsedSec = timeElapsed;
    signals.time.deltaSec = timeDelta;

    jfloat* face = env->GetFloatArrayElements(faceSignal, nullptr);
    signals.face.detected = face[0] > 0.5f;
    signals.face.smileScore = face[1];
    signals.face.browRaiseScore = face[2];
    signals.face.jawOpen = face[3];
    signals.face.winkScore = face[4];
    signals.face.boundingBox = {face[5], face[6], face[7], face[8]};
    signals.face.mouthCenter = {face[9], face[10]};
    signals.face.headRoll = face[11];
    signals.face.headPitch = face[12];
    signals.face.headYaw = face[13];
    signals.face.eyeBlinkBoth = face[14] > 0.5f;
    signals.face.yawDelta = face[15];
    signals.face.eyeCenterLeft = {face[16], face[17]};
    signals.face.eyeCenterRight = {face[18], face[19]};
    if (env->GetArrayLength(faceSignal) >= 28) {   // eye laser extras (indices 20..27)
        signals.face.irisLeft = {face[20], face[21]};
        signals.face.irisRight = {face[22], face[23]};
        signals.face.gazeDir = {face[24], face[25]};   // face.gazeDir
        signals.face.eyeOpen = {face[26], face[27]};
    }
    env->ReleaseFloatArrayElements(faceSignal, face, JNI_ABORT);

    signals.face.gazeTrailCount = std::min((int)gazeTrailCount, 8);
    if (signals.face.gazeTrailCount > 0) {
        jfloat* gp = env->GetFloatArrayElements(gazeTrailPoints, nullptr);
        jfloat* ga = env->GetFloatArrayElements(gazeTrailAges, nullptr);
        for (int i = 0; i < signals.face.gazeTrailCount; i++) {
            signals.face.gazeTrail[i] = {gp[i * 2], gp[i * 2 + 1]};
            signals.face.gazeTrailAges[i] = ga[i];
        }
        env->ReleaseFloatArrayElements(gazeTrailPoints, gp, JNI_ABORT);
        env->ReleaseFloatArrayElements(gazeTrailAges, ga, JNI_ABORT);
    }

    if (handCount > 0) {
        jfloat* hands = env->GetFloatArrayElements(handSignals, nullptr);
        for (int i = 0; i < handCount && i < 2; i++) {
            lumvibe::HandSignal h;
            int base = i * 6; // [detected, palmX, palmY, gesture, angle, throwVelocity]
            h.detected = hands[base] > 0.5f;
            h.palmCenter = {hands[base + 1], hands[base + 2]};
            h.gesture = static_cast<lumvibe::HandGesture>((int)hands[base + 3]);
            h.angle = hands[base + 4];
            h.throwVelocity = hands[base + 5];
            signals.hands.push_back(h);
        }
        env->ReleaseFloatArrayElements(handSignals, hands, JNI_ABORT);

        if (!signals.hands.empty()) {
            signals.hands[0].fingerTrailCount = std::min((int)fingerTrailCount, 16);
            if (signals.hands[0].fingerTrailCount > 0) {
                jfloat* fp = env->GetFloatArrayElements(fingerTrailPoints, nullptr);
                jfloat* fa = env->GetFloatArrayElements(fingerTrailAges, nullptr);
                for (int i = 0; i < signals.hands[0].fingerTrailCount; i++) {
                    signals.hands[0].fingerTrail[i] = {fp[i * 2], fp[i * 2 + 1]};
                    signals.hands[0].fingerTrailAges[i] = fa[i];
                }
                env->ReleaseFloatArrayElements(fingerTrailPoints, fp, JNI_ABORT);
                env->ReleaseFloatArrayElements(fingerTrailAges, fa, JNI_ABORT);
            }
        }
    }

    signals.audio.amplitude = audioAmplitude;
    signals.motion.magnitude = motionMagnitude;
    signals.motion.stillnessSeconds = stillnessSeconds;

    signals.body.detected = bodyDetected == JNI_TRUE;
    if (signals.body.detected) {
        jfloat* bb = env->GetFloatArrayElements(bodyBox, nullptr);
        signals.body.boundingBox = {bb[0], bb[1], bb[2], bb[3]};
        env->ReleaseFloatArrayElements(bodyBox, bb, JNI_ABORT);
    }

    signals.touch.active = touchActive == JNI_TRUE;
    signals.touch.position = {touchX, touchY};

    signals.segmentationMaskTexture = (uint32_t)segmentationMaskTextureId;
    signals.faceMeshTexture = (uint32_t)faceMeshTextureId;

    session->engine->updateSignals(signals);
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeRenderFrame(JNIEnv*, jobject, jlong handle) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    session->egl->makeCurrent(session->surface);
    session->engine->renderFrame();
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeSwapBuffers(JNIEnv*, jobject, jlong handle) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    session->egl->swapBuffers(session->surface);
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_LumVibeEngineBridge_nativeRelease(JNIEnv*, jobject, jlong handle) {
    auto* session = reinterpret_cast<EngineSession*>(handle);
    if (session->surface != EGL_NO_SURFACE) session->egl->releaseSurface(session->surface);
    delete session;
}

} // extern "C"
