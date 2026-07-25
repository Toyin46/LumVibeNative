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
            withContext(Dispatchers.Default) {
                val transcoder = VideoTranscoder()
                val opts = VideoTranscoder.Options(
                    watermarkPngPath = options["watermarkPngPath"] as? String,
                    captionText = options["captionText"] as? String,
                    brightness = (options["brightness"] as? Number)?.toFloat() ?: 0f,
                    contrast = (options["contrast"] as? Number)?.toFloat() ?: 1f,
                    saturation = (options["saturation"] as? Number)?.toFloat() ?: 1f
                )
                transcoder.transcode(inputPath, outputPath, opts) { progress ->
                    sendEvent("onProgress", mapOf("progress" to progress))
                }
                outputPath
            }
        }
    }
} 
