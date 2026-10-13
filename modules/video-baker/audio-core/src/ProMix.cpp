#include "lumvibe/audio/ProMix.h"
#include "lumvibe/audio/Resampler.h"
#include "lumvibe/audio/lva.h"
#include <cmath>
#include <deque>
#include <stdexcept>
#include <string>

namespace lva {
namespace {

constexpr double SR = 48000.0;
constexpr double PI_ = 3.14159265358979323846;

// ---- website CFG (js/create/proMix.js) ----
constexpr double voiceOverBeatSpeechDb = 11, maxVocalOverBeatDb = 14;
constexpr double duckMidDb = 7, duckLowDb = 1.0, duckHighDb = 2.5;
constexpr double beatRefDb = -20, vocalRefDb = -20;
constexpr double reverbDb = -21, beatReverbDb = -30, tailSec = 1.6;
constexpr double targetLufsBeat = -14, targetLufsVoice = -16, ceilingDb = -1;
constexpr double toneAmount = 0.8;

inline double dB(double x) { return std::pow(10.0, x / 20.0); }
inline double toDb(double x) { return 20.0 * std::log10(std::max(x, 1e-9)); }
inline double msCoef(double t) { return std::exp(-1.0 / (SR * t / 1000.0)); }

enum class F { HP, LP, PEAK, LS, HS };

struct Coef { double b0, b1, b2, a1, a2; };

Coef coef(F type, double f0, double Q, double gdb) {
  const double A = std::pow(10.0, gdb / 40.0), w = 2.0 * PI_ * f0 / SR, c = std::cos(w), s = std::sin(w);
  const double al = s / (2.0 * Q), sq = 2.0 * std::sqrt(A) * (s / 2.0 * std::sqrt(2.0));
  double b0, b1, b2, a0, a1, a2;
  switch (type) {
    case F::HP:   b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case F::LP:   b0 = (1 - c) / 2; b1 = 1 - c;    b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; break;
    case F::PEAK: b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; break;
    case F::LS:   b0 = A * ((A + 1) - (A - 1) * c + sq); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - sq);
                  a0 = (A + 1) + (A - 1) * c + sq; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - sq; break;
    default:      b0 = A * ((A + 1) + (A - 1) * c + sq); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - sq);
                  a0 = (A + 1) - (A - 1) * c + sq; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - sq; break;
  }
  return {b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0};
}

void filt(Buf& x, F type, double f0, double Q, double gdb = 0.0) {
  const Coef k = coef(type, f0, Q, gdb);
  double x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (size_t i = 0; i < x.size(); ++i) {
    const double v = x[i], y = k.b0 * v + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y; x[i] = (float)y;
  }
}

void gainBy(Buf& x, double g) { for (auto& v : x) v = (float)(v * g); }

double activeRmsDb(const Buf& x) {
  const size_t blk = (size_t)std::floor(0.02 * SR);
  std::vector<double> es; double mx = 0;
  for (size_t i = 0; i + blk <= x.size(); i += blk) {
    double e = 0; for (size_t j = 0; j < blk; ++j) e += (double)x[i + j] * x[i + j];
    e /= blk; es.push_back(e); if (e > mx) mx = e;
  }
  if (mx < 1e-11) return -120;
  const double thr = std::max(1e-10, mx * 3.2e-4); double acc = 0; int cnt = 0;
  for (double e : es) if (e > thr) { acc += e; ++cnt; }
  return cnt ? 10.0 * std::log10(acc / cnt + 1e-14) : -120;
}

// ---------- automatic tone ----------
const double BANDS[7] = {177, 354, 707, 1414, 2828, 5657, 11314};
const double TARGET[7] = {0, 1, 0, -3.5, -6, -8.5, -12.5};
const double UPLIM[7] = {2, 3, 0, 6, 5.5, 5, 4};

std::vector<char> blockMask(const Buf& x) {
  const size_t blk = (size_t)std::floor(0.02 * SR);
  std::vector<double> es; double mx = 0;
  for (size_t i = 0; i + blk <= x.size(); i += blk) {
    double e = 0; for (size_t j = 0; j < blk; ++j) e += (double)x[i + j] * x[i + j];
    e /= blk; es.push_back(e); if (e > mx) mx = e;
  }
  std::vector<char> m; m.reserve(es.size());
  for (double e : es) m.push_back(e > mx * 3.2e-4 ? 1 : 0);
  return m;
}

