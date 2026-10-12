import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "silence_ripple",
  displayName: "Silence Ripple",
  category: "music",
  requires: ["audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    uniform float uIntensity; // silence factor 0..1 (1 = quiet)
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 center = vec2(0.5);
      float d = distance(vTexCoord, center);
      float ring = 0.0;
      for (int i = 0; i < 3; i++) {
        float phase = fract(uTime * 0.35 - float(i) * 0.33);
        float radius = phase * 0.75;
        ring += smoothstep(0.02, 0.0, abs(d - radius)) * (1.0 - phase);
      }
      ring *= uIntensity;
      vec3 rippleColor = vec3(0.3, 0.75, 1.0);
      gl_FragColor = vec4(base.rgb + rippleColor * ring, base.a);
    }
  `,
  bindings: { uTime: "time.elapsed", uIntensity: "audio.silenceScore" },
  staticFallback: { uIntensity: 1 },
});
