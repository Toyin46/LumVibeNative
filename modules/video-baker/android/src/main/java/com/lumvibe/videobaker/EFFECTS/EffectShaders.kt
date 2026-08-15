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
    STICKERS_REACT;      // real smile-triggered ParticleSystem spawning procedural
                          // heart/sparkle SHAPES (not a static emoji glued on)  -
                          // real trigger, real physics, matches section 2's "not
                          // the MAIN implementation" rule for literal emoji.

    companion object {
        /** Maps the JS-facing string (e.g. "neon_edge") to an enum value. Unknown/null -> NONE. */
        fun fromKey(key: String?): VisualEffect = when (key) {
            "vintage_flicker" -> VINTAGE_FLICKER
            "neon_edge" -> NEON_EDGE
            "duotone_pulse" -> DUOTONE_PULSE
            "liquid_chrome" -> LIQUID_CHROME
            "ink_wash" -> INK_WASH
            "mood_ring" -> MOOD_RING
            "wink_spark" -> WINK_SPARK
            "smile_shatter" -> SMILE_SHATTER
            "head_tilt_zoom" -> HEAD_TILT_ZOOM
            "aura_glow" -> AURA_GLOW
            "color_drain" -> COLOR_DRAIN
            "silence_ripple" -> SILENCE_RIPPLE
            "voice_halo" -> VOICE_HALO
            "thermal_pulse" -> THERMAL_PULSE
            "depth_bloom" -> DEPTH_BLOOM
            "split_prism" -> SPLIT_PRISM
            "hand_portal" -> HAND_PORTAL
            "fist_bump_boom" -> FIST_BUMP_BOOM
            "two_hand_frame" -> TWO_HAND_FRAME
            "gaze_trail" -> GAZE_TRAIL
            "double_take" -> DOUBLE_TAKE
            "blink_freeze" -> BLINK_FREEZE
            "gold_skin" -> GOLD_SKIN
            "mouth_fire" -> MOUTH_FIRE
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
            "fire_book" -> FIRE_BOOK
            "stickers_react" -> STICKERS_REACT
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
    private val moodRing = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: live smile score 0..1, not a static strength

        vec3 hueShift(vec3 color, float hueAdjust) {
            const vec3 kRGBToYPrime = vec3(0.299, 0.587, 0.114);
            const vec3 kRGBToI = vec3(0.596, -0.275, -0.321);
            const vec3 kRGBToQ = vec3(0.212, -0.523, 0.311);
            const vec3 kYIQToR = vec3(1.0, 0.956, 0.621);
            const vec3 kYIQToG = vec3(1.0, -0.272, -0.647);
            const vec3 kYIQToB = vec3(1.0, -1.107, 1.704);

            float yPrime = dot(color, kRGBToYPrime);
            float i = dot(color, kRGBToI);
            float q = dot(color, kRGBToQ);
            float hue = atan(q, i) + hueAdjust;
            float chroma = sqrt(i * i + q * q);
            i = chroma * cos(hue);
            q = chroma * sin(hue);
            vec3 yiq = vec3(yPrime, i, q);
            return vec3(dot(yiq, kYIQToR), dot(yiq, kYIQToG), dot(yiq, kYIQToB));
        }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            // 0 = no shift, 1 = quarter-turn hue rotation at full smile
            vec3 shifted = hueShift(src.rgb, uIntensity * 1.5708);
            gl_FragColor = vec4(shifted, src.a);
        }
    """.trimIndent()

    // Wink Spark  -  uIntensity carries the wink score (0 = both eyes open or both
    // closed, 1 = a clean single-eye wink). Spark is anchored at a fixed
    // screen-space point (roughly where a face's eye sits when someone's
    // recording themselves at arm's length) rather than a tracked eye position  -
    // FaceTracker's blendshapes give us WHICH eye winked, not WHERE it is in the
    // frame (that needs raw landmark coordinates, not blendshapes). Documented
    // simplification, same spirit as MOOD_RING's original note; upgrade path is
    // pulling landmark index 159 (left eye) / 386 (right eye) if precise
    // positioning matters later.
    private val winkSpark = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: wink score 0..1
        uniform vec2 uSparkOrigin; // normalized screen-space anchor, e.g. (0.62, 0.4)

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float d = distance(vTexCoord, uSparkOrigin);

            // Radial rays: angle-based sine comb, masked by distance falloff, so it
            // reads as a spark burst rather than a plain glowing dot.
            vec2 delta = vTexCoord - uSparkOrigin;
            float angle = atan(delta.y, delta.x);
            float rays = pow(abs(sin(angle * 10.0)), 6.0);
            float falloff = smoothstep(0.35, 0.0, d);
            float spark = rays * falloff * uIntensity;

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

    // Aura Glow  -  same neon-edge-detect core as NEON_EDGE, but the glow color
    // rotates continuously and its INTENSITY (not hue) is driven by uIntensity,
    // which VideoTranscoder feeds from AudioAmplitudeReader.amplitudeAt() each
    // frame. The pitch description asked for "color shifts with voice pitch"  -
    // real pitch detection (finding the fundamental frequency) is a materially
    // bigger DSP task than RMS amplitude; this ships amplitude-reactive first
    // as a real, tested stand-in, with pitch as a documented future upgrade
    // rather than something silently faked as "pitch."
    private val auraGlow = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uTexelSize;
        uniform float uTime;
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1

        float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

        vec3 hsv2rgb(vec3 c) {
            vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
            return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
        }

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

            float hue = fract(uTime * 0.08);
            vec3 glowColor = hsv2rgb(vec3(hue, 0.85, 1.0));
            vec3 outColor = base.rgb + glowColor * edge * (0.3 + 0.9 * uIntensity);

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

    // Voice Halo  -  a glow ring traced around FaceTracker's actual face bounding
    // box (uFaceBox: minX,minY,maxX,maxY, normalized), brightness driven by mic
    // volume via uIntensity. Falls back to a centered default box (set by
    // VideoTranscoder when no face was detected that frame) rather than a
    // sudden pop-in/out  -  same "skip gracefully" spirit as every tracker here.
    private val voiceHalo = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFaceBox; // minX, minY, maxX, maxY (normalized 0..1)
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1
        uniform float uTime;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);

            vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
            float boxSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
            float baseRadius = boxSize * 0.75;
            float d = distance(vTexCoord, center);

            // Non-linear response: quiet stays subtle, loud gets a real payoff  -
            // pow() curve instead of the old straight-line 0.4 + 0.9*intensity,
            // which made every volume level look about the same.
            float response = pow(clamp(uIntensity, 0.0, 1.0), 0.6);

            // Idle shimmer: a slow outward breathing motion even at silence, so
            // the ring never looks frozen/dead between words  -  this is what the
            // old version was missing entirely (zero motion at uIntensity = 0).
            float idleBreath = 0.03 * sin(uTime * 1.3);
            float radius = baseRadius * (1.0 + idleBreath + response * 0.12);

            // THREE layered rings at decreasing radius/opacity instead of one hard
            // edge  -  this is the single biggest difference between "a ring was
            // drawn" and "a light is glowing." Each ring uses a soft gaussian-like
            // falloff (squared distance) rather than a hard smoothstep line.
            float glow = 0.0;
            for (int i = 0; i < 3; i++) {
                float ringOffset = float(i) * 0.06;
                float ringDist = abs(d - (radius - ringOffset));
                float falloff = exp(-ringDist * ringDist * 900.0);
                glow += falloff * (1.0 - float(i) * 0.32);
            }
            glow *= (0.35 + response * 1.1);

            // Color shifts cool -> warm gold as intensity rises  -  reads as
            // "reacting to your voice" rather than a static-colored sticker.
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

            vec3 outColor = mix(split, src.rgb, mask);
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
    private val mouthFire = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uMouthCenter; // normalized 0..1
        uniform float uIntensity;  // repurposed: jawOpen score 0..1
        uniform float uTime;

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

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float openAmount = clamp(uIntensity, 0.0, 1.0);

            // Flame licks upward from the mouth (negative-y direction in this
            // texcoord space, consistent with every other position-anchored effect
            // in this file  -  same orientation VOICE_HALO/GAZE_TRAIL already use,
            // no extra flip needed here).
            float wobble = (valueNoise(vec2(vTexCoord.x * 8.0, uTime * 6.0)) - 0.5) * 0.05;
            vec2 flameSpace = vec2(vTexCoord.x - uMouthCenter.x - wobble, vTexCoord.y - uMouthCenter.y);

            float height = 0.14 + openAmount * 0.16;
            float width = 0.05 + openAmount * 0.03;
            float t = clamp(-flameSpace.y / height, 0.0, 1.0); // 0 at mouth, 1 at tip
            float coreWidth = width * (1.0 - t) * (1.0 - t);
            float edgeNoise = valueNoise(vec2(vTexCoord.x * 12.0, vTexCoord.y * 12.0 - uTime * 4.0)) * 0.02;

            float withinWidth = step(abs(flameSpace.x), coreWidth + edgeNoise);
            float aboveMouth = step(flameSpace.y, 0.02);
            float belowTip = step(-height, flameSpace.y);
            float inFlame = withinWidth * aboveMouth * belowTip;

            vec3 flameCore = vec3(1.0, 0.95, 0.6);
            vec3 flameOuter = vec3(1.0, 0.45, 0.05);
            vec3 flameColor = mix(flameOuter, flameCore, 1.0 - t);

            float flameAlpha = inFlame * openAmount;
            gl_FragColor = vec4(base.rgb + flameColor * flameAlpha, base.a);
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
    private val snowFall = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uTime;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        // Two overlapping layers at different cell sizes/speeds give a sense of
        // depth (near flakes bigger and faster, far flakes smaller and slower)
        // without needing real 3D or per-flake depth state.
        float snowLayer(vec2 uv, float cellSize, float speed, float sizeScale) {
            vec2 grid = uv;
            grid.y += uTime * speed;
            vec2 cell = floor(grid / cellSize);
            vec2 local = fract(grid / cellSize);

            float h1 = hash(cell);
            float h2 = hash(cell + vec2(17.0, 31.0));
            vec2 flakeCenter = vec2(h1, h2);
            // Gentle per-flake horizontal drift, phase offset by the flake's own
            // hash so flakes don't all sway in unison.
            flakeCenter.x += 0.15 * sin(uTime * 0.8 + h1 * 20.0);

            float d = distance(local, flakeCenter);
            float flakeSize = (0.05 + h2 * 0.05) * sizeScale;
            return smoothstep(flakeSize, flakeSize * 0.3, d);
        }

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float snow = 0.0;
            snow += snowLayer(vTexCoord, 0.08, 0.06, 1.0) * 0.9;   // near layer  -  bigger, faster
            snow += snowLayer(vTexCoord, 0.05, 0.03, 0.6) * 0.6;   // far layer  -  smaller, slower
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
                // circle, so the rotation is actually visible.
                float inRect = step(abs(local.x), 0.012) * step(abs(local.y), 0.006);
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
            // Bursty timing: mostly calm, with irregular glitch windows  -
            // reads as "a signal problem," not a constant, tiring effect.
            float burstPhase = fract(uTime * 0.4);
            float burstActive = step(0.75, hash(floor(uTime * 0.4)));
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
    private val palmMagicSparkle = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
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
            vec3 addColor = vec3(0.0);

            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                float d = distance(vTexCoord, uParticlePos[i]);
                // Soft round falloff (not a hard circle)  -  a real glow, not a
                // filled disc  -  plus a fast twinkle so each sparkle shimmers
                // rather than sitting as a static dot.
                float glow = exp(-d * d * 900.0);
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

            vec3 addColor = vec3(1.0, 0.95, 0.8) * flash;
            for (int i = 0; i < $PARTICLE_MAX; i++) {
                if (i >= uParticleCount) break;
                vec2 toP = vTexCoord - uParticlePos[i];
                float rad = radians(uParticleRot[i]);
                vec2 local = vec2(toP.x * cos(rad) + toP.y * sin(rad), -toP.x * sin(rad) + toP.y * cos(rad));
                float inShape = step(abs(local.x), 0.008) * step(abs(local.y), 0.008);
                addColor += paletteColor(uParticleColorIdx[i]) * inShape * uParticleLife[i];
            }

            gl_FragColor = vec4(base.rgb + addColor, base.a);
        }
    """.trimIndent()

    // Tap Shockwave  -  reuses uBoomCenter/uBoomEnergy again, no new uniforms.
    // The trick: radius grows as energy DECAYS (radius = (1-energy)*max), and
    // opacity fades WITH energy  -  so a single decaying-0-to-1 value drives both
    // an expanding ring's size and its fade-out, entirely in the shader.
    private val tapShockwave = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uBoomCenter;
        uniform float uBoomEnergy;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float d = distance(vTexCoord, uBoomCenter);

            float maxRadius = 0.35;
            float radius = (1.0 - uBoomEnergy) * maxRadius;
            float ringWidth = 0.015 + (1.0 - uBoomEnergy) * 0.01; // ring thins slightly as it expands
            float ring = smoothstep(ringWidth, 0.0, abs(d - radius)) * uBoomEnergy;

            vec3 ringColor = vec3(0.6, 0.85, 1.0);
            gl_FragColor = vec4(base.rgb + ringColor * ring, base.a);
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
    private val fireBook = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
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

    private val fistBumpBoomFragment = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uBoomCenter; // normalized 0..1, the fist's palm position
        uniform float uBoomEnergy;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float d = distance(vTexCoord, uBoomCenter);
            float burst = smoothstep(0.5, 0.0, d) * uBoomEnergy;
            vec3 boomColor = vec3(1.0, 0.5, 0.1);
            gl_FragColor = vec4(base.rgb + boomColor * burst * 1.5, base.a);
        }
    """.trimIndent()

    // Two-Hand Frame  -  uFrameRect is the rectangle (left,top,right,bottom,
    // normalized 0..1) spanned by both palm positions; draws a glowing vignette
    // border along that rectangle's edge. uIntensity carries gesture confidence
    // (how rectangle-like the two-hand shape currently is  -  computed in
    // VideoTranscoder, not here).
    private val twoHandFrame = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec4 uFrameRect; // left, top, right, bottom (normalized)
        uniform float uIntensity;

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            float distToEdge = min(
                min(abs(vTexCoord.x - uFrameRect.x), abs(vTexCoord.x - uFrameRect.z)),
                min(abs(vTexCoord.y - uFrameRect.y), abs(vTexCoord.y - uFrameRect.w))
            );
            bool inside = vTexCoord.x > uFrameRect.x && vTexCoord.x < uFrameRect.z &&
                          vTexCoord.y > uFrameRect.y && vTexCoord.y < uFrameRect.w;
            float border = inside ? smoothstep(0.03, 0.0, distToEdge) : 0.0;
            border *= uIntensity;
            vec3 frameColor = vec3(1.0, 0.85, 0.3);
            gl_FragColor = vec4(mix(base.rgb, frameColor, border), base.a);
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
    private val gazeTrail = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform vec2 uGazePoints[$GAZE_TRAIL_POINTS];
        uniform float uGazeAges[$GAZE_TRAIL_POINTS]; // 0 = newest/brightest, 1 = oldest/gone
        uniform int uGazeCount; // how many entries in uGazePoints are valid this frame

        void main() {
            vec4 base = texture2D(uTexture, vTexCoord);
            vec3 particleColor = vec3(0.6, 0.85, 1.0);
            float glow = 0.0;
            for (int i = 0; i < $GAZE_TRAIL_POINTS; i++) {
                if (i >= uGazeCount) break;
                float d = distance(vTexCoord, uGazePoints[i]);
                float fade = 1.0 - uGazeAges[i];
                glow += smoothstep(0.02, 0.0, d) * fade;
            }
            gl_FragColor = vec4(base.rgb + particleColor * glow, base.a);
        }
    """.trimIndent()

    // Double Take  -  reimagined as a SINGLE-PASS directional streak (multi-tap
    // sampling of the SAME live frame at offset UVs) rather than blending real
    // historical frames. This is a deliberate, safer substitute for a true
    // afterimage: it reads as a fast-turn ghost/blur without needing any
    // frame-capture or FBO machinery, at the cost of not showing your ACTUAL
    // previous pose (just a directional smear). If you want the literal
    // multi-frame ghost from the original pitch later, that's a genuinely
    // different (and riskier) technique  -  worth a dedicated pass on its own,
    // not bundled in here.
    private val doubleTake = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: turn speed magnitude 0..1
        uniform float uDirection; // repurposed: turn direction, -1..1

        void main() {
            vec4 color = texture2D(uTexture, vTexCoord) * 0.55;
            float totalWeight = 0.55;
            for (int i = 1; i <= 4; i++) {
                float w = 0.4 / float(i);
                vec2 offset = vec2(uDirection * 0.012 * float(i) * uIntensity, 0.0);
                color += texture2D(uTexture, vTexCoord - offset) * w;
                totalWeight += w;
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

    private val blinkFreezeFragment = """
        precision mediump float;
        varying vec2 vTexCoord;
        uniform sampler2D uFrozenTexture;
        void main() {
            gl_FragColor = texture2D(uFrozenTexture, vTexCoord);
        }
    """.trimIndent()

    /** Returns (vertexShaderSrc, fragmentShaderSrc) for the given effect. Do not call with NONE. */
    fun source(effect: VisualEffect): Pair<String, String> = when (effect) {
        VisualEffect.VINTAGE_FLICKER -> effectVertexShader to vintageFlicker
        VisualEffect.NEON_EDGE -> effectVertexShader to neonEdge
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
        VisualEffect.NONE -> throw IllegalArgumentException("VisualEffect.NONE has no shader")
    }
}    
