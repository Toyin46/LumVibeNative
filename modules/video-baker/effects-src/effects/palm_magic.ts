import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "palm_magic",
  displayName: "Palm Magic",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uPalmCenter;
    uniform vec2 uParticlePos[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;
    uniform float uTime;
    vec3 sparkleColor(float idx) {
      if (idx < 2.0) return vec3(0.55, 0.85, 1.0);
      if (idx < 4.0) return vec3(0.85, 0.55, 1.0);
      return vec3(1.0, 0.9, 0.6);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 rel = vTexCoord - uPalmCenter;
      float d = length(rel);
      float angle = atan(rel.y, rel.x);
      float spin = uTime * 1.8;
      float core = exp(-d * d * 700.0);
      float ringGlow = 0.0;
      for (int r = 0; r < 3; r++) {
        float radius = 0.03 + float(r) * 0.025;
        float ringDist = abs(d - radius);
        ringGlow += exp(-ringDist * ringDist * 3000.0) * (1.0 - float(r) * 0.25);
      }
      float spiralAngle = angle - d * 40.0 + spin;
      float spiral = smoothstep(0.35, 0.0, abs(sin(spiralAngle))) * smoothstep(0.09, 0.0, d) * smoothstep(0.0, 0.015, d);
      vec3 orbColor = vec3(0.75, 0.55, 1.0);
      vec3 addColor = orbColor * (core * 1.4 + ringGlow * 0.8 + spiral * 0.6);
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        float pd = distance(vTexCoord, uParticlePos[i]);
        float glow = exp(-pd * pd * 900.0);
        float twinkle = 0.6 + 0.4 * sin(uTime * 10.0 + float(i) * 12.9);
        addColor += sparkleColor(uParticleColorIdx[i]) * glow * uParticleLife[i] * twinkle;
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uPalmCenter: "hand.0.palmCenter",
    uTime: "time.elapsed",
    uParticlePos: "particles.sparkle.positions",
    uParticleLife: "particles.sparkle.life",
    uParticleColorIdx: "particles.sparkle.colorIndex",
    uParticleCount: "particles.sparkle.count",
  },
  // near-zero/negative gravity so sparkles drift gently upward instead of falling
  particleSystems: [{ id: "sparkle", gravity: -0.15, maxParticles: 24 }],
  triggers: [
    { on: "hand.0.detected && edge(true)", action: "particles.sparkle.spawnBurst(origin=hand.0.palmCenter, count=10, speed=0.4, lifetime=1.0)" },
  ],
});
