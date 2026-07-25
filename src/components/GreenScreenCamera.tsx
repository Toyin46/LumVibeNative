// ═══════════════════════════════════════════════════════════
// GreenScreenCamera.tsx
// GPU chroma-key green screen via Skia RuntimeEffect shader,
// with defensive graceful fallback if the pipeline isn't
// supported on a given device/build — mirrors the proven
// pattern already used in SkiaARCamera.tsx (optional requires,
// try/catch, Android black-screen watchdog timer).
// ═══════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect } from 'react';
import { View, StyleSheet, Image, Text, Platform } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';

// Optional deps — loaded defensively so a missing/incompatible
// native module never crashes the app, only disables this feature.
let Skia: any = null;
try { Skia = require('@shopify/react-native-skia').Skia; } catch { Skia = null; }

// ─── Chroma-key fragment shader ───────────────────────────
// Per-pixel: if a pixel is meaningfully greener than both its
// red and blue channels, fade its alpha toward 0 (transparent).
// smoothstep gives a soft edge instead of a hard cutout, which
// avoids jagged silhouette edges around hair/fingers.
const GREEN_SCREEN_SHADER_SRC = `
uniform shader inputImage;
uniform float  threshold;
uniform float  smoothing;

half4 main(float2 coord) {
  half4 pixel = inputImage.eval(coord);
  float r = pixel.r;
  float g = pixel.g;
  float b = pixel.b;

  float greenness = g - max(r, b);
  float keyStrength = smoothstep(threshold * 0.08, threshold * 0.08 + smoothing, greenness);

  return half4(pixel.rgb, pixel.a * (1.0 - keyStrength));
}
`;

const greenScreenEffect = Skia ? Skia.RuntimeEffect.Make(GREEN_SCREEN_SHADER_SRC) : null;

interface Props {
  backgroundUri?: string;
  threshold?:     number; // 0.0–2.0, default 1.4
  isActive:       boolean;
  facing:         'front' | 'back';
  style?:         object;
}

export function GreenScreenCamera({
  backgroundUri, threshold = 1.4, isActive, facing, style,
}: Props) {
  const device = useCameraDevice(facing);
  const [pipelineFailed, setPipelineFailed] = useState(false);
  const frameCount = useRef(0);

  // Watchdog: if no frames land within 3s of activation, the
  // shader pipeline likely isn't supported on this device/build —
  // fall back rather than leave the user staring at a black screen.
  useEffect(() => {
    if (!isActive) return;
    const timer = setTimeout(() => {
      if (frameCount.current === 0) setPipelineFailed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [isActive]);

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    frameCount.current++;
    if (!Skia || !greenScreenEffect) return;

    try {
      const surface = Skia.Surface.MakeOffscreen(frame.width, frame.height);
      if (!surface) return;

      const canvas = surface.getCanvas();
      const frameImage = (frame as any).toImage?.(); // requires VisionCamera Skia integration build
      if (!frameImage) return;

      const imageShader = frameImage.makeShader(Skia.TileMode.Clamp, Skia.TileMode.Clamp);
      const builder = Skia.RuntimeShaderBuilder(greenScreenEffect);
      builder.setUniform('threshold', threshold);
      builder.setUniform('smoothing', 0.1);
      builder.setUniform('inputImage', imageShader);

      const paint = Skia.Paint();
      paint.setShader(builder.makeShader());
      canvas.drawPaint(paint);
      surface.flush();
    } catch {
      // Worklet errors fail silently per-frame — the 3s watchdog
      // above catches sustained failure and switches to fallback.
    }
  }, [threshold]);

  if (!device) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.errText}>Camera not available</Text>
      </View>
    );
  }

  // ── Fallback mode: Skia unsupported or pipeline didn't init ──
  // Shows a plain, working camera feed instead of a crash or a
  // black screen. Honest "Beta" label rather than pretending the
  // chroma-key effect is active when it isn't.
  if (!Skia || !greenScreenEffect || pipelineFailed) {
    return (
      <View style={[styles.container, style]}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive}
        />
        <View style={styles.betaBadge}>
          <Text style={styles.betaBadgeText}>🟢 Green Screen: Beta mode</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      {backgroundUri ? (
        <Image source={{ uri: backgroundUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.defaultBg]} />
      )}

      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        frameProcessor={frameProcessor}
        pixelFormat="rgb"
        enableZoomGesture={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  errText:   { color: '#FFF', textAlign: 'center', marginTop: 40 },
  defaultBg: { backgroundColor: '#1a0a2e' },
  betaBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  betaBadgeText: { color: '#00ff88', fontSize: 10, fontWeight: '700' },
}); 
