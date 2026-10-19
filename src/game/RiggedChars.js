// ============================================================================
// RIGGED CHARACTERS — skinned surfers driven by a shared Mixamo clip library.
//
// Ported from the surfmechanics game (../surfmechanics/game/src/game/
// riggedchars.js, MIT/public-domain per that repo's README) to plain WebGL
// three: the original targets three/webgpu and node materials, and everything
// else here is renderer-agnostic maths.
//
// Both source models ship UNRIGGED (the anatomical skeleton is 19 loose
// solids, the man is a single T-posed body with a stub joint), so this module
// carries its own auto-rigger:
//
//   1. models/rigs/surf_anims.glb holds a 25-bone Mixamo rest rig, normalized
//      to 1.0 unit tall, plus 28 surf clips baked in place.
//   2. The rig is posed into each model's OWN rest stance (T for the man,
//      arms-down A for the skeleton) — that posed rig is the bind pose.
//   3. Vertices are weighted by distance to the bone segments. The skeleton
//      binds near-rigidly (real bones don't bend) with each loose solid
//      restricted to the bones it anatomically belongs to; the man binds soft
//      and then gets his weights relaxed across the mesh for clean joints.
//   4. Clips play back untouched — no retargeting, because the bind pose is
//      the only thing that ever differed.
//
// The rig is handed to the game as a CharacterRig-shaped object (group /
// update(dt, rider) / dispose()), so Game.selectCharacter treats these two
// exactly like the GLB roster in Characters.js.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';
const RIG_URL = (f) => `${BASE}models/rigs/${f}`;

const M = (n) => 'mixamorig' + n;

// ---------------------------------------------------------------- library
export const RigLib = {
  ready: false,
  rest: null,             // root Bone of the normalized rest rig (1.0 tall)
  clips: {},              // name -> AnimationClip
  models: {},             // key -> loaded GLTF scene
};

const MODEL_FILES = {
  skeleton: 'skeleton_rig2.glb',
  man: 'man_rigged.glb',
};

function toBones(o) {
  const b = new THREE.Bone();
  b.name = o.name;
  b.position.copy(o.position);
  b.quaternion.copy(o.quaternion);
  b.scale.copy(o.scale);
  for (const c of o.children) b.add(toBones(c));
  return b;
}

// three dropped KHR_materials_pbrSpecularGlossiness, and both source riders
// are authored in it — without this they load as blank white. Pull the diffuse
// map (and the gloss factor) back out of the raw glTF and rebuild them as
// metal/rough materials.
async function repairSpecGloss(gltf) {
  const defs = (gltf.parser.json.materials || []);
  const sgOf = (mat) => {
    const d = defs.find((x) => x.name === mat.name)
      || (defs.length === 1 ? defs[0] : null);
    return d && d.extensions && d.extensions.KHR_materials_pbrSpecularGlossiness;
  };
  const jobs = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      const sg = sgOf(m);
      if (!sg) continue;
      if (sg.diffuseFactor) m.color.setRGB(sg.diffuseFactor[0], sg.diffuseFactor[1], sg.diffuseFactor[2]);
      if ('roughness' in m) m.roughness = 1 - (sg.glossinessFactor ?? 0.5);
      if ('metalness' in m) m.metalness = 0;
      if (sg.diffuseTexture && !m.map) {
        jobs.push(gltf.parser.getDependency('texture', sg.diffuseTexture.index).then((t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          m.map = t;
          m.needsUpdate = true;
        }));
      }
    }
  });
  await Promise.all(jobs);
}

let libPromise = null;

// Load the clip library + both source models once. Resolves when the rig can
// be built synchronously.
export function loadRigLibrary() {
  if (libPromise) return libPromise;
  const loader = new GLTFLoader();
  const jobs = [];
  jobs.push(loader.loadAsync(RIG_URL('surf_anims.glb')).then((g) => {
    let src = null;
    g.scene.traverse((o) => { if (!src && o.name === M('Hips')) src = o; });
    RigLib.rest = toBones(src);
    for (const c of g.animations) RigLib.clips[c.name] = c;
  }));
  for (const [key, file] of Object.entries(MODEL_FILES)) {
    jobs.push(loader.loadAsync(RIG_URL(file))
      .then((g) => repairSpecGloss(g).then(() => { RigLib.models[key] = g.scene; })));
  }
  libPromise = Promise.all(jobs).then(() => {
    RigLib.ready = !!(RigLib.rest && Object.keys(RigLib.clips).length);
    return RigLib;
  });
  return libPromise;
}

// ------------------------------------------------------------- bind poses
// A model sculpted in its own stance needs the rest rig folded to match before
// anything is bound to it. Two tools do that:
//   aimBone  — swing a bone (via its parent) so its child lands on a point
//   fitRig   — walk measured anatomy landmarks and rebuild the rig on them
// Only bone LENGTHS and bind ROTATIONS change; offset directions stay as
// Mixamo authored them, because a clip's rotation track drives a bone in its
// parent's frame and a re-aimed offset would send the joint somewhere else
// mid-clip.

