import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "bokeh_lights",
  displayName: "Bokeh Lights",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    float hash1(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec3 glow = vec3(0.0);
      for (int i = 0; i < 10; i++) {
        float fi = float(i);
        vec2 seed = vec2(hash1(fi * 12.9898), hash1(fi * 78.233 + 4.0));
        float speed = 0.02 + hash1(fi * 3.7) * 0.03;
        vec2 pos = fract(seed + vec2(hash1(fi * 5.3) - 0.5, -uTime * speed));
        float size = 0.05 + hash1(fi * 9.1) * 0.09;
        float d = distance(vTexCoord, pos);
        float orb = smoothstep(size, 0.0, d) * 0.5;
        vec3 hue = hash1(fi * 2.1) > 0.5 ? vec3(1.0, 0.75, 0.4) : vec3(0.5, 0.7, 1.0);
        glow += hue * orb;
      }
      gl_FragColor = vec4(base.rgb + glow, base.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
