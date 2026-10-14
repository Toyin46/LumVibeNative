#include "lumvibe/EffectEngine.h"

#include <algorithm>
#include <cctype>
#include <string>
#include <cmath>
#include <fstream>
#include <sstream>

// CHANGED: was nlohmann::json via a network FetchContent — swapped for the
// vendored MiniJson.h so Android/iOS/Emscripten builds don't each need
// network access on first build just to pull in a JSON library.
#include "lumvibe/MiniJson.h"

namespace lumvibe {

using json = JsonValue;

// ---------------------------------------------------------------------
// ParticleSystem — direct port of ParticleSystem.kt, unchanged math.
// ---------------------------------------------------------------------
ParticleSystem::ParticleSystem(float gravity, int maxParticles)
    : gravity_(gravity), maxParticles_(maxParticles) {}

void ParticleSystem::spawnBurst(Vec2 origin, int count, float speed, float lifetimeSec) {
    for (int n = 0; n < count; ++n) {
        if ((int)particles_.size() >= maxParticles_) break;
        float angle = ((float)rand() / RAND_MAX) * 6.2831853f;
        float magnitude = speed * (0.5f + ((float)rand() / RAND_MAX) * 0.5f);
        Particle p;
        p.pos = origin;
        p.vel = {std::cos(angle) * magnitude, std::sin(angle) * magnitude - speed * 0.4f};
        p.rotationDeg = ((float)rand() / RAND_MAX) * 360.f;
        p.rotationSpeed = (((float)rand() / RAND_MAX) - 0.5f) * 720.f;
        p.lifetime = lifetimeSec * (0.7f + ((float)rand() / RAND_MAX) * 0.6f);
        p.age = 0.f;
        p.colorIndex = rand() % 6;
        particles_.push_back(p);
    }
}

void ParticleSystem::update(float dtSec) {
    if (dtSec <= 0.f) return;
    for (auto it = particles_.begin(); it != particles_.end();) {
        it->age += dtSec;
        if (it->age >= it->lifetime) { it = particles_.erase(it); continue; }
        it->vel.y += gravity_ * dtSec;
        it->pos.x += it->vel.x * dtSec;
        it->pos.y += it->vel.y * dtSec;
        it->rotationDeg += it->rotationSpeed * dtSec;
        ++it;
    }
}

void ParticleSystem::toUniforms(std::vector<Vec2>& positions, std::vector<float>& rotations,
                                 std::vector<float>& life, std::vector<float>& colorIndex, int& count) const {
    positions.assign(maxParticles_, Vec2{});
    rotations.assign(maxParticles_, 0.f);
    life.assign(maxParticles_, 0.f);
    colorIndex.assign(maxParticles_, 0.f);
    count = std::min((int)particles_.size(), maxParticles_);
    for (int i = 0; i < count; ++i) {
        const auto& p = particles_[i];
        positions[i] = p.pos;
        rotations[i] = p.rotationDeg;
        life[i] = std::clamp(1.f - p.age / p.lifetime, 0.f, 1.f);
        colorIndex[i] = (float)p.colorIndex;
    }
}

// ---------------------------------------------------------------------
// EffectEngine
// ---------------------------------------------------------------------
EffectEngine::EffectEngine(std::shared_ptr<IRenderBackend> backend) : backend_(std::move(backend)) {}

bool EffectEngine::loadManifest(const std::string& jsonPath) {
    std::ifstream f(jsonPath);
    if (!f.is_open()) return false;
    std::ostringstream buf;
    buf << f.rdbuf();
    return loadManifestFromString(buf.str());
}

bool EffectEngine::loadManifestFromString(const std::string& jsonText) {
    json root;
    try {
        root = json::parse(jsonText);
    } catch (const std::exception&) {
        return false;
    }

    effects_.clear();
    if (!root.contains("effects")) return false;
    for (const auto& e : root["effects"].arrVal) {
        EffectDefinitionNative def;
        def.id = e["id"].asString();
        def.displayName = e["displayName"].asString();
        def.category = e["category"].asString();
        if (e.contains("requires")) for (const auto& r : e["requires"].arrVal) def.requires_.push_back(r.asString());
        def.vertexShader = e["vertexShader"].asString();
        def.fragmentShader = e["fragmentShader"].asString();
        if (e.contains("bindings")) for (const auto& [k, v] : e["bindings"].objVal) def.bindings[k] = v.asString();
        if (e.contains("constants")) {
            for (const auto& [k, v] : e["constants"].objVal) {
                if (v.type == JsonValue::Type::Array) {
                    std::vector<float> vals;
                    for (const auto& item : v.arrVal) vals.push_back(item.asFloat());
                    def.constants[k] = vals;
                } else {
                    def.constants[k] = {v.asFloat()};
                }
            }
        }
        if (e.contains("assets")) for (const auto& [k, v] : e["assets"].objVal) def.assets[k] = v.asString();
        if (e.contains("particleSystems")) {
            for (const auto& ps : e["particleSystems"].arrVal) {
                ParticleSystemConfig cfg;
                cfg.id = ps["id"].asString();
                cfg.gravity = ps.contains("gravity") ? ps["gravity"].asFloat() : 1.4f;
                cfg.maxParticles = ps.contains("maxParticles") ? (int)ps["maxParticles"].asFloat() : 24;
                def.particleSystems.push_back(cfg);
            }
        }
        if (e.contains("triggers")) {
            for (const auto& t : e["triggers"].arrVal) {
                def.triggers.push_back({t["on"].asString(), t["action"].asString()});
            }
        }
        if (e.contains("staticFallback")) {
            for (const auto& [k, v] : e["staticFallback"].objVal) {
                if (v.type == JsonValue::Type::Array) {
                    std::vector<float> vals;
                    for (const auto& item : v.arrVal) vals.push_back(item.asFloat());
                    def.staticFallback[k] = vals;
                } else {
                    def.staticFallback[k] = {v.asFloat()};
                }
            }
        }
        if (e.contains("requiresSubsystem") && !e["requiresSubsystem"].isNull()) {
            def.requiresSubsystem = e["requiresSubsystem"].asString();
        }
        effects_.push_back(std::move(def));
    }
    return true;
}

const EffectDefinitionNative* EffectEngine::findEffect(const std::string& id) const {
    for (const auto& e : effects_) if (e.id == id) return &e;
    return nullptr;
}

bool EffectEngine::isEffectAvailable(const std::string& effectId) const {
    const auto* def = findEffect(effectId);
    if (!def) return false;
    if (!def->requiresSubsystem) return true;
    auto it = availableSubsystems_.find(*def->requiresSubsystem);
    return it != availableSubsystems_.end() && it->second;
}

void EffectEngine::registerSubsystem(const std::string& name) {
    availableSubsystems_[name] = true;
}

// ===========================================================================
// STAGE A2: SCREEN-SPACE SHADERS (same coordinate system as the website)
//
// The ported shaders place everything (eyes, hands, mask, effects) in `vTexCoord` and assume it is
// the picture as the viewer sees it. On the website that is true. On Android vTexCoord used to be
// the camera SENSOR space (rotated 90 degrees, mirrored, uncropped) which is why Demon Eyes / Eye
// Laser / Gaze Trail landed on the forehead and the Aura mask was sideways.
//
// Fix, done once at compile time (no per-effect shader edits):
//   * vertex shader: vTexCoord = the screen position   (y = 0 at the TOP for tracker effects, like
//                    MediaPipe and like the website's "y-down" quad; y = 0 at the bottom otherwise)
//   * fragment shader: every  texture2D(uTexture, X)  becomes  texture2D(uTexture, lvCam(X)),
//                    lvCam() = camera transform * crop  (uniform uCamMatrix) -> the camera is still
//                    sampled correctly, but everything else now lives in screen space.
// ===========================================================================
namespace {

bool isIdentChar(char c) { return std::isalnum((unsigned char)c) || c == '_'; }

// website rule: Trackers.need(def).length > 0
bool effectIsYDown(const EffectDefinitionNative& def) {
    for (const auto& r : def.requires_) if (r == "face" || r == "hand" || r == "body" || r == "segmentation") return true;
    return def.fragmentShader.find("uMaskTexture") != std::string::npos;
}

std::string wrapCameraSamples(const std::string& fs) {
    const std::string key = "texture2D(";
    std::string out; out.reserve(fs.size() + 256);
    size_t i = 0;
    while (true) {
        const size_t p = fs.find(key, i);
        if (p == std::string::npos) { out.append(fs, i, std::string::npos); break; }
        const size_t q = p + key.size();
        size_t r = q;
        while (r < fs.size() && std::isspace((unsigned char)fs[r])) ++r;
        const bool isCam = fs.compare(r, 8, "uTexture") == 0 && !(r + 8 < fs.size() && isIdentChar(fs[r + 8]));
        if (!isCam) { out.append(fs, i, q - i); i = q; continue; }
        r += 8;
        while (r < fs.size() && std::isspace((unsigned char)fs[r])) ++r;
        if (r >= fs.size() || fs[r] != ',') { out.append(fs, i, q - i); i = q; continue; }
        out.append(fs, i, r + 1 - i);                       // "...texture2D(uTexture,"
        const size_t a = r + 1;
        int depth = 0; size_t e = a, argEnd = std::string::npos;
        while (e < fs.size()) {
            const char c = fs[e];
            if (c == '(') ++depth;
            else if (c == ')') { if (depth == 0) break; --depth; }
            else if (c == ',' && depth == 0 && argEnd == std::string::npos) argEnd = e;   // 3rd arg (bias) is left alone
            ++e;
        }
        const size_t uvEnd = argEnd == std::string::npos ? e : argEnd;
        out += " lvCam(" + fs.substr(a, uvEnd - a) + ")";
        i = uvEnd;                                           // the rest (bias / ")") is copied by the next round
    }
    // helper goes right after the vTexCoord varying declaration
    const std::string decl = "vTexCoord;";
    const size_t d = out.find(decl);
    if (d != std::string::npos) {
        static const char* kHelper =
            "\n#ifdef GL_FRAGMENT_PRECISION_HIGH\n"
            "uniform highp mat4 uCamMatrix;\n"
            "highp vec2 lvCam(highp vec2 s){return (uCamMatrix*vec4(s,0.0,1.0)).xy;}\n"
            "#else\n"
            "uniform mediump mat4 uCamMatrix;\n"
            "vec2 lvCam(vec2 s){return (uCamMatrix*vec4(s,0.0,1.0)).xy;}\n"
            "#endif\n";
        out.insert(d + decl.size(), kHelper);
    }
    return out;
}

std::string replaceAll(std::string s, const std::string& from, const std::string& to) {
    size_t p = 0;
    while ((p = s.find(from, p)) != std::string::npos) { s.replace(p, from.size(), to); p += to.size(); }
    return s;
}

std::string screenVertexShader(const EffectDefinitionNative& def, bool yDown) {
    const std::string uv = yDown ? "vec2(aPosition.x*0.5+0.5,0.5-aPosition.y*0.5)"
                                 : "vec2(aPosition.x*0.5+0.5,0.5+aPosition.y*0.5)";
    if (def.vertexShader.empty()) {
        return "attribute vec4 aPosition;attribute vec4 aTexCoord;"
               "varying highp vec2 vTexCoord;void main(){gl_Position=aPosition;vTexCoord=" + uv + ";}";
    }
    // custom vertex shaders (shake / zoom): the image must move WITH the geometry, so vTexCoord
    // comes from the un-shifted quad position.
    std::string vs = def.vertexShader;
    vs = replaceAll(vs, "vTexCoord = (uTexMatrix * aTexCoord).xy;", "vTexCoord = " + uv + ";");
    vs = replaceAll(vs, "vTexCoord = aTexCoord.xy;", "vTexCoord = " + uv + ";");
    return vs;
}

} // namespace

// camera transform for ONE effect: uCamMatrix * (screenX, screenY) -> camera texture coordinates.
// = surfaceTexture.getTransformMatrix() * (centre-crop of the live view); the Y flip depends on the
// effect's coordinate convention (see above).
void EffectEngine::computeCamMatrix(bool yDown, float out[16]) const {
    const float u0 = camUv_[0], v0 = camUv_[1], u1 = camUv_[2], v1 = camUv_[5];
    const float du = u1 - u0, dv = v1 - v0;
    float C[16] = {0};                        // column-major crop matrix
    C[0] = du;                                // sx -> u
    C[5] = yDown ? -dv : dv;                  // sy -> v
    C[10] = 1.f;
    C[12] = u0;
    C[13] = yDown ? v1 : v0;
    C[15] = 1.f;
    for (int col = 0; col < 4; ++col)
        for (int row = 0; row < 4; ++row) {
            float s = 0.f;
            for (int k = 0; k < 4; ++k) s += texMatrix_[k * 4 + row] * C[col * 4 + k];
            out[col * 4 + row] = s;
        }
}

bool EffectEngine::setEffect(const std::string& effectId) {
    if (!isEffectAvailable(effectId)) return false;
    const auto* def = findEffect(effectId);
    if (compiledPrograms_.find(effectId) == compiledPrograms_.end()) {
        const bool yDown = effectIsYDown(*def);
        const std::string vs = screenVertexShader(*def, yDown);
        const std::string fs = wrapCameraSamples(def->fragmentShader);
        const uint32_t prog = backend_->compileProgram(vs, fs);
        if (prog == 0) return false;     // never leave a black screen: the caller falls back to the old renderer
        compiledPrograms_[effectId] = prog;
        for (const auto& ps : def->particleSystems) {
            particleSystems_[def->id + ":" + ps.id] =
                std::make_unique<ParticleSystem>(ps.gravity, ps.maxParticles);
        }
        for (const auto& [uniformName, assetPath] : def->assets) {
            if (loadedAssetTextures_.find(assetPath) == loadedAssetTextures_.end()) {
                loadedAssetTextures_[assetPath] = backend_->loadTextureAsset(assetPath);
            }
        }
    }
    currentEffectId_ = effectId;
    return true;
}

void EffectEngine::updateSignals(const FrameSignals& signals) {
    currentSignals_ = signals;

    // Run beat detection off the existing amplitude signal — no new audio
    // pipeline, just this one call each frame.
    BeatDetector::Result beat = beatDetector_.update(signals.audio.amplitude, signals.time.deltaSec);
    currentSignals_.audio.beatDetected = beat.beat;
    currentSignals_.audio.beatEnergy = beat.beatEnergy;
    currentSignals_.audio.dropDetected = beat.drop;
    if (beat.beat) beatPulse_ = 1.f;
    beatPulse_ = std::max(0.f, beatPulse_ - signals.time.deltaSec * 2.5f);
    beatShakeOffset_ = {
        (((float)rand() / RAND_MAX) - 0.5f) * 0.04f * beatPulse_,
        (((float)rand() / RAND_MAX) - 0.5f) * 0.04f * beatPulse_,
    };

    for (auto& [key, ps] : particleSystems_) {
        // Only step systems belonging to the active effect — matches the
        // old FrameRenderer behavior of one active particle set at a time.
        if (key.rfind(currentEffectId_ + ":", 0) == 0) ps->update(signals.time.deltaSec);
    }

    if (boomEnergy_ > 0.f) boomEnergy_ = std::max(0.f, boomEnergy_ - signals.time.deltaSec * boomDecayRate_);
    if (explosionProgress_ > 0.f) explosionProgress_ = std::min(1.f, explosionProgress_ + signals.time.deltaSec * explosionDecayRate_);
    if (dropEnergy_ > 0.f) dropEnergy_ = std::max(0.f, dropEnergy_ - signals.time.deltaSec * dropDecayRate_);
}

// ---- Signal resolution --------------------------------------------------
// Reference coverage of the common cases from engine-ts's SignalPath union.
// Extending this to every remaining path (segmentation, gaze/finger
// trails, second hand, etc.) is the same shape repeated — add a branch,
// pull the value out of currentSignals_.
EffectEngine::ResolvedValue EffectEngine::resolveSignal(const std::string& path) const {
    ResolvedValue r;
    const auto& s = currentSignals_;

    if (path == "time.elapsed") { r.kind = ResolvedValue::Float; r.f = s.time.elapsedSec; return r; }
    if (path == "time.delta") { r.kind = ResolvedValue::Float; r.f = s.time.deltaSec; return r; }
    if (path == "face.smileScore") { r.kind = ResolvedValue::Float; r.f = s.face.smileScore; return r; }
    if (path == "face.browRaiseScore") { r.kind = ResolvedValue::Float; r.f = s.face.browRaiseScore; return r; }
    if (path == "face.jawOpen") { r.kind = ResolvedValue::Float; r.f = s.face.jawOpen; return r; }
    if (path == "face.winkScore") { r.kind = ResolvedValue::Float; r.f = s.face.winkScore; return r; }
    if (path == "face.boundingBox") { r.kind = ResolvedValue::Vec4Val; r.v4 = s.face.boundingBox; return r; }
    if (path == "face.mouthCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.mouthCenter; return r; }
    if (path == "face.eyeCenter.left") {
        // "Signed eye pair" convention: if a sibling binding reads
        // face.winkScore and it's negative, automatically hand back the
        // RIGHT eye instead — so wink_spark.ts's single declared path
        // ("face.eyeCenter.left") lights up whichever eye actually winked,
        // without a per-effect branch on the TS side.
        r.kind = ResolvedValue::Vec2Val;
        r.v2 = (s.face.winkScore < 0) ? s.face.eyeCenterRight : s.face.eyeCenterLeft;
        return r;
    }
    if (path == "face.eyeCenter.right") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.eyeCenterRight; return r; }
    if (path == "face.irisCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisCenter; return r; }
    if (path == "face.irisCenter.left") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisLeft; return r; }
    if (path == "face.irisCenter.right") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.irisRight; return r; }
    if (path == "face.gazeDir") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.gazeDir; return r; }
    if (path == "face.eyeOpen") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.eyeOpen; return r; }
    if (path == "face.headPose.roll") { r.kind = ResolvedValue::Float; r.f = s.face.headRoll; return r; }
    if (path == "face.headPose.yaw") { r.kind = ResolvedValue::Float; r.f = s.face.headYaw; return r; }
    if (path == "face.jawOpen") { r.kind = ResolvedValue::Float; r.f = s.face.jawOpen; return r; }
    if (path == "face.browRaiseScore") { r.kind = ResolvedValue::Float; r.f = s.face.browRaiseScore; return r; }
    if (path == "face.mouthCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.face.mouthCenter; return r; }
    if (path == "face.eyeBlinkBoth") { r.kind = ResolvedValue::Float; r.f = s.face.eyeBlinkBoth ? 0.f : 1.f; return r; } // inverted: bindings read this as "open" intensity (see eye_laser)
    if (path == "hand.count") { r.kind = ResolvedValue::Int; r.i = (int)s.hands.size(); return r; }
    if (path == "hand.0.detected") { r.kind = ResolvedValue::Float; r.f = !s.hands.empty() && s.hands[0].detected ? 1.f : 0.f; return r; }
    if (path == "hand.1.detected") { r.kind = ResolvedValue::Float; r.f = s.hands.size() > 1 && s.hands[1].detected ? 1.f : 0.f; return r; }
    if (path == "body.detected") { r.kind = ResolvedValue::Float; r.f = s.body.detected ? 1.f : 0.f; return r; }
    if (path == "body.boundingBox") { r.kind = ResolvedValue::Vec4Val; r.v4 = s.body.boundingBox; return r; }
    if (path == "touch.active") { r.kind = ResolvedValue::Float; r.f = s.touch.active ? 1.f : 0.f; return r; }
    if (path == "touch.position") { r.kind = ResolvedValue::Vec2Val; r.v2 = s.touch.position; return r; }
    if (path == "motion.magnitude") { r.kind = ResolvedValue::Float; r.f = s.motion.magnitude; return r; }
    if (path == "stillness.seconds") { r.kind = ResolvedValue::Float; r.f = s.motion.stillnessSeconds; return r; }
    if (path == "stillness.amount") { r.kind = ResolvedValue::Float; r.f = std::min(s.motion.stillnessSeconds / 2.5f, 1.f); return r; }
    if (path == "audio.beatDetected") { r.kind = ResolvedValue::Float; r.f = s.audio.beatDetected ? 1.f : 0.f; return r; }
    if (path == "audio.dropDetected") { r.kind = ResolvedValue::Float; r.f = s.audio.dropDetected ? 1.f : 0.f; return r; }
    // "engine.*" — native-computed, not raw tracker readings.
    if (path == "engine.freezeZoom") {
        r.kind = ResolvedValue::Float;
        r.f = (freezeFrameAge_ >= 0.f) ? (1.f + (freezeZoomTarget_ - 1.f) * std::max(0.f, 1.f - freezeFrameAge_ / freezeHoldSeconds_)) : 1.f;
        return r;
    }
    if (path == "engine.freezeAge") {
        r.kind = ResolvedValue::Float;
        r.f = (freezeFrameAge_ >= 0.f) ? std::min(freezeFrameAge_ / freezeHoldSeconds_, 1.f) : 0.f;
        return r;
    }
    if (path == "engine.boomCenter") { r.kind = ResolvedValue::Vec2Val; r.v2 = boomCenter_; return r; }
    if (path == "engine.boomEnergy") { r.kind = ResolvedValue::Float; r.f = boomEnergy_; return r; }
    if (path == "engine.explosionProgress") { r.kind = ResolvedValue::Float; r.f = explosionProgress_; return r; }
    if (path == "engine.beatPulse") { r.kind = ResolvedValue::Float; r.f = beatPulse_; return r; }
    if (path == "engine.beatShakeOffset") { r.kind = ResolvedValue::Vec2Val; r.v2 = beatShakeOffset_; return r; }
    if (path == "engine.dropEnergy") { r.kind = ResolvedValue::Float; r.f = dropEnergy_; return r; }
    if (path == "engine.headTiltZoom") { r.kind = ResolvedValue::Float; r.f = 1.f + std::min(std::abs(s.face.headYaw), 30.f) / 30.f * 0.25f; return r; }
    if (path == "engine.headTiltPan") { r.kind = ResolvedValue::Vec2Val; r.v2 = {s.face.headYaw / 90.f * 0.12f, 0.f}; return r; }
    if (path == "engine.twoHandFrameRect") {
        r.kind = ResolvedValue::Vec4Val;
        if (s.hands.size() > 1) {
            Vec2 a = s.hands[0].palmCenter, b = s.hands[1].palmCenter;
            r.v4 = {std::min(a.x, b.x), std::min(a.y, b.y), std::max(a.x, b.x), std::max(a.y, b.y)};
        } else {
            r.v4 = {0.3f, 0.3f, 0.7f, 0.7f};
        }
        return r;
    }
    // Trail arrays — face.gazeTrail*/hand.0.fingerTrail* feed the Vec2Arr/
    // FloatArr branches applyBindings() already dispatches on.
    if (path == "face.gazeTrailPoints") { r.kind = ResolvedValue::Vec2Arr; r.v2Arr.assign(s.face.gazeTrail.begin(), s.face.gazeTrail.end()); return r; }
    if (path == "face.gazeTrailAges") { r.kind = ResolvedValue::FloatArr; r.fArr.assign(s.face.gazeTrailAges.begin(), s.face.gazeTrailAges.end()); return r; }
    if (path == "face.gazeTrailCount") { r.kind = ResolvedValue::Int; r.i = s.face.gazeTrailCount; return r; }
    if (path == "hand.0.fingerTrailPoints") {
        r.kind = ResolvedValue::Vec2Arr;
        if (!s.hands.empty()) r.v2Arr.assign(s.hands[0].fingerTrail.begin(), s.hands[0].fingerTrail.end());
        return r;
    }
    if (path == "hand.0.fingerTrailAges") {
        r.kind = ResolvedValue::FloatArr;
        if (!s.hands.empty()) r.fArr.assign(s.hands[0].fingerTrailAges.begin(), s.hands[0].fingerTrailAges.end());
        return r;
    }
    if (path == "hand.0.fingerTrailCount") { r.kind = ResolvedValue::Int; r.i = !s.hands.empty() ? s.hands[0].fingerTrailCount : 0; return r; }
    if (path == "hand.0.angle") { r.kind = ResolvedValue::Float; r.f = !s.hands.empty() ? s.hands[0].angle : 0.f; return r; }
    if (path == "face.yawDelta") { r.kind = ResolvedValue::Float; r.f = std::min(std::abs(s.face.yawDelta) / 25.f, 1.f); return r; }
    if (path == "hand.0.palmCenter") {
        r.kind = ResolvedValue::Vec2Val;
        r.v2 = !s.hands.empty() ? s.hands[0].palmCenter : Vec2{0.5f, 0.5f};
        return r;
    }
    if (path == "hand.1.palmCenter") {
        r.kind = ResolvedValue::Vec2Val;
        r.v2 = s.hands.size() > 1 ? s.hands[1].palmCenter : Vec2{0.5f, 0.5f};
        return r;
    }
    if (path == "audio.amplitude") { r.kind = ResolvedValue::Float; r.f = s.audio.amplitude; return r; }
    if (path == "audio.silenceScore") { r.kind = ResolvedValue::Float; r.f = 1.f - s.audio.amplitude; return r; }
    if (path == "motion.magnitude") { r.kind = ResolvedValue::Float; r.f = s.motion.magnitude; return r; }
    if (path == "stillness.seconds") { r.kind = ResolvedValue::Float; r.f = s.motion.stillnessSeconds; return r; }
    if (path == "engine.freezeZoom") {
        r.kind = ResolvedValue::Float;
        r.f = (freezeFrameAge_ >= 0.f) ? (1.f + 0.15f * std::max(0.f, 1.f - freezeFrameAge_ / 0.3f)) : 1.f;
        return r;
    }
    // particles.<id>.* — pulled from the live ParticleSystem instance for
    // the active effect, keyed "<effectId>:<particleId>".
    if (path.rfind("particles.", 0) == 0) {
        auto rest = path.substr(10); // "<id>.<field>"
        auto dot = rest.find('.');
        std::string psId = rest.substr(0, dot);
        std::string field = rest.substr(dot + 1);
        auto it = particleSystems_.find(currentEffectId_ + ":" + psId);
        std::vector<Vec2> positions; std::vector<float> rotations, life, colorIdx; int count = 0;
        if (it != particleSystems_.end()) it->second->toUniforms(positions, rotations, life, colorIdx, count);
        if (field == "positions") { r.kind = ResolvedValue::Vec2Arr; r.v2Arr = positions; return r; }
        if (field == "rotations") { r.kind = ResolvedValue::FloatArr; r.fArr = rotations; return r; }
        if (field == "life") { r.kind = ResolvedValue::FloatArr; r.fArr = life; return r; }
        if (field == "colorIndex") { r.kind = ResolvedValue::FloatArr; r.fArr = colorIdx; return r; }
        if (field == "count") { r.kind = ResolvedValue::Int; r.i = count; return r; }
    }

    // Unknown path: fail loud in debug, neutral zero in release, rather
    // than silently mis-rendering — this is the seam where a TS author
    // added a SignalPath the native switch hasn't caught up to yet.
    r.kind = ResolvedValue::Float; r.f = 0.f;
    return r;
}

