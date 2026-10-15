/**
 * Humanoid bone definitions (VMC / Unity naming) and heuristics for mapping them
 * onto arbitrary rigs: VRM 0.x / 1.0 (via three-vrm), Mixamo, Ready Player Me,
 * Blender/Rigify-style and UniVRM/VRoid raw bone names.
 */
import type { Object3D } from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { VMC_BONES, type VmcBoneName } from '../../shared/protocol';

export type HumanoidBone = Exclude<VmcBoneName, 'OriginalHips'>;

export const HUMANOID_BONES = VMC_BONES.filter((b) => b !== 'OriginalHips') as HumanoidBone[];

/** Parent of each bone in the humanoid hierarchy (null for Hips). */
export const HUMANOID_PARENT: Record<HumanoidBone, HumanoidBone | null> = {
  Hips: null,
  Spine: 'Hips', Chest: 'Spine', UpperChest: 'Chest', Neck: 'UpperChest', Head: 'Neck',
  LeftEye: 'Head', RightEye: 'Head', Jaw: 'Head',
  LeftShoulder: 'UpperChest', LeftUpperArm: 'LeftShoulder', LeftLowerArm: 'LeftUpperArm', LeftHand: 'LeftLowerArm',
  LeftThumbProximal: 'LeftHand', LeftThumbIntermediate: 'LeftThumbProximal', LeftThumbDistal: 'LeftThumbIntermediate',
  LeftIndexProximal: 'LeftHand', LeftIndexIntermediate: 'LeftIndexProximal', LeftIndexDistal: 'LeftIndexIntermediate',
  LeftMiddleProximal: 'LeftHand', LeftMiddleIntermediate: 'LeftMiddleProximal', LeftMiddleDistal: 'LeftMiddleIntermediate',
  LeftRingProximal: 'LeftHand', LeftRingIntermediate: 'LeftRingProximal', LeftRingDistal: 'LeftRingIntermediate',
  LeftLittleProximal: 'LeftHand', LeftLittleIntermediate: 'LeftLittleProximal', LeftLittleDistal: 'LeftLittleIntermediate',
  RightShoulder: 'UpperChest', RightUpperArm: 'RightShoulder', RightLowerArm: 'RightUpperArm', RightHand: 'RightLowerArm',
  RightThumbProximal: 'RightHand', RightThumbIntermediate: 'RightThumbProximal', RightThumbDistal: 'RightThumbIntermediate',
  RightIndexProximal: 'RightHand', RightIndexIntermediate: 'RightIndexProximal', RightIndexDistal: 'RightIndexIntermediate',
  RightMiddleProximal: 'RightHand', RightMiddleIntermediate: 'RightMiddleProximal', RightMiddleDistal: 'RightMiddleIntermediate',
  RightRingProximal: 'RightHand', RightRingIntermediate: 'RightRingProximal', RightRingDistal: 'RightRingIntermediate',
  RightLittleProximal: 'RightHand', RightLittleIntermediate: 'RightLittleProximal', RightLittleDistal: 'RightLittleIntermediate',
  LeftUpperLeg: 'Hips', LeftLowerLeg: 'LeftUpperLeg', LeftFoot: 'LeftLowerLeg', LeftToes: 'LeftFoot',
  RightUpperLeg: 'Hips', RightLowerLeg: 'RightUpperLeg', RightFoot: 'RightLowerLeg', RightToes: 'RightFoot',
};

/** Bones ordered so that every parent precedes its children. */
export const HUMANOID_BONES_TOPO: HumanoidBone[] = (() => {
  const out: HumanoidBone[] = [];
  const visit = (b: HumanoidBone) => {
    if (out.includes(b)) return;
    const p = HUMANOID_PARENT[b];
    if (p) visit(p);
    out.push(b);
  };
  HUMANOID_BONES.forEach(visit);
  return out;
})();

export const FINGER_BONES = HUMANOID_BONES.filter((b) => /Thumb|Index|Middle|Ring|Little/.test(b));
export const FOOT_BONES: HumanoidBone[] = ['LeftFoot', 'RightFoot', 'LeftToes', 'RightToes'];

