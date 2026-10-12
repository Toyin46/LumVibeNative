#include "lumvibe/audio/Denoiser.h"
#include "lumvibe/audio/Fft.h"

namespace lva {

void spectralDenoise(Buf& x, float strength, const ProgressFn& progress) {
  const size_t len = x.size();
  constexpr int N = 1024, H = 256, BINS = N / 2 + 1;
  if (len < (size_t)N * 2) return;
  strength = std::min(1.0f, std::max(0.0f, strength));
  if (strength <= 0.001f) return;

  Fft fft(N);
  std::vector<float> win(N), hann(N);
  for (int i = 0; i < N; ++i) {
    hann[i] = 0.5f * (1.0f - (float)std::cos(2.0 * kPi * i / N));
    win[i] = std::sqrt(hann[i]);                                // analysis = synthesis = sqrt(Hann)
  }
  float ola = 0;                                                  // overlap-add gain of Hann at hop H
  for (int m = 0; m < N / H; ++m) ola += hann[m * H];
  const float outScale = 1.0f / ((float)N * ola);

  // padded copy: (N-H) zeros in front, N zeros behind
  const size_t padFront = N - H;
  Buf xp(len + padFront + N, 0.0f);
  std::copy(x.begin(), x.end(), xp.begin() + padFront);
  const size_t frames = (len + padFront + N - N) / H + 1;

  std::vector<float> re(N), im(N);

  // ── 1. Noise fingerprint from the quietest blocks ────────────────────────
  const size_t blocks = len / H;
  std::vector<float> blockE(blocks);
  for (size_t b = 0; b < blocks; ++b) {
    double e = 0;
    for (int j = 0; j < H; ++j) { const float v = x[b * H + j]; e += (double)v * v; }
    blockE[b] = (float)e;
  }
  std::vector<float> sorted = blockE;
  std::sort(sorted.begin(), sorted.end());
  const float thrE = sorted[std::min(sorted.size() - 1, (size_t)(sorted.size() * 0.08))];
  std::vector<size_t> quiet;
  for (size_t b = 0; b < blocks; ++b) if (blockE[b] <= thrE) quiet.push_back(b);
  if (quiet.size() > 400) {                                       // keep evenly spaced 400
    std::vector<size_t> q2;
    for (size_t i = 0; i < 400; ++i) q2.push_back(quiet[i * quiet.size() / 400]);
    quiet.swap(q2);
  }
  std::vector<float> noise(BINS, 0.0f);
  size_t used = 0;
  for (size_t b : quiet) {
    const long start = (long)(b * H) + H / 2 - N / 2;           // frame centred on the block
    for (int i = 0; i < N; ++i) {
      const long p = start + i;
      re[i] = (p >= 0 && p < (long)len) ? x[p] * win[i] : 0.0f;
      im[i] = 0.0f;
    }
    fft.transform(re.data(), im.data(), false);
    for (int k = 0; k < BINS; ++k) noise[k] += re[k] * re[k] + im[k] * im[k];
    ++used;
  }
  if (used == 0) return;
  for (auto& v : noise) v = std::max(v / used, 1e-10f);

  // ── 2. Frame-by-frame Wiener-style suppression ──────────────────────────
  const float maxReductionDb = 6.0f + 22.0f * strength;           // 6..28 dB
  const float gMin = dbToLin(-maxReductionDb);
  const float nu = 1.0f + 0.6f * strength;                        // over-subtraction
  const float alpha = 0.97f;                                      // decision-directed smoothing (over time)
  std::vector<float> gPrev(BINS, 1.0f), gammaPrev(BINS, 1.0f), gain(BINS), gSm(BINS);
  Buf out(xp.size(), 0.0f);
  const int loBin = (int)(100.0f * N / kRate), hiBin = (int)(6000.0f * N / kRate);

  for (size_t f = 0; f < frames; ++f) {
    const size_t s0 = f * H;
    if (s0 + N > xp.size()) break;
    for (int i = 0; i < N; ++i) { re[i] = xp[s0 + i] * win[i]; im[i] = 0.0f; }
    fft.transform(re.data(), im.data(), false);

    double gammaMean = 0;
    for (int k = 0; k < BINS; ++k) {
      const float p = re[k] * re[k] + im[k] * im[k];
      const float gamma = p / noise[k];
      const float xi = alpha * gPrev[k] * gPrev[k] * gammaPrev[k] + (1 - alpha) * std::max(gamma - 1.0f, 0.0f);
      gain[k] = std::max(gMin, xi / (xi + nu));
      gammaPrev[k] = gamma;
      if (k >= loBin && k <= hiBin) gammaMean += gamma;
    }
    gammaMean /= std::max(1, hiBin - loBin + 1);

    // keep tracking slow drifts of the noise while nothing but noise is there
    if (gammaMean < 1.7) {
      for (int k = 0; k < BINS; ++k) {
        const float p = re[k] * re[k] + im[k] * im[k];
        noise[k] = std::max(1e-10f, 0.96f * noise[k] + 0.04f * p);
      }
    }

    // NOTE: the gain is deliberately NOT smoothed across frequency. A singing voice is a
    // comb of narrow harmonic peaks; smoothing the gain smears the peaks and made the
    // voice 3 dB quieter in testing. The decision-directed estimate (smoothing over TIME)
    // is what keeps "musical noise" under control instead.
    for (int k = 0; k < BINS; ++k) { gSm[k] = gain[k]; gPrev[k] = gain[k]; }

    for (int k = 0; k < BINS; ++k) { re[k] *= gSm[k]; im[k] *= gSm[k]; }
    for (int k = 1; k < N / 2; ++k) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    fft.transform(re.data(), im.data(), true);
    for (int i = 0; i < N; ++i) out[s0 + i] += re[i] * win[i] * outScale;

    if (progress && (f & 1023) == 0) progress((float)f / (float)frames, "denoise");
  }
  for (size_t i = 0; i < len; ++i) x[i] = out[padFront + i];
}

} // namespace lva
