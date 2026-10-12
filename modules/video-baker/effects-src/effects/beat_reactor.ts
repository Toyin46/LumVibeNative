import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — pulses a full-screen glow on each detected beat. Needs the new
// AudioBeatDetector (see engine-native — a self-contained addition to the
// existing amplitude reader, not a new subsystem class of its own).
export default defineEffect({
  id: "beat_reactor",
  displayName: "Beat Reactor",
  category: "music",
  requires: ["audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uBeatEnergy; // 0..1, decays each frame, spikes on a beat
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float vig = smoothstep(0.95, 0.2, distance(vTexCoord, vec2(0.5)));
      vec3 pulseColor = vec3(0.9, 0.3, 1.0);
      gl_FragColor = vec4(base.rgb + pulseColor * uBeatEnergy * vig * 0.6, base.a);
    }
  `,
  bindings: { uBeatEnergy: "engine.beatPulse" as any }, // native decays this toward 0 each frame, spikes to 1 on audio.beatDetected
});
