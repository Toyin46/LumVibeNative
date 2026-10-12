import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — CORRECTED classification from the previous pass: this does NOT
// need a "meshWarp" subsystem. Classic bobble-head effects are a
// screen-space UV bulge (lens-distortion math) centered on the face box —
// same category of technique as neon_edge's Sobel filter, just applied as
// a coordinate warp instead of a color filter. No new native primitive.
export default defineEffect({
  id: "big_head",
  displayName: "Big Head",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // 0..1, how strong the bulge is
    void main() {
      vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
      float faceSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
      float influenceRadius = faceSize * 2.2;
      vec2 rel = vTexCoord - center;
      float d = length(rel);
      float t = clamp(d / influenceRadius, 0.0, 1.0);
      // Bulge near the center (magnify), gentle inverse compression at the
      // radius edge so the surrounding body doesn't just look "cut" —
      // conserves roughly the same on-screen area, which is what keeps
      // this readable as "big head" rather than "floating zoomed circle."
      float bulge = mix(1.0 - uIntensity * 0.6, 1.0 + uIntensity * 0.15, smoothstep(0.0, 1.0, t));
      vec2 warped = center + rel * bulge;
      gl_FragColor = texture2D(uTexture, warped);
    }
  `,
  bindings: { uFaceBox: "face.boundingBox" },
  constants: { uIntensity: 0.55 },
});
