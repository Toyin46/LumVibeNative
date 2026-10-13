#pragma once
// STAGE C. C++ port of the website's js/create/proMix.js (makeProMix().process + masterSong()).
// Same constants, same order of processing, so the app's "Done" button produces the same
// finished song as the website:
//   voice: tone EQ -> de-ess -> 2-stage compression -> saturation -> plate reverb
//   beat : EQ pocket + multiband duck under the singing + shared reverb
//   master: glue compression -> soft clip -> -14 LUFS -> look-ahead limiter at -1 dBFS
#include "Common.h"
#include "Engine.h"

namespace lva {

// Pro chain only. voice: mono 48 kHz. beat: stereo 48 kHz or nullptr.
// Throws std::runtime_error("SILENT_VOICE") when the voice is empty.
StereoBuf proMixProcess(const Buf& voice, const StereoBuf* beat, const ProgressFn& progress);

// Whole website pipeline (masterSong): lift quiet mic -> clean + tune (lva::process) ->
// pro chain. Output is interleaved stereo 48 kHz, clamped to [-1, 1].
// Throws std::runtime_error("SILENT_VOICE") when nothing can be heard in the recording.
Result masterSong(const PcmIn& voice, const PcmIn* beat, float latencyMs, const ProgressFn& progress);

// Exposed for tests.
float proMixActiveRmsDb(const Buf& x);
float proMixLufs(const Buf& l, const Buf& r);

} // namespace lva
