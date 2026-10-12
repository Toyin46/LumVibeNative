import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Demon Eyes v2 - the real eyes turn into glowing red slits: white-hot core,
// deep red body, soft red halo bleeding onto the skin. Sits on the IRIS, closes
// with each eye's blink. Uses face.irisCenter.left/right + face.eyeOpen
// (added with Eye Laser v2).
// TUNING (manifest constants, no rebuild): uEyeSize = size of the glowing eyes,
// uPower = glow brightness.
export default defineEffect({
  id: "demon_eyes",
  displayName: "Demon Eyes",
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
    uniform vec2 uIrisLeft;
    uniform vec2 uIrisRight;
    uniform vec2 uEyeOpen;
    uniform vec4 uFaceBox;
    uniform float uPower;
    uniform float uEyeSize;
    uniform float uTimeSec;

    // x,y,z = glow colour to ADD, w = how much to REPLACE the real eye (0..1)
    vec4 demonEye(vec2 p, vec2 o, float open, float faceW, float seed) {
      if (open < 0.01) return vec4(0.0);
      vec2 q = p - o;
      float ew = faceW * 0.108 * uEyeSize;
      float eh = faceW * 0.056 * uEyeSize * (0.18 + 0.82 * open);
      float d = length(q / vec2(ew, eh));
      float pulse = 0.93 + 0.07 * sin(uTimeSec * 5.0 + seed);

      float body = 1.0 - smoothstep(0.80, 1.0, d);
      float core = exp(-dot(q, q) / (ew * ew * 0.16));
      vec3 eyeCol = mix(vec3(0.85, 0.03, 0.01), vec3(1.0, 0.13, 0.05), exp(-d * d * 1.3));
      eyeCol += vec3(1.0, 0.68, 0.62) * core * 0.9;
      eyeCol *= pulse;

      float glowIn = 1.0 - smoothstep(0.9, 3.0, d);
      float glowOut = exp(-dot(q, q) / (faceW * faceW * 0.0150));
      float flare = exp(-(q.y * q.y) / (faceW * faceW * 0.00018)) * exp(-abs(q.x) / (faceW * 0.15));
      vec3 glow = vec3(1.0, 0.10, 0.04) * (glowIn * 0.65 + glowOut * 0.28) * pulse
                + vec3(1.0, 0.35, 0.18) * flare * 0.35;

      vec3 add = (eyeCol * body * 0.55 + glow) * open;
      return vec4(add, body * 0.92 * open);
    }

    void main() {
      vec3 base = texture2D(uTexture, vTexCoord).rgb;
      float aspect = uTexelSize.y / uTexelSize.x;
      vec2 A = vec2(aspect, 1.0);
      vec2 p = vTexCoord * A;
      float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);

      vec4 l = demonEye(p, uIrisLeft * A, uEyeOpen.x, faceW, 0.0);
      vec4 r = demonEye(p, uIrisRight * A, uEyeOpen.y, faceW, 2.7);

      float rep = clamp(l.w + r.w, 0.0, 1.0);
      vec3 eyeFill = vec3(0.0);
      float wsum = l.w + r.w;
      if (wsum > 0.001) eyeFill = (l.rgb * l.w + r.rgb * r.w) / wsum;
      vec3 col = mix(base, eyeFill * 1.6, rep);
      vec3 add = 1.0 - exp(-(l.rgb + r.rgb) * uPower);
      vec3 outc = 1.0 - (1.0 - col) * (1.0 - add);
      gl_FragColor = vec4(outc, 1.0);
    }
  `,
  bindings: {
    uIrisLeft: "face.irisCenter.left",
    uIrisRight: "face.irisCenter.right",
    uEyeOpen: "face.eyeOpen",
    uFaceBox: "face.boundingBox",
    uTimeSec: "time.elapsed",
  },
  constants: { uPower: 1.0, uEyeSize: 1.0 },
});
