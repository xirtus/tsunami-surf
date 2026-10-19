// Simulates updateCamera per mode and checks the geometry of each shot.
// Minimal canvas shim: Crystals.js paints a glow texture at module load.
const ctx2d = new Proxy({}, {
  get: (t, k) => {
    if (k in t) return t[k];
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    return () => {};
  },
  set: () => true,
});
globalThis.document = {
  createElement: (tag) =>
    tag === 'canvas' ? { width: 0, height: 0, getContext: () => ctx2d } : {},
};

import * as THREE from 'three';
import { waveHeight } from './src/game/Waves.js';
const { Game } = await import('./src/game/Game.js');

function makeCam(mode, heading, speed) {
  const g = Object.create(Game.prototype);
  g.rider = { x: 10, y: waveHeight(10, 50, 0) + 0.35, z: 50, heading, speed };
  g.camMode = mode;
  g._camSwitchAt = -10;
  g.t = 0;
  g._fwd = new THREE.Vector3();
  g._camFwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  g._perp = new THREE.Vector3();
  g._target = new THREE.Vector3();
  g._look = new THREE.Vector3();
  g.camPos = new THREE.Vector3(10, 80, 30);
  g.camLook = new THREE.Vector3(10, 50, 50);
  g.camera = { fov: 58, updateProjectionMatrix() {} };
  return g;
}

const step = (g, n = 240) => {
  for (let i = 0; i < n; i++) { g.t += 1 / 60; g.updateCamera(1 / 60); }
};

const fwdOf = (h) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
const err = (cond, msg) => { if (!cond) { console.log('[FAIL]', msg); process.exitCode = 1; } };

// heading 0 = +z (downhill)
{
  // FRONT: camera ahead (+z), looking back at the rider
  const g = makeCam(2, 0, 30);
  step(g);
  const toCam = g.camPos.clone().sub(g.rider);
  err(toCam.z > 9, 'front cam should sit ahead of the rider (+z), got z-offset ' + toCam.z.toFixed(2));
  err(Math.abs(toCam.x) < 1, 'front cam should be on-axis');
  const lookDir = g.camLook.clone().sub(g.camPos).normalize();
  err(lookDir.z < -0.6, 'front cam should look back at the rider (-z), got ' + lookDir.z.toFixed(2));
  err(g.camPos.y > waveHeight(g.camPos.x, g.camPos.z, g.t) + 0.99, 'front cam must stay above water');
  console.log('[OK] FRONT: cam ahead by', toCam.z.toFixed(1), 'm, looking back');
}
{
  // CHASE: behind (-z), looking downhill
  const g = makeCam(0, 0, 30);
  step(g);
  const toCam = g.camPos.clone().sub(g.rider);
  err(toCam.z < -7, 'chase cam should sit behind the rider, got ' + toCam.z.toFixed(2));
  const lookDir = g.camLook.clone().sub(g.camPos).normalize();
  err(lookDir.z > 0.6, 'chase cam should look downhill');
  console.log('[OK] CHASE: cam behind by', (-toCam.z).toFixed(1), 'm, looking downhill');
}
{
  // SIDE: camera off the right (+x for heading 0)
  const g = makeCam(3, 0, 25);
  step(g);
  const toCam = g.camPos.clone().sub(g.rider);
  err(toCam.x > 9, 'side cam should sit off the right (+x), got ' + toCam.x.toFixed(2));
  err(Math.abs(toCam.z) < 8, 'side cam should be roughly abeam');
  console.log('[OK] SIDE: cam off the right by', toCam.x.toFixed(1), 'm');
}
{
  // ORBIT: camera must revolve — sample at t=0, 4s, 8s and compare angles
  const g = makeCam(4, 0, 30);
  const angles = [];
  for (const T of [0, 4, 8]) {
    g.t = T;
    g.camPos.set(10, 80, 30);
    step(g, 60);
    const toCam = g.camPos.clone().sub(g.rider);
    angles.push(Math.atan2(toCam.x, toCam.z) * 180 / Math.PI);
  }
  const swept = angles[2] - angles[0];
  err(Math.abs(swept) > 90, 'orbit cam should revolve, swept ' + swept.toFixed(0) + '° in 8s');
  console.log('[OK] ORBIT: cam angle sweeps', angles.map(a => a.toFixed(0)).join('° → '), '°');
}
{
  // LOW: close and low
  const g = makeCam(1, 0, 40);
  step(g);
  const toCam = g.camPos.clone().sub(g.rider);
  err(toCam.y < 3, 'low cam should hug the wave, y-offset ' + toCam.y.toFixed(2));
  console.log('[OK] LOW: cam height above rider', toCam.y.toFixed(2), 'm');
}
{
  // WATER GUARD: place rider on a big crest, camera target would dip under
  const g = makeCam(2, 0, 30);
  g.rider.x = 0; g.rider.z = -120;
  step(g);
  err(g.camPos.y > waveHeight(g.camPos.x, g.camPos.z, g.t) + 0.99, 'guard: camera above water everywhere');
  // BOUNDS: rider at the wall — camera must stay inside the patch
  const g2 = makeCam(3, Math.PI / 2, 30); // heading +x along the wall
  g2.rider.x = 116; g2.rider.z = 0;
  step(g2);
  err(Math.abs(g2.camPos.x) <= 118, 'bounds: camera x clamped, got ' + g2.camPos.x.toFixed(2));
  console.log('[OK] guards: camera stays above water and inside the patch');
}
{
  // SWITCH PAN: after cycling, first frames ease slowly (no snap)
  const g = makeCam(2, 0, 30);
  step(g, 240);
  const before = g.camPos.clone();
  g.camMode = 0; g._camSwitchAt = g.t;
  const first = 1 - Math.exp(-2.2 / 60);
  g.updateCamera(1 / 60);
  const moved = g.camPos.distanceTo(before);
  err(moved < 5, 'switch pan should be eased, first frame moved ' + moved.toFixed(2) + ' m');
  console.log('[OK] switch: first frame pans by', moved.toFixed(2), 'm (eased)');
}
console.log(process.exitCode ? 'some checks failed' : 'all camera checks pass');
