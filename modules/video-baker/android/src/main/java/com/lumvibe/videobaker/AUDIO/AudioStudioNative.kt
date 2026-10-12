package com.lumvibe.videobaker

import java.nio.ByteBuffer

// NOT COMPILED OR TESTED ON A DEVICE. Thin JNI shell around audio-core's lva_process().
object AudioStudioNative {
    init { System.loadLibrary("lumvibe_audio") }

    /** Returns a direct buffer of interleaved float32 STEREO @ 48 kHz, or null on failure
     *  (see nativeLastError). Call nativeRelease() on it when finished. */
    external fun nativeProcess(
        params: FloatArray,
        voice: ShortArray, voiceSamples: Int, voiceRate: Int, voiceChannels: Int,
        beat: ShortArray?, beatSamples: Int, beatRate: Int, beatChannels: Int,
    ): ByteBuffer?

    external fun nativeRelease(buffer: ByteBuffer)
    external fun nativeLastError(): String
    external fun nativeHasRnnoise(): Boolean
}
