#pragma once
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

namespace lva {

constexpr double kPi = 3.14159265358979323846;
constexpr int kRate = 48000;          // internal sample rate (RNNoise needs exactly this)

using Buf = std::vector<float>;
using ProgressFn = std::function<void(float, const char*)>;

inline float dbToLin(float db) { return std::pow(10.0f, db / 20.0f); }
inline float linToDb(float x)  { return 20.0f * std::log10(std::max(x, 1e-9f)); }

struct StereoBuf { Buf l, r; };

} // namespace lva
