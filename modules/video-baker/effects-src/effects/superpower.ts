import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// NEW — an orbiting energy ring around the whole body/face box plus a
// particle sparkle burst, triggered on a fist gesture. Reuses the
// throw_confetti-style particle+trigger pattern with a different palette.
export default defineEffect({
  id: "superpower",
  displayName: "Superpower",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uOrigin;
    uniform float uTime;
    uniform vec2 uParticlePos[24];
    uniform float uParticleLife[24];
    uniform int uParticleCount;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 rel = vTexCoord - uOrigin;
      float d = length(rel);
      float ring = exp(-pow(d - 0.12, 2.0) * 900.0) * (0.6 + 0.4 * sin(uTime * 4.0));
      vec3 addColor = vec3(0.3, 0.8, 1.0) * ring;
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        float pd = distance(vTexCoord, uParticlePos[i]);
        addColor += vec3(1.0, 0.9, 0.4) * exp(-pd * pd * 1200.0) * uParticleLife[i];
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uOrigin: "hand.0.palmCenter",
    uTime: "time.elapsed",
    uParticlePos: "particles.power.positions",
    uParticleLife: "particles.power.life",
    uParticleCount: "particles.power.count",
  },
  particleSystems: [{ id: "power", gravity: 0.0, maxParticles: 24 }],
  triggers: [
    { on: "hand.0.gesture == 'fist' && edge(true)", action: "particles.power.spawnBurst(origin=hand.0.palmCenter, count=20, speed=1.0, lifetime=1.0)" },
  ],
});
