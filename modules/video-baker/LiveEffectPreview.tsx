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
   * finalOutputPath. Resolves with the actual final path once ready - this
   * can take a brief moment after the recording itself stops (see
   * LiveRecorder.kt's finalizeRecording() docs for why), so callers should
   * show a short "processing" state rather than assume it's instant.
   */
  stopRecording: (finalOutputPath: string) => Promise<string>;
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
        const resultPath: string = await NativeLiveEffectPreviewModule.stopLiveRecording(tag, finalOutputPath);
        return resultPath;
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
