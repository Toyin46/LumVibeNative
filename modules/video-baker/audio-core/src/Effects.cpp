#include "lumvibe/audio/Effects.h"

namespace lva {
namespace {

struct Biquad {
  double b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  double z1 = 0, z2 = 0;
  inline float process(float xf) {
    const double x = xf;
    const double y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return (float)y;
  }
  void set(double B0, double B1, double B2, double A0, double A1, double A2) {
    b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
  }
  static Biquad lowpass(double fc, double fs, double q) {
    Biquad f; const double w = 2 * kPi * fc / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    f.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); return f;
  }
  static Biquad highpass(double fc, double fs, double q) {
    Biquad f; const double w = 2 * kPi * fc / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    f.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); return f;
  }
  static Biquad peaking(double fc, double fs, double q, double gainDb) {
    Biquad f; const double A = std::pow(10.0, gainDb / 40.0);
    const double w = 2 * kPi * fc / fs, c = std::cos(w), al = std::sin(w) / (2 * q);
    f.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); return f;
  }
};

constexpr double kButterQ = 0.70710678;

} // namespace

void highpass(Buf& x, float hz, int rate) {
  if (hz <= 20.0f || x.empty()) return;
  hz = std::min(hz, 0.45f * rate);
  Biquad a = Biquad::highpass(hz, rate, kButterQ), b = a;
  for (auto& v : x) v = b.process(a.process(v));
}

void lowpass(Buf& x, float hz, int rate) {
  if (hz >= 20000.0f || hz >= 0.45f * rate || x.empty()) return;
  Biquad a = Biquad::lowpass(hz, rate, kButterQ), b = a;
  for (auto& v : x) v = b.process(a.process(v));
}

void peaking(Buf& x, float hz, float q, float gainDb, int rate) {
  if (std::fabs(gainDb) < 0.05f || x.empty()) return;
  Biquad f = Biquad::peaking(hz, rate, q, gainDb);
  for (auto& v : x) v = f.process(v);
}

void noiseGate(Buf& x, int rate) {
  if (x.empty()) return;
  const float thr = dbToLin(-46.0f);             // singing is far above this; room residue is below
  const float atk = std::exp(-1.0f / (0.003f * rate));
  const float rel = std::exp(-1.0f / (0.060f * rate));
  const float gAtk = std::exp(-1.0f / (0.004f * rate));
  const float gRel = std::exp(-1.0f / (0.090f * rate));
  const int hold = (int)(0.120f * rate);
  const float floorGain = dbToLin(-24.0f);       // never fully mute: sounds unnatural
  float env = 0, g = 1; int holdLeft = 0;
  for (auto& v : x) {
    const float a = std::fabs(v);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    float target;
    if (env >= thr) { holdLeft = hold; target = 1.0f; }
    else if (holdLeft > 0) { --holdLeft; target = 1.0f; }
    else target = std::max(floorGain, std::pow(env / thr, 1.5f));
    g = target > g ? gAtk * g + (1 - gAtk) * target : gRel * g + (1 - gRel) * target;
    v *= g;
  }
}

void compress(Buf& x, int rate) {
  if (x.empty()) return;
  const float thrDb = -22.0f, ratio = 3.0f, kneeDb = 8.0f;
  const float atk = std::exp(-1.0f / (0.006f * rate));
  const float rel = std::exp(-1.0f / (0.140f * rate));
  const float makeupDb = std::min(7.0f, -thrDb * (1.0f - 1.0f / ratio) * 0.5f);
  const float makeup = dbToLin(makeupDb);
  float env = 0;
  for (auto& v : x) {
    const float a = std::fabs(v);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const float lv = linToDb(env);
    const float over = lv - thrDb;
    float grDb = 0;                                  // gain reduction (<=0)
    if (2 * over < -kneeDb) grDb = 0;
    else if (2 * std::fabs(over) <= kneeDb) {
      const float t = over + kneeDb / 2;
      grDb = (1.0f / ratio - 1.0f) * t * t / (2 * kneeDb);
    } else grDb = (1.0f / ratio - 1.0f) * over;
    v *= dbToLin(grDb) * makeup;
  }
}

namespace {
class Delay {
public:
  explicit Delay(size_t maxSamples) : buf_(maxSamples + 2, 0.0f) {}
  inline float read(float d) const {            // fractional delay, linear interp
    float p = (float)w_ - d;
    while (p < 0) p += (float)buf_.size();
    const size_t i0 = (size_t)p % buf_.size();
    const size_t i1 = (i0 + 1) % buf_.size();
    const float f = p - std::floor(p);
    return buf_[i0] * (1 - f) + buf_[i1] * f;
  }
  inline void write(float v) { buf_[w_] = v; w_ = (w_ + 1) % buf_.size(); }
private:
  std::vector<float> buf_;
  size_t w_ = 0;
};
} // namespace

