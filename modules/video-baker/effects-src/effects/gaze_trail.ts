import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Gaze Trail v2 - glowing violet eyes, long energy streaks with electric
// tendrils trailing BEHIND where you look, and a purple "echo" ghost of the
// frame that smears opposite to your look direction.
// Uses the same face signals as Eye Laser v2 (irisCenter.left/right, gazeDir,
// eyeOpen) - no extra native plumbing.
// TUNING (manifest constants, no rebuild): uGazeSign flips direction,
// uPower = brightness, uGhost = strength of the echo (0 turns it off).
export default defineEffect({
  id: "gaze_trail",
  displayName: "Gaze Trail",
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
    uniform vec2 uGaze;
    uniform vec2 uEyeOpen;
    uniform vec4 uFaceBox;
    uniform vec2 uGazeSign;
    uniform float uPower;
    uniform float uGhost;
    uniform float uTimeSec;

    vec3 streakEye(vec2 p, vec2 o, vec2 back, float len, float open, float faceW) {
      if (open < 0.01) return vec3(0.0);
      vec2 q = p - o;
      float along = dot(q, back);
      float perp = q.x * back.y - q.y * back.x;
      float t = along / faceW;
      float tb = max(t, 0.0);
      float env = mix(exp(min(t, 0.0) / (len * 0.16)) * 0.55, exp(-tb / len), step(0.0, t));
      float w = faceW * 0.008 * (1.0 + 0.6 * clamp(t, 0.0, 2.0));
      float x = perp / w;
      float mainLine = exp(-x * x);
      float haze = exp(-x * x / 28.0);
      float ramp = smoothstep(0.0, 0.35, t);
      float tendrils = 0.0;
      for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float disp = faceW * (0.045 + 0.028 * fk) * ramp
                   * sin(t * (9.0 + 5.0 * fk) + uTimeSec * (6.0 + 3.0 * fk) + fk * 2.1);
        float xk = (perp - disp) / (w * 0.85);
        tendrils += exp(-xk * xk) * (0.62 - 0.12 * fk) * (0.8 + 0.2 * sin(uTimeSec * 37.0 + fk * 5.0));
      }
      vec3 streak = (vec3(0.96, 0.86, 1.0) * mainLine * 1.35
                   + vec3(0.62, 0.20, 1.0) * haze * 0.85
                   + vec3(0.76, 0.42, 1.0) * tendrils) * env;
      float r = length(q);
      float e1 = r / (faceW * 0.030);
      float e2 = r / (faceW * 0.085);
      float e3 = r / (faceW * 0.26);
      vec3 eye = vec3(0.96, 0.86, 1.0) * exp(-e1 * e1) * 1.9
               + vec3(0.62, 0.20, 1.0) * exp(-e2 * e2) * 1.25
               + vec3(0.50, 0.15, 0.95) * exp(-e3 * e3) * 0.32;
      return (streak + eye) * open;
    }

    void main() {
      float aspect = uTexelSize.y / uTexelSize.x;
      vec2 A = vec2(aspect, 1.0);
      vec2 p = vTexCoord * A;
      float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);
      vec2 g = uGaze * uGazeSign;
      float gm = length(g);

      vec3 base = texture2D(uTexture, vTexCoord).rgb;
      float eyesOpen = max(uEyeOpen.x, uEyeOpen.y);

      vec2 off = -g * faceW * 0.45;
      float ol = length(off);
      off = off * min(1.0, faceW * 0.7 / max(ol, 0.0001));
      vec2 offUv = off / A;
      vec3 ghost = vec3(0.0);
      for (int i = 1; i <= 5; i++) {
        float f = float(i) / 5.0;
        ghost += texture2D(uTexture, vTexCoord + offUv * f).rgb * (1.0 - f * 0.6);
      }
      ghost = ghost / 3.2 * vec3(0.78, 0.52, 1.18);
      float ghostAmt = smoothstep(0.08, 0.5, gm) * eyesOpen * uGhost;
      vec3 col = base * (1.0 - 0.30 * ghostAmt) + ghost * 0.42 * ghostAmt;

      float len = 0.9 + 1.4 * smoothstep(0.1, 0.6, gm);
      vec2 bl = -g + vec2(-0.15, 0.0);
      vec2 br = -g + vec2(0.15, 0.0);
      bl = bl / max(length(bl), 0.0001);
      br = br / max(length(br), 0.0001);
      vec2 pl = uIrisLeft * A;
      vec2 pr = uIrisRight * A;
      vec3 add = streakEye(p, pl, bl, len, uEyeOpen.x, faceW)
               + streakEye(p, pr, br, len, uEyeOpen.y, faceW);
      float rl = length(p - pl) / (faceW * 0.5);
      float rr = length(p - pr) / (faceW * 0.5);
      add += vec3(0.30, 0.09, 0.55) * 0.18 * (exp(-rl * rl) * uEyeOpen.x + exp(-rr * rr) * uEyeOpen.y);

      add = 1.0 - exp(-add * uPower);
      vec3 outc = 1.0 - (1.0 - col) * (1.0 - add);
      gl_FragColor = vec4(outc, 1.0);
    }
  `,
  bindings: {
    uIrisLeft: "face.irisCenter.left",
    uIrisRight: "face.irisCenter.right",
    uGaze: "face.gazeDir",
    uEyeOpen: "face.eyeOpen",
    uFaceBox: "face.boundingBox",
    uTimeSec: "time.elapsed",
  },
  constants: { uGazeSign: [1.0, 1.0], uPower: 1.0, uGhost: 1.0 },
});
