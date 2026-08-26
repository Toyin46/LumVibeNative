package com.lumvibe.videobaker

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.util.Log
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

/**
* Records the live GL-effect preview to an actual video file, so effects show
* live WHILE recording instead of only being baked in afterward (see
* LiveEffectPreviewView.kt's drawFrame()/maybeDrawToEncoder(), which feeds
* this class the same frames it renders to the screen).
*
* WHY THIS IS SPLIT THE WAY IT IS: the existing bake pipeline (VideoTranscoder.kt)
* only ever COPIES an existing audio track through untouched  -  this codebase has
* no prior live-audio-encoding code to build on, since baking always starts from
* an already-recorded file. Live capture has no pre-existing audio track to copy,
* so real audio capture+encoding has to be built here for the first time.
* To keep the genuinely new, unproven part (audio) away from the real-time
* rendering path (where a bug would jank or crash the live preview), this class
* does the SIMPLEST possible thing while actually recording:
*   - video: encode via MediaCodec surface input, same drain choreography
*     VideoTranscoder.kt already uses successfully - proven, just reused here.
*   - audio: AudioRecord -> raw PCM bytes -> a plain file. No encoding, no
*     muxer, nothing that can go wrong under real-time pressure.
* Only AFTER recording stops (finalize()) - with no real-time pressure and no
* risk of jittering the live preview - does the actually-new code run: encode
* that raw PCM to AAC (same drain-loop shape as the video encoder above, just
* for audio), then combine the silent video file + encoded audio into one
* final MP4 using MediaExtractor+MediaMuxer, the same copy-track pattern
* VideoTranscoder.kt already uses for its own audio passthrough.
*
* FLAG FOR ON-DEVICE VERIFICATION: this is genuinely new code with no prior
* working version in this codebase to diff against, unlike almost everything
* else touched this session. Test with a short (2-3s) recording first.
*/
class LiveRecorder(
    private val context: Context,
    private val width: Int,
    private val height: Int,
    private val videoOnlyPath: String,
    private val pcmPath: String,
) {
    companion object {
        private const val TAG = "VideoBaker/LiveRecorder"
        private const val VIDEO_BIT_RATE = 6_000_000
        private const val VIDEO_FRAME_RATE = 30
        private const val AUDIO_SAMPLE_RATE = 44100
        private const val AUDIO_CHANNELS = 1 // mono - simpler, smaller, and this is a
                                              // phone-mic selfie-video use case, not
                                              // a music app; stereo isn't needed here.
        private const val AUDIO_BIT_RATE = 128_000
    }

    // ---- Video encoder (real-time path, mirrors VideoTranscoder.kt exactly) ----
    private var videoEncoder: MediaCodec? = null
    var encoderInputSurface: android.view.Surface? = null
        private set
    private var videoMuxer: MediaMuxer? = null
    private var videoMuxerTrack = -1
    private var videoMuxerStarted = false
    private val videoBufferInfo = MediaCodec.BufferInfo()

    // ---- Audio capture (real-time path, deliberately as simple as possible) ----
    private var audioRecord: AudioRecord? = null
    private var audioThread: Thread? = null
    @Volatile private var audioRecording = false
    private var actualSampleRate = AUDIO_SAMPLE_RATE

    @Volatile var isRecording = false
        private set

    /** Starts the video encoder and returns the Surface to render into. Call
     * BEFORE startAudio() so the caller can create its shared-context EGL
     * surface from the returned Surface before frames start flowing. */
    fun startVideo(): android.view.Surface {
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height)
        format.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
        format.setInteger(MediaFormat.KEY_BIT_RATE, VIDEO_BIT_RATE)
        format.setInteger(MediaFormat.KEY_FRAME_RATE, VIDEO_FRAME_RATE)
        format.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)

        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = encoder.createInputSurface()
        encoder.start()
        videoEncoder = encoder
        encoderInputSurface = surface

        videoMuxer = MediaMuxer(videoOnlyPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        videoMuxerStarted = false
        videoMuxerTrack = -1

        isRecording = true
        return surface
    }

    /** Starts raw PCM capture on its own thread. Call after startVideo().
     *
     * ADDED: an explicit RECORD_AUDIO permission check, first thing. Previously
     * this method had no way to distinguish "permission never granted" from
     * "AudioRecord failed for some other reason" - both fell through to the
     * same generic try/catch/state-check below and logged near-identical
     * warnings, so a permission problem and a genuine device/hardware issue
     * were indistinguishable in Logcat. This mirrors the exact check
     * LiveAudioReader.kt already does for the same permission on the live
     * amplitude-reading path - if THAT class's audio-reactive effects
     * (Voice Halo, Aura Glow, Thermal Pulse) have also been looking flat/silent
     * on-device, it's very likely the same root cause showing up twice.
     */
    fun startAudio() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            Log.w(TAG, "RECORD_AUDIO not granted - recording without audio. " +
                "This is very likely why exported videos have been silent: " +
                "confirm the permission is actually being requested/granted at " +
                "runtime, not just declared in the manifest.")
            return
        }
        val minBufSize = AudioRecord.getMinBufferSize(
            AUDIO_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBufSize <= 0) {
            // FLAG FOR ON-DEVICE VERIFICATION: some devices/emulators can reject
            // the requested sample rate; if this ever happens in practice the
            // safe fallback is to skip audio entirely rather than crash the
            // whole recording - a silent video is recoverable, a crash isn't.
            Log.w(TAG, "AudioRecord.getMinBufferSize failed, recording without audio")
            return
        }
        val bufSize = minBufSize * 2
        val record = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC, AUDIO_SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize
            )
        } catch (e: Exception) {
            Log.w(TAG, "AudioRecord init failed, recording without audio", e)
            return
        }
        if (record.state != AudioRecord.STATE_INITIALIZED) {
            Log.w(TAG, "AudioRecord not initialized, recording without audio")
            return
        }
        actualSampleRate = AUDIO_SAMPLE_RATE
        audioRecord = record
        audioRecording = true
        val out = FileOutputStream(pcmPath)
        val thread = Thread {
            val buf = ByteArray(bufSize)
            record.startRecording()
            try {
                while (audioRecording) {
                    val read = record.read(buf, 0, buf.size)
                    if (read > 0) out.write(buf, 0, read)
                }
            } catch (e: Exception) {
                Log.w(TAG, "audio capture loop error", e)
            } finally {
                try { record.stop() } catch (e: Exception) { /* already stopped/released elsewhere */ }
                try { out.close() } catch (e: Exception) { /* best-effort */ }
            }
        }
        thread.start()
        audioThread = thread
    }

    /** Call once per frame after rendering to encoderInputSurface and
     * swapping buffers on it - drains whatever the encoder has ready and
     * writes it to the video-only muxer. Mirrors VideoTranscoder.kt's own
     * drain loop exactly (see its "3) Drain the encoder and write to the
     * muxer" section), just running once per live frame instead of in a
     * tight while-loop, since here frames arrive one at a time in real time
     * rather than being pumped through as fast as possible.
     */
    fun drainVideo(endOfStream: Boolean) {
        val encoder = videoEncoder ?: return
        val muxer = videoMuxer ?: return
        if (endOfStream) {
            try { encoder.signalEndOfInputStream() } catch (e: Exception) { /* already signaled */ }
        }
        while (true) {
            val outIndex = encoder.dequeueOutputBuffer(videoBufferInfo, 0)
            when {
                outIndex == MediaCodec.INFO_TRY_AGAIN_LATER -> {
                    if (!endOfStream) return
                    // draining for real at end-of-stream - keep looping briefly
                    // until the EOS buffer actually appears, same pattern
                    // VideoTranscoder.kt's own end-of-stream drain uses.
                }
                outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    videoMuxerTrack = muxer.addTrack(encoder.outputFormat)
                    muxer.start()
                    videoMuxerStarted = true
                }
                outIndex >= 0 -> {
                    val data = encoder.getOutputBuffer(outIndex)
                    if (data != null && videoBufferInfo.size > 0 && videoMuxerStarted) {
                        data.position(videoBufferInfo.offset)
                        data.limit(videoBufferInfo.offset + videoBufferInfo.size)
                        muxer.writeSampleData(videoMuxerTrack, data, videoBufferInfo)
                    }
                    encoder.releaseOutputBuffer(outIndex, false)
                    if (videoBufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                        return
                    }
                }
                else -> return
            }
        }
    }

    /** Stops audio capture and video encoding, closes the video-only muxer.
     * Does NOT produce the final playable file yet - call finalizeRecording()
     * after this to get the real output path. Split into two steps so the
     * (very fast) stop can happen right when the user taps stop, and the
     * (slightly slower) audio-encode+combine step can show a brief "processing"
     * state in the UI rather than blocking the stop button itself. */
    fun stop() {
        isRecording = false
        audioRecording = false
        audioThread?.join(2000) // safety ceiling - never hang the UI indefinitely
                                 // if the audio thread somehow doesn't exit cleanly
        audioThread = null
        try { audioRecord?.release() } catch (e: Exception) { /* best-effort */ }
        audioRecord = null

        drainVideo(endOfStream = true)
        try { videoEncoder?.stop() } catch (e: Exception) { /* best-effort */ }
        try { videoEncoder?.release() } catch (e: Exception) { /* best-effort */ }
        videoEncoder = null
        try { if (videoMuxerStarted) videoMuxer?.stop() } catch (e: Exception) { /* best-effort */ }
        try { videoMuxer?.release() } catch (e: Exception) { /* best-effort */ }
        videoMuxer = null
        try { encoderInputSurface?.release() } catch (e: Exception) { /* best-effort */ }
        encoderInputSurface = null
    }

    /**
     * Post-process step: encodes the raw PCM captured during recording to AAC,
     * then combines it with the silent video-only file into one final playable
     * MP4. No real-time pressure here - this runs after stop(), off the render
     * thread, so a slower device just takes a bit longer, not a dropped frame.
     * Returns the final output path, or the video-only path unchanged if no
     * audio was captured (e.g. permission denied, or startAudio() failed
     * gracefully - see its own fallback comments).
     */
    fun finalizeRecording(outputPath: String): String {
        val pcmFile = File(pcmPath)
        if (!pcmFile.exists() || pcmFile.length() == 0L) {
            // No audio captured - the video-only file IS the final file, just
            // rename/copy it to the expected output path so callers always
            // get a consistent path back regardless of whether audio worked.
            File(videoOnlyPath).copyTo(File(outputPath), overwrite = true)
            return outputPath
        }

        val aacPath = "$outputPath.aac.tmp"
        val encodedOk = try {
            encodePcmToAac(pcmFile, aacPath)
            true
        } catch (e: Exception) {
            Log.w(TAG, "audio encode failed, falling back to silent video", e)
            false
        }
        if (!encodedOk) {
            File(videoOnlyPath).copyTo(File(outputPath), overwrite = true)
            return outputPath
        }

        return try {
            muxVideoAndAudio(videoOnlyPath, aacPath, outputPath)
            outputPath
        } catch (e: Exception) {
            Log.w(TAG, "final mux failed, falling back to silent video", e)
            File(videoOnlyPath).copyTo(File(outputPath), overwrite = true)
            outputPath
        } finally {
            try { File(aacPath).delete() } catch (e: Exception) { /* best-effort cleanup */ }
            try { File(pcmPath).delete() } catch (e: Exception) { /* best-effort cleanup */ }
            try { File(videoOnlyPath).delete() } catch (e: Exception) { /* best-effort cleanup */ }
        }
    }

    /** Same encode-drain shape as drainVideo() above, applied to a plain AAC
     * audio encoder instead of the surface-input video one - queues raw PCM
     * chunks in, drains encoded AAC out, writes to a standalone single-track
     * MP4 (kept separate from the video file - combined in muxVideoAndAudio). */
    private fun encodePcmToAac(pcmFile: File, outAacPath: String) {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, actualSampleRate, AUDIO_CHANNELS)
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        format.setInteger(MediaFormat.KEY_BIT_RATE, AUDIO_BIT_RATE)
        val encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        encoder.start()

        val muxer = MediaMuxer(outAacPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var muxerTrack = -1
        var muxerStarted = false
        val bufferInfo = MediaCodec.BufferInfo()

        val input = pcmFile.inputStream()
        val chunk = ByteArray(4096)
        var totalBytesRead = 0L
        // 2 bytes per sample (16-bit PCM) * channel count
        val bytesPerSample = 2 * AUDIO_CHANNELS
        var eosSent = false

        input.use { stream ->
            while (true) {
                if (!eosSent) {
                    val inIndex = encoder.dequeueInputBuffer(10000)
                    if (inIndex >= 0) {
                        val read = stream.read(chunk)
                        val inBuf = encoder.getInputBuffer(inIndex)!!
                        inBuf.clear()
                        if (read > 0) {
                            inBuf.put(chunk, 0, read)
                            // presentationTimeUs derived from how many audio
                            // frames have been fed so far, NOT wall-clock time -
                            // keeps audio internally consistent even if this
                            // post-process pass runs faster or slower than
                            // real time (it will, since there's no live-frame
                            // pacing here, unlike the video encoder above).
                            val presentationTimeUs = (totalBytesRead / bytesPerSample) * 1_000_000L / actualSampleRate
                            encoder.queueInputBuffer(inIndex, 0, read, presentationTimeUs, 0)
                            totalBytesRead += read
                        } else {
                            val presentationTimeUs = (totalBytesRead / bytesPerSample) * 1_000_000L / actualSampleRate
                            encoder.queueInputBuffer(inIndex, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            eosSent = true
                        }
                    }
                }

                val outIndex = encoder.dequeueOutputBuffer(bufferInfo, 10000)
                when {
                    outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        muxerTrack = muxer.addTrack(encoder.outputFormat)
                        muxer.start()
                        muxerStarted = true
                    }
                    outIndex >= 0 -> {
                        val data = encoder.getOutputBuffer(outIndex)
                        if (data != null && bufferInfo.size > 0 && muxerStarted) {
                            data.position(bufferInfo.offset)
                            data.limit(bufferInfo.offset + bufferInfo.size)
                            muxer.writeSampleData(muxerTrack, data, bufferInfo)
                        }
                        encoder.releaseOutputBuffer(outIndex, false)
                        if (bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
                            try { muxer.stop() } catch (e: Exception) { /* best-effort */ }
                            try { muxer.release() } catch (e: Exception) { /* best-effort */ }
                            try { encoder.stop() } catch (e: Exception) { /* best-effort */ }
                            try { encoder.release() } catch (e: Exception) { /* best-effort */ }
                            return
                        }
                    }
                }
            }
        }
    }

    /** Combines the silent video-only file and the standalone AAC file into
     * one final playable MP4, using MediaExtractor to pull samples back out
     * of each and a fresh MediaMuxer to combine them - the exact same
     * copy-track pattern VideoTranscoder.kt already uses for its own audio
     * passthrough, just applied to two freshly-encoded files instead of one
     * pre-existing source file. */
    private fun muxVideoAndAudio(videoPath: String, audioPath: String, outputPath: String) {
        val muxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        val videoExtractor = MediaExtractor()
        videoExtractor.setDataSource(videoPath)
        var videoSrcTrack = -1
        var videoFormat: MediaFormat? = null
        for (i in 0 until videoExtractor.trackCount) {
            val fmt = videoExtractor.getTrackFormat(i)
            val mime = fmt.getString(MediaFormat.KEY_MIME) ?: ""
            if (mime.startsWith("video/")) { videoSrcTrack = i; videoFormat = fmt; break }
        }

        val audioExtractor = MediaExtractor()
        audioExtractor.setDataSource(audioPath)
        var audioSrcTrack = -1
        var audioFormat: MediaFormat? = null
        for (i in 0 until audioExtractor.trackCount) {
            val fmt = audioExtractor.getTrackFormat(i)
            val mime = fmt.getString(MediaFormat.KEY_MIME) ?: ""
            if (mime.startsWith("audio/")) { audioSrcTrack = i; audioFormat = fmt; break }
        }

        if (videoSrcTrack < 0 || videoFormat == null) {
            throw IllegalStateException("no video track found in $videoPath")
        }

        val muxVideoTrack = muxer.addTrack(videoFormat)
        val muxAudioTrack = if (audioSrcTrack >= 0 && audioFormat != null) muxer.addTrack(audioFormat) else -1
        muxer.start()

        val buffer = ByteBuffer.allocate(1024 * 1024)
        val bufferInfo = MediaCodec.BufferInfo()

        videoExtractor.selectTrack(videoSrcTrack)
        while (true) {
            buffer.clear()
            val size = videoExtractor.readSampleData(buffer, 0)
            if (size < 0) break
            bufferInfo.offset = 0
            bufferInfo.size = size
            bufferInfo.presentationTimeUs = videoExtractor.sampleTime
            bufferInfo.flags = videoExtractor.sampleFlags
            muxer.writeSampleData(muxVideoTrack, buffer, bufferInfo)
            videoExtractor.advance()
        }
        videoExtractor.release()

        if (muxAudioTrack >= 0) {
            audioExtractor.selectTrack(audioSrcTrack)
            while (true) {
                buffer.clear()
                val size = audioExtractor.readSampleData(buffer, 0)
                if (size < 0) break
                bufferInfo.offset = 0
                bufferInfo.size = size
                bufferInfo.presentationTimeUs = audioExtractor.sampleTime
                bufferInfo.flags = audioExtractor.sampleFlags
                muxer.writeSampleData(muxAudioTrack, buffer, bufferInfo)
                audioExtractor.advance()
            }
        }
        audioExtractor.release()

        try { muxer.stop() } catch (e: Exception) { /* best-effort */ }
        try { muxer.release() } catch (e: Exception) { /* best-effort */ }
    }
} 
