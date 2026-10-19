import * as THREE from 'three';
import { buildWaveGLSL, DEFAULT_WAVE } from './Waves.js';
import { DEFAULT_LEVEL } from './Levels.js';
import { makeDetailTexture } from './poseidon/detailTexture.js';
import { diffusionAttenuation } from './poseidon/water.js';

// The endless giant wave, shaded as real water.
//
// The surface is a dense grid displaced on the GPU by the same analytic
// giant-wave field the rider physics sample (Waves.js), then shaded with a
// GLSL port of poseidon's ocean surface model (poseidon-src/src/ocean/
// oceanSurfaceMaterial.js, MIT): exact dielectric Fresnel over a reflected
// cosmos panorama, a body colour run from near-black trough to moonlit
// crest, Jerlov-diffusion subsurface scatter through measured crest
// thickness, a GGX moon-glitter road, steepness-born foam carved with
// poseidon's baked cellular/fbm detail texture, and self-composited haze.
//
// On top of the port, the giant band drives its own looks: the tall upper
// face reads as thin lit water (the emerald room), the lip's longer light
// path deepens the teal with wave size, and foam gates onto the crest so
// whitewater crowns the breaking face instead of smearing the trough.
//
// Levels swap live: setLevel() rebuilds the shader pair from the level's
// wave params + palette (the geometry is reused — it is just a grid).

const WATER = {
  // world extents of the surface around the rider (the mesh chases them).
  // The coarse rings run PAST the 3 km sky dome, so every view ray meets the
  // dome before it can meet the mesh's edge: the geometric edge is never
  // visible at all, and the haze only has to dissolve the water where the
  // dome crosses it (~2.9 km, where 1-exp(-2900*0.002) = 99.7% extinct).
  xMin: 3200, zMin: 3200,
  dense: { x: 130, zMin: -300, zMax: 520 },
  spacing: 0.6,              // dense cell size, metres
  mid: 28, midReach: 1300,   // middle ring: faces stay smooth far out
  coarse: 128,               // outer ring cell size, metres
};

const MAX_LIGHTS = 6; // crystal point lights splashing onto the water

