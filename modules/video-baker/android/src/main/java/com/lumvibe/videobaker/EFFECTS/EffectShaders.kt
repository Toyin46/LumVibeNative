package com.lumvibe.videobaker

/**
* "Phase 1" visual effects  -  the ones that need ONLY the decoded video frame
* itself, no MediaPipe face/hand tracking, no audio decode, no device motion.
* That's why these five are safe to ship now: Mood Ring, Gaze Trail, Hand
* Portal, Split Prism, and the audio-beat-synced version of Duotone Pulse all
* need extra subsystems (face mesh, hand landmarks, mic amplitude, or device
* motion capture) that aren't wired into VideoTranscoder yet. See the README
* for the phased plan to add those.
*
* Every fragment shader here samples the decoder's output directly
* (samplerExternalOES), so each one is a drop-in replacement for the plain
* "pass-through" video shader already in FrameRenderer  -  see drawEffectFrame().
*/
enum class VisualEffect {
    NONE,
    // ---- Phase 1: pure shader, only needs the decoded frame ----
    VINTAGE_FLICKER,
    NEON_EDGE,
    DUOTONE_PULSE,
    LIQUID_CHROME,
    INK_WASH,
    // 🆕 Replaces THERMAL_PULSE/GOLD_SKIN/AURA_GLOW (removed — all three were
    // MediaPipe/audio-reactive and never stabilized). Deliberately pure-shader,
    // same category as NEON_EDGE above: no face/hand/segmentation tracker, no
    // audio reader, nothing that can silently stop delivering results mid-
    // session. Runs through the exact same generic uTexture/uTexMatrix/
    // uTexelSize/uIntensity pipeline every other Phase 1 effect already uses,
    // so it needed zero new Kotlin wiring beyond this enum entry + the two
    // `when` branches below.
    SKIN_SMOOTH,
    // ---- Phase 2: needs FaceTracker's per-frame blendshape score, driven through
    // the same repurposed-uIntensity pattern MOOD_RING introduced. See
    // VideoTranscoder.FACE_SCORE_EFFECTS for the generic wiring (added below  -
    // MOOD_RING's original hardcoded branch has been folded into that set). ----
    MOOD_RING,
    WINK_SPARK,     // uIntensity = single-eye blink score (one eye closed, other open)
    SMILE_SHATTER,  // uIntensity = smile score (same signal as MOOD_RING, different shader)
    // ---- Phase 2b: needs FaceTracker's head-pose decomposition (headPoseDegrees)  -
    // see VideoTranscoder.FACE_POSE_EFFECTS. Not yet wired; see README note. ----
    HEAD_TILT_ZOOM,
    // ---- Phase 3: needs AudioAmplitudeReader  -  see VideoTranscoder.AUDIO_SCORE_EFFECTS ----
    AURA_GLOW,      // uIntensity = normalized audio amplitude (stand-in for "voice pitch,"
                     // which needs real pitch detection  -  see class doc below)
    // ---- Phase 3b: needs per-frame motion estimate computed in Kotlin (frame-to-frame
    // luma diff), not a new tracker class  -  see VideoTranscoder.stillnessSeconds ----
    COLOR_DRAIN,
    // ---- Phase 4: needs AudioAmplitudeReader (already built) ----
    SILENCE_RIPPLE,      // ripples out from center when audio drops below a threshold
    // ---- Phase 4b: needs FaceTracker.faceBoundingBox + AudioAmplitudeReader together ----
    VOICE_HALO,          // glow ring sized to the face box, brightness from mic volume
    THERMAL_PULSE,       // heat-map palette, pulsing with audio amplitude (breath-rhythm stand-in)
    // ---- Phase 5: needs SegmentationTracker (new) ----
    DEPTH_BLOOM,         // background blooms (audio-reactive), foreground stays sharp
    SPLIT_PRISM,         // background splits into RGB layers, foreground doesn't
    // ---- Phase 6: needs HandTracker (already built) ----
    HAND_PORTAL,         // circular portal region (from palm center) shows a different scene
    FIST_BUMP_BOOM,      // closed-fist gesture triggers screen shake + burst, with decay
    TWO_HAND_FRAME,      // both hands forming a rough rectangle triggers a vignette frame
    // ---- Phase 7: temporal effects. GAZE_TRAIL and DOUBLE_TAKE turned out to be
    // achievable as SINGLE-PASS shader tricks (position history / directional streak)
    // rather than needing real cross-frame GPU buffers  -  see their shader docs below.
    // BLINK_FREEZE is the one genuine exception: it holds one captured frame across
    // several output frames, which needs FrameRenderer's new freeze-capture texture. ----
    GAZE_TRAIL,          // particle trail following iris position, last N positions only
    DOUBLE_TAKE,         // directional ghost streak on fast head turn (yaw delta)
    BLINK_FREEZE,        // freeze-frame + zoom punch on blink, held for ~0.3s
    // ---- Phase 8: same trackers as above (SegmentationTracker, FaceTracker), new
    // visual treatments  -  full-body recolor and a mouth-anchored procedural flame. ----
    GOLD_SKIN,           // person (via segmentation mask) recolored through a metallic
                          // gold gradient, luminance-mapped so shading/detail survives  -
                          // background untouched. Needs SegmentationTracker only.
    MOUTH_FIRE,          // procedural flame anchored at mouth center, sized by how open
                          // the mouth is (jawOpen blendshape). Needs FaceTracker.
    // ---- Particle system core: two techniques  -
    //   SNOW_FALL: fully procedural/stateless, generated straight in GLSL from
    //     uTime  -  no tracker, no CPU particle state, cheapest possible effect.
    //   THROW_CONFETTI: real CPU-simulated particles (position/velocity/gravity/
    //     rotation/lifetime) via ParticleSystem.kt, triggered by a detected hand
    //     "throw" (rapid palm velocity spike), packed into a fixed-size uniform
    //     array  -  same array-uniform convention GAZE_TRAIL already established. ----
    SNOW_FALL,
    THROW_CONFETTI,
    // ---- Step 3 of the plan: new effects using only patterns already proven  -
    // no new subsystem, unlike image baking / particles above. ----
    RAISE_EYEBROW,       // glow/lift accent above the eyebrows, driven by real
                          // browInnerUp/browOuterUp blendshapes  -  same repurposed-
                          // uIntensity pattern as MOOD_RING/SMILE_SHATTER.
    GLITCH_WAVE,         // RGB channel split + scanline displacement, pure uTime-
                          // driven screen-space shader, no tracker needed.
    RETRO_VHS,           // scanlines + chromatic aberration + horizontal tracking
                          // wobble, pure uTime-driven, no tracker needed.
    LIGHT_LEAK,          // warm colored light streaks sweeping across the frame,
                          // pure uTime-driven, no tracker needed.
    MOUTH_WORDS,         // reactive "WOW!/OMG!/HAHA!" text near the mouth, chosen
                          // from real jawOpen/smile/browInnerUp blendshapes. This
                          // one is a passthrough shader  -  the actual text is a
                          // POSITIONED overlay draw (OverlayBuilder.buildWordBubble
                          // + FrameRenderer.drawWatermarkAt, reused as-is) done in
                          // VideoTranscoder after the effect frame, same layering
                          // as the caption/watermark. Not real speech-to-text  -
                          // there's no on-device ASR in this project; this is an
                          // honest reactive-exclamation effect, not a fake
                          // transcription. Flagged clearly, not hidden.
    // ---- Gesture classifier expansion  -  built on HandTracker.classifyGesture()/
    // fingerStates(), real per-finger extended/curled detection, not a fake
    // binary. SPIN_EFFECT is the one exception  -  it's head-yaw driven
    // (FaceTracker), grouped here only because the plan grouped it here. ----
    PALM_MAGIC,          // gentle sparkle particles rise from an open palm  -
                          // second real use of ParticleSystem.kt (low/negative
                          // gravity instead of confetti's downward arc), proves
                          // the particle core isn't single-purpose.
    ROCK_PAPER_SCISSORS,  // labels the currently-detected hand shape (ROCK/PAPER/
                          // SCISSORS) as a positioned text bubble  -  reuses
                          // OverlayBuilder.buildWordBubble + drawWatermarkAt,
                          // the exact same mechanism MOUTH_WORDS already proved.
    CLAP_BURST,          // both palms detected rapidly closing distance  -  burst +
                          // particles + glow at the meeting point.
    TAP_SHOCKWAVE,       // index fingertip rapid-move-then-stop ("poke")  -
                          // expanding ring, reuses boomEnergy/boomCenter's decay
                          // as the ring's radius/opacity driver, no new uniforms.
    SPIN_EFFECT,         // rotating light ring anchored to the face, driven by
                          // real head yaw (FaceTracker.headPoseDegrees)  -  same
                          // architecture category as RAISE_EYEBROW, not a new
                          // gesture at all.
    // ---- Final phase: the three hardest  -  each needed real design decisions,
    // documented at each shader/wiring site below, not just "a new effect." ----
    FACE_MORPH,          // half-face wireframe mesh from REAL landmark positions,
                          // connected by actual computed nearest-neighbor proximity
                          // (not hardcoded topology I can't fully verify)  -  drawn on
                          // the CPU via Canvas, composited through the EXISTING
                          // uMaskTexture/uploadSecondaryTexture mechanism, zero new
                          // FrameRenderer uniforms.
    FIRE_BOOK,           // hand-tracked book image (asset-path, same convention as
                          // HAND_PORTAL's portalScenePngPath  -  NO book asset exists
                          // in this project, you supply one) + real fire particles
                          // (ParticleSystem, third tuning) + glow.
    STICKERS_REACT,      // real smile-triggered ParticleSystem spawning procedural
                          // heart/sparkle SHAPES (not a static emoji glued on)  -
                          // real trigger, real physics, matches section 2's "not
                          // the MAIN implementation" rule for literal emoji.
    // ---- Phase 9: the 5 effects that shipped in the UI (cover image + FX_EFFECTS
    // entry) with no matching case here, so selecting them was a silent no-op.
    // Writing real shaders for all 5 now, each following the closest-matching
    // existing pattern rather than inventing a new technique:
    //   BOKEH_LIGHTS / PARTICLE_FLOW / RAIN_FALL - pure Phase-1-style shaders,
    //     only need uTime/uTexture (already set for every effect), no tracker.
    //   PAINT_SPLASH - reuses the SAME frame-to-frame motion delta SPLIT_PRISM
    //     already uses (see VideoTranscoder.motionEffects), just a different
    //     visual treatment of the same signal.
    //   FINGER_DRAW - reuses GAZE_TRAIL's exact "last N positions" trail
    //     technique, driven by the hand tracker's index fingertip (landmark 8)
    //     instead of the iris, since this is an in-frame gesture effect like
    //     the other HAND_PORTAL/FIST_BUMP_BOOM-style effects, not a touchscreen
    //     draw (can't touch the screen and be filmed at the same time anyway).
    BOKEH_LIGHTS,
    PARTICLE_FLOW,
    RAIN_FALL,
    PAINT_SPLASH,
    FINGER_DRAW;

    companion object {
        /** Maps the JS-facing string (e.g. "neon_edge") to an enum value. Unknown/null -> NONE. */
        fun fromKey(key: String?): VisualEffect = when (key) {
            "vintage_flicker" -> VINTAGE_FLICKER
            "neon_edge" -> NEON_EDGE
            "duotone_pulse" -> DUOTONE_PULSE
            "liquid_chrome" -> LIQUID_CHROME
            "ink_wash" -> INK_WASH
            "skin_smooth" -> SKIN_SMOOTH
            "mood_ring" -> MOOD_RING
            "wink_spark" -> WINK_SPARK
            "smile_shatter" -> SMILE_SHATTER
            "head_tilt_zoom" -> HEAD_TILT_ZOOM
            // ⛔ REMOVED (broken — audio-reactive tracking effect never stabilized, cut per user request): "aura_glow" -> AURA_GLOW
            "color_drain" -> COLOR_DRAIN
            "silence_ripple" -> SILENCE_RIPPLE
            "voice_halo" -> VOICE_HALO
            // ⛔ REMOVED (broken — audio-reactive tracking effect never stabilized, cut per user request): "thermal_pulse" -> THERMAL_PULSE
            "depth_bloom" -> DEPTH_BLOOM
            "split_prism" -> SPLIT_PRISM
            "hand_portal" -> HAND_PORTAL
            "fist_bump_boom" -> FIST_BUMP_BOOM
            "two_hand_frame" -> TWO_HAND_FRAME
            "gaze_trail" -> GAZE_TRAIL
            "double_take" -> DOUBLE_TAKE
            "blink_freeze" -> BLINK_FREEZE
            // ⛔ REMOVED (broken — segmentation-tracking effect never stabilized, cut per user request): "gold_skin" -> GOLD_SKIN
            // ⛔ REMOVED (not working reliably, cut per user request): "mouth_fire" -> MOUTH_FIRE
            "snow_fall" -> SNOW_FALL
            "throw_confetti" -> THROW_CONFETTI
            "raise_eyebrow" -> RAISE_EYEBROW
            "glitch_wave" -> GLITCH_WAVE
            "retro_vhs" -> RETRO_VHS
            "light_leak" -> LIGHT_LEAK
            "mouth_words" -> MOUTH_WORDS
            "palm_magic" -> PALM_MAGIC
            "rock_paper_scissors" -> ROCK_PAPER_SCISSORS
            "clap_burst" -> CLAP_BURST
            "tap_shockwave" -> TAP_SHOCKWAVE
            "spin_effect" -> SPIN_EFFECT
            "face_morph" -> FACE_MORPH
            // ⛔ REMOVED (not working reliably, cut per user request): "fire_book" -> FIRE_BOOK
            "stickers_react" -> STICKERS_REACT
            "bokeh_lights" -> BOKEH_LIGHTS
            "particle_flow" -> PARTICLE_FLOW
            "rain_fall" -> RAIN_FALL
            "paint_splash" -> PAINT_SPLASH
            "finger_draw" -> FINGER_DRAW
            else -> NONE
        }
    }
}

object EffectShaders {

    // Same vertex shader as the plain video pass  -  applies the SurfaceTexture's
    // transform matrix so orientation/cropping stays correct for every effect.
    private val effectVertexShader = """
        uniform mat4 uTexMatrix;
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying mediump vec2 vTexCoord; // FIX: was implicit highp, mismatched every fragment shader's mediump default from EXT_HEADER, causing "Could not link program: precision does not match" on some GPU drivers
        void main() {
            gl_Position = aPosition;
            vTexCoord = (uTexMatrix * aTexCoord).xy;
        }
    """.trimIndent()

    private const val EXT_HEADER = "#extension GL_OES_EGL_image_external : require\nprecision mediump float;\n"

