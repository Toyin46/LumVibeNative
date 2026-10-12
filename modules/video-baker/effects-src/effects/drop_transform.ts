import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — a big one-shot flash + radial zoom-blur on a detected "drop"
// (sustained large energy jump). Reuses the boom-decay pattern
// clap_burst/tap_shockwave already established, driven by
// audio.dropDetected's trigger instead of a gesture.
export default defineEffect({
  id: "drop_transform",
  displayName: "Drop Transform",
  category: "music",
  requires: ["audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uDropEnergy; // 1 at the moment of a drop, decays over ~0.8s
    void main() {
      vec2 center = vec2(0.5);
      vec2 dir = vTexCoord - center;
      vec3 sum = vec3(0.0);
      const int SAMPLES = 6;
      for (int i = 0; i < SAMPLES; i++) {
        float t = float(i) / float(SAMPLES - 1);
        vec2 uv = center + dir * (1.0 - uDropEnergy * 0.25 * t);
        sum += texture2D(uTexture, uv).rgb;
      }
      vec3 blurred = sum / float(SAMPLES);
      vec3 flashed = blurred + vec3(1.0) * uDropEnergy * 0.4;
      gl_FragColor = vec4(flashed, 1.0);
    }
  `,
  bindings: { uDropEnergy: "engine.dropEnergy" as any }, // native decays this toward 0 over ~0.8s after audio.dropDetected fires
  triggers: [{ on: "audio.dropDetected == 'true' && edge(true)", action: "engine.triggerDrop(decaySeconds=0.8)" }],
});
