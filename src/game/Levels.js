// Procedural level generator for TSUNAMI.
//
// Every level is a small seed-grown parameter set: the giant wave train
// (Waves.js), a sea palette + sky preset + moon (the mood), and the derived
// shader "look" constants (Slope.js). Seeds are fixed per archetype, so the
// named levels are reproducible; RANDOM REEF re-rolls a fresh seed (and a
// random archetype blend) every time it is highlighted.
//
// The waves themselves are infinite by construction — the field is analytic
// and the world chases the rider — so every level surfs forever.

import { mulberry32, DEFAULT_WAVE } from './Waves.js';

// --- sea palettes -----------------------------------------------------------
// The poseidon night-sea colour run (Slope.js SEA) is the reference; each
// preset multiplies it channel-wise into a new mood, with per-slot overrides
// where a flat tint would break the trough->crest balance.
const SEA_BASE = {
  trough: [0.006, 0.012, 0.021],
  abyss: [0.011, 0.026, 0.044],
  body: [0.020, 0.055, 0.095],
  crest: [0.085, 0.240, 0.350],
  bodyBlue: [0.017, 0.048, 0.095],
  scatter: [0.055, 0.165, 0.240],
  deep: [0.004, 0.009, 0.017],
};

const SEA_PRESETS = {
  neon:   { mul: [1.0, 1.0, 1.0], foam: [0.851, 0.906, 1.0] },
  blood:  { mul: [2.0, 0.55, 0.85], crest: [0.260, 0.085, 0.150], scatter: [0.200, 0.055, 0.095], foam: [1.0, 0.82, 0.88] },
  aurora: { mul: [0.65, 1.30, 0.95], crest: [0.085, 0.300, 0.230], scatter: [0.045, 0.210, 0.165], foam: [0.85, 1.0, 0.93] },
  gold:   { mul: [1.8, 1.10, 0.62], crest: [0.330, 0.205, 0.085], scatter: [0.215, 0.125, 0.055], foam: [1.0, 0.93, 0.80] },
  void:   { mul: [0.50, 0.55, 0.70], foam: [0.90, 0.95, 1.0] },
  biolum: { mul: [0.50, 1.35, 1.30], crest: [0.060, 0.300, 0.300], scatter: [0.030, 0.200, 0.215], foam: [0.80, 1.0, 0.97] },
};

function makeSea(preset) {
  const p = SEA_PRESETS[preset];
  const sea = {};
  for (const k of Object.keys(SEA_BASE)) {
    const b = SEA_BASE[k];
    sea[k] = [b[0] * p.mul[0], b[1] * p.mul[1], b[2] * p.mul[2]];
  }
  for (const k of ['crest', 'scatter', 'bodyBlue', 'abyss', 'trough', 'deep', 'body']) {
    if (p[k]) sea[k] = p[k].slice();
  }
  return sea;
}

