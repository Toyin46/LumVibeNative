import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// Pattern: PURE SHADER. No tracker needed at all — just time. This is the
// simplest category and covers most of your "Environment & Style" gallery
// row (Duotone Pulse, Glitch Wave, Retro VHS, Light Leak, Bokeh Lights,
// Particle Flow, Rain Fall, Snow Fall, Cinematic Glow, Golden Hour, Flash
// Camera, Rich Camera) — copy this file, swap the GLSL, done.
export default defineEffect({
  id: "vintage_flicker",
  displayName: "Vintage Flicker",
  category: "environment",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform float uTime;
    uniform float uIntensity;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      float frameSeed = floor(uTime * 24.0);
      float flicker = 0.94 + 0.06 * hash(vec2(frameSeed, 0.0));
      color.rgb *= mix(1.0, flicker, uIntensity);
      float grain = (hash(vTexCoord * 500.0 + frameSeed) - 0.5) * 0.08 * uIntensity;
      color.rgb += grain;
      vec2 leakCenter = vec2(0.15 + 0.1 * sin(uTime * 0.1), 0.15 + 0.1 * cos(uTime * 0.07));
      float leakDist = distance(vTexCoord, leakCenter);
      float leak = smoothstep(0.6, 0.0, leakDist) * 0.35 * uIntensity;
      color.rgb += vec3(1.0, 0.55, 0.2) * leak;
      float vig = smoothstep(0.9, 0.3, distance(vTexCoord, vec2(0.5)));
      color.rgb *= mix(1.0, vig, 0.4 * uIntensity);
      gl_FragColor = color;
    }
  `,
  bindings: {
    uTime: "time.elapsed",
  },
});
