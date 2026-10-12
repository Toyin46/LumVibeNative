import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW (not in the old Kotlin) — pure color-grade shader: lifted shadows,
// gentle highlight rolloff, warm-cool split tone, soft vignette.
export default defineEffect({
  id: "cinematic_glow",
  displayName: "Cinematic Glow",
  category: "beauty",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() {
      vec3 c = texture2D(uTexture, vTexCoord).rgb;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, c * 1.08 + 0.02, smoothstep(0.0, 0.4, luma));
      c = c / (c + vec3(0.06));
      vec3 shadowTint = vec3(0.02, 0.03, 0.05);
      vec3 highlightTint = vec3(0.04, 0.02, -0.01);
      c += shadowTint * (1.0 - luma) + highlightTint * luma;
      float vig = smoothstep(0.95, 0.35, distance(vTexCoord, vec2(0.5)));
      c *= mix(0.82, 1.0, vig);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
  bindings: {},
});
