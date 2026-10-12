import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Tiny Body v2 - normal-size head, everything below the chin shrinks (uScale)
// toward the chin. Needs ONLY the face box (no pose tracker), so it works
// wherever the face tracker works. Outside the shrunken body a soft blurred
// fill is shown. Stand back so your body and background are in frame.
// TUNING (manifest constant): uScale 0.45 = body size (0.3 tinier, 0.7 bigger).
export default defineEffect({
  id: "tiny_body",
  displayName: "Tiny Body",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #endif
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uScale;

    void main() {
      float cx = (uFaceBox.x + uFaceBox.z) * 0.5;
      float chin = uFaceBox.w;
      float t = smoothstep(chin - 0.015, chin + 0.04, vTexCoord.y);
      float s = mix(1.0, uScale, t);
      vec2 anchor = vec2(cx, chin - 0.012);
      vec2 src = anchor + (vTexCoord - anchor) / s;

      float inX = smoothstep(0.0, 0.02, src.x) * (1.0 - smoothstep(0.98, 1.0, src.x));
      float inY = smoothstep(0.0, 0.02, src.y) * (1.0 - smoothstep(0.98, 1.0, src.y));
      float m = inX * inY;
      vec3 body = texture2D(uTexture, clamp(src, 0.0, 1.0)).rgb;

      vec3 blur = texture2D(uTexture, vTexCoord).rgb
                + texture2D(uTexture, vTexCoord + vec2(0.05, 0.0)).rgb
                + texture2D(uTexture, vTexCoord - vec2(0.05, 0.0)).rgb
                + texture2D(uTexture, vTexCoord + vec2(0.0, 0.05)).rgb
                + texture2D(uTexture, vTexCoord - vec2(0.0, 0.05)).rgb
                + texture2D(uTexture, vTexCoord + vec2(0.035, 0.035)).rgb
                + texture2D(uTexture, vTexCoord - vec2(0.035, 0.035)).rgb
                + texture2D(uTexture, vTexCoord + vec2(0.035, -0.035)).rgb
                + texture2D(uTexture, vTexCoord - vec2(0.035, -0.035)).rgb;
      vec3 fill = blur / 9.0 * 0.8;
      gl_FragColor = vec4(mix(fill, body, m), 1.0);
    }
  `,
  bindings: { uFaceBox: "face.boundingBox" },
  constants: { uScale: 0.45 },
});
