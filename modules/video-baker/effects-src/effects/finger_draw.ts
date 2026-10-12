import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "finger_draw",
  displayName: "Finger Draw",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uFingerPoints[16];
    uniform float uFingerAges[16];
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
      for (int i = 0; i < 15; i++) {
        if (i + 1 >= uFingerCount) break;
        float d = distToSegment(vTexCoord, uFingerPoints[i], uFingerPoints[i + 1]);
        float fade = 1.0 - uFingerAges[i];
        glow += smoothstep(0.05, 0.0, d) * fade * 0.35;
        glow += smoothstep(0.012, 0.0, d) * fade;
      }
      if (uFingerCount > 0) {
        float dCore = distance(vTexCoord, uFingerPoints[0]);
        glow += smoothstep(0.018, 0.0, dCore) * 1.4;
      }
      gl_FragColor = vec4(base.rgb + trailColor * glow, base.a);
    }
  `,
  bindings: {
    uFingerPoints: "hand.0.fingerTrailPoints",
    uFingerAges: "hand.0.fingerTrailAges",
    uFingerCount: "hand.0.fingerTrailCount",
  },
});
