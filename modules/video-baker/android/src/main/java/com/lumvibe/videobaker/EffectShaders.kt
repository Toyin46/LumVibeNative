package com.lumvibe.videobaker

/**
* "Phase 1" visual effects — the ones that need ONLY the decoded video frame
* itself, no MediaPipe face/hand tracking, no audio decode, no device motion.
* That's why these five are safe to ship now: Mood Ring, Gaze Trail, Hand
* Portal, Split Prism, and the audio-beat-synced version of Duotone Pulse all
* need extra subsystems (face mesh, hand landmarks, mic amplitude, or device
* motion capture) that aren't wired into VideoTranscoder yet. See the README
* for the phased plan to add those.
*
* Every fragment shader here samples the decoder's output directly
* (samplerExternalOES), so each one is a drop-in replacement for the plain
* "pass-through" video shader already in FrameRenderer — see drawEffectFrame().
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
    // VideoTranscoder.FACE_SCORE_EFFECTS for the generic wiring (added below —
    // MOOD_RING's original hardcoded branch has been folded into that set). ----
    MOOD_RING,
    WINK_SPARK,     // uIntensity = single-eye blink score (one eye closed, other open)
    SMILE_SHATTER,  // uIntensity = smile score (same signal as MOOD_RING, different shader)
    // ---- Phase 2b: needs FaceTracker's head-pose decomposition (headPoseDegrees) —
    // see VideoTranscoder.FACE_POSE_EFFECTS. Not yet wired; see README note. ----
    HEAD_TILT_ZOOM,
    // ---- Phase 3: needs AudioAmplitudeReader — see VideoTranscoder.AUDIO_SCORE_EFFECTS ----
    AURA_GLOW,      // uIntensity = normalized audio amplitude (stand-in for "voice pitch,"
                     // which needs real pitch detection — see class doc below)
    // ---- Phase 3b: needs per-frame motion estimate computed in Kotlin (frame-to-frame
    // luma diff), not a new tracker class — see VideoTranscoder.stillnessSeconds ----
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
    // rather than needing real cross-frame GPU buffers — see their shader docs below.
    // BLINK_FREEZE is the one genuine exception: it holds one captured frame across
    // several output frames, which needs FrameRenderer's new freeze-capture texture. ----
    GAZE_TRAIL,          // particle trail following iris position, last N positions only
    DOUBLE_TAKE,         // directional ghost streak on fast head turn (yaw delta)
    BLINK_FREEZE,        // freeze-frame + zoom punch on blink, held for ~0.3s
    // ---- Phase 8: same trackers as above (SegmentationTracker, FaceTracker), new
    // visual treatments — full-body recolor and a mouth-anchored procedural flame. ----
    GOLD_SKIN,           // person (via segmentation mask) recolored through a metallic
                          // gold gradient, luminance-mapped so shading/detail survives —
                          // background untouched. Needs SegmentationTracker only.
    MOUTH_FIRE;          // procedural flame anchored at mouth center, sized by how open
                          // the mouth is (jawOpen blendshape). Needs FaceTracker.

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
            else -> NONE
        }
    }
}

object EffectShaders {

    // Same vertex shader as the plain video pass — applies the SurfaceTexture's
    // transform matrix so orientation/cropping stays correct for every effect.
    private val effectVertexShader = """
        uniform mat4 uTexMatrix;
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
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
            // sync (which needs the audio-amplitude decode pass — see README Phase 2).
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
    // "skin-tone area only" — that needs a face-contour mask built from landmark
    // points, which is a real follow-on step once this base pipeline (readback ->
    // FaceTracker -> per-frame score -> shader) is confirmed working end to end.
    // uIntensity is repurposed here to carry the live smile score (0..1) each frame,
    // set by VideoTranscoder right before this draw call — same uniform, no new
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

    // Wink Spark — uIntensity carries the wink score (0 = both eyes open or both
    // closed, 1 = a clean single-eye wink). Spark is anchored at a fixed
    // screen-space point (roughly where a face's eye sits when someone's
    // recording themselves at arm's length) rather than a tracked eye position —
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

    // Smile Shatter — uIntensity carries the smile score. Renders a static
    // glass-crack line pattern (procedural, not physically simulated shards)
    // whose opacity scales with smile strength, plus a mild UV displacement
    // along the crack lines so it reads as "fracturing" rather than a flat
    // decal. Simpler than the pitch's "shatters & reforms" animation (which
    // implies frame-to-frame physics/particle state); this is the shader-only
    // first version — flagging so it isn't mistaken for the full effect.
    private val smileShatter = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: smile score 0..1

        float crackLine(vec2 uv, vec2 from, vec2 to, float width) {
            vec2 pa = uv - from;
            vec2 ba = to - from;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            return smoothstep(width, 0.0, length(pa - ba * h));
        }

        void main() {
            vec2 uv = vTexCoord;
            float cracks = 0.0;
            cracks += crackLine(uv, vec2(0.5, 0.5), vec2(0.15, 0.10), 0.004);
            cracks += crackLine(uv, vec2(0.5, 0.5), vec2(0.85, 0.20), 0.004);
            cracks += crackLine(uv, vec2(0.5, 0.5), vec2(0.75, 0.90), 0.004);
            cracks += crackLine(uv, vec2(0.5, 0.5), vec2(0.20, 0.85), 0.004);
            cracks += crackLine(uv, vec2(0.5, 0.5), vec2(0.05, 0.55), 0.004);
            cracks = clamp(cracks, 0.0, 1.0) * uIntensity;

            // Slight refraction along cracks so the underlying video looks
            // physically split, not just line-decaled.
            vec2 offset = (uv - 0.5) * cracks * 0.02;
            vec4 base = texture2D(uTexture, uv + offset);

            vec3 outColor = mix(base.rgb, vec3(1.0), cracks * 0.6);
            gl_FragColor = vec4(outColor, base.a);
        }
    """.trimIndent()

    // Aura Glow — same neon-edge-detect core as NEON_EDGE, but the glow color
    // rotates continuously and its INTENSITY (not hue) is driven by uIntensity,
    // which VideoTranscoder feeds from AudioAmplitudeReader.amplitudeAt() each
    // frame. The pitch description asked for "color shifts with voice pitch" —
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

    // Color Drain — uIntensity here is repurposed to carry "stillness" (0 = just
    // moved, 1 = been still for a while), computed in VideoTranscoder from
    // frame-to-frame luma difference (see stillnessSeconds there) rather than a
    // device motion sensor. That substitution is a deliberate, necessary
    // adaptation: this whole pipeline bakes effects into an ALREADY-RECORDED
    // file after the fact, so there is no live gyroscope/accelerometer stream
    // available during the bake pass — motion has to be estimated from the
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
    // not by sampling a different UV in the fragment shader — cheaper and avoids
    // edge-clamping artifacts you'd get zooming in the fragment stage.
    private val headTiltZoomVertex = """
        uniform mat4 uTexMatrix;
        uniform float uZoom;   // 1.0 = no zoom, >1.0 = zoomed in
        uniform vec2 uPan;     // -1..1 range, NDC-space pan offset
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
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

    // Silence Ripple — a continuously-running expanding-ring pattern (driven by
    // uTime, same "one video timeline" contract as every other time-based effect
    // here), whose VISIBILITY is gated by uIntensity = 1-amplitude (so it's
    // essentially invisible while there's normal audio, and fades in as things go
    // quiet). No new uniforms needed — reuses uTime/uIntensity, VideoTranscoder
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

    // Voice Halo — a glow ring traced around FaceTracker's actual face bounding
    // box (uFaceBox: minX,minY,maxX,maxY, normalized), brightness driven by mic
    // volume via uIntensity. Falls back to a centered default box (set by
    // VideoTranscoder when no face was detected that frame) rather than a
    // sudden pop-in/out — same "skip gracefully" spirit as every tracker here.
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

            // Non-linear response: quiet stays subtle, loud gets a real payoff —
            // pow() curve instead of the old straight-line 0.4 + 0.9*intensity,
            // which made every volume level look about the same.
            float response = pow(clamp(uIntensity, 0.0, 1.0), 0.6);

            // Idle shimmer: a slow outward breathing motion even at silence, so
            // the ring never looks frozen/dead between words — this is what the
            // old version was missing entirely (zero motion at uIntensity = 0).
            float idleBreath = 0.03 * sin(uTime * 1.3);
            float radius = baseRadius * (1.0 + idleBreath + response * 0.12);

            // THREE layered rings at decreasing radius/opacity instead of one hard
            // edge — this is the single biggest difference between "a ring was
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

            // Color shifts cool -> warm gold as intensity rises — reads as
            // "reacting to your voice" rather than a static-colored sticker.
            vec3 quietColor = vec3(0.25, 0.65, 1.0);
            vec3 loudColor  = vec3(1.0, 0.75, 0.25);
            vec3 glowColor = mix(quietColor, loudColor, response);

            gl_FragColor = vec4(base.rgb + glowColor * glow, base.a);
        }
    """.trimIndent()

    // Thermal Pulse — fake heat-map palette, restricted to a rough SKIN-TONE mask
    // computed directly from the pixel color itself (a standard normalized-RGB
    // skin heuristic), not from FaceTracker — this ships as a simplified
    // whole-frame-skin-detection version rather than the pitch's precise
    // "face-mesh-only" region, same documented-simplification spirit as
    // MOOD_RING originally shipped with. Pulses with uIntensity = audio
    // amplitude, standing in for "breath rhythm" — real breath-rhythm detection
    // (isolating breathing from a mic signal) is its own nontrivial DSP problem,
    // not something to silently claim as solved.
    private val thermalPulse = EXT_HEADER + """
        varying vec2 vTexCoord;
        uniform samplerExternalOES uTexture;
        uniform float uIntensity; // repurposed: normalized audio amplitude 0..1

        bool isSkin(vec3 c) {
            float maxC = max(c.r, max(c.g, c.b));
            float minC = min(c.r, min(c.g, c.b));
            return c.r > 0.35 && c.r > c.g && c.r > c.b * 0.9 && (maxC - minC) > 0.05;
        }

        vec3 heatColor(float t) {
            vec3 cold = vec3(0.0, 0.0, 0.6);
            vec3 mid = vec3(1.0, 0.6, 0.0);
            vec3 hot = vec3(1.0, 1.0, 0.4);
            return t < 0.5 ? mix(cold, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
        }

        void main() {
            vec4 src = texture2D(uTexture, vTexCoord);
            if (isSkin(src.rgb)) {
                float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
                float heat = clamp(luma * (0.6 + 0.6 * uIntensity), 0.0, 1.0);
                gl_FragColor = vec4(heatColor(heat), src.a);
            } else {
                gl_FragColor = src;
            }
        }
    """.trimIndent()

    // Depth Bloom — uMaskTexture is SegmentationTracker's per-frame foreground
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

    // Split Prism — background (via uMaskTexture, same as Depth Bloom) splits into
    // 3 offset RGB layers. uIntensity here is repurposed as a MOTION magnitude —
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

    // Gold Skin — same uMaskTexture convention as Depth Bloom/Split Prism above
    // (SegmentationTracker's person mask, white=person). Recolors ONLY the person
    // through a 3-stop gold gradient MAPPED BY LUMINANCE, not a flat tint — that's
    // what keeps shading/detail (jawline, wrinkles, clothing folds) readable as
    // "metal" instead of just "yellow." A slow diagonal sheen sweep (uTime-driven)
    // adds a liquid-metal highlight so it doesn't read as a static color filter.
    // No uIntensity — this one's always at full strength when selected, nothing to
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

            // Diagonal sheen band drifting slowly across the body — mimics light
            // catching liquid/polished metal rather than a flat painted surface.
            float sheenPos = fract((vTexCoord.x + vTexCoord.y) * 1.5 - uTime * 0.15);
            float sheen = smoothstep(0.42, 0.5, sheenPos) * smoothstep(0.58, 0.5, sheenPos);
            gold += sheen * 0.25;

            vec3 outColor = mix(src.rgb, gold, mask);
            gl_FragColor = vec4(outColor, src.a);
        }
    """.trimIndent()

    // Mouth Fire — uMouthCenter is FaceTracker.mouthCenter() (landmarks 13/14
    // midpoint), uIntensity is repurposed as the "jawOpen" blendshape score, same
    // repurposed-uIntensity convention as MOOD_RING/SMILE_SHATTER. Procedural flame
    // (hash/value-noise, no texture asset needed) grows taller and wider the more
    // the mouth opens, licking upward with a flickering noise-driven wobble rather
    // than sitting as a static triangle — this is what separates "a shape was drawn
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
            // in this file — same orientation VOICE_HALO/GAZE_TRAIL already use,
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

    // Hand Portal — uPortalTexture is a STATIC scene image (loaded once via
    // OverlayBuilder-style loader, like the watermark logo — NOT a second video;
    // a full video-in-video portal is a materially bigger feature — a portal
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

    // Fist Bump Boom needs its OWN vertex shader for the screen-shake part —
    // same reason HEAD_TILT_ZOOM does (a fragment-only shake would just look
    // like blur, not an actual camera-shake feel). uBoomEnergy starts at 1.0 the
    // frame a fist is detected and decays exponentially over subsequent frames —
    // see VideoTranscoder's boomEnergy state variable.
    private val fistBumpBoomVertex = """
        uniform mat4 uTexMatrix;
        uniform float uBoomEnergy; // 1.0 = just triggered, decays toward 0
        uniform float uTime;
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;

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

    // Two-Hand Frame — uFrameRect is the rectangle (left,top,right,bottom,
    // normalized 0..1) spanned by both palm positions; draws a glowing vignette
    // border along that rectangle's edge. uIntensity carries gesture confidence
    // (how rectangle-like the two-hand shape currently is — computed in
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

    // Gaze Trail — SINGLE-PASS technique, no cross-frame GPU state: VideoTranscoder
    // keeps the last 8 iris positions in a plain Kotlin array (see
    // VideoTranscoder.gazeHistory) and uploads the whole array as a uniform every
    // frame. Older points are simply dimmer (via uGazeAges) — the "trail" comes
    // from Kotlin remembering positions over time, not from the GPU accumulating
    // anything, which is what keeps this safely in the same risk category as
    // every other single-pass effect above rather than needing an FBO.
    private const val GAZE_TRAIL_POINTS = 8
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

    // Double Take — reimagined as a SINGLE-PASS directional streak (multi-tap
    // sampling of the SAME live frame at offset UVs) rather than blending real
    // historical frames. This is a deliberate, safer substitute for a true
    // afterimage: it reads as a fast-turn ghost/blur without needing any
    // frame-capture or FBO machinery, at the cost of not showing your ACTUAL
    // previous pose (just a directional smear). If you want the literal
    // multi-frame ghost from the original pitch later, that's a genuinely
    // different (and riskier) technique — worth a dedicated pass on its own,
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

    // Blink Freeze — the one effect here that GENUINELY needs to hold a captured
    // frame across multiple output frames (you can't "freeze" using only the
    // current frame's pixels). Samples a plain sampler2D (FrameRenderer's
    // frozen-capture texture, filled via glCopyTexImage2D — see
    // FrameRenderer.captureFreezeFrame), NOT samplerExternalOES, since a
    // glCopyTexImage2D target is a normal 2D texture, not a camera/decoder
    // surface texture. Needs its own vertex shader for the zoom-punch, same
    // reasoning as HEAD_TILT_ZOOM/FIST_BUMP_BOOM — but no uTexMatrix here, since
    // a captured 2D texture's UVs are already normal 0..1, unlike the decoder's
    // SurfaceTexture which needs that matrix to correct for its native transform.
    private val blinkFreezeVertex = """
        uniform float uZoom; // 1.0 = no zoom, >1.0 = punched in
        attribute vec4 aPosition;
        attribute vec4 aTexCoord;
        varying vec2 vTexCoord;
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
        VisualEffect.NONE -> throw IllegalArgumentException("VisualEffect.NONE has no shader")
    }
}   
