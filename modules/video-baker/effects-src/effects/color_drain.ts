import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "color_drain",
  displayName: "Color Drain",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uIntensity; // stillness amount 0..1
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float gray = luma(src.rgb);
      vec3 desaturated = vec3(gray);
      gl_FragColor = vec4(mix(src.rgb, desaturated, uIntensity), src.a);
    }
  `,
  bindings: { uIntensity: "stillness.amount" },
  staticFallback: { uIntensity: 1 }, // a still photo counts as fully "still"
});
