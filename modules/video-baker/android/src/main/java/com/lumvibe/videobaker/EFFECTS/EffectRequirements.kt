package com.lumvibe.videobaker

/**
* Which trackers each effect needs, and — for effects whose signal genuinely
* can't exist in a single still frame (temporal deltas, audio) — a documented,
* reasoned static substitute instead of a silent fake.
*
* This is a NEW, additive file. VideoTranscoder.kt's own copy of these sets
* (defined locally inside its transcode() function) is left completely
* untouched here — nothing about the already-verified video/live path changes
* as a result of this file existing. ImageBaker.kt is the only current caller.
* Migrating VideoTranscoder to call into this instead of its own local copy is
* a reasonable future cleanup, but doing it in the same change as introducing
* image baking would mean touching tested, working code for no immediate
* benefit — better done as its own isolated, verified step later.
*
* The sets below are copied verbatim from VideoTranscoder.kt's current
* classification (checked directly against that file's real content while
* writing this, not from memory) — if VideoTranscoder's sets change in the
* future, update both, or do the migration mentioned above so there's only
* one copy to keep in sync.
*/
object EffectRequirements {
    private val faceScoreEffects = setOf(VisualEffect.MOOD_RING, VisualEffect.WINK_SPARK, VisualEffect.SMILE_SHATTER)
    private val facePoseEffects = setOf(VisualEffect.HEAD_TILT_ZOOM, VisualEffect.DOUBLE_TAKE, VisualEffect.SPIN_EFFECT)
    private val faceBoxEffects = setOf(VisualEffect.VOICE_HALO, VisualEffect.RAISE_EYEBROW, VisualEffect.SPIN_EFFECT)
    private val irisEffects = setOf(VisualEffect.GAZE_TRAIL)
    private val blinkEffects = setOf(VisualEffect.BLINK_FREEZE)
    private val mouthEffects = setOf(VisualEffect.MOUTH_FIRE, VisualEffect.MOUTH_WORDS)
    // STICKERS_REACT needs smile blendshapes (like faceScoreEffects) but drives
    // particle-spawn triggering, not a shared intensity value — kept as its own
    // set rather than folded into faceScoreEffects so that group's existing
    // shared logic stays untouched. FACE_MORPH needs the FULL landmark list
    // (not a score/box/point) — also its own set for the same reason.
    private val faceLandmarkEffects = setOf(VisualEffect.STICKERS_REACT, VisualEffect.FACE_MORPH)
    private val segmentationAudioEffects = setOf(VisualEffect.DEPTH_BLOOM)
    private val segmentationOnlyEffects = setOf(VisualEffect.SPLIT_PRISM, VisualEffect.GOLD_SKIN)
    private val handGestureEffects = setOf(
        VisualEffect.HAND_PORTAL, VisualEffect.FIST_BUMP_BOOM, VisualEffect.TWO_HAND_FRAME, VisualEffect.THROW_CONFETTI,
        VisualEffect.PALM_MAGIC, VisualEffect.ROCK_PAPER_SCISSORS, VisualEffect.CLAP_BURST, VisualEffect.TAP_SHOCKWAVE,
        VisualEffect.FIRE_BOOK
    )

    // Effects whose intensity is normally driven by mic amplitude (or its
    // inverse) or by a stillness/motion timer accumulated across many frames —
    // none of that exists for a single still image. Rather than leave
    // effectIntensity at whatever FrameRenderer's default happens to be, each
    // gets ONE deliberate, reasoned static value — see applyStaticFrame's
    // comments for why each specific number was chosen, not just "a number."
    private val audioOrTimerDrivenEffects = setOf(
        VisualEffect.AURA_GLOW, VisualEffect.THERMAL_PULSE, VisualEffect.SILENCE_RIPPLE,
        VisualEffect.VOICE_HALO, VisualEffect.DEPTH_BLOOM, VisualEffect.COLOR_DRAIN, VisualEffect.SPLIT_PRISM
    )

    fun needsFaceTracker(effect: VisualEffect): Boolean =
        effect in faceScoreEffects || effect in facePoseEffects || effect in faceBoxEffects ||
            effect in irisEffects || effect in blinkEffects || effect in mouthEffects || effect in faceLandmarkEffects

    fun needsHandTracker(effect: VisualEffect): Boolean = effect in handGestureEffects

    fun needsSegmentation(effect: VisualEffect): Boolean =
        effect in segmentationAudioEffects || effect in segmentationOnlyEffects

