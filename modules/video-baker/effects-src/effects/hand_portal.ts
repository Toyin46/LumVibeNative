import { defineEffect } from "../types/EffectDefinition";
import { EXT_HEADER } from "../shaders/common";

// CORRECTED: the real shader maps the portal texture into the circle via
// (vTexCoord - center)/radius*0.5+0.5 (so the portal image fits and scales
// with the circle, not just shown at raw screen UVs), has a hard circular
// cutoff with a soft edge blend only right at the boundary, and a warm
// ring glow — my first pass used a simpler always-blended version.
export default defineEffect({
  id: "hand_portal",
  displayName: "Hand Portal",
  category: "gesture",
  requires: ["hand"],
  fragmentShader:
    EXT_HEADER +
    `
    varying vec2 vTexCoord;
    uniform samplerExternalOES uTexture;
    uniform sampler2D uPortalTexture;
    uniform vec2 uPortalCenter;
    uniform float uPortalRadius;
    void main() {
      vec4 videoColor = texture2D(uTexture, vTexCoord);
      float d = distance(vTexCoord, uPortalCenter);
      if (d < uPortalRadius) {
        vec2 portalUv = (vTexCoord - uPortalCenter) / uPortalRadius * 0.5 + 0.5;
        vec4 portalColor = texture2D(uPortalTexture, portalUv);
        float edge = smoothstep(uPortalRadius, uPortalRadius * 0.9, d);
        vec3 ringGlow = vec3(1.0, 0.6, 0.15) * smoothstep(0.06, 0.0, abs(d - uPortalRadius));
        gl_FragColor = vec4(mix(videoColor.rgb, portalColor.rgb, edge) + ringGlow, videoColor.a);
      } else {
        gl_FragColor = videoColor;
      }
    }
  `,
  bindings: { uPortalCenter: "hand.0.palmCenter" },
  constants: { uPortalRadius: 0.18 },
  assets: { uPortalTexture: "assets/portal_scene.png" },
});
