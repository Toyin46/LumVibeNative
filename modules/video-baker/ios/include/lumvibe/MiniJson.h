#pragma once
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace lumvibe {

// A small, dependency-free JSON reader — written specifically to replace
// the nlohmann::json + network-fetch dependency the engine used to have.
// Reasoning: the manifest format is fixed and simple (objects, arrays,
// strings, numbers, bools — no need for a general-purpose library), and
// Android NDK, Xcode, and Emscripten builds would each otherwise need
// network access during their first build just to fetch one header.
// Vendoring ~150 lines here makes all three builds reproducible offline,
// which matters more than saving these lines would.
class JsonValue {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Type type = Type::Null;
    bool boolVal = false;
    double numVal = 0.0;
    std::string strVal;
    std::vector<JsonValue> arrVal;
    std::map<std::string, JsonValue> objVal;

    bool isNull() const { return type == Type::Null; }
    bool contains(const std::string& key) const { return type == Type::Object && objVal.count(key) > 0; }
    const JsonValue& operator[](const std::string& key) const {
        static JsonValue nullVal;
        auto it = objVal.find(key);
        return it != objVal.end() ? it->second : nullVal;
    }
    std::string asString(const std::string& def = "") const { return type == Type::String ? strVal : def; }
    float asFloat(float def = 0.f) const { return type == Type::Number ? (float)numVal : def; }
    bool asBool(bool def = false) const { return type == Type::Bool ? boolVal : def; }

    static JsonValue parse(const std::string& text) {
        size_t pos = 0;
        JsonValue v = parseValue(text, pos);
        return v;
    }

private:
    static void skipWhitespace(const std::string& s, size_t& pos) {
        while (pos < s.size() && (s[pos] == ' ' || s[pos] == '\t' || s[pos] == '\n' || s[pos] == '\r')) pos++;
    }

    static JsonValue parseValue(const std::string& s, size_t& pos) {
        skipWhitespace(s, pos);
        if (pos >= s.size()) throw std::runtime_error("MiniJson: unexpected end of input");
        char c = s[pos];
        if (c == '{') return parseObject(s, pos);
        if (c == '[') return parseArray(s, pos);
        if (c == '"') return parseString(s, pos);
        if (c == 't' || c == 'f') return parseBool(s, pos);
        if (c == 'n') { pos += 4; JsonValue v; v.type = Type::Null; return v; } // "null"
        return parseNumber(s, pos);
    }

    static JsonValue parseObject(const std::string& s, size_t& pos) {
        JsonValue v; v.type = Type::Object;
        pos++; // {
        skipWhitespace(s, pos);
        if (pos < s.size() && s[pos] == '}') { pos++; return v; }
        while (true) {
            skipWhitespace(s, pos);
            JsonValue key = parseString(s, pos);
            skipWhitespace(s, pos);
            if (s[pos] != ':') throw std::runtime_error("MiniJson: expected ':'");
            pos++;
            JsonValue val = parseValue(s, pos);
            v.objVal[key.strVal] = val;
            skipWhitespace(s, pos);
            if (pos < s.size() && s[pos] == ',') { pos++; continue; }
            if (pos < s.size() && s[pos] == '}') { pos++; break; }
            throw std::runtime_error("MiniJson: expected ',' or '}'");
        }
        return v;
    }

    static JsonValue parseArray(const std::string& s, size_t& pos) {
        JsonValue v; v.type = Type::Array;
        pos++; // [
        skipWhitespace(s, pos);
        if (pos < s.size() && s[pos] == ']') { pos++; return v; }
        while (true) {
            JsonValue val = parseValue(s, pos);
            v.arrVal.push_back(val);
            skipWhitespace(s, pos);
            if (pos < s.size() && s[pos] == ',') { pos++; continue; }
            if (pos < s.size() && s[pos] == ']') { pos++; break; }
            throw std::runtime_error("MiniJson: expected ',' or ']'");
        }
        return v;
    }

    static JsonValue parseString(const std::string& s, size_t& pos) {
        JsonValue v; v.type = Type::String;
        if (s[pos] != '"') throw std::runtime_error("MiniJson: expected '\"'");
        pos++;
        std::ostringstream out;
        while (pos < s.size() && s[pos] != '"') {
            if (s[pos] == '\\' && pos + 1 < s.size()) {
                pos++;
                char esc = s[pos];
                switch (esc) {
                    case 'n': out << '\n'; break;
                    case 't': out << '\t'; break;
                    case 'r': out << '\r'; break;
                    case '"': out << '"'; break;
                    case '\\': out << '\\'; break;
                    case '/': out << '/'; break;
                    case 'u': pos += 4; out << '?'; break; // unicode escapes: not needed for this manifest's content (identifiers/GLSL are ASCII)
                    default: out << esc;
                }
                pos++;
            } else {
                out << s[pos];
                pos++;
            }
        }
        pos++; // closing quote
        v.strVal = out.str();
        return v;
    }

    static JsonValue parseBool(const std::string& s, size_t& pos) {
        JsonValue v; v.type = Type::Bool;
        if (s.compare(pos, 4, "true") == 0) { v.boolVal = true; pos += 4; }
        else { v.boolVal = false; pos += 5; } // "false"
        return v;
    }

    static JsonValue parseNumber(const std::string& s, size_t& pos) {
        JsonValue v; v.type = Type::Number;
        size_t start = pos;
        if (s[pos] == '-') pos++;
        while (pos < s.size() && (isdigit((unsigned char)s[pos]) || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) pos++;
        v.numVal = std::stod(s.substr(start, pos - start));
        return v;
    }
};

} // namespace lumvibe
