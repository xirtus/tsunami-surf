import * as THREE from 'three';
import { MathUtils } from 'three';
import { waveHeight, waveNormal, waveGradTerrain, SLOPE } from './Waves.js';

// Arcade surfboard physics on a giant moving wave: carve downhill forever,
// jump, spin/flip in the air, land tricks. The giant wave face IS the
// mountain — gravity is projected onto the local water surface along the
// heading, so dropping down a face rockets the board forward and climbing a
// face bleeds speed (SLOPE_G), exactly like snowboarding. The board's own
// drive (ACCEL) always exceeds the steepest climb, so no wall is a trap.
// Steering sign convention: pressing RIGHT rotates the board toward the
// camera's right, i.e. heading DEcreases (positive heading turns the forward
// vector +z toward world +x, which is screen-left when the chase camera
// looks downhill).
const OFFSET = 0.35;      // board hover above the water
const GRAVITY = 30;
const JUMP_V = 14.5;
const MAX_SPEED = 46;
const ACCEL = 26;
const SLOPE_G = 22;       // terrain gravity gain
const PULL_MAX = 20;      // terrain gravity cap — under ACCEL, so no wall is a trap
const DRAG = 0.55;
const CARVE_SCRUB = 2.4;
const STEER_RATE = 2.3;
const AIR_STEER = 0.55;
const SPIN_RATE = 6.5;    // rad/s full-turn rotation in the air
const FLIP_RATE = 6.0;    // rad/s pitch rotation in the air

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FORWARD = new THREE.Vector3(0, 0, 1);

const LAND_DOT = 0.5;      // cos(60°) - max board tilt (pitch) for a clean landing
const LAND_FWD = 0.45;     // min |board-forward . motion| - spins land switch (180) but not sideways (90/270)
const POP_THRESHOLD = 1.25; // terrain must drop this far under the board for a natural "wave pop"

