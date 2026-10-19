import * as THREE from 'three';
import { Slope } from './Slope.js';
import { Rider } from './Rider.js';
import { Spray } from './Spray.js';
import { Hud } from './Hud.js';
import { Input } from './Input.js';
import { SLOPE, waveHeight, setWaveParams } from './Waves.js';
import { CosmosSky, makeCosmosTexture } from './Cosmos.js';
import { Crystals } from './Crystals.js';
import { CHARACTERS, DEFAULT_CHARACTER, loadCharacter } from './Characters.js';
import { Settings } from './Settings.js';
import { LevelMenu } from './LevelMenu.js';
import { LEVELS, randomLevel } from './Levels.js';

// Camera angles, cycled with C. The camera always tracks the rider; only the
// side of the wave it watches from changes.
const CAM_MODES = ['CHASE', 'LOW', 'FRONT', 'SIDE', 'ORBIT'];

// While the level menu browses, the rider keeps cruising on neutral input —
// the run becomes the menu's living backdrop.
const IDLE_INPUT = { axisX: 0, axisY: 0, wasPressed: () => false };

export class Game {
  constructor(mount) {
    this.mount = mount;
    this.state = 'menu'; // 'menu' | 'play'
    this.t = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    mount.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050d);
    this.scene.fog = new THREE.Fog(0x0a0e2c, 70, 420);

    // far plane clears the 3 km sky dome (and with it the water's ~2 km reach)
    this.camera = new THREE.PerspectiveCamera(
      60, window.innerWidth / window.innerHeight, 0.1, 5000
    );

    // --- level state: the wave field, the sky, the light -------------------
    this.level = LEVELS[0];
    setWaveParams(this.level.wave);
    this.moonDir = new THREE.Vector3(...this.level.moonDir).normalize();

    // cosmos sky: shared texture feeds the backdrop and a PMREM environment
    // so the glass crystals have starry light to refract and reflect
    const skyTex = makeCosmosTexture(this.level.seed, this.level.sky, this.level.moonDir);
    this.skyTex = skyTex;
    this.cosmos = new CosmosSky(skyTex);
    this.scene.add(this.cosmos.group);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = this.pmrem.fromEquirectangular(skyTex);
    this.scene.environment = this.envRT.texture;

    // moonlit cosmos lighting. The moon light rides the painted moon in the
    // panorama, so the water's glitter road always ends at it.
    this.hemi = new THREE.HemisphereLight(0x8fa3e8, 0x131735, 1.05);
    this.moonLight = new THREE.DirectionalLight(0xe8efff, 2.3);
    this.scene.add(this.hemi, this.moonLight);

    this.slope = new Slope({
      level: this.level,
      skyTex,
      moon: {
        dir: this.moonDir.clone(),
        color: this.moonLight.color.clone().multiplyScalar(2.4), // water radiance
      },
      ambient: this.hemi.color.clone().multiplyScalar(this.hemi.intensity),
      foamColor: new THREE.Color(...this.level.foam),
    });
    this.scene.add(this.slope.mesh);

    this.crystals = new Crystals();
    this.scene.add(this.crystals.group);

    // crystal point lights also splash onto the water (uniform array per frame)
    this._waterLights = this.crystals.items.filter((it) => it.light);
    this._moonWorld = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    this.rider = new Rider();
    this.rider.reset(0);
    this.scene.add(this.rider.group);

    // character roster + settings overlay (M). The default surfer loads
    // async; the rider's procedural fallback stands in until then.
    this.charRig = null;
    this.characterId = DEFAULT_CHARACTER;
    this.settings = new Settings({
      characters: CHARACTERS,
      selectedId: this.characterId,
      onSelect: (id) => this.selectCharacter(id),
      onClose: () => this.input.endFrame(),
    });
    this.selectCharacter(this.characterId);

    this.spray = new Spray();
    this.scene.add(this.spray.points);

    this.hud = new Hud();
    this.input = new Input();

    // level select: the main menu. Highlighting a break previews its actual
    // wave behind the panel; SPACE drops in. L reopens it mid-run.
    this.levelMenu = new LevelMenu({
      levels: [...LEVELS, randomLevel()],
      onPreview: (level) => this.applyLevel(level),
      onStart: (level) => this.startRun(level),
      onRoll: () => randomLevel(),
      onClose: () => this.input.endFrame(),
    });
    this.levelMenu.open();

    // scoring / feedback wiring
    this.rider.onTrick = (label, pts) => {
      this.hud.addScore(pts);
      this.hud.showTrick(label, pts);
    };
    this.rider.onCrash = () => {
      this.hud.addScore(-200);
      this.hud.flashWipeout('WIPEOUT -200');
    };
    this.distance = 0; // metres surfed downhill — the run never ends

