// Vendored from poseidon-src/src/ocean/detailTexture.js (MIT license, Poseidon
// project). Unchanged except the import line (three/webgpu -> three) and this
// header.
//
// A seamless tiling noise texture, baked once on the CPU. Channels:
//   R  = coarse cellular (Worley F1, jittered radius) — foam holes
//   G  = finer cellular, ~2x the density
//   B  = low-frequency fbm value (streak / chunk carves, variation)
//   A  = higher-frequency fbm value
import {
  DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
} from 'three';

const TARGET_MEAN = 0.4089;
const TARGET_STD = 0.1328;

const CELL_COUNT_COARSE = 5;
const CELL_COUNT_FINE = 11;
const RADIUS_SIGMA = 0.45;

function cellularField(size, cells, sigmaLog, seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = cells * cells;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = rng();
    py[i] = rng();
    // Box-Muller into a lognormal with median radius of one cell.
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    pr[i] = Math.exp(g * sigmaLog);
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells;
    const cy = Math.floor(fy);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const cx = Math.floor(fx);
      let best = 1e9;
      for (let oy = -2; oy <= 2; oy++) {
        const gy = (((cy + oy) % cells) + cells) % cells;
        for (let ox = -2; ox <= 2; ox++) {
          const gx = (((cx + ox) % cells) + cells) % cells;
          const i = gy * cells + gx;
          const dx = cx + ox + px[i] - fx;
          const dy = cy + oy + py[i] - fy;
          const d = Math.sqrt(dx * dx + dy * dy) / pr[i];
          if (d < best) best = d;
        }
      }
      out[y * size + x] = best;
    }
  }
  return out;
}

// Renormalise a field onto the target moments — see TARGET_MEAN. This is what
// makes the field's construction a free parameter: change the spectrum, or the
// noise family entirely, keep the statistics, and nothing downstream retunes.
function renormalise(f) {
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < f.length; i++) { sum += f[i]; sum2 += f[i] * f[i]; }
  const mean = sum / f.length;
  const gain = TARGET_STD / Math.sqrt(Math.max(sum2 / f.length - mean * mean, 1e-9));
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mean) * gain + TARGET_MEAN;
  return f;
}

export function makeDetailTexture(size = 512, octaves = 5, persistence = 0.68) {
  const rand = new Float32Array(size * size);
  let seed = 1234567;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < size * size; i++) rand[i] = rng();

  const cellC = renormalise(cellularField(size, CELL_COUNT_COARSE, RADIUS_SIGMA, 0x9e3779b9));
  const cellF = renormalise(cellularField(size, CELL_COUNT_FINE, RADIUS_SIGMA, 0x85ebca6b));

  const smooth = (t) => t * t * (3 - 2 * t);

  // Value-noise octave that wraps at frequency f, so the whole field tiles.
  const octave = (u, v, f) => {
    const x = u * f;
    const y = v * f;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const uu = smooth(x - xi);
    const vv = smooth(y - yi);
    const A = (X, Y) => rand[((((Y % f) + f) % f) * size) + (((X % f) + f) % f)];
    const a = A(xi, yi);
    const b = A(xi + 1, yi);
    const c = A(xi, yi + 1);
    const d = A(xi + 1, yi + 1);
    return a * (1 - uu) * (1 - vv) + b * uu * (1 - vv) + c * (1 - uu) * vv + d * uu * vv;
  };

  const raw = (u, v) => {
    let s = 0;
    let amp = 0.5;
    let f = 4;
    for (let o = 0; o < octaves; o++) {
      s += amp * octave(u, v, f);
      amp *= persistence;
      f *= 2;
    }
    return s;
  };

  let n = 0;
  let sum = 0;
  let sum2 = 0;
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const h = raw(x / size, y / size);
      n++; sum += h; sum2 += h * h;
    }
  }
  const mean = sum / n;
  const gain = TARGET_STD / Math.sqrt(Math.max(sum2 / n - mean * mean, 1e-9));
  const fbm = (u, v) => (raw(u, v) - mean) * gain + TARGET_MEAN;

  // Dithered quantisation, +/- half an LSB before the round.
  const clamp255 = (x) => Math.max(0, Math.min(255, Math.round(x + (rng() - 0.5))));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = clamp255(cellC[y * size + x] * 255); // coarse cellular
      data[i + 1] = clamp255(cellF[y * size + x] * 255); // fine cellular
      data[i + 2] = clamp255(fbm(u, v) * 255); // low-freq fbm value
      data[i + 3] = clamp255(fbm(u * 2, v * 2) * 255); // higher-freq fbm value
    }
  }

  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
