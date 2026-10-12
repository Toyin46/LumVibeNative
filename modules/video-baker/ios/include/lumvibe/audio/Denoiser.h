#pragma once
#include "Common.h"

namespace lva {

// Built-in spectral noise reduction (always available, no third-party code).
// Learns the noise "fingerprint" from the quietest parts of the recording
// (breaths/pauses), then removes it frame by frame with a Wiener-style gain
// and keeps adapting if the noise drifts (fan speed, breeze).
// x: mono, 48 kHz, modified in place. strength 0..1.
void spectralDenoise(Buf& x, float strength, const ProgressFn& progress);

// RNNoise (Xiph, BSD-3). Only compiled when LVA_WITH_RNNOISE is defined.
// Returns false if not compiled in.
bool rnnoiseAvailable();
void rnnoiseDenoise(Buf& x, float strength, const ProgressFn& progress);

} // namespace lva
