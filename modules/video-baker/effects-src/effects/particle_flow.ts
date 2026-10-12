import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "particle_flow",
  displayName: "Particle Flow",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 center = vec2(0.5, 0.5);
      vec2 rel = vTexCoord - center;
      float radius = length(rel);
      float angle = atan(rel.y, rel.x);
      float glow = 0.0;
      for (int layer = 0; layer < 2; layer++) {
        float scale = layer == 0 ? 9.0 : 14.0;
        float layerSpeed = layer == 0 ? 0.35 : -0.5;
        float spinAngle = angle + uTime * layerSpeed * 0.3;
        float radiusDrift = radius + sin(uTime * 0.15 + angle * 3.0) * 0.03;
        vec2 swirlUv = vec2(spinAngle * scale * 0.5, radiusDrift * scale);
        vec2 cell = floor(swirlUv);
        vec2 local = fract(swirlUv) - 0.5;
        vec2 jitter = vec2(hash2(cell), hash2(cell + 3.7)) - 0.5;
        float d = length(local - jitter * 0.6);
        float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + hash2(cell) * 20.0);
        glow += smoothstep(0.06, 0.0, d) * twinkle * 0.5;
      }
      vec3 particleColor = vec3(0.8, 0.9, 1.0);
      gl_FragColor = vec4(base.rgb + particleColor * glow, base.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