// --- look constants --------------------------------------------------------
// Ported from poseidon's oceanSurfaceMaterial.js and retuned for this scene.
// The giant-driven additions (GIANT_*) are per-level, derived in Levels.js.
const O = {
  // air/water interface — refractive index of sea water (Quan & Fry 1995)
  ETA_AW: 1 / 1.34,
  ETA2: (1 / 1.34) ** 2,

  // sky reflection hold-back: near water keeps its body colour, the far field
  // is released toward mirror, and a hard ceiling keeps 14% of the sea's own
  // hue in every pixel.
  REFL_NEAR: 0.45, GRAZE_RANGE: 300, GRAZE_AMOUNT: 0.15, REFL_CEIL: 0.86,
  REFL_RELAX: 1.7, REFL_RELAX_MAX: 0.74,
  GLINT_CLAMP: 0.9,
  REFL_FILTER: [0.88, 1.00, 1.10],
  REFL_CHROMA: 0.62, REFL_DESAT: 1.8, REFL_DESAT_CAP: 0.60,
  REFL_GREY: [0.84, 1.00, 1.21],

  // roughness from sub-pixel detail + footprint
  ROUGH_FLOOR: 0.075, ROUGH_FROM_VAR: 0.60, ROUGH_FROM_BAND: 0.30,
  ROUGH_FROM_FOOT: 0.30, ROUGH_FOOT_SCALE: 0.55, ROUGH_MAX: 0.60,

  // distance at which each analytic wave band fades out of the normal (its
  // lost slope variance is banked into roughness — the Toksvig trade). The
  // swell+giant band runs to the horizon: long wavelengths never alias.
  CHOP_FADE_RANGE: 300, FINE_FADE_RANGE: 45,

  // capillary ripple differenced out of the detail texture's height channels
  RIPPLE_TILE: 0.55, RIPPLE_STEP: 2.5 / 512, RIPPLE_GAIN: 2.6, RIPPLE_FINE: 0.7,
  RIPPLE_FOOT: 0.22, RIPPLE_OCT: 4.0, RIPPLE_OCT_AMP: 0.85, RIPPLE_STRENGTH: 0.12,

  // body colour run: trough floor -> body -> thin lit crest, asymptotic ramps
  HEIGHT_SOFT: 1.3, BODY_BIAS: 1.07, BODY_SOFT: 0.27,
  GROUP_SCALE: 3.4, GROUP_SOFT: 1.0, GROUP_DARK: 0.50, CHOP_LIFT: 0.55,
  SKY_VIS_MIN: 0.34, SHADOW_LUM: 0.487,
  SHALLOW_MAX: 0.88, SCATTER_GAIN: 0.72, SCATTER_BASE: 0.16,

  // subsurface scatter: measured crest thickness, refracted path, Jerlov mu
  SSS_DEPTH: 0.80, SSS_G: 0.62, LIP_TIP: 0.60, LIP_BASE: 3.00,
  SSS_GAIN: 1.7, SSS_MAX: 0.75,

  // the water mass' own colour wander (depth, turbidity) — detail texture axes
  MASS_SCALE: 0.011, MASS_NEAR: 0.042, MASS_FINE: 0.22, MASS_AMOUNT: 1.35,
  MASS_SOFT: 0.55, MASS_HUE: 0.008, MASS_HUE_AMOUNT: 0.50,

  // moon glitter: saturating GGX, knee for the wash, boost for near-mirror facets.
  // The glint boost is tuned for grazing giant faces: at full poseidon strength
  // the fresnel term turns every aligned flank into a white blot.
  SPEC_KNEE: 3.0, SPEC_MAX: 3.2, SPEC_WHITE: 0.25,
  SPEC_ROUGH_MIN: 0.17, SPEC_ROUGH_MAX: 0.40,
  SPEC_SPREAD_RANGE: 400, SPEC_SPREAD: 0.035,
  SPEC_AA_VAR: 6.0, SPEC_AA_DESAT: 0.6,
  GLINT_MIN: 2.2, GLINT_KNEE: 6.0, GLINT_BOOST: 3.5,

  // foam: born on steep mid-band faces, remembered across three time lags
  FOAM_STEEP_LO: 0.42, FOAM_STEEP_HI: 0.62,
  FOAM_LAG1: 0.45, FOAM_LAG2: 1.0, FOAM_MEM1: 0.62, FOAM_MEM2: 0.38,
  ENV_TILE_C: 500, ENV_TILE_F: 160, ENV_C: 1.2, ENV_F: 0.65,
  // the carve: domain-warped, constant-rotated, non-harmonic tiles (poseidon)
  CARVE_MEAN: 0.4089, CARVE_STD1: 0.1328,
  CARVE_TILE_C: 7, CARVE_TILE_F: 7 / (3 + (1 + Math.sqrt(5)) / 2),
  CARVE_WARP_TILE: 44, CARVE_WARP_AMP: 3.5,
  CARVE_WARP_RHO: 0.249, CARVE_WARP_ORTH: 1 / Math.sqrt(1 - 0.249 ** 2),
  CARVE_ROT_C: Math.cos(Math.atan(2 / (1 + Math.sqrt(5)))),
  CARVE_ROT_S: Math.sin(Math.atan(2 / (1 + Math.sqrt(5)))),
  CARVE_FOOT_F: 0.15,
  RAMP_IN: 0.10, RAMP_FULL: 0.80, RAMP_MED_TOP: 0.50, RAMP_MED_IN: 0.45,
  RAMP_SPARSE_MIN: 0.25, SPARSE_CLIP: -2 * 0.1328,
  CARVE_W_C: 0.62, CARVE_W_F: 0.38,
  AGE_END: 0.72, AGE_U_DEATH4: 0.2138, AGE_FAR_LO: 1.125, AGE_FAR_HI: 4.5,
  TONE_FAR: 0.78, LACE_MEAN: 0.4089, LACE_HALF: 2 * 0.1328, LACE_MIN: 0.78,
  TONE_FLOOR: 0.45,
  FOAM_AMB: 0.55, FOAM_SUN: 0.60, FOAM_WRAP: 0.30, FOAM_FWD: 0.15,
  FOAM_BRIGHT: 1.0, FOAM_RED_AGED: 0.889, FOAM_SPEC_FILM: 0.5,
  FOAM_RELIEF_NORM: 1 / (0.01906 * Math.hypot(0.55, 1)), FOAM_RELIEF_CLAMP: 2.0,
  FOAM_RELIEF_FINE: 0.6, FOAM_RELIEF_OCT: 0.55, FOAM_RELIEF_STRENGTH: 0.18,
  SCUD_TONE: 0.18 / 0.475, BUB_SUN_T: 1 - 0.475, MILK_PATH: Math.sqrt(0.60 * 3.00),
  BUB_TILE: 2.2, BUB_CONTRAST: 0.45, BUB_PLUME_MAX: 1.9, FOAM_MILK: 0.45,
  APRON_DROP: 0.1545, APRON_SPAN: 0.30, APRON_COV_GAIN: 4.8,
  APRON_FOOT: 3.0, APRON_ALPHA: 0.40, SCUD_OCC_MIN: 0.45,

  // self-composited aerial perspective: a FLAT density, on purpose — an
  // altitude-dependent haze would thin over the high crests and leave their
  // silhouettes visible where they meet the sky dome.
  HAZE_DENSITY: 0.002, SEA_SINK: 0.92,
  FAR_SINK: 0.78, FAR_SINK_RANGE: 500,

  // crystal point-light splashes
  LIGHT_DIFFUSE: 0.07, LIGHT_SPEC: 0.8,
};

const MU_CLEAR = diffusionAttenuation('1C');
const MU_TURBID = diffusionAttenuation('3C');

const DETAIL_TEX = makeDetailTexture();
const RECIP_PI2 = 1 / (2 * Math.PI);
const RECIP_PI = 1 / Math.PI;

// GLSL ES 3.00 has no implicit int->float conversion, so integer-valued
// constants must be emitted with a decimal point (MAX_LIGHTS stays an int).
const f = (n) => (Number.isInteger(n) ? n + '.0' : String(n));
const v3 = (a) => `vec3(${a.map(f).join(', ')})`;

function buildVertexShader(level) {
  return /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vXZ;
varying float vWave;
varying float vSwell;
varying float vGiant;

${buildWaveGLSL(level.wave)}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float h = waveH(wp.x, wp.z, uTime);
  wp.y = h;
  vWorld = wp.xyz;
  vXZ = wp.xz;
  float fall = -wp.z * ${f(level.wave.slope.gradient)};
  vWave = h - (${f(level.wave.slope.baseHeight)} + fall);
  vSwell = swellH(wp.x, wp.z, uTime);
  vGiant = giantH(wp.x, wp.z, uTime);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
}

