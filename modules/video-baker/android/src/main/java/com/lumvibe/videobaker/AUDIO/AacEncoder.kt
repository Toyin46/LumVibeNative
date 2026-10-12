package com.lumvibe.videobaker

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteOrder
import java.nio.FloatBuffer

// NOT COMPILED OR TESTED ON A DEVICE. Encodes float PCM to an .m4a (AAC-LC) file with built-in
// MediaCodec + MediaMuxer — no FFmpeg, nothing to download.
object AacEncoder {

    fun encode(pcm: FloatBuffer, frames: Int, sampleRate: Int, channels: Int, outPath: String, bitrate: Int = 192_000) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()

        File(outPath).apply { parentFile?.mkdirs(); if (exists()) delete() }
        val muxer = MediaMuxer(outPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var track = -1
        var muxerStarted = false

        val info = MediaCodec.BufferInfo()
        var sent = 0L                       // frames fed to the encoder so far
        var inputDone = false
        var outputDone = false
        fun ptsUs(framesDone: Long) = framesDone * 1_000_000L / sampleRate

        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val ib = codec.getInputBuffer(inIdx)!!
                        ib.clear()
                        val maxFrames = ib.remaining() / (2 * channels)
                        val n = minOf(maxFrames.toLong(), frames - sent).toInt()
                        if (n <= 0) {
                            codec.queueInputBuffer(inIdx, 0, 0, ptsUs(sent), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val sb = ib.order(ByteOrder.nativeOrder()).asShortBuffer()
                            val base = (sent * channels).toInt()
                            for (k in 0 until n * channels) {
                                val v = (pcm.get(base + k) * 32767f).toInt().coerceIn(-32768, 32767)
                                sb.put(v.toShort())
                            }
                            codec.queueInputBuffer(inIdx, 0, n * channels * 2, ptsUs(sent), 0)
                            sent += n
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        track = muxer.addTrack(codec.outputFormat)
                        muxer.start(); muxerStarted = true
                    }
                    outIdx >= 0 -> {
                        val ob = codec.getOutputBuffer(outIdx)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && muxerStarted) {
                            ob.position(info.offset); ob.limit(info.offset + info.size)
                            muxer.writeSampleData(track, ob, info)
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
        } finally {
            try { codec.stop() } catch (_: Throwable) {}
            codec.release()
            try { if (muxerStarted) muxer.stop() } catch (_: Throwable) {}
            muxer.release()
        }
    }
}