    private val vintageFlicker = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;
        uniform float uIntensity;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 color = texture2D(uTexture, vTexCoord);

            // Flicker: brightness jitters per quantized "frame" of time, not per real frame,
            // so it looks like an old projector rather than random per-pixel noise.
            float frameSeed = floor(uTime * 24.0);
            float flicker = 0.94 + 0.06 * hash(vec2(frameSeed, 0.0));
            color.rgb *= mix(1.0, flicker, uIntensity);

            // Grain
            float grain = (hash(vTexCoord * 500.0 + frameSeed) - 0.5) * 0.08 * uIntensity;
            color.rgb += grain;

            // Light leak drifting slowly from a corner
            vec2 leakCenter = vec2(0.15 + 0.1 * sin(uTime * 0.1), 0.15 + 0.1 * cos(uTime * 0.07));
            float leakDist = distance(vTexCoord, leakCenter);
            float leak = smoothstep(0.6, 0.0, leakDist) * 0.35 * uIntensity;
            color.rgb += vec3(1.0, 0.55, 0.2) * leak;

            // Vignette
            float vig = smoothstep(0.9, 0.3, distance(vTexCoord, vec2(0.5)));
            color.rgb *= mix(1.0, vig, 0.4 * uIntensity);

            gl_FragColor = color;
        }
    """.trimIndent()

    private val neonEdge = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uTexelSize;
        uniform vec3 uGlowColor;
        uniform float uIntensity;

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            float tl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  1.0)).rgb);
            float t  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0,  1.0)).rgb);
            float tr = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  1.0)).rgb);
            float l  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  0.0)).rgb);
            float r  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  0.0)).rgb);
            float bl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0, -1.0)).rgb);
            float b  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0, -1.0)).rgb);
            float br = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0, -1.0)).rgb);

            float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
            float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
            float edge = clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0);

            vec3 dark = base.rgb * 0.25;
            vec3 glow = uGlowColor * edge;
            vec3 outColor = mix(dark, dark + glow, uIntensity);

            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    private val skinSmooth = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uTexelSize;
        uniform float uIntensity;

        void main() {
            vec4 center = texture2D(uTexture, vTexCoord);
            vec3 cc = center.rgb;

            // 8-neighbor ring, same offset pattern neonEdge already uses for its
            // Sobel taps — 1.5x texel stride smooths visibly without needing a
            // much larger (slower) kernel.
            vec2 o = uTexelSize * 1.5;
            vec3 c00 = texture2D(uTexture, vTexCoord + o * vec2(-1.0,  1.0)).rgb;
            vec3 c01 = texture2D(uTexture, vTexCoord + o * vec2( 0.0,  1.0)).rgb;
            vec3 c02 = texture2D(uTexture, vTexCoord + o * vec2( 1.0,  1.0)).rgb;
            vec3 c10 = texture2D(uTexture, vTexCoord + o * vec2(-1.0,  0.0)).rgb;
            vec3 c12 = texture2D(uTexture, vTexCoord + o * vec2( 1.0,  0.0)).rgb;
            vec3 c20 = texture2D(uTexture, vTexCoord + o * vec2(-1.0, -1.0)).rgb;
            vec3 c21 = texture2D(uTexture, vTexCoord + o * vec2( 0.0, -1.0)).rgb;
            vec3 c22 = texture2D(uTexture, vTexCoord + o * vec2( 1.0, -1.0)).rgb;

            // Range weight: a sample close in color to the center pixel counts
            // (near) fully; a sample far off (a real edge — eyebrow against
            // skin, eye against eyelid, hairline, jewelry) gets pushed toward
            // zero weight. THIS is what keeps skin looking smoothed instead of
            // the whole frame looking blurred — 8.0 is tuned to roughly zero
            // out anything more than ~12% off in any channel.
            float wSum = 1.0;
            vec3 sum = cc;
            float w;
            w = 1.0 - clamp(distance(c00, cc) * 8.0, 0.0, 1.0); sum += c00 * w; wSum += w;
            w = 1.0 - clamp(distance(c01, cc) * 8.0, 0.0, 1.0); sum += c01 * w; wSum += w;
            w = 1.0 - clamp(distance(c02, cc) * 8.0, 0.0, 1.0); sum += c02 * w; wSum += w;
            w = 1.0 - clamp(distance(c10, cc) * 8.0, 0.0, 1.0); sum += c10 * w; wSum += w;
            w = 1.0 - clamp(distance(c12, cc) * 8.0, 0.0, 1.0); sum += c12 * w; wSum += w;
            w = 1.0 - clamp(distance(c20, cc) * 8.0, 0.0, 1.0); sum += c20 * w; wSum += w;
            w = 1.0 - clamp(distance(c21, cc) * 8.0, 0.0, 1.0); sum += c21 * w; wSum += w;
            w = 1.0 - clamp(distance(c22, cc) * 8.0, 0.0, 1.0); sum += c22 * w; wSum += w;
            vec3 smoothed = sum / wSum;

            // Blend toward smoothed rather than replacing outright — even
            // though the range weighting already preserves edges, mixing at
            // 0.7 instead of going fully smoothed keeps real skin texture
            // instead of an airbrushed/plastic look. uIntensity defaults to
            // 1.0 here (SKIN_SMOOTH isn't in audioDirectEffects/motionEffects/
            // stillnessEffects, so nothing ever overwrites it) — full, steady
            // strength every frame, no tracking signal required.
            vec3 outColor = mix(cc, smoothed, 0.7 * uIntensity);

            // Small, consistent brightness + warmth lift rather than a color
            // grade — reads as "healthy glow", not a filter.
            outColor *= 1.03;
            outColor += vec3(0.012, 0.008, 0.0) * uIntensity;

            gl_FragColor = vec4(outColor, center.a);
        }
    """.trimIndent()

    private val duotonePulse = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        uniform float uPulseSpeed;

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float l = luma(src.rgb);

            // NOTE: this swaps on elapsed video time, as a stand-in for real audio-beat
            // sync (which needs the audio-amplitude decode pass  -  see README Phase 2).
            float phase = 0.5 + 0.5 * sin(uTime * uPulseSpeed * 6.28318);
            vec3 low = mix(uColorA, uColorB, step(0.5, phase));
            vec3 high = mix(uColorB, uColorA, step(0.5, phase));

            vec3 duotone = mix(low, high, l);
            gl_FragColor = vec4(duotone, src.a);
        }
    """.trimIndent()

    private val liquidChrome = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;
        uniform float uIntensity;

        void main() {
            vec2 uv = vTexCoord;
            float t = uTime * 0.6;

            vec2 warp = vec2(
                sin(uv.y * 12.0 + t) * 0.010,
                cos(uv.x * 10.0 + t * 1.3) * 0.010
            ) * uIntensity;

            vec2 uvR = uv + warp + vec2(0.004, 0.0) * uIntensity;
            vec2 uvG = uv + warp;
            vec2 uvB = uv + warp - vec2(0.004, 0.0) * uIntensity;

            float r = texture2D(uTexture, uvR).r;
            float g = texture2D(uTexture, uvG).g;
            float b = texture2D(uTexture, uvB).b;
            float a = texture2D(uTexture, uvG).a;

            vec3 color = vec3(r, g, b);

            // Faux metallic sheen sweeping diagonally across the frame
            float sheen = smoothstep(0.05, 0.0, abs(fract(uv.x + uv.y - t * 0.3) - 0.5));
            color += sheen * 0.25 * uIntensity;

            gl_FragColor = vec4(color, a);
        }
    """.trimIndent()

    private val inkWash = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uTexelSize;
        uniform float uIntensity;

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);

            float tl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  1.0)).rgb);
            float t  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0,  1.0)).rgb);
            float tr = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  1.0)).rgb);
            float l  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  0.0)).rgb);
            float r  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  0.0)).rgb);
            float bl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0, -1.0)).rgb);
            float b  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0, -1.0)).rgb);
            float br = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0, -1.0)).rgb);

            float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
            float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
            float edge = clamp(sqrt(gx * gx + gy * gy) * 1.5, 0.0, 1.0);

            float gray = luma(src.rgb);
            vec3 paper = mix(vec3(0.93, 0.90, 0.82), vec3(0.2, 0.18, 0.15), gray * 0.3);
            vec3 ink = vec3(0.08, 0.08, 0.1);
            vec3 result = mix(paper, ink, edge);

            gl_FragColor = vec4(mix(src.rgb, result, uIntensity), src.a);
        }
    """.trimIndent()

    // Phase 2, simplified first version: a global hue rotation driven by live smile
    // score, not restricted to just the skin/face region. The original pitch was
    // "skin-tone area only"  -  that needs a face-contour mask built from landmark
    // points, which is a real follow-on step once this base pipeline (readback ->
    // FaceTracker -> per-frame score -> shader) is confirmed working end to end.
    // uIntensity is repurposed here to carry the live smile score (0..1) each frame,
    // set by VideoTranscoder right before this draw call  -  same uniform, no new
    // plumbing needed.
    // Mood Ring  -  REBUILT from a full-frame hue-shift into an actual ring
    // graphic around the face, confirmed against the app's own reference image
    // (a smooth rainbow-gradient ring, not a whole-frame color shift). Reuses
    // uFaceBox (same real tracked signal every face-box effect here uses) and
    // the same layered-glow-ring technique as VOICE_HALO, recolored with a
    // continuous hue sweep around the ring's circumference instead of a
    // single reactive color. Smile score still drives it - brightness, spin
    // speed - so it's still a real "mood" reaction, just shaped as a ring now.
    private val moodRing = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox;
        uniform float uIntensity; // repurposed: live smile score 0..1
        uniform float uTime;

        vec3 hsv2rgb(vec3 c) {
            vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
            return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
            float boxSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
            float baseRadius = boxSize * 0.8;
            vec2 rel = vTexCoord - center;
            float d = length(rel);
            float angle = atan(rel.y, rel.x);

            float response = pow(clamp(uIntensity, 0.0, 1.0), 0.6);
            float idleBreath = 0.03 * sin(uTime * 1.1);
            // Ring slowly rotates on its own, faster with a bigger smile - a
            // mood ring should feel alive before you even react to it.
            float spin = uTime * (0.12 + response * 0.5);
            float radius = baseRadius * (1.0 + idleBreath + response * 0.08);

            float glow = 0.0;
            for (int i = 0; i < 3; i++) {
                float ringOffset = float(i) * 0.05;
                float ringDist = abs(d - (radius - ringOffset));
                float falloff = exp(-ringDist * ringDist * 1000.0);
                glow += falloff * (1.0 - float(i) * 0.3);
            }
            glow *= (0.45 + response * 0.9);

            // Continuous rainbow sweep around the circumference - the actual
            // visual identity of "mood ring," matching the reference.
            float hue = fract((angle / 6.28318) + spin);
            vec3 ringColor = hsv2rgb(vec3(hue, 0.85, 1.0));

            gl_FragColor = vec4(base.rgb + ringColor * glow, base.a);
        }
    """.trimIndent()

    // Wink Spark  -  REWRITTEN twice over: (1) uSparkOrigin is now the real
    // wink-side eye landmark position (see FaceTracker.eyeCenter(), wired into
    // all three dispatch paths above) instead of a fixed screen-space guess;
    // (2) the spark itself is now actual 5-pointed star shapes - three,
    // staggered sizes and independent rotation speeds, reading as a small
    // sparkle cluster - instead of a radial ray-burst comb pattern, matching
    // the reference image.
    private val winkSpark = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: wink score 0..1
        uniform vec2 uSparkOrigin; // real eye landmark position now
        uniform float uTime;

        vec2 rot(vec2 p, float a) {
            float c = cos(a);
            float s = sin(a);
            return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
        }

        // Cheap 5-point star: radius alternates between outerR (at each
        // point's tip) and innerR (at the gap between points) as angle
        // sweeps around - a well-known, good-enough approximation for a
        // small on-screen sparkle, not a precise geometric star SDF.
        float star(vec2 p, float points, float innerR, float outerR) {
            float angle = atan(p.y, p.x);
            float d = length(p);
            float seg = 6.28318 / points;
            float a = mod(angle, seg) - seg * 0.5;
            float r = mix(outerR, innerR, smoothstep(0.0, seg * 0.5, abs(a)));
            return smoothstep(r, r * 0.85, d);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 o1 = uSparkOrigin;
            vec2 o2 = uSparkOrigin + vec2(0.035, -0.02);
            vec2 o3 = uSparkOrigin + vec2(-0.03, 0.025);
            float spark = 0.0;
            spark += star(rot(vTexCoord - o1, uTime), 5.0, 0.006, 0.028);
            spark += star(rot(vTexCoord - o2, -uTime * 1.4), 5.0, 0.003, 0.014) * 0.7;
            spark += star(rot(vTexCoord - o3, uTime * 1.7), 5.0, 0.003, 0.011) * 0.6;
            spark = clamp(spark, 0.0, 1.0) * uIntensity;

            vec3 sparkColor = vec3(1.0, 0.92, 0.55);
            gl_FragColor = vec4(base.rgb + sparkColor * spark * 2.0, base.a);
        }
    """.trimIndent()

    // Smile Shatter  -  REWRITTEN from a 5-line crack decal to an actual
    // polygonal shard shatter, matching the reference look (real glass pieces
    // flying off, not lines drawn on top). Technique: jittered-grid Voronoi  -
    // the screen is divided into irregular cells (like real broken glass,
    // not a uniform grid), each cell independently displaced outward from
    // frame center with its own random speed/rotation-drift, sampling the
    // ORIGINAL video at the offset UV so each shard visually carries a real
    // piece of the image with it, not a flat color. Cell boundaries get a
    // bright edge glint (the standard "d2-d1" Voronoi trick) so shards read
    // as faceted glass catching light, not just displaced blocks. uIntensity
    // still carries the live smile score exactly as before  -  same uniform,
    // same VideoTranscoder/EffectRequirements wiring, only the shader changed.
    private val smileShatter = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: smile score 0..1
        uniform float uTime;

        float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec2 hash2(vec2 p) {
            vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(q) * 43758.5453);
        }

        // Jittered-grid Voronoi: each grid cell gets one random point inside
        // it, so cell shapes come out irregular (like real fracture pieces)
        // instead of a uniform tile grid. Returns the winning cell's integer
        // id, distance to its point (d1), and distance to the SECOND-nearest
        // point (d2)  -  d2-d1 near zero is exactly a cell boundary, which is
        // what drives the edge glint below.
        void voronoi(vec2 uv, float cellSize, out vec2 cellId, out float d1, out float d2) {
            vec2 g = floor(uv / cellSize);
            d1 = 8.0; d2 = 8.0; cellId = g;
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    vec2 neighbor = g + vec2(float(x), float(y));
                    vec2 point = (neighbor + hash2(neighbor)) * cellSize;
                    float d = distance(uv, point);
                    if (d < d1) { d2 = d1; d1 = d; cellId = neighbor; }
                    else if (d < d2) { d2 = d; }
                }
            }
        }

        void main() {
            vec2 uv = vTexCoord;
            // Needs a real smile to fully shatter, not a half-smirk.
            float response = pow(clamp(uIntensity, 0.0, 1.0), 1.4);

            vec2 cid; float d1; float d2;
            voronoi(uv, 0.055, cid, d1, d2);

            // Each shard's own center point, and its direction/distance from
            // frame center  -  shards further from center fly out faster and
            // further, exactly like a real impact radiating outward.
            vec2 cellCenter = (cid + hash2(cid)) * 0.055;
            vec2 fromCenter = cellCenter - vec2(0.5, 0.5);
            float distFromCenter = length(fromCenter) + 0.001;
            vec2 outward = fromCenter / distFromCenter;

            // Per-shard random speed so the burst doesn't move as one rigid
            // sheet  -  some pieces lag, some lead, like real broken glass.
            float shardSeed = hash1(cid);
            float shardSpeed = 0.6 + shardSeed * 0.8;
            float displaceAmount = response * distFromCenter * shardSpeed * 0.35;

            // Small tangential drift per shard reads as tumbling rotation
            // without needing actual per-shard rotation matrices.
            vec2 tangent = vec2(-outward.y, outward.x);
            float spin = (hash1(cid + 17.3) - 0.5) * 2.0;
            vec2 displacement = outward * displaceAmount + tangent * displaceAmount * spin * 0.4;

            vec2 sampleUv = uv - displacement;
            vec4 src = (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0)
                ? vec4(0.03, 0.03, 0.05, 1.0) // dark gap where a shard has flown clear off-frame
                : texture2D(uTexture, sampleUv);

            // Edge glint  -  brighter on shards that have moved further, since
            // those are catching more implied light as they tumble free.
            float edge = smoothstep(0.01, 0.0, d2 - d1);
            float edgeBrightness = 0.4 + 0.6 * clamp(displaceAmount * 4.0, 0.0, 1.0);
            vec3 edgeGlint = vec3(0.9, 0.96, 1.0) * edge * edgeBrightness * response;

            // Shards that have flown far enough fade toward a dark gap rather
            // than staying at full opacity forever  -  sells depth/distance.
            float fade = 1.0 - smoothstep(0.15, 0.4, displaceAmount);
            vec3 outColor = mix(vec3(0.02, 0.02, 0.03), src.rgb, fade) + edgeGlint;

            gl_FragColor = vec4(outColor, 1.0);
        }
    """.trimIndent()

    // Aura Glow  -  REWRITTEN: was a frame-wide Sobel edge-glow (lit up ANY edge
    // in the shot - background clutter included, not just the person), which is
    // why it read as thin/generic next to the reference image's aura hugging the
    // body outline. Now uses uMaskTexture (same real segmentation mask as GOLD_
    // SKIN/DEPTH_BLOOM/SPLIT_PRISM - added to EffectRequirements.segmentationAudio
    // Effects for this) two ways: (1) the local Sobel detail-glow is restricted to
    // ON the person only, a rim-light on real hair/face/clothing edges instead of
    // whatever happened to be in the background; (2) a separate "reach" term
    // samples the mask at 8 angles x 2 radii (16 taps, each angle's radius jittered
    // by a per-pixel hash) to estimate how close a BACKGROUND pixel sits to the
    // silhouette, so the glow visibly extends past the body edge with an uneven,
    // tendril-like falloff instead of a uniform ring. 16 taps is deliberately kept
    // under DEPTH_BLOOM's existing 25-tap blur elsewhere in this file, as a budget
    // anchor for what this codebase already runs on low-end hardware. Color-rotate
    // and audio-amplitude-driven intensity are unchanged from the original version.
    // Pitch-reactive color (vs. amplitude) remains a documented future upgrade,
    // not something silently faked as "pitch" - unchanged reasoning from before.
    private val auraGlow = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;
        uniform vec2 uTexelSize;
        uniform float uTime;
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        vec3 hsv2rgb(vec3 c) {
            vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
            return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float mask = texture2D(uMaskTexture, vTexCoord).a; // ALPHA_8: 1.0 = person

            float tl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  1.0)).rgb);
            float t  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0,  1.0)).rgb);
            float tr = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  1.0)).rgb);
            float l  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0,  0.0)).rgb);
            float r  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0,  0.0)).rgb);
            float bl = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2(-1.0, -1.0)).rgb);
            float b  = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 0.0, -1.0)).rgb);
            float br = luma(texture2D(uTexture, vTexCoord + uTexelSize * vec2( 1.0, -1.0)).rgb);
            float gx = -tl - 2.0 * l - bl + tr + 2.0 * r + br;
            float gy = -tl - 2.0 * t - tr + bl + 2.0 * b + br;
            float detailEdge = clamp(sqrt(gx * gx + gy * gy), 0.0, 1.0) * mask;

            // Outward reach: for background pixels, sample the mask at 8 angles
            // x 2 radii, each radius jittered per-angle, and see how much
            // "person" turns up nearby - close to the silhouette, this is high;
            // far away, it fades to zero. 16 taps total.
            float reach = 0.0;
            for (int i = 0; i < 8; i++) {
                float angle = (float(i) / 8.0) * 6.28318;
                vec2 dir = vec2(cos(angle), sin(angle));
                float jitter = 0.55 + 0.65 * hash(vTexCoord * 80.0 + float(i) * 3.7);
                for (int j = 1; j <= 2; j++) {
                    float dist = float(j) * jitter;
                    vec2 sampleUv = vTexCoord + dir * uTexelSize * dist * 16.0;
                    reach += texture2D(uMaskTexture, sampleUv).a / (float(j) * 2.0);
                }
            }
            reach = clamp(reach / 8.0, 0.0, 1.0) * (1.0 - mask);

            float hue = fract(uTime * 0.08);
            vec3 glowColor = hsv2rgb(vec3(hue, 0.85, 1.0));
            float glowAmount = (detailEdge + reach) * (0.3 + 0.9 * uIntensity);
            vec3 outColor = base.rgb + glowColor * glowAmount;

            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Color Drain  -  uIntensity here is repurposed to carry "stillness" (0 = just
    // moved, 1 = been still for a while), computed in VideoTranscoder from
    // frame-to-frame luma difference (see stillnessSeconds there) rather than a
    // device motion sensor. That substitution is a deliberate, necessary
    // adaptation: this whole pipeline bakes effects into an ALREADY-RECORDED
    // file after the fact, so there is no live gyroscope/accelerometer stream
    // available during the bake pass  -  motion has to be estimated from the
    // pixels themselves.
    private val colorDrain = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: stillness amount 0..1

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float gray = luma(src.rgb);
            vec3 desaturated = vec3(gray);
            gl_FragColor = vec4(mix(src.rgb, desaturated, uIntensity), src.a);
        }
    """.trimIndent()

    // Head Tilt Zoom needs its OWN vertex shader (not the shared effectVertexShader)
    // because the zoom/pan happens by scaling+offsetting the vertex position itself,
    // not by sampling a different UV in the fragment shader  -  cheaper and avoids
    // edge-clamping artifacts you'd get zooming in the fragment stage.
    private val headTiltZoomVertex = """
        uniform mat4 uTexMatrix;
        uniform float uZoom;   // 1.0 = no zoom, >1.0 = zoomed in
        uniform vec2 uPan;     // -1..1 range, NDC-space pan offset
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying mediump vec2 vTexCoord; // FIX: precision now matches this effect's fragment shader
        void main() {
            gl_Position = vec4(aPosition.xy / uZoom + uPan, aPosition.z, aPosition.w);
            vTexCoord = (uTexMatrix * aTexCoord).xy;
        }
    """.trimIndent()

    private val headTiltZoomFragment = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    """.trimIndent()

    // Silence Ripple  -  a continuously-running expanding-ring pattern (driven by
    // uTime, same "one video timeline" contract as every other time-based effect
    // here), whose VISIBILITY is gated by uIntensity = 1-amplitude (so it's
    // essentially invisible while there's normal audio, and fades in as things go
    // quiet). No new uniforms needed  -  reuses uTime/uIntensity, VideoTranscoder
    // just feeds a different meaning into uIntensity for this effect (see the
    // audioScoreEffects wiring).
    private val silenceRipple = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;
        uniform float uIntensity; // repurposed: silence factor 0..1 (1 = quiet)

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec2 center = vec2(0.5);
            float d = distance(vTexCoord, center);

            // Three staggered rings expanding outward, wrapping via fract() so
            // they loop continuously rather than needing a "ripple start time."
            float ring = 0.0;
            for (int i = 0; i < 3; i++) {
                float phase = fract(uTime * 0.35 - float(i) * 0.33);
                float radius = phase * 0.75;
                ring += smoothstep(0.02, 0.0, abs(d - radius)) * (1.0 - phase);
            }
            ring *= uIntensity;

            vec3 rippleColor = vec3(0.3, 0.75, 1.0);
            gl_FragColor = vec4(base.rgb + rippleColor * ring, base.a);
        }
    """.trimIndent()

    // Voice Halo  -  REWRITTEN: was three smooth concentric glow rings; the
    // app's own reference gallery image shows a jagged waveform ring instead
    // (like an audio spectrum visualizer bent into a circle - many short
    // radial spikes, taller where louder), which is a genuinely different
    // shape, not a tuning pass. Still built on the same real face box +
    // amplitude signal as before - only the ring's silhouette changed. A
    // thin gaussian base ring is kept underneath the spikes so it still
    // reads as a continuous ring at near-zero volume instead of scattering
    // into disconnected ticks.
    private val voiceHalo = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox; // minX, minY, maxX, maxY (normalized 0..1)
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1
        uniform float uTime;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
            float boxSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
            float baseRadius = boxSize * 0.78;
            vec2 rel = vTexCoord - center;
            float d = length(rel);
            float angle = atan(rel.y, rel.x);

            float response = pow(clamp(uIntensity, 0.0, 1.0), 0.6);
            float idleBreath = 0.03 * sin(uTime * 1.3);
            float radius = baseRadius * (1.0 + idleBreath);

            // The circle is divided into BARS bars around its circumference,
            // each with its own spike length that wobbles on its own phase -
            // quiet: short stubble; loud: tall spikes, like a real spectrum.
            const float BARS = 72.0;
            float barIndex = floor((angle / 6.28318 + 0.5) * BARS);
            float barPhase = hash1(barIndex * 12.9898);
            float wobble = 0.5 + 0.5 * sin(uTime * (1.5 + barPhase * 2.0) + barPhase * 30.0);
            float spike = 0.3 + 0.7 * wobble;
            float barHeight = radius * (0.08 + 0.22 * response) * spike;

            float ringDist = d - radius;
            float bar = smoothstep(0.0, barHeight * 0.1, ringDist)
                - smoothstep(barHeight * 0.85, barHeight, ringDist);
            float baseRing = exp(-ringDist * ringDist * 2500.0);
            float glow = clamp(bar + baseRing * 0.6, 0.0, 1.0) * (0.4 + response * 1.0);

            // Color still shifts cool -> warm gold as intensity rises  -  reads
            // as "reacting to your voice" rather than a static-colored sticker.
            vec3 quietColor = vec3(0.25, 0.65, 1.0);
            vec3 loudColor  = vec3(1.0, 0.75, 0.25);
            vec3 glowColor = mix(quietColor, loudColor, response);

            gl_FragColor = vec4(base.rgb + glowColor * glow, base.a);
        }
    """.trimIndent()

    // Thermal Pulse  -  REWRITTEN to use SegmentationTracker's real person mask
    // instead of a fixed-RGB "isSkin()" color guess. The old heuristic
    // (r > 0.35 && r > g && r > b*0.9) is a classic warm-tone detector: it's
    // biased against darker skin (luma too low to clear the 0.35 red
    // threshold) and false-positives on any warm-colored background (wood,
    // brick, tan walls)  -  a real correctness problem, not just cosmetic. Now
    // gated into needsSegmentation (see EffectRequirements.kt /
    // VideoTranscoder.kt) exactly like DEPTH_BLOOM/SPLIT_PRISM/GOLD_SKIN
    // already are, and thermal color applies to the actual detected PERSON
    // silhouette, working correctly across skin tones since it never looks
    // at skin color at all.
    private val thermalPulse = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1

        vec3 heatColor(float t) {
            vec3 cold = vec3(0.0, 0.0, 0.6);
            vec3 mid = vec3(1.0, 0.6, 0.0);
            vec3 hot = vec3(1.0, 1.0, 0.4);
            return t < 0.5 ? mix(cold, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
        }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float mask = texture2D(uMaskTexture, vTexCoord).a; // ALPHA_8 person mask, same convention as GOLD_SKIN/DEPTH_BLOOM

            float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
            float heat = clamp(luma * (0.6 + 0.6 * uIntensity), 0.0, 1.0);
            vec3 outColor = mix(src.rgb, heatColor(heat), mask);
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Depth Bloom  -  uMaskTexture is SegmentationTracker's per-frame foreground
    // mask (white = person, black = background), uploaded as a plain
    // GL_TEXTURE_2D each frame (see FrameRenderer.uploadMaskTexture). Background
    // pixels get a soft chromatic-bloom blur; foreground stays untouched.
    // uIntensity (audio amplitude) modulates the bloom strength.
    private val depthBloom = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;
        uniform vec2 uTexelSize;
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float mask = texture2D(uMaskTexture, vTexCoord).a; // ALPHA_8 bitmap -> alpha channel

            vec3 bloom = vec3(0.0);
            float total = 0.0;
            for (int x = -2; x <= 2; x++) {
                for (int y = -2; y <= 2; y++) {
                    vec2 offset = vec2(float(x), float(y)) * uTexelSize * 3.0;
                    float w = 1.0 / (1.0 + float(x * x + y * y));
                    bloom += texture2D(uTexture, vTexCoord + offset).rgb * w;
                    total += w;
                }
            }
            bloom /= total;
            // Chromatic split on the bloom itself for a dreamier fringe
            bloom.r = mix(bloom.r, texture2D(uTexture, vTexCoord + uTexelSize * 2.0).r, 0.3);
            bloom.b = mix(bloom.b, texture2D(uTexture, vTexCoord - uTexelSize * 2.0).b, 0.3);

            float bloomAmount = (0.5 + 0.7 * uIntensity) * (1.0 - mask);
            vec3 outColor = mix(src.rgb, bloom, bloomAmount);
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Split Prism  -  background (via uMaskTexture, same as Depth Bloom) splits into
    // 3 offset RGB layers. uIntensity here is repurposed as a MOTION magnitude  -
    // computed in VideoTranscoder from frame-to-frame average-luma change, since
    // (as flagged earlier) there's no live device-motion sensor available during
    // post-record baking. Foreground (mask) stays a normal, unsplit image.
    //
    // ADDED: a single offset "ghost" duplicate of the person, chromatically
    // fringed, shown only where the ghost's own offset sample position was also
    // part of the mask (so it doesn't smear skin-color across background that
    // was never the person). This is a deliberate, cheaper stand-in for true
    // multi-copy prism duplication (which would need re-sampling AND re-masking
    // the whole foreground 2-3x per fragment) - one extra texture+mask sample
    // pair gets most of the "duplicated ghost" read the reference image has, at
    // a fraction of the fill-rate cost. If you later want the full multi-ghost
    // version, this is the place to add more offset copies - each one costs
    // roughly what this single one does.
    private val splitPrism = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;
        uniform vec2 uTexelSize;
        uniform float uIntensity; // repurposed: motion magnitude 0..1

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float mask = texture2D(uMaskTexture, vTexCoord).a;

            float spread = uIntensity * 12.0;
            float r = texture2D(uTexture, vTexCoord + uTexelSize * vec2(spread, 0.0)).r;
            float g = texture2D(uTexture, vTexCoord).g;
            float b = texture2D(uTexture, vTexCoord - uTexelSize * vec2(spread, 0.0)).b;
            vec3 split = vec3(r, g, b);

            vec2 ghostOffset = uTexelSize * vec2(-spread * 1.6, spread * 0.9);
            vec2 ghostUv = vTexCoord + ghostOffset;
            float ghostMask = texture2D(uMaskTexture, ghostUv).a;
            vec3 ghostColor = texture2D(uTexture, ghostUv).rgb;
            ghostColor.r = texture2D(uTexture, ghostUv + uTexelSize * 1.5).r;
            ghostColor.b = texture2D(uTexture, ghostUv - uTexelSize * 1.5).b;
            float ghostAmount = ghostMask * clamp(uIntensity * 1.4, 0.0, 0.55);

            vec3 withGhost = mix(split, ghostColor, ghostAmount * (1.0 - mask));
            vec3 outColor = mix(withGhost, src.rgb, mask);
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Gold Skin  -  same uMaskTexture convention as Depth Bloom/Split Prism above
    // (SegmentationTracker's person mask, white=person). Recolors ONLY the person
    // through a 3-stop gold gradient MAPPED BY LUMINANCE, not a flat tint  -  that's
    // what keeps shading/detail (jawline, wrinkles, clothing folds) readable as
    // "metal" instead of just "yellow." A slow diagonal sheen sweep (uTime-driven)
    // adds a liquid-metal highlight so it doesn't read as a static color filter.
    // No uIntensity  -  this one's always at full strength when selected, nothing to
    // repurpose intensity as; background stays completely untouched via the mask.
    private val goldSkin = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;
        uniform float uTime;

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            float mask = texture2D(uMaskTexture, vTexCoord).a;

            float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));

            vec3 shadowGold = vec3(0.25, 0.14, 0.02);
            vec3 midGold    = vec3(0.85, 0.55, 0.12);
            vec3 hiGold     = vec3(1.0, 0.92, 0.65);
            vec3 gold = luma < 0.5
                ? mix(shadowGold, midGold, luma * 2.0)
                : mix(midGold, hiGold, (luma - 0.5) * 2.0);

            // Diagonal sheen band drifting slowly across the body  -  mimics light
            // catching liquid/polished metal rather than a flat painted surface.
            float sheenPos = fract((vTexCoord.x + vTexCoord.y) * 1.5 - uTime * 0.15);
            float sheen = smoothstep(0.42, 0.5, sheenPos) * smoothstep(0.58, 0.5, sheenPos);
            gold += sheen * 0.25;

            vec3 outColor = mix(src.rgb, gold, mask);
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Mouth Fire  -  uMouthCenter is FaceTracker.mouthCenter() (landmarks 13/14
    // midpoint), uIntensity is repurposed as the "jawOpen" blendshape score, same
    // repurposed-uIntensity convention as MOOD_RING/SMILE_SHATTER. Procedural flame
    // (hash/value-noise, no texture asset needed) grows taller and wider the more
    // the mouth opens, licking upward with a flickering noise-driven wobble rather
    // than sitting as a static triangle  -  this is what separates "a shape was drawn
    // at a point" from "something that looks like fire."
    // Mouth Fire  -  REWRITTEN edge treatment: every boundary here used to be a
    // hard step() cutoff (in-flame or not, no in-between), which is exactly why
    // it read as a jagged cutout silhouette instead of organic fire. Switched to
    // smoothstep() for soft anti-aliased edges, and added an outer glow/bloom
    // falloff beyond the flame's hard boundary  -  same "ambient light halo"
    // technique that already made VOICE_HALO read as glowing rather than drawn.
    // Uniforms, wiring, and orientation are all unchanged from before.
    // MOUTH_FIRE rewrite (part 2 - fragment shader). Two real changes from the
    // original single-band version: (1) the flame body now blends across 4
    // color stops (white-hot core -> yellow -> orange -> deep red edge)
    // instead of one flat core/outer mix - a single lerp reads as a flat
    // painted shape no matter how good the silhouette is, real fire's color
    // gradient is the thing that actually sells "hot"; (2) real embers -
    // uParticlePos/Life/ColorIdx are the SAME uniforms/upload path
    // throwConfetti established (FrameRenderer's upload is generic per-shader,
    // guarded by glGetUniformLocation >= 0, so reusing the names here is safe
    // and free). Embers are colored by their OWN remaining life (white-hot
    // when freshly spawned, cooling through yellow/orange/red as they rise and
    // fade) rather than a discrete palette pick - that's what makes them read
    // as individual cooling sparks instead of confetti-colored dots.
    // MOUTH_FIRE rewrite (part 3 - real fire video layer). Adds uFireTexture
    // (see FireVideoPlayer.kt), sampled WITHIN the existing silhouette math
    // above rather than replacing it - the silhouette/anchoring/sizing logic
    // was already correct, this only swaps in real turbulent video detail as
    // an extra layer. Mapped so the video's own vertical axis follows the
    // flame from mouth (t=0, hot) to tip (t=1, cool), scaled to the flame's
    // current width. Blended ADDITIVELY and gated by both `inFlame` (never
    // draws outside the existing silhouette) and the video's own luma (its
    // black background contributes nothing - see FireVideoPlayer's doc for
    // why that's a deliberate, free way to handle a non-alpha source video) -
    // so if the texture isn't bound yet, or fails on some device, this
    // degrades gracefully to the procedural flame alone rather than going
    // black or broken.
    private val mouthFire = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform samplerExternalOES uFireTexture;
        uniform mat4 uFireTexMatrix;
        uniform vec2 uMouthCenter; // normalized 0..1
        uniform float uIntensity;  // repurposed: jawOpen score 0..1
        uniform float uTime;
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleLife[$PARTICLE_MAX];
        uniform int uParticleCount;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float valueNoise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        // 2-octave FBM (was a single valueNoise() sample) - one octave of noise
        // wobbles the whole flame as a rigid unit; layering a finer, faster
        // second octave on top is what gives real fire its "licking/flickering"
        // look instead of the whole silhouette just swaying side to side.
        float flameNoise(vec2 p) {
            float n = valueNoise(p) * 0.65;
            n += valueNoise(p * 2.3 + vec2(0.0, uTime * 1.7)) * 0.35;
            return n;
        }

        vec3 flameGradient(float t) {
            // t: 0 at the mouth (hottest), 1 at the tip (coolest). 4 stops
            // instead of the original 2 - white-hot base, through yellow and
            // orange, cooling to a deep red at the very tip.
            vec3 white = vec3(1.0, 0.98, 0.85);
            vec3 yellow = vec3(1.0, 0.85, 0.25);
            vec3 orange = vec3(1.0, 0.45, 0.05);
            vec3 red = vec3(0.65, 0.08, 0.02);
            if (t < 0.25) return mix(white, yellow, t / 0.25);
            if (t < 0.6) return mix(yellow, orange, (t - 0.25) / 0.35);
            return mix(orange, red, (t - 0.6) / 0.4);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float openAmount = clamp(uIntensity, 0.0, 1.0);

            float wobble = (flameNoise(vec2(vTexCoord.x * 8.0, uTime * 6.0)) - 0.5) * 0.05;
            vec2 flameSpace = vec2(vTexCoord.x - uMouthCenter.x - wobble, vTexCoord.y - uMouthCenter.y);

            float height = 0.14 + openAmount * 0.16;
            float width = 0.05 + openAmount * 0.03;
            float t = clamp(-flameSpace.y / height, 0.0, 1.0); // 0 at mouth, 1 at tip
            float coreWidth = width * (1.0 - t) * (1.0 - t);
            float edgeNoise = flameNoise(vec2(vTexCoord.x * 12.0, vTexCoord.y * 12.0 - uTime * 4.0)) * 0.02;

            // Soft-edged boundary (smoothstep, ~0.015 falloff band) instead of a
            // hard step() cutoff  -  this alone removes most of the "cutout" look.
            float edgeWidth = coreWidth + edgeNoise;
            float withinWidth = smoothstep(edgeWidth + 0.015, edgeWidth - 0.005, abs(flameSpace.x));
            float aboveMouth = smoothstep(0.02, -0.01, flameSpace.y);
            float belowTip = smoothstep(-height - 0.02, -height + 0.02, flameSpace.y);
            float inFlame = withinWidth * aboveMouth * belowTip;

            vec3 flameColor = flameGradient(t);
            float flameAlpha = inFlame * openAmount;

            // Ambient glow beyond the flame's own silhouette  -  distance-based
            // falloff from the flame's centerline, so light appears to actually
            // radiate off the fire instead of the fire being a flat pasted shape.
            float distFromCore = max(0.0, abs(flameSpace.x) - coreWidth);
            float glow = exp(-distFromCore * distFromCore * 400.0) * aboveMouth * belowTip;
            vec3 glowColor = vec3(1.0, 0.5, 0.1) * glow * openAmount * 0.35;

            vec3 addColor = flameColor * flameAlpha + glowColor;

            // Real fire video, sampled within the existing silhouette (see
            // this shader's rewrite comment above for the full reasoning).
            vec2 fireRawUv = vec2(0.5 + flameSpace.x / (edgeWidth * 3.0 + 0.001), t);
            vec2 fireUv = (uFireTexMatrix * vec4(fireRawUv, 0.0, 1.0)).xy;
            vec3 fireVideo = texture2D(uFireTexture, fireUv).rgb;
            float fireVideoLuma = dot(fireVideo, vec3(0.299, 0.587, 0.114));
            addColor += fireVideo * fireVideoLuma * inFlame * openAmount * 0.9;

            // Real embers - small soft circles, colored/sized by their own
            // remaining life so each one visibly cools and shrinks as it rises,
            // rather than every ember looking identical until it just vanishes.
            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                float life = uParticleLife[i]; // 1 = just spawned, 0 = about to fade out
                float d = distance(vTexCoord, uParticlePos[i]);
                float radius = mix(0.003, 0.009, life);
                float ember = smoothstep(radius, radius * 0.3, d);
                vec3 emberColor = flameGradient(1.0 - life); // hottest when freshly spawned
                addColor += emberColor * ember * life * 0.9;
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Snow Fall  -  fully procedural, no tracker, no CPU particle state at all.
    // Screen space is tiled into a grid of cells; each cell gets ONE snowflake
    // whose position within the cell, size, and fall speed are all derived from
    // a hash of the cell's own coordinates (so every flake is different but
    // consistent frame-to-frame, not re-randomized every frame). uTime drives
    // the actual downward motion, with per-flake horizontal drift so it doesn't
    // look like a rigid falling grid. This is a standard, real GPU technique  -
    // not a placeholder  -  and it's the cheapest possible particle effect
    // architecturally: nothing to simulate on the CPU side, nothing to upload
    // as a uniform array, works identically live and baked with zero extra
    // Kotlin wiring beyond the uTime this file's other effects already use.
    // Snow Fall  -  REWRITE: flakes were hard-edged smoothstep discs, which read
    // as flat white dots rather than photographic snow. Softened the falloff
    // into a proper glow (real snow reads as slightly-out-of-focus glowing
    // circles on camera, not crisp shapes), added per-flake opacity variance so
    // flakes aren't all the same solid brightness, a touch of vertical stretch
    // on the nearest/fastest layer for a hint of motion blur, and a third
    // far/hazy layer for more depth than the original two. Still fully
    // procedural/stateless - no extra texture samples, same cost class as before.
    private val snowFall = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float snowLayer(vec2 uv, float cellSize, float speed, float sizeScale, float stretch) {
            vec2 grid = uv;
            grid.y += uTime * speed;
            vec2 cell = floor(grid / cellSize);
            vec2 local = fract(grid / cellSize) - 0.5;

            float h1 = hash(cell);
            float h2 = hash(cell + vec2(17.0, 31.0));
            float h3 = hash(cell + vec2(53.0, 71.0));
            vec2 flakeCenter = vec2(h1, h2) - 0.5;
            flakeCenter.x += 0.12 * sin(uTime * 0.8 + h1 * 20.0);

            vec2 delta = local - flakeCenter;
            delta.y /= stretch; // elongates along the fall direction for a hint of motion blur
            float d = length(delta);
            float flakeSize = (0.06 + h2 * 0.06) * sizeScale;
            // Soft glow falloff instead of a hard edge.
            float glow = smoothstep(flakeSize * 1.8, 0.0, d);
            float opacity = 0.55 + h3 * 0.45;
            return glow * opacity;
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float snow = 0.0;
            snow += snowLayer(vTexCoord, 0.09, 0.07, 1.1, 1.6) * 0.85;    // near - bigger, faster, slight streak
            snow += snowLayer(vTexCoord, 0.055, 0.035, 0.65, 1.25) * 0.55; // mid
            snow += snowLayer(vTexCoord, 0.03, 0.015, 0.35, 1.0) * 0.3;    // far - small, hazy, no streak
            snow = clamp(snow, 0.0, 1.0);
            gl_FragColor = vec4(base.rgb + vec3(1.0) * snow, base.a);
        }
    """.trimIndent()

    // Throw Confetti  -  real CPU-simulated particles from ParticleSystem.kt,
    // packed into fixed-size uniform arrays (same convention GAZE_TRAIL already
    // established for its point history). Each particle is drawn as a small
    // rotated rectangle sampled from a 6-color festive palette (index chosen by
    // ParticleSystem at spawn time), fading out as it approaches the end of its
    // lifetime. PARTICLE_MAX must match ParticleSystem.MAX_PARTICLES exactly  -
    // see that file's doc for why this is a duplicated-but-documented constant
    // rather than a shared import (matches this file's own existing convention
    // for GAZE_TRAIL_POINTS, not a new pattern invented here).
    private val throwConfetti = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleRot[$PARTICLE_MAX];   // degrees
        uniform float uParticleLife[$PARTICLE_MAX];  // 1 = just spawned, 0 = about to die
        uniform float uParticleColorIdx[$PARTICLE_MAX];
        uniform int uParticleCount;

        vec3 paletteColor(float idx) {
            if (idx < 0.5) return vec3(1.0, 0.25, 0.35);
            if (idx < 1.5) return vec3(1.0, 0.85, 0.15);
            if (idx < 2.5) return vec3(0.25, 0.85, 1.0);
            if (idx < 3.5) return vec3(0.55, 1.0, 0.35);
            if (idx < 4.5) return vec3(0.85, 0.35, 1.0);
            return vec3(1.0, 0.55, 0.15);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 addColor = vec3(0.0);

            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;

                vec2 toParticle = vTexCoord - uParticlePos[i];
                float rad = radians(uParticleRot[i]);
                float c = cos(rad);
                float s = sin(rad);
                // Rotate into the particle's own local space so the rectangle
                // actually spins, rather than just translating a fixed-orientation shape.
                vec2 local = vec2(toParticle.x * c + toParticle.y * s, -toParticle.x * s + toParticle.y * c);

                // Small flat rectangle  -  a paper-confetti-piece silhouette, not a
                // circle, so the rotation is actually visible. Soft-edged (smoothstep)
                // instead of a hard step() cutoff  -  a rotated hard-edged rectangle
                // aliases badly at this small scale; this fixes that.
                float inRect = smoothstep(0.014, 0.010, abs(local.x)) * smoothstep(0.008, 0.004, abs(local.y));
                float fade = uParticleLife[i];
                addColor += paletteColor(uParticleColorIdx[i]) * inRect * fade;
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Raise Eyebrow  -  real browInnerUp/browOuterUp blendshapes, same repurposed-
    // uIntensity convention MOOD_RING/SMILE_SHATTER already use. A soft glowing
    // accent lifts above the eyebrow line, brighter and higher the more the
    // brows actually raise  -  anchored to uFaceBox (already-proven convention
    // from VOICE_HALO) rather than needing new per-effect tracking plumbing.
    private val raiseEyebrow = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox; // minX, minY, maxX, maxY (normalized 0..1)
        uniform float uIntensity; // repurposed: max(browInnerUp, browOuterUp) 0..1
        uniform float uTime;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float response = clamp(uIntensity, 0.0, 1.0);

            float browY = uFaceBox.y + (uFaceBox.w - uFaceBox.y) * 0.28; // roughly brow line within the face box
            float lift = response * 0.05; // brows visually lift as intensity rises
            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, browY - lift);
            float width = (uFaceBox.z - uFaceBox.x) * 0.55;

            float dx = (vTexCoord.x - center.x) / width;
            float dy = (vTexCoord.y - center.y) * 6.0;
            float shape = exp(-(dx * dx * 3.0 + dy * dy));

            float shimmer = 0.5 + 0.5 * sin(uTime * 5.0 + vTexCoord.x * 25.0);
            vec3 glowColor = mix(vec3(0.4, 0.85, 1.0), vec3(1.0, 0.95, 0.6), shimmer * response);

            gl_FragColor = vec4(base.rgb + glowColor * shape * response * 0.8, base.a);
        }
    """.trimIndent()

    // Glitch Wave  -  pure screen-space shader, no tracker at all. Time-gated
    // "glitch bursts" (not a constant glitch  -  a constant one reads as broken,
    // not stylistic) with RGB channel split and blocky horizontal scanline
    // displacement during each burst window.
    private val glitchWave = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash(float n) {
            return fract(sin(n) * 43758.5453);
        }

        void main() {
            // FIX: burst was only ~25% likely per ~2.5s window, meaning a quick
            // test had a real chance of landing entirely in a calm window and
            // looking like nothing was happening. Shortened the window and
            // raised the probability so a burst is very likely within the
            // first second or two of selecting the effect, while keeping the
            // bursty (not constant/tiring) character intact.
            float burstPhase = fract(uTime * 0.8);
            float burstActive = step(0.4, hash(floor(uTime * 0.8)));
            float burstStrength = burstActive * smoothstep(0.0, 0.15, burstPhase) * smoothstep(1.0, 0.85, burstPhase);

            // Blocky horizontal row displacement  -  classic signal-glitch look.
            float rowId = floor(vTexCoord.y * 40.0);
            float rowGlitch = (hash(rowId + floor(uTime * 12.0)) - 0.5) * 0.06 * burstStrength;
            vec2 uv = vec2(vTexCoord.x + rowGlitch, vTexCoord.y);

            // RGB channel split, offset scales with burst strength.
            float split = 0.008 * burstStrength;
            float r = texture2D(uTexture, uv + vec2(split, 0.0)).r;
            float g = texture2D(uTexture, uv).g;
            float b = texture2D(uTexture, uv - vec2(split, 0.0)).b;

            gl_FragColor = vec4(r, g, b, 1.0);
        }
    """.trimIndent()

    // Retro VHS  -  scanlines + chromatic fringe + horizontal tracking wobble,
    // pure uTime-driven, no tracker. Constant/ambient (unlike Glitch Wave's
    // bursts) since a VHS look is meant to feel like a steady, worn tape, not a
    // signal error.
    private val retroVhs = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash(float n) {
            return fract(sin(n) * 43758.5453);
        }

        void main() {
            // Tracking wobble: a slow horizontal drift, worse near top/bottom of
            // frame like a real worn VHS tape's head-switching noise band.
            float edgeDist = min(vTexCoord.y, 1.0 - vTexCoord.y);
            float wobbleStrength = smoothstep(0.08, 0.0, edgeDist) * 0.01;
            float wobble = sin(uTime * 3.0 + vTexCoord.y * 8.0) * wobbleStrength;
            vec2 uv = vec2(vTexCoord.x + wobble, vTexCoord.y);

            float split = 0.0025;
            float r = texture2D(uTexture, uv + vec2(split, 0.0)).r;
            float g = texture2D(uTexture, uv).g;
            float b = texture2D(uTexture, uv - vec2(split, 0.0)).b;
            vec3 color = vec3(r, g, b);

            // Scanlines  -  a dark horizontal band every few pixel-rows.
            float scanline = 0.92 + 0.08 * sin(vTexCoord.y * 480.0);
            color *= scanline;

            // Sparse horizontal noise streaks  -  tape dropout look.
            float dropoutRow = floor(vTexCoord.y * 60.0);
            float dropout = step(0.985, hash(dropoutRow + floor(uTime * 2.0))) * 0.25;
            color += dropout;

            // Gentle vignette so edges feel like an old CRT frame, not a crop.
            float vig = smoothstep(0.9, 0.3, distance(vTexCoord, vec2(0.5)));
            color *= mix(0.7, 1.0, vig);

            gl_FragColor = vec4(color, 1.0);
        }
    """.trimIndent()

    // Light Leak  -  warm colored streaks sweeping diagonally across the frame,
    // pure uTime-driven, no tracker. Additive blend so it reads as light
    // washing over the lens, not a solid shape painted on top.
    private val lightLeak = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            // Diagonal coordinate that slowly sweeps with time.
            float diag = (vTexCoord.x + vTexCoord.y) * 0.7 - uTime * 0.08;
            float sweepPhase = fract(diag);
            // Soft-edged band rather than a hard line  -  real lens light leaks
            // fall off gradually, not with a sharp cutoff.
            float band = smoothstep(0.0, 0.4, sweepPhase) * smoothstep(0.85, 0.4, sweepPhase);

            // Warm gradient across the band itself  -  amber core, pink/orange edges.
            vec3 leakColor = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.25, 0.35), sweepPhase);

            // A second, fainter, slower streak in the opposite direction for depth.
            float diag2 = (vTexCoord.x - vTexCoord.y) * 0.5 + uTime * 0.04;
            float band2 = smoothstep(0.0, 0.3, fract(diag2)) * smoothstep(0.7, 0.3, fract(diag2)) * 0.4;

            vec3 outColor = base.rgb + leakColor * band * 0.5 + vec3(1.0, 0.7, 0.4) * band2;
            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Mouth Words  -  deliberately a plain passthrough. The reactive text itself
    // is drawn as a SEPARATE positioned overlay (see VisualEffect doc above),
    // not a per-pixel shader effect  -  this program exists only so setEffect()/
    // drawEffectFrame()'s normal machinery has something valid to bind, keeping
    // this effect consistent with every other one instead of needing a special
    // case in FrameRenderer for "no shader at all."
    private val mouthWordsPassthrough = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    """.trimIndent()

    // Palm Magic  -  same particle uniform arrays THROW_CONFETTI uses (reused
    // as-is), rendered as soft glowing circular sparkles instead of rotating
    // rectangles  -  a warm/cool shimmering palette rather than confetti's flat
    // festive colors. The Kotlin side spawns these with near-zero/negative
    // gravity (see ParticleSystem instantiation in VideoTranscoder) so they
    // drift gently upward rather than falling  -  same physics engine, different
    // tuning, proving the particle core isn't confetti-specific.
    // REWRITTEN: was sparkle particles only; added a structured ring/spiral
    // energy core underneath, matching the reference's "energy orb" look.
    // Anchored on uPalmCenter - a real uniform now (wired through live preview
    // and video-bake, using the palm position already computed there for
    // particle spawning - see those call sites), deliberately NOT derived by
    // averaging uParticlePos[] per-fragment in the shader, which would have
    // doubled the cost of the particle loop below for every pixel on screen.
    private val palmMagicSparkle = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uPalmCenter;
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleLife[$PARTICLE_MAX];
        uniform float uParticleColorIdx[$PARTICLE_MAX];
        uniform int uParticleCount;
        uniform float uTime;

        vec3 sparkleColor(float idx) {
            if (idx < 2.0) return vec3(0.55, 0.85, 1.0);   // cool cyan
            if (idx < 4.0) return vec3(0.85, 0.55, 1.0);   // violet
            return vec3(1.0, 0.9, 0.6);                    // warm gold
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 rel = vTexCoord - uPalmCenter;
            float d = length(rel);
            float angle = atan(rel.y, rel.x);
            float spin = uTime * 1.8;

            float core = exp(-d * d * 700.0);
            float ringGlow = 0.0;
            for (int r = 0; r < 3; r++) {
                float radius = 0.03 + float(r) * 0.025;
                float ringDist = abs(d - radius);
                ringGlow += exp(-ringDist * ringDist * 3000.0) * (1.0 - float(r) * 0.25);
            }
            // Spiral line winding outward from the core.
            float spiralAngle = angle - d * 40.0 + spin;
            float spiral = smoothstep(0.35, 0.0, abs(sin(spiralAngle))) * smoothstep(0.09, 0.0, d) * smoothstep(0.0, 0.015, d);

            vec3 orbColor = vec3(0.75, 0.55, 1.0);
            vec3 addColor = orbColor * (core * 1.4 + ringGlow * 0.8 + spiral * 0.6);

            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                float pd = distance(vTexCoord, uParticlePos[i]);
                // Soft round falloff (not a hard circle)  -  a real glow, not a
                // filled disc  -  plus a fast twinkle so each sparkle shimmers
                // rather than sitting as a static dot.
                float glow = exp(-pd * pd * 900.0);
                float twinkle = 0.6 + 0.4 * sin(uTime * 10.0 + float(i) * 12.9);
                addColor += sparkleColor(uParticleColorIdx[i]) * glow * uParticleLife[i] * twinkle;
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Rock Paper Scissors  -  deliberately a plain passthrough, same reasoning as
    // MOUTH_WORDS: the actual gesture label is a POSITIONED text overlay
    // (OverlayBuilder.buildWordBubble + drawWatermarkAt, reused as-is), not a
    // per-pixel shader effect.
    private val rockPaperScissorsPassthrough = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        void main() {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        }
    """.trimIndent()

    // Clap Burst  -  combines TWO already-existing uniform families rather than
    // inventing new ones: uBoomCenter/uBoomEnergy (the same generic decay pair
    // FIST_BUMP_BOOM uses  -  FrameRenderer binds these to ANY shader that
    // declares them, not just fist bump's own) for a central flash, plus the
    // particle arrays for a burst of debris, giving the richer "burst +
    // particles + glow" look the brief asks for without new FrameRenderer wiring.
    private val clapBurst = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uBoomCenter;
        uniform float uBoomEnergy;
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleRot[$PARTICLE_MAX];
        uniform float uParticleLife[$PARTICLE_MAX];
        uniform float uParticleColorIdx[$PARTICLE_MAX];
        uniform int uParticleCount;

        vec3 paletteColor(float idx) {
            if (idx < 0.5) return vec3(1.0, 0.9, 0.5);
            if (idx < 1.5) return vec3(1.0, 0.6, 0.3);
            return vec3(1.0, 0.95, 0.8);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            float d = distance(vTexCoord, uBoomCenter);
            float flash = exp(-d * d * 60.0) * uBoomEnergy;

            // Added: staggered echo rings (same technique just added to
            // TAP_SHOCKWAVE) under the central flash, reading as a denser
            // burst - matching the reference - without touching particle
            // spawn counts, which is a separate Kotlin-side change not made
            // this pass.
            float maxRadius = 0.22;
            float ring = 0.0;
            for (int i = 0; i < 2; i++) {
                float echoEnergy = clamp(uBoomEnergy - float(i) * 0.25, 0.0, 1.0);
                float radius = (1.0 - echoEnergy) * maxRadius;
                float ringWidth = 0.012 + (1.0 - echoEnergy) * 0.008;
                ring += smoothstep(ringWidth, 0.0, abs(d - radius)) * echoEnergy * (1.0 - float(i) * 0.35);
            }

            vec3 addColor = vec3(1.0, 0.95, 0.8) * flash + vec3(1.0, 0.85, 0.5) * ring;
            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                vec2 toP = vTexCoord - uParticlePos[i];
                float rad = radians(uParticleRot[i]);
                vec2 local = vec2(toP.x * cos(rad) + toP.y * sin(rad), -toP.x * sin(rad) + toP.y * cos(rad));
                // Soft-edged (smoothstep) instead of a hard step() cutoff  -  same
                // anti-aliasing fix as the confetti particle shape above.
                float inShape = smoothstep(0.010, 0.006, abs(local.x)) * smoothstep(0.010, 0.006, abs(local.y));
                addColor += paletteColor(uParticleColorIdx[i]) * inShape * uParticleLife[i];
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Tap Shockwave  -  REWRITTEN: was one expanding/thinning ring, now three
    // staggered echo rings for a denser burst, matching the reference. All
    // three come from the SAME single decaying uBoomEnergy value, just offset
    // further along in their own decay (echoEnergy = energy - i*0.22) - reads
    // as trailing echoes without needing new Kotlin-side timer state for
    // multiple independent rings.
    private val tapShockwave = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uBoomCenter;
        uniform float uBoomEnergy;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float d = distance(vTexCoord, uBoomCenter);

            float maxRadius = 0.38;
            vec3 ringColor = vec3(0.6, 0.85, 1.0);
            vec3 addColor = vec3(0.0);
            for (int i = 0; i < 3; i++) {
                float echoEnergy = clamp(uBoomEnergy - float(i) * 0.22, 0.0, 1.0);
                float radius = (1.0 - echoEnergy) * maxRadius;
                float ringWidth = 0.014 + (1.0 - echoEnergy) * 0.01;
                float ring = smoothstep(ringWidth, 0.0, abs(d - radius)) * echoEnergy;
                addColor += ringColor * ring * (1.0 - float(i) * 0.3);
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Spin Effect  -  rotating light ring anchored to uFaceBox (already-generic,
    // same convention VOICE_HALO/RAISE_EYEBROW use). uIntensity is repurposed
    // as a normalized head-yaw magnitude  -  faster head turns spin the ring
    // faster, but it always spins at a base rate even when still (yaw=0), so it
    // never reads as "dead." Reuses uFaceBox/uIntensity/uTime  -  no new uniforms.
    private val spinEffect = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox;
        uniform float uIntensity; // repurposed: normalized |yaw| 0..1
        uniform float uTime;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
            float faceSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
            float radius = faceSize * 0.85;

            vec2 toPoint = vTexCoord - center;
            float d = length(toPoint);
            float angle = atan(toPoint.y, toPoint.x);

            float spinSpeed = 1.2 + uIntensity * 2.5;
            float rotatedAngle = angle + uTime * spinSpeed;

            // Several bright points around the ring rather than a solid line  -
            // reads as "orbiting lights," not a static painted circle.
            float points = 6.0;
            float pointPattern = 0.5 + 0.5 * cos(rotatedAngle * points);
            float ringMask = smoothstep(0.04, 0.0, abs(d - radius));
            float glow = ringMask * pow(pointPattern, 4.0);

            vec3 ringColor = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.4, 0.8), 0.5 + 0.5 * sin(uTime * 0.7));
            gl_FragColor = vec4(base.rgb + ringColor * glow, base.a);
        }
    """.trimIndent()

    // Stickers React  -  real smile-triggered ParticleSystem (fourth distinct
    // tuning: gentle upward float, short lifetime, spawned from cheek/face
    // area  -  see VideoTranscoder's instantiation), rendered as an actual
    // procedural heart SHAPE via the classic algebraic heart curve
    // ((x?+y?-1)? - x?y?), not a static emoji glyph glued over the face. The
    // trigger (smile), the motion (real physics), and the position (real face
    // landmark) are all genuine tracked data  -  only the shape itself is
    // stylized, matching section 2's "supplementary visual asset, not the
    // main implementation" allowance rather than crossing it.
    // NOTE: heart orientation depends on the sign convention of this shader's
    // local y-axis, which I can't visually verify without rendering on a real
    // device  -  if it renders upside-down, flip the sign on p.y below.
    private val stickersReact = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleLife[$PARTICLE_MAX];
        uniform float uParticleColorIdx[$PARTICLE_MAX];
        uniform int uParticleCount;
        uniform float uTime;

        float heartShape(vec2 p) {
            p *= 6.0; // scale into the curve's natural [-1.2,1.2]-ish range
            float a = p.x * p.x + p.y * p.y - 1.0;
            return a * a * a - p.x * p.x * p.y * p.y * p.y;
        }

        vec3 reactColor(float idx) {
            if (idx < 2.0) return vec3(1.0, 0.35, 0.55);   // pink
            if (idx < 4.0) return vec3(1.0, 0.75, 0.2);    // gold sparkle
            return vec3(0.85, 0.45, 1.0);                  // violet
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 addColor = vec3(0.0);

            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                vec2 local = vTexCoord - uParticlePos[i];
                float wobble = sin(uTime * 4.0 + float(i) * 3.1) * 0.01;
                local.x += wobble;
                float h = heartShape(local);
                float inHeart = smoothstep(0.05, -0.05, h);
                addColor += reactColor(uParticleColorIdx[i]) * inHeart * uParticleLife[i];
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Face Morph  -  the composite shader is deliberately simple: it just alpha-
    // blends uTexture with uMaskTexture (the mesh wireframe, drawn on the CPU
    // side via Canvas from REAL landmark positions and their REAL computed
    // nearest-neighbor connections  -  not hardcoded topology, not the shader's
    // concern at all). The "half face" split happens on the CPU side too, via
    // Canvas.clipRect  -  the non-mesh half of that bitmap is simply transparent,
    // so this shader doesn't need to know about halves, sides, or geometry at
    // all. Reuses uMaskTexture/uploadSecondaryTexture exactly as DEPTH_BLOOM/
    // GOLD_SKIN already do  -  zero new FrameRenderer uniforms.
    private val faceMorphComposite = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uMaskTexture;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec4 mesh = texture2D(uMaskTexture, vTexCoord);
            vec3 outColor = mix(base.rgb, mesh.rgb, mesh.a);
            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Fire Book  -  reuses uPortalTexture (HAND_PORTAL's static-scene mechanism,
    // same OverlayBuilder-style load-once pattern) for the book itself,
    // uPortalCenter/uPortalRadius (repurposed: center = hand position, radius
    // = half-width scale) for hand-tracked position/size, and the particle
    // arrays for real animated flames. uPortalAngle (NEW) rotates the book
    // quad to match the actual wrist->index-MCP angle of the tracked hand  -
    // previously always axis-aligned regardless of hand tilt, which read as
    // pasted-on rather than held. Book image asset already supplied
    // (fx_gl_fire_book2.png)  -  no longer a missing-asset situation.
    // FIRE_BOOK rewrite (part 2 - real fire video body). Adds a body-shaped
    // flame rising from the book's top edge, using the SAME video-sampling
    // technique MOUTH_FIRE uses (see that shader's comment for the full
    // reasoning on the additive/luma-gated blend and graceful degradation).
    // Anchored in screen space, deliberately NOT counter-rotated with the
    // book's tilt (uPortalAngle) - real fire burns upward under its own
    // buoyancy regardless of what it's resting on, so a screen-space-vertical
    // flame is both simpler than full rotation compensation AND arguably more
    // physically correct than tilting the flame with the book would be. The
    // existing per-particle point-flames (below) stay as embers/detail on top.
    private val fireBook = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform samplerExternalOES uFireTexture;
        uniform mat4 uFireTexMatrix;
        uniform sampler2D uPortalTexture;
        uniform vec2 uPortalCenter;
        uniform float uPortalRadius; // repurposed: book half-width scale
        uniform float uPortalAngle; // radians  -  wrist->index-MCP angle, 0 = axis-aligned
        uniform vec2 uParticlePos[$PARTICLE_MAX];
        uniform float uParticleLife[$PARTICLE_MAX];
        uniform float uParticleColorIdx[$PARTICLE_MAX];
        uniform int uParticleCount;
        uniform float uTime;

        vec3 flameColor(float idx) {
            if (idx < 2.0) return vec3(1.0, 0.85, 0.3);
            if (idx < 4.0) return vec3(1.0, 0.5, 0.1);
            return vec3(1.0, 0.2, 0.05);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 outColor = base.rgb;

            // Book rectangle  -  a fixed aesthetic aspect ratio (typical open-
            // book proportions) around the hand-tracked center, scaled by the
            // repurposed "radius" value, and now rotated to match hand angle.
            float halfW = uPortalRadius;
            float halfH = uPortalRadius * 0.7;
            vec2 rawOffset = vTexCoord - uPortalCenter;
            // Rotate the sample point by -uPortalAngle so the book tilts with
            // the hand instead of always sitting screen-axis-aligned  -  this is
            // the single biggest reason it used to read as "pasted on" rather
            // than "held": a real held object's orientation follows the hand.
            float ca = cos(-uPortalAngle);
            float sa = sin(-uPortalAngle);
            vec2 rotatedOffset = vec2(rawOffset.x * ca - rawOffset.y * sa, rawOffset.x * sa + rawOffset.y * ca);
            vec2 toBook = rotatedOffset / vec2(halfW, halfH);
            if (abs(toBook.x) < 1.0 && abs(toBook.y) < 1.0) {
                vec2 bookUV = toBook * 0.5 + 0.5;
                vec4 bookColor = texture2D(uPortalTexture, bookUV);
                outColor = mix(outColor, bookColor.rgb, bookColor.a);
            }

            // Body-shaped video-fire flame rising from the book's top edge.
            // Reuses MOUTH_FIRE's exact silhouette pattern (mirrored here on
            // purpose, not reinvented) anchored at the book's top-center
            // instead of the mouth. No jawOpen-equivalent "openness" signal
            // for a book, so size stays proportional to uPortalRadius (book
            // scale) with a gentle idle pulse instead.
            vec2 bookTop = uPortalCenter + vec2(0.0, -halfH * 0.9);
            vec2 bfSpace = vTexCoord - bookTop;
            float bfPulse = 0.85 + 0.15 * sin(uTime * 5.0);
            float bfHeight = halfH * 1.6 * bfPulse;
            float bfWidth = halfW * 0.45 * bfPulse;
            float bft = clamp(-bfSpace.y / bfHeight, 0.0, 1.0);
            float bfCoreWidth = bfWidth * (1.0 - bft) * (1.0 - bft);
            float bfWithinWidth = smoothstep(bfCoreWidth + 0.02, bfCoreWidth - 0.005, abs(bfSpace.x));
            float bfAboveBook = smoothstep(0.02, -0.01, bfSpace.y);
            float bfBelowTip = smoothstep(-bfHeight - 0.02, -bfHeight + 0.02, bfSpace.y);
            float bfInFlame = bfWithinWidth * bfAboveBook * bfBelowTip;

            vec2 fireRawUv = vec2(0.5 + bfSpace.x / (bfCoreWidth * 3.0 + 0.001), bft);
            vec2 fireUv = (uFireTexMatrix * vec4(fireRawUv, 0.0, 1.0)).xy;
            vec3 fireVideo = texture2D(uFireTexture, fireUv).rgb;
            float fireVideoLuma = dot(fireVideo, vec3(0.299, 0.587, 0.114));
            outColor += fireVideo * fireVideoLuma * bfInFlame * 0.9;

            // Warm ambient glow around the book, pulsing like firelight  -
            // uses the UNROTATED offset since plain distance-from-center
            // doesn't change under rotation, no need to redo the trig.
            float glowDist = length(rawOffset) / max(halfW, halfH);
            float glowPulse = 0.7 + 0.3 * sin(uTime * 6.0);
            float glow = exp(-glowDist * glowDist * 2.0) * 0.25 * glowPulse;
            outColor += vec3(1.0, 0.55, 0.15) * glow;

            // Real animated flame particles, licking upward from the book's top edge.
            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                float d = distance(vTexCoord, uParticlePos[i]);
                float flicker = 0.6 + 0.4 * sin(uTime * 16.0 + float(i) * 7.0);
                float flame = exp(-d * d * 700.0) * flicker;
                outColor += flameColor(uParticleColorIdx[i]) * flame * uParticleLife[i];
            }

            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Hand Portal  -  uPortalTexture is a STATIC scene image (loaded once via
    // OverlayBuilder-style loader, like the watermark logo  -  NOT a second video;
    // a full video-in-video portal is a materially bigger feature  -  a portal
    // scene photo/image is the honest first version of this pitch). Inside the
    // circle (uPortalCenter, uPortalRadius, both normalized 0..1 screen space)
    // shows the portal scene; outside shows the normal video.
    private val handPortal = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform sampler2D uPortalTexture;
        uniform vec2 uPortalCenter;
        uniform float uPortalRadius;

        void main() {
            vec4 videoColor = texture2D(uTexture, vTexCoord);
            float d = distance(vTexCoord, uPortalCenter);

            if (d < uPortalRadius) {
                vec2 portalUv = (vTexCoord - uPortalCenter) / uPortalRadius * 0.5 + 0.5;
                vec4 portalColor = texture2D(uPortalTexture, portalUv);
                float edge = smoothstep(uPortalRadius, uPortalRadius * 0.9, d);
                vec3 ringGlow = vec3(1.0, 0.6, 0.15) * smoothstep(0.06, 0.0, abs(d - uPortalRadius));
                gl_FragColor = vec4(mix(videoColor.rgb, portalColor.rgb, edge) + ringGlow, videoColor.a);
            } else {
                gl_FragColor = videoColor;
            }
        }
    """.trimIndent()

    // Fist Bump Boom needs its OWN vertex shader for the screen-shake part  -
    // same reason HEAD_TILT_ZOOM does (a fragment-only shake would just look
    // like blur, not an actual camera-shake feel). uBoomEnergy starts at 1.0 the
    // frame a fist is detected and decays exponentially over subsequent frames  -
    // see VideoTranscoder's boomEnergy state variable.
    private val fistBumpBoomVertex = """
        uniform mat4 uTexMatrix;
        uniform float uBoomEnergy; // 1.0 = just triggered, decays toward 0
        uniform float uTime;
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying mediump vec2 vTexCoord; // FIX: precision now matches this effect's fragment shader

        float hash(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
            float shakeX = (hash(uTime * 97.0) - 0.5) * 0.04 * uBoomEnergy;
            float shakeY = (hash(uTime * 61.0 + 3.7) - 0.5) * 0.04 * uBoomEnergy;
            gl_Position = vec4(aPosition.xy + vec2(shakeX, shakeY), aPosition.z, aPosition.w);
            vTexCoord = (uTexMatrix * aTexCoord).xy;
        }
    """.trimIndent()

    // REWRITTEN: was one soft radial burst; added jagged lightning tendrils
    // on top, matching the reference image. Reuses WINK_SPARK's angular-
    // sector technique (divide the circle into N sectors, light up near each
    // sector's centerline) but with noise-perturbed angle and tapering width
    // per ray instead of a clean star pattern, so it reads as lightning
    // rather than a starburst.
    private val fistBumpBoomFragment = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uBoomCenter;
        uniform float uBoomEnergy;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec2 rel = vTexCoord - uBoomCenter;
            float d = length(rel);
            float angle = atan(rel.y, rel.x);

            float burst = smoothstep(0.5, 0.0, d) * uBoomEnergy;

            const float RAYS = 18.0;
            float rayIndex = floor((angle / 6.28318 + 0.5) * RAYS);
            float rayPhase = hash1(rayIndex * 17.31);
            float rayAngleJitter = (rayPhase - 0.5) * 0.15;
            float raySeg = 6.28318 / RAYS;
            float angleInSeg = mod(angle + 3.14159, raySeg) - raySeg * 0.5 - rayAngleJitter;
            float distFrac = clamp(d / 0.5, 0.0, 1.0);
            float rayWidth = mix(0.012, 0.003, distFrac); // tapers thinner with distance
            // abs(angleInSeg) * d converts an angular deviation into an
            // approximate arc-length deviation, so ray width reads as a
            // roughly constant screen distance rather than a wedge that
            // widens with radius.
            float onRay = smoothstep(rayWidth, 0.0, abs(angleInSeg) * d);
            float rayReach = (0.25 + rayPhase * 0.35) * uBoomEnergy;
            float withinReach = smoothstep(rayReach, rayReach * 0.7, d);
            float tendrils = onRay * withinReach * uBoomEnergy;

            vec3 boomColor = vec3(1.0, 0.5, 0.1);
            vec3 tendrilColor = vec3(1.0, 0.85, 0.5);
            vec3 addColor = boomColor * burst * 1.5 + tendrilColor * tendrils * 1.3;
            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Two-Hand Frame  -  REWRITTEN: was a full glowing border around all four
    // edges; the reference image shows four L-shaped corner brackets instead
    // (camera-viewfinder style), which reads as cleaner and is, if anything,
    // less shader work than tracing a continuous border was. uFrameRect and
    // uIntensity are unchanged - same real rectangle spanned by both palms,
    // same gesture-confidence signal.
    private val twoHandFrame = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFrameRect; // left, top, right, bottom (normalized)
        uniform float uIntensity;

        // One straight bracket arm: bright near a line at acrossDist = 0,
        // for alongDist between 0 (the corner) and armLen (the arm's tip).
        float arm(float acrossDist, float alongDist, float armLen, float lineWidth) {
            float line = smoothstep(lineWidth, lineWidth * 0.3, abs(acrossDist));
            float extent = (1.0 - smoothstep(armLen * 0.85, armLen, alongDist)) * step(0.0, alongDist);
            return line * extent;
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            float w = uFrameRect.z - uFrameRect.x;
            float h = uFrameRect.w - uFrameRect.y;
            float armLen = min(w, h) * 0.2;
            float lineWidth = 0.006;

            float distLeft = vTexCoord.x - uFrameRect.x;
            float distRight = uFrameRect.z - vTexCoord.x;
            float distTop = vTexCoord.y - uFrameRect.y;
            float distBottom = uFrameRect.w - vTexCoord.y;

            float bracket = 0.0;
            bracket = max(bracket, arm(distTop, distLeft, armLen, lineWidth));     // top-left, horizontal
            bracket = max(bracket, arm(distLeft, distTop, armLen, lineWidth));     // top-left, vertical
            bracket = max(bracket, arm(distTop, distRight, armLen, lineWidth));    // top-right, horizontal
            bracket = max(bracket, arm(distRight, distTop, armLen, lineWidth));    // top-right, vertical
            bracket = max(bracket, arm(distBottom, distLeft, armLen, lineWidth));  // bottom-left, horizontal
            bracket = max(bracket, arm(distLeft, distBottom, armLen, lineWidth));  // bottom-left, vertical
            bracket = max(bracket, arm(distBottom, distRight, armLen, lineWidth)); // bottom-right, horizontal
            bracket = max(bracket, arm(distRight, distBottom, armLen, lineWidth)); // bottom-right, vertical
            bracket *= uIntensity;

            vec3 frameColor = vec3(1.0, 0.85, 0.3);
            gl_FragColor = vec4(base.rgb + frameColor * bracket * 1.8, base.a);
        }
    """.trimIndent()

    // Gaze Trail  -  SINGLE-PASS technique, no cross-frame GPU state: VideoTranscoder
    // keeps the last 8 iris positions in a plain Kotlin array (see
    // VideoTranscoder.gazeHistory) and uploads the whole array as a uniform every
    // frame. Older points are simply dimmer (via uGazeAges)  -  the "trail" comes
    // from Kotlin remembering positions over time, not from the GPU accumulating
    // anything, which is what keeps this safely in the same risk category as
    // every other single-pass effect above rather than needing an FBO.
    private const val GAZE_TRAIL_POINTS = 8
    // Cap for THROW_CONFETTI's particle array  -  must match ParticleSystem.MAX_PARTICLES
    // exactly (that file documents the same number with the reasoning: enough for a
    // visually rich burst, still cheap for a fixed-size uniform array + shader loop
    // on lower-end GPUs per section 19's performance requirement).
    private const val PARTICLE_MAX = 24
    // FIX (design gap, not a tracking bug): the iris tracking itself (landmarks
    // 468/473, the rolling history buffer) was already correct - matches
    // FaceTracker's own established pattern. What didn't match the reference
    // image was this shader: it drew separate fading DOTS at each history
    // point, which reads as a sparkle trail, not the continuous glowing line/
    // streak the reference shows. Rewritten to draw actual line SEGMENTS
    // between consecutive points (distance-to-segment instead of distance-to-
    // point, for each of the 7 gaps between 8 points) so it reads as one
    // continuous flowing streak following the eye's movement.
    private val gazeTrail = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uGazePoints[$GAZE_TRAIL_POINTS];
        uniform float uGazeAges[$GAZE_TRAIL_POINTS]; // 0 = newest/brightest, 1 = oldest/gone
        uniform int uGazeCount; // how many entries in uGazePoints are valid this frame

        // Shortest distance from p to the line segment a-b.
        float distToSegment(vec2 p, vec2 a, vec2 b) {
            vec2 ab = b - a;
            float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
            return distance(p, a + ab * t);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 particleColor = vec3(0.6, 0.85, 1.0);
            float glow = 0.0;
            for (int i = 0; i < $GAZE_TRAIL_POINTS - 1; i++) {
                if (i + 1 >= uGazeCount) break;
                float d = distToSegment(vTexCoord, uGazePoints[i], uGazePoints[i + 1]);
                float fade = 1.0 - uGazeAges[i];
                glow += smoothstep(0.014, 0.0, d) * fade;
            }
            // Bright core exactly at the newest (current eye) position, on top
            // of the streak - an anchor point so it clearly reads as tracking
            // the eye right now, not just a fading trail with nothing current.
            if (uGazeCount > 0) {
                float dCore = distance(vTexCoord, uGazePoints[0]);
                glow += smoothstep(0.02, 0.0, dCore) * 1.4;
            }
            gl_FragColor = vec4(base.rgb + particleColor * glow, base.a);
        }
    """.trimIndent()

    // ---- Phase 9 shaders (see the enum's Phase 9 comment for the overall plan) ----

    // Bokeh Lights  -  soft out-of-focus glow orbs drifting slowly across the
    // frame, like light through a shallow-depth-of-field lens. Pure uTime, no
    // tracker needed. FIXED_COUNT procedural orbs (hashed per-index position/
    // size/color/speed) rather than a real depth-of-field blur of actual scene
    // highlights - a genuine bokeh blur needs the GPU to sample a wide kernel
    // around bright source pixels, which is a much heavier multi-tap technique;
    // this is the same "ambient mood overlay" category as AURA_GLOW/SILENCE_RIPPLE,
    // just orbs instead of rings.
    private const val BOKEH_COUNT = 10
    private val bokehLights = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 glow = vec3(0.0);
            for (int i = 0; i < $BOKEH_COUNT; i++) {
                float fi = float(i);
                // Per-orb randomized starting position, drift direction/speed,
                // size and hue seed, all derived from the loop index so no
                // Kotlin-side state is needed - same "hash the index" approach
                // ROCK_PAPER_SCISSORS-adjacent effects use for per-particle vary.
                vec2 seed = vec2(hash1(fi * 12.9898), hash1(fi * 78.233 + 4.0));
                float speed = 0.02 + hash1(fi * 3.7) * 0.03;
                vec2 pos = fract(seed + vec2(hash1(fi * 5.3) - 0.5, -uTime * speed));
                float size = 0.05 + hash1(fi * 9.1) * 0.09;
                float d = distance(vTexCoord, pos);
                float orb = smoothstep(size, 0.0, d) * 0.5;
                // Warm/cool alternating palette so it doesn't read as one flat color.
                vec3 hue = hash1(fi * 2.1) > 0.5
                    ? vec3(1.0, 0.75, 0.4)
                    : vec3(0.5, 0.7, 1.0);
                glow += hue * orb;
            }
            gl_FragColor = vec4(base.rgb + glow, base.a);
        }
    """.trimIndent()

    // Particle Flow  -  REWRITTEN from straight vertical drift into a
    // controlled swirl, confirmed against the reference image (particles
    // orbiting the subject in a coherent spiral, not drifting untargeted
    // upward). Maps the same tiled-grid noise technique into POLAR
    // coordinates (angle, radius from frame center) instead of cartesian -
    // angle advances with time for the spin, radius drifts slowly in/out so
    // it reads as flowing rather than a rigid spinning wheel. Orbits the
    // frame center (0.5, 0.5) rather than a tracked person silhouette -
    // that would need segmentation mask wiring (a bigger addition, not made
    // this pass), and most selfie framing keeps the subject roughly centered
    // anyway. KNOWN CHARACTERISTIC: polar-coordinate tiling has an inherent
    // seam where angle wraps from +pi to -pi - usually unnoticeable in a busy
    // dust-particle pattern, flagging it here rather than pretending it's
    // seamless.
    private val particleFlow = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec2 center = vec2(0.5, 0.5);
            vec2 rel = vTexCoord - center;
            float radius = length(rel);
            float angle = atan(rel.y, rel.x);

            float glow = 0.0;
            for (int layer = 0; layer < 2; layer++) {
                float scale = layer == 0 ? 9.0 : 14.0;
                float layerSpeed = layer == 0 ? 0.35 : -0.5;
                float spinAngle = angle + uTime * layerSpeed * 0.3;
                float radiusDrift = radius + sin(uTime * 0.15 + angle * 3.0) * 0.03;
                vec2 swirlUv = vec2(spinAngle * scale * 0.5, radiusDrift * scale);
                vec2 cell = floor(swirlUv);
                vec2 local = fract(swirlUv) - 0.5;
                vec2 jitter = vec2(hash2(cell), hash2(cell + 3.7)) - 0.5;
                float d = length(local - jitter * 0.6);
                float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + hash2(cell) * 20.0);
                glow += smoothstep(0.06, 0.0, d) * twinkle * 0.5;
            }
            vec3 particleColor = vec3(0.8, 0.9, 1.0);
            gl_FragColor = vec4(base.rgb + particleColor * glow, base.a);
        }
    """.trimIndent()

    // Rain Fall  -  vertical streaks falling down the frame, plus a slight
    // cool darkening so it reads as "weather" rather than just lines on top of
    // the video. Pure uTime, no tracker needed.
    // Rain Fall (displayed as "Rain Drop")  -  REWRITTEN from rain STREAKS
    // falling through open air to actual droplets sitting on / sliding down
    // glass, confirmed as the real target against the app's own marketing
    // reference (condensation beads refracting the scene behind them, most
    // static, some sliding). Genuinely different technique from before, not a
    // tuning pass: each droplet refracts the frame behind it via ONE offset
    // texture2D sample per layer (scaled by distance-from-droplet-center),
    // plus a bright rim highlight so it reads as glassy rather than blurry.
    // Two droplet layers (not the old effect's 40-column loop), so this is
    // actually CHEAPER than what it replaces - 2 extra texture2D samples
    // total, vs. re-evaluating 40 columns of ALU math per fragment before.
    private val rainFall = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uTexelSize;
        uniform float uTime;

        float hash1(float n) { return fract(sin(n) * 43758.5453); }
        vec2 hash2v(vec2 p) {
            vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(q) * 43758.5453);
        }

        // Packs (refractDirX, refractDirY, mask, unused) for one droplet grid.
        // Most droplets in a cell sit fixed (~55%, "fogged window" beading);
        // the rest slide slowly downward at their own random speed, since real
        // rain-on-glass isn't uniform - some drops stick, some run.
        vec4 dropletField(vec2 uv, float cellSize, float aspect) {
            vec2 cellBase = floor(uv / cellSize);
            vec2 rnd = hash2v(cellBase);
            float slides = step(0.55, rnd.x);
            vec2 slideUv = uv;
            slideUv.y += slides * uTime * (0.025 + rnd.y * 0.05);

            vec2 cell = floor(slideUv / cellSize);
            vec2 jitter = hash2v(cell + 3.7) - 0.5;
            vec2 local = fract(slideUv / cellSize) - 0.5 - jitter * 0.5;
            local.x *= aspect;
            float size = 0.16 + hash1(dot(cell, vec2(91.3, 17.7))) * 0.22;

            float d = length(local);
            float mask = smoothstep(size, size * 0.55, d);
            vec2 refractDir = vec2(local.x / aspect, local.y) * mask;
            return vec4(refractDir, mask, 0.0);
        }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            // Rough portrait-frame correction so grid cells read as round
            // droplets, not stretched ovals - retune if your output aspect
            // ratio differs meaningfully from 9:16.
            float aspect = 0.56;

            vec4 layerA = dropletField(vTexCoord, 0.1, aspect);
            vec4 layerB = dropletField(vTexCoord + vec2(0.37, 0.61), 0.065, aspect);

            vec2 refractOffset = layerA.xy * 22.0 * uTexelSize + layerB.xy * 16.0 * uTexelSize;
            vec4 refracted = texture2D(uTexture, vTexCoord - refractOffset);

            float dropAmount = clamp(layerA.z + layerB.z * 0.8, 0.0, 1.0);
            float rim = smoothstep(0.0, 0.4, dropAmount) - smoothstep(0.4, 0.75, dropAmount);

            vec3 outColor = mix(src.rgb, refracted.rgb, dropAmount);
            outColor += vec3(1.0) * rim * 0.2;

            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Paint Splash  -  colorful splash blobs whose visible coverage is driven
    // directly by uIntensity, which VideoTranscoder/LiveEffectPreviewView feed
    // from the SAME frame-to-frame motion delta SPLIT_PRISM already uses (see
    // VideoTranscoder.motionEffects) - move more, more/bigger splashes appear,
    // same real signal, different visual treatment. Deliberately reads
    // uIntensity per-frame rather than accumulating persistent splash state in
    // Kotlin, so a burst of motion shows paint and it fades back out as motion
    // settles, with no new Kotlin-side buffer needed (lower risk than adding
    // one, consistent with how MOOD_RING/SMILE_SHATTER stay single-value-driven).
    private val paintSplash = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: motion magnitude 0..1
        uniform float uTime;

        float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec2 hash2v(vec2 p) {
            vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(q) * 43758.5453);
        }

        // Distance from p to a capsule hanging straight down from `top` for
        // `len` units, for the drip trail below each splat.
        // NOTE: assumes -y is "down" on screen in this shader's texcoord space.
        // If drips render growing upward instead of down once this is on a
        // device, flip the sign on the two `-len` below - texcoord vertical
        // convention here depends on the camera's transform matrix and wasn't
        // confirmed on-device for this rewrite.
        float dripDist(vec2 p, vec2 top, float len) {
            float t = clamp((p.y - top.y) / -len, 0.0, 1.0);
            vec2 closest = top + vec2(0.0, -len * t);
            return distance(p, closest);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 splashColor = vec3(0.0);
            float coverage = 0.0;
            // Fewer, bigger cells than before (was 14) - blobs are now large
            // enough that 14 tightly-packed cells would just overlap into mud.
            const int CELLS = 10;
            float cellSize = 1.0 / float(CELLS);
            vec2 grid = floor(vTexCoord / cellSize);
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    vec2 cell = grid + vec2(float(dx), float(dy));
                    vec2 jitter = hash2v(cell);
                    vec2 center = (cell + jitter) * cellSize;
                    // Softer gate than before (threshold scaled to 0..0.7, was
                    // 0..1.0) so moderate motion lights up more of the
                    // neighborhood at once instead of one or two cells at a
                    // time - this was the main cause of the "dot dot" look at
                    // normal, non-extreme motion.
                    float threshold = hash2(cell + 9.3) * 0.7;
                    if (uIntensity < threshold) continue;

                    vec3 hue = fract(hash2(cell + 5.5) + uTime * 0.02) < 0.33 ? vec3(1.0, 0.2, 0.35)
                        : fract(hash2(cell + 5.5) + uTime * 0.02) < 0.66 ? vec3(0.2, 0.6, 1.0)
                        : vec3(1.0, 0.85, 0.15);

                    // Organic splat: union of 3 overlapping sub-blobs at small
                    // random offsets instead of one perfect circle, so the
                    // silhouette reads as an irregular paint splash rather
                    // than a dot. Also much bigger than before (was 0.02-0.07
                    // radius, now 0.05-0.14).
                    float baseSize = 0.05 + hash2(cell + 1.7) * 0.09;
                    float blob = 0.0;
                    for (int k = 0; k < 3; k++) {
                        vec2 sub = hash2v(cell + float(k) * 3.1) - 0.5;
                        vec2 subCenter = center + sub * baseSize * 0.7;
                        float subSize = baseSize * (0.55 + 0.45 * hash2(cell + float(k) * 7.7));
                        float d = distance(vTexCoord, subCenter);
                        blob = max(blob, smoothstep(subSize, subSize * 0.25, d));
                    }

                    // Drip trailing from the splat, fading out toward its tip.
                    float dripLen = baseSize * (1.8 + 2.0 * hash2(cell + 4.2));
                    float dd = dripDist(vTexCoord, center, dripLen);
                    float dripWidth = baseSize * 0.18;
                    float drip = smoothstep(dripWidth, dripWidth * 0.2, dd);
                    drip *= 1.0 - clamp((center.y - vTexCoord.y) / dripLen, 0.0, 1.0) * 0.7;
                    blob = max(blob, drip);

                    splashColor += hue * blob;
                    coverage = max(coverage, blob);
                }
            }
            vec3 outColor = mix(base.rgb, splashColor, coverage * 0.9);
            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Finger Draw  -  glowing trail following the index fingertip, in-frame
    // (see the enum's Phase 9 comment for why this is fingertip-tracked, not
    // touchscreen-tracked). Structurally identical to gazeTrail above, just a
    // separate uniform set so it can coexist independently and doesn't repurpose
    // GAZE_TRAIL's array meant for iris history.
    // REWRITTEN: was 8 points, discrete glowing DOTS (not connected) - too
    // few points and no line-connecting math to read as a smooth drawn curve
    // for shapes like hearts/letters, matching the reference image. Now 16
    // points (doubled - see the FrameRenderer/LiveEffectPreviewView array
    // size updates that had to move in lockstep with this constant), and
    // uses the same distToSegment line-connecting technique GAZE_TRAIL
    // already proved, plus a two-layer glow (soft wide + bright core) instead
    // of a single flat falloff.
    private const val FINGER_TRAIL_POINTS = 16
    private val fingerDraw = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uFingerPoints[$FINGER_TRAIL_POINTS];
        uniform float uFingerAges[$FINGER_TRAIL_POINTS]; // 0 = newest/brightest, 1 = oldest/gone
        uniform int uFingerCount;

        float distToSegment(vec2 p, vec2 a, vec2 b) {
            vec2 ab = b - a;
            float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
            return distance(p, a + ab * t);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 trailColor = vec3(1.0, 0.55, 0.9);
            float glow = 0.0;
            for (int i = 0; i < $FINGER_TRAIL_POINTS - 1; i++) {
                if (i + 1 >= uFingerCount) break;
                float d = distToSegment(vTexCoord, uFingerPoints[i], uFingerPoints[i + 1]);
                float fade = 1.0 - uFingerAges[i];
                // Wide soft glow + a tighter bright core, instead of one flat
                // falloff - reads as a real neon line rather than a fuzzy bar.
                glow += smoothstep(0.05, 0.0, d) * fade * 0.35;
                glow += smoothstep(0.012, 0.0, d) * fade;
            }
            if (uFingerCount > 0) {
                float dCore = distance(vTexCoord, uFingerPoints[0]);
                glow += smoothstep(0.018, 0.0, dCore) * 1.4;
            }
            gl_FragColor = vec4(base.rgb + trailColor * glow, base.a);
        }
    """.trimIndent()

    // Double Take  -  REWRITTEN from a horizontal directional smear into a real
    // radial zoom-burst, confirmed as the actual target against the reference
    // images (streaks radiating outward from the face, not a side-to-side
    // ghost). Still single-pass multi-tap sampling of the same live frame (no
    // FBO/frame-capture machinery, same reasoning as before) - just a
    // different sampling geometry: each successive tap is pulled toward the
    // real face center (uFaceBox, newly wired for this effect - see the
    // faceBoxEffects additions above) at a shrinking scale, so pixels further
    // from the face streak more than pixels near it, the classic "zoom burst"
    // look. Same real turn-speed magnitude (uIntensity) still drives how
    // strong the burst is - only the shape changed, not the signal.
    private val doubleTake = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox;
        uniform float uIntensity; // repurposed: turn speed magnitude 0..1

        void main() {
            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
            vec2 toPixel = vTexCoord - center;

            vec4 color = vec4(0.0);
            float totalWeight = 0.0;
            const int SAMPLES = 8;
            for (int i = 0; i < SAMPLES; i++) {
                float scale = 1.0 - uIntensity * 0.05 * float(i);
                vec2 sampleUv = center + toPixel * scale;
                float weight = 1.0 - float(i) / float(SAMPLES);
                color += texture2D(uTexture, sampleUv) * weight;
                totalWeight += weight;
            }
            gl_FragColor = vec4(color.rgb / totalWeight, 1.0);
        }
    """.trimIndent()

    // Blink Freeze  -  the one effect here that GENUINELY needs to hold a captured
    // frame across multiple output frames (you can't "freeze" using only the
    // current frame's pixels). Samples a plain sampler2D (FrameRenderer's
    // frozen-capture texture, filled via glCopyTexImage2D  -  see
    // FrameRenderer.captureFreezeFrame), NOT samplerExternalOES, since a
    // glCopyTexImage2D target is a normal 2D texture, not a camera/decoder
    // surface texture. Needs its own vertex shader for the zoom-punch, same
    // reasoning as HEAD_TILT_ZOOM/FIST_BUMP_BOOM  -  but no uTexMatrix here, since
    // a captured 2D texture's UVs are already normal 0..1, unlike the decoder's
    // SurfaceTexture which needs that matrix to correct for its native transform.
    private val blinkFreezeVertex = """
        uniform float uZoom; // 1.0 = no zoom, >1.0 = punched in
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying mediump vec2 vTexCoord; // FIX: precision now matches this effect's fragment shader
        void main() {
            gl_Position = vec4(aPosition.xy / uZoom, aPosition.z, aPosition.w);
            vTexCoord = aTexCoord.xy;
        }
    """.trimIndent()

    // REWRITTEN: was a plain frame freeze with zero ice treatment at all,
    // despite the name and the app's own reference image (a real frost/
    // crystal texture visibly forming across the frozen half). Reuses the
    // same Voronoi cell-edge technique SMILE_SHATTER already proved for its
    // glass-edge glint - applied STATICALLY here (no per-cell displacement,
    // no uTime jitter) since frost doesn't move once it's formed, unlike
    // shattering glass which is mid-motion. Two crystal scales layered (fine
    // + coarse) for a more organic frost network than one uniform cell size,
    // plus a desaturated cool-blue tint on the base frozen frame.
    private val blinkFreezeFragment = """
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uFrozenTexture;

        vec2 hash2(vec2 p) {
            vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
            return fract(sin(q) * 43758.5453);
        }

        // Voronoi cell-edge lines (the standard d2-d1 trick) as a crystal
        // network instead of SMILE_SHATTER's shatter pattern.
        float frostCrystals(vec2 uv, float scale) {
            vec2 p = uv * scale;
            vec2 cell = floor(p);
            float d1 = 8.0;
            float d2 = 8.0;
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    vec2 neighbor = vec2(float(x), float(y));
                    vec2 point = neighbor + hash2(cell + neighbor);
                    float d = distance(p - cell, point);
                    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
                }
            }
            return smoothstep(0.06, 0.0, d2 - d1);
        }

        void main() {
            vec4 src = texture2D(uFrozenTexture, vTexCoord);

            float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
            vec3 desat = mix(src.rgb, vec3(luma), 0.55);
            vec3 iceTint = desat * vec3(0.75, 0.88, 1.05);

            float crystalsFine = frostCrystals(vTexCoord, 38.0);
            float crystalsCoarse = frostCrystals(vTexCoord + 5.2, 14.0) * 0.6;
            float crystals = clamp(crystalsFine + crystalsCoarse, 0.0, 1.0);

            vec3 outColor = iceTint + vec3(0.9, 0.96, 1.0) * crystals * 0.5;
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    /** Returns (vertexShaderSrc, fragmentShaderSrc) for the given effect. Do not call with NONE. */
    fun source(effect: VisualEffect): Pair<String, String> = when (effect) {
        VisualEffect.VINTAGE_FLICKER -> effectVertexShader to vintageFlicker
        VisualEffect.NEON_EDGE -> effectVertexShader to neonEdge
        VisualEffect.SKIN_SMOOTH -> effectVertexShader to skinSmooth
        VisualEffect.DUOTONE_PULSE -> effectVertexShader to duotonePulse
        VisualEffect.LIQUID_CHROME -> effectVertexShader to liquidChrome
        VisualEffect.INK_WASH -> effectVertexShader to inkWash
        VisualEffect.MOOD_RING -> effectVertexShader to moodRing
        VisualEffect.WINK_SPARK -> effectVertexShader to winkSpark
        VisualEffect.SMILE_SHATTER -> effectVertexShader to smileShatter
        VisualEffect.AURA_GLOW -> effectVertexShader to auraGlow
        VisualEffect.COLOR_DRAIN -> effectVertexShader to colorDrain
        VisualEffect.HEAD_TILT_ZOOM -> headTiltZoomVertex to headTiltZoomFragment
        VisualEffect.SILENCE_RIPPLE -> effectVertexShader to silenceRipple
        VisualEffect.VOICE_HALO -> effectVertexShader to voiceHalo
        VisualEffect.THERMAL_PULSE -> effectVertexShader to thermalPulse
        VisualEffect.DEPTH_BLOOM -> effectVertexShader to depthBloom
        VisualEffect.SPLIT_PRISM -> effectVertexShader to splitPrism
        VisualEffect.HAND_PORTAL -> effectVertexShader to handPortal
        VisualEffect.FIST_BUMP_BOOM -> fistBumpBoomVertex to fistBumpBoomFragment
        VisualEffect.TWO_HAND_FRAME -> effectVertexShader to twoHandFrame
        VisualEffect.GAZE_TRAIL -> effectVertexShader to gazeTrail
        VisualEffect.DOUBLE_TAKE -> effectVertexShader to doubleTake
        VisualEffect.BLINK_FREEZE -> blinkFreezeVertex to blinkFreezeFragment
        VisualEffect.GOLD_SKIN -> effectVertexShader to goldSkin
        VisualEffect.MOUTH_FIRE -> effectVertexShader to mouthFire
        VisualEffect.SNOW_FALL -> effectVertexShader to snowFall
        VisualEffect.THROW_CONFETTI -> effectVertexShader to throwConfetti
        VisualEffect.RAISE_EYEBROW -> effectVertexShader to raiseEyebrow
        VisualEffect.GLITCH_WAVE -> effectVertexShader to glitchWave
        VisualEffect.RETRO_VHS -> effectVertexShader to retroVhs
        VisualEffect.LIGHT_LEAK -> effectVertexShader to lightLeak
        VisualEffect.MOUTH_WORDS -> effectVertexShader to mouthWordsPassthrough
        VisualEffect.PALM_MAGIC -> effectVertexShader to palmMagicSparkle
        VisualEffect.ROCK_PAPER_SCISSORS -> effectVertexShader to rockPaperScissorsPassthrough
        VisualEffect.CLAP_BURST -> effectVertexShader to clapBurst
        VisualEffect.TAP_SHOCKWAVE -> effectVertexShader to tapShockwave
        VisualEffect.SPIN_EFFECT -> effectVertexShader to spinEffect
        VisualEffect.STICKERS_REACT -> effectVertexShader to stickersReact
        VisualEffect.FACE_MORPH -> effectVertexShader to faceMorphComposite
        VisualEffect.FIRE_BOOK -> effectVertexShader to fireBook
        VisualEffect.BOKEH_LIGHTS -> effectVertexShader to bokehLights
        VisualEffect.PARTICLE_FLOW -> effectVertexShader to particleFlow
        VisualEffect.RAIN_FALL -> effectVertexShader to rainFall
        VisualEffect.PAINT_SPLASH -> effectVertexShader to paintSplash
        VisualEffect.FINGER_DRAW -> effectVertexShader to fingerDraw
        VisualEffect.NONE -> throw IllegalArgumentException("VisualEffect.NONE has no shader")
    }
}    