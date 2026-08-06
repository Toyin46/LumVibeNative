package com.lumvibe.videobaker

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

/**
* Decodes the input's audio track ONCE, up front, into a fixed-resolution RMS
* amplitude envelope (one value every [bucketMs]). VOICE_HALO, SILENCE_RIPPLE,
* DEPTH_BLOOM's audio-pulse, and THERMAL_PULSE's "breath rhythm" all read from
* this same envelope via amplitudeAt(elapsedSec) — one shared decode pass
* rather than each effect re-decoding audio itself.
*
* WHY A SEPARATE PASS, NOT INLINE WITH VideoTranscoder'S AUDIO PASSTHROUGH:
* VideoTranscoder currently copies the audio track through as compressed bytes
* (MediaExtractor -> MediaMuxer, no decode) because that's cheap and lossless.
* Getting amplitude requires actually decoding to PCM, which is extra work we
* only want to pay for when an audio-reactive effect is selected. This class
* does that decode independently, before the main video transcode loop starts,
* so VideoTranscoder's existing passthrough path is untouched for everyone
* NOT using an audio-reactive effect.
*
* If the input has no audio track, [analyze] returns an empty reader and
* amplitudeAt() always returns 0f — audio-reactive effects should treat that
* as "silent," which for SILENCE_RIPPLE specifically means "constantly
* rippling." That's a real edge case to test with a muted input clip.
*/
class AudioAmplitudeReader private constructor(
    private val envelope: FloatArray, // normalized 0..1 RMS per bucket
    private val bucketMs: Int
) {
    /** Looks up the envelope value nearest [elapsedSec]. Clamped to the array bounds
     *  so times past the audio's end (e.g. video has a longer silent tail) return the
     *  last known value rather than crashing. */
    fun amplitudeAt(elapsedSec: Float): Float {
        if (envelope.isEmpty()) return 0f
        val idx = ((elapsedSec * 1000f) / bucketMs).toInt().coerceIn(0, envelope.size - 1)
        return envelope[idx]
    }

    companion object {
        private const val DEFAULT_BUCKET_MS = 33 // ~30 buckets/sec, matches typical video fps

        /**
         * Runs the full decode. Call this BEFORE the main render loop in
         * VideoTranscoder — it opens its own MediaExtractor instance on [inputPath]
         * (separate from the one already decoding video) so the two decodes don't
         * interfere with each other's track position.
         */
        fun analyze(inputPath: String, bucketMs: Int = DEFAULT_BUCKET_MS): AudioAmplitudeReader {
            val extractor = MediaExtractor()
            extractor.setDataSource(inputPath)

            var audioTrack = -1
            for (i in 0 until extractor.trackCount) {
                val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
                if (mime.startsWith("audio/")) { audioTrack = i; break }
            }
            if (audioTrack < 0) {
                extractor.release()
                return AudioAmplitudeReader(FloatArray(0), bucketMs)
            }

            val format = extractor.getTrackFormat(audioTrack)
            val mime = format.getString(MediaFormat.KEY_MIME)!!
            val sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            extractor.selectTrack(audioTrack)

            val decoder = MediaCodec.createDecoderByType(mime)
            decoder.configure(format, null, null, 0)
            decoder.start()

            val samplesPerBucket = (sampleRate * bucketMs / 1000f).toInt().coerceAtLeast(1)
            val buckets = mutableListOf<Float>()
            var sumSquares = 0.0
            var countInBucket = 0

            val bufferInfo = MediaCodec.BufferInfo()
            var sawInputEos = false
            var sawOutputEos = false

            while (!sawOutputEos) {
                if (!sawInputEos) {
                    val inIndex = decoder.dequeueInputBuffer(10_000)
                    if (inIndex >= 0) {
                        val inputBuffer = decoder.getInputBuffer(inIndex)!!
                        val sampleSize = extractor.readSampleData(inputBuffer, 0)
                        if (sampleSize < 0) {
                            decoder.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            sawInputEos = true
                        } else {
                            decoder.queueInputBuffer(inIndex, 0, sampleSize, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                val outIndex = decoder.dequeueOutputBuffer(bufferInfo, 10_000)
                if (outIndex >= 0) {
                    if (bufferInfo.size > 0) {
                        val outputBuffer = decoder.getOutputBuffer(outIndex)!!
                        outputBuffer.order(ByteOrder.nativeOrder())
                        outputBuffer.position(bufferInfo.offset)
                        outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                        val shortBuffer = outputBuffer.asShortBuffer()
                        // PCM 16-bit signed, possibly interleaved stereo — we don't split
                        // channels since amplitude only needs overall loudness, not L/R.
                        while (shortBuffer.hasRemaining()) {
                            val sample = shortBuffer.get().toDouble() / 32768.0
                            sumSquares += sample * sample
                            countInBucket++
                            if (countInBucket >= samplesPerBucket) {
                                buckets.add(sqrt(sumSquares / countInBucket).toFloat())
                                sumSquares = 0.0
                                countInBucket = 0
                            }
                        }
                    }
                    decoder.releaseOutputBuffer(outIndex, false)
                    if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        sawOutputEos = true
                    }
                }
            }
            if (countInBucket > 0) {
                buckets.add(sqrt(sumSquares / countInBucket).toFloat())
            }

            decoder.stop(); decoder.release()
            extractor.release()

            // Normalize against this clip's own peak so quiet recordings still produce
            // a usable 0..1 range for effects, rather than staying near-zero throughout.
            val peak = buckets.maxOrNull()?.coerceAtLeast(0.0001f) ?: 0.0001f
            val normalized = FloatArray(buckets.size) { (buckets[it] / peak).coerceIn(0f, 1f) }

            return AudioAmplitudeReader(normalized, bucketMs)
        }
    }
} 
