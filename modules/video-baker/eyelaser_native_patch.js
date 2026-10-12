#!/usr/bin/env node
/* LumVibe — EYE LASER v2, REACT NATIVE MODULE patch (Android + shared C++ + effect source)
 * Usage:  node eyelaser_native_patch.js path/to/modules/video-baker
 * Edits files in place, saves a .bak next to each one first. Safe to run twice.
 * After it runs you need a NATIVE REBUILD (the C++/Kotlin changed).
 */
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';
const ENTRY = {"id": "eye_laser", "displayName": "Eye Laser", "category": "face", "requires": ["face"], "fragmentShader": "#extension GL_OES_EGL_image_external : require\nprecision mediump float;\n#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#endif\n\nvarying vec2 vTexCoord;\nuniform samplerExternalOES uTexture;\nuniform vec2 uTexelSize;\nuniform vec2 uIrisLeft;\nuniform vec2 uIrisRight;\nuniform vec2 uGaze;\nuniform vec2 uEyeOpen;\nuniform vec4 uFaceBox;\nuniform vec2 uGazeSign;\nuniform float uPower;\nuniform float uTimeSec;\n\nvec3 laserEye(vec2 p, vec2 o, vec2 g, vec2 splay, float open, float faceW) {\n  if (open < 0.01) return vec3(0.0);\n  vec2 d = g + splay;\n  d = d / max(length(d), 0.0001);\n  vec2 q = p - o;\n  float along = dot(q, d);\n  float perp = abs(q.x * d.y - q.y * d.x);\n  float r = length(q);\n  float t = max(along, 0.0) / faceW;\n\n  float w = faceW * (0.011 + 0.007 * min(t, 3.0));\n  float x = perp / w;\n  float core = exp(-x * x);\n  float glow = exp(-x * x / 16.0);\n  float halo = exp(-x * x / 140.0);\n  float start = smoothstep(-0.01 * faceW, 0.04 * faceW, along);\n  float decay = 1.0 / (1.0 + 0.22 * t);\n  float flick = 0.95 + 0.05 * sin(uTimeSec * 50.0 + t * 9.0);\n  vec3 beam = (vec3(1.0, 0.93, 0.86) * core * 1.7\n             + vec3(1.0, 0.11, 0.05) * glow * 1.15\n             + vec3(1.0, 0.05, 0.02) * halo * 0.40) * start * decay * flick;\n\n  float e1 = r / (faceW * 0.030);\n  float e2 = r / (faceW * 0.075);\n  float e3 = r / (faceW * 0.22);\n  float streak = exp(-(q.y * q.y) / (faceW * faceW * 0.00022)) * exp(-abs(q.x) / (faceW * 0.16));\n  vec3 eye = vec3(1.0, 0.88, 0.78) * exp(-e1 * e1) * 2.0\n           + vec3(1.0, 0.13, 0.05) * exp(-e2 * e2) * 1.3\n           + vec3(1.0, 0.06, 0.03) * exp(-e3 * e3) * 0.28\n           + vec3(1.0, 0.20, 0.12) * streak * 0.55;\n\n  return (beam + eye) * open;\n}\n\nvoid main() {\n  vec4 base = texture2D(uTexture, vTexCoord);\n  float aspect = uTexelSize.y / uTexelSize.x;\n  vec2 A = vec2(aspect, 1.0);\n  vec2 p = vTexCoord * A;\n  float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);\n  vec2 g = uGaze * uGazeSign;\n  vec3 add = laserEye(p, uIrisLeft * A, g, vec2(-0.10, 0.16), uEyeOpen.x, faceW)\n           + laserEye(p, uIrisRight * A, g, vec2(0.10, 0.16), uEyeOpen.y, faceW);\n  add = 1.0 - exp(-add * uPower);\n  vec3 outc = 1.0 - (1.0 - base.rgb) * (1.0 - add);\n  gl_FragColor = vec4(outc, base.a);\n}\n", "bindings": {"uIrisLeft": "face.irisCenter.left", "uIrisRight": "face.irisCenter.right", "uGaze": "face.gazeDir", "uEyeOpen": "face.eyeOpen", "uFaceBox": "face.boundingBox", "uTimeSec": "time.elapsed"}, "constants": {"uGazeSign": [1.0, 1.0], "uPower": 1.0}};
const TS_SOURCE = "import { defineEffect } from \"../types/EffectDefinition\";\nimport { EXT_HEADER } from \"../shaders/common\";\n\n// Eye Laser v2 - glowing eyes + white-hot beams that follow where you look.\n// Anchored to the IRIS (not the eyelid), direction = head direction + eye\n// direction, each eye fades out on its own blink. Needs the 4 new face\n// signals: face.irisCenter.left/right, face.gazeDir, face.eyeOpen.\n//\n// TUNING (no rebuild, just edit constants and recompile the manifest):\n//   uGazeSign [x, y]: flip to [-1, 1] / [1, -1] if beams point the wrong way\n//   uPower: overall brightness (1.0 normal, 1.4 brighter)\nexport default defineEffect({\n  id: \"eye_laser\",\n  displayName: \"Eye Laser\",\n  category: \"face\",\n  requires: [\"face\"],\n  fragmentShader:\n    EXT_HEADER +\n    `\n    #ifdef GL_FRAGMENT_PRECISION_HIGH\n    precision highp float;\n    #endif\n    varying vec2 vTexCoord;\n    uniform samplerExternalOES uTexture;\n    uniform vec2 uTexelSize;\n    uniform vec2 uIrisLeft;\n    uniform vec2 uIrisRight;\n    uniform vec2 uGaze;\n    uniform vec2 uEyeOpen;\n    uniform vec4 uFaceBox;\n    uniform vec2 uGazeSign;\n    uniform float uPower;\n    uniform float uTimeSec;\n\n    vec3 laserEye(vec2 p, vec2 o, vec2 g, vec2 splay, float open, float faceW) {\n      if (open < 0.01) return vec3(0.0);\n      vec2 d = g + splay;\n      d = d / max(length(d), 0.0001);\n      vec2 q = p - o;\n      float along = dot(q, d);\n      float perp = abs(q.x * d.y - q.y * d.x);\n      float r = length(q);\n      float t = max(along, 0.0) / faceW;\n\n      float w = faceW * (0.011 + 0.007 * min(t, 3.0));\n      float x = perp / w;\n      float core = exp(-x * x);\n      float glow = exp(-x * x / 16.0);\n      float halo = exp(-x * x / 140.0);\n      float start = smoothstep(-0.01 * faceW, 0.04 * faceW, along);\n      float decay = 1.0 / (1.0 + 0.22 * t);\n      float flick = 0.95 + 0.05 * sin(uTimeSec * 50.0 + t * 9.0);\n      vec3 beam = (vec3(1.0, 0.93, 0.86) * core * 1.7\n                 + vec3(1.0, 0.11, 0.05) * glow * 1.15\n                 + vec3(1.0, 0.05, 0.02) * halo * 0.40) * start * decay * flick;\n\n      float e1 = r / (faceW * 0.030);\n      float e2 = r / (faceW * 0.075);\n      float e3 = r / (faceW * 0.22);\n      float streak = exp(-(q.y * q.y) / (faceW * faceW * 0.00022)) * exp(-abs(q.x) / (faceW * 0.16));\n      vec3 eye = vec3(1.0, 0.88, 0.78) * exp(-e1 * e1) * 2.0\n               + vec3(1.0, 0.13, 0.05) * exp(-e2 * e2) * 1.3\n               + vec3(1.0, 0.06, 0.03) * exp(-e3 * e3) * 0.28\n               + vec3(1.0, 0.20, 0.12) * streak * 0.55;\n\n      return (beam + eye) * open;\n    }\n\n    void main() {\n      vec4 base = texture2D(uTexture, vTexCoord);\n      float aspect = uTexelSize.y / uTexelSize.x;\n      vec2 A = vec2(aspect, 1.0);\n      vec2 p = vTexCoord * A;\n      float faceW = max((uFaceBox.z - uFaceBox.x) * aspect, 0.05);\n      vec2 g = uGaze * uGazeSign;\n      vec3 add = laserEye(p, uIrisLeft * A, g, vec2(-0.10, 0.16), uEyeOpen.x, faceW)\n               + laserEye(p, uIrisRight * A, g, vec2(0.10, 0.16), uEyeOpen.y, faceW);\n      add = 1.0 - exp(-add * uPower);\n      vec3 outc = 1.0 - (1.0 - base.rgb) * (1.0 - add);\n      gl_FragColor = vec4(outc, base.a);\n    }\n  `,\n  bindings: {\n    uIrisLeft: \"face.irisCenter.left\",\n    uIrisRight: \"face.irisCenter.right\",\n    uGaze: \"face.gazeDir\",\n    uEyeOpen: \"face.eyeOpen\",\n    uFaceBox: \"face.boundingBox\",\n    uTimeSec: \"time.elapsed\",\n  },\n  constants: { uGazeSign: [1.0, 1.0], uPower: 1.0 },\n});\n";
const P = (...a) => path.join(root, ...a);
const KT = P('android/src/main/java/com/lumvibe/videobaker');

