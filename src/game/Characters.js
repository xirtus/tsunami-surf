// The surfer roster: character models + their animation libraries, imported
// from the SURF SPACE game (see reference/surf_tricky — MIT per its README;
// the Tux model is the user's own build from the GPL-2.0 Extreme Tux Racer
// model). Each GLB is a skinned rig with a full animation library; the
// surfboard and beachwear are already part of the models.
//
// Mounting: the rigs are authored in chibi "snowboarder units" — the
// characters are ~7 m tall and the boards ~9.5 m long at scale 1 — so the
// humans carry a ~0.21 global scale (7 m -> 1.5 m, board 9.5 m -> 2 m). They
// face +z already. Tux lives in his own units (facing -x) and needs his own
// scale/rotation/offset. All mounts are data, so any of them can be retuned
// without touching code. `hide` lists meshes that must not render (e.g.
// tux's cel-shadow duplicates). Face parts (ears/eyes/goggles/lips/mullet)
// are rigid children of the head bones and follow every clip for free.
// Do NOT hide 'character_unlock': despite the roster-card name, those nodes
// ARE chad's body — hiding them leaves a floating mullet and a pair of
// boots (the bug this comment replaces).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadRigged } from './RiggedChars.js';

const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/';

const SURFER_URL = (f) => `${BASE}models/surfers/${f}`;

export const CHARACTERS = [
  {
    id: 'chad', name: 'CHAD', board: 'NIGHT GLASS', color: '#63b7ff',
    url: SURFER_URL('chad.glb'),
    mount: { scale: 0.21, y: -0.02, z: -0.04 },
    anims: {
      idle: 'chad_snowboarder_idle', left: 'female_snowboarder_left',
      right: 'female_snowboarder_right', jump: 'female_snowboarder_jump',
      cruise: 'female_snowboarder_v1', crash: 'fu',
      tricks: ['chad_snowboarder_trick1', 'chad_snowboarder_trick2', 'chad_snowboarder_trick3'],
    },
  },
  {
    id: 'zoe', name: 'ZOE', board: 'ICE VELVET', color: '#ff9ad5',
    url: SURFER_URL('zoe.glb'),
    mount: { scale: 0.21, y: -0.02, z: -0.04 },
    anims: {
      idle: 'female_snowboarder_idle', left: 'female_snowboarder_left',
      right: 'female_snowboarder_right', jump: 'female_snowboarder_jump',
      cruise: 'female_snowboarder_v1', crash: 'fu',
      tricks: ['chad_snowboarder_trick1', 'chad_snowboarder_trick2', 'chad_snowboarder_trick3'],
    },
  },
  {
    id: 'marilyn', name: 'MARILYN', board: 'CORAL DREAM', color: '#ffd27d',
    url: SURFER_URL('marilyn.glb'),
    mount: { scale: 0.21, y: -0.02, z: -0.04 },
    anims: {
      idle: 'marilyn_snowboarder_idle', left: 'female_snowboarder_left',
      right: 'female_snowboarder_right', jump: 'female_snowboarder_jump',
      cruise: 'female_snowboarder_v1', crash: 'fu',
      tricks: ['chad_snowboarder_trick1', 'chad_snowboarder_trick2', 'chad_snowboarder_trick3'],
    },
  },
  {
    id: 'tux', name: 'TUX', board: 'WAVE SLICER', color: '#9fe8ff',
    url: SURFER_URL('tux.glb'),
    mount: { y: 0.55, z: 0.0, scale: 0.12, rotY: Math.PI / 2 }, // tux units -> metres; faces -x in the GLB
    hide: ['shad'], // cel-shadow duplicates
    anims: {
      idle: 'tux_idle', left: 'female_snowboarder_left',
      right: 'female_snowboarder_right', jump: 'female_snowboarder_jump',
      cruise: 'tux_wait', crash: null, // no wipeout clip on tux
      tricks: ['chad_snowboarder_trick1', 'chad_snowboarder_trick2', 'chad_snowboarder_trick3'],
    },
  },
  // The two auto-rigged riders (RiggedChars.js): no baked GLB rig — the mesh
  // is skinned to a shared Mixamo clip library at load time, so they carry the
  // full 28-clip surf set (trim / crouch / tuck / airs / spins / wipeouts)
  // instead of the roster's six snowboard clips. `rigged` is the rig key.
  {
    id: 'kai', name: 'KAI', board: 'LOCAL GUN', color: '#f2b134',
    rigged: 'man',
    desc: 'the local — textbook stance, reads the wall like a book',
  },
  {
    id: 'bones', name: 'BONES', board: 'DEAD CALM', color: '#e8e2d0',
    rigged: 'skeleton',
    desc: 'nothing left to lose — 206 bones, zero body fat, endless air',
  },
];

