import { EffectDefinition } from "./types/EffectDefinition";

import auraGlow from "./effects/aura_glow";
import beatReactor from "./effects/beat_reactor";
import beatShake from "./effects/beat_shake";
import bigHead from "./effects/big_head";
import blinkFreeze from "./effects/blink_freeze";
import bokehLights from "./effects/bokeh_lights";
import cinematicGlow from "./effects/cinematic_glow";
import clapBurst from "./effects/clap_burst";
import colorDrain from "./effects/color_drain";
import demonEyes from "./effects/demon_eyes";
import depthBloom from "./effects/depth_bloom";
import doubleTake from "./effects/double_take";
import dropTransform from "./effects/drop_transform";
import duotonePulse from "./effects/duotone_pulse";
import eyeLaser from "./effects/eye_laser";
import faceExplosion from "./effects/face_explosion";
import faceMorph from "./effects/face_morph";
import fingerDraw from "./effects/finger_draw";
import fireBook from "./effects/fire_book";
import fistBumpBoom from "./effects/fist_bump_boom";
import flashCamera from "./effects/flash_camera";
import freezeTouch from "./effects/freeze_touch";
import gazeTrail from "./effects/gaze_trail";
import glitchWave from "./effects/glitch_wave";
import goldSkin from "./effects/gold_skin";
import goldenHour from "./effects/golden_hour";
import handPortal from "./effects/hand_portal";
import headTiltZoom from "./effects/head_tilt_zoom";
import inkWash from "./effects/ink_wash";
import lightLeak from "./effects/light_leak";
import lightningHands from "./effects/lightning_hands";
import liquidChrome from "./effects/liquid_chrome";
import moodRing from "./effects/mood_ring";
import mouthFire from "./effects/mouth_fire";
import mouthWords from "./effects/mouth_words";
import neonEdge from "./effects/neon_edge";
import paintSplash from "./effects/paint_splash";
import palmMagic from "./effects/palm_magic";
import particleFlow from "./effects/particle_flow";
import rainFall from "./effects/rain_fall";
import raiseEyebrow from "./effects/raise_eyebrow";
import retroVhs from "./effects/retro_vhs";
import richCamera from "./effects/rich_camera";
import rockPaperScissors from "./effects/rock_paper_scissors";
import silenceRipple from "./effects/silence_ripple";
import skinSmooth from "./effects/skin_smooth";
import smileShatter from "./effects/smile_shatter";
import snowFall from "./effects/snow_fall";
import spaceBackground from "./effects/space_background";
import spinEffect from "./effects/spin_effect";
import splitPrism from "./effects/split_prism";
import stickersReact from "./effects/stickers_react";
import superpower from "./effects/superpower";
import tapShockwave from "./effects/tap_shockwave";
import thermalPulse from "./effects/thermal_pulse";
import throwConfetti from "./effects/throw_confetti";
import tinyBody from "./effects/tiny_body";
import twoHandFrame from "./effects/two_hand_frame";
import vintageFlicker from "./effects/vintage_flicker";
import voiceHalo from "./effects/voice_halo";
import winkSpark from "./effects/wink_spark";

/**
 * The single source of truth for every effect that exists in the app.
 * All 61 effects from both galleries are now ported or built —
 * see README.md's "Full accounting" section for exactly which are exact
 * ports vs. new, and the two still-flagged fidelity notes (face_morph's
 * mesh-overlay texture, segmentation-mask auto-binding).
 *
 * Adding a new effect from here on:
 *   1. Write engine-ts/effects/<id>.ts (copy the closest-matching pattern).
 *   2. Add one import + one array entry below.
 *   3. Run `npm run compile-effects` (build/compile-manifest.ts).
 *   4. Ship the updated assets/effects.manifest.json — no native rebuild,
 *      unless the effect sets requiresSubsystem.
 */
export const EFFECTS: EffectDefinition[] = [
  auraGlow,
  beatReactor,
  beatShake,
  bigHead,
  blinkFreeze,
  bokehLights,
  cinematicGlow,
  clapBurst,
  colorDrain,
  demonEyes,
  depthBloom,
  doubleTake,
  dropTransform,
  duotonePulse,
  eyeLaser,
  faceExplosion,
  faceMorph,
  fingerDraw,
  fireBook,
  fistBumpBoom,
  flashCamera,
  freezeTouch,
  gazeTrail,
  glitchWave,
  goldSkin,
  goldenHour,
  handPortal,
  headTiltZoom,
  inkWash,
  lightLeak,
  lightningHands,
  liquidChrome,
  moodRing,
  mouthFire,
  mouthWords,
  neonEdge,
  paintSplash,
  palmMagic,
  particleFlow,
  rainFall,
  raiseEyebrow,
  retroVhs,
  richCamera,
  rockPaperScissors,
  silenceRipple,
  skinSmooth,
  smileShatter,
  snowFall,
  spaceBackground,
  spinEffect,
  splitPrism,
  stickersReact,
  superpower,
  tapShockwave,
  thermalPulse,
  throwConfetti,
  tinyBody,
  twoHandFrame,
  vintageFlicker,
  voiceHalo,
  winkSpark,
];
