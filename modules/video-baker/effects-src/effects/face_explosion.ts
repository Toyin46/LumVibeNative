import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Face Explosion v2 - open your mouth wide (jawOpen > 0.6): the face breaks
// into a colourful mosaic of chips that scatter outward and settle back, with
// confetti particles bursting from the mouth. Needs only the FACE (no
// segmentation tracker).
export default defineEffect({
  id: "face_explosion",
  displayName: "Face Explosion",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #endif
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uTexelSize;
    uniform vec4 uFaceBox;
    uniform float uProgress;
    uniform vec2 uParticlePos[24];
    uniform float uParticleRot[24];
    uniform float uParticleLife[24];
    uniform float uParticleColorIdx[24];
    uniform int uParticleCount;

    vec2 hash2(vec2 p) {
      vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(q) * 43758.5453);
    }

    vec3 palette(float i) {
      if (i < 0.5) return vec3(1.0, 0.35, 0.55);
      if (i < 1.5) return vec3(1.0, 0.85, 0.20);
      if (i < 2.5) return vec3(0.20, 0.85, 1.0);
      if (i < 3.5) return vec3(1.0, 0.55, 0.15);
      if (i < 4.5) return vec3(0.70, 0.35, 1.0);
      return vec3(0.40, 1.0, 0.45);
    }

    void main() {
      vec3 base = texture2D(uTexture, vTexCoord).rgb;
      float aspect = uTexelSize.y / uTexelSize.x;
      vec2 A = vec2(aspect, 1.0);
      vec2 p = vTexCoord * A;
      float pr = clamp(uProgress, 0.0, 1.0);
      float env = sin(3.14159265 * pr);
      vec3 col = base;
      vec2 fc = vec2((uFaceBox.x + uFaceBox.z) * 0.5 * aspect, (uFaceBox.y + uFaceBox.w) * 0.5);
      float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);
      float faceH = max(uFaceBox.w - uFaceBox.y, 0.05);

      if (env > 0.001) {
        vec2 q = p - fc;
        float d = length(q / vec2(faceW * 0.52, faceH * 0.58));
        float inFace = 1.0 - smoothstep(0.92, 1.12 + 0.25 * env, d);
        if (inFace > 0.001) {
          float c = faceW * 0.085;
          vec2 baseId = floor(p / c);
          float cover = 0.0;
          vec2 chipCC = vec2(0.0);
          float chipH = 0.0;
          for (int jy = -2; jy <= 2; jy++) {
            for (int jx = -2; jx <= 2; jx++) {
              vec2 id = baseId + vec2(float(jx), float(jy));
              vec2 cc = (id + 0.5) * c;
              vec2 h = hash2(id);
              vec2 dir = cc - fc;
              dir = dir / max(length(dir), 0.0001);
              vec2 disp = (dir * (0.25 + 0.75 * h.x) * 1.4 + (hash2(id + 3.1) - 0.5) * 0.6) * c * env;
              float ang = (h.y - 0.5) * 2.4 * env;
              vec2 rel = p - (cc + disp);
              float cs = cos(ang);
              float sn = sin(ang);
              vec2 loc = vec2(rel.x * cs + rel.y * sn, -rel.x * sn + rel.y * cs);
              float hw = c * 0.52 * (1.0 - 0.12 * env);
              float inside = (1.0 - smoothstep(hw - 0.0015, hw, abs(loc.x))) * (1.0 - smoothstep(hw - 0.0015, hw, abs(loc.y)));
              if (inside > cover) { cover = inside; chipCC = cc; chipH = h.x * 0.7 + h.y * 0.3; }
            }
          }
          vec3 src = texture2D(uTexture, chipCC / A).rgb;
          vec3 tint = palette(floor(chipH * 5.99));
          vec3 chipCol = mix(src, tint, 0.30 * env) * (0.9 + 0.35 * chipH);
          float lum = dot(src, vec3(0.299, 0.587, 0.114));
          chipCol = mix(vec3(lum), chipCol, 1.0 + 0.5 * env);
          vec3 mosaic = mix(base * 0.75, chipCol, cover);
          col = mix(base, mosaic, inFace * clamp(env * 1.6, 0.0, 1.0));
        }
      }

      for (int i = 0; i < 24; i++) {
        if (i >= uParticleCount) break;
        vec2 toP = (vTexCoord - uParticlePos[i]) * A;
        float rad = radians(uParticleRot[i]);
        vec2 loc = vec2(toP.x * cos(rad) + toP.y * sin(rad), -toP.x * sin(rad) + toP.y * cos(rad));
        float sz = faceW * 0.040;
        float shape = (1.0 - smoothstep(sz * 0.85, sz, abs(loc.x))) * (1.0 - smoothstep(sz * 0.5, sz * 0.6, abs(loc.y)));
        col = mix(col, palette(uParticleColorIdx[i]) * 1.15, shape * uParticleLife[i]);
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  bindings: {
    uFaceBox: "face.boundingBox",
    uProgress: "engine.explosionProgress" as any,
    uParticlePos: "particles.debris.positions" as any,
    uParticleRot: "particles.debris.rotations" as any,
    uParticleLife: "particles.debris.life" as any,
    uParticleColorIdx: "particles.debris.colorIndex" as any,
    uParticleCount: "particles.debris.count" as any,
  },
  particleSystems: [{ id: "debris", gravity: 0.9, maxParticles: 24 }],
  triggers: [
    { on: "face.jawOpen > 0.6 && edge(true)", action: "engine.triggerExplosion(durationSeconds=1.3)" },
    { on: "face.jawOpen > 0.6 && edge(true)", action: "particles.debris.spawnBurst(origin=face.mouthCenter, count=24, speed=1.7, lifetime=1.2)" },
  ],
});
