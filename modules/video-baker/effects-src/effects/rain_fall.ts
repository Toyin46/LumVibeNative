import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Displayed in the gallery as "Rain Drop" — droplets refracting the scene
// behind them (condensation-on-glass look), not falling streaks.
export default defineEffect({
  id: "rain_fall",
  displayName: "Rain Drop",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uTexelSize;
    uniform float uTime;
    float hash1(float n) { return fract(sin(n) * 43758.5453); }
    vec2 hash2v(vec2 p) {
      vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(q) * 43758.5453);
    }
    vec4 dropletField(vec2 uv, float cellSize, float aspect) {
      vec2 cellBase = floor(uv / cellSize);
      vec2 rnd = hash2v(cellBase);
      float slides = step(0.55, rnd.x);
      vec2 slideUv = uv;
      slideUv.y += slides * uTime * (0.025 + rnd.y * 0.05);
      vec2 cell = floor(slideUv / cellSize);
      vec2 jitter = hash2v(cell + 3.7) - 0.5;
      vec2 local = fract(slideUv / cellSize) - 0.5 - jitter * 0.5;
      local.x *= aspect;
      float size = 0.16 + hash1(dot(cell, vec2(91.3, 17.7))) * 0.22;
      float d = length(local);
      float mask = smoothstep(size, size * 0.55, d);
      vec2 refractDir = vec2(local.x / aspect, local.y) * mask;
      return vec4(refractDir, mask, 0.0);
    }
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float aspect = 0.56;
      vec4 layerA = dropletField(vTexCoord, 0.1, aspect);
      vec4 layerB = dropletField(vTexCoord + vec2(0.37, 0.61), 0.065, aspect);
      vec2 refractOffset = layerA.xy * 22.0 * uTexelSize + layerB.xy * 16.0 * uTexelSize;
      vec4 refracted = texture2D(uTexture, vTexCoord - refractOffset);
      float dropAmount = clamp(layerA.z + layerB.z * 0.8, 0.0, 1.0);
      float rim = smoothstep(0.0, 0.4, dropAmount) - smoothstep(0.4, 0.75, dropAmount);
      vec3 outColor = mix(src.rgb, refracted.rgb, dropAmount);
      outColor += vec3(1.0) * rim * 0.2;
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