function patch(file, marker, steps) {
  if (!fs.existsSync(file)) { console.error('STOP: missing file ' + file); process.exit(1); }
  let s = fs.readFileSync(file, 'utf8');
  if (s.includes(marker)) { console.log('already patched: ' + path.relative(root, file)); return; }
  const eol = s.includes('\r\n') ? '\r\n' : '\n';
  const fix = t => t.replace(/\r?\n/g, eol);
  for (const [label, find, repl] of steps) {
    const n = s.split(find).length - 1;
    if (n !== 1) { console.error('STOP: ' + path.relative(root, file) + ' — "' + label + '" matched ' + n + ' times (expected 1). File differs from the one I saw; nothing written for this file.'); process.exit(1); }
    s = s.replace(find, () => fix(repl));
  }
  fs.writeFileSync(file + '.bak', fs.readFileSync(file));
  fs.writeFileSync(file, s);
  console.log('patched: ' + path.relative(root, file));
}

// 1) the effect itself (TypeScript source) ------------------------------------
{
  const f = P('effects-src/effects/eye_laser.ts');
  if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes('Eye Laser v2')) console.log('already patched: effects-src/effects/eye_laser.ts');
  else { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); fs.writeFileSync(f, TS_SOURCE); console.log('written: effects-src/effects/eye_laser.ts'); }
}

