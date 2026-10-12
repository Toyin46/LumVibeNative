import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Aura Glow v2 - neon violet aura around the person: bright rim light hugging
// the silhouette, soft violet halo, flowing magenta wisps, sparkles, and a dark
// purple moody grade on the background. Uses the person mask (segmentation) and
// reacts a little to audio.
// TUNING (manifest constant, no rebuild): uAura = overall strength (1.0 normal,
// 1.4 stronger, 0.7 softer).
export default defineEffect({
  id: "aura_glow",
  displayName: "Aura Glow",
  category: "environment",
  requires: ["segmentation", "audio"],
  fragmentShader:
    EXT_HEADER +
    `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #endif
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform vec2 uTexelSize;
    uniform float uTime;
    uniform float uIntensity;
    uniform float uAura;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) { return 0.6 * vnoise(p) + 0.4 * vnoise(p * 2.1 + 7.3); }
    float maskAt(vec2 uv) { return texture2D(uMaskTexture, uv).a; }

    void main() {
      vec3 base = texture2D(uTexture, vTexCoord).rgb;
      float aspect = uTexelSize.y / uTexelSize.x;
      vec2 A = vec2(aspect, 1.0);
      vec2 p = vTexCoord * A;
      float mask = maskAt(vTexCoord);
      float t = uTime;

      vec2 q = p * 5.0 + vec2(0.0, -t * 0.9);
      vec2 warp = vec2(fbm(q) - 0.5, fbm(q + 11.7) - 0.5);
      float rot = hash(vTexCoord * 91.7) * 0.785398;

      float c1 = 0.0;
      float c2 = 0.0;
      float c3 = 0.0;
      float c4 = 0.0;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398 + rot;
        vec2 d = vec2(cos(a), sin(a));
        c1 += maskAt((p + d * 0.007) / A);
        c2 += maskAt((p + d * 0.022 + warp * 0.012) / A);
        c3 += maskAt((p + d * 0.050 + warp * 0.035) / A);
        c4 += maskAt((p + d * 0.100 + warp * 0.070) / A);
      }
      c1 /= 8.0;
      c2 /= 8.0;
      c3 /= 8.0;
      c4 /= 8.0;

      float outside = 1.0 - mask;
      float rimOut = outside * smoothstep(0.0, 0.5, c1);
      float rimIn = mask * (1.0 - smoothstep(0.55, 1.0, c1));
      float glowA = outside * c2;
      float glowB = outside * c3;
      float glowC = outside * c4;
      float n = fbm(p * vec2(7.0, 4.0) + vec2(0.0, -t * 0.6));
      float wisp = glowC * (0.08 + 1.7 * smoothstep(0.45, 0.72, n));
      float pulse = uAura * (0.85 + 0.6 * uIntensity + 0.05 * sin(t * 2.0));

      vec3 core = vec3(0.92, 0.80, 1.0);
      vec3 violet = vec3(0.55, 0.15, 1.0);
      vec3 magenta = vec3(0.95, 0.25, 0.95);
      vec3 aura = core * (rimOut * 1.6 + rimIn * 0.8)
                + violet * (glowA * 0.95 + glowB * 0.5)
                + magenta * (wisp * 1.25 + glowB * 0.18);

      vec2 sg = floor(p / 0.022);
      float sh = hash(sg);
      vec2 sc = (sg + 0.5 + (vec2(hash(sg + 1.7), hash(sg + 5.3)) - 0.5) * 0.5) * 0.022;
      float tw = pow(0.5 + 0.5 * sin(t * 3.0 + sh * 40.0), 6.0);
      float spark = step(0.965, sh) * tw * smoothstep(0.016, 0.0, distance(p, sc)) * smoothstep(0.08, 0.5, glowB + glowC);
      aura += vec3(0.9, 0.75, 1.0) * spark * 1.6;
      aura *= pulse;

      vec3 bg = base * vec3(0.36, 0.25, 0.60);
      vec3 fg = base * vec3(0.95, 0.82, 1.08) + violet * rimIn * 0.35 * pulse + magenta * mask * c3 * 0.18 * pulse;
      vec3 col = mix(bg, fg, mask);
      vec3 glow = clamp(1.0 - exp(-aura * 1.15), 0.0, 1.0);
      col = 1.0 - (1.0 - col) * (1.0 - glow);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  bindings: { uTime: "time.elapsed", uIntensity: "audio.amplitude" },
  constants: { uAura: 1.0 },
});
