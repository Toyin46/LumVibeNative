#!/bin/sh
# Compiles the SAME C++ audio engine to WebAssembly for your website project.
# Needs the Emscripten SDK once:  https://emscripten.org/docs/getting_started/downloads.html
# (after installing, run `source ./emsdk_env.sh` so `emcc` is on your PATH), then, from modules/video-baker:
#     sh web/build-wasm.sh
# Output: web/wasm/lumvibe_audio.js  (a single file with the .wasm embedded — no extra files to host).
#
# NOT RUN in the sandbox this was written in (no Emscripten there). The C++ it compiles is the
# exact code that is built and tested natively; the only untested part is this build command.
set -e
cd "$(dirname "$0")/.."
command -v emcc >/dev/null 2>&1 || { echo "emcc not found. Install the Emscripten SDK first (link at the top of this file)."; exit 1; }
mkdir -p web/wasm

SRC="$(ls audio-core/src/*.cpp)"
DEFS=""
RN_SRC=""
# Optional RNNoise (see README_AUDIO.md step 2) — picked up automatically if present.
if [ -f audio-core/third_party/rnnoise/src/denoise.c ] && [ -f audio-core/third_party/rnnoise/src/rnnoise_data.c ]; then
  RN_SRC="$(ls audio-core/third_party/rnnoise/src/*.c | grep -v -E 'dump_|write_|_demo')"
  DEFS="-DLVA_WITH_RNNOISE=1 -Iaudio-core/third_party/rnnoise/include -Iaudio-core/third_party/rnnoise/src"
  echo "RNNoise: ENABLED"
else
  echo "RNNoise: not found - using the built-in spectral denoiser"
fi

emcc $SRC $RN_SRC -Iaudio-core/include $DEFS \
  -std=c++17 -O3 -DNDEBUG \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sMAXIMUM_MEMORY=2147483648 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_lva_process,_lva_free,_lva_last_error,_lva_param_count,_lva_default_params,_lva_has_rnnoise,_lva_version,_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAP32,UTF8ToString \
  -o web/wasm/lumvibe_audio.js
echo "Built web/wasm/lumvibe_audio.js"
