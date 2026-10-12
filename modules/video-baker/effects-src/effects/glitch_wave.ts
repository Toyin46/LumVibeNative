import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "glitch_wave",
  displayName: "Glitch Wave",
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
      float burstPhase = fract(uTime * 0.8);
      float burstActive = step(0.4, hash(floor(uTime * 0.8)));
      float burstStrength = burstActive * smoothstep(0.0, 0.15, burstPhase) * smoothstep(1.0, 0.85, burstPhase);
      float rowId = floor(vTexCoord.y * 40.0);
      float rowGlitch = (hash(rowId + floor(uTime * 12.0)) - 0.5) * 0.06 * burstStrength;
      vec2 uv = vec2(vTexCoord.x + rowGlitch, vTexCoord.y);
      float split = 0.008 * burstStrength;
      float r = texture2D(uTexture, uv + vec2(split, 0.0)).r;
      float g = texture2D(uTexture, uv).g;
      float b = texture2D(uTexture, uv - vec2(split, 0.0)).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
