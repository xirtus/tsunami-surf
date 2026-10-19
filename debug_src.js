import * as THREE from 'three';

const out = document.getElementById('out');
const log = (...a) => { out.textContent += a.join(' ') + '\n'; };
window.addEventListener('error', (e) => log('WINDOW ERROR:', e.message));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(640, 480);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050d);
scene.fog = new THREE.Fog(0x0a0e2c, 70, 420);
const cam = new THREE.PerspectiveCamera(60, 640 / 480, 0.1, 900);
cam.position.set(18.8, 120, -170);
cam.lookAt(9.4, 45, -100);

// fake cosmos texture
const c = document.createElement('canvas');
c.width = 64; c.height = 128;
const ctx = c.getContext('2d');
const g = ctx.createLinearGradient(0, 0, 0, 128);
g.addColorStop(0, '#02030a');
g.addColorStop(0.5, '#0e1238');
g.addColorStop(1, '#241350');
ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 128);
for (let i = 0; i < 300; i++) {
  ctx.fillStyle = `rgba(255,255,255,${0.3 + Math.random() * 0.7})`;
  ctx.fillRect(Math.random() * 64, Math.random() * 128, 1.2, 1.2);
}
const tex = new THREE.CanvasTexture(c);
tex.colorSpace = THREE.SRGBColorSpace;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 24, 12),
  new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
);
scene.add(sky);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(tex).texture;
pmrem.dispose();
log('PMREM env created:', !!scene.environment);

const hemi = new THREE.HemisphereLight(0x8fa3e8, 0x131735, 0.95);
const sun = new THREE.DirectionalLight(0xe8efff, 2.0);
sun.position.set(70, 110, -60);
scene.add(hemi, sun);

// water
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 480, 40, 80),
  new THREE.MeshStandardMaterial({ color: 0x0e62a8, roughness: 0.25, metalness: 0.08 })
);
water.rotation.x = -Math.PI / 2;
water.position.set(0, 40, 130);
scene.add(water);

// crystal exactly like the game's
const glass = new THREE.Mesh(
  new THREE.OctahedronGeometry(1, 0),
  new THREE.MeshPhysicalMaterial({
    color: 0xcfeaff, transmission: 1.0, thickness: 2.4, roughness: 0.05,
    metalness: 0, ior: 2.15, dispersion: 1.1, iridescence: 0.4, iridescenceIOR: 1.8,
    specularIntensity: 1.0, envMapIntensity: 2.2,
    emissive: 0xcfeaff, emissiveIntensity: 0.18,
    clearcoat: 1.0, clearcoatRoughness: 0.06,
  })
);
glass.scale.set(6, 11.1, 6);
glass.position.set(-34, 100, -112);

const core = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.96, 1),
  new THREE.MeshBasicMaterial({ color: 0xbde8ff, fog: false })
);
core.position.set(-34, 100, -112);

scene.add(glass, core);

renderer.render(scene, cam);
const gl = renderer.getContext();
log('glError:', gl.getError());
log('renderer.info:', JSON.stringify(renderer.info.render));

const px = new Uint8Array(4 * 640 * 480);
gl.readPixels(0, 0, 640, 480, gl.RGBA, gl.UNSIGNED_BYTE, px, 0);

// project crystal center: reuse rough screen coords from earlier: (1100,33) at 1280x720 -> (550, 22) at 640x480
const at = (x, y) => { const i = (y * 640 + x) * 4; return [px[i], px[i+1], px[i+2]]; };
log('crystal center (550,22):', at(550, 22));
log('crystal below (550,60):', at(550, 60));
log('crystal further below (550,100):', at(550, 100));
log('sky far (100,40):', at(100, 40));
log('water (320,300):', at(320, 300));
log('done');