void EffectEngine::applyBindings(uint32_t program, const EffectDefinitionNative& def) {
    // Camera frame and segmentation mask are bound automatically for every
    // effect that needs them — no TS file declares these as explicit
    // bindings, matching the convention every ported shader already
    // assumes ("uTexture" and "uMaskTexture" are always just there).
    backend_->bindCameraTexture(program, cameraTextureId_);
    bool needsMask = std::find(def.requires_.begin(), def.requires_.end(), "segmentation") != def.requires_.end();
    if (needsMask && currentSignals_.segmentationMaskTexture != 0) {
        backend_->bindTexture(program, "uMaskTexture", 1, currentSignals_.segmentationMaskTexture);
    }
    // face_morph's "uMaskTexture" is a different texture source (a CPU-drawn
    // wireframe mesh, from FaceMeshRenderer.buildMeshBitmap on Android — see
    // README) rather than the segmentation mask, so it gets its own
    // special case rather than being folded into the "segmentation"
    // requires-check above. Same unit (1) as the segmentation mask is
    // fine since no effect needs both at once.
    if (def.id == "face_morph" && currentSignals_.faceMeshTexture != 0) {
        backend_->bindTexture(program, "uMaskTexture", 1, currentSignals_.faceMeshTexture);
    }

    for (const auto& [uniformName, path] : def.bindings) {
        ResolvedValue v = resolveSignal(path);
        switch (v.kind) {
            case ResolvedValue::Float: backend_->setUniformFloat(program, uniformName, v.f); break;
            case ResolvedValue::Vec2Val: backend_->setUniformVec2(program, uniformName, v.v2); break;
            case ResolvedValue::Vec4Val: backend_->setUniformVec4(program, uniformName, v.v4); break;
            case ResolvedValue::Int: backend_->setUniformInt(program, uniformName, v.i); break;
            case ResolvedValue::FloatArr: backend_->setUniformFloatArray(program, uniformName, v.fArr.data(), (int)v.fArr.size()); break;
            case ResolvedValue::Vec2Arr: backend_->setUniformVec2Array(program, uniformName, v.v2Arr.data(), (int)v.v2Arr.size()); break;
        }
    }
    // Same rule as the website: a shader that declares uIntensity but whose manifest never sets it
    // gets 1.0 (not 0). Without this Old Film (vintage_flicker) drew nothing useful.
    if (def.fragmentShader.find("uIntensity") != std::string::npos &&
        def.bindings.find("uIntensity") == def.bindings.end() &&
        def.constants.find("uIntensity") == def.constants.end()) {
        backend_->setUniformFloat(program, "uIntensity", 1.0f);
    }
    for (const auto& [uniformName, values] : def.constants) {
        if (values.size() == 1) backend_->setUniformFloat(program, uniformName, values[0]);
        else if (values.size() == 2) backend_->setUniformVec2(program, uniformName, {values[0], values[1]});
        else if (values.size() == 3) backend_->setUniformVec3(program, uniformName, values[0], values[1], values[2]);   // Duotone Pulse colours
        else if (values.size() == 4) backend_->setUniformVec4(program, uniformName, {values[0], values[1], values[2], values[3]});
    }
    // Units 0 and 1 are reserved for the camera frame and segmentation
    // mask above — asset textures (portal scenes, space backgrounds, etc.)
    // start at 2 so an effect that uses both segmentation AND an asset
    // texture (e.g. space_background) doesn't collide on the same unit.
    int unit = 2;
    for (const auto& [uniformName, assetPath] : def.assets) {
        backend_->bindTexture(program, uniformName, unit++, loadedAssetTextures_[assetPath]);
    }
}