function aimBone(bone, target) {
  const child = bone.children[0];
  if (!child) return;
  bone.updateWorldMatrix(true, false);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  bone.getWorldPosition(a);
  child.getWorldPosition(b);
  const from = b.sub(a).normalize();
  const to = target.clone().sub(a).normalize();
  if (from.lengthSq() < 1e-9 || to.lengthSq() < 1e-9) return;
  const qWorld = new THREE.Quaternion().setFromUnitVectors(from, to);
  const pq = new THREE.Quaternion(), bq = new THREE.Quaternion();
  bone.parent.getWorldQuaternion(pq);
  bone.getWorldQuaternion(bq);
  bone.quaternion.copy(pq.invert().multiply(qWorld).multiply(bq));
  bone.updateWorldMatrix(false, true);
}

// Put `name` exactly on `target`: stretch its offset to reach, then swing the
// parent to point there. Single-child parents only (limb chains) — a branch
// point like the pelvis is length-fitted and left pointing where it was.
function placeBone(root, name, target, aimParent = true) {
  const bone = root.getObjectByName(M(name));
  if (!bone || !target) return;
  const parent = bone.parent;
  parent.updateWorldMatrix(true, false);
  const p = new THREE.Vector3();
  parent.getWorldPosition(p);
  bone.position.setLength(Math.max(1e-4, p.distanceTo(target)));
  parent.updateWorldMatrix(false, true);
  if (aimParent && parent.children.length === 1) aimBone(parent, target);
  else parent.updateWorldMatrix(false, true);
}

// Rebuild the rest rig on a model's measured joints. Anything the landmark
// set doesn't mention keeps Mixamo's proportions.
function fitRig(root, LM) {
  root.updateMatrixWorld(true);
  const get = (n) => root.getObjectByName(M(n));
  const wp = (n) => { const v = new THREE.Vector3(); get(n).getWorldPosition(v); return v; };

  if (LM.hips) get('Hips').position.copy(LM.hips);
  root.updateMatrixWorld(true);

  // spine: one uniform stretch keeps the authored curve, lands Neck on T1
  if (LM.neck) {
    const chain = ['Spine', 'Spine1', 'Spine2', 'Neck'];
    const f = wp('Hips').distanceTo(LM.neck) / Math.max(1e-6, wp('Hips').distanceTo(wp('Neck')));
    for (const n of chain) get(n).position.multiplyScalar(f);
    root.updateMatrixWorld(true);
  }
  placeBone(root, 'Head', LM.head);
  placeBone(root, 'HeadTop_End', LM.crown);

  for (const side of ['Left', 'Right']) {
    const s = side.toLowerCase();
    // limb roots: length only — the pelvis and chest each carry three children
    placeBone(root, side + 'UpLeg', LM[s + 'Hip'], false);
    placeBone(root, side + 'Leg', LM[s + 'Knee']);
    placeBone(root, side + 'Foot', LM[s + 'Ankle']);
    placeBone(root, side + 'ToeBase', LM[s + 'Toe']);
    placeBone(root, side + 'Arm', LM[s + 'Shoulder']);
    placeBone(root, side + 'ForeArm', LM[s + 'Elbow']);
    placeBone(root, side + 'Hand', LM[s + 'Wrist']);
    // the hand is a leaf here (fingers are stripped) — aim it down the palm
    const hand = get(side + 'Hand');
    if (hand && LM[s + 'HandEnd']) {
      const stub = new THREE.Object3D();
      stub.position.set(0, 0.07, 0);
      hand.add(stub);
      root.updateMatrixWorld(true);
      aimBone(hand, LM[s + 'HandEnd']);
      hand.remove(stub);
    }
  }
  root.updateMatrixWorld(true);
}

// ---- landmark measurement -------------------------------------------------
// The anatomical skeleton is 19 loose solids, so its joints can be read
// straight off the geometry: the top of the tibiae IS the knee.
function slabCentroid(geo, side, yLo, yHi, zMin) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y < yLo || y > yHi) continue;
    if (side && Math.sign(x) !== side) continue;
    if (zMin !== undefined && z < zMin) continue;
    v.x += x; v.y += y; v.z += z; n++;
  }
  return n ? v.multiplyScalar(1 / n) : null;
}

function partBounds(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox;
}

// top/bottom `frac` of a part, per side -> a joint centre
function jointOf(geo, side, end, frac = 0.07) {
  if (!geo) return null;
  const b = partBounds(geo);
  const h = b.max.y - b.min.y;
  return end === 'top'
    ? slabCentroid(geo, side, b.max.y - h * frac, b.max.y)
    : slabCentroid(geo, side, b.min.y, b.min.y + h * frac);
}

