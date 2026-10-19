// Every mesh node of a character GLB: world position + mesh bbox (used for
// hunting stray LOD copies and verifying rig mounts).
//   node tools/glb-nodes.mjs <file.glb>
import { readFileSync } from 'fs';
import * as THREE from 'three';
function parseGLB(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
}
function nodeWorldMatrices(gltf) {
  const mats = gltf.nodes.map((n) => {
    const m = new THREE.Matrix4();
    if (n.matrix) m.fromArray(n.matrix);
    else {
      const p = new THREE.Vector3().fromArray(n.translation || [0, 0, 0]);
      const q = new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]);
      const s = new THREE.Vector3().fromArray(n.scale || [1, 1, 1]);
      m.compose(p, q, s);
    }
    return m;
  });
  const world = gltf.nodes.map(() => new THREE.Matrix4());
  const visit = (i, parent) => {
    world[i].copy(parent).multiply(mats[i]);
    (gltf.nodes[i].children || []).forEach((c) => visit(c, world[i]));
  };
  (gltf.scenes[0].nodes || []).forEach((i) => visit(i, new THREE.Matrix4()));
  return world;
}
const gltf = parseGLB(process.argv[2]);
const world = nodeWorldMatrices(gltf);
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
for (const [i, n] of gltf.nodes.entries()) {
  if (n.mesh === undefined) continue;
  const m = world[i];
  pos.setFromMatrixPosition(m);
  scl.setFromMatrixScale(m);
  // mesh local extents
  let dim = [0, 0, 0];
  for (const p of gltf.meshes[n.mesh].primitives) {
    const acc = gltf.accessors?.[p.attributes?.POSITION];
    if (!acc) continue;
    dim = [
      Math.max(dim[0], acc.max[0] - acc.min[0]),
      Math.max(dim[1], acc.max[1] - acc.min[1]),
      Math.max(dim[2], acc.max[2] - acc.min[2]),
    ];
  }
  console.log(`node[${i}] "${n.name}" at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) scale (${scl.x.toFixed(2)}, ${scl.y.toFixed(2)}, ${scl.z.toFixed(2)}) localDim (${dim.map(v => v.toFixed(1)).join(', ')}) worldDim (${(dim[0]*scl.x).toFixed(1)}, ${(dim[1]*scl.y).toFixed(1)}, ${(dim[2]*scl.z).toFixed(1)})`);
}
