#include "lumvibe/audio/Engine.h"
#include "lumvibe/audio/Denoiser.h"
#include "lumvibe/audio/ProMix.h"
#include <cstdlib>
#include <cstring>
#include <exception>
#include <string>

namespace {
thread_local std::string g_err;
}

extern "C" {

int lva_process(const float* params, int paramCount,
                const float* voice, int voiceFrames, int voiceRate, int voiceChannels,
                const float* beat, int beatFrames, int beatRate, int beatChannels,
                lva_progress_cb cb, void* user,
                float** outPcm, int* outFrames, int* outRate, int* outChannels) {
  g_err.clear();
  if (!outPcm || !outFrames || !outRate || !outChannels) { g_err = "null output pointer"; return 1; }
  *outPcm = nullptr; *outFrames = 0; *outRate = lva::kRate; *outChannels = 2;
  try {
    const lva::Params prm = lva::Params::fromArray(params, paramCount);
    lva::PcmIn v{voice, voiceFrames, voiceRate, voiceChannels};
    lva::PcmIn b{beat, beatFrames, beatRate, beatChannels};
    lva::ProgressFn pf;
    if (cb) pf = [cb, user](float f, const char* s) { cb(f, s, user); };
    lva::Result r = lva::process(prm, v, (beat && beatFrames > 0) ? &b : nullptr, pf);
    float* mem = (float*)std::malloc(r.pcm.size() * sizeof(float));
    if (!mem) { g_err = "out of memory"; return 3; }
    std::memcpy(mem, r.pcm.data(), r.pcm.size() * sizeof(float));
    *outPcm = mem; *outFrames = r.frames;
    return 0;
  } catch (const std::bad_alloc&) {
    g_err = "out of memory (try a shorter recording)"; return 3;
  } catch (const std::exception& e) {
    g_err = e.what(); return 2;
  } catch (...) {
    g_err = "unknown error"; return 4;
  }
}

int lva_master_song(float latencyMs,
                    const float* voice, int voiceFrames, int voiceRate, int voiceChannels,
                    const float* beat, int beatFrames, int beatRate, int beatChannels,
                    lva_progress_cb cb, void* user,
                    float** outPcm, int* outFrames, int* outRate, int* outChannels) {
  g_err.clear();
  if (!outPcm || !outFrames || !outRate || !outChannels) { g_err = "null output pointer"; return 1; }
  *outPcm = nullptr; *outFrames = 0; *outRate = lva::kRate; *outChannels = 2;
  try {
    lva::PcmIn v{voice, voiceFrames, voiceRate, voiceChannels};
    lva::PcmIn b{beat, beatFrames, beatRate, beatChannels};
    lva::ProgressFn pf;
    if (cb) pf = [cb, user](float f, const char* s) { cb(f, s, user); };
    lva::Result r = lva::masterSong(v, (beat && beatFrames > 0) ? &b : nullptr, latencyMs, pf);
    float* mem = (float*)std::malloc(r.pcm.size() * sizeof(float));
    if (!mem) { g_err = "out of memory"; return 3; }
    std::memcpy(mem, r.pcm.data(), r.pcm.size() * sizeof(float));
    *outPcm = mem; *outFrames = r.frames;
    return 0;
  } catch (const std::bad_alloc&) {
    g_err = "out of memory (try a shorter recording)"; return 3;
  } catch (const std::exception& e) {
    g_err = e.what();
    return g_err == "SILENT_VOICE" ? 5 : 2;
  } catch (...) {
    g_err = "unknown error"; return 4;
  }
}

void lva_free(float* p) { std::free(p); }
const char* lva_last_error(void) { return g_err.c_str(); }
int lva_param_count(void) { return LVA_P_COUNT; }
void lva_default_params(float* out, int count) { lva::Params::defaultsToArray(out, count); }
int lva_has_rnnoise(void) { return lva::rnnoiseAvailable() ? 1 : 0; }
const char* lva_version(void) { return "lva-1.0.0"; }

} // extern "C"
