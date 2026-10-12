import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — background replacement using the segmentation mask (person stays,
// background swaps for a bundled starfield texture). Same difficulty class
// as hand_portal: signal binding + one asset texture, no new subsystem.
export default defineEffect({
  id: "space_background",
  displayName: "Space",
  category: "world",
  requires: ["segmentation"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform sampler2D uSpaceTexture;
    uniform float uTime;
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float mask = texture2D(uMaskTexture, vTexCoord).a;
      vec2 parallax = vTexCoord + vec2(sin(uTime * 0.02), cos(uTime * 0.015)) * 0.01;
      vec3 space = texture2D(uSpaceTexture, parallax).rgb;
      vec3 outColor = mix(space, src.rgb, mask);
      gl_FragColor = vec4(outColor, 1.0);
    }
  `,
  bindings: { uTime: "time.elapsed" },
  assets: { uSpaceTexture: "assets/space_background.jpg" },
});
