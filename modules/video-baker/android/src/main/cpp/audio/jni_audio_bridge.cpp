// NOT COMPILED OR TESTED ON A DEVICE (written without an Android toolchain; the C++ core
// it calls IS compiled and tested — see audio-core/tests). Mirrors the naming style of
// jni_bridge.cpp: Java_com_lumvibe_videobaker_<Class>_<method>.
//
// Memory design: the Kotlin side hands over 16-bit PCM (half the Java-heap footprint of
// floats) and gets the result back as a DIRECT ByteBuffer — native memory, no Java-heap
// copy of a ~70 MB mix. Kotlin must call nativeRelease() when done with it.
#include <jni.h>
#include <string>
#include <vector>
#include "lumvibe/audio/lva.h"

namespace {

bool shortsToFloat(JNIEnv* env, jshortArray arr, jint count, std::vector<float>& out) {
  if (!arr || count <= 0) return false;
  out.resize((size_t)count);
  jshort* p = (jshort*)env->GetPrimitiveArrayCritical(arr, nullptr);
  if (!p) { out.clear(); return false; }
  for (jint i = 0; i < count; ++i) out[(size_t)i] = (float)p[i] * (1.0f / 32768.0f);   // no JNI calls in here
  env->ReleasePrimitiveArrayCritical(arr, p, JNI_ABORT);
  return true;
}

std::string g_lastError;

} // namespace

extern "C" {

JNIEXPORT jobject JNICALL
Java_com_lumvibe_videobaker_AudioStudioNative_nativeProcess(
    JNIEnv* env, jobject, jfloatArray params,
    jshortArray voice, jint voiceSamples, jint voiceRate, jint voiceChannels,
    jshortArray beat, jint beatSamples, jint beatRate, jint beatChannels) {

  g_lastError.clear();
  std::vector<float> p;
  {
    const jsize n = env->GetArrayLength(params);
    p.resize((size_t)n);
    env->GetFloatArrayRegion(params, 0, n, p.data());
  }
  std::vector<float> v, b;
  if (!shortsToFloat(env, voice, voiceSamples, v)) { g_lastError = "voice recording could not be read"; return nullptr; }
  const bool haveBeat = shortsToFloat(env, beat, beatSamples, b);

  float* out = nullptr; int frames = 0, rate = 0, ch = 0;
  const int rc = lva_process(p.data(), (int)p.size(),
                             v.data(), (int)(v.size() / (size_t)voiceChannels), voiceRate, voiceChannels,
                             haveBeat ? b.data() : nullptr, haveBeat ? (int)(b.size() / (size_t)beatChannels) : 0, beatRate, beatChannels,
                             nullptr, nullptr, &out, &frames, &rate, &ch);
  if (rc != 0 || !out) { g_lastError = lva_last_error(); return nullptr; }
  return env->NewDirectByteBuffer(out, (jlong)frames * ch * (jlong)sizeof(float));
}

// STAGE C: the website's whole mastering pipeline in one call (see lva_master_song in lva.h).
JNIEXPORT jobject JNICALL
Java_com_lumvibe_videobaker_AudioStudioNative_nativeMasterSong(
    JNIEnv* env, jobject, jfloat latencyMs,
    jshortArray voice, jint voiceSamples, jint voiceRate, jint voiceChannels,
    jshortArray beat, jint beatSamples, jint beatRate, jint beatChannels) {

  g_lastError.clear();
  std::vector<float> v, b;
  if (!shortsToFloat(env, voice, voiceSamples, v)) { g_lastError = "voice recording could not be read"; return nullptr; }
  const bool haveBeat = shortsToFloat(env, beat, beatSamples, b);

  float* out = nullptr; int frames = 0, rate = 0, ch = 0;
  const int rc = lva_master_song(latencyMs,
                                 v.data(), (int)(v.size() / (size_t)voiceChannels), voiceRate, voiceChannels,
                                 haveBeat ? b.data() : nullptr, haveBeat ? (int)(b.size() / (size_t)beatChannels) : 0, beatRate, beatChannels,
                                 nullptr, nullptr, &out, &frames, &rate, &ch);
  if (rc != 0 || !out) { g_lastError = lva_last_error(); return nullptr; }
  return env->NewDirectByteBuffer(out, (jlong)frames * ch * (jlong)sizeof(float));
}

JNIEXPORT void JNICALL
Java_com_lumvibe_videobaker_AudioStudioNative_nativeRelease(JNIEnv* env, jobject, jobject buffer) {
  if (!buffer) return;
  void* addr = env->GetDirectBufferAddress(buffer);
  if (addr) lva_free((float*)addr);
}

JNIEXPORT jstring JNICALL
Java_com_lumvibe_videobaker_AudioStudioNative_nativeLastError(JNIEnv* env, jobject) {
  return env->NewStringUTF(g_lastError.c_str());
}

JNIEXPORT jboolean JNICALL
Java_com_lumvibe_videobaker_AudioStudioNative_nativeHasRnnoise(JNIEnv*, jobject) {
  return lva_has_rnnoise() ? JNI_TRUE : JNI_FALSE;
}

} // extern "C"