function measureSkeleton(parts) {
  const LM = {};
  const P = (n) => parts[n] || null;
  for (const [side, tag] of [[1, 'left'], [-1, 'right']]) {
    LM[tag + 'Hip'] = jointOf(P('Object_13'), side, 'top');        // femur heads
    LM[tag + 'Knee'] = jointOf(P('Object_7'), side, 'top');         // tibial plateau
    LM[tag + 'Ankle'] = jointOf(P('Object_8'), side, 'top', 0.30);  // talus
    LM[tag + 'Shoulder'] = jointOf(P('Object_9'), side, 'top');     // humeral head
    LM[tag + 'Elbow'] = jointOf(P('Object_9'), side, 'bottom');     // trochlea
    LM[tag + 'Wrist'] = jointOf(P('Object_10'), side, 'bottom');    // radius, distal
    LM[tag + 'HandEnd'] = jointOf(P('Object_17'), side, 'bottom');  // fingertips
    // toes: front half of the foot, on the deck
    const feet = P('Object_8');
    if (feet) {
      const b = partBounds(feet);
      LM[tag + 'Toe'] = slabCentroid(feet, side, b.min.y, b.min.y + (b.max.y - b.min.y) * 0.4,
        b.min.z + (b.max.z - b.min.z) * 0.62);
    }
  }
  const pelvis = P('Object_12'), column = P('Object_5'), skull = P('Object_11');
  if (pelvis) {
    const b = partBounds(pelvis);
    LM.hips = new THREE.Vector3(0, (b.min.y + b.max.y) * 0.5, (b.min.z + b.max.z) * 0.5);
  }
  if (column) {
    // the vertebral column carries its own joints: C7 near the top, the atlas
    // (where the skull actually pivots) right at the crest of it
    const b = partBounds(column);
    const h = b.max.y - b.min.y;
    LM.neck = slabCentroid(column, 0, b.min.y + h * 0.85, b.min.y + h * 0.90);
    LM.head = slabCentroid(column, 0, b.max.y - h * 0.03, b.max.y);
  }
  if (skull) {
    const b = partBounds(skull);
    LM.crown = new THREE.Vector3(0, b.max.y, (b.min.z + b.max.z) * 0.5);
  }
  return LM;
}

