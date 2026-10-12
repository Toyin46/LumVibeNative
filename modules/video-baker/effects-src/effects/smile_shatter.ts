import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "smile_shatter",
  displayName: "Smile Shatter",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uIntensity; // smile score 0..1
    uniform float uTime;
    float hash1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec2 hash2(vec2 p) {
      vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(q) * 43758.5453);
    }
    void voronoi(vec2 uv, float cellSize, out vec2 cellId, out float d1, out float d2) {
      vec2 g = floor(uv / cellSize);
      d1 = 8.0; d2 = 8.0; cellId = g;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = g + vec2(float(x), float(y));
          vec2 point = (neighbor + hash2(neighbor)) * cellSize;
          float d = distance(uv, point);
          if (d < d1) { d2 = d1; d1 = d; cellId = neighbor; }
          else if (d < d2) { d2 = d; }
        }
      }
    }
    void main() {
      vec2 uv = vTexCoord;
      float response = pow(clamp(uIntensity, 0.0, 1.0), 1.4);
      vec2 cid; float d1; float d2;
      voronoi(uv, 0.055, cid, d1, d2);
      vec2 cellCenter = (cid + hash2(cid)) * 0.055;
      vec2 fromCenter = cellCenter - vec2(0.5, 0.5);
      float distFromCenter = length(fromCenter) + 0.001;
      vec2 outward = fromCenter / distFromCenter;
      float shardSeed = hash1(cid);
      float shardSpeed = 0.6 + shardSeed * 0.8;
      float displaceAmount = response * distFromCenter * shardSpeed * 0.35;
      vec2 tangent = vec2(-outward.y, outward.x);
      float spin = (hash1(cid + 17.3) - 0.5) * 2.0;
      vec2 displacement = outward * displaceAmount + tangent * displaceAmount * spin * 0.4;
      vec2 sampleUv = uv - displacement;
      vec4 src = (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0)
          ? vec4(0.03, 0.03, 0.05, 1.0)
          : texture2D(uTexture, sampleUv);
      float edge = smoothstep(0.01, 0.0, d2 - d1);
      float edgeBrightness = 0.4 + 0.6 * clamp(displaceAmount * 4.0, 0.0, 1.0);
      vec3 edgeGlint = vec3(0.9, 0.96, 1.0) * edge * edgeBrightness * response;
      float fade = 1.0 - smoothstep(0.15, 0.4, displaceAmount);
      vec3 outColor = mix(vec3(0.02, 0.02, 0.03), src.rgb, fade) + edgeGlint;
      gl_FragColor = vec4(outColor, 1.0);
    }
  `,
  bindings: { uIntensity: "face.smileScore", uTime: "time.elapsed" },
  staticFallback: { uIntensity: 0 },
});
