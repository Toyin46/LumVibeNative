package com.lumvibe.videobaker

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise

class VideoBakerModule : Module() {

    override fun definition() = ModuleDefinition {
        Name("VideoBaker")

        Events("onProgress")

        // inputPath / outputPath are plain filesystem paths (strip any "file://" prefix
        // before calling this from JS — expo-file-system gives you paths like that).
        //
        // Uses a plain background Thread + Promise instead of Kotlin coroutines —
        // avoids any dependency on expo-modules-kotlin's suspend-function support,
        // which varies across versions and was causing compile errors.
        AsyncFunction("bakeVideo") { inputPath: String, outputPath: String, options: Map<String, Any?>, promise: Promise ->
            Thread {
                try {
                    val transcoder = VideoTranscoder()
                    val opts = VideoTranscoder.Options(
                        watermarkPngPath = options["watermarkPngPath"] as? String,
                        captionText = options["captionText"] as? String,
                        brightness = (options["brightness"] as? Number)?.toFloat() ?: 0f,
                        contrast = (options["contrast"] as? Number)?.toFloat() ?: 1f,
                        saturation = (options["saturation"] as? Number)?.toFloat() ?: 1f
                    )
                    transcoder.transcode(inputPath, outputPath, opts) { progress: Float ->
                        sendEvent("onProgress", mapOf("progress" to progress))
                    }
                    promise.resolve(outputPath)
                } catch (e: Exception) {
                    promise.reject("ERR_BAKE_VIDEO", e.message ?: "Unknown error baking video", e)
                }
            }.start()
        }
    }
} 
