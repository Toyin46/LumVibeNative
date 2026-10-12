import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Needs its own vertex shader: zoom/pan happens by scaling+offsetting the
// vertex position itself, not by resampling UVs in the fragment stage —
// cheaper and avoids edge-clamping artifacts.
export default defineEffect({
  id: "head_tilt_zoom",
  displayName: "Head Tilt Zoom",
  category: "face",
  requires: ["face"],
  vertexShader: `
    uniform mat4 uTexMatrix;
    uniform float uZoom;
    uniform vec2 uPan;
    attribute vec4 aPosition;
    attribute vec4 aTexCoord;
    varying mediump vec2 vTexCoord;
    void main() {
      gl_Position = vec4(aPosition.xy / uZoom + uPan, aPosition.z, aPosition.w);
      vTexCoord = (uTexMatrix * aTexCoord).xy;
    }
  `,
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() { gl_FragColor = texture2D(uTexture, vTexCoord); }
  `,
  bindings: {
    uZoom: "engine.headTiltZoom" as any, // native computes zoom 1..N from head yaw magnitude
    uPan: "engine.headTiltPan" as any,   // native computes NDC pan from head yaw direction
  },
});
