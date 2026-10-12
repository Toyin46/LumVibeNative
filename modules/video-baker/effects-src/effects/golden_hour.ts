import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — warm directional wash simulating low sun, plus a soft haze.
export default defineEffect({
  id: "golden_hour",
  displayName: "Golden Hour",
  category: "beauty",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() {
      vec3 c = texture2D(uTexture, vTexCoord).rgb;
      c.r *= 1.12; c.g *= 1.03; c.b *= 0.85;
      float grad = smoothstep(1.0, 0.0, vTexCoord.y);
      c += vec3(0.10, 0.05, 0.0) * grad;
      float haze = smoothstep(0.9, 0.2, distance(vTexCoord, vec2(0.5, 0.35)));
      c = mix(c, c * 1.05 + vec3(0.03, 0.02, 0.0), haze * 0.5);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
  bindings: {},
});
