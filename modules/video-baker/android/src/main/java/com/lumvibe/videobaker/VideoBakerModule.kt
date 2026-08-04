package com.lumvibe.videobaker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class VideoBakerModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("VideoBaker")

        Events("onProgress")

        // inputPath / outputPath are plain filesystem paths (strip any "file://" prefix
        // before calling this from JS — expo-file-system gives you paths like that).
        AsyncFunction("bakeVideo") { inputPath: String, outputPath: String, options: Map<String, Any?> ->
            // Read appContext BEFORE entering withContext, not inside it — every build that
            // ever compiled had withContext as the sole top-level statement in this lambda;
            // nesting the context lookup inside it was the one structural difference in the
            // version that just failed. Restoring that shape rather than debugging the exact
            // inference quirk further.
            val context = appContext.reactContext
                ?: throw IllegalStateException("No Android context available for video baking")
            withContext(Dispatchers.Default) {
                val transcoder = VideoTranscoder()
                val opts = VideoTranscoder.Options(
                    watermarkPngPath = options["watermarkPngPath"] as? String,
                    watermarkUsername = options["watermarkUsername"] as? String,
                    watermarkBounce = (options["watermarkBounce"] as? Boolean) ?: true,
                    watermarkWidthFraction = (options["watermarkWidthFraction"] as? Number)?.toFloat() ?: 0.18f,
                    watermarkCardWidthFraction = (options["watermarkCardWidthFraction"] as? Number)?.toFloat() ?: 0.42f,
                    watermarkSpeedXPxPerSec = (options["watermarkSpeedXPxPerSec"] as? Number)?.toFloat() ?: 90f,
                    watermarkSpeedYPxPerSec = (options["watermarkSpeedYPxPerSec"] as? Number)?.toFloat() ?: 65f,
                    captionText = options["captionText"] as? String,
                    brightness = (options["brightness"] as? Number)?.toFloat() ?: 0f,
                    contrast = (options["contrast"] as? Number)?.toFloat() ?: 1f,
                    saturation = (options["saturation"] as? Number)?.toFloat() ?: 1f,
                    effect = options["effect"] as? String,
                    effectIntensity = (options["effectIntensity"] as? Number)?.toFloat() ?: 1f
                )
                transcoder.transcode(context, inputPath, outputPath, opts) { progress ->
                    sendEvent("onProgress", mapOf("progress" to progress))
                }
                outputPath
            }
        }
    }
} 
