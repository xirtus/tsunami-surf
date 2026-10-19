// Shared analytic giant-wave field — the heart of TSUNAMI.
//
// A level's ocean is one endless train of colossal waves rolling downhill
// (+z), described entirely by a small JSON-able params object (see
// Levels.js for the generator). Both the water mesh (GPU, via
// buildWaveGLSL) and the rider physics (CPU, below) sample the same field,
// built from the same constants, so they stay in sync by construction.
//
// The giant band is a phase-warped solitary train: a broad flat trough, a
// peaked crest, and a steep FRONT face (the drop-in) with a gentle back
// (the climb out) — the shoaling-tsunami profile. It acts like a
// snowboarding mountain that never ends: the wave rolls forward forever
// and the world chases the rider, so the face is always there.
//
//   p  = z*K - t*W + x*PEEL + BEND*sin(x*BKX + t*BW)     crest-line shape
//   pw = p - WARP*sin(p) - ASYM*sin(2p)                  trochoid steepening
//   g  = A * sin(pw) * mod(x,t)                          lateral sections
//
// Riding texture (swell / cross / chop / fine bands) rides on top, scaled
// per level. Because the giant is analytic, its gradient is exact — no
// texture probes, no aliasing — and the shader's foam/SSS read the giant's
// steepness and crest height directly.

// Live level geometry constants — mutated in place by setWaveParams so
// modules holding the import (Rider, Crystals, Game) never go stale.
export const SLOPE = {
  width: 240,     // x extent of the surf zone (mirror walls at the edges)
  gradient: 0.10, // gentle base fall, m per m downhill — the giant dominates
  baseHeight: 40, // surface height at z = 0
  spawnZ: -110,   // drop-in point (the menu camera frames this)
};

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- riding-texture constants (fixed across levels, amplitude-scaled) -----
// The sea's own small-wave texture: an amplitude-modulated swell with a
// sharpened crest, an oblique swell, cross chop, two chop octaves and three
// fine ripples. Levels scale the swell/cross/chop amplitudes via tex.
const T = {
  E0: 2.2, E1: 1.0, EK1: 0.021, EW1: 0.24,
  E2: 0.45, EK2: 0.018, EW2: 0.19,
  PHK: 0.078, PHW: 1.15, SHARP: 0.30,
  S2: 0.95, S2X: 0.052, S2Z: 0.038, S2W: 0.68,
  CR: 0.85, CRX: 0.095, CRW: 0.95, CRZ: 0.030, CRW2: 0.50,
  C1: 0.50, C1X: 0.26, C1Z: 0.31, C1W: 2.1,
  C2: 0.34, C2X: 0.48, C2Z: 0.19, C2W: 2.9,
  F1: 0.28, F1X: 0.93, F1Z: 1.13, F1W: 3.4,
  F2: 0.19, F2X: 1.73, F2Z: 0.71, F2W: 4.6,
  F3: 0.15, F3X: 0.61, F3Z: 1.81, F3W: 2.6,
};

// --- the default field (MAVERICK — Levels.js archetype 0 emits exactly this)
export const DEFAULT_WAVE = {
  slope: { width: 240, gradient: 0.10, baseHeight: 40, spawnZ: -110 },
  giant: {
    A: 22, K: (2 * Math.PI) / 380, W: (2 * Math.PI) / 380 * 20,
    WARP: 0.55, ASYM: -0.10,
    PEEL: 0.0012, BEND: 0.40, BKX: 0.005, BW: 0.06,
    M1: 0.20, MK1: 0.010, MP1: 1.7, M2: 0.12, MK2: 0.021, MW2: 0.04,
    S2A: 6.6, S2K: (2 * Math.PI) / 380 * 1.618, S2W: (2 * Math.PI) / 380 * 20 * 0.94 * 1.618,
    S2PEEL: -0.0007, S2WARP: 0.38, S2PH: 2.4,
  },
  tex: { swell: 1.0, chop: 0.9 },
};

let P = DEFAULT_WAVE;

// Swap the active field. SLOPE is mutated in place (live import binding).
export function setWaveParams(params) {
  P = params;
  Object.assign(SLOPE, params.slope);
}
export function getWaveParams() { return P; }

// --- JS samplers -----------------------------------------------------------

