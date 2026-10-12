import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Same passthrough reasoning as mouth_words — the gesture label is a
// positioned text overlay, not a shader effect.
export default defineEffect({
  id: "rock_paper_scissors",
  displayName: "Rock Paper Scissors",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    void main() { gl_FragColor = texture2D(uTexture, vTexCoord); }
  `,
  bindings: {},
});
