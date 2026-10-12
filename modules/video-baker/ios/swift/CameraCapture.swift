import AVFoundation
import QuartzCore

// NOT COMPILED OR TESTED (see MetalRenderBackend.h). The iOS equivalent
// of the role your existing Camera2/CameraX pipeline plays on Android —
// feeds frames in, hands each one to the engine + trackers. This is
// intentionally the smallest file in the iOS set: plumbing, not effect
// logic, same as jni_bridge.cpp's role.
public final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.lumvibe.camera")

    public var onFrame: ((CVPixelBuffer) -> Void)?

    public func start(previewLayer: AVCaptureVideoPreviewLayer) throws {
        session.beginConfiguration()
        session.sessionPreset = .high

        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else {
            throw NSError(domain: "LumVibe", code: 1, userInfo: [NSLocalizedDescriptionKey: "No front camera"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(input) { session.addInput(input) }

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }

        previewLayer.session = session
        session.commitConfiguration()
        session.startRunning()
    }

    public func stop() { session.stopRunning() }

    public func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        onFrame?(pixelBuffer)
    }
}

/*
 * Usage sketch, tying CameraCapture + the three trackers + LumVibeEngineBridge together:
 *
 *   let camera = CameraCapture()
 *   let engine = LumVibeEngineBridge(manifestPath: ..., metalLayer: previewLayer)!
 *   let faceTracker = FaceTracker(modelPath: ...)
 *   let handTracker = HandTracker(modelPath: ...)
 *   engine.setEffect("rich_camera")
 *
 *   camera.onFrame = { pixelBuffer in
 *       let face = faceTracker?.detect(pixelBuffer: pixelBuffer)
 *       let hands = handTracker?.detect(pixelBuffer: pixelBuffer) ?? []
 *       engine.updateSignals(
 *           timeElapsed: CACurrentMediaTime(), timeDelta: 1.0/30,
 *           face: face.map { LumVibeEngineBridge.FaceResult(from: $0) }, // small adapter, see README
 *           gazeTrail: [], gazeTrailAges: [],
 *           hands: hands.map { LumVibeEngineBridge.HandResult(palmCenter: $0.palmCenter, gesture: $0.gesture.rawValue, angle: $0.angle, throwVelocity: $0.throwVelocity) },
 *           fingerTrail: [], fingerTrailAges: [],
 *           audioAmplitude: 0, motionMagnitude: 0, stillnessSeconds: 0,
 *           bodyBox: nil, touchActive: false, touchPosition: (0, 0)
 *       )
 *       engine.renderFrame(pixelBuffer: pixelBuffer)
 *   }
 *   try camera.start(previewLayer: myPreviewLayer)
 */