// Giant band: height + analytic gradient (d/dx, d/dz), one trig evaluation.
function giantEval(x, z, t) {
  const g = P.giant;
  const mod = 1 + g.M1 * Math.sin(x * g.MK1 + g.MP1) + g.M2 * Math.sin(x * g.MK2 - t * g.MW2);
  const p = z * g.K - t * g.W + x * g.PEEL + g.BEND * Math.sin(x * g.BKX + t * g.BW);
  const pw = p - g.WARP * Math.sin(p) - g.ASYM * Math.sin(2 * p);
  const dpw = 1 - g.WARP * Math.cos(p) - 2 * g.ASYM * Math.cos(2 * p);
  const s = Math.sin(pw);
  const c = Math.cos(pw);
  const dpx = g.PEEL + g.BEND * g.BKX * Math.cos(x * g.BKX + t * g.BW);
  const dmod = g.M1 * g.MK1 * Math.cos(x * g.MK1 + g.MP1) + g.M2 * g.MK2 * Math.cos(x * g.MK2 - t * g.MW2);
  let h = g.A * s * mod;
  let gx = g.A * (c * dpw * dpx * mod + s * dmod);
  let gz = g.A * c * dpw * g.K * mod;
  if (g.S2A > 0) {
    const p2 = z * g.S2K - t * g.S2W + x * g.S2PEEL + g.S2PH;
    const pw2 = p2 - g.S2WARP * Math.sin(p2);
    const dpw2 = 1 - g.S2WARP * Math.cos(p2);
    const c2 = Math.cos(pw2);
    h += g.S2A * Math.sin(pw2);
    gx += g.S2A * c2 * dpw2 * g.S2PEEL;
    gz += g.S2A * c2 * dpw2 * g.S2K;
  }
  return { h, gx, gz };
}

export function giantHeight(x, z, t = 0) { return giantEval(x, z, t).h; }

// swell band only (the "sea level" the chop rides on; the giant is separate)
export function swellHeight(x, z, t = 0) {
  const sw = P.tex.swell;
  const env = T.E0 + T.E1 * Math.sin(z * T.EK1 - t * T.EW1) + T.E2 * Math.sin(x * T.EK2 - t * T.EW2);
  const ph = z * T.PHK - t * T.PHW;
  return (env * Math.sin(ph) + env * T.SHARP * Math.sin(2 * ph)) * sw
    + T.S2 * Math.sin(x * T.S2X + z * T.S2Z - t * T.S2W) * sw;
}

export function waveHeight(x, z, t = 0) {
  const g = giantEval(x, z, t);
  const sw = P.tex.swell, ch = P.tex.chop;
  const env = T.E0 + T.E1 * Math.sin(z * T.EK1 - t * T.EW1) + T.E2 * Math.sin(x * T.EK2 - t * T.EW2);
  const ph = z * T.PHK - t * T.PHW;
  const swell = (env * Math.sin(ph) + env * T.SHARP * Math.sin(2 * ph)) * sw;
  const swell2 = T.S2 * Math.sin(x * T.S2X + z * T.S2Z - t * T.S2W) * sw;
  const cross = T.CR * Math.sin(x * T.CRX + t * T.CRW) * Math.cos(z * T.CRZ - t * T.CRW2) * ch;
  const chop1 = T.C1 * Math.sin(x * T.C1X + z * T.C1Z - t * T.C1W) * ch;
  const chop2 = T.C2 * Math.sin(x * T.C2X + z * T.C2Z - t * T.C2W) * ch;
  const fine1 = T.F1 * Math.sin(x * T.F1X + z * T.F1Z - t * T.F1W);
  const fine2 = T.F2 * Math.sin(x * T.F2X + z * T.F2Z - t * T.F2W);
  const fine3 = T.F3 * Math.sin(x * T.F3X + z * T.F3Z - t * T.F3W);
  return SLOPE.baseHeight - z * SLOPE.gradient
    + g.h + swell + swell2 + cross + chop1 + chop2 + fine1 + fine2 + fine3;
}