double maskedDb(const Buf& y, const std::vector<char>& m) {
  const size_t blk = (size_t)std::floor(0.02 * SR); double a = 0; int c = 0;
  for (size_t b = 0; b < m.size(); ++b) if (m[b]) {
    double e = 0; for (size_t j = 0; j < blk; ++j) e += (double)y[b * blk + j] * y[b * blk + j];
    a += e / blk; ++c;
  }
  return c ? 10.0 * std::log10(a / c + 1e-14) : -120;
}

void autoTone(Buf& x, double amount) {
  const auto m = blockMask(x);
  double lv[7];
  for (int i = 0; i < 7; ++i) {
    Buf y = x; filt(y, F::HP, BANDS[i] / 1.414, 0.707); filt(y, F::LP, std::min(20000.0, BANDS[i] * 1.414), 0.707);
    lv[i] = maskedDb(y, m);
  }
  const double ref = lv[2]; double gains[7];
  for (int i = 0; i < 7; ++i) {
    if (i == 2) { gains[i] = 0; continue; }
    double g = (TARGET[i] - (lv[i] - ref)) * amount;
    if (lv[i] - ref < -30 && g > 0) g = 0;
    gains[i] = std::max(-8.0, std::min(UPLIM[i], g));
  }
  for (int i = 0; i < 7; ++i) if (std::fabs(gains[i]) > 0.4) filt(x, F::PEAK, BANDS[i], 1.0, gains[i]);
}

void expandDown(Buf& x, double thrDb, double ratio, double openMs, double closeMs, double maxDb) {
  const double op = msCoef(openMs), cl = msCoef(closeMs), de = msCoef(40);
  double env = 0, g = 0;
  for (size_t i = 0; i < x.size(); ++i) {
    const double a = std::fabs((double)x[i]);
    env = a > env ? 0.5 * env + 0.5 * a : de * env + (1 - de) * a;
    const double lv = toDb(env), under = thrDb - lv;
    const double tg = under > 0 ? std::min(maxDb, under * (ratio - 1)) : 0;
    g = tg > g ? cl * g + (1 - cl) * tg : op * g + (1 - op) * tg;
    x[i] = (float)(x[i] * dB(-g));
  }
}

void compress(Buf& x, double thr, double ratio, double atkMs, double relMs, double knee, double makeupDb) {
  const double at = msCoef(atkMs), rl = msCoef(relMs), slope = 1 - 1 / ratio, mk = dB(makeupDb);
  double g = 0;
  for (size_t i = 0; i < x.size(); ++i) {
    const double lv = toDb(std::fabs((double)x[i])), over = lv - thr; double tg = 0;
    if (over > knee / 2) tg = over * slope;
    else if (over > -knee / 2) tg = (over + knee / 2) * (over + knee / 2) / (2 * knee) * slope;
    g = tg > g ? at * g + (1 - at) * tg : rl * g + (1 - rl) * tg;
    x[i] = (float)(x[i] * dB(-g) * mk);
  }
}

void deEss(Buf& x) {
  Buf hi = x; filt(hi, F::HP, 5500, 0.707); filt(hi, F::HP, 5500, 0.707);
  Buf lo(x.size()); for (size_t i = 0; i < x.size(); ++i) lo[i] = x[i] - hi[i];
  compress(hi, -34, 4.5, 1, 45, 4, 0);
  for (size_t i = 0; i < x.size(); ++i) x[i] = lo[i] + hi[i];
}

void saturate(Buf& x, double drive, double wet) {
  const double nm = std::tanh(drive);
  for (auto& v : x) { const double d = std::tanh(drive * v) / nm; v = (float)(v * (1 - wet) + d * wet); }
}

Buf delayTap(const Buf& src, double sec) {
  const size_t n = (size_t)std::floor(sec * SR); Buf o(src.size(), 0.0f);
  if (src.size() > n) std::copy(src.begin(), src.end() - n, o.begin() + n);
  return o;
}

