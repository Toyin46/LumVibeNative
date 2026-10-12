// LumVibe Audio Engine — the ONE C interface every platform calls.
//   Android  -> jni_audio_bridge.cpp  -> lva_process()
//   iOS      -> LVAAudioBridge.mm     -> lva_process()
//   Web/WASM -> lumvibeAudioWeb.ts    -> _lva_process()
// Plain C on purpose: no C++ types cross the boundary, so JNI, Swift/ObjC and
// WebAssembly all talk to the exact same function with the same arguments.
//
// Audio in:  raw float PCM, interleaved, any sample rate, 1 or 2 channels
//            (the platform decodes mp3/m4a/wav to PCM — the engine never
//            needs to know what format the recording was in).
// Audio out: float PCM, interleaved STEREO, 48000 Hz. The platform encodes it.
#ifndef LVA_H
#define LVA_H

#ifdef __cplusplus
extern "C" {
#endif

#if defined(_WIN32)
#  define LVA_API __declspec(dllexport)
#else
#  define LVA_API __attribute__((visibility("default")))
#endif

// ── Parameter indices. The params array is a flat float array so JNI, Swift
// and JS all pass it the same way. KEEP IN SYNC with LVA_PARAM in audioStudio.ts
// (tests/check_param_sync.py fails if they drift). Missing trailing entries
// fall back to the defaults from lva_default_params().
enum {
  LVA_P_DENOISE_MODE = 0,     // 0 off, 1 auto (RNNoise if built, else spectral), 2 spectral, 3 RNNoise
  LVA_P_DENOISE_STRENGTH,     // 0..1
  LVA_P_NOISE_GATE,           // 0/1  extra gate on residual noise between phrases
  LVA_P_AUTOTUNE,             // 0/1
  LVA_P_SCALE_ROOT,           // -1 auto-detect key, else 0..11 (C=0)
  LVA_P_SCALE_TYPE,           // 0 auto, 1 chromatic, 2 major, 3 minor, 4 major pent, 5 minor pent
  LVA_P_TUNE_STRENGTH,        // 0..1  (1 = full snap)
  LVA_P_TUNE_SPEED_MS,        // 0 = instant "T-Pain", ~60 = natural
  LVA_P_PITCH_SEMITONES,      // fixed voice-effect shift (deep / chipmunk ...)
  LVA_P_HIGHPASS_HZ,          // <=20 = off
  LVA_P_LOWPASS_HZ,           // >=20000 = off
  LVA_P_PRESENCE_DB,          // boost at ~3.2 kHz
  LVA_P_COMPRESS,             // 0/1
  LVA_P_REVERB_MIX,           // 0..1
  LVA_P_ECHO_MIX,             // 0..1
  LVA_P_ECHO_MS,              // delay time
  LVA_P_CHORUS,               // 0/1
  LVA_P_REVERSE,              // 0/1  (voice only)
  LVA_P_TRIM_START_SEC,
  LVA_P_TRIM_END_SEC,         // 0 = to the end
  LVA_P_VOICE_GAIN,
  LVA_P_BEAT_GAIN,
  LVA_P_VOICE_OFFSET_MS,      // latency compensation: >0 moves the voice EARLIER
  LVA_P_NORMALIZE,            // 0/1  final peak-normalise to -1 dBFS
  LVA_P_TAIL_SEC,             // ring-out after the voice ends (reverb/echo/beat fade)
  LVA_P_AUTO_BALANCE,         // 0/1  automatically sit the voice on top of the beat
  LVA_P_CANCEL_BLEED,         // 0/1  take the beat out of the mic recording (when the beat leaked from a speaker into the mic)
  LVA_P_COUNT
};

typedef void (*lva_progress_cb)(float fraction, const char* stage, void* user);

// Returns 0 on success. On success *outPcm is a malloc'd buffer you MUST
// release with lva_free(). Non-zero: see lva_last_error().
LVA_API int lva_process(const float* params, int paramCount,
                        const float* voice, int voiceFrames, int voiceRate, int voiceChannels,
                        const float* beat,  int beatFrames,  int beatRate,  int beatChannels,
                        lva_progress_cb cb, void* user,
                        float** outPcm, int* outFrames, int* outRate, int* outChannels);

LVA_API void        lva_free(float* p);
LVA_API const char* lva_last_error(void);
LVA_API int         lva_param_count(void);
LVA_API void        lva_default_params(float* out, int count);
LVA_API int         lva_has_rnnoise(void);   // 1 if the RNNoise denoiser was compiled in
LVA_API const char* lva_version(void);

#ifdef __cplusplus
}
#endif
#endif