// 2) allowed signal names (TypeScript type) ------------------------------------
patch(P('effects-src/types/EffectDefinition.ts'), '"face.gazeDir"', [
  ['signal names', '| "face.irisCenter"        // vec2',
`| "face.irisCenter"        // vec2
  | "face.irisCenter.left"   // vec2, centre of the image-left iris (eye laser anchor)
  | "face.irisCenter.right"  // vec2, centre of the image-right iris
  | "face.gazeDir"           // vec2, screen-space look direction (head + eyes), 0,0 = looking at camera
  | "face.eyeOpen"           // vec2, 0 closed .. 1 open (image-left eye, image-right eye)`],
]);

// 3) compiled manifests (both copies) ------------------------------------------
for (const f of [P('effects-src/assets/effects.manifest.json'), P('android/src/main/assets/effects.manifest.json')]) {
  if (!fs.existsSync(f)) { console.log('skip (not found): ' + path.relative(root, f)); continue; }
  const raw = fs.readFileSync(f, 'utf8'), mf = JSON.parse(raw);
  const i = mf.effects.findIndex(e => e.id === 'eye_laser');
  if (i < 0) { console.error('STOP: no eye_laser in ' + f); process.exit(1); }
  if (mf.effects[i].bindings && mf.effects[i].bindings.uGaze) { console.log('already patched: ' + path.relative(root, f)); continue; }
  fs.writeFileSync(f + '.bak', raw); mf.effects[i] = ENTRY; fs.writeFileSync(f, JSON.stringify(mf, null, 2));
  console.log('patched: ' + path.relative(root, f));
}