// --- sky presets ------------------------------------------------------------
// Painted by Cosmos.makeCosmosTexture(seed, sky): gradient stops, nebula
// palette, milky-way band tint and the moon's glow layers.
const SKY_PRESETS = {
  neon: {
    stops: ['#02030a', '#070c24', '#0e1238', '#1a1246', '#241350'],
    nebulae: ['70,30,190', '190,40,140', '40,120,210', '60,210,210', '150,60,220', '210,60,120', '60,90,220', '200,140,60'],
    band: '190,210,255',
    moon: ['140,165,255', '165,185,255', '200,214,255', '238,244,255'],
    stars: ['#ffffff', '#cfe2ff', '#fff3d9', '#ffd9ea', '#d9fff4', '#d9dbff'],
  },
  blood: {
    stops: ['#0a0206', '#1c0614', '#2b0a24', '#3d0f2e', '#4a1233'],
    nebulae: ['220,40,60', '190,30,90', '255,90,60', '160,20,120', '230,60,90', '200,30,50', '255,120,90', '140,40,160'],
    band: '255,190,200',
    moon: ['255,190,170', '255,205,185', '255,224,205', '255,244,238'],
    stars: ['#ffffff', '#ffd9c9', '#ffb3c9', '#ffe9d9', '#ffc9d9', '#f3d9ff'],
  },
  aurora: {
    stops: ['#010705', '#062012', '#0a2f24', '#0d3a33', '#123f42'],
    nebulae: ['40,220,140', '30,190,190', '80,255,170', '20,140,120', '60,210,230', '120,255,190', '30,160,90', '90,230,200'],
    band: '170,255,220',
    moon: ['150,255,210', '175,255,220', '205,255,232', '240,255,248'],
    stars: ['#ffffff', '#d9fff4', '#c9ffe9', '#e9fff9', '#b3f0ff', '#d9ffdf'],
  },
  gold: {
    stops: ['#0b0503', '#241006', '#3a1c08', '#4d2a0c', '#5c3610'],
    nebulae: ['230,150,50', '255,180,80', '200,90,40', '255,210,120', '180,120,60', '240,160,90', '210,130,70', '255,190,140'],
    band: '255,220,170',
    moon: ['255,210,150', '255,220,170', '255,232,195', '255,248,235'],
    stars: ['#ffffff', '#fff3d9', '#ffe9c9', '#ffd9a9', '#f9e9c9', '#fff9e9'],
  },
  void: {
    stops: ['#000000', '#020208', '#050510', '#0a0a18', '#101022'],
    nebulae: ['40,50,120', '30,40,100', '50,60,140', '25,35,90', '45,55,130', '35,45,110', '55,65,150', '20,30,80'],
    band: '200,210,235',
    moon: ['190,200,235', '205,214,240', '222,230,248', '245,248,255'],
    stars: ['#ffffff', '#e9efff', '#d9e2ff', '#cfd9f9', '#f9fbff', '#dfe9ff'],
  },
  biolum: {
    stops: ['#020608', '#061420', '#0a2033', '#0d2a40', '#123352'],
    nebulae: ['30,190,230', '60,120,255', '40,230,200', '90,80,240', '20,160,200', '70,200,255', '110,110,250', '30,220,170'],
    band: '170,230,255',
    moon: ['150,220,255', '170,228,255', '195,238,255', '235,250,255'],
    stars: ['#ffffff', '#c9f0ff', '#b3e5ff', '#d9f9ff', '#a9d9ff', '#e0f5ff'],
  },
};

// Moon placements. The camera looks downhill (+z), so a low moon ahead lays
// a glitter road down the faces; a moon behind rims the crests against dark
// faces. (directions, normalised on use)
const MOONS = {
  shoulder: [70, 110, -60],
  road: [30, 52, 230],
  backlit: [-120, 60, 190],
  rim: [-40, 90, -210],
};

