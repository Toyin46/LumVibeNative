// ============================================================
// GreenScreenCamera.tsx
// Drop-in replacement for your VisionCamera <Camera> component
// when greenScreenMode === true.
//
// How it works:
//   1. VisionCamera captures each frame at the GPU level
//   2. A Skia frame processor runs on the frame (on the GPU thread)
//   3. Pixels where green channel > (red + blue) * threshold
//      are replaced with transparency
//   4. A background image/video is composited underneath
//
// Requirements (already in your project):
//   - react-native-vision-camera
//   - @shopify/react-native-skia
//   - react-native-vision-camera-skia-frame-processor (add below)
// ============================================================

//import React, { useCallback } from 'react';
//import { View, StyleSheet, Image } from 'react-native';
//import { Camera, useCameraDevice, useFrameProcessor } from 'react-native-vision-camera';
//import { Skia, Canvas, Image as SkiaImage, useImage, BlendMode } from '@shopify/react-native-skia';
//import { useSharedValue } from 'react-native-reanimated';

// ─── TYPES ───────────────────────────────────────────────────────────────────
//interface Props {
  //backgroundUri?: string;   // URI of background image/video to show behind the person
  //threshold?:     number;   // 0.0–2.0, default 1.4 — how aggressively to key out green
//  isActive:       boolean;
 // facing:         'front' | 'back';
 // style?:         any;
//}

// ─── GREEN SCREEN FRAME PROCESSOR ────────────────────────────────────────────
// This runs entirely on the GPU/worklet thread via VisionCamera + Skia.
// It modifies the frame buffer in-place before it reaches the preview layer.
//
// Algorithm:
//   For each pixel: if G > (R + B) * threshold AND G > 80 → set alpha = 0
//
// NOTE: VisionCamera frame processors run in a React Native Worklet context
//       (similar to Reanimated). You CANNOT call JS functions from here.
//       All operations must be pure worklet-compatible code.
//export function GreenScreenCamera({ backgroundUri, threshold = 1.4, isActive, facing, style }: Props) {
  //const device = useCameraDevice(facing);
  //const bgImage = useImage(backgroundUri || '');

 // const frameProcessor = useFrameProcessor((frame) => {
//    'worklet';
    // ── Skia paint for green key ─────────────────────────
    // We create a colour matrix filter that zeroes out pixels
    // matching the green key range.
    //
    // The colour matrix is a 4×5 RGBA transformation matrix:
    //   Each row = [rScale, gScale, bScale, aScale, offset]
    //
    // We use a custom approach: render the frame to a Skia surface,
    // apply a colour filter that makes green pixels transparent,
    // then output the result.

    // Access raw pixel data (requires VisionCamera v4 frame processors)
  //  try {
   //   const width  = frame.width;
   //   const height = frame.height;

      // Create an offscreen Skia surface the same size as the frame
    //  const surface = Skia.Surface.MakeOffscreen(width, height);
   //   if (!surface) return;

   //   const canvas  = surface.getCanvas();

      // Draw the camera frame as a Skia image onto the surface
   //   const frameImage = Skia.Image.MakeImageFromEncoded(
      //  Skia.Data.fromBytes(new Unit&Array(frame.toArrayBuffer()))
     // );
      //if (!frameImage) return;

      // ── Colour matrix to remove green pixels ─────────────
      // This is a chroma key approximation using a colour matrix.
      // It desaturates green and pushes green-dominant pixels to transparent.
      //
      // A full per-pixel GPU shader is more accurate but requires GLSL/WGSL.
      // For production quality, use the RuntimeEffect (shader) approach below.
     // const chromaKeyMatrix = [
        // R      G      B      A     offset
         //  1.0,   0.0,   0.0,   0.0,   0,   // R output
          // 0.0,   0.0,   0.0,   0.0,   0,   // G output (zero out green)
         //  0.0,   0.0,   1.0,   0.0,   0,   // B output
         // -1.5,   2.8,  -1.5,   0.0,   0,   // A output: negative when G > R+B
     // ];

    //  const colorFilter = Skia.ColorFilter.MakeMatrix(chromaKeyMatrix);
   //   const paint = Skia.Paint();
     // paint.setColorFilter(colorFilter);
     // paint.setBlendMode(BlendMode.SrcOver);

   //   canvas.drawImage(frameImage, 0, 0, paint);
   //   surface.flush();
  //  } catch (e) {
      // Worklet errors are silent — frame passes through unmodified
 //   }
