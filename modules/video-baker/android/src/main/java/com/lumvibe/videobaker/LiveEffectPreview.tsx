// modules/video-baker/LiveEffectPreview.tsx
//
// JS-side wrapper for LiveEffectPreviewView (native Android view registered
// by LiveEffectPreviewModule.kt). Standard Expo Modules pattern for a custom
// native view - requireNativeViewManager + a typed prop interface - same
// approach bakeVideo() uses for the native function side of this module,
// just the view-component equivalent.
//
// FIX (live-effect recording): now forwards a ref so create.tsx can call
// startRecording()/stopRecording() imperatively, the same way a <Video> or
// <TextInput> ref exposes imperative methods. Internally this calls the
// startLiveRecording/stopLiveRecording module functions (see
// LiveEffectPreviewModule.kt) with this view's own React node handle - the
// same requireNativeModule("...") pattern index.ts already uses for
// bakeVideo(), just resolving which VIEW instance to act on via
// findNodeHandle, which is the long-established, stable way to do this
// (deliberately NOT relying on newer Expo "View Function" ref-forwarding
// syntax, which I couldn't verify with certainty for this project's exact
// Expo SDK version - see LiveEffectPreviewModule.kt's own note on this).

import { requireNativeViewManager, requireNativeModule } from 'expo-modules-core';
import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';
import { findNodeHandle, ViewStyle } from 'react-native';

export interface LiveEffectPreviewProps {
  // Same fx.id key used for FX_LIST / glShaderEffect at bake time, e.g.
  // "fx_gl_mood_ring" - passed straight through to VisualEffect.fromKey()
  // on the Kotlin side, so bake-time and live-preview effect identity is
  // guaranteed to match.
  effect?: string | null;
  facing?: 'front' | 'back';
  style?: ViewStyle;
  /**
   * Path to the downloaded/cached fire_loop.mp4 (from ensureFireVideoCached()
   * in fireVideoCache.ts). Only matters for MOUTH_FIRE/FIRE_BOOK — every
   * other effect ignores it entirely. Leave undefined/null until the caller
   * has actually resolved a real cached path; the native side falls back to
   * procedural flame only when this is null, which is the correct behavior
   * while a first-time download is still in flight (see create.tsx's
   * effect-selection handler for the recommended sequencing: resolve this
   * BEFORE setting `effect` to a fire effect, so the user never sees one
   * frame rendered without it).
   */
  fireVideoPath?: string | null;
  /**
   * NEW - Two Hand Frame's gesture auto-capture. Fires once when the user
   * holds both hands in the frame shape for ~1.2s (see LiveEffectPreviewView.kt's
   * frameHoldRequiredSec). filePath is a JPEG already written to disk at that
   * path - nothing further needed on the native side, just read/move/upload
   * it from here. Only relevant while the TWO_HAND_FRAME effect is selected;
   * won't fire for any other effect.
   */
  onFrameCaptured?: (filePath: string) => void;
}

export interface LiveEffectPreviewHandle {
  /**
   * Starts recording the live effect to an actual video file.
   * videoOnlyPath/pcmPath are temp working files (caller picks the paths,
   * e.g. via expo-file-system's cacheDirectory) - videoOnlyPath ends up
   * holding a silent video during recording, pcmPath holds raw captured
   * audio; both get combined and deleted automatically once stopRecording()
   * finishes. Neither should already exist when this is called.
   */
  startRecording: (videoOnlyPath: string, pcmPath: string) => Promise<void>;
  /**
   * Stops recording and finalizes the real, playable output file at
   * finalOutputPath. Resolves once ready - this can take a brief moment
   * after the recording itself stops (see LiveRecorder.kt's
   * finalizeRecording() docs for why), so callers should show a short
   * "processing" state rather than assume it's instant.
   *
   * ✅ DIAGNOSTIC: resolves with {path, audioStatus} rather than a bare path
   * string. audioStatus is a human-readable string from LiveRecorder.kt
   * describing exactly what happened with audio on this recording (e.g.
   * "ok: audio muxed into final file" or a specific "no audio: ..." reason).
   * Log/inspect this after every recording instead of guessing why a video
   * came out silent - see create.tsx's handleStopRecording.
   */
  stopRecording: (finalOutputPath: string) => Promise<{ path: string; audioStatus: string }>;
  /**
   * Captures a single photo from the live effect pipeline (already
   * composited with whatever GL effect is active) to outputPath. Fixes
   * create.tsx's real Photo-mode bug: it always called
   * cameraRef.current.takePhoto(), but the regular Camera component isn't
   * even mounted while a GL effect is active (LiveEffectPreview replaces
   * it), so that call silently no-op'd on its own null-check.
   */
  capturePhoto: (outputPath: string) => Promise<void>;
}

const NativeView: React.ComponentType<LiveEffectPreviewProps & { ref?: React.Ref<any> }> =
  requireNativeViewManager('LiveEffectPreview');

const NativeLiveEffectPreviewModule = requireNativeModule('LiveEffectPreview');

export const LiveEffectPreview = forwardRef<LiveEffectPreviewHandle, LiveEffectPreviewProps>(
  (props, ref) => {
    const { onFrameCaptured, ...nativeProps } = props;
    const nativeRef = useRef<any>(null);

    useImperativeHandle(ref, () => ({
      startRecording: async (videoOnlyPath: string, pcmPath: string) => {
        const tag = findNodeHandle(nativeRef.current);
        if (tag == null) {
          throw new Error('LiveEffectPreview: could not resolve native view tag - is the view mounted?');
        }
        await NativeLiveEffectPreviewModule.startLiveRecording(tag, videoOnlyPath, pcmPath);
      },
      stopRecording: async (finalOutputPath: string) => {
        const tag = findNodeHandle(nativeRef.current);
        if (tag == null) {
          throw new Error('LiveEffectPreview: could not resolve native view tag - is the view mounted?');
        }
        const result: { path: string; audioStatus: string } = await NativeLiveEffectPreviewModule.stopLiveRecording(tag, finalOutputPath);
        return result;
      },
      capturePhoto: async (outputPath: string) => {
        const tag = findNodeHandle(nativeRef.current);
        if (tag == null) {
          throw new Error('LiveEffectPreview: could not resolve native view tag - is the view mounted?');
        }
        await NativeLiveEffectPreviewModule.captureLivePhoto(tag, outputPath);
      },
    }), []);

    // FIX: originally wired as a per-view prop event (event.nativeEvent.path),
    // matching the native side's original EventDispatcher approach - but that
    // required LiveEffectPreviewView to extend ExpoView, which it doesn't
    // (confirmed against Expo's own docs, not assumed), so it was switched to
    // sendEvent() on the native side instead. sendEvent() is a MODULE-level
    // event, not a view-level one, so this needs to be a module event
    // subscription (addListener/removeListeners - the standard Expo Modules
    // EventEmitter pattern, automatically available on any module that
    // declares Events(...) at its top level) instead of a view prop.
    // CAVEAT: being module-level, not view-level, this fires for ANY mounted
    // LiveEffectPreview instance, not specifically this one - fine for your
    // single live-camera-screen use case, but worth knowing if you ever
    // render more than one of these at once.
    useEffect(() => {
      if (!onFrameCaptured) return;
      const subscription = NativeLiveEffectPreviewModule.addListener(
        'onFrameCaptured',
        (event: { path: string }) => onFrameCaptured(event.path)
      );
      return () => subscription.remove();
    }, [onFrameCaptured]);

    return <NativeView {...nativeProps} ref={nativeRef} />;
  }
); 
