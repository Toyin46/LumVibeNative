#pragma once
#include <array>
#include <cstdint>
#include <vector>

namespace lumvibe {

struct Vec2 { float x = 0, y = 0; };
struct Vec4 { float x = 0, y = 0, z = 0, w = 0; };

enum class HandGesture { None, Fist, OpenPalm, Scissors, Pointing, Unknown };

struct FaceSignal {
    bool detected = false;
    float smileScore = 0.f;
    float browRaiseScore = 0.f;
    float jawOpen = 0.f;
    float winkScore = 0.f; // signed: + left eye, - right eye, 0 neither
    Vec4 boundingBox{0.35f, 0.25f, 0.65f, 0.75f};
    Vec2 mouthCenter{0.5f, 0.6f};
    Vec2 eyeCenterLeft{0.4f, 0.4f};
    Vec2 eyeCenterRight{0.6f, 0.4f};
    Vec2 irisCenter{0.5f, 0.4f};
    Vec2 irisLeft{0.4f, 0.4f};   // eye laser: image-left iris centre
    Vec2 irisRight{0.6f, 0.4f};  // eye laser: image-right iris centre
    Vec2 gazeDir{0.f, 0.f};      // eye laser: screen-space look direction (head + eyes)
    Vec2 eyeOpen{0.f, 0.f};      // eye laser: 0 closed .. 1 open, per eye (image-left, image-right)
    float headRoll = 0.f, headPitch = 0.f, headYaw = 0.f;
    float yawDelta = 0.f;
    std::array<Vec2, 8> gazeTrail{};
    std::array<float, 8> gazeTrailAges{}; // 0 = newest/brightest, 1 = oldest/gone, paired index-for-index with gazeTrail
    int gazeTrailCount = 0;
    bool eyeBlinkBoth = false;
};

struct HandSignal {
    bool detected = false;
    Vec2 palmCenter{0.5f, 0.5f};
    HandGesture gesture = HandGesture::None;
    float angle = 0.f;
    float throwVelocity = 0.f; // magnitude of palmCenter delta over ~150ms
    std::array<Vec2, 16> fingerTrail{};
    std::array<float, 16> fingerTrailAges{}; // 0 = newest/brightest, 1 = oldest/gone
    int fingerTrailCount = 0;
};

struct AudioSignal {
    float amplitude = 0.f; // smoothed RMS, 0..1
    bool beatDetected = false;  // true only on the frame a beat/onset fires
    float beatEnergy = 0.f;     // 0..1, current short-term energy vs rolling average
    bool dropDetected = false;  // true only on the frame a sustained energy jump fires
};

struct BodySignal {
    bool detected = false;
    Vec4 boundingBox{0.3f, 0.2f, 0.7f, 1.0f};
};

struct TouchSignal {
    bool active = false;
    Vec2 position{0.5f, 0.5f};
};

struct TimeSignal {
    float elapsedSec = 0.f;
    float deltaSec = 0.f;
};

struct MotionSignal {
    float magnitude = 0.f;       // frame-to-frame luma delta, 0..1
    float stillnessSeconds = 0.f;
};

// One frame's worth of everything the effect engine can bind to. Populated
// ONCE per frame by the tracker wrappers (ports of FaceTracker/HandTracker/
// SegmentationTracker/AudioAmplitudeReader) BEFORE any effect runs — every
// effect reads the same struct instead of driving its own tracker calls.
// This single write-point is what removes the three-copy duplication that
// existed across VideoTranscoder/LiveEffectPreviewView/EffectRequirements
// in the old Kotlin implementation.
struct FrameSignals {
    TimeSignal time;
    FaceSignal face;
    std::vector<HandSignal> hands; // 0, 1, or 2 entries
    AudioSignal audio;
    MotionSignal motion;
    BodySignal body;    // from Pose Landmarker — see PoseTracker (README)
    TouchSignal touch;  // from the platform's touch-event callback
    uint32_t segmentationMaskTexture = 0; // 0 = not available this frame
    uint32_t faceMeshTexture = 0; // from FaceMeshRenderer.buildMeshBitmap (Android) — face_morph only, 0 = not available this frame
};

} // namespace lumvibe
