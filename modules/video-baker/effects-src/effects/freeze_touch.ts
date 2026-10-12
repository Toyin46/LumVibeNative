import { defineEffect } from "../types/EffectDefinition";

// NEW — same engine.captureFreezeFrame primitive blink_freeze already
// uses, triggered by a screen tap instead of a blink. Needs one small
// native addition (a touch signal), not a new subsystem.
export default defineEffect({
  id: "freeze_touch",
  displayName: "Freeze Touch",
  category: "gesture",
  requires: [],
  vertexShader: `
    uniform mat4 uTexMatrix;
    attribute vec4 aPosition;
    attribute vec4 aTexCoord;
    varying vec2 vTexCoord;
    uniform float uZoom;
    void main() {
      gl_Position = vec4(aPosition.xy * uZoom, aPosition.zw);
      vTexCoord = (uTexMatrix * aTexCoord).xy;
    }
  `,
  fragmentShader: `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D uFrozenTexture;
    uniform float uCrackAmount; // 0..1, grows while frozen
    void main() {
      vec4 c = texture2D(uFrozenTexture, vTexCoord);
      c.rgb = mix(c.rgb, c.rgb * vec3(0.85, 0.95, 1.1), uCrackAmount * 0.4);
      gl_FragColor = c;
    }
  `,
  bindings: {
    uZoom: "engine.freezeZoom" as any,
    uCrackAmount: "engine.freezeAge" as any, // native writes 0..1 over the hold duration
  },
  triggers: [
    { on: "touch.active && edge(true)", action: "engine.captureFreezeFrame(holdSeconds=1.0, punchZoom=1.08)" },
  ],
});
