package com.lumvibe.videobaker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.content.Context

class VideoBakerModule : Module() {

    // Class-level property, not inline inside the function — matches Expo's own
    // documented pattern for this exact "get context or throw" case. Keeping this
    // out of the AsyncFunction body entirely, since having it inside (even before
    // withContext) was still the likely cause of the previous compile failure.
    private val videoBakerContext: Context
        get() = appContext.reactContext
            ?: throw IllegalStateException("No Android context available for video baking")

    override fun definition() = ModuleDefinition {
        Name("VideoBaker")

        Events("onProgress")

        // inputPath / outputPath are plain filesystem paths (strip any "file://" prefix
        // before calling this from JS — expo-file-system gives you paths like that).
        AsyncFunction("bakeVideo") { inputPath: String, outputPath: String, options: Map<String, Any?> ->
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
                    effectIntensity = (options["effectIntensity"] as? Number)?.toFloat() ?: 1f,
                    portalScenePngPath = options["portalScenePngPath"] as? String
                )
                transcoder.transcode(videoBakerContext, inputPath, outputPath, opts) { progress ->
                    sendEvent("onProgress", mapOf("progress" to progress))
                }
                outputPath
            }
        }
    }
}  
