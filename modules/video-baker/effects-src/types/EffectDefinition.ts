/**
 * The authoring contract for the LumVibe AR Engine.
 *
 * An effect is DATA: a shader + a declared mapping from named uniforms to
 * "signals" the native engine computes every frame (face tracking, hand
 * tracking, segmentation, audio, particles, time). Adding a new effect means
 * adding one file like the ones in ../effects/ and one line in registry.ts —
 * no native code, no rebuild of the app.
 *
 * This file is compiled (see build/compile-manifest.ts) into a JSON manifest
 * that ships as an app asset and is loaded by the native engine
 * (EffectEngine::loadManifest) at startup. TypeScript never runs on-device —
 * it's the AUTHORING language, not a runtime.
 */

// ---- Signal paths ----------------------------------------------------
// Every string here must have a matching case in
// EffectEngine::resolveSignal on the native side (see
// engine-native/src/EffectEngine.cpp). Keep this union and that switch in
// sync — this is the ONE place duplication is allowed to exist, because
// it's a fixed compile-time contract, not per-effect logic.
export type SignalPath =
  | "time.elapsed"
  | "time.delta"
  | "face.detected"
  | "face.smileScore"        // max(mouthSmileLeft, mouthSmileRight)
  | "face.browRaiseScore"    // max(browInnerUp, browOuterUpLeft, browOuterUpRight)
  | "face.jawOpen"
  | "face.winkScore"         // signed: + = left eye winked, - = right, 0 = neither
  | "face.boundingBox"       // vec4: minX,minY,maxX,maxY
  | "face.mouthCenter"       // vec2
  | "face.eyeCenter.left"    // vec2
  | "face.eyeCenter.right"   // vec2
  | "face.irisCenter"        // vec2
  | "face.irisCenter.left"   // vec2, centre of the image-left iris (eye laser anchor)
  | "face.irisCenter.right"  // vec2, centre of the image-right iris
  | "face.gazeDir"           // vec2, screen-space look direction (head + eyes), 0,0 = looking at camera
  | "face.eyeOpen"           // vec2, 0 closed .. 1 open (image-left eye, image-right eye)
  | "face.headPose.roll"
  | "face.headPose.pitch"
  | "face.headPose.yaw"
  | "face.yawDelta"          // frame-to-frame yaw change, drives DOUBLE_TAKE-style effects
  | "face.eyeBlinkBoth"      // both eyes closed this frame — drives BLINK_FREEZE
  | "face.yawDelta"          // frame-to-frame |yaw| change, normalized 0..1 — drives DOUBLE_TAKE
  | "face.gazeTrailPoints"   // vec2[8], rolling iris-position history, newest first
  | "face.gazeTrailAges"     // float[8], 0 = newest/brightest, 1 = oldest/gone, paired with gazeTrailPoints
  | "face.gazeTrailCount"    // how many of the 8 entries are valid this frame
  | "face.meshOverlayTexture" // CPU-drawn wireframe texture from real landmark positions — see README's Face Morph note
  | "hand.count"
  | "hand.0.detected"
  | "hand.0.palmCenter"
  | "hand.0.gesture"
  | "hand.0.angle"
  | "hand.0.throwVelocity"
  | "hand.0.angle"           // wrist→index-MCP angle in radians — drives FIRE_BOOK's hand-tilt
  | "hand.0.fingerTrailPoints" // vec2[16], rolling index-fingertip history, newest first
  | "hand.0.fingerTrailAges"   // float[16], 0 = newest/brightest, 1 = oldest/gone
  | "hand.0.fingerTrailCount"  // how many of the 16 entries are valid this frame
  | "hand.1.detected"
  | "hand.1.palmCenter"
  | "hand.1.gesture"
  | "segmentation.mask"      // texture handle
  | "audio.amplitude"        // 0..1, smoothed RMS
  | "audio.silenceScore"     // 1 - amplitude
  | "motion.magnitude"       // frame-to-frame luma delta, 0..1
  | "stillness.seconds"
  | "stillness.amount" // stillness.seconds normalized 0..1 (clamped at a fixed max hold time)
  | "body.detected"
  | "body.boundingBox" // vec4, from Pose Landmarker — see README's Pose tracker addition
  | "touch.active"
  | "touch.position"
  | "audio.beatDetected" // 0/1 impulse the frame a beat/onset is detected
  | "audio.beatEnergy"   // 0..1, current short-term energy vs rolling average
  | "audio.dropDetected" // 0/1, a sustained large energy jump (approximate "drop" detector)
  | `particles.${string}.positions`
  | `particles.${string}.rotations`
  | `particles.${string}.life`
  | `particles.${string}.colorIndex`
  | `particles.${string}.count`;

