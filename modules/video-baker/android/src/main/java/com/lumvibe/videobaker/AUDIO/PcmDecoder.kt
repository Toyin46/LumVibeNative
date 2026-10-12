package com.lumvibe.videobaker

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteOrder

// NOT COMPILED OR TESTED ON A DEVICE. Decodes any audio file Android can play
// (m4a, mp3, wav, ogg...) to 16-bit interleaved PCM using only built-in android.media APIs
// (same "no third-party media library" rule as the rest of this module).
class DecodedPcm(val samples: ShortArray, val length: Int, val sampleRate: Int, val channels: Int)

object PcmDecoder {

    fun decode(path: String): DecodedPcm {
        val extractor = MediaExtractor()
        extractor.setDataSource(path)

        var trackIndex = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) { trackIndex = i; format = f; break }
        }
        if (trackIndex < 0 || format == null) { extractor.release(); throw IllegalStateException("No audio track found in $path") }
        extractor.selectTrack(trackIndex)

        var sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val durationUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
        // Pre-size from the container's duration so we rarely have to grow (growing copies the array).
        var capacity = (((durationUs / 1_000_000.0) + 2.0) * sampleRate * channels).toLong()
            .coerceAtLeast(sampleRate.toLong() * channels * 5).coerceAtMost(Int.MAX_VALUE.toLong() - 1024).toInt()
        var out = ShortArray(capacity)
        var length = 0
        var floatPcm = false

        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var idleSpins = 0

        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val buf = codec.getInputBuffer(inIdx)!!
                        val n = extractor.readSampleData(buf, 0)
                        if (n < 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIdx, 0, n, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIdx >= 0 -> {
                        idleSpins = 0
                        if (info.size > 0) {
                            val bb = codec.getOutputBuffer(outIdx)!!
                            bb.position(info.offset); bb.limit(info.offset + info.size)
                            bb.order(ByteOrder.nativeOrder())
                            val count = if (floatPcm) info.size / 4 else info.size / 2
                            if (length + count > out.size) {                 // grow by 1.5x
                                val newCap = maxOf((out.size * 3L / 2).toInt(), length + count)
                                out = out.copyOf(newCap)
                            }
                            if (floatPcm) {
                                val fb = bb.asFloatBuffer()
                                for (i in 0 until count) {
                                    val s = (fb.get() * 32767f).toInt().coerceIn(-32768, 32767)
                                    out[length + i] = s.toShort()
                                }
                            } else {
                                bb.asShortBuffer().get(out, length, count)
                            }
                            length += count
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val nf = codec.outputFormat
                        sampleRate = nf.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        floatPcm = nf.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
                    }
                    outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                        if (inputDone && ++idleSpins > 500) throw IllegalStateException("Audio decoder stalled")
                    }
                }
            }
        } finally {
            try { codec.stop() } catch (_: Throwable) {}
            codec.release()
            extractor.release()
        }
        if (length < channels * sampleRate / 10) throw IllegalStateException("Audio file is empty or too short")
        // Keep the (possibly oversized) array — we pass `length` along instead of copying it.
        return DecodedPcm(out, length - (length % channels), sampleRate, channels)
    }
}
