import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "raise_eyebrow",
  displayName: "Raise Eyebrow",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // max(browInnerUp, browOuterUp) 0..1
    uniform float uTime;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float response = clamp(uIntensity, 0.0, 1.0);
      float browY = uFaceBox.y + (uFaceBox.w - uFaceBox.y) * 0.28;
      float lift = response * 0.05;
      vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, browY - lift);
      float width = (uFaceBox.z - uFaceBox.x) * 0.55;
      float dx = (vTexCoord.x - center.x) / width;
      float dy = (vTexCoord.y - center.y) * 6.0;
      float shape = exp(-(dx * dx * 3.0 + dy * dy));
      float shimmer = 0.5 + 0.5 * sin(uTime * 5.0 + vTexCoord.x * 25.0);
      vec3 glowColor = mix(vec3(0.4, 0.85, 1.0), vec3(1.0, 0.95, 0.6), shimmer * response);
      gl_FragColor = vec4(base.rgb + glowColor * shape * response * 0.8, base.a);
    }
  `,
  bindings: { uFaceBox: "face.boundingBox", uIntensity: "face.browRaiseScore", uTime: "time.elapsed" },
  staticFallback: { uIntensity: 0 },
});
