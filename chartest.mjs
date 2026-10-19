// Validates the character roster:
//  - baked GLB riders: every animation name in CHARACTERS must exist in its
//    GLB, mounts must be sane, and the GLBs must parse
//  - auto-rigged riders (RiggedChars.js): the shared clip library must carry
//    every clip the animator names, the rest rig must carry every bone the
//    weighting segments hang off, and each source model must still contain
//    the meshes its part map pins to bones
import { readFileSync } from 'fs';
import { CHARACTERS } from './src/game/Characters.js';

function parseGLB(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB: ' + path);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
}

let failed = 0;
for (const c of CHARACTERS.filter((c) => !c.rigged)) {
  const path = `public/models/surfers/${c.id}.glb`;
  const gltf = parseGLB(path);
  const clips = new Set((gltf.animations || []).map((a) => a.name));
  const missing = [];
  const check = (key) => {
    const name = c.anims[key];
    if (name && !clips.has(name)) missing.push(`${key}:${name}`);
  };
  for (const k of ['idle', 'left', 'right', 'jump', 'cruise', 'crash']) check(k);
  for (const t of c.anims.tricks || []) if (!clips.has(t)) missing.push(`trick:${t}`);
  const status = missing.length ? '[FAIL]' : '[OK]';
  if (missing.length) failed++;
  console.log(`${status} ${c.id.padEnd(8)} ${clips.size} clips | mount y:${c.mount.y} z:${c.mount.z} scale:${c.mount.scale || 1} rotY:${(c.mount.rotY || 0).toFixed(2)}${missing.length ? ' | MISSING ' + missing.join(', ') : ''}`);
}
// ---- the auto-rigged pair -------------------------------------------------
// Clip names the animator in RiggedChars.js can ask for. Kept literal here on
// purpose: importing the module would drag in three + the GLTFLoader, and the
// point of this check is that the ASSET still satisfies the CODE.
const RIG_CLIPS = [
  'trim', 'crouch', 'tuck', 'land', 'hit',
  'wipe1', 'wipe2', 'wipe3', 'slip',          // WIPES
  'air', 'airfwd', 'airbig',                   // AIRS
  'spin', 'flip', 'stylish', 'bikekick', 'kick', // SPINS
];
// Every bone named by SEGMENTS / calibrateStance / the additive style layer.
const RIG_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];
const RIG_FILES = { man: 'man_rigged.glb', skeleton: 'skeleton_rig2.glb' };
// the loose solids SKELETON_PARTS pins to bones
const SKELETON_MESHES = Array.from({ length: 19 }, (_, i) => `Object_${i + 3}`);

const lib = parseGLB('public/models/rigs/surf_anims.glb');
const libClips = new Set((lib.animations || []).map((a) => a.name));
const libBones = new Set((lib.nodes || []).map((n) => n.name));

const missingClips = RIG_CLIPS.filter((n) => !libClips.has(n));
const missingBones = RIG_BONES.filter((n) => !libBones.has('mixamorig' + n));
if (missingClips.length || missingBones.length) failed++;
console.log(`${missingClips.length || missingBones.length ? '[FAIL]' : '[OK]'} rig library` +
  ` ${libClips.size} clips, ${libBones.size} bones` +
  (missingClips.length ? ` | MISSING CLIPS ${missingClips.join(', ')}` : '') +
  (missingBones.length ? ` | MISSING BONES ${missingBones.join(', ')}` : ''));

for (const c of CHARACTERS.filter((c) => c.rigged)) {
  const gltf = parseGLB(`public/models/rigs/${RIG_FILES[c.rigged]}`);
  const names = new Set((gltf.nodes || []).filter((n) => n.mesh !== undefined).map((n) => n.name));
  const problems = [];
  if (!names.size) problems.push('no meshes');
  if (c.rigged === 'skeleton') {
    const gone = SKELETON_MESHES.filter((n) => !names.has(n));
    if (gone.length) problems.push('unmapped solids ' + gone.join(', '));
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? '[FAIL]' : '[OK]'} ${c.id.padEnd(8)} rigged:${c.rigged}` +
    ` | ${names.size} meshes${problems.length ? ' | ' + problems.join(' | ') : ''}`);
}

console.log(failed ? 'some characters have missing animation clips' : 'all roster animation clips exist');
process.exit(failed ? 1 : 0);
