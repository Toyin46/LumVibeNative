#include "lumvibe/audio/Pitch.h"
#include "lumvibe/audio/Fft.h"
#include "lumvibe/audio/Resampler.h"

namespace lva {

// ═══════════════════════════ YIN pitch tracker ═══════════════════════════
PitchTrack trackPitch(const Buf& x48, const ProgressFn& progress) {
  PitchTrack t;
  if (x48.size() < 4096) return t;
  // Work at 12 kHz: 4x cheaper, plenty for a fundamental below ~900 Hz.
  const Buf x = resample(x48.data(), x48.size(), kRate, 12000);
  constexpr int R = 12000, HOP = kHop / 4;               // 128 samples @ 12k == 512 @ 48k
  constexpr int W = 384, MAXTAU = 160, MINTAU = 13;      // 75 Hz .. ~920 Hz
  const size_t frames = x48.size() / kHop + 1;
  t.f0.assign(frames, 0.0f);
  t.conf.assign(frames, 0.0f);
  std::vector<float> d(MAXTAU + 1), dn(MAXTAU + 1), seg(W + MAXTAU + 2);

  for (size_t f = 0; f < frames; ++f) {
    const long c = (long)f * HOP;
    const long s0 = c - W / 2;
    double energy = 0;
    for (int i = 0; i < W + MAXTAU + 1; ++i) {
      const long p = s0 + i;
      seg[i] = (p >= 0 && p < (long)x.size()) ? x[p] : 0.0f;
    }
    for (int i = 0; i < W; ++i) energy += (double)seg[i] * seg[i];
    if (std::sqrt(energy / W) < 0.004) continue;          // too quiet: unvoiced

    for (int tau = 1; tau <= MAXTAU; ++tau) {
      float a0 = 0, a1 = 0, a2 = 0, a3 = 0;                  // 4 accumulators: lets the CPU pipeline/vectorise
      const float* p0 = seg.data(); const float* p1 = seg.data() + tau;
      for (int j = 0; j < W; j += 4) {
        const float e0 = p0[j] - p1[j], e1 = p0[j + 1] - p1[j + 1], e2 = p0[j + 2] - p1[j + 2], e3 = p0[j + 3] - p1[j + 3];
        a0 += e0 * e0; a1 += e1 * e1; a2 += e2 * e2; a3 += e3 * e3;
      }
      d[tau] = (a0 + a1) + (a2 + a3);
    }
    dn[0] = 1.0f;
    float run = 0;
    for (int tau = 1; tau <= MAXTAU; ++tau) {
      run += d[tau];
      dn[tau] = run > 0 ? d[tau] * tau / run : 1.0f;
    }
    int best = -1;
    for (int tau = MINTAU; tau < MAXTAU; ++tau) {
      if (dn[tau] < 0.15f) {
        while (tau + 1 < MAXTAU && dn[tau + 1] < dn[tau]) ++tau;
        best = tau; break;
      }
    }
    if (best < 0) continue;                                 // no clear period: unvoiced
    float tauF = (float)best;
    if (best > 1 && best < MAXTAU) {                        // parabolic refinement
      const float a = dn[best - 1], b = dn[best], cc = dn[best + 1];
      const float den = a - 2 * b + cc;
      if (std::fabs(den) > 1e-9f) tauF += 0.5f * (a - cc) / den;
    }
    t.f0[f] = (float)R / tauF;
    t.conf[f] = std::min(1.0f, std::max(0.0f, 1.0f - dn[best]));
    if (progress && (f & 2047) == 0) progress((float)f / (float)frames, "pitch");
  }
  return t;
}

// ═════════════════════════ Phase-vocoder pitch shifter ═══════════════════
Buf pitchShift(const Buf& in, const std::vector<float>& ratios, const ProgressFn& progress) {
  constexpr int N = 2048, H = kHop, OS = N / H, HALF = N / 2;
  const size_t n = in.size();
  if (n == 0) return {};
  Fft fft(N);
  std::vector<float> w(N);
  for (int i = 0; i < N; ++i) w[i] = 0.5f * (1.0f - (float)std::cos(2.0 * kPi * i / N));
  float ola = 0;
  for (int m = 0; m < OS; ++m) ola += w[m * H] * w[m * H];
  const float scale = 1.0f / ((float)N * ola);
  const double expct = 2.0 * kPi * H / N;

  const size_t frames = n / H + 2;
  Buf xp(frames * H + N, 0.0f);
  std::copy(in.begin(), in.end(), xp.begin() + N / 2);       // frame f is centred on sample f*H
  Buf out(xp.size(), 0.0f);

  std::vector<float> re(N), im(N), mag(HALF + 1), freq(HALF + 1), sMag(HALF + 1), sFreq(HALF + 1);
  std::vector<double> lastPh(HALF + 1, 0.0), sumPh(HALF + 1, 0.0);

  for (size_t f = 0; f < frames; ++f) {
    const float ratio = ratios.empty() ? 1.0f : ratios[std::min(f, ratios.size() - 1)];
    for (int i = 0; i < N; ++i) { re[i] = xp[f * H + i] * w[i]; im[i] = 0.0f; }
    fft.transform(re.data(), im.data(), false);

    for (int k = 0; k <= HALF; ++k) {
      mag[k] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
      const double ph = (double)std::atan2(im[k], re[k]);
      if (f == 0) { lastPh[k] = ph; sumPh[k] = ph; }
      double dlt = ph - lastPh[k] - k * expct;
      lastPh[k] = ph;
      dlt -= 2.0 * kPi * std::floor(dlt / (2.0 * kPi) + 0.5);  // wrap to [-pi, pi]
      freq[k] = (float)(k + dlt * OS / (2.0 * kPi));           // true frequency in bins
    }

    std::fill(sMag.begin(), sMag.end(), 0.0f);
    std::fill(sFreq.begin(), sFreq.end(), 0.0f);
    for (int k = 0; k <= HALF; ++k) {
      const int idx = (int)std::floor(k * ratio + 0.5f);
      if (idx >= 0 && idx <= HALF) { sMag[idx] += mag[k]; sFreq[idx] = freq[k] * ratio; }
    }
    for (int k = 0; k <= HALF; ++k) {
      if (sMag[k] > 0.0f) sumPh[k] += (double)sFreq[k] * expct;
      else sumPh[k] = std::atan2((double)im[k], (double)re[k]);   // keep idle bins sane
      sumPh[k] -= 2.0 * kPi * std::floor(sumPh[k] / (2.0 * kPi) + 0.5);   // keep in [-pi, pi]: float trig stays accurate
      const float sp = (float)sumPh[k];
      re[k] = sMag[k] * std::cos(sp);
      im[k] = sMag[k] * std::sin(sp);
    }
    for (int k = 1; k < HALF; ++k) { re[N - k] = re[k]; im[N - k] = -im[k]; }
    im[0] = 0; im[HALF] = 0;
    fft.transform(re.data(), im.data(), true);
    for (int i = 0; i < N; ++i) out[f * H + i] += re[i] * w[i] * scale;
    if (progress && (f & 1023) == 0) progress((float)f / (float)frames, "pitch-shift");
  }
  return Buf(out.begin() + N / 2, out.begin() + N / 2 + n);
}

// ═══════════════════════════════ Autotune ════════════════════════════════
namespace {
const double kMajorProfile[12] = {6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88};
const double kMinorProfile[12] = {6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17};
const int kMajor[7] = {0, 2, 4, 5, 7, 9, 11};
const int kMinor[7] = {0, 2, 3, 5, 7, 8, 10};
const int kMajPent[5] = {0, 2, 4, 7, 9};
const int kMinPent[5] = {0, 3, 5, 7, 10};

double corr12(const double* a, const double* b) {
  double ma = 0, mb = 0;
  for (int i = 0; i < 12; ++i) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  double sab = 0, saa = 0, sbb = 0;
  for (int i = 0; i < 12; ++i) {
    sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb);
  }
  return (saa > 0 && sbb > 0) ? sab / std::sqrt(saa * sbb) : 0.0;
}
inline double hzToMidi(double hz) { return 69.0 + 12.0 * std::log2(hz / 440.0); }
} // namespace

