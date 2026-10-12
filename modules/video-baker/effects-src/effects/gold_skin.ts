import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "gold_skin",
  displayName: "Gold Skin",
  category: "beauty",
  requires: ["segmentation"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform float uTime;
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float mask = texture2D(uMaskTexture, vTexCoord).a;
      float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
      vec3 shadowGold = vec3(0.25, 0.14, 0.02);
      vec3 midGold    = vec3(0.85, 0.55, 0.12);
      vec3 hiGold     = vec3(1.0, 0.92, 0.65);
      vec3 gold = luma < 0.5
          ? mix(shadowGold, midGold, luma * 2.0)
          : mix(midGold, hiGold, (luma - 0.5) * 2.0);
      float sheenPos = fract((vTexCoord.x + vTexCoord.y) * 1.5 - uTime * 0.15);
      float sheen = smoothstep(0.42, 0.5, sheenPos) * smoothstep(0.58, 0.5, sheenPos);
      gold += sheen * 0.25;
      vec3 outColor = mix(src.rgb, gold, mask);
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uTime: "time.elapsed" },
});
