import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — procedural jagged bolt between the two palms when both hands are
// detected. Same "procedural, no particles needed" category as glitch_wave.
export default defineEffect({
  id: "lightning_hands",
  displayName: "Lightning Hands",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uHandA;
    uniform vec2 uHandB;
    uniform float uTime;
    uniform float uActive; // 1 when both hands present, 0 otherwise
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      if (uActive < 0.5) { gl_FragColor = base; return; }
      vec2 dir = uHandB - uHandA;
      float len = length(dir);
      vec2 dirN = dir / max(len, 0.0001);
      vec2 normal = vec2(-dirN.y, dirN.x);
      vec2 toP = vTexCoord - uHandA;
      float along = clamp(dot(toP, dirN), 0.0, len);
      float seg = floor(along / (len / 8.0));
      float jitter = (hash(seg + floor(uTime * 20.0)) - 0.5) * 0.04;
      vec2 boltPoint = uHandA + dirN * along + normal * jitter;
      float d = distance(vTexCoord, boltPoint);
      float glow = exp(-d * d * 3000.0) * uActive;
      vec3 boltColor = vec3(0.6, 0.8, 1.0);
      gl_FragColor = vec4(base.rgb + boltColor * glow * 1.5, base.a);
    }
  `,
  bindings: {
    uHandA: "hand.0.palmCenter",
    uHandB: "hand.1.palmCenter",
    uTime: "time.elapsed",
    uActive: "hand.1.detected", // native writes 1.0 if hands.size() > 1, else 0.0
  },
});
