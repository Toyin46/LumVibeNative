#pragma once
#include "Common.h"

namespace lva {

// Small in-place radix-2 complex FFT. Size must be a power of two.
// Forward uses e^{-j...}. Inverse is UNNORMALISED (caller divides by N).
class Fft {
public:
  explicit Fft(int n) : n_(n), rev_(n), cos_(n / 2), sin_(n / 2) {
    int lg = 0;
    while ((1 << lg) < n) ++lg;
    for (int i = 0; i < n; ++i) {
      int r = 0;
      for (int b = 0; b < lg; ++b) if (i & (1 << b)) r |= 1 << (lg - 1 - b);
      rev_[i] = r;
    }
    for (int i = 0; i < n / 2; ++i) {
      double a = -2.0 * kPi * i / n;
      cos_[i] = (float)std::cos(a);
      sin_[i] = (float)std::sin(a);
    }
  }
  int size() const { return n_; }

  void transform(float* re, float* im, bool inverse) const {
    for (int i = 0; i < n_; ++i) {
      int j = rev_[i];
      if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
    }
    for (int len = 2; len <= n_; len <<= 1) {
      const int half = len >> 1, step = n_ / len;
      for (int i = 0; i < n_; i += len) {
        for (int j = 0; j < half; ++j) {
          const float wr = cos_[j * step];
          const float wi = inverse ? -sin_[j * step] : sin_[j * step];
          const int a = i + j, b = a + half;
          const float tr = re[b] * wr - im[b] * wi;
          const float ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr;        im[a] += ti;
        }
      }
    }
  }

private:
  int n_;
  std::vector<int> rev_;
  std::vector<float> cos_, sin_;
};

} // namespace lva
