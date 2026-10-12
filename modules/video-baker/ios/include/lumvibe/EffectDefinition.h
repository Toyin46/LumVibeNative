#pragma once
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace lumvibe {

struct ParticleSystemConfig {
    std::string id;
    float gravity = 1.4f;
    int maxParticles = 24;
};

struct TriggerRule {
    std::string on;     // small expression — see EffectEngine::evaluateCondition
    std::string action; // e.g. "particles.confetti.spawnBurst(...)" — see EffectEngine::runAction
};

// Native mirror of engine-ts/types/EffectDefinition.ts's EffectDefinition.
// Populated by parsing the compiled JSON manifest (compile-manifest.ts's
// output) in EffectEngine::loadManifest. Field names intentionally match
// the TS side 1:1, so the JSON parser is a flat field-for-field mapping,
// not a translation layer that can silently drift out of sync.
struct EffectDefinitionNative {
    std::string id;
    std::string displayName;
    std::string category;
    std::vector<std::string> requires_; // "requires" avoided as a bare identifier for portability
    std::string vertexShader;   // empty => use kPassthroughVertexShader
    std::string fragmentShader;
    std::map<std::string, std::string> bindings;   // uniform name -> signal path
    std::map<std::string, std::vector<float>> constants; // uniform name -> fixed literal value(s)
    std::map<std::string, std::string> assets;     // uniform name -> bundled asset path
    std::vector<ParticleSystemConfig> particleSystems;
    std::vector<TriggerRule> triggers;
    std::map<std::string, std::vector<float>> staticFallback;
    std::optional<std::string> requiresSubsystem; // "meshWarp" | "worldTransform" | "generative" | "beatDetection"
};

} // namespace lumvibe
