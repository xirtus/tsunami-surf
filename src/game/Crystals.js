import * as THREE from 'three';
import { waveHeight, SLOPE } from './Waves.js';

// Glass crystal formations scattered over the endless surf. Rocks, but make
// them gems:
// MeshPhysicalMaterial transmission + dispersion splits light into prism
// rainbows, glowing cores shine through the facets, and colored point
// lights splash tinted pools onto the water.

const TINTS = [
  { color: 0xcfeaff, core: 0xbde8ff, light: 0x88ccff }, // ice
  { color: 0xd9c2ff, core: 0xc9a3ff, light: 0xb07bff }, // amethyst
  { color: 0xffd0de, core: 0xffb3c9, light: 0xff8fb0 }, // rose
  { color: 0xc2ffe9, core: 0x9affdd, light: 0x7dffd4 }, // teal
  { color: 0xffecc2, core: 0xffe09a, light: 0xffd27d }, // gold
];

const GLASS = TINTS.map(
  (t) =>
    new THREE.MeshPhysicalMaterial({
      color: t.color,
      transmission: 1.0,
      thickness: 2.4,
      roughness: 0.05,
      metalness: 0.0,
      ior: 2.15,           // diamond-ish refraction
      dispersion: 1.1,     // prismatic color splitting
      iridescence: 0.4,
      iridescenceIOR: 1.8,
      specularIntensity: 1.0,
      envMapIntensity: 3.2,
      emissive: t.color,  // self-glow so facets never read as black
      emissiveIntensity: 0.45,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    })
);

// shared base geometries, scaled per formation
const GEO = {
  diamond: new THREE.OctahedronGeometry(1, 0),
  spike: new THREE.ConeGeometry(0.6, 2.2, 6),
  gem: new THREE.IcosahedronGeometry(0.95, 0),
  shard: new THREE.TetrahedronGeometry(1, 0),
};

function makeShape(shape, s, tint) {
  const mat = GLASS[tint];
  if (shape === 'diamond') {
    const m = new THREE.Mesh(GEO.diamond, mat);
    m.scale.set(s, s * 1.85, s);
    return m;
  }
  if (shape === 'spike') {
    const m = new THREE.Mesh(GEO.spike, mat);
    m.scale.setScalar(s);
    return m;
  }
  if (shape === 'gem') {
    const m = new THREE.Mesh(GEO.gem, mat);
    m.scale.setScalar(s);
    return m;
  }
  if (shape === 'shard') {
    const m = new THREE.Mesh(GEO.shard, mat);
    m.scale.set(s * 0.9, s * 1.7, s);
    return m;
  }
  // cluster: three spikes fanned out like a crystal bloom
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(GEO.spike, mat);
    const a = (i / 3) * Math.PI * 2 + 0.4;
    m.position.set(Math.cos(a) * s * 0.5, 0, Math.sin(a) * s * 0.5);
    m.rotation.z = Math.cos(a) * 0.35;
    m.rotation.x = Math.sin(a) * 0.35;
    m.scale.setScalar(s * (0.7 + (i % 2) * 0.35));
    g.add(m);
  }
  return g;
}

const FORMATIONS = [
  // giant gate diamonds flanking the drop-in
  // (tints chosen to contrast against the blue-purple nebula sky)
  { x: -34, z: SLOPE.spawnZ - 2, s: 6.0, shape: 'diamond', tint: 1, light: true, spin: 0.16, bob: 0.5 },
  { x: 34, z: SLOPE.spawnZ - 2, s: 6.0, shape: 'diamond', tint: 3, light: true, spin: -0.16, bob: 0.5 },
  // near-field sentinels behind the gate, framed by the menu camera
  { x: -25, z: SLOPE.spawnZ - 15, s: 4.0, shape: 'spike', tint: 4, light: true, spin: 0.22, bob: 0.7 },
  { x: 25, z: SLOPE.spawnZ - 15, s: 4.0, shape: 'gem', tint: 2, light: true, spin: -0.22, bob: 0.7 },
  { x: -62, z: SLOPE.spawnZ + 20, s: 3.0, shape: 'spike', tint: 1, spin: 0.22, bob: 0.7 },
  { x: 62, z: SLOPE.spawnZ + 20, s: 3.0, shape: 'spike', tint: 4, spin: -0.22, bob: 0.7 },
  // mid-field scatter
  { x: -20, z: SLOPE.spawnZ + 32, s: 1.6, shape: 'gem', tint: 2, spin: 0.4 },
  { x: 26, z: SLOPE.spawnZ + 42, s: 1.9, shape: 'shard', tint: 0, spin: -0.34 },
  { x: -32, z: SLOPE.spawnZ + 56, s: 1.3, shape: 'diamond', tint: 4, spin: 0.48 },
  { x: 14, z: SLOPE.spawnZ + 66, s: 1.2, shape: 'spike', tint: 1, spin: -0.44 },
  { x: -48, z: SLOPE.spawnZ + 70, s: 2.1, shape: 'cluster', tint: 2, spin: 0.28 },
  { x: 48, z: SLOPE.spawnZ + 82, s: 1.5, shape: 'gem', tint: 1, spin: 0.4 },
  { x: -16, z: SLOPE.spawnZ + 92, s: 1.0, shape: 'shard', tint: 3, spin: -0.5 },
  { x: 32, z: SLOPE.spawnZ + 104, s: 1.8, shape: 'diamond', tint: 2, light: true, spin: 0.2, bob: 0.6 },
  { x: -66, z: SLOPE.spawnZ + 100, s: 1.2, shape: 'spike', tint: 0, spin: 0.52 },
  { x: 70, z: SLOPE.spawnZ + 122, s: 1.4, shape: 'cluster', tint: 3, spin: -0.3 },
  { x: -28, z: SLOPE.spawnZ + 130, s: 0.9, shape: 'gem', tint: 4, spin: 0.58 },
  { x: 20, z: SLOPE.spawnZ + 144, s: 1.1, shape: 'spike', tint: 2, spin: -0.38 },
];

