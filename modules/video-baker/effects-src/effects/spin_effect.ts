import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "spin_effect",
  displayName: "Spin Effect",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // normalized |yaw| 0..1
    uniform float uTime;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
      float faceSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
      float radius = faceSize * 0.85;
      vec2 toPoint = vTexCoord - center;
      float d = length(toPoint);
      float angle = atan(toPoint.y, toPoint.x);
      float spinSpeed = 1.2 + uIntensity * 2.5;
      float rotatedAngle = angle + uTime * spinSpeed;
      float points = 6.0;
      float pointPattern = 0.5 + 0.5 * cos(rotatedAngle * points);
      float ringMask = smoothstep(0.04, 0.0, abs(d - radius));
      float glow = ringMask * pow(pointPattern, 4.0);
      vec3 ringColor = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.4, 0.8), 0.5 + 0.5 * sin(uTime * 0.7));
      gl_FragColor = vec4(base.rgb + ringColor * glow, base.a);
    }
  `,
  bindings: {
    uFaceBox: "face.boundingBox",
    uIntensity: "face.headPose.yaw", // native normalizes |yaw| to 0..1 before writing this signal
    uTime: "time.elapsed",
  },
});
