import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "thermal_pulse",
  displayName: "Thermal Pulse",
  category: "environment",
  requires: ["segmentation", "audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform float uIntensity; // normalized audio amplitude 0..1
    vec3 heatColor(float t) {
      vec3 cold = vec3(0.0, 0.0, 0.6);
      vec3 mid = vec3(1.0, 0.6, 0.0);
      vec3 hot = vec3(1.0, 1.0, 0.4);
      return t < 0.5 ? mix(cold, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
    }
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float mask = texture2D(uMaskTexture, vTexCoord).a;
      float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
      float heat = clamp(luma * (0.6 + 0.6 * uIntensity), 0.0, 1.0);
      vec3 outColor = mix(src.rgb, heatColor(heat), mask);
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uIntensity: "audio.amplitude" },
});
