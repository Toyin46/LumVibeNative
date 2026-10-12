#include "lumvibe/audio/Engine.h"
#include "lumvibe/audio/Denoiser.h"
#include "lumvibe/audio/Effects.h"
#include "lumvibe/audio/Pitch.h"
#include "lumvibe/audio/Resampler.h"
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
  return d;
}

void Params::defaultsToArray(float* out, int n) {
  Params d;
  const float v[LVA_P_COUNT] = {
    (float)d.denoiseMode, d.denoiseStrength, (float)d.noiseGate, (float)d.autotune,
    (float)d.scaleRoot, (float)d.scaleType, d.tuneStrength, d.tuneSpeedMs, d.pitchSemitones,
    d.highpassHz, d.lowpassHz, d.presenceDb, (float)d.compress, d.reverbMix, d.echoMix, d.echoMs,
    (float)d.chorus, (float)d.reverse, d.trimStartSec, d.trimEndSec, d.voiceGain, d.beatGain,
    d.voiceOffsetMs, (float)d.normalize, d.tailSec, (float)d.autoBalance};
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
      const float adjDb = std::max(-18.0f, std::min(18.0f, bDb + 1.5f - vDb));   // voice 1.5 dB over the beat
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
