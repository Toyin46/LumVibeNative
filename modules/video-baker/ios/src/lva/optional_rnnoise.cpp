// RNNoise adapter. Compiled to a real denoiser ONLY when LVA_WITH_RNNOISE is
// defined and the RNNoise sources are in third_party/rnnoise (see README_AUDIO.md).
// Without it the engine silently uses the built-in spectral denoiser instead.
//
// STATUS: written against RNNoise's public API (rnnoise.h):
//     DenoiseState* rnnoise_create(RNNModel* model);   // NULL = built-in model
//     float rnnoise_process_frame(DenoiseState*, float* out, const float* in);
//     void  rnnoise_destroy(DenoiseState*);
//     int   rnnoise_get_frame_size();                   // 480 samples @ 48 kHz
// Samples are float but in 16-bit range (+-32768). NOT compiled in the build
// sandbox this was written in (the library could not be downloaded there).
#include "lumvibe/audio/Denoiser.h"

#ifdef LVA_WITH_RNNOISE
extern "C" {
#include "rnnoise.h"
}
#endif

namespace lva {

#ifdef LVA_WITH_RNNOISE

bool rnnoiseAvailable() { return true; }

void rnnoiseDenoise(Buf& x, float strength, const ProgressFn& progress) {
  strength = std::min(1.0f, std::max(0.0f, strength));
  if (x.empty() || strength <= 0.001f) return;
  DenoiseState* st = rnnoise_create(nullptr);
  if (!st) return;
  const int F = rnnoise_get_frame_size();               // 480
  const size_t n = x.size();
  const size_t frames = (n + F - 1) / F;
  std::vector<float> in(F), out(F);
  // RNNoise has ~1 frame of look-ahead state; prime it with the first frame
  // and drop the first output frame so the result stays time-aligned.
  Buf res(frames * F + F, 0.0f);
  for (size_t f = 0; f < frames + 1; ++f) {
    for (int i = 0; i < F; ++i) {
      const size_t p = f * F + i;
      in[i] = (p < n ? x[p] : 0.0f) * 32768.0f;
    }
    rnnoise_process_frame(st, out.data(), in.data());
    for (int i = 0; i < F; ++i) res[f * F + i] = out[i] / 32768.0f;
    if (progress && (f & 255) == 0) progress((float)f / (float)frames, "denoise");
  }
  rnnoise_destroy(st);
  // Time alignment: RNNoise's output frame f corresponds to input frame f
  // (it does not delay by a frame in the public API), so copy straight over,
  // blending wet/dry by strength.
  for (size_t i = 0; i < n; ++i) x[i] = (1.0f - strength) * x[i] + strength * res[i];
}

#else

bool rnnoiseAvailable() { return false; }
void rnnoiseDenoise(Buf&, float, const ProgressFn&) {}

#endif

} // namespace lva
