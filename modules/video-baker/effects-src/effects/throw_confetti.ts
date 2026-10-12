import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// CORRECTED: real confetti pieces are rotated rectangles from a 6-color
// festive palette, not circular dots as my first pass sketched.
export default defineEffect({
  id: "throw_confetti",
  displayName: "Throw Confetti",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uParticlePos[24];
    uniform float uParticleRot[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;

    vec3 paletteColor(float idx) {
      if (idx < 0.5) return vec3(1.0, 0.25, 0.35);
      if (idx < 1.5) return vec3(1.0, 0.85, 0.15);
      if (idx < 2.5) return vec3(0.25, 0.85, 1.0);
      if (idx < 3.5) return vec3(0.55, 1.0, 0.35);
      if (idx < 4.5) return vec3(0.85, 0.35, 1.0);
      return vec3(1.0, 0.55, 0.15);
    }

    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec3 addColor = vec3(0.0);
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        vec2 toParticle = vTexCoord - uParticlePos[i];
        float rad = radians(uParticleRot[i]);
        float c = cos(rad); float s = sin(rad);
        vec2 local = vec2(toParticle.x * c + toParticle.y * s, -toParticle.x * s + toParticle.y * c);
        float inRect = smoothstep(0.014, 0.010, abs(local.x)) * smoothstep(0.008, 0.004, abs(local.y));
        float fade = uParticleLife[i];
        addColor += paletteColor(uParticleColorIdx[i]) * inRect * fade;
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uParticlePos: "particles.confetti.positions",
    uParticleRot: "particles.confetti.rotations",
    uParticleLife: "particles.confetti.life",
    uParticleColorIdx: "particles.confetti.colorIndex",
    uParticleCount: "particles.confetti.count",
  },
  particleSystems: [{ id: "confetti", gravity: 1.4, maxParticles: 24 }],
  triggers: [
    {
      on: "hand.0.gesture == 'openPalm' && edge(true) && hand.0.throwVelocity > 1.2",
      action:
        "particles.confetti.spawnBurst(origin=hand.0.palmCenter, count=24, speed=1.4, lifetime=1.2)",
    },
  ],
});