struct Comb { Buf b; size_t i = 0; double f = 0; };
struct Ap   { Buf b; size_t i = 0; };

Buf plateSide(const Buf& x, int ch) {
  const double k = SR / 44100.0;
  const int combsBase[8] = {1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617};
  const int apsBase[4] = {556, 441, 341, 225};
  const double fb = 0.8, damp = 0.42;
  const size_t sp = ch ? (size_t)std::lround(23 * k) : 0;
  std::vector<Comb> cb(8); std::vector<Ap> ab(4);
  for (int c = 0; c < 8; ++c) cb[c].b.assign((size_t)std::lround(combsBase[c] * k) + sp, 0.0f);
  for (int a = 0; a < 4; ++a) ab[a].b.assign((size_t)std::lround(apsBase[a] * k) + sp, 0.0f);
  Buf out(x.size());
  for (size_t n = 0; n < x.size(); ++n) {
    const double inn = (double)x[n] * 0.015; double s = 0;
    for (auto& q : cb) {
      const double y = q.b[q.i]; q.f = y * (1 - damp) + q.f * damp; q.b[q.i] = (float)(inn + q.f * fb);
      if (++q.i >= q.b.size()) q.i = 0;
      s += y;
    }
    for (auto& q : ab) {
      const double bo = q.b[q.i]; const double o = -s + bo; q.b[q.i] = (float)(s + bo * 0.5);
      if (++q.i >= q.b.size()) q.i = 0;
      s = o;
    }
    out[n] = (float)s;
  }
  return out;
}

// Freeverb-style plate (8 combs + 4 allpass per side), pre-delay, cleaned-up input.
StereoBuf plate(const Buf& inp) {
  Buf x = delayTap(inp, 0.02); filt(x, F::HP, 250, 0.707); filt(x, F::LP, 6500, 0.707);
  StereoBuf o; o.l = plateSide(x, 0); o.r = plateSide(x, 1); return o;
}

double rmsAll(const Buf& x) { double e = 0; for (float v : x) e += (double)v * v; return std::sqrt(e / std::max<size_t>(1, x.size())); }

// ---------- loudness (ITU-R BS.1770) ----------
double lufsOf(const Buf& l, const Buf& r) {
  auto k = [](const Buf& ch) { Buf y = ch; filt(y, F::HS, 1681.97, 0.7072, 3.99984); filt(y, F::HP, 38.13547, 0.5003); return y; };
  Buf yl = k(l), yr = k(r);
  const size_t blk = (size_t)std::floor(0.4 * SR), hop = (size_t)std::floor(0.1 * SR);
  std::vector<double> z;
  for (size_t i = 0; i + blk <= yl.size(); i += hop) {
    double a = 0, b = 0;
    for (size_t j = 0; j < blk; ++j) { a += (double)yl[i + j] * yl[i + j]; b += (double)yr[i + j] * yr[i + j]; }
    z.push_back(a / blk + b / blk);
  }
  auto L = [](double zz) { return -0.691 + 10.0 * std::log10(zz + 1e-12); };
  std::vector<double> abs_; for (double v : z) if (L(v) > -70) abs_.push_back(v);
  if (abs_.empty()) return -70;
  double sum = 0; for (double v : abs_) sum += v;
  const double rel = L(sum / abs_.size()) - 10;
  double gs = 0; size_t gc = 0; for (double v : abs_) if (L(v) > rel) { gs += v; ++gc; }
  return gc ? L(gs / gc) : L(sum / abs_.size());
}

void glue(Buf& l, Buf& r, double thr, double ratio, double atkMs, double relMs) {
  const double at = msCoef(atkMs), rl = msCoef(relMs), slope = 1 - 1 / ratio; double g = 0;
  for (size_t i = 0; i < l.size(); ++i) {
    const double over = toDb(std::max(std::fabs((double)l[i]), std::fabs((double)r[i]))) - thr;
    const double tg = over > 0 ? over * slope : 0;
    g = tg > g ? at * g + (1 - at) * tg : rl * g + (1 - rl) * tg;
    const double kk = dB(-g); l[i] = (float)(l[i] * kk); r[i] = (float)(r[i] * kk);
  }
}

