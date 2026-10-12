import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "light_leak",
  displayName: "Light Leak",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float diag = (vTexCoord.x + vTexCoord.y) * 0.7 - uTime * 0.08;
      float sweepPhase = fract(diag);
      float band = smoothstep(0.0, 0.4, sweepPhase) * smoothstep(0.85, 0.4, sweepPhase);
      vec3 leakColor = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.25, 0.35), sweepPhase);
      float diag2 = (vTexCoord.x - vTexCoord.y) * 0.5 + uTime * 0.04;
      float band2 = smoothstep(0.0, 0.3, fract(diag2)) * smoothstep(0.7, 0.3, fract(diag2)) * 0.4;
      vec3 outColor = base.rgb + leakColor * band * 0.5 + vec3(1.0, 0.7, 0.4) * band2;
      gl_FragColor = vec4(outColor, base.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
