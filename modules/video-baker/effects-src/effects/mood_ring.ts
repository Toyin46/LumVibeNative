import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// CORRECTED from the first pass: exact shader body from the working Kotlin
// (EffectShaders.kt's moodRing) — a rotating rainbow-glow ring around the
// face. "Don't break what's working" means porting pixel-for-pixel, not
// re-deriving from the idea.
export default defineEffect({
  id: "mood_ring",
  displayName: "Mood Ring",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // live smile score 0..1
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

      float hue = fract((angle / 6.28318) + spin);
      vec3 ringColor = hsv2rgb(vec3(hue, 0.85, 1.0));
      gl_FragColor = vec4(base.rgb + ringColor * glow, base.a);
    }
  `,
  bindings: {
    uIntensity: "face.smileScore",
    uFaceBox: "face.boundingBox",
    uTime: "time.elapsed",
  },
  staticFallback: { uIntensity: 0 },
});