function buildFragmentShader(level) {
  const SEA = level.sea;
  const LK = level.look;
  const G = f(level.wave.slope.gradient);
  return /* glsl */ `
uniform float uTime;
uniform float uSkyRot;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uAmbient;
uniform vec3 uFoamColor;
uniform sampler2D uSky;
uniform sampler2D uDetail;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightCol[${MAX_LIGHTS}];

varying vec3 vWorld;
varying vec2 vXZ;
varying float vWave;
varying float vSwell;
varying float vGiant;

// GLSL3 ShaderMaterial must declare its own output (three does not)
layout(location = 0) out vec4 outColor;

${buildWaveGLSL(level.wave)}

const float PI = 3.14159265358979;

float sat(float x) { return clamp(x, 0.0, 1.0); }

// Exact unpolarised dielectric Fresnel (n = 1.34), not Schlick — it owns the
// grazing end of the curve this scene spends most of its frame at.
float fresnelDielectric(float cosI, float eta) {
  float ci = abs(cosI);
  float k = 1.0 - eta * eta * (1.0 - ci * ci);
  float ct = sqrt(max(k, 0.0));
  float ec = eta * ci;
  float et = eta * ct;
  float rs = (ec - ct) / max(ec + ct, 1e-5);
  float rp = (et - ci) / max(et + ci, 1e-5);
  return 0.5 * (rs * rs + rp * rp);
}

// Henyey-Greenstein, peak-normalised so g sets the lobe's WIDTH, never its level.
float hgForward(float g, float cosT) {
  float r = (1.0 - g) * (1.0 - g) / max(1.0 + g * g - cosT * (2.0 * g), 1e-4);
  return r * sqrt(r);
}

float softPos(float x, float k) { return (x + sqrt(x * x + k * k)) * 0.5; }

// The cosmos panorama, same equirect convention the dome is painted with.
vec3 skySample(vec3 dir, float lod) {
  vec3 d = normalize(dir);
  float cr = cos(uSkyRot);
  float sr = sin(uSkyRot);
  d = vec3(d.x * cr - d.z * sr, d.y, d.x * sr + d.z * cr);
  float u = atan(d.z, d.x) * ${RECIP_PI2} + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) * ${RECIP_PI} + 0.5;
  return textureLod(uSky, vec2(u, v), lod).rgb;
}

// Sub-grid capillary ripple, differenced out of the detail texture's height
// channels (B/A). The zw pair is the foam micro-relief slope, same taps.
vec4 rippleGrad(vec2 vXZ, float t, float scale, vec2 drift) {
  vec2 uv = vXZ * scale + drift;
  float e = ${f(O.RIPPLE_STEP)};
  vec4 c0 = texture2D(uDetail, uv);
  vec4 cx = texture2D(uDetail, uv + vec2(e, 0.0));
  vec4 cy = texture2D(uDetail, uv + vec2(0.0, e));
  return vec4(
    (cx.b - c0.b) + (cx.a - c0.a) * ${f(O.RIPPLE_FINE)},
    (cy.b - c0.b) + (cy.a - c0.a) * ${f(O.RIPPLE_FINE)},
    (cx.r - c0.r) + (cx.g - c0.g) * ${f(O.FOAM_RELIEF_FINE)},
    (cy.r - c0.r) + (cy.g - c0.g) * ${f(O.FOAM_RELIEF_FINE)});
}

void main() {
  float t = uTime;
  vec3 UP = vec3(0.0, 1.0, 0.0);

  vec3 V = normalize(cameraPosition - vWorld);
  float viewDist = length(cameraPosition - vWorld);

  // --- geometric normal, exact from the analytic field ---------------------
  // The chop and fine bands fade with distance; the giant+swell band runs to
  // the horizon — the giant rollers ARE the horizon silhouette.
  vec2 gS, gC, gF;
  waveGradBands(vXZ.x, vXZ.y, t, gS, gC, gF);
  float chopF = exp(-viewDist / ${f(O.CHOP_FADE_RANGE)});
  float fineF = exp(-viewDist / ${f(O.FINE_FADE_RANGE)});
  vec2 gWave = gS + gC * chopF + gF * fineF;
  vec3 N = normalize(vec3(-gWave.x, 1.0, -(gWave.y - ${G})));

  // sub-grid capillary ripple, two scales, each fading out at its own footprint
  float footprint = max(fwidth(vXZ.x), fwidth(vXZ.y)) + 1e-3;
  float fadeA = sat(${f(O.RIPPLE_FOOT)} / footprint);
  float fadeB = sat(${O.RIPPLE_FOOT / O.RIPPLE_OCT} / footprint);
  vec4 gradA = rippleGrad(vXZ, t, ${f(O.RIPPLE_TILE)}, vec2(t * 0.035, t * 0.022));
  vec4 gradB = rippleGrad(vXZ, t, ${O.RIPPLE_TILE * O.RIPPLE_OCT}, vec2(t * -0.09, t * 0.06));
  vec2 detail = (gradA.xy * fadeA + gradB.xy * ${f(O.RIPPLE_OCT_AMP)} * fadeB)
    * ${f(O.RIPPLE_GAIN)} * ${f(O.RIPPLE_STRENGTH)};
  N = normalize(N + vec3(-detail.x, 0.0, -detail.y));

  // foam micro-relief slope rides the same taps, normalised to unit rms
  vec2 reliefGrad = (gradB.zw * fadeB + gradA.zw * ${f(O.FOAM_RELIEF_OCT)} * fadeA)
    * ${f(O.FOAM_RELIEF_NORM)};

  // --- roughness: floor + lost ripple variance + faded band variance --------
  float lostBand = dot(gC, gC) * (1.0 - chopF * chopF)
    + dot(gF, gF) * (1.0 - fineF * fineF);
  float lostVar = lostBand * ${f(O.ROUGH_FROM_BAND)}
    + ${f(O.RIPPLE_STRENGTH)} * ${f(O.RIPPLE_STRENGTH)} * (2.0 - fadeA - fadeB)
      * 0.35 * ${f(O.ROUGH_FROM_VAR)};
  float rough = min(sqrt(${f(O.ROUGH_FLOOR)} * ${f(O.ROUGH_FLOOR)}
    + lostVar
    + sat(footprint * ${f(O.ROUGH_FOOT_SCALE)}) * ${f(O.ROUGH_FROM_FOOT)}), ${f(O.ROUGH_MAX)});

  float NoV = sat(dot(N, V));

  float fresRaw = fresnelDielectric(NoV, ${f(O.ETA_AW)});
  float distF = sat(viewDist / ${f(O.GRAZE_RANGE)});
  float fres = fresRaw;
  fres *= mix(${f(O.REFL_NEAR)}, 1.0, distF);
  fres = mix(fres, 1.0, distF * ${f(O.GRAZE_AMOUNT)});
  fres = min(fres, ${f(O.REFL_CEIL)});

  // --- sky reflection --------------------------------------------------------
  vec3 flatN = normalize(vec3(0.0, 1.0, ${G}));
  vec3 Rm = reflect(-V, N);
  vec3 R = normalize(mix(Rm, reflect(-V, flatN),
    sat(rough * ${f(O.REFL_RELAX)}) * ${f(O.REFL_RELAX_MAX)}));
  vec2 azN = normalize(vec2(R.x, R.z) + vec2(1e-4));
  float elev = max(R.y, R.y * -0.35 + 0.007);
  float flatH = sqrt(sat(1.0 - elev * elev));
  vec3 refl = skySample(vec3(azN.x * flatH, elev, azN.y * flatH), rough * 6.0);
  refl *= 1.0 - sat(-R.y * 5.0) * 0.6;
  float peak = max(max(refl.r, refl.g), refl.b);
  refl /= 1.0 + max(peak - 1.0, 0.0) * rough * ${f(O.GLINT_CLAMP)};
  refl *= mix(vec3(1.0), ${v3(O.REFL_FILTER)}, rough);
  float reflL = dot(refl, vec3(0.2126, 0.7152, 0.0722));
  refl = mix(refl, mix(${v3(O.REFL_GREY)} * reflL, refl, ${f(O.REFL_CHROMA)}),
    sat(rough * ${f(O.REFL_DESAT)}) * ${f(O.REFL_DESAT_CAP)});
  float nVarR = fwidth(N.x) + fwidth(N.z);
  refl = mix(refl, ${v3(O.REFL_GREY)} * reflL, sat(nVarR * 2.5) * 0.55);

  // --- body: trough floor to crest lip on three independent axes ------------
  float hN = vWave / ${f(LK.WAVE_SCALE)};
  float lift = hN / (abs(hN) + ${f(O.HEIGHT_SOFT)}) * 0.5 + 0.5;
  float facing = sat(dot(N, UP));

  // wave group (swell) and chop crest, as their own axes
  float gN = vSwell / ${f(O.GROUP_SCALE)};
  float group = gN / (abs(gN) + ${f(O.GROUP_SOFT)}) * 0.5 + 0.5;
  float chopS = (vWave - vSwell - vGiant) / 1.6;
  float chopP = softPos(chopS, 0.30);
  float chop = chopP / (chopP + 1.0);
  // measured thickness: how far the chop stands proud of the swell (the
  // giant is excluded — it gets its own crest axis below)
  float crestP = softPos((vWave - vSwell - vGiant) / ${f(O.SSS_DEPTH)}, 0.15);
  float thinP = crestP / (crestP + 0.70);

  // the giant's own crest axis: how high this point stands on the tsunami
  float thinG = smoothstep(${f(LK.GIANT_REF * -0.05)}, ${f(LK.GIANT_REF * 0.62)}, vGiant);

  // the water mass carries its own colour, wandering on scales longer than
  // the waves — depth, turbidity — on three octaves of the baked noise
  float mass = (texture2D(uDetail, vXZ * ${f(O.MASS_SCALE)} + vec2(t * 0.0016, t * -0.0011)).b
    + texture2D(uDetail, vXZ * ${f(O.MASS_NEAR)} + vec2(t * -0.01, t * 0.008)).b * 0.6
    + texture2D(uDetail, vXZ * ${f(O.MASS_FINE)} + vec2(t * 0.02, t * 0.03)).a * 0.30)
    / 1.9 - 0.5;
  mass *= ${f(O.MASS_AMOUNT)};
  float massT = mass / (abs(mass) + ${f(O.MASS_SOFT)}) * 0.5 + 0.5;
  vec3 muWater = mix(${v3(MU_TURBID)}, ${v3(MU_CLEAR)}, massT);
  vec3 abyss = mix(${v3(SEA.deep)}, ${v3(SEA.abyss)}, 0.65);
  vec3 deepBody = mix(${v3(SEA.body)}, abyss, massT);
  float hue = (texture2D(uDetail, vXZ * ${f(O.MASS_HUE)} + vec2(t * -0.0022, t * 0.0017)).a - 0.5) * 2.2;
  deepBody = mix(deepBody, ${v3(SEA.bodyBlue)},
    (hue / (abs(hue) + 0.9) * 0.5 + 0.5) * ${f(O.MASS_HUE_AMOUNT)});

  // trough floor -> body -> thin lit crest, one continuous asymptotic run
  float hB = hN + ${f(O.BODY_BIAS)};
  float rise = hB / (abs(hB) + ${f(O.BODY_SOFT)}) * 0.5 + 0.5;
  vec3 body = mix(${v3(SEA.trough)}, deepBody, rise);
  // small-wave texture on top of the broad run: the riding bands brighten
  // their crests and darken their troughs so the surface reads at speed
  // (WAVE_SCALE tracks the giant now, so this axis keeps the chop's contrast)
  float texAxis = (vWave - vSwell - vGiant) / 2.2;
  body *= 1.0 + (texAxis / (abs(texAxis) + 0.9)) * 0.55;
  // thin water reads shallow where the water IS thin — small crests and the
  // giant's upper face alike
  float shIn = (lift - 0.46) * 2.0 + thinP * 1.6 + chop * 0.8 + thinG * ${f(LK.GIANT_LIP)};
  float shP = softPos(shIn, 0.22);
  float shallow = shP / (shP + 1.0) * ${f(O.SHALLOW_MAX)}
    * mix(0.30, 1.0, max(thinP, thinG)) * (0.85 + facing * 0.15);
  body = mix(body, mix(${v3(SEA.scatter)}, ${v3(SEA.crest)}, 0.72), shallow);

  // sky visibility (troughs see a slot of sky) and wave-group occlusion
  float skyVis = ${f(O.SKY_VIS_MIN)} + sat(lift * 1.15) * (1.0 - ${f(O.SKY_VIS_MIN)});
  refl *= 0.55 + skyVis * 0.5;
  float groupOcc = 1.0 - ${f(O.GROUP_DARK)} * (1.0 - group)
    + chop * ${f(O.CHOP_LIFT)} * (1.0 - group);
  float sunWrap = pow(sat(dot(N, uMoonDir) * 0.55 + 0.45), 1.7);
  float amb = mix(0.36 + facing * 0.64, 0.72 + facing * 0.28, max(thinP, thinG * 0.8));
  body *= amb * skyVis * groupOcc;
  float ambL = dot(uAmbient, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowTint = uAmbient / max(ambL, 1e-4) * ${f(O.SHADOW_LUM)};
  body *= mix(shadowTint, mix(uMoonColor, vec3(1.0), 0.28) * 1.26,
    sat(sunWrap + max(thinP, thinG) * 0.35));
  float sunN = sat(dot(N, uMoonDir));
  body += ${v3(SEA.scatter)} * uMoonColor * sunN
    * mix(${f(O.SCATTER_BASE)}, 1.0, max(thinP, thinG)) * groupOcc * ${f(O.SCATTER_GAIN)};

  // --- subsurface scatter: light in the far face, out toward the eye --------
  // The giant lip is thicker water: a longer refracted path deepens the teal
  // as the wave grows (the emerald room), on top of the chop's own glow.
  float cosIn = sat(-dot(N, uMoonDir));
  float Tin = 1.0 - fresnelDielectric(cosIn, ${f(O.ETA_AW)});
  float fwd = hgForward(${f(O.SSS_G)}, sat(dot(V, -uMoonDir)));
  float cosT = sqrt(1.0 - ${f(O.ETA2)} * (1.0 - NoV * NoV));
  float lipD = (mix(${f(O.LIP_BASE)}, ${f(O.LIP_TIP)}, thinP) + thinG * ${f(LK.GIANT_PATH)})
    / max(cosT, 0.1);
  vec3 Tvol = exp(-muWater * lipD); // Jerlov diffusion transmittance
  float thin = max(thinP * (0.25 + lift * 0.90), thinG * ${f(LK.GIANT_SSS)});
  float sss = fwd * cosIn * Tin * thin * ${f(O.SSS_GAIN)};
  vec3 glow = Tvol * uMoonColor * (sss / (sss + 1.0)) * ${f(O.SSS_MAX)};

  // one energy-conserving split: not reflected means transmitted
  vec3 water = mix(body + glow, refl, fres);

  // --- moon glitter -----------------------------------------------------------
  // The specular normal smooths to the giant+swell band with distance: near
  // field keeps every sparkle; mid/far field reads as a broad moonlit sheen
  // following the giant's curvature instead of per-bump oval blots.
  vec3 Nspec = normalize(mix(N, normalize(vec3(-gS.x, 1.0, -(gS.y - ${G}))),
    sat(viewDist / 220.0)));
  vec3 Hv = normalize(V + uMoonDir);
  float nVar = fwidth(N.x) + fwidth(N.z);
  float roughSpec = clamp(sqrt(rough * rough
    + sat(viewDist / ${f(O.SPEC_SPREAD_RANGE)}) * ${f(O.SPEC_SPREAD)}
    + sat(nVar * ${f(O.SPEC_AA_VAR)}) * 0.06), ${f(O.SPEC_ROUGH_MIN)}, ${f(O.SPEC_ROUGH_MAX)});
  float a2 = roughSpec * roughSpec;
  a2 *= a2;
  float NoH = sat(dot(Nspec, Hv));
  float den = NoH * NoH * (a2 - 1.0) + 1.0;
  float ggx = a2 / (den * den * PI) * sat(dot(Nspec, uMoonDir));
  vec3 stBase = mix(uMoonColor, vec3(1.0), ${f(O.SPEC_WHITE)});
  float stL = dot(stBase, vec3(0.2126, 0.7152, 0.0722));
  vec3 specTint = mix(stBase, vec3(stL), sat(nVar * 3.0) * ${f(O.SPEC_AA_DESAT)});
  vec3 specBroad = specTint * (ggx / (ggx + ${f(O.SPEC_KNEE)})) * ${f(O.SPEC_MAX)} * fresRaw;
  // the broad wash is damped with distance: at grazing angles it otherwise
  // fresnel-amplifies into bright oval blots on every swell flank. The crisp
  // glint road (below) keeps its full reach.
  water += specBroad * mix(1.0, 0.40, distF);
  float glint = max(ggx - ${f(O.GLINT_MIN)}, 0.0);
  water += specTint * (glint / (glint + ${f(O.GLINT_KNEE)}))
    * (0.5 * ${f(O.SPEC_MAX)} * ${f(O.GLINT_BOOST)}) * fresRaw;

  // --- foam -----------------------------------------------------------------
  // Foam is born on the RIDING texture (swell+chop steepness), remembered
  // across time lags — the giant's bulk slope is NOT foam: a long glassy
  // face does not break. The giant instead crowns itself: whitewater on the
  // upper, steep part of the face, plus a tossing lip at the very top.
  vec2 gG0 = giantGrad(vXZ.x, vXZ.y, t);
  vec2 fS1, fC1, fF1, fS2, fC2, fF2;
  waveGradBands(vXZ.x, vXZ.y, t - ${f(O.FOAM_LAG1)}, fS1, fC1, fF1);
  waveGradBands(vXZ.x, vXZ.y, t - ${f(O.FOAM_LAG2)}, fS2, fC2, fF2);
  float st0 = length((gS - gG0) + gC * chopF);
  float st1 = length((fS1 - giantGrad(vXZ.x, vXZ.y, t - ${f(O.FOAM_LAG1)})) + fC1 * chopF);
  float st2 = length((fS2 - giantGrad(vXZ.x, vXZ.y, t - ${f(O.FOAM_LAG2)})) + fC2 * chopF);
  float f0 = smoothstep(${f(O.FOAM_STEEP_LO)}, ${f(O.FOAM_STEEP_HI)}, st0);
  float f1 = smoothstep(${f(O.FOAM_STEEP_LO)}, ${f(O.FOAM_STEEP_HI)}, st1);
  float f2 = smoothstep(${f(O.FOAM_STEEP_LO)}, ${f(O.FOAM_STEEP_HI)}, st2);
  float cov = max(f0, max(f1 * ${f(O.FOAM_MEM1)}, f2 * ${f(O.FOAM_MEM2)}));
  float envC = clamp(
    (texture2D(uDetail, vXZ / ${f(O.ENV_TILE_C)}).b - ${f(O.CARVE_MEAN)}) * ${f(O.ENV_C)}
    + (texture2D(uDetail, vXZ / ${f(O.ENV_TILE_F)} + 0.37).a - ${f(O.CARVE_MEAN)}) * ${f(O.ENV_F)}
    + 1.0, 0.7, 1.3);
  cov = sat(cov * envC * envC);
  // the breaking crown: the giant's crest zone AMPLIFIES the riding
  // texture's own foam activity (steep, crest-high water holds and grows
  // what breaks there) — a glassy face stays clean because 0 boosted is 0.
  // Only the very lip gets a thin toss of its own.
  float crestZone = smoothstep(${f(LK.GIANT_REF * 0.35)}, ${f(LK.GIANT_REF * 0.80)}, vGiant)
    * smoothstep(0.25, 0.50, length(gG0));
  cov = sat(cov * (1.0 + crestZone * 1.6));
  float lipToss = smoothstep(${f(LK.GIANT_REF * 0.78)}, ${f(LK.GIANT_REF * 0.98)}, vGiant) * 0.15;
  cov = sat(max(cov, lipToss));

  // the carve: domain-warped coarse tile, constant-rotated fine tile
  vec4 wc = texture2D(uDetail, vXZ / ${f(O.CARVE_WARP_TILE)} + 0.23);
  float wx = wc.b - ${f(O.CARVE_MEAN)};
  float wy = (wc.a - ${f(O.CARVE_MEAN)} - wx * ${f(O.CARVE_WARP_RHO)}) * ${f(O.CARVE_WARP_ORTH)};
  vec2 qc = vXZ + vec2(wx, wy) * ${f(O.CARVE_WARP_AMP)};
  vec2 qf = vec2(
    qc.x * ${f(O.CARVE_ROT_C)} - qc.y * ${f(O.CARVE_ROT_S)},
    qc.y * ${f(O.CARVE_ROT_C)} + qc.x * ${f(O.CARVE_ROT_S)});
  vec4 cCoarse = texture2D(uDetail, qc / ${f(O.CARVE_TILE_C)} + vec2(t * 0.012, t * 0.008));
  vec4 cFine = texture2D(uDetail, qf / ${f(O.CARVE_TILE_F)} + vec2(t * -0.02, t * 0.015));
  float fA = cCoarse.b;
  float fB = cFine.g;
  float fineFade = sat(${f(O.CARVE_FOOT_F)} / footprint);
  float rampT = smoothstep(${f(O.RAMP_IN)}, ${f(O.RAMP_FULL)}, cov);
  float wSparse = mix(${f(O.RAMP_SPARSE_MIN)}, 1.0, rampT) * fineFade;
  float wMed = smoothstep(${f(O.RAMP_MED_IN)}, ${f(O.RAMP_FULL)}, cov)
    * ${f(O.RAMP_MED_TOP)} * fineFade;
  float sparseDev = max(${f(O.CARVE_MEAN)} - cFine.r, ${f(O.SPARSE_CLIP)});
  float dev = (fA - ${f(O.CARVE_MEAN)}) + sparseDev * wSparse + (fB - ${f(O.CARVE_MEAN)}) * wMed;
  float sigMix = sqrt(wSparse * wSparse + wMed * wMed + 1.0);
  float sigShip = sqrt(fineFade * fineFade * ${f(O.CARVE_W_F)} * ${f(O.CARVE_W_F)}
    + ${f(O.CARVE_W_C)} * ${f(O.CARVE_W_C)});
  float carve = dev * (sigShip / sigMix) + ${f(O.CARVE_MEAN)};
  float fEdge = 0.60 - cov * 0.42;
  float coverage = smoothstep(fEdge, fEdge + 0.15, carve) * sat(cov * 2.4);

  float ageP = sat(1.0 - (cov - f0) / max(cov, 1e-4));
  float ageRaw = ageP * ageP;
  ageRaw *= ageRaw;
  float farF = sat((footprint - ${f(O.AGE_FAR_LO)}) / (${f(O.AGE_FAR_HI)} - ${f(O.AGE_FAR_LO)}));
  float ageF = clamp(${f(O.AGE_END)} + (ageRaw - ${f(O.AGE_U_DEATH4)})
    * ((1.0 - ${f(O.AGE_END)}) / (1.0 - ${f(O.AGE_U_DEATH4)})), ${f(O.AGE_END)}, 1.0);
  float laceSolid = sat((fB - ${f(O.LACE_MEAN)}) / ${f(O.LACE_HALF)} * 0.5 + 0.5);
  float laceF = mix(${f(O.LACE_MIN)}, 1.0, laceSolid);
  float foamTone = mix(max(ageF * laceF, ${f(O.TONE_FLOOR)}), ${f(O.TONE_FAR)}, farF);

  float foamWrap = sat(dot(N, uMoonDir) + ${f(O.FOAM_WRAP)}) / (1.0 + ${f(O.FOAM_WRAP)});
  float foamSunT = min(foamWrap * ${f(O.FOAM_SUN)}
    + fwd * (1.0 - NoV) * ageF * ${f(O.FOAM_FWD)}, ${f(O.FOAM_SUN)});
  float reliefLit = clamp(dot(vec3(-reliefGrad.x, 0.0, -reliefGrad.y), uMoonDir),
    -${f(O.FOAM_RELIEF_CLAMP)}, ${f(O.FOAM_RELIEF_CLAMP)}) * ${f(O.FOAM_RELIEF_STRENGTH)};
  float foamHueL = dot(uFoamColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 foamHue = uFoamColor / max(foamHueL, 1e-4);
  vec3 foamShaded = foamHue * mix(vec3(1.0), vec3(${f(O.FOAM_RED_AGED)}, 1.0, 1.0), 1.0 - ageP)
    * (foamTone * ${f(O.FOAM_BRIGHT)})
    * (${f(O.FOAM_AMB)} + foamSunT * (1.0 + reliefLit));
  float foamPeak = max(foamShaded.r, max(foamShaded.g, foamShaded.b));
  foamShaded *= min(1.0, 1.05 / max(foamPeak, 1e-4));

  // submerged bubble plume: milkiness in the water itself, before the raft
  float plumeN = 1.0 + (texture2D(uDetail, vXZ / ${f(O.BUB_TILE)} + vec2(t * -0.011, t * 0.007)).b
    - ${f(O.CARVE_MEAN)}) / ${f(O.CARVE_STD1)} * ${f(O.BUB_CONTRAST)};
  plumeN = clamp(plumeN, 0.0, ${f(O.BUB_PLUME_MAX)});
  float aer = sat(cov * plumeN);
  float litBub = (${f(O.FOAM_AMB)} + sunN * ${f(O.FOAM_SUN)} * ${f(O.BUB_SUN_T)})
    * skyVis * groupOcc;
  vec3 milkCol = uFoamColor * ${f(O.SCUD_TONE)} * exp(-muWater * ${f(O.MILK_PATH)}) * litBub;
  water = mix(water, milkCol, aer * ${f(O.FOAM_MILK)} * (1.0 - fres));

  float aEdge = fEdge - ${f(O.APRON_DROP)};
  float apron = smoothstep(aEdge, aEdge + ${f(O.APRON_SPAN)}, carve)
    * sat(cov * ${f(O.APRON_COV_GAIN)}) * sat(${f(O.APRON_FOOT)} / footprint);
  float litScud = (${f(O.FOAM_AMB)} + sunN * ${f(O.FOAM_SUN)})
    * max(skyVis * groupOcc, ${f(O.SCUD_OCC_MIN)});
  vec3 scudCol = uFoamColor * ${f(O.SCUD_TONE)} * litScud;
  water = mix(water, scudCol, sat(apron - coverage) * (1.0 - coverage) * ${f(O.APRON_ALPHA)});

  vec3 surface = mix(water, foamShaded, coverage);
  surface += specBroad * coverage * ${f(O.FOAM_SPEC_FILM)} * (1.0 - ageP);

  // --- crystal point lights: tinted pools and streaks on the water ----------
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    vec3 Lv = uLightPos[i].xyz - vWorld;
    float d = length(Lv);
    float lum = uLightCol[i].r + uLightCol[i].g + uLightCol[i].b;
    if (lum < 0.001 || d > 90.0) continue;
    vec3 L = Lv / max(d, 1e-3);
    float atten = uLightPos[i].w / max(d * d, 9.0);
    float spl = smoothstep(30.0, 2.0, d);
    float NdL = sat(dot(N, L));
    surface += uLightCol[i] * atten * spl * (NdL * 0.75 + 0.25) * ${f(O.LIGHT_DIFFUSE)};
    vec3 Hl = normalize(V + L);
    float a2l = 0.0625;
    float NoHl = sat(dot(N, Hl));
    float denl = NoHl * NoHl * (a2l - 1.0) + 1.0;
    float ggxl = a2l / (denl * denl * PI);
    surface += uLightCol[i] * atten * spl * ggxl * ${f(O.LIGHT_SPEC)} * fresRaw;
  }

  // --- aerial perspective -----------------------------------------------------
  vec3 viewDir = normalize(vWorld - cameraPosition);
  vec3 hazeCol = skySample(viewDir, 0.0) * ${f(O.SEA_SINK)};
  float tau = viewDist * ${f(O.HAZE_DENSITY)};
  float ext = 1.0 - exp(-tau);
  float sink = mix(1.0, ${f(O.FAR_SINK)}, sat(viewDist / ${f(O.FAR_SINK_RANGE)}));
  vec3 col = mix(surface * sink, hazeCol, ext);

  // ShaderMaterial gets no automatic tone mapping / output encoding — apply
  // the renderer's own (ACESFilmic + linear->sRGB), like built-in materials do.
  outColor = vec4(col, 1.0);
#ifdef TONE_MAPPING
  outColor.rgb = toneMapping(outColor.rgb);
#endif
  outColor = linearToOutputTexel(outColor);
}
`;
}

