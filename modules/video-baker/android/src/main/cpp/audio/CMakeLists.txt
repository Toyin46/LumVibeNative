# LumVibe Audio Engine — Android build.
# Pulled in by ONE added line in ../CMakeLists.txt:   add_subdirectory(audio)
# Builds a second, separate library (liblumvibe_audio.so) next to your existing
# liblumvibe_engine.so; nothing about the video engine target changes.

# audio-core/ sits at modules/video-baker/audio-core (5 levels up from this folder).
get_filename_component(LVA_CORE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../audio-core" ABSOLUTE)
if(NOT EXISTS "${LVA_CORE}/include/lumvibe/audio/lva.h")
  message(FATAL_ERROR "audio-core not found at ${LVA_CORE} — is the audio-core folder inside modules/video-baker?")
endif()

file(GLOB LVA_SOURCES "${LVA_CORE}/src/*.cpp")
set(LVA_ALL_SOURCES ${LVA_SOURCES} jni_audio_bridge.cpp)
set(LVA_DEFS "")

# ── Optional: RNNoise (better noise removal than the built-in one) ──────────
# Enabled automatically when you have put RNNoise into audio-core/third_party/rnnoise
# (see README_AUDIO.md step 2). Without it the built-in spectral denoiser is used.
set(LVA_RN "${LVA_CORE}/third_party/rnnoise")
if(EXISTS "${LVA_RN}/include/rnnoise.h" AND EXISTS "${LVA_RN}/src/denoise.c" AND EXISTS "${LVA_RN}/src/rnnoise_data.c")
  file(GLOB LVA_RN_SOURCES "${LVA_RN}/src/*.c")
  list(FILTER LVA_RN_SOURCES EXCLUDE REGEX "dump_|write_|_demo")   # training / demo tools have their own main()
  list(APPEND LVA_ALL_SOURCES ${LVA_RN_SOURCES})
  set(LVA_DEFS LVA_WITH_RNNOISE=1)
  message(STATUS "LumVibe audio: RNNoise ENABLED (${LVA_RN})")
else()
  message(STATUS "LumVibe audio: RNNoise not found - using built-in spectral denoiser")
endif()

add_library(lumvibe_audio SHARED ${LVA_ALL_SOURCES})
target_include_directories(lumvibe_audio PRIVATE "${LVA_CORE}/include")
if(LVA_DEFS)
  target_compile_definitions(lumvibe_audio PRIVATE ${LVA_DEFS})
  target_include_directories(lumvibe_audio PRIVATE "${LVA_RN}/include" "${LVA_RN}/src")
endif()
target_compile_features(lumvibe_audio PRIVATE cxx_std_17)
# -O3 even in debug builds: the DSP is ~10x slower unoptimised, which would make
# "Mastering..." take minutes while you are developing.
target_compile_options(lumvibe_audio PRIVATE -O3 -Wall -Wno-unused-parameter)
target_link_libraries(lumvibe_audio PRIVATE log)