std::vector<float> computeCorrections(const PitchTrack& t, const AutoTuneSettings& s,
                                      int* detectedRoot, int* detectedType) {
  const size_t n = t.f0.size();
  std::vector<float> corr(n, 0.0f);
  if (n == 0) return corr;

  // 1. voiced frames -> MIDI, with a 5-frame median to drop octave glitches
  std::vector<float> midi(n, 0.0f);
  std::vector<char> voiced(n, 0);
  for (size_t i = 0; i < n; ++i)
    if (t.f0[i] > 70.0f && t.f0[i] < 1000.0f && t.conf[i] > 0.65f) { midi[i] = (float)hzToMidi(t.f0[i]); voiced[i] = 1; }
  std::vector<float> med(n, 0.0f);
  std::vector<char> ok(n, 0);
  for (size_t i = 0; i < n; ++i) {
    if (!voiced[i]) continue;
    float v[5]; int c = 0;
    for (long j = (long)i - 2; j <= (long)i + 2; ++j)
      if (j >= 0 && j < (long)n && voiced[j]) v[c++] = midi[j];
    if (c < 3) continue;
    for (int a = 1; a < c; ++a) { const float key = v[a]; int b = a - 1; while (b >= 0 && v[b] > key) { v[b + 1] = v[b]; --b; } v[b + 1] = key; }
    const float m = v[c / 2];
    if (std::fabs(midi[i] - m) > 3.0f) continue;               // outlier frame
    med[i] = 0.5f * midi[i] + 0.5f * m; ok[i] = 1;
  }

  // 2. which notes are allowed?
  bool allowed[12];
  int root = s.scaleRoot, type = s.scaleType;
  double hist[12] = {0};
  double voicedSec = 0;
  for (size_t i = 0; i < n; ++i) if (ok[i]) {
    int pc = (int)std::lround(med[i]) % 12; if (pc < 0) pc += 12;
    hist[pc] += t.conf[i]; voicedSec += (double)kHop / kRate;
  }
  if (type == 0 || root < 0) {                                  // auto-detect key
    double best = -2; int bRoot = 0, bType = 2;
    if (voicedSec > 1.5) {
      for (int r = 0; r < 12; ++r) {
        double rot[12];
        for (int i = 0; i < 12; ++i) rot[i] = hist[(i + r) % 12];
        const double cM = corr12(rot, kMajorProfile), cm = corr12(rot, kMinorProfile);
        if (cM > best) { best = cM; bRoot = r; bType = 2; }
        if (cm > best) { best = cm; bRoot = r; bType = 3; }
      }
      if (root < 0) root = bRoot;
      if (type == 0) type = bType;
    } else { type = 1; root = 0; }                              // too little singing: chromatic
  }
  if (detectedRoot) *detectedRoot = root;
  if (detectedType) *detectedType = type;
  for (int i = 0; i < 12; ++i) allowed[i] = (type == 1);
  if (type != 1) {
    const int* iv = type == 2 ? kMajor : type == 3 ? kMinor : type == 4 ? kMajPent : kMinPent;
    const int cnt = (type == 2 || type == 3) ? 7 : 5;
    for (int i = 0; i < cnt; ++i) allowed[(root + iv[i]) % 12] = true;
  }

  // 3. per-frame target, hysteresis, smoothing
  const double hopMs = 1000.0 * kHop / kRate;
  const float alpha = s.speedMs <= 0.5f ? 1.0f : 1.0f - (float)std::exp(-hopMs / s.speedMs);
  const float decay = (float)std::exp(-hopMs / 60.0);
  int prevTarget = -1000; float cur = 0.0f;
  for (size_t i = 0; i < n; ++i) {
    if (!ok[i]) { cur *= decay; prevTarget = -1000; corr[i] = cur; continue; }
    const float m = med[i];
    int target;
    if (prevTarget > -1000 && std::fabs(m - prevTarget) < 0.65f) target = prevTarget;
    else {
      target = -1000; float bd = 99;
      const int c0 = (int)std::lround(m);
      for (int c = c0 - 2; c <= c0 + 2; ++c) {
        int pc = c % 12; if (pc < 0) pc += 12;
        if (!allowed[pc]) continue;
        const float dd = std::fabs(m - (float)c);
        if (dd < bd) { bd = dd; target = c; }
      }
      if (target == -1000) target = c0;
    }
    prevTarget = target;
    float want = (float)target - m;
    want = std::max(-3.0f, std::min(3.0f, want)) * std::min(1.0f, std::max(0.0f, s.strength));
    cur += alpha * (want - cur);
    corr[i] = cur;
  }
  return corr;
}

} // namespace lva
