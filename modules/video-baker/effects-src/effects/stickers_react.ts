import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "stickers_react",
  displayName: "Stickers React",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uParticlePos[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;
    uniform float uTime;
    float heartShape(vec2 p) {
      p *= 6.0;
      float a = p.x * p.x + p.y * p.y - 1.0;
      return a * a * a - p.x * p.x * p.y * p.y * p.y;
    }
    vec3 reactColor(float idx) {
      if (idx < 2.0) return vec3(1.0, 0.35, 0.55);
      if (idx < 4.0) return vec3(1.0, 0.75, 0.2);
      return vec3(0.85, 0.45, 1.0);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec3 addColor = vec3(0.0);
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        vec2 local = vTexCoord - uParticlePos[i];
        float wobble = sin(uTime * 4.0 + float(i) * 3.1) * 0.01;
        local.x += wobble;
        float h = heartShape(local);
        float inHeart = smoothstep(0.05, -0.05, h);
        addColor += reactColor(uParticleColorIdx[i]) * inHeart * uParticleLife[i];
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uTime: "time.elapsed",
    uParticlePos: "particles.hearts.positions",
    uParticleLife: "particles.hearts.life",
    uParticleColorIdx: "particles.hearts.colorIndex",
    uParticleCount: "particles.hearts.count",
  },
  particleSystems: [{ id: "hearts", gravity: -0.4, maxParticles: 24 }],
  triggers: [
    { on: "face.smileScore > 0.7 && edge(true)", action: "particles.hearts.spawnBurst(origin=face.mouthCenter, count=14, speed=0.6, lifetime=1.3)" },
  ],
});