double clipOne(double x, double T) {
  const double a = std::fabs(x); if (a <= T) return x;
  const double s = x < 0 ? -1 : 1; return s * (T + (1 - T) * std::tanh((a - T) / (1 - T)));
}
void softClip(Buf& l, Buf& r, double knee) { for (size_t i = 0; i < l.size(); ++i) { l[i] = (float)clipOne(l[i], knee); r[i] = (float)clipOne(r[i], knee); } }

void limiter(Buf& l, Buf& r, double ceil) {
  const int LA = 240; const size_t n = l.size();
  std::vector<float> req(n), gmin(n);
  for (size_t i = 0; i < n; ++i) { const double p = std::max(std::fabs((double)l[i]), std::fabs((double)r[i])); req[i] = (float)(p > ceil ? ceil / p : 1.0); }
  std::vector<int> dq(n + 1); long h = 0, t = 0;
  for (long k = (long)n - 1; k >= 0; --k) {
    while (t > h && req[dq[t - 1]] >= req[k]) --t;
    dq[t++] = (int)k;
    while (dq[h] > k + LA - 1) ++h;
    gmin[k] = req[dq[h]];
  }
  double acc = 0;
  for (size_t i = 0; i < n; ++i) {
    acc += gmin[i]; if (i >= (size_t)LA) acc -= gmin[i - LA];
    const double g = acc / std::min<size_t>(LA, i + 1), gg = std::min(g, (double)req[i]);
    l[i] = (float)(l[i] * gg); r[i] = (float)(r[i] * gg);
  }
}

void masterTo(Buf& l, Buf& r, double target, double ceilDbv) {
  const double ceil = dB(ceilDbv);
  for (int pass = 0; pass < 3; ++pass) {
    const double cur = lufsOf(l, r), diff = target - cur;
    if (std::fabs(diff) < 0.3 && pass > 0) break;
    const double g = dB(std::max(-24.0, std::min(24.0, diff)));
    gainBy(l, g); gainBy(r, g); softClip(l, r, 0.7); limiter(l, r, ceil);
  }
  double pk = 0; for (size_t i = 0; i < l.size(); ++i) pk = std::max({pk, (double)std::fabs(l[i]), (double)std::fabs(r[i])});
  if (pk > ceil) { const double g = ceil / pk; gainBy(l, g); gainBy(r, g); }
}

[[noreturn]] void throwSilent() { throw std::runtime_error("SILENT_VOICE"); }

} // namespace

float proMixActiveRmsDb(const Buf& x) { return (float)activeRmsDb(x); }
float proMixLufs(const Buf& l, const Buf& r) { return (float)lufsOf(l, r); }