// ------------------------------------------------------------- weighting
// Bone segments the skin can hang off. A trailing null means "extend past the
// bone along its own direction" (hands and feet have no child in the rig).
const SEGMENTS = [
  ['Hips', 'Spine'], ['Hips', 'LeftUpLeg'], ['Hips', 'RightUpLeg'],
  ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'],
  ['Neck', 'Head'], ['Head', 'HeadTop_End'],
  ['LeftShoulder', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftHand', null],
  ['RightShoulder', 'RightArm'], ['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand'], ['RightHand', null],
  ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['LeftFoot', 'LeftToeBase'], ['LeftToeBase', 'LeftToe_End'],
  ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot'], ['RightFoot', 'RightToeBase'], ['RightToeBase', 'RightToe_End'],
];

function buildSegments(root, boneIndex) {
  root.updateMatrixWorld(true);
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3();
  for (const [name, childName] of SEGMENTS) {
    const bone = root.getObjectByName(M(name));
    if (!bone) continue;
    bone.getWorldPosition(a);
    if (childName) {
      const child = root.getObjectByName(M(childName));
      if (!child) continue;
      child.getWorldPosition(b);
    } else {
      // stub: continue past the bone along the direction it came from
      bone.parent.getWorldPosition(p);
      b.copy(a).sub(p).normalize().multiplyScalar(0.07).add(a);
    }
    out.push({ bone: name, i: boneIndex[M(name)], a: a.clone(), b: b.clone() });
  }
  return out;
}

const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _q = new THREE.Vector3();
function segDist(seg, x, y, z) {
  _ab.subVectors(seg.b, seg.a);
  _ap.set(x - seg.a.x, y - seg.a.y, z - seg.a.z);
  const t = THREE.MathUtils.clamp(_ap.dot(_ab) / Math.max(1e-9, _ab.lengthSq()), 0, 1);
  _q.copy(_ab).multiplyScalar(t).add(seg.a);
  return Math.hypot(x - _q.x, y - _q.y, z - _q.z);
}

// Per-vertex weights: inverse distance to the candidate segments raised to
// `power`. Big power = crisp, near-rigid attachment (bone); small = soft skin.
function weightVertices(geo, segs, { power = 4, maxInfl = 4, smooth = 0 } = {}) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const nb = segs.length;
  const dense = new Float32Array(n * nb);
  for (let v = 0; v < n; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    let sum = 0;
    for (let s = 0; s < nb; s++) {
      const d = segDist(segs[s], x, y, z);
      const w = 1 / Math.pow(Math.max(d, 1e-4), power);
      dense[v * nb + s] = w;
      sum += w;
    }
    if (sum > 0) for (let s = 0; s < nb; s++) dense[v * nb + s] /= sum;
  }
  // relax across the mesh so joints crease instead of tearing
  if (smooth > 0 && geo.index) {
    const idx = geo.index.array;
    const acc = new Float32Array(n * nb);
    const cnt = new Float32Array(n);
    for (let it = 0; it < smooth; it++) {
      acc.fill(0); cnt.fill(0);
      for (let i = 0; i < idx.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          const a = idx[i + k], b = idx[i + (k + 1) % 3];
          for (let s = 0; s < nb; s++) {
            acc[a * nb + s] += dense[b * nb + s];
            acc[b * nb + s] += dense[a * nb + s];
          }
          cnt[a]++; cnt[b]++;
        }
      }
      for (let v = 0; v < n; v++) {
        if (!cnt[v]) continue;
        let sum = 0;
        for (let s = 0; s < nb; s++) {
          const w = dense[v * nb + s] * 0.35 + (acc[v * nb + s] / cnt[v]) * 0.65;
          dense[v * nb + s] = w; sum += w;
        }
        if (sum > 0) for (let s = 0; s < nb; s++) dense[v * nb + s] /= sum;
      }
    }
  }
  // collapse to the strongest few influences (segments of one bone merge)
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const perBone = new Map();
  for (let v = 0; v < n; v++) {
    perBone.clear();
    for (let s = 0; s < nb; s++) {
      const w = dense[v * nb + s];
      if (w <= 0) continue;
      perBone.set(segs[s].i, (perBone.get(segs[s].i) || 0) + w);
    }
    const top = [...perBone.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxInfl);
    let sum = 0; for (const [, w] of top) sum += w;
    for (let k = 0; k < 4; k++) {
      si[v * 4 + k] = top[k] ? top[k][0] : 0;
      sw[v * 4 + k] = top[k] ? top[k][1] / sum : 0;
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

// ------------------------------------------------------------ skin build
function flattenMeshes(scene) {
  const out = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

// Bake a model into rig space: 1.0 unit tall (crown to sole), soles on y=0,
// hips over the origin — the same frame the rest rig lives in.
function normalizeMatrix(meshes, targetH) {
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const size = box.getSize(new THREE.Vector3());
  const s = targetH / size.y;
  const ctr = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeTranslation(-ctr.x * s, -box.min.y * s, -ctr.z * s)
    .multiply(new THREE.Matrix4().makeScale(s, s, s));
}

function skinModel(scene, { measure, partBones, power, smooth, maxInfl, targetH = 1.0, material }) {
  // 1. every mesh into rig space (1.0 tall, soles on the floor, hips over 0)
  const meshes = flattenMeshes(scene);
  const norm = normalizeMatrix(meshes, targetH);
  const geos = new Map();
  for (const src of meshes) {
    const geo = src.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, src.matrixWorld));
    geos.set(src, geo);
  }

  // 2. fold the rest rig into this model's own stance = the bind pose
  const rest = RigLib.rest.clone(true);
  if (measure) {
    const byName = {};
    for (const [src, geo] of geos) byName[src.name] = geo;
    fitRig(rest, measure(byName));
  }

  // 3. bind at the origin so the bind matrix is plain identity
  const holder = new THREE.Object3D();
  holder.add(rest);
  holder.updateMatrixWorld(true);

  const bones = [];
  rest.traverse((b) => bones.push(b));
  const boneIndex = {};
  bones.forEach((b, i) => { boneIndex[b.name] = i; });
  const boneInverses = bones.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert());
  const allSegs = buildSegments(rest, boneIndex);

  // 4. weight and bind
  const skinned = [];
  for (const [src, geo] of geos) {
    const allow = partBones ? partBones(src, geo) : null;
    const segs = allow ? allSegs.filter((s) => allow.includes(s.bone)) : allSegs;
    weightVertices(geo, segs.length ? segs : allSegs, { power, smooth, maxInfl });
    const sm = new THREE.SkinnedMesh(geo, material ? material(src) : src.material);
    sm.name = src.name;
    sm.frustumCulled = false;
    sm.castShadow = false;
    sm.bind(new THREE.Skeleton(bones, boneInverses), new THREE.Matrix4());
    skinned.push(sm);
  }
  return { rest, bones, skinned };
}