export class Rider {
  constructor() {
    this.group = new THREE.Group();

    // Fallback visual (a simple crouched rider on a board) — replaced as soon
    // as the selected character rig loads. The physics never touch the
    // visual: it only has to sit inside this.group, which the physics drive.
    this.visual = new THREE.Group();
    this.group.add(this.visual);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.12, 2.7),
      new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.35, metalness: 0.2 })
    );
    const finGeo = new THREE.BoxGeometry(0.06, 0.22, 0.34);
    const finMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    for (const dz of [-0.55, 0.55]) {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.position.set(0, -0.17, dz);
      board.add(fin);
    }
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.3, 1.1, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x1f3a5f, roughness: 0.6 })
    );
    body.position.set(0, 0.72, -0.15);
    body.rotation.x = 0.28;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7 })
    );
    head.position.set(0, 1.35, -0.3);
    this.visual.add(board, body, head);

    // state
    this.x = 0;
    this.y = 0;
    this.z = SLOPE.spawnZ;
    this.heading = 0;   // radians, 0 = +z (downhill)
    this.speed = 0;     // along heading
    this.vy = 0;        // vertical velocity (up = +)
    this.airborne = false;
    this.crashed = false;
    this.spin = 0;      // accumulated yaw while airborne
    this.flip = 0;      // accumulated pitch while airborne
    this.lean = 0;      // smoothed carve lean (roll)
    this.airJumpsLeft = 0; // one mid-air re-jump so the jump button always responds
    this.respawnTimer = 0;
    this.input = null;

    // events (wired by Game)
    this.onTrick = null;
    this.onCrash = null;

    this._q = new THREE.Quaternion();
    this._yaw = new THREE.Quaternion();
    this._pitch = new THREE.Quaternion();
    this._roll = new THREE.Quaternion();
    this._align = new THREE.Quaternion();
    this._n = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwdB = new THREE.Vector3();
  }

  // Swap the visual (character rig). The old visual is detached; the caller
  // owns disposing it.
  setVisual(group) {
    this.group.remove(this.visual);
    this.visual = group;
    this.group.add(group);
  }

  reset(t) {
    this.x = 0;
    this.z = SLOPE.spawnZ;
    this.y = waveHeight(0, SLOPE.spawnZ, t) + OFFSET;
    this.heading = 0;
    this.speed = 0;
    this.vy = 0;
    this.airborne = false;
    this.crashed = false;
    this.spin = 0;
    this.flip = 0;
    this.lean = 0;
    this.airJumpsLeft = 0;
  }

  update(dt, input, t) {
    this.input = input;

    if (this.crashed) {
      // tumble until the timer runs out
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      this.spin += 9 * dt;
      this.respawnTimer -= dt;
      const g = waveHeight(this.x, this.z, t);
      if (this.y <= g + OFFSET) this.y = g + OFFSET;
      if (this.respawnTimer <= 0) {
        this.crashed = false;
        this.z -= 8; // reset a few metres uphill of the wipeout
        this.y = waveHeight(this.x, this.z, t) + OFFSET;
        this.speed = 0; this.heading = 0; this.vy = 0; this.spin = 0; this.flip = 0;
        this.airborne = false;
      }
      this.updateTransform(t);
      return;
    }

    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      // air control: steer spins, up/down flips (UP = backflip: flip grows
      // positive and the pitch below turns positive flip into nose-up)
      this.spin -= input.axisX * SPIN_RATE * dt;
      this.flip -= input.axisY * FLIP_RATE * dt;
      this.heading -= input.axisX * AIR_STEER * dt;
      // one air re-jump per flight (keeps the jump button responsive off wave pops)
      if (input.wasPressed('jump') && this.airJumpsLeft > 0) {
        this.airJumpsLeft--;
        this.vy = JUMP_V * 0.9;
      }
    } else {
      // ground drive: the board's own push along the downhill-facing heading,
      // plus gravity projected onto the local terrain (the giant face IS the
      // mountain): negative `along` = the face falls away ahead = accelerate.
      // The pull is capped under the board's drive, so the steepest wall can
      // always be crested — drops are rockets, climbs are never traps.
      const g = waveGradTerrain(this.x, this.z, t);
      const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
      const along = g.x * sinH + g.z * cosH;
      const pull = MathUtils.clamp(SLOPE_G * along, -PULL_MAX, PULL_MAX);
      this.speed += (ACCEL * cosH - pull - DRAG * Math.sign(this.speed)) * dt;

      const sFactor = MathUtils.clamp(Math.abs(this.speed) / MAX_SPEED, 0, 1);
      if (input.axisX !== 0 && Math.abs(this.speed) > 2) {
        this.heading -= input.axisX * STEER_RATE * (0.35 + 0.65 * sFactor) * Math.sign(this.speed) * dt;
        this.speed -= this.speed * CARVE_SCRUB * Math.abs(input.axisX) * sFactor * dt;
      }
      this.speed = MathUtils.clamp(this.speed, -12, MAX_SPEED);

      if (input.wasPressed('jump')) {
        this.vy = JUMP_V + Math.min(4, Math.abs(this.speed) * 0.05);
        this.airborne = true;
        this.airJumpsLeft = 1;
        this.spin = 0;
        this.flip = 0;
      }
    }

    // integrate horizontal position
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // ground follow, with natural "pop" when a wave drops away fast
    const ground = waveHeight(this.x, this.z, t);
    if (!this.airborne) {
      if (ground < this.y - POP_THRESHOLD) {
        this.airborne = true;
        this.airJumpsLeft = 1;
        this.spin = 0;
        this.flip = 0;
        this.vy = MathUtils.clamp((this.y - ground) * 2.5, 2, 7);
      } else {
        this.y = ground + OFFSET;
      }
    } else if (this.y <= ground + OFFSET && this.vy <= 0) {
      this.land(ground, t);
    }

    // bounds: mirror off the side walls. Downhill is unbounded — the ocean
    // goes on forever and the world (water mesh, crystals, sky dome) follows.
    const halfW = SLOPE.width / 2 - 3;
    if (Math.abs(this.x) > halfW) {
      this.x = Math.sign(this.x) * halfW;
      this.heading = -this.heading;
      this.speed *= 0.6;
    }

    // carve lean (visual roll) when grounded
    const leanTarget = this.airborne ? 0 : -input.axisX * 0.45;
    this.lean += (leanTarget - this.lean) * Math.min(1, 8 * dt);

    this.updateTransform(t);
  }

  land(ground, t) {
    this.y = ground + OFFSET;
    this.vy = 0;

    // Landing is judged on two axes, like the real sport:
    //  - board up vs ground normal (a botched flip lands on your head)
    //  - board forward vs travel direction (90°/270° spins land sideways)
    // A 180 lands "switch" (board reversed, still upright) and is legal.
    this._up.copy(UP).applyQuaternion(this.group.quaternion);
    const n = waveNormal(this.x, this.z, t);
    const upDot = this._up.x * n.x + this._up.y * n.y + this._up.z * n.z;

    this._fwdB.set(0, 0, 1).applyQuaternion(this.group.quaternion);
    const fwdLen = Math.hypot(this._fwdB.x, this._fwdB.z) || 1;
    const fwdDot =
      (this._fwdB.x * Math.sin(this.heading) + this._fwdB.z * Math.cos(this.heading)) / fwdLen;

    if (upDot < LAND_DOT || Math.abs(fwdDot) < LAND_FWD) {
      this.crashed = true;
      this.respawnTimer = 1.0;
      this.vy = 3;
      if (this.onCrash) this.onCrash();
      return;
    }

    this.airborne = false;

    // evaluate the trick
    const turns = Math.abs(this.spin) / (Math.PI * 2);
    const flips = Math.abs(this.flip) / (Math.PI * 2);
    const halfTurns = Math.round(turns * 2) / 2;
    const spinName = turns >= 0.8 ? `${halfTurns * 360}` : '';
    const flipName = flips >= 0.72 ? (this.flip > 0 ? 'Backflip' : 'Frontflip') : '';
    const label = flipName && spinName ? `${flipName} ${spinName}` : flipName || spinName;

    let pts = 0;
    if (turns >= 0.8) pts += 250 * Math.floor(turns + 0.15);
    if (flips >= 0.72) pts += 400;
    if (label && pts > 0 && this.onTrick) this.onTrick(label, pts);

    this.spin = 0;
    this.flip = 0;
    this.speed = Math.max(this.speed, 8);
  }

  updateTransform(t) {
    const q = this._q;
    this._yaw.setFromAxisAngle(UP, this.heading + (this.airborne || this.crashed ? this.spin : 0));

    if (this.airborne || this.crashed) {
      // flip > 0 is a backflip: positive rotation about +x tips the nose
      // DOWN, so the pitch angle is negated (0.15 is the base crouch lean)
      this._pitch.setFromAxisAngle(X_AXIS, 0.15 - this.flip);
      this._roll.setFromAxisAngle(Z_AXIS, Math.sin(this.spin) * 0.4);
      q.multiplyQuaternions(this._yaw, this._pitch).multiply(this._roll);
    } else {
      const n = waveNormal(this.x, this.z, t);
      this._n.set(n.x, n.y, n.z);
      this._align.setFromUnitVectors(UP, this._n);
      this._roll.setFromAxisAngle(Z_AXIS, this.lean);
      q.multiplyQuaternions(this._align, this._yaw).multiply(this._roll);
    }

    this.group.quaternion.copy(q);
    this.group.position.set(this.x, this.y, this.z);
  }
}
