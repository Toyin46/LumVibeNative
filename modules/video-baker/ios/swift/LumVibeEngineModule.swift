import ExpoModulesCore

// NOT COMPILED OR TESTED (see MetalRenderBackend.h). The iOS counterpart
// to LiveEffectPreviewModule.kt — an ExpoModulesCore Module subclass is
// how Expo's autolinking exposes native code to your JS/TS, same role on
// both platforms, different SDK. Registered via expo-module.config.json's
// "ios" entry (see that file).
public class LumVibeEngineModule: Module {
    private var engine: LumVibeEngineBridge?
    private var camera: CameraCapture?
    private var faceTracker: FaceTracker?
    private var handTracker: HandTracker?
    private var poseTracker: PoseTracker?

    public func definition() -> ModuleDefinition {
        Name("LumVibeEngine")

        AsyncFunction("initialize") { (manifestAssetName: String) -> Bool in
            guard let manifestPath = Bundle.main.path(forResource: manifestAssetName, ofType: "json") else {
                return false
            }
            // Real wiring (creating the CAMetalLayer-backed engine, the
            // trackers, and the camera session) happens once a live
            // preview View is mounted — see the View registration below,
            // which is where a real CAMetalLayer actually exists.
            self.pendingManifestPath = manifestPath
            return true
        }

        AsyncFunction("setEffect") { (effectId: String) -> Bool in
            self.engine?.setEffect(effectId) ?? false
        }

        AsyncFunction("isEffectAvailable") { (effectId: String) -> Bool in
            self.engine?.isEffectAvailable(effectId) ?? false
        }

        View(LumVibeLivePreviewView.self) {
            Prop("effectId") { (view: LumVibeLivePreviewView, effectId: String) in
                view.setEffect(effectId)
            }
        }
    }

    private var pendingManifestPath: String?
}

// The actual UIView subclass hosting the CAMetalLayer — this is what
// `View(LumVibeLivePreviewView.self)` above mounts into your React Native
// tree, matching how LiveEffectPreviewView.kt's custom View works on
// Android.
public class LumVibeLivePreviewView: ExpoView {
    private let metalLayer = CAMetalLayer()
    private var engine: LumVibeEngineBridge?
    private var camera = CameraCapture()
    private var faceTracker: FaceTracker?
    private var handTracker: HandTracker?
    private var pendingEffectId: String?

    public required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)
        layer.addSublayer(metalLayer)

        guard let manifestPath = Bundle.main.path(forResource: "effects.manifest", ofType: "json") else { return }
        engine = LumVibeEngineBridge(manifestPath: manifestPath, metalLayer: metalLayer)
        faceTracker = FaceTracker(modelPath: Bundle.main.path(forResource: "face_landmarker", ofType: "task") ?? "")
        handTracker = HandTracker(modelPath: Bundle.main.path(forResource: "hand_landmarker", ofType: "task") ?? "")

        camera.onFrame = { [weak self] pixelBuffer in
            guard let self, let engine = self.engine else { return }
            let face = self.faceTracker?.detect(pixelBuffer: pixelBuffer)
            let hands = self.handTracker?.detect(pixelBuffer: pixelBuffer) ?? []
            engine.updateSignals(
                timeElapsed: Float(CACurrentMediaTime()), timeDelta: 1.0 / 30,
                face: face.map { f in
                    var r = LumVibeEngineBridge.FaceResult()
                    r.smileScore = f.smileScore; r.browRaiseScore = f.browRaiseScore
                    r.jawOpen = f.jawOpen; r.winkScore = f.winkScore
                    r.boundingBox = f.boundingBox; r.mouthCenter = f.mouthCenter
                    r.headRoll = f.headRoll; r.headPitch = f.headPitch; r.headYaw = f.headYaw
                    r.eyeBlinkBoth = f.eyeBlinkBoth
                    return r
                },
                gazeTrail: [], gazeTrailAges: [],
                hands: hands.map { h in
                    LumVibeEngineBridge.HandResult(palmCenter: h.palmCenter, gesture: h.gesture.rawValue, angle: h.angle, throwVelocity: h.throwVelocity)
                },
                fingerTrail: [], fingerTrailAges: [],
                audioAmplitude: 0, motionMagnitude: 0, stillnessSeconds: 0,
                bodyBox: nil, touchActive: false, touchPosition: (0, 0)
            )
            engine.renderFrame(pixelBuffer: pixelBuffer)
        }

        if let pendingEffectId { engine?.setEffect(pendingEffectId) }
        try? camera.start(previewLayer: AVCaptureVideoPreviewLayer()) // see README — wire a real preview layer, this is illustrative
    }

    public func setEffect(_ effectId: String) {
        pendingEffectId = effectId
        engine?.setEffect(effectId)
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        metalLayer.frame = bounds
    }
}
