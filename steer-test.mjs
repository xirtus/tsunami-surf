// Verifies control directions (right key turns screen-right, UP is a
// backflip), that terrain gravity makes the giant face a mountain (drops
// accelerate, climbs decelerate), and that the rider surfs forever.
import * as THREE from 'three';
import { Rider } from './src/game/Rider.js';
import { waveGradTerrain } from './src/game/Waves.js';

const err = (cond, msg) => { if (!cond) { console.log('[FAIL]', msg); process.exitCode = 1; } };

const mock = (axisX = 0, axisY = 0) => ({ axisX, axisY, wasPressed: () => false });

// --- grounded steering: pressing RIGHT must DECREASE heading (+z -> -x) ----
{
  const r = new Rider();
  r.reset(0);
  r.speed = 30;
  const h0 = r.heading;
  for (let i = 0; i < 30; i++) r.update(1 / 60, mock(1, 0), 0.5);
  err(r.heading < h0, `right key must turn toward screen-right (heading ${h0.toFixed(3)} -> ${r.heading.toFixed(3)})`);
  const fwd = { x: Math.sin(r.heading), z: Math.cos(r.heading) };
  err(fwd.x < -0.1, 'turned toward -x (screen-right when facing +z)');
  console.log(`[OK] grounded: right key heading ${h0.toFixed(2)} -> ${r.heading.toFixed(2)} (toward screen-right)`);
}
{
  const r = new Rider();
  r.reset(0);
  r.speed = 30;
  const h0 = r.heading;
  for (let i = 0; i < 30; i++) r.update(1 / 60, mock(-1, 0), 0.5);
  err(r.heading > h0, 'left key must turn toward +x (screen-left)');
  console.log('[OK] grounded: left key turns the other way');
}
// --- airborne: spin matches input, UP = backflip ---------------------------
{
  const r = new Rider();
  r.reset(0);
  r.airborne = true;
  r.vy = 14.5; // a real jump: stays airborne through the whole test window
  const s0 = r.spin, f0 = r.flip;
  for (let i = 0; i < 30; i++) r.update(1 / 60, mock(-1, -1), 0.5);
  err(r.spin > s0, 'air: left key must increase spin (visual left rotation)');
  err(r.flip > f0, 'air: UP (axisY=-1) must increase flip (backflip)');
  console.log(`[OK] air: left spins left, UP -> flip ${f0.toFixed(2)} -> ${r.flip.toFixed(2)}`);
}
// --- flip > 0 must tip the nose UP (backflip) ------------------------------
{
  const r = new Rider();
  r.reset(0);
  r.airborne = true;
  r.flip = 0.9;
  r.updateTransform(0.5);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(r.group.quaternion);
  err(fwd.y > 0.1, `flip>0 must be nose-up (backflip), got fwd.y=${fwd.y.toFixed(3)}`);
  console.log(`[OK] flip>0 tips the nose up (fwd.y ${fwd.y.toFixed(2)})`);
}
// --- infinite: surf far past the old finish line, no teleport --------------
{
  const r = new Rider();
  r.reset(0);
  r.z = 400; // old endZ was 370
  r.speed = 46;
  r.heading = 0;
  let teleported = false;
  const z0 = r.z;
  for (let i = 0; i < 600; i++) { r.update(1 / 60, mock(0, 0), 10); if (r.z < 300) teleported = true; }
  err(!teleported, 'rider must not loop back');
  err(r.z > z0 + 200, `rider should keep surfing downhill (z ${z0} -> ${r.z.toFixed(0)})`);
  console.log(`[OK] infinite: z ${z0.toFixed(0)} -> ${r.z.toFixed(0)} after 10 s, no loop`);
}
// --- terrain gravity: the giant face is the mountain -----------------------
{
  // find the steepest down-face (terrain grad z very negative) and the
  // steepest climb (grad z very positive) on the default field at t frozen
  let zDown = 0, zUp = 0, gMin = 1e9, gMax = -1e9;
  for (let z = -400; z < 400; z += 0.25) {
    const gz = waveGradTerrain(0, z, 10).z;
    if (gz < gMin) { gMin = gz; zDown = z; }
    if (gz > gMax) { gMax = gz; zUp = z; }
  }
  err(gMin < -0.25, `expected a real drop face somewhere (min grad ${gMin.toFixed(2)})`);
  err(gMax > 0.25, `expected a real climb face somewhere (max grad ${gMax.toFixed(2)})`);

  const run = (z) => {
    const r = new Rider();
    r.reset(0);
    r.z = z; r.y = 0; // reset y to the face height on first update
    r.speed = 20; r.heading = 0;
    const s0 = r.speed;
    for (let i = 0; i < 30; i++) r.update(1 / 60, mock(0, 0), 10);
    return r.speed - s0;
  };
  const dDrop = run(zDown);
  const dClimb = run(zUp);
  err(dDrop > 3, `dropping the face should accelerate hard (got +${dDrop.toFixed(1)} m/s in 0.5 s)`);
  err(dClimb < dDrop - 3, `climbing should cost speed vs the drop (drop +${dDrop.toFixed(1)} vs climb ${dClimb.toFixed(1)})`);
  console.log(`[OK] terrain gravity: drop face +${dDrop.toFixed(1)} m/s, climb face ${dClimb.toFixed(1)} m/s (0.5 s)`);

  // no traps: from a standstill pointing straight uphill, the board drive
  // must still crest eventually (speed keeps growing, however slowly)
  const r = new Rider();
  r.reset(0);
  r.z = zUp; r.speed = 0; r.heading = 0;
  for (let i = 0; i < 120; i++) r.update(1 / 60, mock(0, 0), 10);
  err(r.speed > 2, `board drive must beat the steepest climb (speed ${r.speed.toFixed(1)} after 2 s)`);
  console.log(`[OK] no traps: from 0 on the steepest climb, speed ${r.speed.toFixed(1)} m/s after 2 s`);
}
console.log(process.exitCode ? 'some checks failed' : 'all steer/surf checks pass');