StereoBuf makeStereo(const Buf& mono, bool chorus, int rate) {
  StereoBuf s; s.l = mono; s.r = mono;
  if (!chorus) return s;
  const size_t n = mono.size();
  Delay d1((size_t)(0.08f * rate)), d2((size_t)(0.08f * rate));
  for (size_t i = 0; i < n; ++i) {
    const float t = (float)i / rate;
    const float m1 = 0.017f + 0.0030f * std::sin(2 * (float)kPi * 0.31f * t);
    const float m2 = 0.023f + 0.0040f * std::sin(2 * (float)kPi * 0.23f * t + 1.7f);
    d1.write(mono[i]); d2.write(mono[i]);
    const float c1 = d1.read(m1 * rate), c2 = d2.read(m2 * rate);
    s.l[i] = 0.82f * mono[i] + 0.55f * c1;
    s.r[i] = 0.82f * mono[i] + 0.55f * c2;
  }
  return s;
}

void echo(StereoBuf& s, float delayMs, float mix, int rate) {
  if (mix <= 0.001f || s.l.empty()) return;
  if (delayMs < 30.0f) delayMs = 280.0f;
  const float fb = 0.38f;
  const float lpA = std::exp(-2.0f * (float)kPi * 3500.0f / rate);   // darker repeats
  auto run = [&](Buf& ch, float ms) {
    const size_t d = std::max<size_t>(1, (size_t)(ms * 0.001f * rate));
    std::vector<float> line(d, 0.0f);
    size_t w = 0; float lp = 0;
    for (auto& v : ch) {
      const float wet = line[w];
      lp = (1 - lpA) * wet + lpA * lp;
      line[w] = v + fb * lp;
      w = (w + 1) % d;
      v += mix * wet;
    }
  };
  run(s.l, delayMs);
  run(s.r, delayMs * 1.31f);        // slightly different time per side = width
}

namespace {
struct Comb {
  std::vector<float> b; size_t i = 0; float filt = 0, fb = 0.84f, damp = 0.2f;
  explicit Comb(size_t n) : b(n, 0.0f) {}
  inline float process(float in) {
    const float out = b[i];
    filt = out * (1 - damp) + filt * damp;
    b[i] = in + filt * fb;
    if (++i >= b.size()) i = 0;
    return out;
  }
};
struct Allpass {
  std::vector<float> b; size_t i = 0;
  explicit Allpass(size_t n) : b(n, 0.0f) {}
  inline float process(float in) {
    const float bo = b[i];
    const float out = -in + bo;
    b[i] = in + bo * 0.5f;
    if (++i >= b.size()) i = 0;
    return out;
  }
};
} // namespace

void reverb(StereoBuf& s, float mix, int rate) {
  if (mix <= 0.001f || s.l.empty()) return;
  static const int combT[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
  static const int apT[4] = {556, 441, 341, 225};
  const float sc = (float)rate / 44100.0f;
  const int spread = (int)(23 * sc);
  std::vector<Comb> cl, cr; std::vector<Allpass> al, ar;
  const float room = 0.80f + 0.15f * std::min(1.0f, mix * 1.5f);   // bigger mix -> longer tail (~1.2 s at 0.1, ~3 s at 0.7+)
  for (int k = 0; k < 8; ++k) {
    cl.emplace_back((size_t)(combT[k] * sc));
    cr.emplace_back((size_t)(combT[k] * sc) + spread);
    cl.back().fb = cr.back().fb = room;
  }
  for (int k = 0; k < 4; ++k) {
    al.emplace_back((size_t)(apT[k] * sc));
    ar.emplace_back((size_t)(apT[k] * sc) + spread);
  }
  const size_t n = s.l.size();
  const float wetGain = mix * 3.0f;                  // measured: wet is ~+2 dB over dry at mix=1.0 (tests/unit_tests.cpp)
  for (size_t i = 0; i < n; ++i) {
    const float in = (s.l[i] + s.r[i]) * 0.5f * 0.015f;
    float ol = 0, orr = 0;
    for (auto& c : cl) ol += c.process(in);
    for (auto& c : cr) orr += c.process(in);
    for (auto& a : al) ol = a.process(ol);
    for (auto& a : ar) orr = a.process(orr);
    s.l[i] += wetGain * ol;
    s.r[i] += wetGain * orr;
  }
}

float activeRmsDb(const float* x, size_t n, int rate, float gateDb) {
  const size_t blk = std::max<size_t>(1, (size_t)(0.020 * rate));
  double acc = 0; size_t cnt = 0;
  for (size_t i = 0; i + blk <= n; i += blk) {
    double e = 0;
    for (size_t j = 0; j < blk; ++j) e += (double)x[i + j] * x[i + j];
    e /= blk;
    const float db = 10.0f * std::log10((float)e + 1e-12f);
    if (db > gateDb) { acc += e; ++cnt; }
  }
  if (cnt == 0) return -90.0f;
  return 10.0f * std::log10((float)(acc / cnt) + 1e-12f);
}

} // namespace lva