// --- level archetypes -------------------------------------------------------
// Numeric entries are exact; [min, max] entries are filled from the seed.
//   A, L, C   giant amplitude (m), wavelength (m), phase speed (m/s)
//   WARP      crest sharpening (trochoid) — heavy levels run 0.65+
//   ASYM      front-face steepening (negative = steeper drop-in)
//   chop      riding-texture amplitude scale
//   stack     second wave train, as a fraction of A (0 = off)
const ARCHETYPES = [
  {
    id: 'maverick', name: 'MAVERICK', tag: 'the classic giant — steep drops, long walls',
    sky: 'neon', moon: 'shoulder', seed: 20260822,
    A: 22, L: 380, C: 20, WARP: 0.55, ASYM: -0.10, chop: 0.9, stack: 0.30, grad: 0.10,
    fixed: DEFAULT_WAVE, // the default field — identical by construction
  },
  {
    id: 'firstlight', name: 'FIRST LIGHT', tag: 'mellow dawn rollers — learn the face',
    sky: 'aurora', moon: 'road', seed: 1013,
    A: [9, 13], L: [320, 420], C: [14, 18], WARP: [0.35, 0.48], ASYM: [-0.10, -0.05],
    chop: [0.45, 0.7], stack: 0, grad: 0.08,
  },
  {
    id: 'teahupoo', name: 'TEAHUPOO', tag: 'thick lips over the ledge — heavy',
    sky: 'blood', moon: 'backlit', seed: 2017,
    A: [13, 17], L: [240, 300], C: [13, 16], WARP: [0.68, 0.78], ASYM: [-0.16, -0.10],
    chop: [0.7, 0.95], stack: [0.15, 0.25], grad: [0.08, 0.12],
  },
  {
    id: 'jaws', name: 'JAWS', tag: 'big, fast and long — hold a line',
    sky: 'neon', moon: 'backlit', seed: 3041,
    A: [26, 32], L: [400, 480], C: [22, 26], WARP: [0.48, 0.58], ASYM: [-0.10, -0.06],
    chop: [0.8, 1.1], stack: [0.20, 0.30], grad: [0.09, 0.13],
  },
  {
    id: 'nazare', name: 'NAZARÉ', tag: 'the biggest water on earth',
    sky: 'void', moon: 'road', seed: 4057,
    A: [34, 42], L: [460, 560], C: [24, 30], WARP: [0.42, 0.52], ASYM: [-0.08, -0.04],
    chop: [0.9, 1.2], stack: [0.25, 0.35], grad: [0.08, 0.12],
  },
  {
    id: 'pipeline', name: 'PIPELINE', tag: 'quick pitchy peelers — air sections',
    sky: 'biolum', moon: 'road', seed: 5089,
    A: [8, 12], L: [210, 280], C: [15, 20], WARP: [0.60, 0.72], ASYM: [-0.14, -0.08],
    chop: [1.0, 1.3], stack: [0.20, 0.30], grad: [0.09, 0.13],
  },
  {
    id: 'cortes', name: 'CORTES BANK', tag: 'long-period open-ocean walls',
    sky: 'gold', moon: 'road', seed: 6023,
    A: [16, 22], L: [480, 600], C: [20, 24], WARP: [0.35, 0.45], ASYM: [-0.08, -0.04],
    chop: [0.6, 0.9], stack: [0.10, 0.20], grad: [0.07, 0.10],
  },
  {
    id: 'shipstern', name: 'SHIPSTERN', tag: 'stepped double-up sets',
    sky: 'biolum', moon: 'backlit', seed: 7051,
    A: [15, 20], L: [330, 420], C: [17, 22], WARP: [0.52, 0.62], ASYM: [-0.12, -0.08],
    chop: [0.8, 1.0], stack: [0.40, 0.50], grad: [0.09, 0.13],
  },
  {
    id: 'dungeons', name: 'DUNGEONS', tag: 'cold black water — hold your nerve',
    sky: 'void', moon: 'rim', seed: 8009,
    A: [18, 24], L: [360, 460], C: [18, 23], WARP: [0.50, 0.62], ASYM: [-0.12, -0.08],
    chop: [1.1, 1.4], stack: [0.20, 0.30], grad: [0.09, 0.13],
  },
  {
    id: 'goldenhour', name: 'GOLDEN HOUR', tag: 'bronze glass and an endless glitter road',
    sky: 'gold', moon: 'road', seed: 9103,
    A: [12, 18], L: [340, 460], C: [16, 21], WARP: [0.42, 0.55], ASYM: [-0.10, -0.06],
    chop: [0.5, 0.8], stack: [0.10, 0.20], grad: [0.08, 0.11],
  },
];

const pick = (rnd, v) => (Array.isArray(v) ? v[0] + rnd() * (v[1] - v[0]) : v);

