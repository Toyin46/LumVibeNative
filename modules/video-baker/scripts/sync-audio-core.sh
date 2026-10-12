#!/bin/sh
# Copies the shared C++ audio core into the iOS pod folders (CocoaPods only compiles files that
# live inside the pod, so iOS needs its own copy — the same pattern your ios/src/EffectEngine.cpp
# already uses). Run from modules/video-baker whenever audio-core/ changes:
#     sh scripts/sync-audio-core.sh
# audio-core/ stays the single source of truth; never edit the copies.
set -e
cd "$(dirname "$0")/.."
rm -rf ios/src/lva ios/include/lumvibe/audio
mkdir -p ios/src/lva ios/include/lumvibe/audio
cp audio-core/src/*.cpp ios/src/lva/
cp audio-core/include/lumvibe/audio/*.h ios/include/lumvibe/audio/
echo "audio-core synced to ios/src/lva and ios/include/lumvibe/audio"
