// Verifies the horizon-ocean geometry: extents, dense spacing over the run,
// and that the aerial perspective fully dissolves the water before it meets
// the sky dome (no visible edge) from every camera mode's position.
import * as THREE from 'three';
import { Slope } from './src/game/Slope.js';
import { SLOPE } from './src/game/Waves.js';

const skyTex = new THREE.DataTexture(new Uint8Array(16), 4, 4);
skyTex.needsUpdate = true;
const slope = new Slope({ skyTex });

const geo = slope.geo;
const pos = geo.attributes.position;
const idx = geo.index.array;
let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  xMin = Math.min(xMin, x); xMax = Math.max(xMax, x);
  zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
}
console.log(`verts: ${pos.count} | tris: ${idx.length / 3} | extent x [${xMin}, ${xMax}] z [${zMin}, ${zMax}]`);

const err = (cond, msg) => { if (!cond) { console.log('[FAIL]', msg); process.exitCode = 1; } };
err(xMin <= -3200 && xMax >= 3200, 'x reach');
err(zMin <= -3200 && zMax >= 3200, 'z reach');
err(pos.count > 400000, 'vertex count sane');

// dense spacing over the run rect: check cell size on the mesh near the rider
const cellAt = (x, z) => {
  // find the closest vertex and its neighbor distance
  let best = Infinity, bi = -1;
  for (let i = 0; i < pos.count; i++) {
    const d = Math.abs(pos.getX(i) - x) + Math.abs(pos.getZ(i) - z);
    if (d < best) { best = d; bi = i; }
  }
  let nb = Infinity;
  const vx = pos.getX(bi), vz = pos.getZ(bi);
  for (let i = 0; i < pos.count; i++) {
    if (i === bi) continue;
    const dx = pos.getX(i) - vx, dz = pos.getZ(i) - vz;
    if (Math.abs(dz) > 0.61 || Math.abs(dx) > 0.61) continue;
    nb = Math.min(nb, Math.hypot(dx, dz));
  }
  return nb;
};
const near = cellAt(0, 100);
err(near > 0 && near <= 0.61, `dense cell near run ~0.6 m (got ${near.toFixed(2)})`);
console.log(`dense cell size near the run: ${near.toFixed(2)} m`);
const cornerR = Math.max(Math.hypot(xMin, zMin), Math.hypot(xMax, zMax));
err(cornerR > 3000, `mesh corner (${cornerR.toFixed(0)} m) clears the dome (3000 m)`);
console.log(`mesh corner radius ${cornerR.toFixed(0)} m > dome 3000 m`);

// dome intersection + haze extinction from typical camera positions
const DOME = 3000;
const HAZE = 0.002;
const cams = [
  [0, 105, 100],    // chase, mid-run
  [10, 110, -180],  // menu cam
  [30, 90, 380],    // near finish
];
let worstExt = 0;
for (const [cx, cy, cz] of cams) {
  for (const [wx, wz] of [[3200, -3200], [-3200, -3200], [3200, 3200], [-3200, 3200], [0, -3200], [0, 3200]]) {
    const wy = SLOPE.baseHeight - SLOPE.gradient * wz; // wave-less plane height (waves don't matter here)
    let dx = wx - cx, dy = wy - cy, dz = wz - cz;
    const len = Math.hypot(dx, dy, dz);
    dx /= len; dy /= len; dz /= len;
    // sphere intersection distance
    const b = cx * dx + cy * dy + cz * dz;
    const c = cx * cx + cy * cy + cz * cz - DOME * DOME;
    const disc = b * b - c;
    const dDome = disc > 0 ? -b - Math.sqrt(disc) : len;
    const dWater = Math.min(len, dDome > 0 ? dDome : len); // mesh is past the dome: edge = dome intersection
    const ext = 1 - Math.exp(-dWater * HAZE);
    worstExt = Math.max(worstExt, ext);
  }
}
console.log(`worst haze extinction where water meets the dome: ${(worstExt * 100).toFixed(1)}%`);
err(worstExt >= 0.99, 'water edge fully dissolved at the dome (>99%)');
console.log(process.exitCode ? 'some checks failed' : 'all ocean checks pass');
