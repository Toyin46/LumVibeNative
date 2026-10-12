import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "paint_splash",
  displayName: "Paint Splash",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uIntensity; // motion magnitude 0..1
    uniform float uTime;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 hash2v(vec2 p) {
      vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(q) * 43758.5453);
    }
    float dripDist(vec2 p, vec2 top, float len) {
      float t = clamp((p.y - top.y) / -len, 0.0, 1.0);
      vec2 closest = top + vec2(0.0, -len * t);
      return distance(p, closest);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec3 splashColor = vec3(0.0);
      float coverage = 0.0;
      const int CELLS = 10;
      float cellSize = 1.0 / float(CELLS);
      vec2 grid = floor(vTexCoord / cellSize);
      for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
          vec2 cell = grid + vec2(float(dx), float(dy));
          vec2 jitter = hash2v(cell);
          vec2 center = (cell + jitter) * cellSize;
          float threshold = hash2(cell + 9.3) * 0.7;
          if (uIntensity < threshold) continue;
          vec3 hue = fract(hash2(cell + 5.5) + uTime * 0.02) < 0.33 ? vec3(1.0, 0.2, 0.35)
              : fract(hash2(cell + 5.5) + uTime * 0.02) < 0.66 ? vec3(0.2, 0.6, 1.0)
              : vec3(1.0, 0.85, 0.15);
          float baseSize = 0.05 + hash2(cell + 1.7) * 0.09;
          float blob = 0.0;
          for (int k = 0; k < 3; k++) {
            vec2 sub = hash2v(cell + float(k) * 3.1) - 0.5;
            vec2 subCenter = center + sub * baseSize * 0.7;
            float subSize = baseSize * (0.55 + 0.45 * hash2(cell + float(k) * 7.7));
            float d = distance(vTexCoord, subCenter);
            blob = max(blob, smoothstep(subSize, subSize * 0.25, d));
          }
          float dripLen = baseSize * (1.8 + 2.0 * hash2(cell + 4.2));
          float dd = dripDist(vTexCoord, center, dripLen);
          float dripWidth = baseSize * 0.18;
          float drip = smoothstep(dripWidth, dripWidth * 0.2, dd);
          drip *= 1.0 - clamp((center.y - vTexCoord.y) / dripLen, 0.0, 1.0) * 0.7;
          blob = max(blob, drip);
          splashColor += hue * blob;
          coverage = max(coverage, blob);
        }
      }
      vec3 outColor = mix(base.rgb, splashColor, coverage * 0.9);
      gl_FragColor = vec4(outColor, base.a);
    }
  `,
  bindings: { uIntensity: "motion.magnitude", uTime: "time.elapsed" },
  staticFallback: { uIntensity: 0 },
});