export const DEFAULT_CHARACTER = CHARACTERS[0].id;

const loader = new GLTFLoader();
const cache = new Map(); // loaded GLTFs, per character id

export function loadCharacter(id) {
  const character = CHARACTERS.find((c) => c.id === id);
  if (!character) return Promise.reject(new Error(`unknown character: ${id}`));
  // the auto-rigged pair build their own skin/skeleton instead of mounting a
  // baked GLB, and are never cached: a rig owns a live mixer per instance
  if (character.rigged) return loadRigged(character, character.rigged);
  const pending = cache.get(id) || loader.loadAsync(character.url).catch((e) => {
    cache.delete(id);
    throw e;
  });
  cache.set(id, pending);
  return pending.then((gltf) => new CharacterRig(character, gltf));
}

// The loaded character: mounted GLTF scene + mixer, with a small animation
// state machine driven by the rider's physics state.
export class CharacterRig {
  constructor(character, gltf) {
    this.character = character;
    this.group = gltf.scene;
    const m = character.mount;
    this.group.position.set(m.x || 0, m.y || 0, m.z || 0);
    this.group.rotation.y = m.rotY || 0;
    this.group.scale.setScalar(m.scale || 1);

    this.mixer = new THREE.AnimationMixer(this.group);
    this.clips = {};
    for (const clip of gltf.animations || []) this.clips[clip.name] = clip;
    this.actions = {};
    this.current = null;

    // hide roster-card copies / shadow duplicates before mounting
    const hides = (character.hide || []).map((p) => new RegExp(p));
    this.group.traverse((o) => {
      if (hides.some((r) => r.test(o.name || ''))) o.visible = false;
      if (o.isMesh) {
        o.frustumCulled = false; // skinned bounds are unreliable
        o.castShadow = false;
        // the night scene under-lights PBR characters: a small emissive lift
        // off each material's own colour keeps them readable (the cel
        // outline material is black, so it stays untouched)
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat && mat.isMeshStandardMaterial && !mat.emissive.getHex()) {
            mat.emissive.copy(mat.color).multiplyScalar(0.16);
          }
        }
      }
    });
  }

  _action(name, { loop = true, clamp = false, fade = 0.25 } = {}) {
    const clip = this.clips[name];
    if (!clip) return null;
    let action = this.actions[name];
    if (!action) {
      action = this.mixer.clipAction(clip);
      action.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
      action.clampWhenFinished = clamp;
      this.actions[name] = action;
    }
    if (this.current !== name) {
      if (this.current && this.actions[this.current]) {
        this.actions[this.current].fadeOut(fade);
      }
      action.reset().fadeIn(fade).play();
      this.current = name;
    }
    return action;
  }

  update(dt, rider) {
    const a = this.character.anims;
    let name;
    let speed = 1;

    if (rider.crashed) {
      name = a.crash || a.idle;
    } else if (rider.airborne) {
      const rot = Math.abs(rider.spin) + Math.abs(rider.flip);
      if (rot > 2.2 && a.tricks) {
        const i = Math.min(a.tricks.length - 1, Math.floor(rot / 4.2));
        name = a.tricks[i];
        speed = 1.1;
      } else {
        name = a.jump;
      }
    } else if (Math.abs(rider.lean) > 0.18 && Math.abs(rider.speed) > 3) {
      name = rider.lean < 0 ? a.right : a.left; // lean < 0 = pressing right
      speed = 0.8 + Math.min(1, Math.abs(rider.speed) / 46) * 0.8;
    } else if (Math.abs(rider.speed) > 18) {
      name = a.cruise || a.idle;
      speed = 0.9 + Math.min(1, Math.abs(rider.speed) / 46) * 0.5;
    } else {
      name = a.idle;
      speed = 0.9;
    }

    const action = this._action(name);
    if (action) {
      action.timeScale += (speed - action.timeScale) * Math.min(1, 8 * dt);
      if (action.loop === THREE.LoopOnce && action.time >= action._clip.duration - 0.05) {
        // hold the last frame of one-shot clips until the state changes
        action.paused = true;
      } else {
        action.paused = false;
      }
    }
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }
}
