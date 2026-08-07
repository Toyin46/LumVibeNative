package com.lumvibe.videobaker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
* Registers LiveEffectPreviewView as a usable React Native host component,
* following the same Expo Modules pattern as VideoBakerModule (Module() /
* ModuleDefinition, not the older ViewManager/ReactPackage API) — confirmed
* against VideoBakerModule.kt before writing this, not assumed.
*
* Autolinking: this class needs to be picked up the same way VideoBakerModule
* already is. If you have an expo-module.config.json listing module class
* names for this package, add "LiveEffectPreviewModule" to it alongside
* "VideoBakerModule" — I don't have that file to check directly, so confirm
* it on your end; if VideoBakerModule is registered some other way (manual
* ReactPackage, gradle source set, etc.) mirror whatever that is instead.
*/
class LiveEffectPreviewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("LiveEffectPreview")

        View(LiveEffectPreviewView::class) {
            // create.tsx passes the same fx.id string it already uses for
            // FX_LIST / glShaderEffect (e.g. "fx_gl_mood_ring") — VisualEffect.fromKey
            // is the exact same lookup EffectShaders/VideoTranscoder use for baking,
            // so a live preview key and a bake-time key are guaranteed to mean the
            // same effect.
            Prop("effect") { view: LiveEffectPreviewView, key: String? ->
                view.setEffect(VisualEffect.fromKey(key))
            }

            // "front" | "back" — same facing vocabulary create.tsx already uses
            // for the DualCameraView/DeepARCameraView facing prop.
            Prop("facing") { view: LiveEffectPreviewView, facing: String ->
                view.setFacing(facing)
            }
        }
    }
} 