// 4) shared C++ (Android + iOS copies are identical) ---------------------------
for (const inc of ['android/src/main/cpp/include/lumvibe/Signals.h', 'ios/include/lumvibe/Signals.h'])
  patch(P(inc), 'Vec2 gazeDir', [
    ['face struct', 'Vec2 irisCenter{0.5f, 0.4f};',
`Vec2 irisCenter{0.5f, 0.4f};
    Vec2 irisLeft{0.4f, 0.4f};   // eye laser: image-left iris centre
    Vec2 irisRight{0.6f, 0.4f};  // eye laser: image-right iris centre
    Vec2 gazeDir{0.f, 0.f};      // eye laser: screen-space look direction (head + eyes)
    Vec2 eyeOpen{0.f, 0.f};      // eye laser: 0 closed .. 1 open, per eye (image-left, image-right)`],
  ]);
for (const cpp of ['android/src/main/cpp/src/EffectEngine.cpp', 'ios/src/EffectEngine.cpp'])
  patch(P(cpp), 'face.gazeDir', [
    ['signal resolve', 'if (path == "face.irisCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisCenter; return r; }',
`if (path == "face.irisCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisCenter; return r; }
    if (path == "face.irisCenter.left") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisLeft; return r; }
    if (path == "face.irisCenter.right") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisRight; return r; }
    if (path == "face.gazeDir") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.gazeDir; return r; }
    if (path == "face.eyeOpen") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.eyeOpen; return r; }`],
  ]);
patch(P('android/src/main/cpp/src/jni_bridge.cpp'), 'face.gazeDir', [
  ['read face array', 'signals.face.eyeCenterRight = {face[18], face[19]};',
`signals.face.eyeCenterRight = {face[18], face[19]};
    if (env->GetArrayLength(faceSignal) >= 28) {   // eye laser extras (indices 20..27)
        signals.face.irisLeft = {face[20], face[21]};
        signals.face.irisRight = {face[22], face[23]};
        signals.face.gazeDir = {face[24], face[25]};   // face.gazeDir
        signals.face.eyeOpen = {face[26], face[27]};
    }`],
]);

