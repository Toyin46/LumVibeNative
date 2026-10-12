import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "depth_bloom",
  displayName: "Depth Bloom",
  category: "environment",
  requires: ["segmentation", "audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uMaskTexture;
    uniform vec2 uTexelSize;
    uniform float uIntensity; // normalized audio amplitude 0..1
    void main() {
      vec4 src = texture2D(uTexture, vTexCoord);
      float mask = texture2D(uMaskTexture, vTexCoord).a;
      vec3 bloom = vec3(0.0);
      float total = 0.0;
      for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
          vec2 offset = vec2(float(x), float(y)) * uTexelSize * 3.0;
          float w = 1.0 / (1.0 + float(x * x + y * y));
          bloom += texture2D(uTexture, vTexCoord + offset).rgb * w;
          total += w;
        }
      }
      bloom /= total;
      bloom.r = mix(bloom.r, texture2D(uTexture, vTexCoord + uTexelSize * 2.0).r, 0.3);
      bloom.b = mix(bloom.b, texture2D(uTexture, vTexCoord - uTexelSize * 2.0).b, 0.3);
      float bloomAmount = (0.5 + 0.7 * uIntensity) * (1.0 - mask);
      vec3 outColor = mix(src.rgb, bloom, bloomAmount);
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uIntensity: "audio.amplitude" },
});
