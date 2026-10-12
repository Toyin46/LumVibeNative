import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "voice_halo",
  displayName: "Voice Halo",
  category: "music",
  requires: ["face", "audio"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec4 uFaceBox;
    uniform float uIntensity; // normalized audio amplitude 0..1
    uniform float uTime;
    float hash1(float n) { return fract(sin(n) * 43758.5453); }
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      vec2 center = vec2((uFaceBox.x + uFaceBox.z) * 0.5, (uFaceBox.y + uFaceBox.w) * 0.5);
      float boxSize = max(uFaceBox.z - uFaceBox.x, uFaceBox.w - uFaceBox.y);
      float baseRadius = boxSize * 0.78;
      vec2 rel = vTexCoord - center;
      float d = length(rel);
      float angle = atan(rel.y, rel.x);
      float response = pow(clamp(uIntensity, 0.0, 1.0), 0.6);
      float idleBreath = 0.03 * sin(uTime * 1.3);
      float radius = baseRadius * (1.0 + idleBreath);
      const float BARS = 72.0;
      float barIndex = floor((angle / 6.28318 + 0.5) * BARS);
      float barPhase = hash1(barIndex * 12.9898);
      float wobble = 0.5 + 0.5 * sin(uTime * (1.5 + barPhase * 2.0) + barPhase * 30.0);
      float spike = 0.3 + 0.7 * wobble;
      float barHeight = radius * (0.08 + 0.22 * response) * spike;
      float ringDist = d - radius;
      float bar = smoothstep(0.0, barHeight * 0.1, ringDist)
          - smoothstep(barHeight * 0.85, barHeight, ringDist);
      float baseRing = exp(-ringDist * ringDist * 2500.0);
      float glow = clamp(bar + baseRing * 0.6, 0.0, 1.0) * (0.4 + response * 1.0);
      vec3 quietColor = vec3(0.25, 0.65, 1.0);
      vec3 loudColor  = vec3(1.0, 0.75, 0.25);
      vec3 glowColor = mix(quietColor, loudColor, response);
      gl_FragColor = vec4(base.rgb + glowColor * glow, base.a);
    }
  `,
  bindings: { uFaceBox: "face.boundingBox", uIntensity: "audio.amplitude", uTime: "time.elapsed" },
});
