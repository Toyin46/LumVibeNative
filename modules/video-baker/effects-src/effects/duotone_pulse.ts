import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "duotone_pulse",
  displayName: "Duotone Pulse",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform float uTime;
    uniform float uPulseSpeed;
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float l = luma(src.rgb);
      float phase = 0.5 + 0.5 * sin(uTime * uPulseSpeed * 6.28318);
      vec3 low = mix(uColorA, uColorB, step(0.5, phase));
      vec3 high = mix(uColorB, uColorA, step(0.5, phase));
      vec3 duotone = mix(low, high, l);
      gl_FragColor = vec4(duotone, src.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
  constants: {
    uColorA: [0.05, 0.05, 0.20],
    uColorB: [1.00, 0.35, 0.15],
    uPulseSpeed: 0.35,
  },
});