export function buildWaterShaders(level) {
  return { vertex: buildVertexShader(level), fragment: buildFragmentShader(level) };
}

// exported for the shader validation harness (default level)
export const WATER_SHADERS = buildWaterShaders(DEFAULT_LEVEL);

// One static mesh from horizon to horizon: 0.6 m cells over the gameplay
// rectangle, geometrically doubling rings outward through a mid band (faces
// stay smooth to ~1.3 km) and a coarse outer band to the ~3.2 km reach.
// Static is correct because the wave field is world-anchored and the mesh
// chases the rider. The far edge lives where the aerial perspective has
// already dissolved the water into the sky behind it.
function buildOceanGeometry() {
  const { xMin, zMin, dense, spacing, mid, midReach, coarse } = WATER;

  // distances beyond one dense edge, doubling up to each band's cap
  const rings = (limit) => {
    const ds = [];
    let d = 0, step = spacing;
    for (const [cap, span] of [[mid, midReach], [coarse, limit]]) {
      const end = Math.min(span, limit);
      while (d < end - 1e-9) {
        step = Math.min(step * 2, cap);
        d = Math.min(d + step, end);
        ds.push(d);
      }
      if (d >= limit - 1e-9) break;
    }
    return ds;
  };

  const rx = rings(xMin - dense.x);
  const xs = [];
  for (let p = -dense.x; p <= dense.x + 1e-6; p += spacing) xs.push(p);
  xs.push(...rx.map((d) => -(dense.x + d)), ...rx.map((d) => dense.x + d));
  xs.sort((a, b) => a - b);

  const rzn = rings(zMin + dense.zMin); // dense.zMin is negative
  const rzp = rings(zMin - dense.zMax);
  const zs = [];
  for (let p = dense.zMin; p <= dense.zMax + 1e-6; p += spacing) zs.push(p);
  zs.push(...rzn.map((d) => dense.zMin - d), ...rzp.map((d) => dense.zMax + d));
  zs.sort((a, b) => a - b);

  const nx = xs.length;
  const nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  let i = 0;
  for (let zi = 0; zi < nz; zi++) {
    for (let xi = 0; xi < nx; xi++) {
      positions[i++] = xs[xi];
      positions[i++] = 0;
      positions[i++] = zs[zi];
    }
  }
  const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let j = 0;
  for (let zi = 0; zi < nz - 1; zi++) {
    for (let xi = 0; xi < nx - 1; xi++) {
      const a = zi * nx + xi;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      indices[j++] = a; indices[j++] = c; indices[j++] = b;
      indices[j++] = b; indices[j++] = c; indices[j++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1)); // Uint32: >65535 verts
  return geo;
}

export class Slope {
  constructor({ skyTex, moon, ambient, foamColor, level } = {}) {
    this.geo = buildOceanGeometry();
    this.mat = null;
    this.mesh = new THREE.Mesh(this.geo);
    this.mesh.frustumCulled = false; // displaced on the GPU, bounds lie
    this._env = { skyTex, moon, ambient, foamColor };
    this.setLevel(level || DEFAULT_LEVEL);
  }

  // Swap the level: rebuild the shader pair from the level's wave params +
  // palette (the geometry is reused — it is just a grid) and refresh the
  // environment uniforms.
  setLevel(level, env = {}) {
    Object.assign(this._env, env);
    const e = this._env;
    const shaders = buildWaterShaders(level);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shaders.vertex,
      fragmentShader: shaders.fragment,
      uniforms: {
        uTime: { value: this.mat ? this.mat.uniforms.uTime.value : 0 },
        uSkyRot: { value: 0 },
        uMoonDir: { value: (e.moon && e.moon.dir) || new THREE.Vector3(0, 1, 0) },
        uMoonColor: { value: (e.moon && e.moon.color) || new THREE.Color(1, 1, 1) },
        uAmbient: { value: e.ambient || new THREE.Color(0.2, 0.2, 0.3) },
        uFoamColor: { value: e.foamColor || new THREE.Color(0.85, 0.92, 1.0) },
        uSky: { value: e.skyTex || null },
        uDetail: { value: DETAIL_TEX },
        uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(1e9, -1e9, 1e9, 0)) },
        uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
      },
    });
    if (this.mat) this.mat.dispose();
    this.mat = mat;
    this.mesh.material = mat;
  }

  setSky(tex) {
    this.mat.uniforms.uSky.value = tex;
  }

  update(t, { skyRot = 0, moonDir, lights } = {}) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    u.uSkyRot.value = skyRot;
    if (moonDir) u.uMoonDir.value.copy(moonDir);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const item = lights && lights[i];
      if (item && item.light) {
        const p = item.light.position;
        u.uLightPos.value[i].set(p.x, p.y, p.z, item.light.intensity);
        u.uLightCol.value[i].copy(item.light.color);
      } else {
        u.uLightPos.value[i].set(1e9, -1e9, 1e9, 0);
        u.uLightCol.value[i].setRGB(0, 0, 0);
      }
    }
  }
}
