import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "clap_burst",
  displayName: "Clap Burst",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uBoomCenter;
    uniform float uBoomEnergy;
    uniform vec2 uParticlePos[24];
    uniform float uParticleRot[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;
    vec3 paletteColor(float idx) {
      if (idx < 0.5) return vec3(1.0, 0.9, 0.5);
      if (idx < 1.5) return vec3(1.0, 0.6, 0.3);
      return vec3(1.0, 0.95, 0.8);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float d = distance(vTexCoord, uBoomCenter);
      float flash = exp(-d * d * 60.0) * uBoomEnergy;
      float maxRadius = 0.22;
      float ring = 0.0;
      for (int i = 0; i < 2; i++) {
        float echoEnergy = clamp(uBoomEnergy - float(i) * 0.25, 0.0, 1.0);
        float radius = (1.0 - echoEnergy) * maxRadius;
        float ringWidth = 0.012 + (1.0 - echoEnergy) * 0.008;
        ring += smoothstep(ringWidth, 0.0, abs(d - radius)) * echoEnergy * (1.0 - float(i) * 0.35);
      }
      vec3 addColor = vec3(1.0, 0.95, 0.8) * flash + vec3(1.0, 0.85, 0.5) * ring;
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        vec2 toP = vTexCoord - uParticlePos[i];
        float rad = radians(uParticleRot[i]);
        vec2 local = vec2(toP.x * cos(rad) + toP.y * sin(rad), -toP.x * sin(rad) + toP.y * cos(rad));
        float inShape = smoothstep(0.010, 0.006, abs(local.x)) * smoothstep(0.010, 0.006, abs(local.y));
        addColor += paletteColor(uParticleColorIdx[i]) * inShape * uParticleLife[i];
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uBoomCenter: "engine.boomCenter" as any,
    uBoomEnergy: "engine.boomEnergy" as any,
    uParticlePos: "particles.debris.positions",
    uParticleRot: "particles.debris.rotations",
    uParticleLife: "particles.debris.life",
    uParticleColorIdx: "particles.debris.colorIndex",
    uParticleCount: "particles.debris.count",
  },
  particleSystems: [{ id: "debris", gravity: 1.0, maxParticles: 24 }],
  triggers: [
    { on: "hand.count == 2 && edge(true)", action: "engine.triggerBoom(center=midpoint(hand.0.palmCenter, hand.1.palmCenter), decaySeconds=0.5)" },
    { on: "hand.count == 2 && edge(true)", action: "particles.debris.spawnBurst(origin=midpoint(hand.0.palmCenter, hand.1.palmCenter), count=16, speed=1.0, lifetime=0.8)" },
  ],
});