StereoBuf proMixProcess(const Buf& voiceIn, const StereoBuf* beatIn, const ProgressFn& cb) {
  auto prog = [&](float f, const char* s) { if (cb) cb(f, s); };
  const size_t n = voiceIn.size(), tail = (size_t)std::floor(tailSec * SR), N = n + tail;
  const bool hasBeat = beatIn && beatIn->l.size() > (size_t)(SR / 20);
  Buf voice = voiceIn;
  prog(0.02f, "Shaping your voice");
  const double vRms = activeRmsDb(voice);
  if (vRms < -100) throwSilent();
  gainBy(voice, dB(std::max(-30.0, std::min(40.0, vocalRefDb - vRms))));
  filt(voice, F::HP, 100, 0.707); expandDown(voice, vocalRefDb - 32, 1.8, 4, 90, 10);
  autoTone(voice, toneAmount); filt(voice, F::PEAK, 3200, 0.9, 1); filt(voice, F::HS, 10500, 0.7, 2);
  prog(0.12f, "Balancing the tone"); deEss(voice);
  prog(0.2f, "Compressing"); compress(voice, -26, 3, 12, 140, 6, 0); compress(voice, -16, 6, 2, 80, 4, 0); saturate(voice, 1.5, 0.15);
  Buf dry(N, 0.0f); std::copy(voice.begin(), voice.end(), dry.begin());

  prog(0.3f, "Adding space");
  Buf vl(N), vrr(N);
  {
    const double vr = rmsAll(dry) + 1e-9;
    StereoBuf rv = plate(dry);
    const double rr = (rmsAll(rv.l) + rmsAll(rv.r)) / 2 + 1e-9, rg = dB(reverbDb) * vr / rr;
    for (size_t i = 0; i < N; ++i) { vl[i] = (float)(dry[i] + rv.l[i] * rg); vrr[i] = (float)(dry[i] + rv.r[i] * rg); }
  }
  if (!hasBeat) {
    prog(0.7f, "Mastering"); masterTo(vl, vrr, targetLufsVoice, ceilingDb); prog(1.0f, "Done");
    return StereoBuf{std::move(vl), std::move(vrr)};
  }

  prog(0.4f, "Fitting the beat");
  Buf bl(N), br(N);
  {
    const size_t bn = beatIn->l.size(), rn = std::max<size_t>(1, beatIn->r.size());
    const size_t xf = std::min<size_t>(480, bn >> 2);
    for (size_t i = 0; i < N; ++i) {
      const size_t k = i % bn; double w = 1;
      if (N > bn) { if (k < xf) w = (double)k / xf; else if (bn - k < xf) w = (double)(bn - k) / xf; }
      bl[i] = (float)(beatIn->l[k] * w); br[i] = (float)(beatIn->r[k % rn] * w);
    }
  }
  for (Buf* ch : {&bl, &br}) { filt(*ch, F::PEAK, 2800, 0.9, -3.5); filt(*ch, F::PEAK, 1200, 0.9, -1.5); filt(*ch, F::PEAK, 350, 0.9, -2); }

  Buf mono(std::min(N, n));
  for (size_t i = 0; i < mono.size(); ++i) mono[i] = (bl[i] + br[i]) / 2.0f;
  const double bRms = activeRmsDb(mono);
  const double bg = dB(std::max(-30.0, std::min(30.0, beatRefDb - (bRms > -100 ? bRms : beatRefDb))));
  gainBy(bl, bg); gainBy(br, bg);

  auto speech = [](const Buf& x) { Buf y = x; filt(y, F::HP, 300, 0.707); filt(y, F::LP, 4000, 0.707); return activeRmsDb(y); };
  const double bMid = speech(mono) + toDb(bg), bMidDucked = bMid - duckMidDb, vMid = speech(voice), vNow = activeRmsDb(voice);
  double vgDb = bMidDucked + voiceOverBeatSpeechDb - vMid;
  vgDb = std::max(beatRefDb - vNow, std::min(beatRefDb + maxVocalOverBeatDb - vNow, vgDb));
  const double vTarget = vNow + vgDb, vg = dB(vgDb);
  gainBy(vl, vg); gainBy(vrr, vg); gainBy(dry, vg);
  { Buf().swap(mono); }

  prog(0.55f, "Ducking the beat under your voice");
  const size_t blkN = (size_t)std::floor(0.01 * SR), blocks = (N + blkN - 1) / blkN;
  std::vector<float> act(blocks); const double thr = dB(vTarget - 24);
  for (size_t b = 0; b < blocks; ++b) {
    double e = 0; size_t c = 0;
    for (size_t j = b * blkN; j < std::min(N, (b + 1) * blkN); ++j) { e += (double)dry[j] * dry[j]; ++c; }
    act[b] = std::sqrt(e / std::max<size_t>(1, c)) > thr ? 1.0f : 0.0f;
  }
  { // 10 ms blocks: 15 ms attack, 300 ms release (same constants as the website)
    const double at = std::exp(-1.0 / (100 * 0.02)), rl = std::exp(-1.0 / (100 * 0.45)); double s = 0;
    for (size_t b = 0; b < blocks; ++b) { s = act[b] > s ? at * s + (1 - at) * act[b] : rl * s + (1 - rl) * act[b]; act[b] = (float)s; }
  }
  { Buf().swap(dry); }
  {
    const double dkL = dB(-duckLowDb), dkM = dB(-duckMidDb), dkH = dB(-duckHighDb);
    for (Buf* ch : {&bl, &br}) {   // multiband duck: only the middle (where the voice lives) dips noticeably
      Buf lo = *ch; filt(lo, F::LP, 180, 0.707); filt(lo, F::LP, 180, 0.707);
      Buf hi = *ch; filt(hi, F::HP, 5000, 0.707); filt(hi, F::HP, 5000, 0.707);
      for (size_t i = 0; i < N; ++i) {
        const double a = act[std::min(blocks - 1, i / blkN)];
        const double gl = 1 + (dkL - 1) * a, gm = 1 + (dkM - 1) * a, gh = 1 + (dkH - 1) * a;
        const double mid = (double)(*ch)[i] - lo[i] - hi[i];
        (*ch)[i] = (float)(lo[i] * gl + mid * gm + hi[i] * gh);
      }
    }
  }
  { // shared reverb: a little of the beat goes through the same room as the voice
    Buf bm(N); for (size_t i = 0; i < N; ++i) bm[i] = (bl[i] + br[i]) / 2.0f;
    StereoBuf s = plate(bm);
    const double sr = (rmsAll(s.l) + rmsAll(s.r)) / 2 + 1e-9, sg = dB(beatReverbDb) * rmsAll(bm) / sr;
    for (size_t i = 0; i < N; ++i) { bl[i] = (float)(bl[i] + s.l[i] * sg); br[i] = (float)(br[i] + s.r[i] * sg); }
  }
  for (size_t i = n; i < N; ++i) { const double f = 0.5 * (1 + std::cos(PI_ * (double)(i - n) / (double)tail)); bl[i] = (float)(bl[i] * f); br[i] = (float)(br[i] * f); }

  prog(0.65f, "Gluing the mix");
  Buf L(N), R(N);
  for (size_t i = 0; i < N; ++i) { L[i] = vl[i] + bl[i]; R[i] = vrr[i] + br[i]; }
  { Buf().swap(vl); Buf().swap(vrr); Buf().swap(bl); Buf().swap(br); }
  glue(L, R, -19, 2, 35, 220);
  prog(0.8f, "Mastering to streaming loudness"); masterTo(L, R, targetLufsBeat, ceilingDb);
  prog(1.0f, "Done");
  return StereoBuf{std::move(L), std::move(R)};
}

