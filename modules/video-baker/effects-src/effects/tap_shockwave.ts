import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

export default defineEffect({
  id: "tap_shockwave",
  displayName: "Tap Shockwave",
  category: "gesture",
  requires: [],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform vec2 uBoomCenter;
    uniform float uBoomEnergy;
    void main() {
      vec4 base = texture2D(uTexture, vTexCoord);
      float d = distance(vTexCoord, uBoomCenter);
      float maxRadius = 0.38;
      vec3 ringColor = vec3(0.6, 0.85, 1.0);
      vec3 addColor = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float echoEnergy = clamp(uBoomEnergy - float(i) * 0.22, 0.0, 1.0);
        float radius = (1.0 - echoEnergy) * maxRadius;
        float ringWidth = 0.014 + (1.0 - echoEnergy) * 0.01;
        float ring = smoothstep(ringWidth, 0.0, abs(d - radius)) * echoEnergy;
        addColor += ringColor * ring * (1.0 - float(i) * 0.3);
      }
      gl_FragColor = vec4(base.rgb + addColor, base.a);
    }
  `,
  bindings: {
    uBoomCenter: "engine.boomCenter" as any,
    uBoomEnergy: "engine.boomEnergy" as any,
  },
  triggers: [
    { on: "touch.active && edge(true)", action: "engine.triggerBoom(center=touch.position, decaySeconds=0.6)" },
  ],
});