// Analytic gradient of the wave-only height, split into bands (mirrors the
// GLSL waveGradBands): gS = giant + swell + oblique + cross (kept to the
// horizon), gC = chop octaves, gF = fine ripples. The fall is NOT included.
export function waveGradBands(x, z, t = 0) {
  const sw = P.tex.swell, ch = P.tex.chop;
  const g = giantEval(x, z, t);

  const env = T.E0 + T.E1 * Math.sin(z * T.EK1 - t * T.EW1) + T.E2 * Math.sin(x * T.EK2 - t * T.EW2);
  const envX = T.E2 * T.EK2 * Math.cos(x * T.EK2 - t * T.EW2);
  const envZ = T.E1 * T.EK1 * Math.cos(z * T.EK1 - t * T.EW1);
  const ph = z * T.PHK - t * T.PHW;
  const s1 = Math.sin(ph), c1 = Math.cos(ph), s2 = Math.sin(2 * ph), c2 = Math.cos(2 * ph);
  let gx = g.gx + (envX * s1 + envX * T.SHARP * s2) * sw;
  let gz = g.gz + (envZ * s1 + env * c1 * T.PHK + envZ * T.SHARP * s2 + env * T.SHARP * c2 * 2 * T.PHK) * sw;
  const a2 = x * T.S2X + z * T.S2Z - t * T.S2W;
  gx += T.S2 * T.S2X * Math.cos(a2) * sw;
  gz += T.S2 * T.S2Z * Math.cos(a2) * sw;
  const cx = x * T.CRX + t * T.CRW;
  const cz = z * T.CRZ - t * T.CRW2;
  gx += T.CR * T.CRX * Math.cos(cx) * Math.cos(cz) * ch;
  gz += -T.CR * T.CRZ * Math.sin(cx) * Math.sin(cz) * ch;
  const gS = [gx, gz];

  const p1 = x * T.C1X + z * T.C1Z - t * T.C1W;
  const p2 = x * T.C2X + z * T.C2Z - t * T.C2W;
  const gC = [
    (T.C1 * T.C1X * Math.cos(p1) + T.C2 * T.C2X * Math.cos(p2)) * ch,
    (T.C1 * T.C1Z * Math.cos(p1) + T.C2 * T.C2Z * Math.cos(p2)) * ch,
  ];

  const q1 = x * T.F1X + z * T.F1Z - t * T.F1W;
  const q2 = x * T.F2X + z * T.F2Z - t * T.F2W;
  const q3 = x * T.F3X + z * T.F3Z - t * T.F3W;
  const gF = [
    T.F1 * T.F1X * Math.cos(q1) + T.F2 * T.F2X * Math.cos(q2) + T.F3 * T.F3X * Math.cos(q3),
    T.F1 * T.F1Z * Math.cos(q1) + T.F2 * T.F2Z * Math.cos(q2) + T.F3 * T.F3Z * Math.cos(q3),
  ];
  return { gS, gC, gF };
}

// Full surface gradient including the base fall — used for surface normals.
export function waveGrad(x, z, t = 0) {
  const { gS, gC, gF } = waveGradBands(x, z, t);
  return { x: gS[0] + gC[0] + gF[0], z: gS[1] + gC[1] + gF[1] - SLOPE.gradient };
}

// Terrain-scale gradient: the giant + swell bands plus the base fall, no
// chop/ripple texture. This is the "mountain" the rider's gravity reads —
// only wavelengths long enough to carve should pump the board.
export function waveGradTerrain(x, z, t = 0) {
  const { gS } = waveGradBands(x, z, t);
  return { x: gS[0], z: gS[1] - SLOPE.gradient };
}

export function waveNormal(x, z, t = 0) {
  const g = waveGrad(x, z, t);
  const len = Math.hypot(g.x, 1, g.z);
  return { x: -g.x / len, y: 1 / len, z: -g.z / len };
}

// --- GLSL port (same constants via template injection) ---------------------
// GLSL ES 3.00 has no implicit int->float conversion, so integer-valued
// constants must be emitted with a decimal point.
const f = (n) => (Number.isInteger(n) ? n + '.0' : String(n));

