import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "ink_wash",
  displayName: "Ink Wash",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
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
  `,
  bindings: {},
  constants: { uIntensity: 1.0 },
});
