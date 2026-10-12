cmake_minimum_required(VERSION 3.22)
project(lumvibe_engine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# CHANGED: no longer needs network access to build. JSON parsing uses the
# vendored, dependency-free MiniJson.h (engine-native/include/lumvibe/)
# instead of fetching nlohmann::json from GitHub — this compiled and
# round-tripped cleanly in testing, see README's "Compiled and tested"
# section for what was actually verified.
add_library(lumvibe_engine SHARED
    src/EffectEngine.cpp
    src/jni_bridge.cpp
)

target_include_directories(lumvibe_engine PRIVATE
    include
)

target_link_libraries(lumvibe_engine
    PRIVATE
    android
    log
    EGL
    GLESv2
)

# Matches the rest of the module's existing minSdkVersion 24 from
# video-baker/android/build.gradle — GLES2/EGL/ANativeWindow are all
# available from API 9+, so this isn't the constraining factor.
target_compile_options(lumvibe_engine PRIVATE -Wall -Wextra)

# Builds liblumvibe_audio.so (audio-core + JNI bridge). AudioStudioNative.kt loads it.
add_subdirectory(audio)
