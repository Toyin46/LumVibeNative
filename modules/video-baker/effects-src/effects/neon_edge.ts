import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "neon_edge",
  displayName: "Neon Edge",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
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
  `,
  bindings: {},
  constants: {
    uIntensity: 1.0,
    uGlowColor: [0.10, 1.00, 0.85],
  },
});
