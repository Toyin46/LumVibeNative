import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "fire_book",
  displayName: "Fire Book",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform samplerExternalOES uFireTexture;
    uniform mat4 uFireTexMatrix;
    uniform sampler2D uPortalTexture;
    uniform vec2 uPortalCenter;
    uniform float uPortalRadius; // repurposed: book half-width scale
    uniform float uPortalAngle;  // radians — wrist->index-MCP angle
    uniform vec2 uParticlePos[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;
    uniform float uTime;
    vec3 flameColor(float idx) {
      if (idx < 2.0) return vec3(1.0, 0.85, 0.3);
      if (idx < 4.0) return vec3(1.0, 0.5, 0.1);
      return vec3(1.0, 0.2, 0.05);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec3 outColor = base.rgb;
      float halfW = uPortalRadius;
      float halfH = uPortalRadius * 0.7;
      vec2 rawOffset = vTexCoord - uPortalCenter;
      float ca = cos(-uPortalAngle); float sa = sin(-uPortalAngle);
      vec2 rotatedOffset = vec2(rawOffset.x * ca - rawOffset.y * sa, rawOffset.x * sa + rawOffset.y * ca);
      vec2 toBook = rotatedOffset / vec2(halfW, halfH);
      if (abs(toBook.x) < 1.0 && abs(toBook.y) < 1.0) {
        vec2 bookUV = toBook * 0.5 + 0.5;
        vec4 bookColor = texture2D(uPortalTexture, bookUV);
        outColor = mix(outColor, bookColor.rgb, bookColor.a);
      }
      vec2 bookTop = uPortalCenter + vec2(0.0, -halfH * 0.9);
      vec2 bfSpace = vTexCoord - bookTop;
      float bfPulse = 0.85 + 0.15 * sin(uTime * 5.0);
      float bfHeight = halfH * 1.6 * bfPulse;
      float bfWidth = halfW * 0.45 * bfPulse;
      float bft = clamp(-bfSpace.y / bfHeight, 0.0, 1.0);
      float bfCoreWidth = bfWidth * (1.0 - bft) * (1.0 - bft);
      float bfWithinWidth = smoothstep(bfCoreWidth + 0.02, bfCoreWidth - 0.005, abs(bfSpace.x));
      float bfAboveBook = smoothstep(0.02, -0.01, bfSpace.y);
      float bfBelowTip = smoothstep(-bfHeight - 0.02, -bfHeight + 0.02, bfSpace.y);
      float bfInFlame = bfWithinWidth * bfAboveBook * bfBelowTip;
      vec2 fireRawUv = vec2(0.5 + bfSpace.x / (bfCoreWidth * 3.0 + 0.001), bft);
      vec2 fireUv = (uFireTexMatrix * vec4(fireRawUv, 0.0, 1.0)).xy;
      vec3 fireVideo = texture2D(uFireTexture, fireUv).rgb;
      float fireVideoLuma = dot(fireVideo, vec3(0.299, 0.587, 0.114));
      outColor += fireVideo * fireVideoLuma * bfInFlame * 0.9;
      float glowDist = length(rawOffset) / max(halfW, halfH);
      float glowPulse = 0.7 + 0.3 * sin(uTime * 6.0);
      float glow = exp(-glowDist * glowDist * 2.0) * 0.25 * glowPulse;
      outColor += vec3(1.0, 0.55, 0.15) * glow;
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        float d = distance(vTexCoord, uParticlePos[i]);
        float flicker = 0.6 + 0.4 * sin(uTime * 16.0 + float(i) * 7.0);
        float flame = exp(-d * d * 700.0) * flicker;
        outColor += flameColor(uParticleColorIdx[i]) * flame * uParticleLife[i];
      }
      gl_FragColor = vec4(outColor, base.a);
    }
  `,
  bindings: {
    uPortalCenter: "hand.0.palmCenter",
    uPortalAngle: "hand.0.angle",
    uTime: "time.elapsed",
    uParticlePos: "particles.flames.positions",
    uParticleLife: "particles.flames.life",
    uParticleColorIdx: "particles.flames.colorIndex",
    uParticleCount: "particles.flames.count",
  },
  constants: { uPortalRadius: 0.16 },
  particleSystems: [{ id: "flames", gravity: -0.5, maxParticles: 24 }],
  assets: { uPortalTexture: "assets/fx_gl_fire_book2.png", uFireTexture: "assets/fire_loop.mp4" },
  triggers: [
    { on: "hand.0.detected && edge(true)", action: "particles.flames.spawnBurst(origin=hand.0.palmCenter, count=12, speed=0.5, lifetime=1.0)" },
  ],
});
