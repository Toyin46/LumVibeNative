package com.lumvibe.videobaker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
* Registers LiveEffectPreviewView as a usable React Native host component,
* following the same Expo Modules pattern as VideoBakerModule (Module() /
* ModuleDefinition, not the older ViewManager/ReactPackage API)  -  confirmed
* against VideoBakerModule.kt before writing this, not assumed.
*
* Autolinking: this class needs to be picked up the same way VideoBakerModule
* already is. If you have an expo-module.config.json listing module class
* names for this package, add "LiveEffectPreviewModule" to it alongside
* "VideoBakerModule"  -  I don't have that file to check directly, so confirm
* it on your end; if VideoBakerModule is registered some other way (manual
* ReactPackage, gradle source set, etc.) mirror whatever that is instead.
*/
class LiveEffectPreviewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("LiveEffectPreview")

        // FIX (replacing the EventDispatcher approach from earlier - checked
        // against Expo's own docs/examples and every one of them declares
        // EventDispatcher inside a class extending ExpoView(context,
        // appContext). LiveEffectPreviewView extends plain SurfaceView(context),
        // not ExpoView - that mismatch was a real, confirmed compile risk, not
        // a hypothetical one, so given what a failed build costs you right
        // now I'm not leaving it as "verify on device." Switched to
        // sendEvent(), a module-level event emission that only needs
        // appContext - which this file already proves is accessible and
        // working, since the AsyncFunctions below already call
        // appContext.findView successfully. Declared at the module's top
        // level (not inside View{} - that's specifically for ExpoView's
        // EventDispatcher mechanism) since this is module-scoped, not
        // view-scoped.
        Events("onFrameCaptured")

        View(LiveEffectPreviewView::class) {
            // create.tsx passes the same fx.id string it already uses for
            // FX_LIST / glShaderEffect (e.g. "fx_gl_mood_ring")  -  VisualEffect.fromKey
            // is the exact same lookup EffectShaders/VideoTranscoder use for baking,
            // so a live preview key and a bake-time key are guaranteed to mean the
            // same effect.
            Prop("effect") { view: LiveEffectPreviewView, key: String? ->
                // FIX: wires the view's plain callback field to this module's
                // sendEvent the first time ANY prop is set on this view
                // instance - piggybacked on this specific setter because it's
                // the one call path this codebase already proves fires
                // reliably per view (the entire effect-selection system
                // already depends on it), rather than a separate view-
                // lifecycle hook I couldn't verify exists in your installed
                // SDK version.
                if (view.onFrameCapturedListener == null) {
                    view.onFrameCapturedListener = { data -> sendEvent("onFrameCaptured", data) }
                }
                view.setEffect(VisualEffect.fromKey(key))
            }

            // "front" | "back"  -  same facing vocabulary create.tsx already uses
            // for the DualCameraView/DeepARCameraView facing prop.
            Prop("facing") { view: LiveEffectPreviewView, facing: String ->
                view.setFacing(facing)
            }
        }

        // FIX (live-effect recording): module-level functions taking a view
        // tag rather than "View Function" ref-forwarding, deliberately - the
        // exact ref-forwarding syntax for the installed Expo SDK version
        // wasn't something I could verify with certainty, while
        // appContext.findView(viewTag) is a long-established, stable Expo
        // Modules pattern for exactly this "call a method on a specific
        // native view instance from JS" case. See LiveEffectPreview.tsx for
        // how the JS side gets the tag (findNodeHandle - also long-stable).
        //
        // FLAG FOR ON-DEVICE VERIFICATION: this whole recording feature is
        // genuinely new, with no prior working version in this codebase to
        // diff against. Test with a short recording first.
        AsyncFunction("startLiveRecording") { viewTag: Int, videoOnlyPath: String, pcmPath: String, promise: expo.modules.kotlin.Promise ->
            val view = appContext.findView(viewTag) as? LiveEffectPreviewView
            if (view == null) {
                promise.reject("ERR_NO_VIEW", "LiveEffectPreview view not found for tag $viewTag", null)
                return@AsyncFunction
            }
            view.post {
                view.startRecording(videoOnlyPath, pcmPath)
                promise.resolve(null)
            }
        }

        AsyncFunction("stopLiveRecording") { viewTag: Int, finalOutputPath: String, promise: expo.modules.kotlin.Promise ->
            val view = appContext.findView(viewTag) as? LiveEffectPreviewView
            if (view == null) {
                promise.reject("ERR_NO_VIEW", "LiveEffectPreview view not found for tag $viewTag", null)
                return@AsyncFunction
            }
            view.post {
                view.stopRecording(finalOutputPath) { resultPath ->
                    promise.resolve(resultPath)
                }
            }
        }
    }
}  
