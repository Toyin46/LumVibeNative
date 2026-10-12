#include "lumvibe/audio/Engine.h"
#include "lumvibe/audio/Denoiser.h"
#include "lumvibe/audio/Effects.h"
#include "lumvibe/audio/Pitch.h"
#include "lumvibe/audio/Resampler.h"
#include "lumvibe/audio/Fft.h"
#include <cstdlib>
#include <stdexcept>

namespace lva {

// ── Params ──────────────────────────────────────────────────────────────────
Params Params::fromArray(const float* p, int n) {
  Params d;                       // starts at the C++ defaults, overridden per index
  auto has = [&](int i) { return p && i < n; };
  auto F = [&](int i, float def) { return has(i) ? p[i] : def; };
  d.denoiseMode     = (int)F(LVA_P_DENOISE_MODE, (float)d.denoiseMode);
  d.denoiseStrength = F(LVA_P_DENOISE_STRENGTH, d.denoiseStrength);
  d.noiseGate       = F(LVA_P_NOISE_GATE, d.noiseGate) > 0.5f;
  d.autotune        = F(LVA_P_AUTOTUNE, d.autotune) > 0.5f;
  d.scaleRoot       = (int)F(LVA_P_SCALE_ROOT, (float)d.scaleRoot);
  d.scaleType       = (int)F(LVA_P_SCALE_TYPE, (float)d.scaleType);
  d.tuneStrength    = F(LVA_P_TUNE_STRENGTH, d.tuneStrength);
  d.tuneSpeedMs     = F(LVA_P_TUNE_SPEED_MS, d.tuneSpeedMs);
  d.pitchSemitones  = F(LVA_P_PITCH_SEMITONES, d.pitchSemitones);
  d.highpassHz      = F(LVA_P_HIGHPASS_HZ, d.highpassHz);
  d.lowpassHz       = F(LVA_P_LOWPASS_HZ, d.lowpassHz);
  d.presenceDb      = F(LVA_P_PRESENCE_DB, d.presenceDb);
  d.compress        = F(LVA_P_COMPRESS, d.compress) > 0.5f;
  d.reverbMix       = F(LVA_P_REVERB_MIX, d.reverbMix);
  d.echoMix         = F(LVA_P_ECHO_MIX, d.echoMix);
  d.echoMs          = F(LVA_P_ECHO_MS, d.echoMs);
  d.chorus          = F(LVA_P_CHORUS, d.chorus) > 0.5f;
  d.reverse         = F(LVA_P_REVERSE, d.reverse) > 0.5f;
  d.trimStartSec    = F(LVA_P_TRIM_START_SEC, d.trimStartSec);
  d.trimEndSec      = F(LVA_P_TRIM_END_SEC, d.trimEndSec);
  d.voiceGain       = F(LVA_P_VOICE_GAIN, d.voiceGain);
  d.beatGain        = F(LVA_P_BEAT_GAIN, d.beatGain);
  d.voiceOffsetMs   = F(LVA_P_VOICE_OFFSET_MS, d.voiceOffsetMs);
  d.normalize       = F(LVA_P_NORMALIZE, d.normalize) > 0.5f;
  d.tailSec         = F(LVA_P_TAIL_SEC, d.tailSec);
  d.autoBalance     = F(LVA_P_AUTO_BALANCE, d.autoBalance) > 0.5f;
  d.cancelBleed     = F(LVA_P_CANCEL_BLEED, d.cancelBleed) > 0.5f;
  return d;
}

void Params::defaultsToArray(float* out, int n) {
  Params d;
  const float v[LVA_P_COUNT] = {
    (float)d.denoiseMode, d.denoiseStrength, (float)d.noiseGate, (float)d.autotune,
    (float)d.scaleRoot, (float)d.scaleType, d.tuneStrength, d.tuneSpeedMs, d.pitchSemitones,
    d.highpassHz, d.lowpassHz, d.presenceDb, (float)d.compress, d.reverbMix, d.echoMix, d.echoMs,
    (float)d.chorus, (float)d.reverse, d.trimStartSec, d.trimEndSec, d.voiceGain, d.beatGain,
    d.voiceOffsetMs, (float)d.normalize, d.tailSec, (float)d.autoBalance, (float)d.cancelBleed};
  for (int i = 0; i < n && i < LVA_P_COUNT; ++i) out[i] = v[i];
}

namespace {

void report(const ProgressFn& cb, float a, float b, float f, const char* stage) {
  if (cb) cb(a + (b - a) * std::min(1.0f, std::max(0.0f, f)), stage);
}

Buf toMono48(const PcmIn& in) {
  const int ch = std::max(1, in.channels);
  Buf mono((size_t)in.frames);
  for (int i = 0; i < in.frames; ++i) {
    float s = 0;
    for (int c = 0; c < ch; ++c) s += in.data[(size_t)i * ch + c];
    mono[i] = s / ch;
  }
  return resample(mono.data(), mono.size(), in.rate, kRate);
}

StereoBuf toStereo48(const PcmIn& in) {
  const int ch = std::max(1, in.channels);
  Buf l((size_t)in.frames), r((size_t)in.frames);
  for (int i = 0; i < in.frames; ++i) {
    l[i] = in.data[(size_t)i * ch];
    r[i] = ch > 1 ? in.data[(size_t)i * ch + 1] : l[i];
  }
  StereoBuf s;
  s.l = resample(l.data(), l.size(), in.rate, kRate);
  s.r = resample(r.data(), r.size(), in.rate, kRate);
  return s;
}

// ── Beat-bleed canceller ────────────────────────────────────────────────────────────────────────────────
// Port of cancelBleed() in lvaudio-web.js (the website), same maths, so app and website sound the same.
// When you sing with the beat coming out of a SPEAKER, the mic records your voice AND the beat. We know the
// beat exactly, so we take it back out (known-reference echo cancellation, offline on the whole recording):
//   1) find the delay between the beat and its leak (GCC-PHAT)   2) learn the speaker->room->mic response per
//   frequency (weighted least squares: moments you are NOT singing teach it best)   3) subtract it frame by
//   frame   4) gently suppress the small leftover. Does nothing if there is no leak. Returns true if it changed y.
bool cancelBleed(Buf& y, const Buf& ref, const std::function<void(float)>& progress, float* bleedDbOut = nullptr, float* delayMsOut = nullptr) {
  const size_t n = std::min(y.size(), ref.size());
  if (n < (size_t)kRate * 3) return false;
  // 1) delay (GCC-PHAT at 6 kHz)
  const int R6 = 6000;
  Buf y6 = resample(y.data(), n, kRate, R6), r6 = resample(ref.data(), n, kRate, R6);
  const size_t m6 = std::min(y6.size(), r6.size());
  int P2 = 1; while ((size_t)P2 < m6 + 6000) P2 <<= 1;
  Fft fp(P2);
  Buf ar((size_t)P2, 0.0f), ai((size_t)P2, 0.0f), br((size_t)P2, 0.0f), bi((size_t)P2, 0.0f);
  std::copy(y6.begin(), y6.begin() + (long)m6, ar.begin()); std::copy(r6.begin(), r6.begin() + (long)m6, br.begin());
  fp.transform(ar.data(), ai.data(), false); fp.transform(br.data(), bi.data(), false);
  const int k0 = (int)(150.0 * P2 / R6), k1 = (int)(3000.0 * P2 / R6);
  for (int k = 0; k < P2; ++k) {
    const int kk = k <= P2 / 2 ? k : P2 - k;
    const double cr = (double)ar[k] * br[k] + (double)ai[k] * bi[k], ci = (double)ai[k] * br[k] - (double)ar[k] * bi[k];
    const double mag = std::sqrt(cr * cr + ci * ci) + 1e-20, wgt = (kk >= k0 && kk <= k1) ? std::pow(mag, -0.85) : 0.0;
    ar[k] = (float)(cr * wgt); ai[k] = (float)(ci * wgt);
  }
  fp.transform(ar.data(), ai.data(), true);
  const int LO = -(int)(0.2 * R6), HI = (int)(0.8 * R6);
  auto at = [&](int l) { return (double)ar[(size_t)(l >= 0 ? l : P2 + l)]; };
  double pk = -1e30, sum2 = 0; int pl = 0, cnt = 0;
  for (int l = LO; l <= HI; ++l) { const double v = at(l); if (v > pk) { pk = v; pl = l; } }
  for (int l = LO; l <= HI; ++l) { if (std::abs(l - pl) <= 4) continue; const double v = at(l); sum2 += v * v; ++cnt; }
  const double rms = std::sqrt(sum2 / std::max(1, cnt)) + 1e-20;
  if (pk / rms < 6.0) return false;                                  // no clear copy of the beat in the recording
  const int d = pl * (kRate / R6);                                   // delay in 48 kHz samples (+-4; the next step absorbs that)
  { Buf().swap(ar); Buf().swap(ai); Buf().swap(br); Buf().swap(bi); Buf().swap(y6); Buf().swap(r6); }
  Buf x(n, 0.0f);
  for (size_t i = 0; i < n; ++i) { const long j = (long)i - d; if (j >= 0 && (size_t)j < n) x[i] = ref[(size_t)j]; }
  // 2) learn the response
  const int N = 4096, H = 2048, BINS = N / 2 + 1;
  Fft fft(N);
  Buf w((size_t)N); for (int i = 0; i < N; ++i) w[(size_t)i] = (float)std::sin(kPi * i / N);          // sqrt-Hann (same window analysis + synthesis)
  Buf re((size_t)N), im((size_t)N), Xr((size_t)BINS), Xi((size_t)BINS), Yr((size_t)BINS), Yi((size_t)BINS);
  auto spec = [&](long s0) {                                         // spectra of x and y at once (x real part, y imaginary part)
    for (int i = 0; i < N; ++i) { const long p = s0 + i; const bool ok = p >= 0 && (size_t)p < n; re[(size_t)i] = ok ? x[(size_t)p] * w[(size_t)i] : 0.0f; im[(size_t)i] = ok ? y[(size_t)p] * w[(size_t)i] : 0.0f; }
    fft.transform(re.data(), im.data(), false);
    for (int k = 0; k < BINS; ++k) {
      const int k2 = (N - k) % N; const float zr = re[(size_t)k], zi = im[(size_t)k], zr2 = re[(size_t)k2], zi2 = im[(size_t)k2];
      Xr[(size_t)k] = 0.5f * (zr + zr2); Xi[(size_t)k] = 0.5f * (zi - zi2); Yr[(size_t)k] = 0.5f * (zi + zi2); Yi[(size_t)k] = -0.5f * (zr - zr2);
    }
  };
  const int frames = (int)((n + H - 1) / H) + 1, stride = std::max(1, frames / 900);
  std::vector<double> Sxx((size_t)BINS, 0.0), Syy((size_t)BINS, 0.0), Sxyr((size_t)BINS, 0.0), Sxyi((size_t)BINS, 0.0), Uxk((size_t)BINS, 0.0);
  double Wt = 0, Uyy = 0; int M = 0;
  for (int f = 0; f < frames; f += stride) {
    spec((long)f * H - H); double ex = 0, ey = 0;
    for (int k = 0; k < BINS; ++k) { ex += (double)Xr[(size_t)k] * Xr[(size_t)k] + (double)Xi[(size_t)k] * Xi[(size_t)k]; ey += (double)Yr[(size_t)k] * Yr[(size_t)k] + (double)Yi[(size_t)k] * Yi[(size_t)k]; }
    if (ex < 1e-3 || ey < 1e-9) continue;
    const double wf = 1.0 / (ey + 1e-6); Wt += wf; ++M; Uyy += ey;
    for (int k = 0; k < BINS; ++k) {
      const size_t q = (size_t)k; const double xx = (double)Xr[q] * Xr[q] + (double)Xi[q] * Xi[q];
      Uxk[q] += xx; Sxx[q] += wf * xx; Syy[q] += wf * ((double)Yr[q] * Yr[q] + (double)Yi[q] * Yi[q]);
      Sxyr[q] += wf * ((double)Yr[q] * Xr[q] + (double)Yi[q] * Xi[q]); Sxyi[q] += wf * ((double)Yi[q] * Xr[q] - (double)Yr[q] * Xi[q]);
    }
    if (progress) progress(0.15f * (float)f / (float)frames);
  }
  if (M < 8) return false;
  std::vector<float> Hr((size_t)BINS), Hi((size_t)BINS);
  const double Neff = std::max(4.0, M * 0.5); double pred = 0;
  for (int k = 0; k < BINS; ++k) {
    const size_t q = (size_t)k; const double sx = Sxx[q] + 1e-12 * Wt, hr = Sxyr[q] / sx, hi = Sxyi[q] / sx, h2 = hr * hr + hi * hi + 1e-30;
    const double resid = std::max(0.0, Syy[q] / Wt - (Sxyr[q] * Sxyr[q] + Sxyi[q] * Sxyi[q]) / (sx * Wt));
    const double variance = resid / (Neff * (sx / Wt) + 1e-30), shrink = std::max(0.0, 1.0 - variance / h2);
    Hr[q] = (float)(hr * shrink); Hi[q] = (float)(hi * shrink);
    pred += ((double)Hr[q] * Hr[q] + (double)Hi[q] * Hi[q]) * Uxk[q];
  }
  const double bleedDb = 10.0 * std::log10(pred / std::max(1e-12, Uyy) + 1e-12);   // predicted leak power vs the whole recording (dB)
  if (bleedDbOut) *bleedDbOut = (float)bleedDb;
  if (delayMsOut) *delayMsOut = 1000.0f * (float)d / (float)kRate;
  if (bleedDb < -28.0) return false;                                               // too small to matter: leave the recording untouched
  // 3) + 4) subtract and tidy up
  Buf out(n, 0.0f); Buf G((size_t)BINS); const float kap = 0.05f, gMin = 0.35f;
  for (int f = 0; f < frames; ++f) {
    spec((long)f * H - H);
    for (int k = 0; k < BINS; ++k) {
      const size_t q = (size_t)k;
      const float hxr = Hr[q] * Xr[q] - Hi[q] * Xi[q], hxi = Hr[q] * Xi[q] + Hi[q] * Xr[q], er = Yr[q] - hxr, ei = Yi[q] - hxi;
      const float p = hxr * hxr + hxi * hxi, e2 = er * er + ei * ei;
      G[q] = std::max(gMin, 1.0f - kap * p / (e2 + 1e-12f)); Yr[q] = er; Yi[q] = ei;
    }
    for (int k = 0; k < BINS; ++k) {
      const float g = (G[(size_t)std::max(0, k - 1)] + 2.0f * G[(size_t)k] + G[(size_t)std::min(BINS - 1, k + 1)]) * 0.25f;
      re[(size_t)k] = Yr[(size_t)k] * g; im[(size_t)k] = Yi[(size_t)k] * g;
    }
    for (int k = 1; k < N / 2; ++k) { re[(size_t)(N - k)] = re[(size_t)k]; im[(size_t)(N - k)] = -im[(size_t)k]; }
    im[0] = 0.0f; im[(size_t)N / 2] = 0.0f;
    fft.transform(re.data(), im.data(), true);
    const long s0 = (long)f * H - H;
    for (int i = 0; i < N; ++i) { const long p = s0 + i; if (p >= 0 && (size_t)p < n) out[(size_t)p] += re[(size_t)i] * w[(size_t)i] / (float)N; }
    if (progress) progress(0.15f + 0.85f * (float)f / (float)frames);
  }
  std::copy(out.begin(), out.end(), y.begin());
  return true;
}

} // namespace

Result process(const Params& prm, const PcmIn& voiceIn, const PcmIn* beatIn, const ProgressFn& cb) {
  if (!voiceIn.data || voiceIn.frames < voiceIn.rate / 10 || voiceIn.rate < 8000 || voiceIn.channels < 1)
    throw std::runtime_error("Voice recording is empty or too short");

  report(cb, 0.0f, 0.05f, 0.0f, "prepare");
  Buf v = toMono48(voiceIn);

  // latency compensation: positive = voice arrives late, move it earlier
  {
    const long off = std::lround(prm.voiceOffsetMs * 0.001 * kRate);
    if (off > 0) { if ((size_t)off < v.size()) v.erase(v.begin(), v.begin() + off); }
    else if (off < 0) v.insert(v.begin(), (size_t)(-off), 0.0f);
  }

  // ── 0. take the beat's leak out of the mic recording (before anything else touches the voice) ──
  if (prm.cancelBleed && beatIn && beatIn->data && beatIn->frames > beatIn->rate / 20 && beatIn->channels >= 1) {
    Buf bm = toMono48(*beatIn);
    if (!bm.empty()) {
      Buf ref(v.size()); for (size_t i = 0; i < ref.size(); ++i) ref[i] = bm[i % bm.size()];
      try { cancelBleed(v, ref, [&](float f) { report(cb, 0.05f, 0.2f, f, "Removing the beat from your recording"); }); } catch (...) { /* never block the song because of this step */ }
    }
  }

  // ── 1. noise removal on the whole take ──────────────────────────────────
  {
    int mode = prm.denoiseMode;
    if (mode == 1) mode = rnnoiseAvailable() ? 3 : 2;
    if (mode == 3 && !rnnoiseAvailable()) mode = 2;
    ProgressFn pf = [&](float f, const char*) { report(cb, 0.05f, 0.35f, f, "Removing background noise"); };
    if (mode == 3) rnnoiseDenoise(v, prm.denoiseStrength, pf);
    else if (mode == 2) spectralDenoise(v, prm.denoiseStrength, pf);
  }

  // ── 2. trim (same window is applied to the beat so they stay in sync) ───
  size_t tStart = (size_t)std::max(0.0f, prm.trimStartSec * kRate);
  size_t tEnd = prm.trimEndSec > 0 ? (size_t)(prm.trimEndSec * kRate) : v.size();
  tEnd = std::min(tEnd, v.size());
  if (tEnd < tStart + kRate / 10) { tStart = 0; tEnd = v.size(); }
  Buf seg(v.begin() + tStart, v.begin() + tEnd);
  v.clear(); v.shrink_to_fit();

  if (prm.noiseGate) noiseGate(seg, kRate);

  // ── 3. autotune and/or fixed pitch effect ───────────────────────────────
  Result res;
  const bool fixedShift = std::fabs(prm.pitchSemitones) > 0.01f;
  if ((prm.autotune || fixedShift) && seg.size() > 4096) {
    PitchTrack track;
    std::vector<float> corr;
    if (prm.autotune) {
      track = trackPitch(seg, [&](float f, const char*) { report(cb, 0.35f, 0.45f, f, "Analysing pitch"); });
      AutoTuneSettings as;
      as.scaleRoot = prm.scaleRoot; as.scaleType = prm.scaleType;
      as.strength = prm.tuneStrength; as.speedMs = prm.tuneSpeedMs;
      corr = computeCorrections(track, as, &res.detectedKeyRoot, &res.detectedKeyType);
    }
    const size_t frames = seg.size() / kHop + 2;
    std::vector<float> ratios(frames);
    for (size_t i = 0; i < frames; ++i) {
      const float c = i < corr.size() ? corr[i] : 0.0f;
      ratios[i] = std::pow(2.0f, (c + prm.pitchSemitones) / 12.0f);
    }
    seg = pitchShift(seg, ratios, [&](float f, const char*) { report(cb, 0.45f, 0.65f, f, "Tuning voice"); });
  }

  // ── 4. tone + dynamics ──────────────────────────────────────────────────
  report(cb, 0.65f, 0.7f, 0.0f, "Shaping tone");
  highpass(seg, prm.highpassHz, kRate);
  lowpass(seg, prm.lowpassHz, kRate);
  if (prm.compress) compress(seg, kRate);
  peaking(seg, 3200.0f, 0.9f, prm.presenceDb, kRate);
  if (prm.reverse) std::reverse(seg.begin(), seg.end());

  // ── 5. stereo, space ────────────────────────────────────────────────────
  const size_t voiceLen = seg.size();
  const size_t tail = (size_t)(std::max(0.0f, prm.tailSec) * kRate);
  seg.resize(voiceLen + tail, 0.0f);                      // room for echo/reverb to ring out
  StereoBuf vox = makeStereo(seg, prm.chorus, kRate);
  seg.clear(); seg.shrink_to_fit();
  echo(vox, prm.echoMs, prm.echoMix, kRate);
  report(cb, 0.7f, 0.85f, 0.5f, "Adding space");
  reverb(vox, prm.reverbMix, kRate);

  // ── 6. beat: same time window, looped like the in-app player does ───────
  // The beat is read in place (index wraps around) — no extra full-length copy is made.
  const size_t outLen = vox.l.size();
  StereoBuf beat48;
  bool haveBeat = false;
  if (beatIn && beatIn->data && beatIn->frames > beatIn->rate / 20 && beatIn->channels >= 1) {
    beat48 = toStereo48(*beatIn);
    haveBeat = !beat48.l.empty();
    if (haveBeat && prm.autoBalance) {                    // the "pocket": the beat steps back exactly where the voice lives (same cuts as the website)
      for (Buf* ch : {&beat48.l, &beat48.r}) { peaking(*ch, 2800.0f, 0.9f, -3.5f, kRate); peaking(*ch, 1200.0f, 0.9f, -1.5f, kRate); peaking(*ch, 350.0f, 0.9f, -2.0f, kRate); }
    }
  }
  const size_t beatLen = beat48.l.size();
  auto beatIdx = [&](size_t p) { return (tStart + p) % beatLen; };

  // ── 7. mix ──────────────────────────────────────────────────────────────
  report(cb, 0.85f, 0.95f, 0.0f, "Mixing");
  float vScale = prm.voiceGain, bScale = prm.beatGain;
  if (haveBeat && prm.autoBalance) {
    const float vDb = activeRmsDb(vox.l.data(), voiceLen, kRate, -45.0f);
    // loudness of the part of the beat that will actually be heard (same loop window)
    const size_t blk = (size_t)(0.020 * kRate);
    double acc = 0; size_t cnt = 0;
    for (size_t p = 0; p + blk <= voiceLen; p += blk) {
      double e = 0;
      for (size_t j = 0; j < blk; ++j) { const float v = beat48.l[beatIdx(p + j)]; e += (double)v * v; }
      e /= blk;
      if (10.0 * std::log10(e + 1e-12) > -60.0) { acc += e; ++cnt; }
    }
    const float bDb = cnt ? 10.0f * std::log10((float)(acc / cnt) + 1e-12f) : -90.0f;
    if (vDb > -80.0f && bDb > -80.0f) {
      const float adjDb = std::max(-18.0f, std::min(18.0f, bDb + 4.5f - vDb));   // voice 4.5 dB over the beat: the singer is the star (was 1.5 dB, which let the beat cover the voice)
      vScale *= dbToLin(adjDb);
    }
  }
  Result out = res;
  out.frames = (int)outLen;
  out.pcm.resize(outLen * 2);
  const bool fadeTail = tail > (size_t)(kRate / 5);          // beat fades out over the tail so the song ends
  float peak = 1e-9f;
  for (size_t i = 0; i < outLen; ++i) {
    float l = vox.l[i] * vScale, r = vox.r[i] * vScale;
    if (haveBeat) {
      float g = bScale;
      if (fadeTail && i >= voiceLen) g *= 0.5f * (1.0f + std::cos((float)kPi * (float)(i - voiceLen) / (float)tail));
      const size_t k = beatIdx(i);
      l += beat48.l[k] * g; r += beat48.r[k] * g;
    }
    out.pcm[2 * i] = l; out.pcm[2 * i + 1] = r;
    peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
  }
  vox.l.clear(); vox.l.shrink_to_fit(); vox.r.clear(); vox.r.shrink_to_fit();

  // ── 8. master: normalise / limit, fades ─────────────────────────────────
  float g = 1.0f;
  if (prm.normalize) g = std::min(16.0f, 0.891f / peak);          // -1 dBFS
  else if (peak > 0.98f) g = 0.98f / peak;
  const size_t fi = std::min<size_t>(outLen, (size_t)(0.010 * kRate));
  const size_t fo = std::min<size_t>(outLen, (size_t)(0.030 * kRate));
  for (size_t i = 0; i < outLen; ++i) {
    float k = g;
    if (i < fi) k *= (float)i / (float)fi;
    if (i + fo > outLen) k *= (float)(outLen - i) / (float)fo;
    out.pcm[2 * i] *= k; out.pcm[2 * i + 1] *= k;
  }
  report(cb, 0.95f, 1.0f, 1.0f, "Done");
  return out;
}

} // namespace lva
