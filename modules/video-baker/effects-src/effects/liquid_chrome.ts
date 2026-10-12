import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "liquid_chrome",
  displayName: "Liquid Chrome",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    uniform float uIntensity;
    void main() {
      vec2 uv = vTexCoord;
      float t = uTime * 0.6;
      vec2 warp = vec2(
        sin(uv.y * 12.0 + t) * 0.010,
        cos(uv.x * 10.0 + t * 1.3) * 0.010
      ) * uIntensity;
      vec2 uvR = uv + warp + vec2(0.004, 0.0) * uIntensity;
      vec2 uvG = uv + warp;
      vec2 uvB = uv + warp - vec2(0.004, 0.0) * uIntensity;
      float r = texture2D(uTexture, uvR).r;
      float g = texture2D(uTexture, uvG).g;
      float b = texture2D(uTexture, uvB).b;
      float a = texture2D(uTexture, uvG).a;
      vec3 color = vec3(r, g, b);
      float sheen = smoothstep(0.05, 0.0, abs(fract(uv.x + uv.y - t * 0.3) - 0.5));
      color += sheen * 0.25 * uIntensity;
      gl_FragColor = vec4(color, a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
  constants: { uIntensity: 1.0 },
});
