import Foundation
import QuartzCore
import CoreVideo

// NOT COMPILED OR TESTED (see MetalRenderBackend.h). Same role and shape
// as LumVibeEngineBridge.kt (Android) and lumvibeEngine.ts (Web) — same
// method names, same updateSignals(...) argument order, so a fix on one
// platform is structurally easy to cross-check on the others.
public final class LumVibeEngineBridge {
    private var handle: UnsafeMutableRawPointer?

    /// manifestPath: a real filesystem path to effects.manifest.json
    /// (bundle it as an app resource and resolve with
    /// Bundle.main.path(forResource:ofType:) — see README for exactly
    /// where this file goes in your Xcode project).
    /// metalLayer: the CAMetalLayer backing your camera preview view.
    public init?(manifestPath: String, metalLayer: CAMetalLayer) {
        let layerPtr = Unmanaged.passUnretained(metalLayer).toOpaque()
        guard let h = lumvibe_create(manifestPath, layerPtr) else { return nil }
        handle = h
    }

    @discardableResult
    public func setEffect(_ effectId: String) -> Bool {
        guard let handle else { return false }
        return lumvibe_setEffect(handle, effectId)
    }

    public func isEffectAvailable(_ effectId: String) -> Bool {
        guard let handle else { return false }
        return lumvibe_isEffectAvailable(handle, effectId)
    }

    public struct FaceResult {
        public var smileScore: Float = 0
        public var browRaiseScore: Float = 0
        public var jawOpen: Float = 0
        public var winkScore: Float = 0
        public var boundingBox: (left: Float, top: Float, right: Float, bottom: Float) = (0.35, 0.25, 0.65, 0.75)
        public var mouthCenter: (x: Float, y: Float) = (0.5, 0.6)
        public var headRoll: Float = 0
        public var headPitch: Float = 0
        public var headYaw: Float = 0
        public var eyeBlinkBoth: Bool = false
        public var yawDelta: Float = 0
        public init() {}
    }

    public struct HandResult {
        public var palmCenter: (x: Float, y: Float)
        public var gesture: Int32 // matches lumvibe::HandGesture's enum order — see Signals.h
        public var angle: Float
        public var throwVelocity: Float
        public init(palmCenter: (Float, Float), gesture: Int32, angle: Float, throwVelocity: Float) {
            self.palmCenter = palmCenter; self.gesture = gesture
            self.angle = angle; self.throwVelocity = throwVelocity
        }
    }

    public func updateSignals(
        timeElapsed: Float, timeDelta: Float,
        face: FaceResult?,
        gazeTrail: [(Float, Float)], gazeTrailAges: [Float],
        hands: [HandResult],
        fingerTrail: [(Float, Float)], fingerTrailAges: [Float],
        audioAmplitude: Float, motionMagnitude: Float, stillnessSeconds: Float,
        bodyBox: (left: Float, top: Float, right: Float, bottom: Float)?,
        touchActive: Bool, touchPosition: (x: Float, y: Float)
    ) {
        guard let handle else { return }
        let f = face ?? FaceResult()
        let faceArray: [Float] = [
            face != nil ? 1 : 0, f.smileScore, f.browRaiseScore, f.jawOpen, f.winkScore,
            f.boundingBox.left, f.boundingBox.top, f.boundingBox.right, f.boundingBox.bottom,
            f.mouthCenter.x, f.mouthCenter.y, f.headRoll, f.headPitch, f.headYaw,
            f.eyeBlinkBoth ? 1 : 0, f.yawDelta,
        ]

        let gazeCount = min(gazeTrail.count, 8)
        var gazePoints = [Float](); for i in 0..<gazeCount { gazePoints.append(gazeTrail[i].0); gazePoints.append(gazeTrail[i].1) }
        let gazeAges = Array(gazeTrailAges.prefix(gazeCount))

        let handCount = min(hands.count, 2)
        var handArray = [Float]()
        for i in 0..<handCount {
            let h = hands[i]
            handArray += [1, h.palmCenter.x, h.palmCenter.y, Float(h.gesture), h.angle, h.throwVelocity]
        }

        let fingerCount = min(fingerTrail.count, 16)
        var fingerPoints = [Float](); for i in 0..<fingerCount { fingerPoints.append(fingerTrail[i].0); fingerPoints.append(fingerTrail[i].1) }
        let fingerAges = Array(fingerTrailAges.prefix(fingerCount))

        let bb = bodyBox ?? (0.25, 0.15, 0.75, 1.0)
        let bodyArray: [Float] = [bb.left, bb.top, bb.right, bb.bottom]

        faceArray.withUnsafeBufferPointer { facePtr in
        gazePoints.withUnsafeBufferPointer { gazePtsPtr in
        gazeAges.withUnsafeBufferPointer { gazeAgesPtr in
        handArray.withUnsafeBufferPointer { handPtr in
        fingerPoints.withUnsafeBufferPointer { fingerPtsPtr in
        fingerAges.withUnsafeBufferPointer { fingerAgesPtr in
        bodyArray.withUnsafeBufferPointer { bodyPtr in
            lumvibe_updateSignals(
                handle, timeElapsed, timeDelta,
                facePtr.baseAddress,
                gazePtsPtr.baseAddress, gazeAgesPtr.baseAddress, Int32(gazeCount),
                handPtr.baseAddress, Int32(handCount),
                fingerPtsPtr.baseAddress, fingerAgesPtr.baseAddress, Int32(fingerCount),
                audioAmplitude, motionMagnitude, stillnessSeconds,
                bodyBox != nil, bodyPtr.baseAddress,
                touchActive, touchPosition.x, touchPosition.y
            )
        }}}}}}}
    }

    /// Call once per captured frame with the CVPixelBuffer from your
    /// AVCaptureVideoDataOutputSampleBufferDelegate callback.
    public func renderFrame(pixelBuffer: CVPixelBuffer) {
        guard let handle else { return }
        lumvibe_renderFrame(handle, Unmanaged.passUnretained(pixelBuffer).toOpaque())
    }

    public func release() {
        guard let handle else { return }
        lumvibe_release(handle)
        self.handle = nil
    }

    deinit { release() }
}