    /**
     * Applies whatever CAN be honestly derived from a single frame (real
     * blendshape scores, real head pose, real hand positions — same math
     * VideoTranscoder uses, just once instead of per-frame), and a documented
     * static substitute for the handful of effects that structurally can't have
     * a single-frame value. Called once per bake, after setEffect().
     */
    fun applyStaticFrame(
        renderer: FrameRenderer,
        effect: VisualEffect,
        faceTracker: FaceTracker?,
        faceResult: com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult?,
        handTracker: HandTracker?,
        handResults: List<List<com.google.mediapipe.tasks.components.containers.NormalizedLandmark>>?
    ) {
        when (effect) {
            VisualEffect.MOOD_RING, VisualEffect.SMILE_SHATTER -> {
                // Real smile score from the actual photo — not a substitute.
                val left = faceResult?.let { faceTracker?.blendshapeScore(it, "mouthSmileLeft") } ?: 0f
                val right = faceResult?.let { faceTracker?.blendshapeScore(it, "mouthSmileRight") } ?: 0f
                renderer.effectIntensity = maxOf(left, right)
            }
            VisualEffect.WINK_SPARK -> {
                // Real wink asymmetry, same gate VideoTranscoder uses — if the
                // subject happens to be winking in the photo, that's an honest
                // read of the actual image, not an invented value.
                val l = faceResult?.let { faceTracker?.blendshapeScore(it, "eyeBlinkLeft") } ?: 0f
                val r = faceResult?.let { faceTracker?.blendshapeScore(it, "eyeBlinkRight") } ?: 0f
                renderer.effectIntensity = when {
                    l > 0.6f && r < 0.3f -> l
                    r > 0.6f && l < 0.3f -> r
                    else -> 0f
                }
            }
            VisualEffect.HEAD_TILT_ZOOM -> {
                // Real head tilt in the photo — the zoom/pan describes the
                // actual pose, not a fabricated motion.
                val pose = faceResult?.let { faceTracker?.headPoseDegrees(it) }
                val roll = pose?.get(0) ?: 0f
                val maxRollDeg = 25f
                val maxZoom = 1.35f
                val t = (kotlin.math.abs(roll) / maxRollDeg).coerceIn(0f, 1f)
                renderer.headTiltZoom = 1f + t * (maxZoom - 1f)
                renderer.headTiltPan = floatArrayOf((roll / maxRollDeg).coerceIn(-1f, 1f) * 0.15f, 0f)
            }
            VisualEffect.DOUBLE_TAKE -> {
                // Genuinely impossible on one frame — the whole effect IS a
                // frame-to-frame head-turn delta, and there is no previous
                // frame. Honest treatment per your own instruction ("a static
                // photo cannot actually blink") is a neutral no-op: zero
                // intensity, zero ghost offset, rather than inventing a fake
                // turn direction from nothing.
                renderer.effectIntensity = 0f
                renderer.doubleTakeDirection = 0f
            }
            VisualEffect.SPIN_EFFECT -> {
                // Unlike DOUBLE_TAKE, this one DOES have an honest single-frame
                // reading — head yaw at the moment the photo was taken is a real,
                // derivable value, not a temporal delta. Real box, real yaw.
                val box = faceResult?.let { faceTracker?.faceBoundingBox(it) }
                if (box != null) renderer.faceBox = box
                val pose = faceResult?.let { faceTracker?.headPoseDegrees(it) }
                val yaw = pose?.get(2) ?: 0f
                renderer.effectIntensity = (kotlin.math.abs(yaw) / 30f).coerceIn(0f, 1f)
            }
            VisualEffect.VOICE_HALO -> {
                val box = faceResult?.let { faceTracker?.faceBoundingBox(it) }
                if (box != null) renderer.faceBox = box
                // Intensity handled below in audioOrTimerDrivenEffects — VOICE_HALO
                // needs both the (real) face box AND a substitute brightness.
            }
            VisualEffect.RAISE_EYEBROW -> {
                val box = faceResult?.let { faceTracker?.faceBoundingBox(it) }
                if (box != null) renderer.faceBox = box
                // Real blendshape score — unlike VOICE_HALO, this one has a
                // genuine single-frame signal (how raised the brows are in the
                // actual photo), no static substitute needed at all.
                val innerUp = faceResult?.let { faceTracker?.blendshapeScore(it, "browInnerUp") } ?: 0f
                val outerL = faceResult?.let { faceTracker?.blendshapeScore(it, "browOuterUpLeft") } ?: 0f
                val outerR = faceResult?.let { faceTracker?.blendshapeScore(it, "browOuterUpRight") } ?: 0f
                renderer.effectIntensity = maxOf(innerUp, outerL, outerR)
            }
            VisualEffect.GAZE_TRAIL -> {
                // A trail needs history that doesn't exist for a still — the
                // honest single-frame equivalent is ONE static point at the
                // subject's actual gaze position, not a moving trail.
                val iris = faceResult?.let { faceTracker?.irisCenter(it) }
                if (iris != null) {
                    renderer.gazePoints = FloatArray(16)
                    renderer.gazePoints[0] = iris.first
                    renderer.gazePoints[1] = iris.second
                    renderer.gazeAges = FloatArray(8)
                    renderer.gazeCount = 1
                } else {
                    renderer.gazeCount = 0
                }
            }
            VisualEffect.BLINK_FREEZE -> {
                // The whole mechanic is "freeze a moment that was previously
                // moving" — a still image has no motion to freeze FROM, so
                // there's no honest freeze-punch to apply. ImageBaker simply
                // never engages captureFreezeFrame()/drawFrozenFrame() for
                // this effect — ordinary rendering is the correct, non-fake
                // outcome, not a stand-in value here.
            }
            VisualEffect.MOUTH_FIRE -> {
                // Real jawOpen score and real mouth position from the photo.
                val jawOpen = faceResult?.let { faceTracker?.blendshapeScore(it, "jawOpen") } ?: 0f
                renderer.effectIntensity = jawOpen
                val mouth = faceResult?.let { faceTracker?.mouthCenter(it) }
                if (mouth != null) renderer.mouthCenter = floatArrayOf(mouth.first, mouth.second)
            }
            VisualEffect.HAND_PORTAL -> {
                val first = handResults?.firstOrNull()
                if (first != null && handTracker != null) {
                    val c = handTracker.palmCenter(first)
                    renderer.portalCenter = floatArrayOf(c.first, c.second)
                }
            }
            VisualEffect.FIST_BUMP_BOOM -> {
                // Real fist detection — if the subject's hand IS closed in the
                // photo, a fixed "just punched" energy is a fair static read of
                // that pose, not invented. If no fist is detected, energy is 0
                // (effect present but visually neutral).
                val first = handResults?.firstOrNull()
                val isFist = first != null && handTracker != null && handTracker.isFist(first)
                renderer.boomEnergy = if (isFist) 0.6f else 0f
                if (first != null && handTracker != null) {
                    val c = handTracker.palmCenter(first)
                    renderer.boomCenter = floatArrayOf(c.first, c.second)
                }
            }
            VisualEffect.TWO_HAND_FRAME -> {
                if (handResults != null && handResults.size >= 2 && handTracker != null) {
                    val c1 = handTracker.palmCenter(handResults[0])
                    val c2 = handTracker.palmCenter(handResults[1])
                    renderer.frameRect = floatArrayOf(
                        minOf(c1.first, c2.first), minOf(c1.second, c2.second),
                        maxOf(c1.first, c2.first), maxOf(c1.second, c2.second)
                    )
                }
            }
            else -> {}
        }

        if (effect in audioOrTimerDrivenEffects) {
            renderer.effectIntensity = when (effect) {
                // No mic input exists for a still image — a fixed, moderate
                // glow reads as "present but calm" rather than either off (looks
                // broken/half-applied) or maxed (looks like a rendering bug).
                VisualEffect.AURA_GLOW, VisualEffect.THERMAL_PULSE, VisualEffect.VOICE_HALO -> 0.55f
                // SILENCE_RIPPLE's whole premise is "ripples when it goes
                // quiet" — a photo has no sound at all, which IS silence by
                // definition. Full intensity is the honest reading, not
                // arbitrary.
                VisualEffect.SILENCE_RIPPLE -> 1f
                // DEPTH_BLOOM's bloom pulses with amplitude in video; same
                // "present but calm" reasoning as AURA_GLOW above.
                VisualEffect.DEPTH_BLOOM -> 0.5f
                // COLOR_DRAIN drains the longer the subject holds still — a
                // photograph is the maximum possible stillness by definition,
                // so full drain is the honest reading, not a guess.
                VisualEffect.COLOR_DRAIN -> 1f
                // SPLIT_PRISM's split is driven by motion magnitude — a still
                // image has zero motion, so zero split is correct, not a
                // placeholder.
                VisualEffect.SPLIT_PRISM -> 0f
                else -> renderer.effectIntensity
            }
        }
    }
} 
