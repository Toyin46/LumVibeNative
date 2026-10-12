#pragma once
#include "Common.h"

namespace lva {
// High-quality windowed-sinc (Kaiser) resampler. Anti-aliases when downsampling.
Buf resample(const float* in, size_t n, int inRate, int outRate);
} // namespace lva
