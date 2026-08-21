package com.lumvibe.videobaker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * NEW FILE — real-time microphone amplitude for the LIVE preview path.
 *
 * IMPORTANT: this is a genuinely separate class from AudioAmplitudeReader.kt,
 * not a live version of it. AudioAmplitudeReader only has one entry point,
 * analyze(inputPath: String), which decodes a FINISHED audio file with
 * MediaExtractor/MediaCodec — it has no live-microphone mode and cannot be
 * given one without becoming a different class. The comment in
 * LiveEffectPreviewView.kt claiming it "already runs independently of video"
 * was describing the bake path only; on live camera there is no finished
 * file yet to decode, so that class genuinely cannot supply Voice Halo /
 * Thermal Pulse / Depth Bloom with anything on live preview. This class is
 * the real fix: an AudioRecord tap on the mic, running on its own thread,
 * producing the same normalized 0..1 RMS loudness AudioAmplitudeReader
 * produces for the bake path, so the shaders that read effectIntensity
 * don't need to know or care which path fed them.
 *
 * Includes an attack/release smoothing envelope per the "smooth/cinematic"
 * design decision for Voice Halo/Thermal Pulse/Depth Bloom — raw mic RMS
 * jumps around every ~20ms and reads as jittery/glitchy if applied directly
 * to a glow effect. Fast attack (0.35, effect can catch up to a sudden
 * louder moment quickly), slow release (0.08, fades back down gradually
 * instead of snapping to silence) is what gives the "premium/cinematic"
 * feel rather than a percussive one.
 *
 * Needs RECORD_AUDIO permission — same permission your app almost certainly
 * already requests for LiveRecorder's audio track, so this shouldn't need a
 * new permission prompt, just confirm the manifest already has it.
 */
class LiveAudioReader(private val context: Context) {
    private var audioRecord: AudioRecord? = null
    private var readThread: Thread? = null
    @Volatile private var running = false
    @Volatile private var smoothedAmplitude = 0f

    private val sampleRate = 44100
    private val minBufSize = AudioRecord.getMinBufferSize(
        sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
    )

    /** Current smoothed 0..1 loudness. Safe to call every render frame from any thread. */
    fun currentAmplitude(): Float = smoothedAmplitude

    fun start() {
        if (running) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            android.util.Log.w("LiveAudioReader", "RECORD_AUDIO not granted - audio-reactive effects will stay silent/flat until it is")
            return
        }
        if (minBufSize <= 0) {
            android.util.Log.e("LiveAudioReader", "AudioRecord.getMinBufferSize failed on this device")
            return
        }
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC, sampleRate,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                minBufSize * 2
            )
        } catch (e: Exception) {
            android.util.Log.e("LiveAudioReader", "AudioRecord init failed", e)
            return
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            android.util.Log.e("LiveAudioReader", "AudioRecord failed to initialize (state=${record.state})")
            record.release()
            return
        }
        audioRecord = record
        running = true
        record.startRecording()

        readThread = Thread {
            val buf = ShortArray(minBufSize.coerceAtLeast(1024) / 2)
            while (running) {
                val n = record.read(buf, 0, buf.size)
                if (n > 0) {
                    var sumSquares = 0.0
                    for (i in 0 until n) {
                        val s = buf[i].toDouble() / 32768.0
                        sumSquares += s * s
                    }
                    val rms = sqrt(sumSquares / n).toFloat().coerceIn(0f, 1f)
                    // Same normalization ceiling reasoning as AudioAmplitudeReader's
                    // peak-normalize, just against a fixed assumed ceiling (0.3 RMS)
                    // instead of a whole clip's peak, since a live stream has no
                    // "whole clip" to know the peak of in advance.
                    val normalized = (rms / 0.3f).coerceIn(0f, 1f)
                    val attack = 0.35f
                    val release = 0.08f
                    smoothedAmplitude = if (normalized > smoothedAmplitude) {
                        smoothedAmplitude + (normalized - smoothedAmplitude) * attack
                    } else {
                        smoothedAmplitude + (normalized - smoothedAmplitude) * release
                    }
                }
            }
        }.also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        readThread?.join(200)
        readThread = null
        try {
            audioRecord?.stop()
        } catch (e: Exception) { /* already stopped/released - not fatal */ }
        audioRecord?.release()
        audioRecord = null
        smoothedAmplitude = 0f
    }
}
