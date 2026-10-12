import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "skin_smooth",
  displayName: "Skin Smooth",
  category: "beauty",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uTexelSize;
    uniform float uIntensity;
    void main() {
      vec4 center = texture2D(uTexture, vTexCoord);
      vec3 cc = center.rgb;
      vec2 o = uTexelSize * 1.5;
      vec3 c00 = texture2D(uTexture, vTexCoord + o * vec2(-1.0,  1.0)).rgb;
      vec3 c01 = texture2D(uTexture, vTexCoord + o * vec2( 0.0,  1.0)).rgb;
      vec3 c02 = texture2D(uTexture, vTexCoord + o * vec2( 1.0,  1.0)).rgb;
      vec3 c10 = texture2D(uTexture, vTexCoord + o * vec2(-1.0,  0.0)).rgb;
      vec3 c12 = texture2D(uTexture, vTexCoord + o * vec2( 1.0,  0.0)).rgb;
      vec3 c20 = texture2D(uTexture, vTexCoord + o * vec2(-1.0, -1.0)).rgb;
      vec3 c21 = texture2D(uTexture, vTexCoord + o * vec2( 0.0, -1.0)).rgb;
      vec3 c22 = texture2D(uTexture, vTexCoord + o * vec2( 1.0, -1.0)).rgb;
      float wSum = 1.0; vec3 sum = cc; float w;
      w = 1.0 - clamp(distance(c00, cc) * 8.0, 0.0, 1.0); sum += c00 * w; wSum += w;
      w = 1.0 - clamp(distance(c01, cc) * 8.0, 0.0, 1.0); sum += c01 * w; wSum += w;
      w = 1.0 - clamp(distance(c02, cc) * 8.0, 0.0, 1.0); sum += c02 * w; wSum += w;
      w = 1.0 - clamp(distance(c10, cc) * 8.0, 0.0, 1.0); sum += c10 * w; wSum += w;
      w = 1.0 - clamp(distance(c12, cc) * 8.0, 0.0, 1.0); sum += c12 * w; wSum += w;
      w = 1.0 - clamp(distance(c20, cc) * 8.0, 0.0, 1.0); sum += c20 * w; wSum += w;
      w = 1.0 - clamp(distance(c21, cc) * 8.0, 0.0, 1.0); sum += c21 * w; wSum += w;
      w = 1.0 - clamp(distance(c22, cc) * 8.0, 0.0, 1.0); sum += c22 * w; wSum += w;
      vec3 smoothed = sum / wSum;
      vec3 outColor = mix(cc, smoothed, 0.7 * uIntensity);
      outColor *= 1.03;
      outColor += vec3(0.012, 0.008, 0.0) * uIntensity;
      gl_FragColor = vec4(outColor, center.a);
    }
  `,
  bindings: {},
  constants: { uIntensity: 1.0 },
});
