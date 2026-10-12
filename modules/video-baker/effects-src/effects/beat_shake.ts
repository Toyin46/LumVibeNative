import { defineEffect } from "../types/EffectDefinition";

// NEW — the vertex position itself jitters on each beat (screen shake),
// same "own vertex shader" pattern head_tilt_zoom already established.
export default defineEffect({
  id: "beat_shake",
  displayName: "Beat Shake",
  category: "music",
  requires: ["audio"],
  vertexShader: `
    uniform mat4 uTexMatrix;
    uniform vec2 uShakeOffset;
    attribute vec4 aPosition;
    attribute vec4 aTexCoord;
    varying mediump vec2 vTexCoord;
    void main() {
      gl_Position = vec4(aPosition.xy + uShakeOffset, aPosition.z, aPosition.w);
      vTexCoord = (uTexMatrix * aTexCoord).xy;
    }
  `,
  fragmentShader: `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() { gl_FragColor = texture2D(uTexture, vTexCoord); }
  `,
  bindings: { uShakeOffset: "engine.beatShakeOffset" as any }, // native: random small offset scaled by beatEnergy, decaying each frame
});
