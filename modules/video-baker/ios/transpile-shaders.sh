#!/usr/bin/env bash
# Transpiles every shader in effects.manifest.json (GLSL ES, Android/Web
# convention) into effects.manifest.ios.json (MSL, what MetalRenderBackend
# needs). Run this LOCALLY before `eas build --platform ios` — it's a
# vendored-toolchain step that needs to happen before EAS's cloud build,
# not during it. Run it on any OS (SPIRV-Cross ships Linux/Windows/Mac
# binaries) — you do NOT need a Mac for this step.
#
# NOT RUN in this pass: SPIRV-Cross and glslangValidator aren't installed
# in the environment this was written in (no network access to fetch
# them). The approach is correct — the industry-standard way to get GLSL
# onto Metal — but this specific script hasn't executed successfully
# anywhere yet. See vintage_flicker.metal in this folder for what the
# OUTPUT should look like, hand-translated so you have one proven-correct
# reference to check the automated output against.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST_IN="$SCRIPT_DIR/../../engine-ts/assets/effects.manifest.json"
MANIFEST_OUT="$SCRIPT_DIR/../../engine-ts/assets/effects.manifest.ios.json"

if ! command -v glslangValidator &> /dev/null; then
  echo "glslangValidator not found. Get it from https://github.com/KhronosGroup/glslang/releases" >&2
  exit 1
fi
if ! command -v spirv-cross &> /dev/null; then
  echo "spirv-cross not found. Get it from https://github.com/KhronosGroup/SPIRV-Cross/releases" >&2
  echo "(or: brew install spirv-cross glslang, on macOS)" >&2
  exit 1
fi

node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const manifest = JSON.parse(fs.readFileSync('$MANIFEST_IN', 'utf8'));
const tmp = require('os').tmpdir();

for (const effect of manifest.effects) {
  for (const field of ['vertexShader', 'fragmentShader']) {
    if (!effect[field]) continue;
    const stage = field === 'vertexShader' ? 'vert' : 'frag';
    const glslPath = \`\${tmp}/\${effect.id}.\${stage}\`;
    const spirvPath = \`\${glslPath}.spv\`;
    fs.writeFileSync(glslPath, effect[field]);
    execSync(\`glslangValidator -V -S \${stage} -o \${spirvPath} \${glslPath}\`);
    const msl = execSync(\`spirv-cross --msl \${spirvPath}\`).toString();
    // SPIRV-Cross names entry points 'main0' by default — rename to the
    // vertexMain/fragmentMain MetalRenderBackend.mm's compileProgram
    // looks up by name.
    effect[field] = msl.replace(/\bmain0\b/g, stage === 'vert' ? 'vertexMain' : 'fragmentMain');
  }
}

fs.writeFileSync('$MANIFEST_OUT', JSON.stringify(manifest, null, 2));
console.log(\`Wrote \${manifest.effects.length} effects -> $MANIFEST_OUT\`);
"
