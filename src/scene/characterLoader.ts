import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { mapRigBonesByName, mapVrmBones, FINGER_BONES, type HumanoidBone } from '../vmc/boneMapping';
import { computeWorldBox, type BoundCharacter } from '../vmc/retargetEngine';

export interface LoadedCharacter extends BoundCharacter {
  format: 'vrm' | 'glb' | 'gltf' | 'fbx';
  name: string;
  boneCount: number;
  fingerCount: number;
  /** Uniform scale applied to `model` at load (unit normalization). */
  baseScale: number;
  /** Bounding-box height of the file as authored (before `baseScale`), in file units. */
  naturalHeight: number;
  dispose: () => void;
}

export function detectFormat(pathOrName: string): LoadedCharacter['format'] {
  const clean = pathOrName.split('?')[0].toLowerCase();
  if (clean.endsWith('.vrm')) return 'vrm';
  if (clean.endsWith('.fbx')) return 'fbx';
  if (clean.endsWith('.gltf')) return 'gltf';
  return 'glb';
}

/** Target standing height for non-VRM models whose units are unknown. */
const TARGET_HEIGHT = 1.65;
/** Characters taller / shorter than this on stage are scaled to the nearest bound. */
const STAGE_MAX_HEIGHT = 1.8;
const STAGE_MIN_HEIGHT = 1.3;

export async function loadCharacter(
  url: string,
  format: LoadedCharacter['format'],
  name: string,
  onProgress?: (fraction: number) => void,
  /** Explicit stage height in metres (from the library manifest); skips auto-fitting. */
  targetHeight?: number,
): Promise<LoadedCharacter> {
  const root = new THREE.Group();
  root.name = `Character:${name}`;

  let model: THREE.Object3D;
  let vrm: VRM | undefined;
  let bones: Partial<Record<HumanoidBone, THREE.Object3D>>;

  const progress = (e: ProgressEvent) => {
    if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
  };

  if (format === 'fbx') {
    const loader = new FBXLoader();
    model = await loader.loadAsync(url, progress);
    bones = mapRigBonesByName(model);
  } else {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: false }));
    const gltf = await loader.loadAsync(url, progress);
    vrm = gltf.userData.vrm as VRM | undefined;
    if (vrm) {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm); // VRM 0.x faces -Z; make everything face +Z
      model = vrm.scene;
      bones = mapVrmBones(vrm);
      if (vrm.lookAt) vrm.lookAt.autoUpdate = false; // we drive eye bones from VMC
    } else {
      model = gltf.scene;
      bones = mapRigBonesByName(model);
      if (format === 'glb' || format === 'gltf') format = detectFormat(url);
    }
  }

  // Scale normalization, two passes:
  //  1. unit fix for non-VRM files (FBX in centimetres, GLBs exported at odd scales);
  //  2. stage fit for everyone: stylised avatars are often authored 2-3 m tall (or
  //     knee-high chibis). Anything outside a believable human range is brought to the
  //     nearest end of it so every character frames the same on the podium.
  let naturalHeight = 0;
  {
    const box = computeWorldBox(model);
    const h = box.max.y - box.min.y;
    if (Number.isFinite(h) && h > 0) {
      naturalHeight = h;
      if (targetHeight && targetHeight > 0) {
        model.scale.setScalar(targetHeight / h);
      } else {
        if (!vrm) {
          const s = TARGET_HEIGHT / h;
          if (s < 0.6 || s > 1.6) model.scale.multiplyScalar(s);
        }
        const scaled = h * model.scale.y;
        if (scaled > STAGE_MAX_HEIGHT) model.scale.multiplyScalar(STAGE_MAX_HEIGHT / scaled);
        else if (scaled < STAGE_MIN_HEIGHT) model.scale.multiplyScalar(STAGE_MIN_HEIGHT / scaled);
      }
    }
  }

  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false; // skinned meshes move far from their bind box
    }
  });

  root.add(model);
  root.updateMatrixWorld(true);

  const boneCount = Object.keys(bones).length;
  const fingerCount = FINGER_BONES.filter((b) => bones[b]).length;

  if (!bones.Hips) {
    throw new Error(`Could not find a humanoid rig in "${name}" (no Hips bone detected).`);
  }

  const dispose = () => {
    if (vrm) VRMUtils.deepDispose(vrm.scene);
    else {
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
            m.dispose();
          }
        }
      });
    }
  };

  return { root, model, bones, vrm, format, name, boneCount, fingerCount, baseScale: model.scale.x, naturalHeight, dispose };
}
