#pragma once
#include "Common.h"

namespace lva {

// ── Tone shaping (all in place, mono, 48 kHz) ──────────────────────────────
void highpass(Buf& x, float hz, int rate);                 // 4th order, no-op if hz <= 20
void lowpass(Buf& x, float hz, int rate);                  // 4th order, no-op if hz >= 20000
void peaking(Buf& x, float hz, float q, float gainDb, int rate);

// ── Dynamics ───────────────────────────────────────────────────────────────
// Downward expander: lets singing through, quietly closes between phrases.
void noiseGate(Buf& x, int rate);
// Feed-forward soft-knee compressor with automatic make-up gain.
void compress(Buf& x, int rate);

// ── Space & colour: mono voice in, stereo out ──────────────────────────────
StereoBuf makeStereo(const Buf& mono, bool chorus, int rate);
void echo(StereoBuf& s, float delayMs, float mix, int rate);
void reverb(StereoBuf& s, float mix, int rate);

// ── Helpers ────────────────────────────────────────────────────────────────
// Average loudness (dBFS RMS) over only the "active" 20 ms blocks.
float activeRmsDb(const float* x, size_t n, int rate, float gateDb);

} // namespace lva
