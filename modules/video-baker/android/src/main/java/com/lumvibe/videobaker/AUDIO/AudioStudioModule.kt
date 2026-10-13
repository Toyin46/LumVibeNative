package com.lumvibe.videobaker

import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.nio.ByteOrder

// NOT COMPILED OR TESTED ON A DEVICE. Same Promise + coroutine pattern as VideoBakerModule
// (your note there explains why the suspend-lambda style failed to compile).
class AudioStudioModule : Module() {

    private fun cleanPath(p: String): String =
        if (p.startsWith("file://")) (Uri.parse(p).path ?: p.removePrefix("file://")) else p

    override fun definition() = ModuleDefinition {
        Name("LumVibeAudioStudio")

        // true when RNNoise was compiled in (better noise removal), false = built-in denoiser
        Function("hasNoiseModel") {
            try { AudioStudioNative.nativeHasRnnoise() } catch (_: Throwable) { false }
        }

        // STAGE C: same finished song as the website's Done button (no knobs).
        AsyncFunction("masterStudioSong") { voicePath: String, beatPath: String?, latencyMs: Double, outputPath: String, promise: Promise ->
            CoroutineScope(Dispatchers.Default).launch {
                var result: java.nio.ByteBuffer? = null
                try {
                    val t0 = System.currentTimeMillis()
                    val voice = PcmDecoder.decode(cleanPath(voicePath))
                    val beat = if (!beatPath.isNullOrEmpty()) PcmDecoder.decode(cleanPath(beatPath)) else null

                    result = AudioStudioNative.nativeMasterSong(
                        latencyMs.toFloat(),
                        voice.samples, voice.length, voice.sampleRate, voice.channels,
                        beat?.samples, beat?.length ?: 0, beat?.sampleRate ?: 0, beat?.channels ?: 0,
                    )
                    if (result == null) {
                        val msg = AudioStudioNative.nativeLastError()
                        if (msg == "SILENT_VOICE") { promise.reject("ERR_SILENT_VOICE", "We couldn't hear your voice in that recording.", null); return@launch }
                        throw IllegalStateException(msg.ifEmpty { "Audio processing failed" })
                    }

                    val frames = result.capacity() / (4 * 2)
                    val fb = result.order(ByteOrder.nativeOrder()).asFloatBuffer()
                    val outFile = cleanPath(outputPath)
                    AacEncoder.encode(fb, frames, 48000, 2, outFile)

                    promise.resolve(mapOf(
                        "uri" to "file://$outFile",
                        "durationSec" to frames / 48000.0,
                        "elapsedMs" to (System.currentTimeMillis() - t0),
                    ))
                } catch (t: Throwable) {
                    promise.reject("ERR_AUDIO_STUDIO", t.message ?: "Audio studio failed", t)
                } finally {
                    try { if (result != null) AudioStudioNative.nativeRelease(result) } catch (_: Throwable) {}
                }
            }
        }

        AsyncFunction("bakeAudioStudio") { voicePath: String, beatPath: String?, params: List<Double>, outputPath: String, promise: Promise ->
            CoroutineScope(Dispatchers.Default).launch {
                var result: java.nio.ByteBuffer? = null
                try {
                    val t0 = System.currentTimeMillis()
                    val voice = PcmDecoder.decode(cleanPath(voicePath))
                    val beat = if (!beatPath.isNullOrEmpty()) PcmDecoder.decode(cleanPath(beatPath)) else null

                    val p = FloatArray(params.size) { params[it].toFloat() }
                    result = AudioStudioNative.nativeProcess(
                        p,
                        voice.samples, voice.length, voice.sampleRate, voice.channels,
                        beat?.samples, beat?.length ?: 0, beat?.sampleRate ?: 0, beat?.channels ?: 0,
                    )
                    if (result == null) throw IllegalStateException(AudioStudioNative.nativeLastError().ifEmpty { "Audio processing failed" })

                    val frames = result.capacity() / (4 * 2)
                    val fb = result.order(ByteOrder.nativeOrder()).asFloatBuffer()
                    val outFile = cleanPath(outputPath)
                    AacEncoder.encode(fb, frames, 48000, 2, outFile)

                    promise.resolve(mapOf(
                        "uri" to "file://$outFile",
                        "durationSec" to frames / 48000.0,
                        "elapsedMs" to (System.currentTimeMillis() - t0),
                    ))
                } catch (t: Throwable) {
                    promise.reject("ERR_AUDIO_STUDIO", t.message ?: "Audio studio failed", t)
                } finally {
                    try { if (result != null) AudioStudioNative.nativeRelease(result) } catch (_: Throwable) {}
                }
            }
        }
    }
}