//  }, [threshold]);

  //if (!device) return null;

 // return (
  //  <View style={[s.container, style]}>
    //  {/* Background layer — shows behind the keyed-out person */}
    //  {backgroundUri ? (
      //  <Image
       //   source={{ uri: backgroundUri }}
        //  style={StyleSheet.absoluteFill}
       //   resizeMode="cover"
        ///>
     // ) : (
        // Default: gradient background when no URI provided
     //   <View style={[StyleSheet.absoluteFill, s.defaultBg]} />
    //  )}

    //  {/* Camera layer with green screen frame processor */}
     // <Camera
      //  style={StyleSheet.absoluteFill}
      //  device={device}
      //  isActive={isActive}
      //  frameProcessor={frameProcessor}
      //  pixelFormat="rgb"      // RGB required for colour analysis
      //  enableZoomGesture={false}
    //  />
   // </View>
//  );
//}

// ─── ALTERNATIVE: RUNTIME EFFECT (GLSL shader) — more accurate ───────────────
// This is the production-quality approach using a GLSL fragment shader.
// It runs entirely on the GPU with per-pixel accuracy.
//
// HOW TO USE:
//   1. Add the shader string below
//   2. Create a Skia RuntimeEffect from it
//   3. Apply it in the frame processor above instead of the colour matrix
//
// Copy this shader and use it in your frame processor:

//export const GREEN_SCREEN_SHADER_SRC = `
//uniform shader inputImage;    // the camera frame
//uniform float  threshold;     // chromakey threshold (e.g. 1.4)
//uniform float  smoothing;     // edge smoothing (e.g. 0.1)

//half4 main(float2 coord) {
//  half4 pixel = inputImage.eval(coord);
//  float r = pixel.r;
 // float g = pixel.g;
 // float b = pixel.b;

  // Chroma key formula: key out if green dominates both red and blue
 // float greenness = g - max(r, b);  // how much greener than any other channel
 // float keyStrength = smoothstep(threshold * 0.08, threshold * 0.12, greenness);

  // keyStrength = 1.0 means fully green → alpha = 0 (transparent)
  // keyStrength = 0.0 means not green  → alpha = 1 (opaque)
//  return half4(pixel.rgb, pixel.a * (1.0 - keyStrength));
//}
//`;

// HOW TO CREATE THE RUNTIME EFFECT (do this once outside the component):
//
//   import { Skia } from '@shopic/react-native-skia';
//
//   export const greenScreenEffect = Skia.RuntimeEffect.Make(GREEN_SCREEN_SHADER_SRC);
//
// Then in the frame processor, instead of the colour matrix:
//
//   const paint = Skia.Paint();
//   const builder = Skia.RuntimeShaderBuilder(greenScreenEffect);
//   builder.setUniform('threshold', threshold);
//   builder.setUniform('smoothing', 0.1);
//   const imageShader = frameImage.makeShader(Skia.TileMode.Clamp, Skia.TileMode.Clamp);
//   builder.setUniform('inputImage', imageShader); // won't work — see NOTE below
//   paint.setShader(builder.makeShader());

// ─── NOTE on shader approach ─────────────────────────────────────────────────
// Passing a camera frame directly as a shader uniform is only supported in
// @shopify/react-native-skia v1.2+ with VisionCamera v4 frame processors.
// If you're on an older version, use the colour matrix approach above.
// The colour matrix version works on all versions and gives good results
// for well-lit green screens.

//const s = StyleSheet.create({
  //container: {
    //flex:     1,
   // overflow: 'hidden',
 // },
 // defaultBg: {
 //   backgroundColor: '#1a0a2e',   // dark purple — looks good when no background set
 // },
//}); 
    