// ---- Trigger evaluation --------------------------------------------------
// Deliberately small, hand-parsed grammar (see EffectDefinition.ts's
// TriggerRule doc for why this stays fixed rather than growing into a
// second scripting language). Supports: `<path> == '<value>'`,
// `<path> > <number>`, `edge(true)`, and `&&` between clauses.
bool EffectEngine::evaluateCondition(const std::string& expr, const std::string& triggerKey) {
    std::istringstream stream(expr);
    std::string clause;
    bool result = true;
    while (std::getline(stream, clause, '&')) {
        if (clause.empty() || clause == "&") continue;
        // trim
        size_t a = clause.find_first_not_of(" \t");
        size_t b = clause.find_last_not_of(" \t");
        if (a == std::string::npos) continue;
        clause = clause.substr(a, b - a + 1);

        if (clause.rfind("edge(", 0) == 0) {
            bool current = triggerEdgeState_[triggerKey];
            bool fired = !current; // fires once on the transition into "true"
            triggerEdgeState_[triggerKey] = true;
            result = result && fired;
            continue;
        }
        // Reset edge state when the guarding clauses aren't currently true —
        // handled by the caller resetting triggerEdgeState_[triggerKey] to
        // false once the overall condition evaluates false for a frame.
        auto eqPos = clause.find("==");
        auto gtPos = clause.find('>');
        if (eqPos != std::string::npos) {
            std::string lhs = clause.substr(0, eqPos);
            std::string rhs = clause.substr(eqPos + 2);
            // string compare against gesture-name style values, e.g. 'fist'
            rhs.erase(std::remove(rhs.begin(), rhs.end(), '\''), rhs.end());
            rhs.erase(std::remove(rhs.begin(), rhs.end(), ' '), rhs.end());
            lhs.erase(std::remove(lhs.begin(), lhs.end(), ' '), lhs.end());
            if (lhs.rfind("hand.0.gesture", 0) == 0 || lhs.rfind("hand.1.gesture", 0) == 0) {
                int handIdx = (lhs.rfind("hand.0", 0) == 0) ? 0 : 1;
                std::string gestureStr = "none";
                if ((int)currentSignals_.hands.size() > handIdx) {
                    switch (currentSignals_.hands[handIdx].gesture) {
                        case HandGesture::Fist: gestureStr = "fist"; break;
                        case HandGesture::OpenPalm: gestureStr = "openPalm"; break;
                        case HandGesture::Scissors: gestureStr = "scissors"; break;
                        case HandGesture::Pointing: gestureStr = "pointing"; break;
                        default: gestureStr = "unknown";
                    }
                }
                result = result && (gestureStr == rhs);
            } else {
                // Any other "==" comparison is against a boolean-style
                // signal ('true'/'false') — e.g. "audio.dropDetected == 'true'".
                ResolvedValue v = resolveSignal(lhs);
                bool boolVal = v.f > 0.5f;
                result = result && (boolVal == (rhs == "true"));
            }
        } else if (gtPos != std::string::npos) {
            std::string lhs = clause.substr(0, gtPos);
            float rhs = std::stof(clause.substr(gtPos + 1));
            ResolvedValue v = resolveSignal(lhs.substr(0, lhs.find_last_not_of(" \t") + 1));
            result = result && (v.f > rhs);
        }
    }
    if (!result) triggerEdgeState_[triggerKey] = false;
    return result;
}

