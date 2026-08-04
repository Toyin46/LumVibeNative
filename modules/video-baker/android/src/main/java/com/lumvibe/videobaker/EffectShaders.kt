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
    VINTAGE_FLICKER,
    NEON_EDGE,
    DUOTONE_PULSE,
    LIQUID_CHROME,
    INK_WASH,
    MOOD_RING; // Phase 2 — needs FaceTracker; see VideoTranscoder for the wiring

    companion object {
        /** Maps the JS-facing string (e.g. "neon_edge") to an enum value. Unknown/null -> NONE. */
        fun fromKey(key: String?): VisualEffect = when (key) {
            "vintage_flicker" -> VINTAGE_FLICKER
            "neon_edge" -> NEON_EDGE
            "duotone_pulse" -> DUOTONE_PULSE
            "liquid_chrome" -> LIQUID_CHROME
            "ink_wash" -> INK_WASH
            "mood_ring" -> MOOD_RING
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

    /** Returns (vertexShaderSrc, fragmentShaderSrc) for the given effect. Do not call with NONE. */
    fun source(effect: VisualEffect): Pair<String, String> = when (effect) {
        VisualEffect.VINTAGE_FLICKER -> effectVertexShader to vintageFlicker
        VisualEffect.NEON_EDGE -> effectVertexShader to neonEdge
        VisualEffect.DUOTONE_PULSE -> effectVertexShader to duotonePulse
        VisualEffect.LIQUID_CHROME -> effectVertexShader to liquidChrome
        VisualEffect.INK_WASH -> effectVertexShader to inkWash
        VisualEffect.MOOD_RING -> effectVertexShader to moodRing
        VisualEffect.NONE -> throw IllegalArgumentException("VisualEffect.NONE has no shader")
    }
} 
