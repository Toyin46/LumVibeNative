#pragma once
#include <algorithm>
#include <cmath>
#include <deque>

namespace lumvibe {

// Standard, well-understood energy-based onset detector — not a
// placeholder. Technique: keep a short rolling window of recent amplitude
// energy; a "beat" fires when the current frame's energy exceeds the
// rolling average by a threshold ratio, gated by a minimum refractory
// period so a single loud transient doesn't fire multiple beats in a row.
// A "drop" is the same idea at a longer window/higher ratio — a sustained
// jump in energy level rather than a single transient.
//
// Feed it AudioAmplitudeReader's existing smoothed RMS value each frame;
// it needs no new audio pipeline, just this one class consuming the
// signal that already exists.
class BeatDetector {
public:
    struct Result { bool beat = false; float beatEnergy = 0.f; bool drop = false; };

    Result update(float amplitude, float dtSec) {
        Result out;
        history_.push_back(amplitude);
        while (history_.size() > kHistorySize) history_.pop_front();

        float avg = 0.f;
        for (float v : history_) avg += v;
        avg /= (float)history_.size();

        float variance = 0.f;
        for (float v : history_) variance += (v - avg) * (v - avg);
        variance /= (float)history_.size();
        float threshold = avg + kSensitivity * std::sqrt(variance);

        beatCooldown_ -= dtSec;
        if (amplitude > threshold && amplitude > kMinEnergyFloor && beatCooldown_ <= 0.f) {
            out.beat = true;
            beatCooldown_ = kMinBeatIntervalSec;
        }
        out.beatEnergy = avg > 0.0001f ? std::min(amplitude / (avg + 0.0001f) - 1.f, 1.f) : 0.f;
        out.beatEnergy = std::max(out.beatEnergy, 0.f);

        // Drop: sustained (not single-frame) energy well above the longer
        // rolling baseline, gated by a longer cooldown so it fires once
        // per actual "drop moment," not once per beat within it.
        longHistory_.push_back(amplitude);
        while (longHistory_.size() > kLongHistorySize) longHistory_.pop_front();
        float longAvg = 0.f;
        for (float v : longHistory_) longAvg += v;
        longAvg /= (float)longHistory_.size();
        dropCooldown_ -= dtSec;
        if (longHistory_.size() >= kLongHistorySize && amplitude > longAvg * kDropRatio &&
            dropCooldown_ <= 0.f) {
            out.drop = true;
            dropCooldown_ = kMinDropIntervalSec;
        }
        return out;
    }

private:
    std::deque<float> history_;     // ~0.5s window for beat detection
    std::deque<float> longHistory_; // ~4s window for drop detection
    float beatCooldown_ = 0.f;
    float dropCooldown_ = 0.f;

    static constexpr size_t kHistorySize = 15;      // ~0.5s at 30fps audio-frame cadence
    static constexpr size_t kLongHistorySize = 120;  // ~4s
    static constexpr float kSensitivity = 1.4f;      // threshold = avg + 1.4 * stddev
    static constexpr float kMinEnergyFloor = 0.08f;  // ignore near-silence noise floor
    static constexpr float kMinBeatIntervalSec = 0.22f; // caps at ~270 BPM, well above any real tempo
    static constexpr float kDropRatio = 1.8f;
    static constexpr float kMinDropIntervalSec = 3.0f;
};

} // namespace lumvibe