    // chase camera state
    this.camPos = new THREE.Vector3(0, 110, SLOPE.spawnZ - 40);
    this.camLook = new THREE.Vector3(0, 50, SLOPE.spawnZ + 20);
    this.camMode = 0;          // index into CAM_MODES
    this._camSwitchAt = -10;   // last angle change (slows the pan for a beat)
    this._fwd = new THREE.Vector3();
    this._camFwd = new THREE.Vector3(0, 0, 1); // smoothed heading basis
    this._perp = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._look = new THREE.Vector3();

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // Swap the whole world to a level: wave field, water, sky, light, mood.
  applyLevel(level) {
    this.level = level;
    setWaveParams(level.wave);

    this.moonDir.set(...level.moonDir).normalize();
    this.moonLight.position.copy(this.moonDir).multiplyScalar(150);
    // the scene light follows the palette: moon glow tint on the key light,
    // the milky-way band on the sky ambient, the deep-space stop on the fog
    this.moonLight.color.set(`rgb(${level.sky.moon[1]})`);
    this.hemi.color.set(`rgb(${level.sky.band})`);
    this.hemi.groundColor.set(level.sky.stops[1]);
    this.scene.fog.color.set(level.sky.stops[1]);

    // repaint the sky + environment
    const oldTex = this.skyTex;
    this.skyTex = makeCosmosTexture(level.seed, level.sky, level.moonDir);
    this.cosmos.setSky(this.skyTex);
    const oldRT = this.envRT;
    this.envRT = this.pmrem.fromEquirectangular(this.skyTex);
    this.scene.environment = this.envRT.texture;
    if (oldRT) oldRT.dispose();
    if (oldTex) oldTex.dispose();

    // retune the water (rebuilds the shader pair, reuses the grid geometry)
    this.slope.setLevel(level, {
      skyTex: this.skyTex,
      moon: {
        dir: this.moonDir.clone(),
        color: this.moonLight.color.clone().multiplyScalar(2.4),
      },
      ambient: this.hemi.color.clone().multiplyScalar(this.hemi.intensity),
      foamColor: new THREE.Color(...level.foam),
    });

    this.hud.setLevel(level.name);
  }

  // Drop in on a break: fresh rider, fresh score, menu closes.
  startRun(level) {
    if (level !== this.level) this.applyLevel(level);
    this.levelMenu.close();
    this.hud.score = 0;
    this.distance = 0;
    this.state = 'play';
    this.rider.reset(this.t);
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;

    if (this.input.wasPressed('settings') && !this.levelMenu.visible) {
      this.input.consume('settings');
      this.input.endFrame(); // presses made inside the panel must not leak out
      this.settings.toggle();
    }
    if (this.input.wasPressed('levels') && !this.settings.visible && this.state === 'play') {
      this.input.consume('levels');
      this.input.endFrame();
      this.levelMenu.toggle();
    }

    if (!this.settings.visible && this.state === 'menu') {
      // idle drift camera, floating off the shoulder of the giant face
      const mz = SLOPE.spawnZ + 60 + Math.sin(this.t * 0.05) * 40;
      const cy = waveHeight(Math.sin(this.t * 0.07) * 60, mz - 60, this.t);
      this.camPos.set(Math.sin(this.t * 0.07) * 60, cy + 26, mz - 60);
      this.camLook.set(0, waveHeight(0, mz + 40, this.t) + 10, mz + 40);
    } else if (!this.settings.visible) {
      this.rider.update(dt, this.levelMenu.visible ? IDLE_INPUT : this.input, this.t);
      this.spray.update(dt);
      this.emitSpray();
      this.hud.setSpeed(this.rider.speed);
      this.distance += Math.max(0, this.rider.speed) * dt;
      this.hud.setDistance(this.distance);
      this.hud.update();
      if (this.input.wasPressed('cam')) {
        this.input.consume('cam');
        this.camMode = (this.camMode + 1) % CAM_MODES.length;
        this._camSwitchAt = this.t;
        this.hud.showCam(CAM_MODES[this.camMode]);
      }
      this.updateCamera(dt);
    }

    if (this.charRig) this.charRig.update(dt, this.rider);

    this.crystals.update(this.t, this.rider.z);
    this.slope.mesh.position.set(this.rider.x, 0, this.rider.z);
    this.cosmos.update(this.t, this.camPos);

    // the dome drifts; the moon light (and the water's reflection sampling)
    // rotate with it so light source and painted moon never separate
    const skyRot = this.cosmos.group.rotation.y;
    this._moonWorld.copy(this.moonDir).applyAxisAngle(this._yAxis, skyRot);
    this.moonLight.position.copy(this._moonWorld).multiplyScalar(150);
    this.slope.update(this.t, { skyRot, moonDir: this._moonWorld, lights: this._waterLights });

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.input.endFrame();
    this.renderer.render(this.scene, this.camera);
  }

