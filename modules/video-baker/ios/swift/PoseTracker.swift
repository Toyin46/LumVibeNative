import MediaPipeTasksVision

// NOT COMPILED OR TESTED (see MetalRenderBackend.h). Same role as
// PoseTracker.kt — reduces MediaPipe's 33 pose landmarks to a single
// bounding box, the only thing tiny_body.ts needs.
public final class PoseTracker {
    private var landmarker: MPPPoseLandmarker?

    public init?(modelPath: String) {
        let options = MPPPoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = modelPath
        options.runningMode = .image
        options.numPoses = 1
        do {
            landmarker = try MPPPoseLandmarker(options: options)
        } catch {
            print("LumVibe: PoseLandmarker init failed: \(error)")
            return nil
        }
    }

    public struct Result {
        public var boundingBox: (left: Float, top: Float, right: Float, bottom: Float)
    }

    public func detect(pixelBuffer: CVPixelBuffer) -> Result? {
        guard let image = try? MPPImage(pixelBuffer: pixelBuffer) else { return nil }
        guard let result = try? landmarker?.detect(image: image), !result.landmarks.isEmpty else { return nil }

        let points = result.landmarks[0]
        var minX: Float = 1, minY: Float = 1, maxX: Float = 0, maxY: Float = 0
        for p in points {
            minX = min(minX, p.x); minY = min(minY, p.y)
            maxX = max(maxX, p.x); maxY = max(maxY, p.y)
        }
        return Result(boundingBox: (minX, minY, maxX, maxY))
    }
}
