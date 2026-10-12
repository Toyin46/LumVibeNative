# What changed in this merge

Real integration of the LumVibe cross-platform engine into your actual
module — not a separate zip to merge by hand anymore.

## Fixed, not just added
- `index.ts` (the one that's actually imported — `requireNativeModule`
  lives here): `VisualEffectKey` had drifted to only 5 of 61 real effect
  IDs. Regenerated from `effects-src/assets/effects.manifest.json`
  (the real compiled output, all 61). Also recovered `bakeImage`/
  `ImageBakerOptions`/`portalScenePngPath`/`fireVideoPath` from a stray
  duplicate of this file that had ended up inside
  `android/src/main/java/.../index.ts` — a path Gradle never compiles
  (that's a Kotlin source root), so those real improvements were dead
  weight until now. That duplicate file is deleted; everything useful in
  it is merged into the real `index.ts`.
- `LumVibeEngineBridge.kt`: rewritten against your REAL `FaceTracker.kt`/
  `HandTracker.kt` (read directly from this upload) — they return raw
  `FaceLandmarkerResult`/`HandLandmarkerResult` plus helper functions
  (`blendshapeScore`, `headPoseDegrees`, `classifyGesture`, `palmCenter`,
  etc.), not the clean `Result` data classes I'd guessed before I could
  see this file. Also added real eye-center marshalling (was silently
  missing — would have broken `wink_spark`/`demon_eyes`) and wired
  `face_morph` to your existing `FaceMeshRenderer.buildMeshBitmap()` —
  that file already exists in your project and does exactly what
  `face_morph` needs; this was the "flagged gap" from earlier passes,
  now closed using your own real code.
- `build.gradle`: added the `externalNativeBuild` block. Nothing else in
  it changed.
- `expo-module.config.json`: added the `ios` platform entry alongside
  your existing `android` one.

## Added
- `android/src/main/cpp/` — the C++ engine + JNI bridge.
- `android/src/main/java/.../AR/PoseTracker.kt` — the one tracker you
  didn't have yet (needed for `tiny_body`).
- `android/src/main/assets/effects.manifest.json` — real compiled output,
  all 61 effects, sitting next to your existing `.task`/`.tflite` files.
- `ios/` — entire new platform (podspec, Swift, Metal, C++) — see the
  main engine README's iOS section for what's compiled/tested vs. not.
- `effects-src/` — the TypeScript authoring layer. Add new effects here.

## Compiled and tested before this merge
All 61 effects, C++ engine core, Android JNI bridge, and the real
`index.ts`/`effects-src` TypeScript all compiled/type-checked/ran clean
in this pass — see the engine README's "Compiled and tested" section for
exactly what that covers. iOS code is real but unverified (no Apple
toolchain available to test against).

## Your watermark baking: untouched
`WatermarkBounce.kt`, `OverlayBuilder.kt`, `VideoTranscoder.kt`,
`ImageBaker.kt` — none of these were opened or edited. The new engine
lives alongside them; wiring `LumVibeEngineBridge` into `VideoTranscoder`
to actually replace `FrameRenderer` is a future step, not done here.
