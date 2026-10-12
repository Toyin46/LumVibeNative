export const EXT_HEADER =
  "#extension GL_OES_EGL_image_external : require\nprecision mediump float;\n";

// Standard full-screen passthrough vertex shader — used by every effect
// that doesn't override vertexShader in its EffectDefinition. Ported
// unchanged from the old EffectShaders.kt's effectVertexShader.
export const PASSTHROUGH_VERTEX = `
uniform mat4 uTexMatrix;
attribute vec4 aPosition;
attribute vec4 aTexCoord;
varying mediump vec2 vTexCoord;
void main() {
  gl_Position = aPosition;
  vTexCoord = (uTexMatrix * aTexCoord).xy;
}
`.trim();
