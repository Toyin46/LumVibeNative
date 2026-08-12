// modules/video-baker/LiveEffectPreview.tsx
//
// JS-side wrapper for LiveEffectPreviewView (native Android view registered
// by LiveEffectPreviewModule.kt). Standard Expo Modules pattern for a custom
// native view — requireNativeViewManager + a typed prop interface — same
// approach bakeVideo() uses for the native function side of this module,
// just the view-component equivalent.
//
// I don't have your existing modules/video-baker/index.ts to see its exact
// export style, so this is a standalone file — if you already export bakeVideo
// from an index there, add `export { LiveEffectPreview } from './LiveEffectPreview'`
// to keep imports consistent (`import { bakeVideo, LiveEffectPreview } from
// '../../modules/video-baker'`), or just import this file directly, either works.

import { requireNativeViewManager } from 'expo-modules-core';
import React from 'react';
import { ViewStyle } from 'react-native';

export interface LiveEffectPreviewProps {
  // Same fx.id key used for FX_LIST / glShaderEffect at bake time, e.g.
  // "fx_gl_mood_ring" — passed straight through to VisualEffect.fromKey()
  // on the Kotlin side, so bake-time and live-preview effect identity is
  // guaranteed to match.
  effect?: string | null;
  facing?: 'front' | 'back';
  style?: ViewStyle;
}

const NativeView: React.ComponentType<LiveEffectPreviewProps> =
  requireNativeViewManager('LiveEffectPreview');

export function LiveEffectPreview(props: LiveEffectPreviewProps) {
  return <NativeView {...props} />;
} 
