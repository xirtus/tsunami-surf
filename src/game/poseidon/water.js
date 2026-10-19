// Vendored from poseidon-src/src/ocean/water.js (MIT license, Poseidon project).
// Unchanged except this header — the measured Jerlov coastal-water optics the
// game's water shader shades with.

// Inherent optical properties of sea water, from the published tables rather
// than from the eye.
//
// SOURCE. Absorption a and scattering b are Solonenko & Mobley 2015, "Inherent
// optical properties of Jerlov water types", Appl. Opt. 54(17):5392-5401,
// Tables 6-7, read at the paper's own 600 / 550 / 450 nm grid points. Reading
// the grid points rather than interpolating matters: interpolated values can
// land below the Pope & Fry 1997 pure-water absorption floor, which is
// unphysical and shows up as a channel that will not attenuate.
const JERLOV = {
  '1C': { a: [0.2360, 0.0760, 0.1050], b: [0.3140, 0.3650, 0.5140] },
  '3C': { a: [0.2390, 0.0820, 0.1540], b: [0.9160, 1.0600, 1.5000] },
};

// Mean cosine of the particle phase function (Petzold average particle). Water
// is far more forward-scattering than the g ~ 0.5 a graphics phase function
// usually runs at, and that is the whole reason the transport form below is not
// simply Beer-Lambert: at g = 0.924 a scattering event barely deflects a photon,
// so b hardly attenuates anything and the reduced coefficient b(1-g) is what
// counts.
const G_PARTICLE = 0.924;

// Diffusion (transport) attenuation, 1/m, per RGB.
//
//   mu = sqrt( 3 a (a + b(1 - g)) )
//
// NOT the beam coefficient c = a + b. The single-scattering albedo here runs
// 0.79-0.93, so by the time light has crossed a wave lip most of what arrives
// has scattered several times and is diffusing rather than travelling in a
// straight line. Beam extinction over the same path is several times too dark
// and, worse, has the wrong hue — it kills green, which is the one channel a
// backlit crest keeps.
export function diffusionAttenuation(type) {
  const { a, b } = JERLOV[type];
  return a.map((av, i) => Math.sqrt(3 * av * (av + b[i] * (1 - G_PARTICLE))));
}
