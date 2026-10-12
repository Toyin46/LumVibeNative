import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Distinct from clap_burst/tap_shockwave: this one has its OWN vertex
// shader for a real screen-shake (a fragment-only shake would just look
// like blur), plus jagged lightning tendrils instead of a clean ring.
export default defineEffect({
  id: "fist_bump_boom",
  displayName: "Fist Bump Boom",
  category: "gesture",
  requires: ["hand"],
  vertexShader: `
    uniform mat4 uTexMatrix;
    uniform float uBoomEnergy;
    uniform float uTime;
    attribute vec4 aPosition;
    attribute vec4 aTexCoord;
    varying mediump vec2 vTexCoord;
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      float shakeX = (hash(uTime * 97.0) - 0.5) * 0.04 * uBoomEnergy;
      float shakeY = (hash(uTime * 61.0 + 3.7) - 0.5) * 0.04 * uBoomEnergy;
      gl_Position = vec4(aPosition.xy + vec2(shakeX, shakeY), aPosition.z, aPosition.w);
      vTexCoord = (uTexMatrix * aTexCoord).xy;
    }
  `,
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uBoomCenter;
    uniform float uBoomEnergy;
    float hash1(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 rel = vTexCoord - uBoomCenter;
      float d = length(rel);
      float angle = atan(rel.y, rel.x);
      float burst = smoothstep(0.5, 0.0, d) * uBoomEnergy;
      const float RAYS = 18.0;
      float rayIndex = floor((angle / 6.28318 + 0.5) * RAYS);
      float rayPhase = hash1(rayIndex * 17.31);
      float rayAngleJitter = (rayPhase - 0.5) * 0.15;
      float raySeg = 6.28318 / RAYS;
      float angleInSeg = mod(angle + 3.14159, raySeg) - raySeg * 0.5 - rayAngleJitter;
      float distFrac = clamp(d / 0.5, 0.0, 1.0);
      float rayWidth = mix(0.012, 0.003, distFrac);
      float onRay = smoothstep(rayWidth, 0.0, abs(angleInSeg) * d);
      float rayReach = (0.25 + rayPhase * 0.35) * uBoomEnergy;
      float withinReach = smoothstep(rayReach, rayReach * 0.7, d);
      float tendrils = onRay * withinReach * uBoomEnergy;
      vec3 boomColor = vec3(1.0, 0.5, 0.1);
      vec3 tendrilColor = vec3(1.0, 0.85, 0.5);
      vec3 addColor = boomColor * burst * 1.5 + tendrilColor * tendrils * 1.3;
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uBoomCenter: "engine.boomCenter" as any,
    uBoomEnergy: "engine.boomEnergy" as any,
    uTime: "time.elapsed",
  },
  triggers: [
    { on: "hand.0.gesture == 'fist' && edge(true)", action: "engine.triggerBoom(center=hand.0.palmCenter, decaySeconds=0.4)" },
  ],
});
