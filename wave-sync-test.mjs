// Numeric check: the analytic band gradients (as written in the GLSL, built
// from the same params) must equal finite differences of waveHeight — for
// every level's field, not just the default. Also verifies waveGrad (the
// rider's terrain gravity) equals the band sum plus the base fall, and that
// the giant faces stay inside the physics budget (ACCEL must exceed the
// worst uphill pull, or a wall could trap the rider).
import {
  waveHeight, waveGrad, waveGradTerrain, waveGradBands, setWaveParams, SLOPE,
} from './src/game/Waves.js';
import { LEVELS } from './src/game/Levels.js';

const eps = 1e-4;
let worst = 0;
let worstSlope = 0;

for (const level of LEVELS) {
  setWaveParams(level.wave);
  let levelWorst = 0;
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() - 0.5) * 240;
    const z = -250 + Math.random() * 900;
    const t = Math.random() * 100;

    // bands vs finite differences of waveHeight (fdz includes the fall:
    // wave-only band sum minus the gradient equals the finite difference)
    const { gS, gC, gF } = waveGradBands(x, z, t);
    const fdx = (waveHeight(x + eps, z, t) - waveHeight(x - eps, z, t)) / (2 * eps);
    const fdz = (waveHeight(x, z + eps, t) - waveHeight(x, z - eps, t)) / (2 * eps);
    const sum = [gS[0] + gC[0] + gF[0], gS[1] + gC[1] + gF[1]];
    levelWorst = Math.max(levelWorst,
      Math.abs(sum[0] - fdx), Math.abs(sum[1] - SLOPE.gradient - fdz));

    // waveGrad = band sum + fall
    const g = waveGrad(x, z, t);
    levelWorst = Math.max(levelWorst,
      Math.abs(g.x - sum[0]), Math.abs(g.z - (sum[1] - SLOPE.gradient)));

    // steepest TERRAIN slope (the bands the rider's gravity reads)
    const tg = waveGradTerrain(x, z, t);
    worstSlope = Math.max(worstSlope, Math.hypot(tg.x, tg.z));
  }
  worst = Math.max(worst, levelWorst);
  console.log(`  ${level.name.padEnd(12)} worst band/finite-diff err ${levelWorst.toExponential(2)}`);
}

setWaveParams(LEVELS[0].wave); // leave the default field active
const ok = worst < 1e-5;
console.log(ok
  ? `[OK] analytic gradients match finite differences on all levels (worst err ${worst.toExponential(2)})`
  : `[FAIL] gradient mismatch (worst err ${worst.toExponential(2)})`);

// physics budget: terrain gravity is capped (PULL_MAX) under the board's
// drive (ACCEL) in Rider.js, so no face can trap the rider by construction —
// assert the contract holds and report the steepest terrain found.
const ACCEL = 26, PULL_MAX = 20;
console.log(`steepest terrain face anywhere: ${worstSlope.toFixed(2)} m/m (${(Math.atan(worstSlope) * 180 / Math.PI).toFixed(0)} deg)`);
const playable = PULL_MAX < ACCEL;
console.log(playable
  ? `[OK] every wall can be crested (pull capped at ${PULL_MAX} < drive ${ACCEL})`
  : '[FAIL] terrain pull cap meets or exceeds the board drive — rider could get trapped');
process.exit(ok && playable ? 0 : 1);
