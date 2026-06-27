// ═══════════════════════════════════════════════════════════
// SkiaARCamera.tsx — Face-tracked Skia AR camera
// src/components/ar/SkiaARCamera.tsx
// utils at: ../../utils/types
// ═══════════════════════════════════════════════════════════

import React, { useRef, useState, useEffect, memo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
import AROverlay from './AROverlay';
import type { AREffect } from '../../utils/types';

// Optional deps
let Worklets: any = null;
let useFaceDetector: any = null;
try { Worklets = require('react-native-worklets-core').Worklets; } catch { Worklets = null; }
try { useFaceDetector = require('react-native-vision-camera-face-detector').useFaceDetector; } catch { useFaceDetector = null; }

interface Props {
  effect:      AREffect;
  facing:      'front' | 'back';
  isActive:    boolean;
  cameraRef:   React.RefObject<Camera>;
  style?:      object;
}

const SkiaARCamera = memo(function SkiaARCamera({
  effect, facing, isActive, cameraRef, style,
}: Props) {
  const [landmarks,   setLandmarks]   = useState(null);
  const [skiaFailed,  setSkiaFailed]  = useState(false);
  const [camReady,    setCamReady]    = useState(false);
  const frameCount = useRef(0);
  const device     = useCameraDevice(facing);

  // Android black screen fallback timer
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const timer = setTimeout(() => {
      if (frameCount.current === 0 && camReady) setSkiaFailed(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [camReady]);

  const detector = useFaceDetector
    ? useFaceDetector({ performanceMode: 'fast', landmarkMode: 'all' })
    : null;

  const updateLandmarks = Worklets?.createRunOnJS
    ? Worklets.createRunOnJS((faces: any[]) => {
        if (!faces.length) { setLandmarks(null); return; }
        const f = faces[0];
        setLandmarks({
          noseTipX: f.noseTipPosition?.x,
          noseTipY: f.noseTipPosition?.y,
          bounds: f.bounds ? {
            x: f.bounds.origin?.x ?? 0,
            y: f.bounds.origin?.y ?? 0,
            width: f.bounds.size?.width ?? 0,
            height: f.bounds.size?.height ?? 0,
          } : undefined,
        } as never);
      })
    : null;

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    frameCount.current++;
    if (detector && updateLandmarks && effect.type !== 'none' && effect.type !== 'float') {
      const faces = detector.detectFaces(frame);
      if (faces.length > 0) updateLandmarks(faces);
    }
  }, [effect.type]);

  if (!device) {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.err}>Camera not available</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        video
        audio
        frameProcessor={skiaFailed ? undefined : frameProcessor}
        onInitialized={() => setCamReady(true)}
        onError={() => setSkiaFailed(true)}
      />
      <AROverlay effect={effect} landmarks={landmarks} />
      {skiaFailed && effect.type !== 'none' && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>AR: Compatibility mode</Text>
        </View>
      )}
    </View>
  );
});

export default SkiaARCamera;

const styles = StyleSheet.create({
  container: { flex: 1 },
  err:       { color: '#FFF', textAlign: 'center', marginTop: 40 },
  badge:     { position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, padding: 4 },
  badgeText: { color: '#FFD700', fontSize: 10 },
}); 
