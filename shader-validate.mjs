// Compiles the game's water shaders (with three.js's GLSL3 prefix replicated)
// through Khronos glslang to catch syntax/type errors without a browser.
// Every level generates its own shader pair (wave constants + palette are
// template-injected), so validate them all.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { buildWaterShaders } from './src/game/Slope.js';
import { LEVELS } from './src/game/Levels.js';

// node's fetch cannot read file:// URLs; the glslang web build fetches its
// wasm through fetch, so teach it.
const origFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => {
  if (typeof url === 'string' && url.startsWith('file://')) {
    return Promise.resolve(new Response(readFileSync(fileURLToPath(url)), {
      status: 200,
      headers: { 'Content-Type': 'application/wasm' },
    }));
  }
  return origFetch(url, opts);
};

const glslangInit = (await import('./tools/glslang/glslang.js')).default;
const glslang = await glslangInit();

const colorStubs = `
#define TONE_MAPPING
vec3 toneMapping(vec3 c) { return c; }
vec4 linearToOutputTexel(vec4 c) { return c; }
`;

const prefixVertex = `#version 450
#define attribute in
#define varying out
#define texture2D texture
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
layout(location = 10) in vec3 position;
layout(location = 11) in vec3 normal;
layout(location = 12) in vec2 uv;
`;

const prefixFragment = `#version 450
#define varying in
#define texture2D texture
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
uniform bool isOrthographic;
` + colorStubs;

// Vulkan semantics require non-opaque uniforms in a block and explicit
// locations on user in/out — validation-only transform, the shipped shader
// stays OpenGL ES 3.0 style.
function vkWrap(source) {
  let loc = 0;
  source = source.replace(/^\s*varying\s+(.*);/gm, (m, decl) =>
    `layout(location = ${loc++}) varying ${decl};`);
  const decls = [];
  let bind = 1;
  let out = source.replace(/^\s*uniform\s+sampler2D\s+(\w+)\s*;/gm, (m, name) => {
    return `layout(binding = ${bind++}) uniform sampler2D ${name};`;
  });
  out = out.replace(/^\s*uniform\s+(?!sampler)([\w]+)\s+(\w+)\s*(\[\d+\])?\s*;/gm, (m) => {
    decls.push(m.trim().replace(/^uniform\s+/, ''));
    return '';
  });
  const versionMatch = out.match(/^#version[^\n]*\n/);
  const version = versionMatch ? versionMatch[0] : '';
  const rest = version ? out.slice(version.length) : out;
  return version + 'layout(set = 0, binding = 0) uniform ShaderUniforms {\n  ' + decls.join('\n  ') + '\n};\n' + rest;
}

let failed = 0;
for (const level of LEVELS) {
  const shaders = buildWaterShaders(level);
  for (const [name, type, src] of [
    ['vertex', 'vertex', shaders.vertex],
    ['fragment', 'fragment', shaders.fragment],
  ]) {
    const prefix = type === 'vertex' ? prefixVertex : prefixFragment;
    try {
      const spirv = glslang.compileGLSL(vkWrap(prefix + src), type, false);
      console.log(`[OK] ${level.name} ${name} shader compiles clean (${spirv.length} SPIR-V words)`);
    } catch (e) {
      failed++;
      console.log(`[FAIL] ${level.name} ${name} shader:\n${e.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
