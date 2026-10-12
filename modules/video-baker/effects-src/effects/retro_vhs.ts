import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "retro_vhs",
  displayName: "Retro VHS",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      float edgeDist = min(vTexCoord.y, 1.0 - vTexCoord.y);
      float wobbleStrength = smoothstep(0.08, 0.0, edgeDist) * 0.01;
      float wobble = sin(uTime * 3.0 + vTexCoord.y * 8.0) * wobbleStrength;
      vec2 uv = vec2(vTexCoord.x + wobble, vTexCoord.y);
      float split = 0.0025;
      float r = texture2D(uTexture, uv + vec2(split, 0.0)).r;
      float g = texture2D(uTexture, uv).g;
      float b = texture2D(uTexture, uv - vec2(split, 0.0)).b;
      vec3 color = vec3(r, g, b);
      float scanline = 0.92 + 0.08 * sin(vTexCoord.y * 480.0);
      color *= scanline;
      float dropoutRow = floor(vTexCoord.y * 60.0);
      float dropout = step(0.985, hash(dropoutRow + floor(uTime * 2.0))) * 0.25;
      color += dropout;
      float vig = smoothstep(0.9, 0.3, distance(vTexCoord, vec2(0.5)));
      color *= mix(0.7, 1.0, vig);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