// -------------------------------------------------------- the two riders
// The anatomical skeleton arrives as 19 loose solids (both femurs in one
// mesh, every rib in another…). Each solid is pinned to the bones it really
// belongs to so nothing smears across the body; left/right falls out of the
// distance test on its own.
const SKELETON_PARTS = {
  Object_3:  ['Head'],                                                   // skull cap
  Object_4:  ['Spine1', 'Spine2', 'Neck'],                               // ribcage
  Object_5:  ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'],      // vertebral column
  Object_6:  ['LeftShoulder', 'RightShoulder', 'Spine2'],                // scapulae
  Object_7:  ['LeftLeg', 'RightLeg'],                                    // tibiae
  Object_8:  ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'],   // feet
  Object_9:  ['LeftArm', 'RightArm'],                                    // humeri
  Object_10: ['LeftForeArm', 'RightForeArm'],                            // radii
  Object_11: ['Head'],                                                   // cranium
  Object_12: ['Hips'],                                                   // pelvis
  Object_13: ['LeftUpLeg', 'RightUpLeg'],                                // femurs
  Object_14: ['Head'],                                                   // teeth
  Object_15: ['Head'],                                                   // jaw
  Object_16: ['Spine1', 'Spine2'],                                       // sternum
  Object_17: ['LeftHand', 'RightHand'],                                  // hands
  Object_18: ['LeftForeArm', 'RightForeArm'],                            // ulnae
  Object_19: ['LeftShoulder', 'RightShoulder'],                          // clavicles
  Object_20: ['LeftLeg', 'RightLeg'],                                    // patellae
  Object_21: ['LeftLeg', 'RightLeg'],                                    // fibulae
};

// The tsunami runs at night under a single moon, which under-lights PBR skin
// and bone the same way it under-lights the GLB roster — so these materials
// get the same small emissive lift Characters.js applies.
function nightLift(m) {
  if (m.emissive && !m.emissive.getHex()) m.emissive.copy(m.color).multiplyScalar(0.16);
  return m;
}

function boneMaterial(src) {
  const m = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
  if ('roughness' in m) m.roughness = 0.62;
  if ('metalness' in m) m.metalness = 0.0;
  if ('envMapIntensity' in m) m.envMapIntensity = 0.7;
  m.side = THREE.FrontSide;
  return nightLift(m);
}

function skinMaterial(src) {
  const m = (Array.isArray(src.material) ? src.material[0] : src.material).clone();
  if ('roughness' in m) m.roughness = 0.52;
  if ('metalness' in m) m.metalness = 0.0;
  if ('envMapIntensity' in m) m.envMapIntensity = 0.8;
  return nightLift(m);
}

// Board shorts: lift the hip band of the body mesh off the skin and repaint
// it. Same vertices, same weights, so they ride along with the legs — and the
// two-leg topology below the crotch comes free.
function makeShorts(bodySkinned, lo, hi) {
  const geo = bodySkinned.geometry;
  const pos = geo.attributes.position, idx = geo.index;
  const keep = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    if (y > lo && y < hi) keep.push(a, b, c);
  }
  if (!keep.length) return null;
  const g2 = geo.clone();
  g2.setIndex(keep);
  const p = g2.attributes.position, nrm = g2.attributes.normal;
  const span = hi - lo;
  for (let v = 0; v < p.count; v++) {
    const y = p.getY(v);
    // vanish into the skin at both edges, fullest just above the hem
    const up = THREE.MathUtils.clamp((hi - y) / (span * 0.22), 0, 1);
    const dn = THREE.MathUtils.clamp((y - lo) / (span * 0.16), 0, 1);
    const t = 0.45 + 0.55 * (1 - (y - lo) / span);
    const ease = (u) => u * u * (3 - 2 * u);
    const off = 0.021 * t * ease(up) * ease(dn);
    p.setXYZ(v, p.getX(v) + nrm.getX(v) * off, y + nrm.getY(v) * off * 0.3, p.getZ(v) + nrm.getZ(v) * off);
  }
  p.needsUpdate = true;
  const mat = nightLift(new THREE.MeshPhysicalMaterial({
    color: 0x1878ad, roughness: 0.62, metalness: 0, clearcoat: 0.25,
    side: THREE.DoubleSide,
  }));
  const sm = new THREE.SkinnedMesh(g2, mat);
  sm.name = 'shorts';
  sm.frustumCulled = false;
  sm.bind(bodySkinned.skeleton, new THREE.Matrix4());
  return sm;
}

