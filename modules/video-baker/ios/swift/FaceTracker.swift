import MediaPipeTasksVision
import UIKit

// NOT COMPILED OR TESTED (no Apple toolchain on Linux — see
// MetalRenderBackend.h). Written against MediaPipe's real iOS Tasks
// Vision API (the MPPFaceLandmarker family) — same model file
// (face_landmarker.task) and same blendshape-based scoring your Android
// FaceTracker.kt already uses, just the iOS SDK's class names (MPP-
// prefixed) instead of Android's Kotlin ones.
public final class FaceTracker {
    private var landmarker: MPPFaceLandmarker?

    public init?(modelPath: String) {
        let options = MPPFaceLandmarkerOptions()
        options.baseOptions.modelAssetPath = modelPath
        options.runningMode = .image
        options.outputFaceBlendshapes = true
        options.numFaces = 1
        do {
            landmarker = try MPPFaceLandmarker(options: options)
        } catch {
            print("LumVibe: FaceLandmarker init failed: \(error)")
            return nil
        }
    }

    public struct Result {
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
    }

    public func detect(pixelBuffer: CVPixelBuffer) -> Result? {
        guard let image = try? MPPImage(pixelBuffer: pixelBuffer) else { return nil }
        guard let result = try? landmarker?.detect(image: image), !result.faceLandmarks.isEmpty else { return nil }

        var r = Result()
        let landmarks = result.faceLandmarks[0]

        // Bounding box from the 478-point mesh, same reduction your
        // Android FaceTracker.kt already does.
        var minX: Float = 1, minY: Float = 1, maxX: Float = 0, maxY: Float = 0
        for p in landmarks {
            minX = min(minX, p.x); minY = min(minY, p.y)
            maxX = max(maxX, p.x); maxY = max(maxY, p.y)
        }
        r.boundingBox = (minX, minY, maxX, maxY)
        // Landmark 13/14 are the upper/lower inner-lip center in
        // MediaPipe's 478-point face mesh topology — same indices
        // regardless of platform.
        if landmarks.count > 14 {
            r.mouthCenter = ((landmarks[13].x + landmarks[14].x) / 2, (landmarks[13].y + landmarks[14].y) / 2)
        }

        // Blendshapes give named scores directly — no manual landmark
        // math needed, same as Android's outputFaceBlendshapes path.
        if let categories = result.faceBlendshapes?.first?.categories {
            func score(_ name: String) -> Float { categories.first(where: { $0.categoryName == name })?.score ?? 0 }
            let smileLeft = score("mouthSmileLeft"), smileRight = score("mouthSmileRight")
            r.smileScore = max(smileLeft, smileRight)
            r.browRaiseScore = max(score("browInnerUp"), max(score("browOuterUpLeft"), score("browOuterUpRight")))
            r.jawOpen = score("jawOpen")
            let blinkLeft = score("eyeBlinkLeft"), blinkRight = score("eyeBlinkRight")
            r.eyeBlinkBoth = blinkLeft > 0.6 && blinkRight > 0.6
            // Signed wink score: positive = left eye, matches Signals.h's
            // documented convention.
            r.winkScore = blinkLeft > 0.6 && blinkRight < 0.3 ? blinkLeft
                : (blinkRight > 0.6 && blinkLeft < 0.3 ? -blinkRight : 0)
        }

        if let transform = result.facialTransformationMatrixes?.first {
            // Same roll/pitch/yaw decomposition convention as Android —
            // extracted from the 4x4 transform matrix MediaPipe returns.
            r.headYaw = Float(atan2(Double(-transform.columns.2.x), Double(transform.columns.0.x))) * 180 / .pi
            r.headPitch = Float(asin(Double(transform.columns.2.y))) * 180 / .pi
            r.headRoll = Float(atan2(Double(-transform.columns.1.x), Double(transform.columns.1.y))) * 180 / .pi
        }
        return r
    }
}