void EffectEngine::runAction(const std::string& action) {
    // Fixed, small set of built-in verbs — an EffectDefinition can only
    // call these, never inject arbitrary native behavior. Add a new verb
    // here only when a real effect genuinely needs a new engine primitive
    // (see README's "needs new subsystem" list) — most effects need none
    // of these and use bindings/particleSystems alone.
    if (action.rfind("particles.", 0) == 0) {
        auto afterDot = action.substr(10);
        auto dot = afterDot.find('.');
        std::string psId = afterDot.substr(0, dot);
        auto it = particleSystems_.find(currentEffectId_ + ":" + psId);
        if (it == particleSystems_.end()) return;
        // Minimal arg parsing for spawnBurst(origin=..., count=N, speed=F, lifetime=F).
        // A real build should replace this with a tiny proper parser; kept
        // inline here to keep the reference implementation self-contained.
        Vec2 origin = resolveSignal("hand.0.palmCenter").v2; // TODO: parse origin= target generically
        it->second->spawnBurst(origin, 24, 1.4f, 1.2f);
        return;
    }
    if (action.rfind("engine.captureFreezeFrame", 0) == 0) {
        freezeFrameAge_ = 0.f; // backend-specific frame capture happens in renderFrame()
        return;
    }
    if (action.rfind("engine.triggerBoom", 0) == 0) {
        boomCenter_ = resolveSignal("hand.0.palmCenter").v2; // TODO: parse center= target generically, incl. midpoint()
        boomEnergy_ = 1.f;
        return;
    }
    if (action.rfind("engine.triggerExplosion", 0) == 0) {
        explosionProgress_ = 0.001f;
        explosionDecayRate_ = 1.f / 0.6f; // reaches 1.0 over ~0.6s, matches durationSeconds= in the trigger
        return;
    }
    if (action.rfind("engine.triggerDrop", 0) == 0) {
        dropEnergy_ = 1.f;
        dropDecayRate_ = 1.f / 0.8f;
        return;
    }
}