// 5) Kotlin ---------------------------------------------------------------------
patch(path.join(KT, 'AR/FaceTracker.kt'), 'fun eyeLaserSignals', [
  ['remember frame shape', 'val mpImage = BitmapImageBuilder(bitmap).build()',
`frameAspect = bitmap.width.toFloat() / bitmap.height.toFloat()
        val mpImage = BitmapImageBuilder(bitmap).build()`],
  ['new helper', "/** Call once when done baking — releases the model's native resources. */",
`// ── EYE LASER support (same maths as the website's calc.face) ───────────────
    /** width / height of the last frame given to detect(); keeps x and y distances comparable. */
    @Volatile var frameAspect: Float = 0.5625f

    private class OneEuro(private val minCut: Float, private val beta: Float) {
        private var x = 0f; private var dx = 0f; private var t = 0L; private var ready = false
        private fun alpha(cut: Float, dt: Float) = 1f / (1f + (1f / (2f * Math.PI.toFloat() * cut)) / dt)
        fun filter(v: Float, tMs: Long): Float {
            if (!ready) { x = v; dx = 0f; t = tMs; ready = true; return v }
            val dt = maxOf((tMs - t) / 1000f, 0.001f); t = tMs
            dx += alpha(1f, dt) * ((v - x) / dt - dx)
            x += alpha(minCut + beta * kotlin.math.abs(dx), dt) * (v - x)
            return x
        }
    }
    private val gazeFilterX = OneEuro(1.2f, 3f)
    private val gazeFilterY = OneEuro(1.2f, 3f)
    private var openLeft = -1f
    private var openRight = -1f

    /**
     * [irisLeftX, irisLeftY, irisRightX, irisRightY, gazeX, gazeY, openLeft, openRight].
     * "Left" = image-left (the user's right eye). gaze = head direction + eye direction,
     * x right / y down, ~0 when looking at the camera. null = no iris landmarks in this result.
     */
    fun eyeLaserSignals(result: FaceLandmarkerResult, nowMs: Long): FloatArray? {
        val lm = result.faceLandmarks().firstOrNull() ?: return null
        if (lm.size <= 473) return null
        val ar = frameAspect
        fun off(i: Int, a: Int, b: Int): FloatArray {
            val dx = (lm[b].x() - lm[a].x()) * ar
            val dy = lm[b].y() - lm[a].y()
            val w = maxOf(kotlin.math.hypot(dx, dy), 1e-4f)
            return floatArrayOf(
                (lm[i].x() - (lm[a].x() + lm[b].x()) / 2f) * ar / w,
                (lm[i].y() - (lm[a].y() + lm[b].y()) / 2f) / w,
            )
        }
        val o1 = off(468, 33, 133)
        val o2 = off(473, 362, 263)
        var gx = 2.4f * (o1[0] + o2[0]) / 2f
        var gy = 2.4f * (o1[1] + o2[1]) / 2f
        val m = result.facialTransformationMatrixes().orElse(null)?.firstOrNull()
        if (m != null && m.size >= 11) {
            val n = maxOf(kotlin.math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]), 1e-6f)
            gx += m[8] / n
            gy -= m[9] / n
        }
        val sx = gazeFilterX.filter(gx, nowMs)
        val sy = gazeFilterY.filter(gy, nowMs)
        fun openness(blink: Float) = 1f - ((blink - 0.30f) / 0.40f).coerceIn(0f, 1f)
        // image-left eye = the user's RIGHT eye -> eyeBlinkRight
        val tl = openness(blendshapeScore(result, "eyeBlinkRight"))
        val tr = openness(blendshapeScore(result, "eyeBlinkLeft"))
        openLeft = if (openLeft < 0f) tl else openLeft + (tl - openLeft) * 0.6f
        openRight = if (openRight < 0f) tr else openRight + (tr - openRight) * 0.6f
        return floatArrayOf(lm[468].x(), lm[468].y(), lm[473].x(), lm[473].y(), sx, sy, openLeft, openRight)
    }

    /** Call once when done baking — releases the model's native resources. */`],
]);
patch(path.join(KT, 'LumVibeEngineBridge.kt'), 'eyeLaserSignals', [
  ['compute extras', 'val maskTextureId = segmentationMaskBitmap?.let { uploadBitmapTexture(it) } ?: 0',
`// EYE LASER: 8 extra floats appended to the face array (indices 20..27)
        val eyeLaser: FloatArray = (if (faceResult != null) faceTracker.eyeLaserSignals(faceResult, (timeElapsedSec * 1000f).toLong()) else null)
            ?: floatArrayOf(0.4f, 0.4f, 0.6f, 0.4f, 0f, 0f, 0f, 0f)

        val maskTextureId = segmentationMaskBitmap?.let { uploadBitmapTexture(it) } ?: 0`],
  ['send extras', '            faceArray,', '            faceArray + eyeLaser,'],
]);
console.log('\nDone. Now: (1) rebuild the native app (Android) — C++/Kotlin changed; iOS needs its Swift/ObjC bridge wired separately (not in this patch).');