// ------------------------------------------------------------- the board
// A gun for giant water: pointed nose down +z (the rider's forward), blunt
// tail with the traction pad and thruster fins behind the back foot.
//
// The extrusion's flat top face — the deck the rider actually stands on — is
// the geometry's max y, above the three bevel rings under it. That height is
// published as `userData.deckY` so the rig can drop the board until the deck
// meets the soles the stance calibration parked at y = 0.
function makeBoard(colorA, colorB) {
  const grp = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, -1.05);
  shape.bezierCurveTo(0.30, -0.95, 0.34, -0.3, 0.30, 0.25);
  shape.bezierCurveTo(0.27, 0.72, 0.13, 1.02, 0, 1.08);
  shape.bezierCurveTo(-0.13, 1.02, -0.27, 0.72, -0.30, 0.25);
  shape.bezierCurveTo(-0.34, -0.3, -0.30, -0.95, 0, -1.05);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.07, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03,
    bevelSegments: 3, curveSegments: 24,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.06, 0);
  geo.computeBoundingBox();
  const deckY = geo.boundingBox.max.y;
  grp.add(new THREE.Mesh(geo, nightLift(new THREE.MeshPhysicalMaterial({
    color: colorA, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.15,
  }))));
  // stringer and traction pad lie ON the deck (the source game sank both of
  // them a bevel's depth inside the blank, where they never showed)
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 1.9),
    nightLift(new THREE.MeshPhysicalMaterial({ color: colorB, roughness: 0.3, clearcoat: 1 })));
  stripe.position.y = deckY - 0.002;
  grp.add(stripe);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x222228, roughness: 0.95 }));
  pad.position.set(0, deckY + 0.004, -0.55);
  grp.add(pad);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x18303c, roughness: 0.4 });
  for (const [fx, fz] of [[-0.11, -0.82], [0.11, -0.82], [0, -0.9]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.16), finMat);
    fin.position.set(fx, -0.04, fz);
    fin.rotation.x = 0.2;
    grp.add(fin);
  }
  grp.userData.deckY = deckY;
  return grp;
}

// --------------------------------------------------------- stance fitting
// Drop the rider onto the deck: spin the stance so the feet line up down the
// stringer, slide it so they stand over the pad, and settle it so the soles
// touch. Everything is read off the clips themselves (averaged over the whole
// loop, because a stance breathes), so a different clip library still lands.
//
// Then every other clip is measured the same way and gets a lift value: a
// paddling clip lies the body down where the hips used to be, a crouch drops
// it. Without this the prone clips float a body's height over the board.
const PRONE = new Set(['swim', 'tread', 'paddle']);

function calibrateStance(root, group, yaw, anim, scale) {
  const get = (n) => root.getObjectByName(M(n));
  const lf = get('LeftFoot'), rf = get('RightFoot'), hips = get('Hips'), head = get('Head');
  const blank = { baseX: yaw.position.x, baseY: yaw.position.y, baseZ: yaw.position.z, baseYaw: yaw.rotation.y, clip: {} };
  if (!lf || !rf || !RigLib.clips.trim) return blank;

  // contact points, with the flesh/bone they carry: a stander lands on the
  // soles, someone lying down lands on the ribs
  const FEET = [['LeftToeBase', 0.02], ['RightToeBase', 0.02], ['LeftFoot', 0.03], ['RightFoot', 0.03]];
  const TORSO = [['Hips', 0.11], ['Spine', 0.10], ['Spine1', 0.10], ['Spine2', 0.10]];
  const mk = (list) => list.map(([n, r]) => ({ b: get(n), r: r * scale })).filter((c) => c.b);
  const feet = mk(FEET), torso = mk(TORSO);
  const v = new THREE.Vector3();
  const local = (o) => group.worldToLocal(o.getWorldPosition(v));
  const lowOf = (set) => {
    let y = Infinity;
    for (const c of set) y = Math.min(y, local(c.b).y - c.r);
    return y;
  };
  const lowest = () => lowOf(feet);   // standing = soles on the deck

  group.updateWorldMatrix(true, true);
  const restY = lowest();

  const N = 10;
  const sample = (clipName, fn) => {
    const dur = RigLib.clips[clipName].duration;
    anim.play(clipName, 0, true);
    for (let i = 0; i < N; i++) {
      anim.mixer.setTime(dur * (i / N));
      group.updateWorldMatrix(true, true);
      fn();
    }
  };

  // 1. yaw: average the heel-to-heel line over the trim loop, point it down the board
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let dx = 0, dz = 0;
  sample('trim', () => {
    a.copy(local(lf)); b.copy(local(rf));
    dx += a.x - b.x; dz += a.z - b.z;
  });
  yaw.rotation.y -= Math.atan2(dx, dz);

  // 2. slide + settle: stance centred across the deck, back foot over the pad
  let mx = 0, mz = 0, my = 0;
  sample('trim', () => {
    a.copy(local(lf)); b.copy(local(rf));
    mx += (a.x + b.x) * 0.5; mz += (a.z + b.z) * 0.5;
    my += lowest();
  });
  yaw.position.x -= mx / N;
  yaw.position.z -= mz / N + 0.16;
  const trimGround = my / N;
  yaw.position.y -= trimGround - restY;    // the clip stands on a skateboard; we don't

  // 3. every clip gets its own settle. A clip that lies the body down also gets
  //    turned to face the nose and slid back over the middle of the board —
  //    otherwise the paddle lands sideways across the deck, a body-height up.
  const clip = {};
  const H = new THREE.Vector3(), D = new THREE.Vector3();
  for (const name of Object.keys(RigLib.clips)) {
    const prone = PRONE.has(name);
    let g = 0, px = 0, pz = 0, hx = 0, hz = 0;
    sample(name, () => {
      g += prone ? lowOf(torso) : lowest();      // ribs down, or soles down
      H.copy(local(hips)); D.copy(local(head));
      px += H.x; pz += H.z;
      hx += D.x - H.x; hz += D.z - H.z;
    });
    clip[name] = {
      lift: restY - g / N,
      yaw: prone ? -Math.atan2(hx, hz) : 0,   // head to the nose
      x: prone ? -px / N : 0,                 // and centred on the deck
      z: prone ? -pz / N : 0,
    };
  }
  group.updateMatrixWorld(true);
  return { baseY: yaw.position.y, baseYaw: yaw.rotation.y, baseX: yaw.position.x, baseZ: yaw.position.z, clip };
}

