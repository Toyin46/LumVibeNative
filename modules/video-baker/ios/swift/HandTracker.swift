import MediaPipeTasksVision

// NOT COMPILED OR TESTED (see MetalRenderBackend.h).
public final class HandTracker {
    private var landmarker: MPPHandLandmarker?

    public init?(modelPath: String) {
        let options = MPPHandLandmarkerOptions()
        options.baseOptions.modelAssetPath = modelPath
        options.runningMode = .image
        options.numHands = 2
        do {
            landmarker = try MPPHandLandmarker(options: options)
        } catch {
            print("LumVibe: HandLandmarker init failed: \(error)")
            return nil
        }
    }

    public enum Gesture: Int32 { case none = 0, fist = 1, openPalm = 2, scissors = 3, pointing = 4, unknown = 5 }

    public struct Result {
        public var palmCenter: (x: Float, y: Float)
        public var gesture: Gesture
        public var angle: Float
        public var throwVelocity: Float = 0
    }

    private var lastPalmCenters: [(x: Float, y: Float)] = []
    private var lastTimestamp: TimeInterval = 0

    public func detect(pixelBuffer: CVPixelBuffer) -> [Result] {
        guard let image = try? MPPImage(pixelBuffer: pixelBuffer) else { return [] }
        guard let result = try? landmarker?.detect(image: image) else { return [] }

        let now = CACurrentMediaTime()
        let dt = Float(max(now - lastTimestamp, 1.0 / 60.0))
        lastTimestamp = now

        var results: [Result] = []
        var newCenters: [(x: Float, y: Float)] = []

        for (i, landmarks) in result.landmarks.enumerated() {
            // Landmark 0 = wrist, 9 = middle-finger MCP — same palm-center
            // midpoint convention as Android's HandTracker.kt.
            guard landmarks.count > 9 else { continue }
            let wrist = landmarks[0], middleMcp = landmarks[9]
            let palmCenter: (x: Float, y: Float) = ((wrist.x + middleMcp.x) / 2, (wrist.y + middleMcp.y) / 2)
            let angle = atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x)

            let gesture = classifyGesture(landmarks)

            var throwVelocity: Float = 0
            if i < lastPalmCenters.count {
                let prev = lastPalmCenters[i]
                let dx = palmCenter.x - prev.x, dy = palmCenter.y - prev.y
                throwVelocity = sqrt(dx * dx + dy * dy) / dt
            }

            results.append(Result(palmCenter: palmCenter, gesture: gesture, angle: angle, throwVelocity: throwVelocity))
            newCenters.append(palmCenter)
        }

        lastPalmCenters = newCenters
        return results
    }

    // Same finger-extension-counting approach as Android's HandTracker.kt:
    // a finger is "extended" if its tip is farther from the wrist than its
    // PIP joint; fist = 0 extended, openPalm = 4-5 extended, etc.
    private func classifyGesture(_ landmarks: [MPPNormalizedLandmark]) -> Gesture {
        guard landmarks.count >= 21 else { return .unknown }
        let wrist = landmarks[0]
        func isExtended(tip: Int, pip: Int) -> Bool {
            let dTip = hypot(landmarks[tip].x - wrist.x, landmarks[tip].y - wrist.y)
            let dPip = hypot(landmarks[pip].x - wrist.x, landmarks[pip].y - wrist.y)
            return dTip > dPip
        }
        let indexExt = isExtended(tip: 8, pip: 6)
        let middleExt = isExtended(tip: 12, pip: 10)
        let ringExt = isExtended(tip: 16, pip: 14)
        let pinkyExt = isExtended(tip: 20, pip: 18)
        let extendedCount = [indexExt, middleExt, ringExt, pinkyExt].filter { $0 }.count

        if extendedCount == 0 { return .fist }
        if extendedCount >= 4 { return .openPalm }
        if indexExt && middleExt && !ringExt && !pinkyExt { return .scissors }
        if indexExt && !middleExt && !ringExt && !pinkyExt { return .pointing }
        return .unknown
    }
}
