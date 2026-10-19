import { Game } from './src/game/Game.js';
import * as THREE from 'three';

const out = document.getElementById('out');
const log = (...a) => { out.textContent += a.join(' ') + '\n'; };
window.addEventListener('error', (e) => log('WINDOW ERROR:', e.message, e.filename, e.lineno));

const game = new Game(document.getElementById('app'));
const { scene, camera, renderer, crystals } = game;
document.getElementById('overlay').style.display = 'none'; // no DOM dimming for the pixel test

game.t = 0;
game.state = 'menu';
game.slope.update(0);
crystals.update(0);
game.cosmos.update(0);
// same camera as the new menu branch at t=0
game.camPos.set(0, 130, -180);
game.camLook.set(0, 70, -105);
camera.position.copy(game.camPos);
camera.lookAt(game.camLook);

renderer.render(scene, camera);
log('triangles WITH crystals:', renderer.info.render.triangles);
log('glError:', renderer.getContext().getError());

// project the gate crystal and sentinel to pixels
for (const [name, x, y, z] of [
  ['gate L', -34, 103, -112],
  ['gate R', 34, 103, -112],
  ['sentinel L', -25, 111, -125],
  ['sentinel R', 25, 111, -125],
]) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const px = Math.round((v.x + 1) / 2 * 1280);
  const py = Math.round((1 - v.y) / 2 * 720);
  log(`${name}: ndc=(${v.x.toFixed(2)}, ${v.y.toFixed(2)}) px=(${px},${py})`);
}

const gl = renderer.getContext();
const buf = new Uint8Array(4 * 1280 * 720);
gl.readPixels(0, 0, 1280, 720, gl.RGBA, gl.UNSIGNED_BYTE, buf, 0);
const at = (x, y) => { const i = (y * 1280 + x) * 4; return [buf[i], buf[i+1], buf[i+2]]; };

// scan the gate/sentinel region for the brightest pixel
function scanRegion(x0, x1, y0, y1, label) {
  let best = [0, 0, 0], bx = 0, by = 0;
  for (let x = x0; x < x1; x += 2) {
    for (let y = y0; y < y1; y += 2) {
      const p = at(x, y);
      if (p[0] + p[1] + p[2] > best[0] + best[1] + best[2]) best = p, bx = x, by = y;
    }
  }
  log(`${label}: brightest=(${best.join(',')}) at (${bx},${by})`);
}
scanRegion(700, 1100, 100, 320, 'gate L region');
scanRegion(180, 580, 100, 320, 'gate R region');
log('done');
