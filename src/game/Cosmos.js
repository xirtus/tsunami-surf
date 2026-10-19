import * as THREE from 'three';

// Procedural cosmos skybox: deep-space gradient backdrop with nebula clouds,
// a milky-way band, thousands of painted stars, plus a twinkling point layer.
// Every level paints its own sky from a preset (Levels.js SKY_PRESETS) and a
// seed, so each break has its own weather.
//
// The moon: one direction shared by the painted disc in the panorama, the
// scene's directional light, and the water's glitter road — so the light on
// the sea always comes from the same place the moon is drawn. Each level
// picks its own moon placement (Levels.js MOONS).

// the milky-way band path across the equirect texture (u in 0..1 -> v in 0..1)
function bandV(u) {
  return 0.52
    + 0.17 * Math.sin(u * Math.PI * 2 - 1.1)
    + 0.05 * Math.sin(u * Math.PI * 6.6 + 0.6);
}

export function makeCosmosTexture(seed = 20260821, sky, moonDir = [70, 110, -60]) {
  const w = 1024, h = 2048;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);

  // deep space vertical gradient
  const g = ctx.createLinearGradient(0, 0, 0, h);
  sky.stops.forEach((col, i) => g.addColorStop(i / (sky.stops.length - 1), col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // fine noise to kill gradient banding
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000000' : '#ffffff';
    ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  }
  ctx.globalAlpha = 1;

  // nebula clouds (additive), scattered by the seed over the preset's palette
  ctx.globalCompositeOperation = 'lighter';
  const nNeb = 7 + (rnd() * 4 | 0);
  for (let i = 0; i < nNeb; i++) {
    const u = rnd(), v = 0.15 + rnd() * 0.8, r = 0.16 + rnd() * 0.16;
    const rgb = sky.nebulae[(rnd() * sky.nebulae.length) | 0];
    const x = u * w, y = v * h, rad = r * w;
    // wide features are painted three times (x, x±w) so the equirect seam
    // column stays continuous — the seam is a real place, not an edge
    for (const ox of [-w, 0, w]) {
      const rg = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      rg.addColorStop(0, `rgba(${rgb},0.35)`);
      rg.addColorStop(0.5, `rgba(${rgb},0.12)`);
      rg.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = rg;
      ctx.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  }

  // milky-way band glow
  for (let x = 0; x <= w; x += 8) {
    const y = bandV(x / w) * h;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, 90);
    rg.addColorStop(0, `rgba(${sky.band},0.07)`);
    rg.addColorStop(1, `rgba(${sky.band},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x - 90, y - 90, 180, 180);
  }
  ctx.globalCompositeOperation = 'source-over';

  // painted star fields, denser along the band
  const starColors = sky.stars;
  const bandSpot = () => bandV(rnd()) + (rnd() + rnd() - 1) * 0.045;
  const drawStar = (x, y, r, alpha) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = starColors[(rnd() * starColors.length) | 0];
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  for (let i = 0; i < 1500; i++) {
    const v = rnd() < 0.6 ? bandSpot() : rnd();
    drawStar(rnd() * w, Math.min(1, Math.max(0, v)) * h, 0.4 + rnd() * 0.8, 0.25 + rnd() * 0.4);
  }
  for (let i = 0; i < 420; i++) {
    const v = rnd() < 0.7 ? bandSpot() : rnd();
    drawStar(rnd() * w, Math.min(1, Math.max(0, v)) * h, 0.7 + rnd() * 1.1, 0.6 + rnd() * 0.4);
  }

  // a few giant sparkle stars with glow + cross rays (wrapped at the seam)
  for (let i = 0; i < 26; i++) {
    const v = rnd() < 0.8 ? bandSpot() : rnd();
    const x0 = rnd() * w, y = Math.min(1, Math.max(0, v)) * h;
    for (const ox of [-w, 0, w]) {
      const x = x0 + ox;
      const rg = ctx.createRadialGradient(x, y, 0, x, y, 14);
      rg.addColorStop(0, 'rgba(255,255,255,0.9)');
      rg.addColorStop(0.25, 'rgba(255,255,255,0.35)');
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = rg;
      ctx.fillRect(x - 14, y - 14, 28, 28);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x - 26, y); ctx.lineTo(x + 26, y);
      ctx.moveTo(x, y - 26); ctx.lineTo(x, y + 26);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // the moon, last so it sits over stars and band glow
  paintMoon(ctx, w, h, moonDir, sky.moon);

  // Guarantee a seamless longitude wrap: stamp the left edge onto the right
  // edge (flipped, so source column 0 lands exactly on the last column) with
  // a feathered ramp. Wide features are wrap-drawn above; this absorbs the
  // small stuff (stars, noise) that is not worth triple-painting.
  const SW = 48;
  const mc = document.createElement('canvas');
  mc.width = SW; mc.height = h;
  const mctx = mc.getContext('2d');
  mctx.translate(SW, 0);
  mctx.scale(-1, 1); // flip: mc column i = source column SW-1-i
  mctx.drawImage(c, 0, 0, SW, h, 0, 0, SW, h);
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalCompositeOperation = 'destination-in';
  const mg = mctx.createLinearGradient(0, 0, SW, 0);
  mg.addColorStop(0, 'rgba(0,0,0,0)');
  mg.addColorStop(1, 'rgba(0,0,0,1)');
  mctx.fillStyle = mg;
  mctx.fillRect(0, 0, SW, h);
  ctx.drawImage(mc, w - SW, 0); // main column w-1 now equals column 0 exactly

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // longitude must wrap: the water's reflection samples the panorama as an
  // equirect map, and the seam column is a real place, not an edge
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// paint the moon into the panorama at the exact azimuth/elevation of the
// level's moon direction, so the water's Fresnel reflection of it and the
// GGX glitter road line up. Same equirect convention the water shader
// samples with:
//   u = atan2(z, x)/2π + 0.5, v = asin(y)/π + 0.5, canvas y = (1 - v) * h
function paintMoon(ctx, w, h, moonDir, tints) {
  const len = Math.hypot(moonDir[0], moonDir[1], moonDir[2]);
  const d = [moonDir[0] / len, moonDir[1] / len, moonDir[2] / len];
  const u = Math.atan2(d[2], d[0]) / (Math.PI * 2) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, d[1]))) / Math.PI + 0.5;
  // painted three times (x, x±w): the corona and cross rays are wider than
  // the gap to either edge, and the seam column must stay continuous
  for (const ox of [-w, 0, w]) paintMoonAt(ctx, u * w + ox, (1 - v) * h, tints);
}

function paintMoonAt(ctx, x, y, tints) {
  // concentric glow: wide corona -> inner halo -> bright limb-lit disc
  const layers = [
    [340, 0.07, tints[0]],
    [150, 0.14, tints[1]],
    [64, 0.32, tints[2]],
    [26, 0.85, tints[3]],
  ];
  for (const [r, a, rgb] of layers) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${rgb},${a})`);
    rg.addColorStop(0.6, `rgba(${rgb},${a * 0.45})`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // mare shading + a few darker patches so the disc reads as a moon, not a dot
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 26, 0, Math.PI * 2);
  ctx.clip();
  const mare = [[-8, 6, 12], [6, -4, 9], [2, 9, 7], [-2, -11, 6], [12, 8, 5]];
  for (const [dx, dy, r] of mare) {
    const rg = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
    rg.addColorStop(0, 'rgba(10,14,40,0.22)');
    rg.addColorStop(1, 'rgba(10,14,40,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
  }
  // faint crater ring
  ctx.strokeStyle = 'rgba(10,14,40,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x - 10, y + 2, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // thin cross-glow so the moon reads as a light source in the sky
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = '#cfe0ff';
  ctx.fillRect(x - 420, y - 4, 840, 8);
  ctx.fillRect(x - 4, y - 420, 8, 840);
  ctx.globalAlpha = 1;
}

function makeTwinkleStars() {
  const N = 1100;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const phase = new Float32Array(N);
  const speed = new Float32Array(N);
  const rnd = mulberry32(777);

  const palette = [
    [1.0, 1.0, 1.0],
    [0.75, 0.85, 1.0],
    [1.0, 0.93, 0.78],
    [1.0, 0.8, 0.92],
    [0.8, 1.0, 0.95],
  ];
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 578 + rnd() * 20; // inside the 600-radius backdrop sphere
    pos[i * 3] = v.x * r;
    pos[i * 3 + 1] = v.y * r;
    pos[i * 3 + 2] = v.z * r;
    const c = palette[(rnd() * palette.length) | 0];
    const lum = 0.5 + rnd() * 0.5;
    col[i * 3] = c[0] * lum;
    col[i * 3 + 1] = c[1] * lum;
    col[i * 3 + 2] = c[2] * lum;
    size[i] = 1.0 + rnd() * 2.6;
    phase[i] = rnd() * Math.PI * 2;
    speed[i] = 0.4 + rnd() * 2.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('speed', new THREE.BufferAttribute(speed, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */`
      attribute float size;
      attribute vec3 color;
      attribute float phase;
      attribute float speed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uPixelRatio * (160.0 / -mv.z);
        vTwinkle = 0.45 + 0.55 * sin(uTime * speed + phase);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        a = pow(a, 1.7);
        gl_FragColor = vec4(vColor, a * vTwinkle);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  return new THREE.Points(geo, mat);
}

export class CosmosSky {
  constructor(texture) {
    this.group = new THREE.Group();

    // radius must clear the water's reach (~2 km) so the surface always sits
    // in front of the dome and its far edge dissolves into the panorama
    this.backdrop = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false })
    );
    if (texture) this.setSky(texture);
    this.twinkles = makeTwinkleStars();
    this.group.add(this.backdrop, this.twinkles);
  }

  // Live sky swap (level select): repaint the dome, keep the twinkles.
  setSky(texture) {
    const old = this.backdrop.material.map;
    this.backdrop.material.map = texture;
    this.backdrop.material.needsUpdate = true;
    if (old) old.dispose();
  }

  update(t, center) {
    this.group.rotation.y = t * 0.0035; // slow drift
    // the dome rides the camera: the surf is endless, so the sky follows and
    // direction->texture mapping stays camera-relative forever
    if (center) this.group.position.copy(center);
    this.twinkles.material.uniforms.uTime.value = t;
  }
}