// --------------------------------------------------------- the animator
const WIPES = ['wipe1', 'wipe2', 'wipe3', 'slip'];
const AIRS = ['air', 'airfwd', 'airbig'];
const SPINS = ['spin', 'flip', 'stylish', 'bikekick', 'kick'];

function makeAnimator(root) {
  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const [name, clip] of Object.entries(RigLib.clips)) {
    const a = mixer.clipAction(clip);
    a.enabled = true;
    actions[name] = a;
  }
  const once = new Set(['land', 'hit', ...WIPES, ...AIRS, ...SPINS]);
  for (const n of once) if (actions[n]) { actions[n].loop = THREE.LoopOnce; actions[n].clampWhenFinished = true; }

  let cur = null;
  function play(name, fade = 0.25, restart = false) {
    const next = actions[name];
    if (!next || (cur === name && !restart)) return;
    const prev = cur && actions[cur] !== next ? actions[cur] : null;
    next.reset();
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    // a zero-length crossfade never resolves — hard-cut instead
    if (prev && fade > 0) next.crossFadeFrom(prev, fade, true);
    else if (prev) prev.stop();
    cur = name;
  }
  return { mixer, actions, play, get cur() { return cur; } };
}

// ------------------------------------------------------------ the riders
// Tunables measured against the rest rig (1.0 unit = full body height). The
// heights are metres here (snowsurf is a real-scale world), which puts these
// two alongside the ~1.5 m GLB roster on a 2.2 m gun.
const RIDERS = {
  skeleton: {
    id: 'bones', name: 'BONES', board: [0xe8e2d0, 0x1a1c22],
    height: 1.72, baseYaw: -0.62, y: 0.0, boardScale: 1.06, mountY: -0.20,
    skin: { measure: measureSkeleton, partBones: (m) => SKELETON_PARTS[m.name] || null,
            power: 9, smooth: 0, maxInfl: 2, material: boneMaterial },
  },
  man: {
    id: 'kai', name: 'KAI', board: [0xf2b134, 0x0f4c5c],
    height: 1.76, baseYaw: -0.58, y: 0.0, boardScale: 1.06, mountY: -0.20,
    skin: { power: 4, smooth: 3, maxInfl: 4, material: skinMaterial },
    shorts: [0.345, 0.555],
  },
};

const pick = (list) => list[(Math.random() * list.length) | 0];
const ZERO = { lift: 0, yaw: 0, x: 0, z: 0 };

// A CharacterRig-shaped wrapper, so Game.selectCharacter can't tell these
// apart from the GLB roster: same group / update(dt, rider) / dispose().
export class RiggedRig {
  constructor(character, key) {
    const def = RIDERS[key];
    this.character = character;
    this.def = def;

    this.group = new THREE.Group();       // what Rider.setVisual mounts
    this.yaw = new THREE.Group();         // stance yaw on the board
    const scaler = new THREE.Group();     // rig space -> game metres
    this.group.add(this.yaw);
    this.yaw.add(scaler);
    this.yaw.rotation.y = def.baseYaw;
    scaler.scale.setScalar(def.height);
    scaler.position.y = def.y;

    // The stance calibration below parks the soles on y = 0, so the board is
    // dropped until its deck is that plane. The whole visual then sinks by
    // mountY, because Rider.js hovers its group 0.35 m over the water and a
    // board wants its hull planing on the surface, not floating over it.
    this.board = makeBoard(def.board[0], def.board[1]);
    this.board.scale.setScalar(def.boardScale);
    this.board.position.y = -this.board.userData.deckY * def.boardScale;
    this.group.add(this.board);
    this.group.position.y = def.mountY;

    const built = skinModel(RigLib.models[key], def.skin);
    scaler.add(built.rest);
    for (const sm of built.skinned) scaler.add(sm);
    if (def.shorts) {
      const body = built.skinned.reduce((a, b) =>
        (b.geometry.attributes.position.count > (a ? a.geometry.attributes.position.count : 0) ? b : a), null);
      const shorts = makeShorts(body, def.shorts[0], def.shorts[1]);
      if (shorts) scaler.add(shorts);
    }
    this.anim = makeAnimator(built.rest);
    this.bones = {};
    for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'])
      this.bones[n] = built.rest.getObjectByName(M(n));
    this.cal = calibrateStance(built.rest, this.group, this.yaw, this.anim, def.height);
    this.now = { lift: 0, yaw: 0, x: 0, z: 0 };
    this.anim.play('trim', 0);

    this._mode = null;
    this._oneShot = 0;
    this._wipe = null;
    this._t = 0;
    this._qAdd = new THREE.Quaternion();
    this._eAdd = new THREE.Euler();
  }