// ===================== masterSong() =====================
namespace {
Buf monoAt48k(const PcmIn& in) {
  Buf mono((size_t)in.frames, 0.0f);
  const int ch = std::max(1, in.channels);
  for (int i = 0; i < in.frames; ++i) { double s = 0; for (int c = 0; c < ch; ++c) s += in.data[(size_t)i * ch + c]; mono[(size_t)i] = (float)(s / ch); }
  return in.rate == kRate ? mono : resample(mono.data(), mono.size(), in.rate, kRate);
}
} // namespace

Result masterSong(const PcmIn& voice, const PcmIn* beat, float latencyMs, const ProgressFn& progress) {
  auto prog = [&](float f, const char* s) { if (progress) progress(f, s); };
  if (!voice.data || voice.frames <= 0) throw std::runtime_error("voice recording could not be read");
  prog(0.01f, "Reading your recording");
  Buf raw = monoAt48k(voice);
  const double rawDb = activeRmsDb(raw);
  if (rawDb < -100) throwSilent();
  // quiet phone mics get lifted BEFORE cleaning (same as the website)
  const double g = std::pow(10.0, std::max(-12.0, std::min(45.0, -20.0 - rawDb)) / 20.0);
  double pk = 0; for (float v : raw) pk = std::max(pk, std::fabs(v * g));
  const double lift = pk > 0.95 ? g * 0.95 / pk : g;
  Buf norm(raw.size()); for (size_t i = 0; i < raw.size(); ++i) norm[i] = (float)(raw[i] * lift);
  { Buf().swap(raw); }

  const bool haveBeat = beat && beat->data && beat->frames > 0;
  // 1) clean + tune the voice with the shared engine (no reverb/compression here: the pro chain does those)
  auto runEngine = [&](int denoiseMode) {
    std::vector<float> p(LVA_P_COUNT); Params::defaultsToArray(p.data(), LVA_P_COUNT);
    p[LVA_P_DENOISE_MODE] = (float)denoiseMode; p[LVA_P_DENOISE_STRENGTH] = 0.5f;
    p[LVA_P_AUTOTUNE] = 1; p[LVA_P_TUNE_STRENGTH] = 0.25f; p[LVA_P_TUNE_SPEED_MS] = 120;
    p[LVA_P_CANCEL_BLEED] = haveBeat ? 1.0f : 0.0f;
    p[LVA_P_HIGHPASS_HZ] = 60; p[LVA_P_LOWPASS_HZ] = 20000; p[LVA_P_PRESENCE_DB] = 0; p[LVA_P_COMPRESS] = 0;
    p[LVA_P_REVERB_MIX] = 0; p[LVA_P_ECHO_MIX] = 0; p[LVA_P_CHORUS] = 0; p[LVA_P_NORMALIZE] = 0; p[LVA_P_TAIL_SEC] = 0;
    p[LVA_P_VOICE_GAIN] = 1; p[LVA_P_BEAT_GAIN] = 0; p[LVA_P_AUTO_BALANCE] = 0;
    p[LVA_P_VOICE_OFFSET_MS] = (float)std::max(0.0, std::min(400.0, std::round((double)latencyMs)));
    const Params prm = Params::fromArray(p.data(), (int)p.size());
    PcmIn v{norm.data(), (int)norm.size(), kRate, 1};
    PcmIn b{haveBeat ? beat->data : nullptr, haveBeat ? beat->frames : 0, haveBeat ? beat->rate : 0, haveBeat ? beat->channels : 0};
    Result r = process(prm, v, haveBeat ? &b : nullptr, [&](float f, const char* s) { prog(0.02f + 0.43f * f, s); });
    Buf m((size_t)r.frames);
    for (int i = 0; i < r.frames; ++i) m[(size_t)i] = (r.pcm[(size_t)i * 2] + r.pcm[(size_t)i * 2 + 1]) / 2.0f;
    return m;
  };
  Buf vm = runEngine(1);
  if (activeRmsDb(vm) < -70) { prog(0.3f, "Retrying without noise removal"); vm = runEngine(0); }
  if (activeRmsDb(vm) < -70) {        // last resort: the cleaned voice would be empty, so keep the lifted original
    const size_t skip = std::min(norm.size() ? norm.size() - 1 : 0, (size_t)std::lround(latencyMs * 48.0f));
    vm.assign(norm.begin() + skip, norm.end());
  }
  { Buf().swap(norm); }

  // 2) the beat -> 48 kHz stereo
  StereoBuf B; bool useBeat = false;
  if (haveBeat) {
    prog(0.47f, "Loading the beat");
    const int ch = std::max(1, beat->channels);
    Buf l((size_t)beat->frames), r((size_t)beat->frames);
    for (int i = 0; i < beat->frames; ++i) { l[(size_t)i] = beat->data[(size_t)i * ch]; r[(size_t)i] = beat->data[(size_t)i * ch + (ch > 1 ? 1 : 0)]; }
    if (beat->rate != kRate) { B.l = resample(l.data(), l.size(), beat->rate, kRate); B.r = resample(r.data(), r.size(), beat->rate, kRate); }
    else { B.l = std::move(l); B.r = std::move(r); }
    useBeat = true;
  }

  // 3) the pro chain
  StereoBuf out = proMixProcess(vm, useBeat ? &B : nullptr, [&](float f, const char* s) { prog(0.5f + 0.5f * f, s); });
  Result res; res.frames = (int)out.l.size(); res.pcm.resize((size_t)res.frames * 2);
  for (int i = 0; i < res.frames; ++i) {
    res.pcm[(size_t)i * 2]     = std::max(-1.0f, std::min(1.0f, out.l[(size_t)i]));
    res.pcm[(size_t)i * 2 + 1] = std::max(-1.0f, std::min(1.0f, out.r[(size_t)i]));
  }
  return res;
}

} // namespace lva
