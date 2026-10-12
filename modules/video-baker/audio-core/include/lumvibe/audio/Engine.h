#pragma once
#include "Common.h"
#include "lva.h"

namespace lva {

struct Params {
  int   denoiseMode = 1;
  float denoiseStrength = 0.8f;
  bool  noiseGate = false;
  bool  autotune = false;
  int   scaleRoot = -1;
  int   scaleType = 0;
  float tuneStrength = 0.85f;
  float tuneSpeedMs = 35.0f;
  float pitchSemitones = 0.0f;
  float highpassHz = 80.0f;
  float lowpassHz = 20000.0f;
  float presenceDb = 0.0f;
  bool  compress = true;
  float reverbMix = 0.0f;
  float echoMix = 0.0f;
  float echoMs = 0.0f;
  bool  chorus = false;
  bool  reverse = false;
  float trimStartSec = 0.0f;
  float trimEndSec = 0.0f;
  float voiceGain = 1.0f;
  float beatGain = 0.85f;
  float voiceOffsetMs = 0.0f;
  bool  normalize = true;
  float tailSec = 1.5f;
  bool  autoBalance = true;
  bool  cancelBleed = false;      // remove the beat that leaked into the mic (needs the beat)

  static Params fromArray(const float* p, int n);
  static void defaultsToArray(float* out, int n);
};

struct PcmIn { const float* data; int frames; int rate; int channels; };

struct Result {
  std::vector<float> pcm;     // interleaved stereo
  int frames = 0;
  int detectedKeyRoot = -1;
  int detectedKeyType = 0;
};

// Throws std::runtime_error with a readable message on bad input.
Result process(const Params& prm, const PcmIn& voice, const PcmIn* beat, const ProgressFn& progress);

} // namespace lva
