import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// The real-fire-video layer (uFireTexture/uFireTexMatrix, from
// FireVideoPlayer.kt) is the one piece of this effect that isn't pure
// signal→uniform: it needs a small looping video decoder bound as a second
// external texture. Declared here as an asset; the native port needs a
// FireVideoPlayer-equivalent (MediaCodec on Android, AVPlayer on iOS)
// wired to uFireTexture — noted honestly rather than glossed over.
export default defineEffect({
  id: "mouth_fire",
  displayName: "Mouth Fire",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform samplerExternalOES uFireTexture;
    uniform mat4 uFireTexMatrix;
    uniform vec2 uMouthCenter;
    uniform float uIntensity; // jawOpen score 0..1
    uniform float uTime;
    uniform vec2 uParticlePos[24];
    uniform float uParticleLife[24];
    uniform int uParticleCount;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float valueNoise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }
    float flameNoise(vec2 p) {
      float n = valueNoise(p) * 0.65;
      n += valueNoise(p * 2.3 + vec2(0.0, uTime * 1.7)) * 0.35;
      return n;
    }
    vec3 flameGradient(float t) {
      vec3 white = vec3(1.0, 0.98, 0.85);
      vec3 yellow = vec3(1.0, 0.85, 0.25);
      vec3 orange = vec3(1.0, 0.45, 0.05);
      vec3 red = vec3(0.65, 0.08, 0.02);
      if (t < 0.25) return mix(white, yellow, t / 0.25);
      if (t < 0.6) return mix(yellow, orange, (t - 0.25) / 0.35);
      return mix(orange, red, (t - 0.6) / 0.4);
    }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float openAmount = clamp(uIntensity, 0.0, 1.0);
      float wobble = (flameNoise(vec2(vTexCoord.x * 8.0, uTime * 6.0)) - 0.5) * 0.05;
      vec2 flameSpace = vec2(vTexCoord.x - uMouthCenter.x - wobble, vTexCoord.y - uMouthCenter.y);
      float height = 0.14 + openAmount * 0.16;
      float width = 0.05 + openAmount * 0.03;
      float t = clamp(-flameSpace.y / height, 0.0, 1.0);
      float coreWidth = width * (1.0 - t) * (1.0 - t);
      float edgeNoise = flameNoise(vec2(vTexCoord.x * 12.0, vTexCoord.y * 12.0 - uTime * 4.0)) * 0.02;
      float edgeWidth = coreWidth + edgeNoise;
      float withinWidth = smoothstep(edgeWidth + 0.015, edgeWidth - 0.005, abs(flameSpace.x));
      float aboveMouth = smoothstep(0.02, -0.01, flameSpace.y);
      float belowTip = smoothstep(-height - 0.02, -height + 0.02, flameSpace.y);
      float inFlame = withinWidth * aboveMouth * belowTip;
      vec3 flameColor = flameGradient(t);
      float flameAlpha = inFlame * openAmount;
      float distFromCore = max(0.0, abs(flameSpace.x) - coreWidth);
      float glow = exp(-distFromCore * distFromCore * 400.0) * aboveMouth * belowTip;
      vec3 glowColor = vec3(1.0, 0.5, 0.1) * glow * openAmount * 0.35;
      vec3 addColor = flameColor * flameAlpha + glowColor;
      vec2 fireRawUv = vec2(0.5 + flameSpace.x / (edgeWidth * 3.0 + 0.001), t);
      vec2 fireUv = (uFireTexMatrix * vec4(fireRawUv, 0.0, 1.0)).xy;
      vec3 fireVideo = texture2D(uFireTexture, fireUv).rgb;
      float fireVideoLuma = dot(fireVideo, vec3(0.299, 0.587, 0.114));
      addColor += fireVideo * fireVideoLuma * inFlame * openAmount * 0.9;
      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        float life = uParticleLife[i];
        float d = distance(vTexCoord, uParticlePos[i]);
        float radius = mix(0.003, 0.009, life);
        float ember = smoothstep(radius, radius * 0.3, d);
        vec3 emberColor = flameGradient(1.0 - life);
        addColor += emberColor * ember * life * 0.9;
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uMouthCenter: "face.mouthCenter",
    uIntensity: "face.jawOpen",
    uTime: "time.elapsed",
    uParticlePos: "particles.embers.positions",
    uParticleLife: "particles.embers.life",
    uParticleCount: "particles.embers.count",
  },
  particleSystems: [{ id: "embers", gravity: -0.3, maxParticles: 24 }],
  assets: { uFireTexture: "assets/fire_loop.mp4" },
  staticFallback: { uIntensity: 0 },
});
