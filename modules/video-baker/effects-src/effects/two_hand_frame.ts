import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "two_hand_frame",
  displayName: "Two-Hand Frame",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFrameRect; // left, top, right, bottom (normalized)
    uniform float uIntensity;
    float arm(float acrossDist, float alongDist, float armLen, float lineWidth) {
      float line = smoothstep(lineWidth, lineWidth * 0.3, abs(acrossDist));
      float extent = (1.0 - smoothstep(armLen * 0.85, armLen, alongDist)) * step(0.0, alongDist);
      return line * extent;
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float w = uFrameRect.z - uFrameRect.x;
      float h = uFrameRect.w - uFrameRect.y;
      float armLen = min(w, h) * 0.2;
      float lineWidth = 0.006;
      float distLeft = vTexCoord.x - uFrameRect.x;
      float distRight = uFrameRect.z - vTexCoord.x;
      float distTop = vTexCoord.y - uFrameRect.y;
      float distBottom = uFrameRect.w - vTexCoord.y;
      float bracket = 0.0;
      bracket = max(bracket, arm(distTop, distLeft, armLen, lineWidth));
      bracket = max(bracket, arm(distLeft, distTop, armLen, lineWidth));
      bracket = max(bracket, arm(distTop, distRight, armLen, lineWidth));
      bracket = max(bracket, arm(distRight, distTop, armLen, lineWidth));
      bracket = max(bracket, arm(distBottom, distLeft, armLen, lineWidth));
      bracket = max(bracket, arm(distLeft, distBottom, armLen, lineWidth));
      bracket = max(bracket, arm(distBottom, distRight, armLen, lineWidth));
      bracket = max(bracket, arm(distRight, distBottom, armLen, lineWidth));
      bracket *= uIntensity;
      vec3 frameColor = vec3(1.0, 0.85, 0.3);
      gl_FragColor = vec4(base.rgb + frameColor * bracket * 1.8, base.a);
    }
  `,
  bindings: {
    uFrameRect: "engine.twoHandFrameRect" as any, // native computes the rect spanning both palms
    uIntensity: "hand.1.detected", // both hands present = full strength
  },
});
