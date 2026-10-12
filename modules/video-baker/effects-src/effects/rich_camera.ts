import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — saturation + contrast + micro-clarity push for a "premium camera"
// look, without the directional color casts of golden_hour/flash_camera.
export default defineEffect({
  id: "rich_camera",
  displayName: "Rich Camera",
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
      c = mix(vec3(luma), c, 1.25);
      c = (c - 0.5) * 1.10 + 0.5;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
  bindings: {},
});
