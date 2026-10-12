import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// The shader side is trivial (alpha-blend uTexture with uMaskTexture); the
// real work is CPU-side: drawing a wireframe mesh from REAL landmark
// positions (not hardcoded topology) onto a half-transparent bitmap, same
// mechanism DEPTH_BLOOM/GOLD_SKIN already use for uMaskTexture — except
// that mesh-drawing step (a Canvas-equivalent on each platform) is new
// work, not a signal binding. Declared as its own signal path
// (face.meshOverlayTexture) rather than reusing "segmentation.mask" since
// it's conceptually different content from the segmentation tracker.
export default defineEffect({
  id: "face_morph",
  displayName: "Face Morph",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec4 mesh = texture2D(uMaskTexture, vTexCoord);
      vec3 outColor = mix(base.rgb, mesh.rgb, mesh.a);
      gl_FragColor = vec4(outColor, base.a);
    }
  `,
  // NOTE: texture-valued signals (this one, and segmentation.mask for every
  // segmentation effect) aren't resolved through the generic float/vec2/
  // vec4 path resolveSignal() returns today — they need a small, explicit
  // native special case per texture source, the same category of
  // exception blink_freeze's captureFreezeFrame already is. Listed here so
  // the binding is documented and discoverable, not because the current
  // EffectEngine.cpp wires it automatically yet.
  bindings: { uMaskTexture: "face.meshOverlayTexture" as any },
});
