package com.lumvibe.videobaker

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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

        // Switched from a suspend/withContext body to Expo's explicit Promise
        // pattern — the previous version relied on AsyncFunction's lambda being
        // inferred as a suspend function, which your installed expo-modules-core
        // version didn't do, producing the "can only be called from a coroutine"
        // build failure. Promise-based AsyncFunction is the older, more broadly
        // compatible pattern and sidesteps that inference entirely: we manually
        // launch the coroutine and manually resolve/reject, instead of asking the
        // compiler to infer suspend-ness from the lambda's call site.
        AsyncFunction("bakeVideo") { inputPath: String, outputPath: String, options: Map<String, Any?>, promise: Promise ->
            CoroutineScope(Dispatchers.Default).launch {
                try {
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
                    promise.resolve(outputPath)
                } catch (e: Exception) {
                    // Surfaces to JS as a rejected Promise — your existing try/catch
                    // around bakeVideo() in create.tsx already handles this and falls
                    // back to the unedited video, so this can't crash the app.
                    promise.reject("BAKE_ERROR", e.message ?: "Unknown error baking video", e)
                }
            }
        }
    }
}  
