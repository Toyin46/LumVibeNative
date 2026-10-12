import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — simulates an on-camera flash: brighter, punchier contrast, cooler
// white balance, a subtle central hotspot falloff.
export default defineEffect({
  id: "flash_camera",
  displayName: "Flash Camera",
  category: "beauty",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() {
      vec3 c = texture2D(uTexture, vTexCoord).rgb;
      c = (c - 0.5) * 1.15 + 0.5 + 0.06;
      c.b *= 1.03; c.r *= 0.99;
      float hotspot = smoothstep(0.75, 0.0, distance(vTexCoord, vec2(0.5)));
      c += hotspot * 0.08;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
  bindings: {},
});
