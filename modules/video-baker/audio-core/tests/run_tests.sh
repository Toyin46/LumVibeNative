#!/bin/sh
# Builds the engine for your desktop and runs EVERY test. Needs g++ and python3 (+ numpy, scipy).
#   sh tests/run_tests.sh
set -e
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/lva_build"; mkdir -p "$OUT"
export LVA_LIB="$OUT/liblva.so"
echo "== building =="
g++ -std=c++17 -O2 -Wall -Wextra -Iinclude tests/unit_tests.cpp src/Denoiser.cpp src/Effects.cpp src/Pitch.cpp src/Resampler.cpp src/optional_rnnoise.cpp -o "$OUT/unit_tests"
g++ -std=c++17 -O2 -Wall -Wextra -shared -fPIC -Iinclude src/*.cpp -o "$LVA_LIB"
echo "== unit tests (building blocks) =="
"$OUT/unit_tests"
echo "== integration tests (whole engine through the same C function the apps call) =="
python3 tests/integration_test.py
echo "== parameter sync (C header <-> audioStudio.ts) =="
python3 tests/check_param_sync.py
echo
echo "ALL TESTS PASSED"