// Provides:
//   float giantH(x, z, t)     the tsunami band (for the crest-driven looks)
//   float swellH(x, z, t)     swell band only (group / sea-level axis)
//   float waveH(x, z, t)      full height incl. base + fall (vertex displace)
//   void  waveGradBands(x, z, t, out gS, out gC, out gF)
//                             wave-only gradient split into swell / chop /
//                             fine bands — the caller fades bands with
//                             distance and banks the lost slope variance
//                             into roughness (no fall term included)
export function buildWaveGLSL(Pw) {
  const g = Pw.giant;
  const sw = f(Pw.tex.swell), ch = f(Pw.tex.chop);
  const G = f(Pw.slope.gradient);
  const B = f(Pw.slope.baseHeight);
  return /* glsl */ `
float giantH(float x, float z, float t) {
  float gmod = 1.0 + ${f(g.M1)}*sin(x*${f(g.MK1)} + ${f(g.MP1)}) + ${f(g.M2)}*sin(x*${f(g.MK2)} - t*${f(g.MW2)});
  float p = z*${f(g.K)} - t*${f(g.W)} + x*${f(g.PEEL)} + ${f(g.BEND)}*sin(x*${f(g.BKX)} + t*${f(g.BW)});
  float pw = p - ${f(g.WARP)}*sin(p) - ${f(g.ASYM)}*sin(2.0*p);
  float h = ${f(g.A)}*sin(pw)*gmod;
  float p2 = z*${f(g.S2K)} - t*${f(g.S2W)} + x*${f(g.S2PEEL)} + ${f(g.S2PH)};
  h += ${f(g.S2A)}*sin(p2 - ${f(g.S2WARP)}*sin(p2));
  return h;
}

vec2 giantGrad(float x, float z, float t) {
  float gmod = 1.0 + ${f(g.M1)}*sin(x*${f(g.MK1)} + ${f(g.MP1)}) + ${f(g.M2)}*sin(x*${f(g.MK2)} - t*${f(g.MW2)});
  float p = z*${f(g.K)} - t*${f(g.W)} + x*${f(g.PEEL)} + ${f(g.BEND)}*sin(x*${f(g.BKX)} + t*${f(g.BW)});
  float pw = p - ${f(g.WARP)}*sin(p) - ${f(g.ASYM)}*sin(2.0*p);
  float dpw = 1.0 - ${f(g.WARP)}*cos(p) - 2.0*${f(g.ASYM)}*cos(2.0*p);
  float s = sin(pw);
  float c = cos(pw);
  float dpx = ${f(g.PEEL)} + ${f(g.BEND)}*${f(g.BKX)}*cos(x*${f(g.BKX)} + t*${f(g.BW)});
  float dmod = ${f(g.M1)}*${f(g.MK1)}*cos(x*${f(g.MK1)} + ${f(g.MP1)}) + ${f(g.M2)}*${f(g.MK2)}*cos(x*${f(g.MK2)} - t*${f(g.MW2)});
  vec2 gr = ${f(g.A)}*vec2(c*dpw*dpx*gmod + s*dmod, c*dpw*${f(g.K)}*gmod);
  float p2 = z*${f(g.S2K)} - t*${f(g.S2W)} + x*${f(g.S2PEEL)} + ${f(g.S2PH)};
  float pw2 = p2 - ${f(g.S2WARP)}*sin(p2);
  float dpw2 = 1.0 - ${f(g.S2WARP)}*cos(p2);
  float c2 = cos(pw2);
  gr += ${f(g.S2A)}*vec2(c2*dpw2*${f(g.S2PEEL)}, c2*dpw2*${f(g.S2K)});
  return gr;
}

float swellH(float x, float z, float t) {
  float env = ${f(T.E0)} + ${f(T.E1)}*sin(z*${f(T.EK1)} - t*${f(T.EW1)}) + ${f(T.E2)}*sin(x*${f(T.EK2)} - t*${f(T.EW2)});
  float ph = z*${f(T.PHK)} - t*${f(T.PHW)};
  float swell = env*sin(ph) + env*${f(T.SHARP)}*sin(2.0*ph);
  return swell*${sw} + ${f(T.S2)}*sin(x*${f(T.S2X)} + z*${f(T.S2Z)} - t*${f(T.S2W)})*${sw};
}

float waveH(float x, float z, float t) {
  float fall = -z*${G};
  float env = ${f(T.E0)} + ${f(T.E1)}*sin(z*${f(T.EK1)} - t*${f(T.EW1)}) + ${f(T.E2)}*sin(x*${f(T.EK2)} - t*${f(T.EW2)});
  float ph = z*${f(T.PHK)} - t*${f(T.PHW)};
  float swell = (env*sin(ph) + env*${f(T.SHARP)}*sin(2.0*ph))*${sw};
  float swell2 = ${f(T.S2)}*sin(x*${f(T.S2X)} + z*${f(T.S2Z)} - t*${f(T.S2W)})*${sw};
  float cross = ${f(T.CR)}*sin(x*${f(T.CRX)} + t*${f(T.CRW)})*cos(z*${f(T.CRZ)} - t*${f(T.CRW2)})*${ch};
  float chop1 = ${f(T.C1)}*sin(x*${f(T.C1X)} + z*${f(T.C1Z)} - t*${f(T.C1W)})*${ch};
  float chop2 = ${f(T.C2)}*sin(x*${f(T.C2X)} + z*${f(T.C2Z)} - t*${f(T.C2W)})*${ch};
  float fine1 = ${f(T.F1)}*sin(x*${f(T.F1X)} + z*${f(T.F1Z)} - t*${f(T.F1W)});
  float fine2 = ${f(T.F2)}*sin(x*${f(T.F2X)} + z*${f(T.F2Z)} - t*${f(T.F2W)});
  float fine3 = ${f(T.F3)}*sin(x*${f(T.F3X)} + z*${f(T.F3Z)} - t*${f(T.F3W)});
  return ${B} + fall + giantH(x, z, t) + swell + swell2 + cross + chop1 + chop2 + fine1 + fine2 + fine3;
}

// Band gradients, for distance-faded shading: d/dx, d/dz of the wave-only
// height (the constant plane fall is NOT included — the caller adds it).
//   gS  giant + swell + oblique swell + cross (long wavelengths, kept to
//       the horizon — the giant rollers ARE the horizon silhouette)
//   gC  the two chop octaves (faded mid-field)
//   gF  the three fine ripples (faded near-field)
void waveGradBands(float x, float z, float t, out vec2 gS, out vec2 gC, out vec2 gF) {
  vec2 g = giantGrad(x, z, t);
  float env = ${f(T.E0)} + ${f(T.E1)}*sin(z*${f(T.EK1)} - t*${f(T.EW1)}) + ${f(T.E2)}*sin(x*${f(T.EK2)} - t*${f(T.EW2)});
  float envX = ${f(T.E2)}*${f(T.EK2)}*cos(x*${f(T.EK2)} - t*${f(T.EW2)});
  float envZ = ${f(T.E1)}*${f(T.EK1)}*cos(z*${f(T.EK1)} - t*${f(T.EW1)});
  float ph = z*${f(T.PHK)} - t*${f(T.PHW)};
  float s1 = sin(ph);
  float c1 = cos(ph);
  float s2 = sin(2.0*ph);
  float c2 = cos(2.0*ph);
  g.x += (envX*s1 + envX*${f(T.SHARP)}*s2)*${sw};
  g.y += (envZ*s1 + env*c1*${f(T.PHK)} + envZ*${f(T.SHARP)}*s2 + env*${f(T.SHARP)}*c2*2.0*${f(T.PHK)})*${sw};
  float a2 = x*${f(T.S2X)} + z*${f(T.S2Z)} - t*${f(T.S2W)};
  g.x += ${f(T.S2)}*${f(T.S2X)}*cos(a2)*${sw};
  g.y += ${f(T.S2)}*${f(T.S2Z)}*cos(a2)*${sw};
  float cx = x*${f(T.CRX)} + t*${f(T.CRW)};
  float cz = z*${f(T.CRZ)} - t*${f(T.CRW2)};
  g.x += ${f(T.CR)}*${f(T.CRX)}*cos(cx)*cos(cz)*${ch};
  g.y += -${f(T.CR)}*${f(T.CRZ)}*sin(cx)*sin(cz)*${ch};
  gS = g;

  vec2 c = vec2(0.0);
  float p1 = x*${f(T.C1X)} + z*${f(T.C1Z)} - t*${f(T.C1W)};
  c.x += ${f(T.C1)}*${f(T.C1X)}*cos(p1)*${ch};
  c.y += ${f(T.C1)}*${f(T.C1Z)}*cos(p1)*${ch};
  float p2 = x*${f(T.C2X)} + z*${f(T.C2Z)} - t*${f(T.C2W)};
  c.x += ${f(T.C2)}*${f(T.C2X)}*cos(p2)*${ch};
  c.y += ${f(T.C2)}*${f(T.C2Z)}*cos(p2)*${ch};
  gC = c;

  vec2 q = vec2(0.0);
  float q1 = x*${f(T.F1X)} + z*${f(T.F1Z)} - t*${f(T.F1W)};
  q.x += ${f(T.F1)}*${f(T.F1X)}*cos(q1);
  q.y += ${f(T.F1)}*${f(T.F1Z)}*cos(q1);
  float q2 = x*${f(T.F2X)} + z*${f(T.F2Z)} - t*${f(T.F2W)};
  q.x += ${f(T.F2)}*${f(T.F2X)}*cos(q2);
  q.y += ${f(T.F2)}*${f(T.F2Z)}*cos(q2);
  float q3 = x*${f(T.F3X)} + z*${f(T.F3Z)} - t*${f(T.F3W)};
  q.x += ${f(T.F3)}*${f(T.F3X)}*cos(q3);
  q.y += ${f(T.F3)}*${f(T.F3Z)}*cos(q3);
  gF = q;
}
`;
}

// Backward-compatible default (tests, tools).
export const WAVE_GLSL = buildWaveGLSL(DEFAULT_WAVE);
