import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Deliberately a plain passthrough — the reactive text is a POSITIONED text
// overlay drawn by a separate compositing step (OverlayBuilder-equivalent
// on the native side), not a per-pixel shader effect. Exists so the
// generic pipeline has a valid program to bind, same as the original.
export default defineEffect({
  id: "mouth_words",
  displayName: "Mouth Words",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() { gl_FragColor = texture2D(uTexture, vTexCoord); }
  `,
  bindings: {},
});
