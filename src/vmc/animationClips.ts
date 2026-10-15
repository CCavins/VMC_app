/**
 * Animation clip import + sampling for dances and other canned motions.
 *
 * Clips are FBX or GLB files that carry a humanoid skeleton (Mixamo "mixamorig:*",
 * Ready Player Me, Blender, VRoid naming all map) and one or more AnimationClips.
 * Mixamo downloads with "Without Skin" are the typical input.
 *
 * Sampling returns, for every humanoid bone, the bone's *model-space delta from its
 * rest orientation* - the same "normalized world" representation the retargeter
 * builds from VMC data - so a clip plays on any loaded character regardless of its
 * own rest orientations or proportions. The hips translation relative to rest is
 * returned in units of the source's hip height so it scales to the target.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HUMANOID_BONES_TOPO, mapRigBonesByName, type HumanoidBone } from './boneMapping';

export interface ClipPose {
  /** Model-space delta rotation per humanoid bone (identity = rest). */
  world: Partial<Record<HumanoidBone, THREE.Quaternion>>;
  /** Hips offset from rest, divided by the source hip height (unitless). */
  hips: THREE.Vector3;
}

export function newClipPose(): ClipPose {
  const world: ClipPose['world'] = {};
  for (const b of HUMANOID_BONES_TOPO) world[b] = new THREE.Quaternion();
  return { world, hips: new THREE.Vector3() };
}

/** out = a blended toward b by k (per-bone slerp, hips lerp). */
export function blendClipPose(a: ClipPose, b: ClipPose, k: number, out: ClipPose) {
  for (const bone of HUMANOID_BONES_TOPO) {
    const qa = a.world[bone]!, qb = b.world[bone]!, qo = out.world[bone]!;
    qo.copy(qa).slerp(qb, k);
  }
  out.hips.lerpVectors(a.hips, b.hips, k);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class ClipSource {
  readonly duration: number;
  private mixer: THREE.AnimationMixer;
  private bones: Partial<Record<HumanoidBone, THREE.Object3D>>;
  private restWorld: Partial<Record<HumanoidBone, THREE.Quaternion>> = {};
  private restHipsPos = new THREE.Vector3();
  private hipHeight = 1;
  readonly boneCount: number;

  constructor(
    readonly id: string,
    readonly name: string,
    private root: THREE.Object3D,
    clip: THREE.AnimationClip,
  ) {
    this.bones = mapRigBonesByName(root);
    this.boneCount = Object.values(this.bones).filter(Boolean).length;
    this.duration = clip.duration;

    // Rest pose: prefer the skin bind pose (guaranteed T-pose for Mixamo), else the
    // node transforms as loaded.
    root.updateMatrixWorld(true);
    const bind = new Map<THREE.Object3D, { q: THREE.Quaternion; p: THREE.Vector3 }>();
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh || !sm.skeleton) return;
      sm.skeleton.bones.forEach((b, i) => {
        if (bind.has(b)) return;
        _m.copy(sm.skeleton.boneInverses[i]).invert().premultiply(sm.bindMatrix);
        _m.decompose(_p, _q, _s);
        bind.set(b, { q: _q.clone(), p: _p.clone() });
      });
    });
    const worldOf = (node: THREE.Object3D) => {
      const bp = bind.get(node);
      if (bp) return bp;
      return { q: node.getWorldQuaternion(new THREE.Quaternion()), p: node.getWorldPosition(new THREE.Vector3()) };
    };
    let minFootY = Infinity;
    for (const b of HUMANOID_BONES_TOPO) {
      const node = this.bones[b];
      if (!node) continue;
      const w = worldOf(node);
      this.restWorld[b] = w.q;
      if (b === 'Hips') this.restHipsPos.copy(w.p);
      if (b === 'LeftFoot' || b === 'RightFoot' || b === 'LeftToes' || b === 'RightToes') minFootY = Math.min(minFootY, w.p.y);
    }
    if (!Number.isFinite(minFootY)) minFootY = 0;
    this.hipHeight = Math.max(1e-3, this.restHipsPos.y - minFootY);

    this.mixer = new THREE.AnimationMixer(root);
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
  }

  /** Evaluate the clip at `time` seconds (wraps) into `out`. */
  sample(time: number, out: ClipPose) {
    this.mixer.setTime(time % this.duration);
    this.root.updateMatrixWorld(true);
    for (const b of HUMANOID_BONES_TOPO) {
      const node = this.bones[b];
      const rest = this.restWorld[b];
      const o = out.world[b]!;
      if (!node || !rest) { o.identity(); continue; }
      node.getWorldQuaternion(o);
      o.multiply(_q.copy(rest).invert()); // world * rest^-1 = delta applied before rest
    }
    const hips = this.bones.Hips;
    if (hips) {
      hips.getWorldPosition(_p).sub(this.restHipsPos).divideScalar(this.hipHeight);
      out.hips.copy(_p);
    } else out.hips.set(0, 0, 0);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => mat?.dispose());
      }
    });
  }
}

export function detectClipFormat(nameOrUrl: string): 'fbx' | 'glb' {
  return nameOrUrl.split('?')[0].toLowerCase().endsWith('.fbx') ? 'fbx' : 'glb';
}

export interface ParsedModelFile { root: THREE.Object3D; animations: THREE.AnimationClip[] }

/** Parse an FBX / GLB file that is already in memory. */
export async function parseModelFile(file: File): Promise<ParsedModelFile> {
  const buf = await file.arrayBuffer();
  if (detectClipFormat(file.name) === 'fbx') {
    const root = new FBXLoader().parse(buf, '');
    return { root, animations: root.animations ?? [] };
  }
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  return { root: gltf.scene, animations: gltf.animations ?? [] };
}

export function clipFromParsed(parsed: ParsedModelFile, id: string, name: string): ClipSource {
  if (!parsed.animations.length) throw new Error(`${name}: file contains no animation`);
  const clip = parsed.animations.reduce((a, b) => (b.duration > a.duration ? b : a));
  const src = new ClipSource(id, name, parsed.root, clip);
  if (src.boneCount < 10) throw new Error(`${name}: could not recognise a humanoid skeleton (${src.boneCount} bones matched)`);
  return src;
}

/**
 * Load a clip file by URL. If the file contains several animations the longest one is
 * used (Mixamo files have exactly one, "mixamo.com").
 */
export async function loadClip(url: string, id: string, name: string): Promise<ClipSource> {
  let parsed: ParsedModelFile;
  if (detectClipFormat(url) === 'fbx') {
    const root = await new FBXLoader().loadAsync(url);
    parsed = { root, animations: root.animations ?? [] };
  } else {
    const gltf = await new GLTFLoader().loadAsync(url);
    parsed = { root: gltf.scene, animations: gltf.animations ?? [] };
  }
  return clipFromParsed(parsed, id, name);
}

/** Does this loaded object look like an animation file rather than a character? */
export function looksLikeClipFile(root: THREE.Object3D, animations: THREE.AnimationClip[]): boolean {
  let skinned = false;
  root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true; });
  return animations.length > 0 && !skinned;
}
