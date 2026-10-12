import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// CORRECTED: the real shader draws a cluster of three staggered 5-point
// stars around the winked eye, each independently rotating — not a single
// glow dot as my first pass sketched.
export default defineEffect({
  id: "wink_spark",
  displayName: "Wink Spark",
  category: "face",
  requires: ["face"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uIntensity; // wink score 0..1
    uniform vec2 uSparkOrigin; // real eye landmark position
    uniform float uTime;

    vec2 rot(vec2 p, float a) {
      float c = cos(a); float s = sin(a);
      return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    }
    float star(vec2 p, float points, float innerR, float outerR) {
      float angle = atan(p.y, p.x);
      float d = length(p);
      float seg = 6.28318 / points;
      float a = mod(angle, seg) - seg * 0.5;
      float r = mix(outerR, innerR, smoothstep(0.0, seg * 0.5, abs(a)));
      return smoothstep(r, r * 0.85, d);
    }

    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 o1 = uSparkOrigin;
      vec2 o2 = uSparkOrigin + vec2(0.035, -0.02);
      vec2 o3 = uSparkOrigin + vec2(-0.03, 0.025);
      float spark = 0.0;
      spark += star(rot(vTexCoord - o1, uTime), 5.0, 0.006, 0.028);
      spark += star(rot(vTexCoord - o2, -uTime * 1.4), 5.0, 0.003, 0.014) * 0.7;
      spark += star(rot(vTexCoord - o3, uTime * 1.7), 5.0, 0.003, 0.011) * 0.6;
      spark = clamp(spark, 0.0, 1.0) * uIntensity;

      vec3 sparkColor = vec3(1.0, 0.92, 0.55);
      gl_FragColor = vec4(base.rgb + sparkColor * spark * 2.0, base.a);
    }
  `,
  bindings: {
    // signed winkScore: engine hands back the RIGHT eye center automatically
    // when negative — see EffectEngine::resolveSignal's "signed eye pair" case.
    uIntensity: "face.winkScore",
    uSparkOrigin: "face.eyeCenter.left",
    uTime: "time.elapsed",
  },
});