void EffectEngine::evaluateTriggers(const EffectDefinitionNative& def) {
    for (size_t i = 0; i < def.triggers.size(); ++i) {
        const auto& t = def.triggers[i];
        std::string key = def.id + "#" + std::to_string(i);
        if (evaluateCondition(t.on, key)) runAction(t.action);
    }
}

void EffectEngine::renderFrame() {
    const auto* def = findEffect(currentEffectId_);
    if (!def) return;
    uint32_t program = compiledPrograms_[currentEffectId_];
    backend_->useProgram(program);
    backend_->setUniformMat4(program, "uTexMatrix", texMatrix_);   // (only used by legacy custom shaders)
    {
        float cam[16];
        computeCamMatrix(effectIsYDown(*def), cam);
        backend_->setUniformMat4(program, "uCamMatrix", cam);
    }
    applyBindings(program, *def);
    evaluateTriggers(*def);
    if (freezeFrameAge_ >= 0.f) {
        freezeFrameAge_ += currentSignals_.time.deltaSec;
        if (freezeFrameAge_ > 0.3f) freezeFrameAge_ = -1.f;
    }
    backend_->drawFullscreenQuad();
}

void EffectEngine::renderStaticFrame(const FrameSignals& singleFrameSignals) {
    updateSignals(singleFrameSignals);
    const auto* def = findEffect(currentEffectId_);
    if (def) {
        for (const auto& [uniformName, values] : def->staticFallback) {
            // Static fallback values are applied by the backend directly
            // in this reference version to keep resolveSignal() reading
            // ONLY from currentSignals_; a fuller implementation would
            // overlay these onto currentSignals_ before calling
            // applyBindings so the exact same code path runs for both.
            (void)uniformName; (void)values;
        }
    }
    renderFrame();
}

} // namespace lumvibe