// ---- Particle systems ----------------------------------------------------
export interface ParticleSystemConfig {
  /** referenced as particles.<id>.* in bindings/triggers */
  id: string;
  /** matches ParticleSystem.kt's constructor param — positive falls, negative rises */
  gravity: number;
  /** default 24 — must match the native MAX_PARTICLES cap for the fixed-size uniform arrays */
  maxParticles?: number;
}

// ---- Triggers ----------------------------------------------------
// A small, DELIBERATELY non-Turing-complete rule grammar — enough to
// express every gesture/audio/blink-triggered behavior in the current
// ~40-effect catalog without needing an embedded JS VM. See
// EffectEngine::evaluateCondition for the supported grammar (equality
// comparisons, &&, and edge() for one-shot transitions) and
// EffectEngine::runAction for the supported action calls. If a future
// effect genuinely needs more than this can express, that's the signal to
// build the JS-VM escape hatch described in the README — not to grow this
// grammar into a second scripting language by accident.
export interface TriggerRule {
  /** e.g. "hand.0.gesture == 'fist' && edge(true)" */
  on: string;
  /** e.g. "particles.confetti.spawnBurst(origin=hand.0.palmCenter, count=24, speed=1.4, lifetime=1.2)" */
  action: string;
}

// ---- Static single-frame fallback ----------------------------------------------------
// For the ImageBaker (single-photo) path — signals that only exist as a
// temporal delta (audio amplitude, motion, stillness) have no honest value
// on a single photo. Mirrors EffectRequirements.applyStaticFrame's
// per-effect reasoning from the old Kotlin code, but as data read by one
// generic function instead of a fourth hand-written switch statement.
export type StaticFallback = Record<string, number | number[]>;

export type EngineSubsystem =
  | "meshWarp"        // per-pixel displacement driven by a face/body region mesh (Big Head, Tiny Body)
  | "worldTransform"  // background/scene replacement or style transfer (Cyberpunk City, Anime World)
  | "generative"      // an actual generative model, not a shader (Future Self, My Villain)
  | "beatDetection";  // onset/beat detection, not just amplitude (Beat Reactor, Beat Shake, Drop Transform)

export interface EffectDefinition {
  /** stable key — matches the existing VisualEffect.fromKey() strings, e.g. "mood_ring" */
  id: string;
  displayName: string;
  category: "trending" | "face" | "gesture" | "environment" | "beauty" | "world" | "music";
  requires: Array<"face" | "hand" | "segmentation" | "audio" | "body" | "touch">;
  /** omit to use the standard full-screen passthrough vertex shader */
  vertexShader?: string;
  fragmentShader: string;
  bindings: Record<string, SignalPath>;
  /**
   * Uniforms that are just fixed numbers/colors — no tracker, no per-frame
   * driver. Most "pure shader" effects have at least one of these (e.g. a
   * glow color, or uIntensity pinned at 1.0 for "always full strength").
   * Kept separate from `bindings` so the interpreter never has to guess
   * whether a uniform name is a literal or a signal path.
   */
  constants?: Record<string, number | number[]>;
  /** uniform name -> bundled texture asset path, e.g. HAND_PORTAL's scene image */
  assets?: Record<string, string>;
  particleSystems?: ParticleSystemConfig[];
  triggers?: TriggerRule[];
  staticFallback?: StaticFallback;
  /**
   * Set only for effects that need a native primitive beyond signal→uniform
   * and triggers. These can still be declared and shown in the UI catalog
   * as "coming soon" without a native crash — the engine just refuses to
   * select them until that subsystem exists. See README's effect-mapping
   * table for which of your ~65 requested effects need which subsystem.
   */
  requiresSubsystem?: EngineSubsystem;
}

export function defineEffect(def: EffectDefinition): EffectDefinition {
  return def;
}