// Endless-field pooling: a formation that falls this far behind the rider is
// re-seeded ahead of the pack, so the ocean is always dressed however long
// the ride. Respawns keep a clear ride lane around x = 0.
const RESPAWN_BEHIND = 120;  // metres uphill of the rider before recycling
const RESPAWN_AHEAD = [90, 360]; // [min, span] of the re-seed distance
const LANE_KEEP = 6;        // clear lane half-width
const LANE_MAX = 58;        // scatter half-width
const laneX = () => (Math.random() < 0.5 ? -1 : 1) * (LANE_KEEP + Math.random() * (LANE_MAX - LANE_KEEP));

// soft radial glow texture shared by all halo sprites (fake bloom)
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const GLOW_TEX = makeGlowTexture();
const GLOW_MATS = TINTS.map(
  (t) =>
    new THREE.SpriteMaterial({
      map: GLOW_TEX,
      color: t.core,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      fog: false,
    })
);

export class Crystals {
  constructor() {
    this.group = new THREE.Group();
    this.items = [];

    for (const f of FORMATIONS) {
      const root = new THREE.Group();
      const mesh = makeShape(f.shape, f.s, f.tint);
      root.add(mesh);

      const coreOff = f.s * (f.shape === 'diamond' ? 0.6 : 0.8);

      // glowing core the glass refracts — the "prism" light source
      const tint = TINTS[f.tint];
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(f.s * 0.26, 1),
        new THREE.MeshBasicMaterial({ color: tint.core, fog: false })
      );
      core.position.y = coreOff;
      root.add(core);

      // additive halo so the gem reads as a beacon even against the void
      const glow = new THREE.Sprite(GLOW_MATS[f.tint]);
      glow.position.y = coreOff;
      root.add(glow);

      let light = null;
      if (f.light) {
        light = new THREE.PointLight(tint.light, 180, 0, 2);
        this.group.add(light);
      }

      const baseYaw = f.x * 0.37;
      root.rotation.y = baseYaw;
      this.group.add(root);

      this.items.push({
        root,
        x: f.x,
        z: f.z,
        s: f.s,
        coreOff,
        baseYaw,
        spin: f.spin,
        bob: f.bob || 0.3,
        bobPhase: Math.random() * Math.PI * 2,
        glow,
        light,
        baseIntensity: 180,
      });
    }
  }

  update(t, riderZ) {
    // recycle formations that fell behind the rider, ahead of the pack
    let farZ = riderZ;
    for (const it of this.items) farZ = Math.max(farZ, it.z);
    for (const it of this.items) {
      if (it.z < riderZ - RESPAWN_BEHIND) {
        farZ += RESPAWN_AHEAD[0] + Math.random() * RESPAWN_AHEAD[1];
        it.z = farZ;
        it.x = laneX();
        it.baseYaw = Math.random() * Math.PI * 2;
      }
    }

    for (const it of this.items) {
      const y = waveHeight(it.x, it.z, t);
      const bob = Math.sin(t * 1.2 + it.bobPhase) * it.bob;

      it.root.position.set(it.x, y + it.s * 0.55 + bob, it.z);
      it.root.rotation.y = it.baseYaw + t * it.spin;

      // breathing halo
      const pulse = 1 + 0.1 * Math.sin(t * 1.7 + it.bobPhase);
      it.glow.scale.setScalar(it.s * 2.8 * pulse);

      if (it.light) {
        it.light.position.set(it.x, y + it.s * 1.5, it.z);
        it.light.intensity = it.baseIntensity * (0.85 + 0.3 * Math.sin(t * 1.9 + it.bobPhase));
      }
    }
  }
}
