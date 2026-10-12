import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "split_prism",
  displayName: "Split Prism",
  category: "environment",
  requires: ["segmentation"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform vec2 uTexelSize;
    uniform float uIntensity; // motion magnitude 0..1
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float mask = texture2D(uMaskTexture, vTexCoord).a;
      float spread = uIntensity * 12.0;
      float r = texture2D(uTexture, vTexCoord + uTexelSize * vec2(spread, 0.0)).r;
      float g = texture2D(uTexture, vTexCoord).g;
      float b = texture2D(uTexture, vTexCoord - uTexelSize * vec2(spread, 0.0)).b;
      vec3 split = vec3(r, g, b);
      vec2 ghostOffset = uTexelSize * vec2(-spread * 1.6, spread * 0.9);
      vec2 ghostUv = vTexCoord + ghostOffset;
      float ghostMask = texture2D(uMaskTexture, ghostUv).a;
      vec3 ghostColor = texture2D(uTexture, ghostUv).rgb;
      ghostColor.r = texture2D(uTexture, ghostUv + uTexelSize * 1.5).r;
      ghostColor.b = texture2D(uTexture, ghostUv - uTexelSize * 1.5).b;
      float ghostAmount = ghostMask * clamp(uIntensity * 1.4, 0.0, 0.55);
      vec3 withGhost = mix(split, ghostColor, ghostAmount * (1.0 - mask));
      vec3 outColor = mix(withGhost, src.rgb, mask);
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uIntensity: "motion.magnitude" },
  staticFallback: { uIntensity: 0 },
});