// Build the wave params for an archetype from a seed.
export function buildWaveParams(arch, seed) {
  if (arch.fixed) return arch.fixed;
  const rnd = mulberry32(seed);
  const A = pick(rnd, arch.A);
  const L = pick(rnd, arch.L);
  const C = pick(rnd, arch.C);
  const K = (2 * Math.PI) / L;
  const stack = pick(rnd, arch.stack);
  const S2K = K * 1.618;
  return {
    slope: { width: 240, gradient: pick(rnd, arch.grad), baseHeight: 40, spawnZ: -110 },
    giant: {
      A, K, W: K * C,
      WARP: pick(rnd, arch.WARP), ASYM: pick(rnd, arch.ASYM),
      PEEL: (rnd() - 0.3) * 0.004,                       // crest-line tilt
      BEND: 0.25 + rnd() * 0.45, BKX: 0.0035 + rnd() * 0.004, BW: 0.04 + rnd() * 0.05,
      M1: 0.16 + rnd() * 0.10, MK1: 0.007 + rnd() * 0.007, MP1: rnd() * Math.PI * 2,
      M2: 0.08 + rnd() * 0.08, MK2: 0.016 + rnd() * 0.010, MW2: 0.03 + rnd() * 0.04,
      S2A: A * stack, S2K, S2W: S2K * C * (0.90 + rnd() * 0.08),
      S2PEEL: (rnd() - 0.7) * 0.003, S2WARP: 0.30 + rnd() * 0.25, S2PH: rnd() * Math.PI * 2,
    },
    tex: { swell: 0.8 + rnd() * 0.5, chop: pick(rnd, arch.chop) },
  };
}

// Per-level shader look constants, derived from the wave scale: how tall the
// giant stands before the shader treats it as thin lit crest, how deep the
// emerald lip glows, how much whitewater the face carries.
function deriveLook(wave) {
  const g = wave.giant;
  const aRef = g.A * (1 + g.M1 + g.M2); // tallest section the modulation builds
  return {
    WAVE_SCALE: Math.max(2.6, g.A * 0.28),
    GIANT_REF: aRef,
    GIANT_LIP: 1.15,
    GIANT_SSS: 0.85,
    GIANT_PATH: aRef * 0.055,
  };
}

// Menu stats: face height (crest to trough in the peak sections), set period,
// phase speed, and a one-word mood.
function deriveStats(arch, wave) {
  const g = wave.giant;
  const face = Math.round(2 * g.A * (1 + g.M1 + g.M2));
  const period = Math.round(2 * Math.PI / g.K / (g.W / g.K)); // λ / c
  const kmh = Math.round((g.W / g.K) * 3.6);
  const mood =
    g.A >= 30 ? 'GIANT' :
    g.WARP >= 0.65 ? 'HEAVY' :
    (2 * Math.PI) / g.K >= 480 ? 'MELLOW' :
    g.A <= 13 ? 'PLAYFUL' : 'HOLLOW';
  return { face, period, kmh, mood };
}

export function buildLevel(arch, seed = arch.seed) {
  const wave = buildWaveParams(arch, seed);
  const sky = SKY_PRESETS[arch.sky];
  return {
    id: arch.id,
    name: arch.name,
    tag: arch.tag,
    seed,
    wave,
    look: deriveLook(wave),
    sea: makeSea(arch.sky),
    foam: SEA_PRESETS[arch.sky].foam,
    sky,
    moonDir: MOONS[arch.moon],
    stats: deriveStats(arch, wave),
    swatches: [sky.stops[3], sky.nebulae[0] && `rgb(${sky.nebulae[0]})`, sky.moon[3] && `rgb(${sky.moon[3]})`],
  };
}

export const LEVELS = ARCHETYPES.map((a) => buildLevel(a));
export const DEFAULT_LEVEL = LEVELS[0];

// A fresh reef every roll: random archetype bones with a random seed.
export function randomLevel() {
  const arch = ARCHETYPES[1 + Math.floor(Math.random() * (ARCHETYPES.length - 1))];
  const seed = (Math.random() * 0x7fffffff) | 0;
  const level = buildLevel(arch, seed);
  return { ...level, id: 'random', random: true, name: 'RANDOM REEF', tag: `${arch.tag} — seed ${seed.toString(36)}` };
}