  // Load a character and attach it to the rider (live swap, cached per id).
  selectCharacter(id) {
    if (this.charRig && this.charRig.character.id === id) {
      this.settings.setLoading(id, false);
      return;
    }
    this.characterId = id;
    this.settings.setLoading(id, true);
    loadCharacter(id)
      .then((rig) => {
        const old = this.charRig;
        if (old) old.dispose();
        this.rider.setVisual(rig.group);
        this.charRig = rig;
        this.settings.setLoading(id, false);
      })
      .catch((e) => {
        console.error('character load failed:', e);
        this.settings.setLoading(id, false);
      });
  }

  // All angles share one rig: compute a target camera position and a target
  // look point for the active mode, then ease both. Easing (instead of
  // snapping) is what makes angle switches a pan instead of a cut.
  updateCamera(dt) {
    const r = this.rider;
    const t = this.t;

    // smoothed forward/right basis — raw heading would whip the front and
    // side cams around on every carve input
    this._fwd.set(Math.sin(r.heading), 0, Math.cos(r.heading));
    this._camFwd.lerp(this._fwd, 1 - Math.exp(-6 * dt)).normalize();
    const perp = this._perp.set(this._camFwd.z, 0, -this._camFwd.x); // right

    const target = this._target.set(r.x, r.y, r.z);
    const look = this._look.set(r.x, r.y + 1.1, r.z);
    // speed lead: the eased follow lags ~speed/k metres behind at full chat;
    // aiming the chase/low targets a touch ahead keeps the rider framed
    const lead = THREE.MathUtils.clamp(r.speed, 0, 46) * 0.11;

    switch (this.camMode) {
      case 0: // chase — behind the board, looking down the run
        target.addScaledVector(this._camFwd, -11.0 + lead);
        target.y += 5.2;
        look.addScaledVector(this._camFwd, 7);
        look.y += 0.1;
        break;
      case 1: // low — tight surf-movie chase at wave level
        target.addScaledVector(this._camFwd, -4.8 + lead);
        target.y += 2.4;
        look.addScaledVector(this._camFwd, 6);
        look.y -= 0.3;
        break;
      case 2: // front — downhill side, facing the rider coming at you
        target.addScaledVector(this._camFwd, 12.5);
        target.y += 4.2;
        break;
      case 3: // side — off the right shoulder, across the carve
        target.addScaledVector(perp, 13.5).addScaledVector(this._camFwd, -2.5);
        target.y += 4.0;
        look.addScaledVector(this._camFwd, 4);
        look.y -= 0.1;
        break;
      case 4: { // orbit — slow cinematic revolution around the rider
        const a = t * 0.38;
        target.addScaledVector(this._camFwd, Math.cos(a) * 13.5)
          .addScaledVector(perp, Math.sin(a) * 13.5);
        target.y += 5.5;
        break;
      }
    }

    // never dip under the surface (a following face can tower over the
    // rider — the guard lifts the camera up the wall), and never hang out
    // over the void past the water patch's edges
    const minY = waveHeight(target.x, target.z, t) + 1.0;
    if (target.y < minY) target.y = minY;
    target.x = THREE.MathUtils.clamp(target.x, -118, 118);
    target.z = THREE.MathUtils.clamp(target.z, r.z - 240, r.z + 400);

    // a slower ease for a beat after a switch turns the cut into a pan
    const k = (t - this._camSwitchAt < 0.9) ? 2.2 : 5.0;
    const s = 1 - Math.exp(-k * dt);
    this.camPos.lerp(target, s);
    this.camLook.lerp(look, s);

    const fovTarget = 58 + (Math.abs(r.speed) / 46) * 16 + (this.camMode === 4 ? 4 : 0);
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-3 * dt));
    this.camera.updateProjectionMatrix();
  }

  emitSpray() {
    const r = this.rider;
    if (r.crashed || r.airborne) return;
    const carving = Math.abs(this.input.axisX) > 0.3 && Math.abs(r.speed) > 12;
    if (!carving) return;

    const fwdX = Math.sin(r.heading);
    const fwdZ = Math.cos(r.heading);
    for (let i = 0; i < 2; i++) {
      const px = r.x + (Math.random() - 0.5) * 1.4;
      const pz = r.z + (Math.random() - 0.5) * 1.4;
      const vx = -fwdX * r.speed * 0.1 + (Math.random() - 0.5) * 2 - this.input.axisX * fwdZ * 3;
      const vz = -fwdZ * r.speed * 0.1 + (Math.random() - 0.5) * 2 + this.input.axisX * fwdX * 3;
      const vy = 1.5 + Math.random() * 2.5;
      this.spray.spawn(px, r.y + 0.05, pz, vx, vy, vz);
    }
  }
}