  // ease the rider onto the deck for whichever clip is running
  _settle(dt) {
    const want = this.cal.clip[this.anim.cur] || ZERO;
    const k = Math.min(1, dt * 5);
    const n = this.now;
    n.lift += (want.lift - n.lift) * k;
    n.yaw += (want.yaw - n.yaw) * k;
    n.x += (want.x - n.x) * k;
    n.z += (want.z - n.z) * k;
    this.yaw.position.set(this.cal.baseX + n.x, this.cal.baseY + n.lift, this.cal.baseZ + n.z);
    this.yaw.rotation.y = this.cal.baseYaw + n.yaw;
  }

  update(dt, rider) {
    this._t += dt;
    this._oneShot = Math.max(0, this._oneShot - dt);

    let want;
    if (rider.crashed) {
      if (this._mode !== 'wipeout') {
        this._wipe = pick(WIPES);
        this.anim.play(this._wipe, 0.12, true);
        this._mode = 'wipeout';
      }
      want = this._wipe;
    } else if (rider.airborne) {
      if (this._mode !== 'air') {
        // a big rotation gets a trick clip, a straight air gets an air clip
        const rot = Math.abs(rider.spin) + Math.abs(rider.flip);
        this.anim.play(rot > 2.2 ? pick(SPINS) : pick(AIRS), 0.12, true);
        this._mode = 'air';
      }
      want = this.anim.cur;
    } else {
      if (this._mode === 'air' || this._mode === 'wipeout') {
        this.anim.play('land', 0.12, true);
        this._mode = 'land';
        this._oneShot = 0.55;
      }
      if (this._mode === 'land' && this._oneShot > 0) want = this.anim.cur;
      else if (Math.abs(rider.lean) > 0.16 && Math.abs(rider.speed) > 3) { want = 'crouch'; this._mode = 'ride'; }
      else if (Math.abs(rider.speed) > 36) { want = 'tuck'; this._mode = 'ride'; }
      else { want = 'trim'; this._mode = 'ride'; }
    }
    if (want && want !== this.anim.cur) this.anim.play(want, 0.22);

    this.anim.mixer.update(dt);
    this._settle(dt);

    // ---- additive style on top of the clip --------------------------------
    // Rider.js already rolls the whole board+rider by `lean`, so the rig only
    // adds what a body does on top of that: counter-lean through the spine and
    // eyes down the line.
    const lean = THREE.MathUtils.clamp(rider.lean / 0.45, -1, 1);
    const pump = rider.airborne || rider.crashed ? 0 : Math.abs(lean);
    const B = this.bones;
    const spineLean = lean * 0.30, spineTwist = -lean * 0.16;
    for (const [b, k] of [[B.Spine, 0.45], [B.Spine1, 0.32], [B.Spine2, 0.23]]) {
      if (!b) continue;
      this._eAdd.set(-pump * 0.16 * k, spineTwist * k, spineLean * k);
      b.quaternion.multiply(this._qAdd.setFromEuler(this._eAdd));
    }
    if (B.Head) {
      this._eAdd.set(0, 0.34 + lean * 0.25, -lean * 0.12);
      B.Head.quaternion.multiply(this._qAdd.setFromEuler(this._eAdd));
    }
    // a touch of body pitch on the pump; no roll (Rider.js owns that)
    this.group.rotation.x = -0.05 + pump * 0.14;
    if (rider.airborne) this.group.rotation.y = Math.sin(this._t * 2) * 0.12;
    else this.group.rotation.y += (0 - this.group.rotation.y) * Math.min(1, dt * 6);
  }

  dispose() {
    this.anim.mixer.stopAllAction();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }
}

// Roster entries for these two, merged into CHARACTERS by Characters.js.
export const RIGGED = Object.entries(RIDERS).map(([key, def]) => ({
  key, id: def.id, name: def.name,
}));

export function loadRigged(character, key) {
  return loadRigLibrary().then(() => {
    if (!RigLib.ready) throw new Error('rig library failed to load');
    if (!RigLib.models[key]) throw new Error(`rig model missing: ${key}`);
    return new RiggedRig(character, key);
  });
}
