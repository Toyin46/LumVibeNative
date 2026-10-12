import ExpoModulesCore
import AVFoundation

// NOT COMPILED OR TESTED ON A DEVICE. iOS counterpart of AudioStudioModule.kt: decode with
// AVAudioFile (handles m4a/mp3/wav/caf), call the shared C core, encode AAC .m4a with AVAudioFile.
public class LumVibeAudioStudioModule: Module {

    private func fileURL(_ path: String) -> URL {
        if path.hasPrefix("file://"), let u = URL(string: path) { return u }
        return URL(fileURLWithPath: path)
    }

    private struct PCM { let data: Data; let rate: Int; let channels: Int }

    private func readPCM(_ path: String) throws -> PCM {
        let file = try AVAudioFile(forReading: fileURL(path))
        let fmt = file.processingFormat                        // float32, non-interleaved
        let total = AVAudioFrameCount(file.length)
        guard total > 0, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: total) else {
            throw NSError(domain: "LumVibeAudioStudio", code: 10, userInfo: [NSLocalizedDescriptionKey: "Audio file is empty"])
        }
        try file.read(into: buf)
        let n = Int(buf.frameLength), ch = Int(fmt.channelCount)
        guard let chans = buf.floatChannelData else {
            throw NSError(domain: "LumVibeAudioStudio", code: 11, userInfo: [NSLocalizedDescriptionKey: "Unsupported audio format"])
        }
        var inter = [Float](repeating: 0, count: n * ch)
        for c in 0..<ch { let src = chans[c]; for i in 0..<n { inter[i * ch + c] = src[i] } }
        let data = inter.withUnsafeBufferPointer { Data(buffer: $0) }
        return PCM(data: data, rate: Int(fmt.sampleRate), channels: ch)
    }

    private func writeAAC(_ pcm: Data, to path: String) throws -> Double {
        let url = fileURL(path)
        try? FileManager.default.removeItem(at: url)
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 192000,
        ]
        var outFile: AVAudioFile? = try AVAudioFile(forWriting: url, settings: settings)
        let wfmt = outFile!.processingFormat                   // float32 non-interleaved, 48k stereo
        let frames = pcm.count / (MemoryLayout<Float>.size * 2)
        let chunk = 48000
        try pcm.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Float.self)
            var done = 0
            while done < frames {
                let n = min(chunk, frames - done)
                guard let b = AVAudioPCMBuffer(pcmFormat: wfmt, frameCapacity: AVAudioFrameCount(n)),
                      let ch = b.floatChannelData else { break }
                for i in 0..<n { ch[0][i] = src[(done + i) * 2]; ch[1][i] = src[(done + i) * 2 + 1] }
                b.frameLength = AVAudioFrameCount(n)
                try outFile!.write(from: b)
                done += n
            }
        }
        outFile = nil                                          // closing the file finalises the .m4a
        return Double(frames) / 48000.0
    }

    public func definition() -> ModuleDefinition {
        Name("LumVibeAudioStudio")

        Function("hasNoiseModel") { () -> Bool in LVAAudioBridge.hasRnnoise() }

        AsyncFunction("bakeAudioStudio") { (voicePath: String, beatPath: String?, params: [Double], outputPath: String) -> [String: Any] in
            let t0 = Date()
            let voice = try self.readPCM(voicePath)
            var beat: PCM? = nil
            if let bp = beatPath, !bp.isEmpty { beat = try self.readPCM(bp) }

            var err: NSError?
            guard let result = LVAAudioBridge.process(
                withParams: params.map { NSNumber(value: $0) },
                voice: voice.data, voiceRate: Int32(voice.rate), voiceChannels: Int32(voice.channels),
                beat: beat?.data, beatRate: Int32(beat?.rate ?? 0), beatChannels: Int32(beat?.channels ?? 0),
                error: &err) else {
                throw err ?? NSError(domain: "LumVibeAudioStudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Audio processing failed"])
            }
            let secs = try self.writeAAC(result, to: outputPath)
            return [
                "uri": outputPath.hasPrefix("file://") ? outputPath : "file://" + outputPath,
                "durationSec": secs,
                "elapsedMs": Int(Date().timeIntervalSince(t0) * 1000),
            ]
        }
    }
}
