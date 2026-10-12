#pragma once
#include "Common.h"

namespace lva {

// ── Pitch tracking (YIN) ──────────────────────────────────────────────────
// One value per kHop (512) samples @ 48 kHz; value i is centred on sample i*kHop.
constexpr int kHop = 512;

struct PitchTrack {
  std::vector<float> f0;     // Hz, 0 when unvoiced
  std::vector<float> conf;   // 0..1
};
PitchTrack trackPitch(const Buf& x48k, const ProgressFn& progress);

// ── Pitch shifting (phase vocoder, per-frame ratio) ───────────────────────
// ratios[f] is the pitch ratio used for the frame centred on sample f*kHop.
// Output has the same length as the input.
Buf pitchShift(const Buf& in, const std::vector<float>& ratios, const ProgressFn& progress);

// ── Autotune ──────────────────────────────────────────────────────────────
struct AutoTuneSettings {
  int   scaleRoot = -1;      // -1 = detect key from the singing
  int   scaleType = 0;       // 0 auto, 1 chromatic, 2 major, 3 minor, 4 maj pent, 5 min pent
  float strength = 1.0f;     // 0..1
  float speedMs = 20.0f;     // retune time constant, 0 = instant
};
// Returns the per-frame correction in SEMITONES (same indexing as the track).
std::vector<float> computeCorrections(const PitchTrack& t, const AutoTuneSettings& s,
                                      int* detectedRoot = nullptr, int* detectedType = nullptr);

} // namespace lva
