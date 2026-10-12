import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "double_take",
  displayName: "Double Take",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // turn-speed magnitude 0..1
    void main() {
      vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
      vec2 toPixel = vTexCoord - center;
      vec4 color = vec4(0.0);
      float totalWeight = 0.0;
      const int SAMPLES = 8;
      for (int i = 0; i < SAMPLES; i++) {
        float scale = 1.0 - uIntensity * 0.05 * float(i);
        vec2 sampleUv = center + toPixel * scale;
        float weight = 1.0 - float(i) / float(SAMPLES);
        color += texture2D(uTexture, sampleUv) * weight;
        totalWeight += weight;
      }
      gl_FragColor = vec4(color.rgb / totalWeight, 1.0);
    }
  `,
  bindings: { uFaceBox: "face.boundingBox", uIntensity: "face.yawDelta" },
  staticFallback: { uIntensity: 0 },
});
