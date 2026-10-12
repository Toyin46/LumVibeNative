import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Eye Laser v2 - glowing eyes + white-hot beams that follow where you look.
// Anchored to the IRIS (not the eyelid), direction = head direction + eye
// direction, each eye fades out on its own blink. Needs the 4 new face
// signals: face.irisCenter.left/right, face.gazeDir, face.eyeOpen.
//
// TUNING (no rebuild, just edit constants and recompile the manifest):
//   uGazeSign [x, y]: flip to [-1, 1] / [1, -1] if beams point the wrong way
//   uPower: overall brightness (1.0 normal, 1.4 brighter)
export default defineEffect({
  id: "eye_laser",
  displayName: "Eye Laser",
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
    uniform float uTimeSec;

    vec3 laserEye(vec2 p, vec2 o, vec2 g, vec2 splay, float open, float faceW) {
      if (open < 0.01) return vec3(0.0);
      vec2 d = g + splay;
      d = d / max(length(d), 0.0001);
      vec2 q = p - o;
      float along = dot(q, d);
      float perp = abs(q.x * d.y - q.y * d.x);
      float r = length(q);
      float t = max(along, 0.0) / faceW;

      float w = faceW * (0.011 + 0.007 * min(t, 3.0));
      float x = perp / w;
      float core = exp(-x * x);
      float glow = exp(-x * x / 16.0);
      float halo = exp(-x * x / 140.0);
      float start = smoothstep(-0.01 * faceW, 0.04 * faceW, along);
      float decay = 1.0 / (1.0 + 0.22 * t);
      float flick = 0.95 + 0.05 * sin(uTimeSec * 50.0 + t * 9.0);
      vec3 beam = (vec3(1.0, 0.93, 0.86) * core * 1.7
                 + vec3(1.0, 0.11, 0.05) * glow * 1.15
                 + vec3(1.0, 0.05, 0.02) * halo * 0.40) * start * decay * flick;

      float e1 = r / (faceW * 0.030);
      float e2 = r / (faceW * 0.075);
      float e3 = r / (faceW * 0.22);
      float streak = exp(-(q.y * q.y) / (faceW * faceW * 0.00022)) * exp(-abs(q.x) / (faceW * 0.16));
      vec3 eye = vec3(1.0, 0.88, 0.78) * exp(-e1 * e1) * 2.0
               + vec3(1.0, 0.13, 0.05) * exp(-e2 * e2) * 1.3
               + vec3(1.0, 0.06, 0.03) * exp(-e3 * e3) * 0.28
               + vec3(1.0, 0.20, 0.12) * streak * 0.55;

      return (beam + eye) * open;
    }

    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float aspect = uTexelSize.y / uTexelSize.x;
      vec2 A = vec2(aspect, 1.0);
      vec2 p = vTexCoord * A;
      float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);
      vec2 g = uGaze * uGazeSign;
      vec3 add = laserEye(p, uIrisLeft * A, g, vec2(-0.10, 0.16), uEyeOpen.x, faceW)
               + laserEye(p, uIrisRight * A, g, vec2(0.10, 0.16), uEyeOpen.y, faceW);
      add = 1.0 - exp(-add * uPower);
      vec3 outc = 1.0 - (1.0 - base.rgb) * (1.0 - add);
      gl_FragColor = vec4(outc, base.a);
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
  constants: { uGazeSign: [1.0, 1.0], uPower: 1.0 },
});
