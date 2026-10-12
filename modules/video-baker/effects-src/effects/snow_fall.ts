import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "snow_fall",
  displayName: "Snow Fall",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float snowLayer(vec2 uv, float cellSize, float speed, float sizeScale, float stretch) {
      vec2 grid = uv;
      grid.y += uTime * speed;
      vec2 cell = floor(grid / cellSize);
      vec2 local = fract(grid / cellSize) - 0.5;
      float h1 = hash(cell);
      float h2 = hash(cell + vec2(17.0, 31.0));
      float h3 = hash(cell + vec2(53.0, 71.0));
      vec2 flakeCenter = vec2(h1, h2) - 0.5;
      flakeCenter.x += 0.12 * sin(uTime * 0.8 + h1 * 20.0);
      vec2 delta = local - flakeCenter;
      delta.y /= stretch;
      float d = length(delta);
      float flakeSize = (0.06 + h2 * 0.06) * sizeScale;
      float glow = smoothstep(flakeSize * 1.8, 0.0, d);
      float opacity = 0.55 + h3 * 0.45;
      return glow * opacity;
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float snow = 0.0;
      snow += snowLayer(vTexCoord, 0.09, 0.07, 1.1, 1.6) * 0.85;
      snow += snowLayer(vTexCoord, 0.055, 0.035, 0.65, 1.25) * 0.55;
      snow += snowLayer(vTexCoord, 0.03, 0.015, 0.35, 1.0) * 0.3;
      snow = clamp(snow, 0.0, 1.0);
      gl_FragColor = vec4(base.rgb + vec3(1.0) * snow, base.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
