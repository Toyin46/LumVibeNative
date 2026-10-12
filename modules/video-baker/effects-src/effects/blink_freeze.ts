import { defineEffect } from "../types/EffectDefinition";

// CORRECTED: the real effect is a punch-zoom onto a captured frame with a
// static Voronoi frost-crystal overlay (two scales, fine + coarse) and a
// cool desaturated tint — not the simpler reconstruction from the first
// pass. Exact port of blinkFreezeVertex + blinkFreezeFragment.
export default defineEffect({
  id: "blink_freeze",
  displayName: "Blink Freeze",
  category: "face",
  requires: ["face"],
  vertexShader: `
    uniform float uZoom;
    attribute vec4 aPosition;
    attribute vec4 aTexCoord;
    varying mediump vec2 vTexCoord;
    void main() {
      gl_Position = vec4(aPosition.xy / uZoom, aPosition.z, aPosition.w);
      vTexCoord = aTexCoord.xy;
    }
  `,
  fragmentShader: `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D uFrozenTexture;
    vec2 hash2(vec2 p) {
      vec2 q = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return fract(sin(q) * 43758.5453);
    }
    float frostCrystals(vec2 uv, float scale) {
      vec2 p = uv * scale;
      vec2 cell = floor(p);
      float d1 = 8.0; float d2 = 8.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 neighbor = vec2(float(x), float(y));
        vec2 point = neighbor + hash2(cell + neighbor);
        float d = distance(p - cell, point);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
      return smoothstep(0.06, 0.0, d2 - d1);
    }
    void main() {
      vec4 src = texture2D(uFrozenTexture, vTexCoord);
      float luma = dot(src.rgb, vec3(0.299, 0.587, 0.114));
      vec3 desat = mix(src.rgb, vec3(luma), 0.55);
      vec3 iceTint = desat * vec3(0.75, 0.88, 1.05);
      float crystalsFine = frostCrystals(vTexCoord, 38.0);
      float crystalsCoarse = frostCrystals(vTexCoord + 5.2, 14.0) * 0.6;
      float crystals = clamp(crystalsFine + crystalsCoarse, 0.0, 1.0);
      vec3 outColor = iceTint + vec3(0.9, 0.96, 1.0) * crystals * 0.5;
      gl_FragColor = vec4(outColor, src.a);
    }
  `,
  bindings: { uZoom: "engine.freezeZoom" as any },
  triggers: [
    { on: "face.eyeBlinkBoth && edge(true)", action: "engine.captureFreezeFrame(holdSeconds=0.3, punchZoom=1.15)" },
  ],
});
