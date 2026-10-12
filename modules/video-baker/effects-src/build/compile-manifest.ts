import { writeFileSync, mkdirSync } from "fs";
import { EFFECTS } from "../registry";

/**
 * Compiles every EffectDefinition into a single JSON manifest, bundled as
 * an app asset and loaded by EffectEngine::loadManifest() at startup. This
 * is the ENTIRE "TypeScript compiles to something native reads" bridge —
 * there is no JS VM at runtime, just this one build step. That's what
 * makes "write effects in TS, ship without a native rebuild" true: the
 * manifest is just data, and the native interpreter already knows how to
 * read every field in it.
 *
 * Run: npx ts-node engine-ts/build/compile-manifest.ts
 */
mkdirSync("assets", { recursive: true });

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  effects: EFFECTS,
};

writeFileSync("assets/effects.manifest.json", JSON.stringify(manifest, null, 2));
console.log(`Compiled ${EFFECTS.length} effects -> assets/effects.manifest.json`);
