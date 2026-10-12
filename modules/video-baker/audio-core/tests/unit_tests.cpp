// Unit tests for the DSP building blocks. Build + run: tests/run_tests.sh
#include "lumvibe/audio/Common.h"
#include "lumvibe/audio/Effects.h"
#include "lumvibe/audio/Fft.h"
#include "lumvibe/audio/Pitch.h"
#include "lumvibe/audio/Resampler.h"
#include <cstdio>
#include <cstdlib>

using namespace lva;
static int g_fail = 0;
#define CHECK(cond, ...) do { if (!(cond)) { ++g_fail; std::printf("  FAIL: "); std::printf(__VA_ARGS__); std::printf("\n"); } \
                              else { std::printf("  ok:   "); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

static Buf sine(double hz, double sec, int rate, double amp = 0.5) {
  Buf x((size_t)(sec * rate));
  for (size_t i = 0; i < x.size(); ++i) x[i] = (float)(amp * std::sin(2 * kPi * hz * i / rate));
  return x;
}
static Buf voiceLike(double hz, double sec, int rate) {         // 8 harmonics, falling spectrum
  Buf x((size_t)(sec * rate), 0.0f);
  for (int h = 1; h <= 8; ++h)
    for (size_t i = 0; i < x.size(); ++i) x[i] += (float)(0.3 / h * std::sin(2 * kPi * hz * h * i / rate));
  return x;
}
static double peakHz(const Buf& x, size_t from, size_t len, int rate) {
  const int N = 65536; Fft fft(N);
  std::vector<float> re(N, 0.0f), im(N, 0.0f);
  for (size_t i = 0; i < len && from + i < x.size() && (int)i < N; ++i)
    re[i] = x[from + i] * (0.5f - 0.5f * (float)std::cos(2 * kPi * i / len));
  fft.transform(re.data(), im.data(), false);
  int best = 1; float bm = 0;
  for (int k = 1; k < N / 2; ++k) { const float m = re[k] * re[k] + im[k] * im[k]; if (m > bm) { bm = m; best = k; } }
  const double a = std::sqrt(re[best - 1] * re[best - 1] + im[best - 1] * im[best - 1]);
  const double b = std::sqrt(bm);
  const double c = std::sqrt(re[best + 1] * re[best + 1] + im[best + 1] * im[best + 1]);
  const double d = (a - c) / (2 * (a - 2 * b + c));
  return (best + d) * (double)rate / N;
}
static double rms(const Buf& x, size_t a, size_t b) { double e = 0; for (size_t i = a; i < b; ++i) e += (double)x[i] * x[i]; return std::sqrt(e / (b - a)); }

int main() {
  std::printf("FFT\n");
  { Fft f(1024); std::vector<float> re(1024), im(1024, 0), r0;
    for (int i = 0; i < 1024; ++i) re[i] = (float)std::sin(0.01 * i * i);
    r0 = re; f.transform(re.data(), im.data(), false); f.transform(re.data(), im.data(), true);
    double e = 0; for (int i = 0; i < 1024; ++i) e = std::max(e, (double)std::fabs(re[i] / 1024 - r0[i]));
    CHECK(e < 1e-4, "round trip max error %.2e", e); }

  std::printf("Resampler\n");
  { Buf a = sine(1000, 1.0, 44100); Buf b = resample(a.data(), a.size(), 44100, 48000);
    CHECK(b.size() == 48000, "length 44.1k->48k = %zu", b.size());
    double e = 0; size_t cnt = 0;
    for (size_t i = 2000; i < b.size() - 2000; ++i) { const double ref = 0.5 * std::sin(2 * kPi * 1000.0 * i / 48000); e += (b[i] - ref) * (b[i] - ref); ++cnt; }
    const double errDb = 10 * std::log10(e / cnt / (0.25 / 2));
    CHECK(errDb < -60, "44.1k->48k error vs ideal sine %.1f dB (want < -60)", errDb);
    Buf hi = sine(10000, 1.0, 48000); Buf lo = resample(hi.data(), hi.size(), 48000, 16000);
    CHECK(rms(lo, 2000, lo.size() - 2000) < 0.001, "10 kHz tone is removed when going to 16 kHz (rms %.5f)", rms(lo, 2000, lo.size() - 2000)); }

  std::printf("Pitch shifter\n");
  { Buf x = voiceLike(220, 3.0, 48000);
    std::vector<float> ratios(x.size() / kHop + 2, 1.0f);
    Buf y = pitchShift(x, ratios, nullptr);
    double e = 0, s = 0; for (size_t i = 8192; i < x.size() - 8192; ++i) { e += (y[i] - x[i]) * (y[i] - x[i]); s += x[i] * x[i]; }
    CHECK(10 * std::log10(e / s) < -35, "ratio 1.0 reproduces the input (error %.1f dB, want < -35)", 10 * std::log10(e / s));
    const float up = std::pow(2.0f, 1.0f / 12.0f);
    std::fill(ratios.begin(), ratios.end(), up);
    Buf z = pitchShift(sine(440, 3.0, 48000), ratios, nullptr);
    const double f = peakHz(z, 48000, 65536, 48000);
    CHECK(std::fabs(f - 440.0 * up) < 1.5, "+1 semitone: 440 Hz -> %.2f Hz (want %.2f)", f, 440.0 * up);
    std::fill(ratios.begin(), ratios.end(), 0.5f);
    Buf w = pitchShift(sine(440, 3.0, 48000), ratios, nullptr);
    const double f2 = peakHz(w, 48000, 65536, 48000);
    CHECK(std::fabs(f2 - 220.0) < 1.5, "-12 semitones: 440 Hz -> %.2f Hz (want 220)", f2);
    CHECK(rms(z, 24000, 120000) > 0.30 && rms(z, 24000, 120000) < 0.40, "level kept (rms %.3f, input 0.354)", rms(z, 24000, 120000)); }

  std::printf("Pitch tracker (YIN)\n");
  for (double hz : {110.0, 196.0, 261.63, 440.0, 622.25, 880.0}) {
    Buf x = voiceLike(hz, 1.5, 48000); PitchTrack t = trackPitch(x, nullptr);
    std::vector<float> v; for (size_t i = 10; i + 10 < t.f0.size(); ++i) if (t.f0[i] > 0) v.push_back(t.f0[i]);
    std::sort(v.begin(), v.end());
    const double med = v.empty() ? 0 : v[v.size() / 2];
    const double cents = med > 0 ? 1200 * std::log2(med / hz) : 9999;
    CHECK(std::fabs(cents) < 6 && v.size() > t.f0.size() / 2, "%.1f Hz detected as %.2f Hz (%.1f cents, %zu/%zu frames voiced)", hz, med, cents, v.size(), t.f0.size());
  }
  { Buf x(48000, 0.0f); PitchTrack t = trackPitch(x, nullptr); size_t voiced = 0; for (float f : t.f0) if (f > 0) ++voiced;
    CHECK(voiced == 0, "silence is never reported as pitched (%zu frames)", voiced); }

  std::printf("Effects\n");
  { StereoBuf s; s.l.assign(48000 * 6, 0.0f); s.r = s.l; s.l[0] = s.r[0] = 1.0f;
    reverb(s, 1.0f, kRate);
    double early = 0, late = 0; for (int i = 0; i < 48000; ++i) early += s.l[i] * s.l[i]; for (int i = 48000 * 5; i < 48000 * 6; ++i) late += s.l[i] * s.l[i];
    bool finite = true; for (float v : s.l) if (!std::isfinite(v)) finite = false;
    CHECK(finite && early > 0 && 10 * std::log10((late + 1e-30) / early) < -50, "reverb is stable and decays (tail at 5s is %.1f dB vs first second)", 10 * std::log10((late + 1e-30) / early));
    Buf n(48000 * 2); unsigned seed = 1; for (auto& v : n) { seed = seed * 1664525u + 1013904223u; v = ((seed >> 8) / 16777216.0f - 0.5f) * 0.2f; }
    StereoBuf t; t.l = n; t.r = n; reverb(t, 1.0f, kRate);
    double in = 0, wet = 0; for (size_t i = 24000; i < n.size(); ++i) { in += n[i] * n[i]; const double w = t.l[i] - n[i]; wet += w * w; }
    std::printf("  info: reverb wet/dry level at mix=1.0 on noise: %.1f dB\n", 10 * std::log10(wet / in)); }
  { Buf x = sine(300, 2.0, 48000, 0.9); for (size_t i = 0; i < 48000; ++i) x[i] *= 0.05f;     // quiet first second, loud second
    const double before = rms(x, 48000, 96000) / rms(x, 0, 48000); Buf y = x; compress(y, kRate);
    const double after = rms(y, 48000, 96000) / rms(y, 0, 48000);
    CHECK(after < before * 0.6, "compressor narrows the quiet/loud gap (%.1fx -> %.1fx)", before, after); }
  { Buf x = sine(100, 1.0, 48000, 0.5); Buf y = x; highpass(y, 400, kRate);
    CHECK(rms(y, 12000, 36000) < 0.5 * 0.7071 * 0.15, "400 Hz highpass cuts a 100 Hz tone (rms %.4f)", rms(y, 12000, 36000)); }

  std::printf("\n%s (%d failure%s)\n", g_fail ? "FAILED" : "ALL PASSED", g_fail, g_fail == 1 ? "" : "s");
  return g_fail ? 1 : 0;
}
