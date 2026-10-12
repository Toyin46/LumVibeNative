#include "lumvibe/audio/Resampler.h"

namespace lva {
namespace {

constexpr int kZeros = 16;     // sinc zero-crossings each side
constexpr int kRes   = 256;    // table entries per zero-crossing
constexpr double kBeta = 9.0;  // Kaiser beta (~ -90 dB stopband)

double bessel0(double x) {
  double sum = 1.0, term = 1.0;
  for (int k = 1; k < 60; ++k) {
    term *= (x / (2.0 * k)) * (x / (2.0 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

struct Table {
  std::vector<float> k;
  Table() : k(kZeros * kRes + 2, 0.0f) {
    const double i0b = bessel0(kBeta);
    for (size_t i = 0; i < k.size(); ++i) {
      const double x = (double)i / kRes;
      if (x >= kZeros) { k[i] = 0.0f; continue; }
      const double s = (x == 0.0) ? 1.0 : std::sin(kPi * x) / (kPi * x);
      const double r = x / kZeros;
      const double w = bessel0(kBeta * std::sqrt(std::max(0.0, 1.0 - r * r))) / i0b;
      k[i] = (float)(s * w);
    }
  }
};

const Table& table() { static const Table t; return t; }

} // namespace

namespace {
long gcdl(long a, long b) { while (b) { long t = a % b; a = b; b = t; } return a; }

double kernelAt(double x) {                       // sinc * Kaiser, exact (setup time only)
  const double ax = std::fabs(x);
  if (ax >= kZeros) return 0.0;
  const double s = ax == 0.0 ? 1.0 : std::sin(kPi * ax) / (kPi * ax);
  const double r = ax / kZeros;
  return s * bessel0(kBeta * std::sqrt(std::max(0.0, 1.0 - r * r))) / bessel0(kBeta);
}

// Exact rational-ratio resampler: one precomputed filter per output phase, so the inner
// loop is a plain dot product (fast, vectorisable). 44.1k->48k needs 160 phases.
Buf resamplePolyphase(const float* in, size_t n, int inRate, int outRate, long L, long M) {
  const double fc = std::min(1.0, (double)outRate / (double)inRate);
  const int H = (int)std::ceil(kZeros / fc);        // taps reach H samples each side
  const int K = 2 * H;
  std::vector<float> coef((size_t)L * K);
  for (long p = 0; p < L; ++p) {
    const double frac = (double)p / (double)L;
    double sum = 0;
    for (int m = 0; m < K; ++m) {
      const double d = frac - (double)(m - H + 1);  // distance from the tap to the output point
      const double c = fc * kernelAt(d * fc);
      coef[(size_t)p * K + m] = (float)c; sum += c;
    }
    for (int m = 0; m < K; ++m) coef[(size_t)p * K + m] = (float)(coef[(size_t)p * K + m] / sum);   // exact unity DC gain
  }
  const size_t outN = (size_t)((double)n * outRate / inRate);
  Buf padded(n + 2 * (size_t)K, 0.0f);
  std::copy(in, in + n, padded.begin() + K);
  Buf out(outN);
  for (size_t i = 0; i < outN; ++i) {
    const long long pos = (long long)i * M;
    const size_t base = (size_t)(pos / L);
    const float* c = &coef[(size_t)(pos % L) * K];
    const float* x = &padded[base + K - H + 1];     // tap m reads input[base - H + 1 + m]
    float a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    int m = 0;
    for (; m + 4 <= K; m += 4) { a0 += c[m] * x[m]; a1 += c[m + 1] * x[m + 1]; a2 += c[m + 2] * x[m + 2]; a3 += c[m + 3] * x[m + 3]; }
    for (; m < K; ++m) a0 += c[m] * x[m];
    out[i] = (a0 + a1) + (a2 + a3);
  }
  return out;
}
} // namespace

Buf resample(const float* in, size_t n, int inRate, int outRate) {
  if (n == 0) return {};
  if (inRate == outRate) return Buf(in, in + n);
  {
    const long g = gcdl(inRate, outRate);
    const long L = outRate / g, M = inRate / g;
    if (L <= 1024) return resamplePolyphase(in, n, inRate, outRate, L, M);
  }

  const Table& T = table();
  const double ratio = (double)inRate / (double)outRate;      // input samples per output sample
  const double fc = std::min(1.0, (double)outRate / (double)inRate);
  const double half = kZeros / fc;                              // half-width in input samples
  const size_t outN = (size_t)((double)n * outRate / inRate);
  Buf out(outN);

  for (size_t i = 0; i < outN; ++i) {
    const double t = (double)i * ratio;
    long j0 = (long)std::ceil(t - half);
    long j1 = (long)std::floor(t + half);
    if (j0 < 0) j0 = 0;
    if (j1 > (long)n - 1) j1 = (long)n - 1;
    double acc = 0.0;
    for (long j = j0; j <= j1; ++j) {
      const double x = std::fabs(t - (double)j) * fc;
      const double pos = x * kRes;
      const int i0 = (int)pos;
      const float fr = (float)(pos - i0);
      const float w = T.k[i0] * (1.0f - fr) + T.k[i0 + 1] * fr;
      acc += (double)in[j] * w;
    }
    out[i] = (float)(acc * fc);
  }
  return out;
}

} // namespace lva