export function mirrorBoneName(b: HumanoidBone): HumanoidBone {
  if (b.startsWith('Left')) return ('Right' + b.slice(4)) as HumanoidBone;
  if (b.startsWith('Right')) return ('Left' + b.slice(5)) as HumanoidBone;
  return b;
}

// ---------------------------------------------------------------------------
// VRM (three-vrm) mapping. three-vrm normalizes both VRM 0.x and 1.0 to the
// VRM 1.0 bone names, in which the thumb chain is Metacarpal/Proximal/Distal.
// ---------------------------------------------------------------------------

export function vmcToVrmBoneName(b: HumanoidBone): VRMHumanBoneName {
  if (b.includes('Thumb')) {
    const side = b.startsWith('Left') ? 'left' : 'right';
    if (b.endsWith('Proximal')) return `${side}ThumbMetacarpal` as VRMHumanBoneName;
    if (b.endsWith('Intermediate')) return `${side}ThumbProximal` as VRMHumanBoneName;
    return `${side}ThumbDistal` as VRMHumanBoneName;
  }
  return (b.charAt(0).toLowerCase() + b.slice(1)) as VRMHumanBoneName;
}

export function mapVrmBones(vrm: VRM): Partial<Record<HumanoidBone, Object3D>> {
  const out: Partial<Record<HumanoidBone, Object3D>> = {};
  for (const b of HUMANOID_BONES) {
    const node = vrm.humanoid.getRawBoneNode(vmcToVrmBoneName(b));
    if (node) out[b] = node;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generic name-based mapping for GLB / FBX rigs.
// ---------------------------------------------------------------------------

/**
 * Normalize a rig bone name to a comparable key:
 *  - strips common prefixes (mixamorig:, mixamorig, Armature|, J_Bip_, etc.)
 *  - converts Blender ".L/.R" and "_l_/_r_" side markers into left/right prefixes
 *  - lowercases and drops separators
 */
export function normalizeBoneName(raw: string): string {
  let n = raw.trim();
  n = n.replace(/^.*[|/]/, '');                 // "Armature|mixamorig:Hips" -> "mixamorig:Hips"
  n = n.replace(/^mixamorig[:_]?/i, '');
  n = n.replace(/^(DEF|ORG|MCH)[-_:]/i, '');
  n = n.replace(/^J_(Bip|Adj|Sec|Opt)_/i, '');  // VRoid raw names: J_Bip_L_Hand
  n = n.replace(/^(C|L|R)_/i, (m) => (m[0].toUpperCase() === 'L' ? 'Left' : m[0].toUpperCase() === 'R' ? 'Right' : ''));
  // Blender style suffixes: upper_arm.L, thigh_R, hand_l
  const side = n.match(/[._-]([LR])$/i) || n.match(/[._-]([LR])[._-]\d+$/i);
  if (side) {
    n = n.replace(/[._-]([LR])(?=$|[._-])/i, '');
    n = (side[1].toUpperCase() === 'L' ? 'Left' : 'Right') + n;
  }
  n = n.replace(/\b(left|right)[._-]/gi, (m) => m.replace(/[._-]/, ''));
  return n.toLowerCase().replace(/[^a-z0-9]/g, '');
}

type Candidates = Partial<Record<HumanoidBone, string[]>>;

const fingerCandidates = (side: 'Left' | 'Right'): Candidates => {
  const s = side.toLowerCase();
  const out: Candidates = {};
  const fingers: [string, string[]][] = [
    ['Thumb', ['thumb']],
    ['Index', ['index', 'findex']],
    ['Middle', ['middle', 'fmiddle']],
    ['Ring', ['ring', 'fring']],
    ['Little', ['pinky', 'little', 'fpinky']],
  ];
  const segs: [string, string[]][] = [
    ['Proximal', ['1', '01', 'proximal', 'metacarpal']],
    ['Intermediate', ['2', '02', 'intermediate', 'middle']],
    ['Distal', ['3', '03', 'distal']],
  ];
  for (const [fName, fAlts] of fingers) {
    for (const [segName, segAlts] of segs) {
      const key = `${side}${fName}${segName}` as HumanoidBone;
      const list: string[] = [];
      for (const f of fAlts) for (const sg of segAlts) {
        list.push(`${s}hand${f}${sg}`, `${s}${f}${sg}`, `${f}${sg}${s}`);
      }
      out[key] = list;
    }
  }
  return out;
};

const CANDIDATES: Candidates = {
  Hips: ['hips', 'pelvis', 'hip', 'root', 'bip01pelvis', 'chips'],
  Spine: ['spine', 'spine1', 'spine01', 'cspine', 'bip01spine'],
  Chest: ['spine1', 'spine2', 'chest', 'spine02', 'cchest', 'bip01spine1'],
  UpperChest: ['spine2', 'spine3', 'upperchest', 'spine03', 'cupperchest', 'bip01spine2'],
  Neck: ['neck', 'neck1', 'cneck', 'bip01neck'],
  Head: ['head', 'chead', 'bip01head'],
  LeftEye: ['lefteye', 'eyel', 'eyeleft', 'leftfaceeye'],
  RightEye: ['righteye', 'eyer', 'eyeright', 'rightfaceeye'],
  Jaw: ['jaw', 'leftjaw'],
  LeftShoulder: ['leftshoulder', 'leftclavicle', 'shoulderleft', 'leftcollar'],
  LeftUpperArm: ['leftarm', 'leftupperarm', 'upperarmleft', 'leftuparm'],
  LeftLowerArm: ['leftforearm', 'leftlowerarm', 'forearmleft', 'leftelbow'],
  LeftHand: ['lefthand', 'handleft', 'leftwrist'],
  RightShoulder: ['rightshoulder', 'rightclavicle', 'shoulderright', 'rightcollar'],
  RightUpperArm: ['rightarm', 'rightupperarm', 'upperarmright', 'rightuparm'],
  RightLowerArm: ['rightforearm', 'rightlowerarm', 'forearmright', 'rightelbow'],
  RightHand: ['righthand', 'handright', 'rightwrist'],
  LeftUpperLeg: ['leftupleg', 'leftupperleg', 'leftthigh', 'thighleft', 'leftleg1'],
  LeftLowerLeg: ['leftleg', 'leftlowerleg', 'leftshin', 'leftcalf', 'shinleft', 'leftknee'],
  LeftFoot: ['leftfoot', 'footleft', 'leftankle'],
  LeftToes: ['lefttoebase', 'lefttoes', 'lefttoe', 'toeleft'],
  RightUpperLeg: ['rightupleg', 'rightupperleg', 'rightthigh', 'thighright', 'rightleg1'],
  RightLowerLeg: ['rightleg', 'rightlowerleg', 'rightshin', 'rightcalf', 'shinright', 'rightknee'],
  RightFoot: ['rightfoot', 'footright', 'rightankle'],
  RightToes: ['righttoebase', 'righttoes', 'righttoe', 'toeright'],
  ...fingerCandidates('Left'),
  ...fingerCandidates('Right'),
};

/**
 * Map humanoid bones onto an arbitrary rig by name. Bones get claimed in priority
 * order so that e.g. Mixamo "Spine1" becomes Chest and "Spine2" becomes UpperChest
 * even though both also appear as Spine candidates.
 */
export function mapRigBonesByName(root: Object3D): Partial<Record<HumanoidBone, Object3D>> {
  const byKey = new Map<string, Object3D[]>();
  root.traverse((o) => {
    if (!o.name) return;
    const key = normalizeBoneName(o.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(o);
  });

  const out: Partial<Record<HumanoidBone, Object3D>> = {};
  const claimed = new Set<Object3D>();
  const claim = (bone: HumanoidBone) => {
    for (const cand of CANDIDATES[bone] ?? []) {
      const nodes = byKey.get(cand);
      if (!nodes) continue;
      const node = nodes.find((n) => !claimed.has(n));
      if (node) { out[bone] = node; claimed.add(node); return; }
    }
  };
  // Claim in an order that resolves ambiguity: spine chain top-down first.
  const order: HumanoidBone[] = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', ...HUMANOID_BONES_TOPO];
  for (const b of order) if (!out[b]) claim(b);
  return out;
}
