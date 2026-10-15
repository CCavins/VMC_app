/**
 * VMC -> rigged character retargeting.
 *
 * VMC (/VMC/Ext/Bone/Pos) delivers Unity Humanoid *local* rotations for a
 * normalized rig: T-pose rest with identity rotations, model facing +Z, Unity
 * left-handed coordinates (+X = model's right). We:
 *
 *  1. Convert each quaternion into three.js right-handed space. Our characters
 *     face +Z with +X = model's left (glTF / VRM 1.0 convention), so the
 *     conversion is a mirror of the X axis: (x, y, z, w) -> (x, -y, -z, w).
 *  2. Accumulate "normalized world" rotations down the humanoid hierarchy
 *     (world = parentWorld * local) so missing bones on either side are harmless.
 *  3. Apply the delta-from-T-pose to the target rig in model space:
 *     desired = normWorld * restModel(bone); local = inverse(parentModel) * desired.
 *     This works for VRM 0.x, VRM 1.0, Mixamo, RPM, Blender rigs alike, as long
 *     as the rig's rest pose is a T-pose (standard for all of the above).
 *  4. Position the character on the podium: horizontal position is pinned to the
 *     podium centre (with optional sway), and the lowest estimated sole point of
 *     the feet is kept on the podium surface every frame.
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';
import type { BoneTransform, VmcFrame } from '../../shared/protocol';
import {
  FOOT_BONES,
  HUMANOID_BONES_TOPO,
  HUMANOID_PARENT,
  mirrorBoneName,
  type HumanoidBone,
} from './boneMapping';
import { ExpressionMapper } from './expressionMapper';
import { makeIdleFrame, nextBitStart, type BitKind, type IdleMode } from '../../shared/idleAnimation';
import type { ClipPose } from './animationClips';
import { DanceController } from './danceController';

export interface RetargetSettings {
  horizontalFollow: number;
  verticalFollow: number;
  footGrounding: boolean;
  floorOffset: number;
  smoothing: number;
  mirror: boolean;
  applyFingers: boolean;
  applyFace: boolean;
  applyEyes: boolean;
  applyRootRotation: boolean;
  /** Live tracking drives spine, head, arms and face only; legs stay in the standing rest pose. */
  upperBodyOnly: boolean;
  yawOffsetDeg: number;
  faceGain: number;
  /** Play a procedural idle animation when tracking is lost. */
  idleEnabled: boolean;
  /** Seconds without a tracked person before idle starts (avoids flip-flopping on brief dropouts). */
  idleDelaySec: number;
  /** Idle motion amount (1 = natural). */
  idleEnergy: number;
  /** When idle is disabled: keep last pose (true) or return to T-pose (false). */
  holdLastPose: boolean;
  /** Force the idle animation regardless of incoming data (for previewing/tuning it). */
  idlePreview?: boolean;
  /** calm = stand & look around, dance = groove loop, mixed = calm with random bits. */
  idleMode?: IdleMode;
  /** Monotonic counter; each change asks mixed idle to start its next bit right away. */
  idleBitRequest?: number;
}

export type TrackingState = 'tracking' | 'waiting' | 'idle';

export interface BoundCharacter {
  /** Group we position; contains the model. Its transform is owned by the retargeter. */
  root: THREE.Group;
  /** The loaded model scene (child of root). Scale/rotation set at load (e.g. rotateVRM0). */
  model: THREE.Object3D;
  bones: Partial<Record<HumanoidBone, THREE.Object3D>>;
  vrm?: VRM;
}

const FINGER_RE = /Thumb|Index|Middle|Ring|Little/;
const LEG_BONES = new Set<HumanoidBone>([
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
]);

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Retargeter {
  readonly char: BoundCharacter;
  readonly expressions: ExpressionMapper;

  private restModel: Partial<Record<HumanoidBone, THREE.Quaternion>> = {};
  private restLocal: Partial<Record<HumanoidBone, THREE.Quaternion>> = {};
  private restLocalPos: Partial<Record<HumanoidBone, THREE.Vector3>> = {};
  /** Rest-pose distance from each foot bone down to the sole (model space, scaled). */
  private footSoleOffset: Partial<Record<HumanoidBone, number>> = {};
  private restModelMinY = 0;
  private restHipsModelY = 0;

  private normWorld: Record<string, THREE.Quaternion> = {};
  private targetLocal: Partial<Record<HumanoidBone, THREE.Quaternion>> = {};

  private hipsBaseline: THREE.Vector3 | null = null;
  private lastHips = new THREE.Vector3();
  private groundY = 0;
  private offsetX = 0;
  private offsetZ = 0;
  private groundInit = false;
  private hasFrame = false;
  private pendingCalibrate = true;

  /** Podium surface height (world Y) that the feet should rest on. */
  podiumTopY = 0;

  constructor(char: BoundCharacter) {
    this.char = char;
    this.expressions = new ExpressionMapper(char.model, char.vrm);
    for (const b of HUMANOID_BONES_TOPO) this.normWorld[b] = new THREE.Quaternion();
    this.captureRest();
  }

  /** Record the rest (T-pose) transforms. Must be called with the model un-posed. */
  captureRest() {
    const { root, model, bones } = this.char;
    const savedRootQ = root.quaternion.clone();
    const savedRootP = root.position.clone();
    root.quaternion.identity();
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);

    for (const b of HUMANOID_BONES_TOPO) {
      const node = bones[b];
      if (!node) continue;
      this.restLocal[b] = node.quaternion.clone();
      this.restLocalPos[b] = node.position.clone();
      this.restModel[b] = this.modelSpaceQuaternion(node, new THREE.Quaternion());
    }

    // Bounding box of the (skinned) meshes in model space (root is identity here).
    const box = computeWorldBox(model);
    // Store measurements in *unscaled* model units so the user can rescale the
    // character later without re-capturing (world Y = model.scale.y * unscaled Y).
    const sc = model.scale.y || 1;
    this.restModelMinY = (box.isEmpty() ? 0 : box.min.y) / sc;
    this.restModelHeight = (box.isEmpty() ? 1.6 : box.max.y - box.min.y) / sc;

    for (const fb of FOOT_BONES) {
      const node = bones[fb];
      if (!node) continue;
      node.getWorldPosition(_v);
      this.footSoleOffset[fb] = _v.y / sc - this.restModelMinY;
    }
    const hips = bones.Hips;
    if (hips) { hips.getWorldPosition(_v); this.restHipsModelY = _v.y / sc; }

    root.quaternion.copy(savedRootQ);
    root.position.copy(savedRootP);
    root.updateMatrixWorld(true);
  }

  private restModelHeight = 1.6;

  /** Height of the model in rest pose (metres, world scale). */
  get restHeight() {
    return this.restModelHeight * (this.char.model.scale.y || 1);
  }

  calibrate() {
    this.pendingCalibrate = true;
  }

  /** Reset the rig to its rest pose. */
  resetPose() {
    for (const b of HUMANOID_BONES_TOPO) {
      const node = this.char.bones[b];
      const q = this.restLocal[b];
      if (node && q) node.quaternion.copy(q);
    }
    this.hasFrame = false;
    this.expressions.reset();
  }

  private modelSpaceQuaternion(node: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
    out.copy(node.quaternion);
    let p = node.parent;
    while (p && p !== this.char.root) {
      out.premultiply(p.quaternion);
      p = p.parent;
    }
    return out;
  }

  // ---- tracking / idle state -------------------------------------------------

  state: TrackingState = 'waiting';
  /** Seconds since the last frame that contained a *moving* tracked person. */
  private sinceLive = Infinity;
  private idleClock = Math.random() * 100;
  /** Root motion produced by the idle animation (metres, our frame). */
  private idleSwayX = 0;
  private idleSwayZ = 0;
  private idleLift = 0;
  private idleAirborne = false;
  private handledBitRequest: number | undefined;
  /** Bit currently playing in mixed idle (for the UI). */
  idleBit: BitKind | null = null;
  /** Imported dance clips (Mixamo etc.) used by the dance / mixed idle styles. */
  readonly dance = new DanceController();
  /** Name of the dance clip currently playing, if any (for the UI). */
  get danceClipName(): string | null {
    return this.state === 'idle' && this.idleBit === 'dance' ? this.dance.currentName : null;
  }
  /** 0..1, ramps when switching between live and idle so poses cross-fade. */
  private transition = 1;
  private lastSignature: Float32Array | null = null;
  private frozenFor = 0;

  /**
   * Decide whether a frame contains a real tracked person. Phone apps either stop
   * sending bones, send an all-identity pose, or keep re-sending the exact same
   * pose when they lose the subject; all three are treated as "nobody tracked".
   */
  private frameHasPerson(frame: VmcFrame, dt: number): boolean {
    if (frame.bones.length < 8) return false;
    const sig = new Float32Array(frame.bones.length * 4);
    let energy = 0;
    frame.bones.forEach((b, i) => {
      sig[i * 4] = b.qx; sig[i * 4 + 1] = b.qy; sig[i * 4 + 2] = b.qz; sig[i * 4 + 3] = b.qw;
      energy += Math.abs(b.qx) + Math.abs(b.qy) + Math.abs(b.qz);
    });
    const allIdentity = energy < 1e-3;

    let changed = true;
    if (this.lastSignature && this.lastSignature.length === sig.length) {
      let diff = 0;
      for (let i = 0; i < sig.length; i++) diff += Math.abs(sig[i] - this.lastSignature[i]);
      changed = diff > 1e-4;
    }
    this.lastSignature = sig;
    if (changed) this.frozenFor = 0; else this.frozenFor += dt;

    // A perfectly frozen pose for > 1 s is not a human being tracked.
    return !allIdentity && this.frozenFor < 1.0;
  }

  /**
   * Apply a VMC frame (or null when nothing arrived this render frame).
   * `dt` in seconds, used for smoothing and timers.
   */
  apply(frame: VmcFrame | null, s: RetargetSettings, dt: number) {
    const { bones } = this.char;
    dt = Math.min(dt, 0.1);

    // ---- classify incoming data
    let liveFrame: VmcFrame | null = null;
    if (frame) {
      if (this.frameHasPerson(frame, dt)) { liveFrame = frame; this.sinceLive = 0; }
    }
    if (s.idlePreview) { liveFrame = null; this.sinceLive = Infinity; }
    if (!liveFrame) this.sinceLive += dt;

    // ---- state machine
    const prev = this.state;
    if (liveFrame) this.state = 'tracking';
    else if (s.idlePreview) this.state = 'idle';
    else if (this.sinceLive > Math.max(0.2, s.idleDelaySec)) this.state = s.idleEnabled ? 'idle' : 'waiting';
    // Render frames routinely outrun network frames by a few ms; only call it a
    // dropout once nothing live has arrived for a noticeable stretch (hold pose).
    else if (this.state === 'tracking' && this.sinceLive > 0.5) this.state = 'waiting';
    if (prev !== this.state && (prev === 'idle' || this.state === 'idle')) this.transition = 0;
    if (this.state !== 'idle') { this.idleLift = 0; this.idleAirborne = false; this.idleBit = null; this.dance.stop(); }
    this.transition = Math.min(1, this.transition + dt / 0.9);

    // ---- compute targets
    if (this.state === 'tracking' && liveFrame) {
      this.computeTargets(liveFrame, s, true);
      this.hasFrame = true;
      if (s.applyFace) this.expressions.apply(liveFrame.blends, s.faceGain, s.mirror);
    } else if (this.state === 'idle') {
      this.idleClock += dt;
      const mode = s.idleMode ?? 'calm';
      const useClips = this.dance.hasClips && mode !== 'calm';
      // "Surprise me": jump the idle clock to the next scheduled bit / next dance clip.
      if (s.idleBitRequest !== undefined && s.idleBitRequest !== this.handledBitRequest) {
        this.handledBitRequest = s.idleBitRequest;
        if (mode === 'mixed') this.idleClock = nextBitStart(this.idleClock) - 0.3;
        else if (mode === 'dance' && useClips) this.dance.skip();
      }
      const idle = makeIdleFrame(this.idleClock, { energy: s.idleEnergy, mode, externalDance: useClips });
      this.composeNormWorld(idle, { ...s, mirror: false, applyRootRotation: false, upperBodyOnly: false });
      // Root motion produced by the idle: lateral pelvis sway (Unity +X = model right =
      // our -X), plus lift / airborne for hops and flips.
      const sc = this.char.model.scale.y || 1;
      let swayX = -idle.idle.swayX * sc;
      let swayZ = 0;
      this.idleLift = idle.idle.lift * sc;
      this.idleAirborne = idle.idle.airborne;
      this.idleBit = idle.idle.bit;

      if (useClips && idle.idle.bit === 'dance' && idle.idle.bitWeight > 0) {
        // Real dance clip blended over the calm base pose.
        const pose = this.dance.update(dt);
        if (pose) {
          const w = idle.idle.bitWeight;
          this.blendNormWorld(pose, w);
          // Clip hips travel, scaled to this character's hip height and kept on the podium.
          const hipH = Math.max(0.3, (this.restHipsModelY - this.restModelMinY) * sc);
          const lim = 0.35;
          const cx = THREE.MathUtils.clamp(pose.hips.x * hipH, -lim, lim);
          const cz = THREE.MathUtils.clamp(pose.hips.z * hipH, -lim, lim);
          swayX = THREE.MathUtils.lerp(swayX, cx, w);
          swayZ = cz * w;
        }
      } else {
        this.dance.stop();
      }
      this.solveTargets();
      this.idleSwayX = swayX;
      this.idleSwayZ = swayZ;
      this.hasFrame = true;
      if (s.applyFace) this.expressions.apply(idle.blends, 1, false);
    } else if (this.state === 'waiting' && !s.holdLastPose && this.sinceLive > Math.max(0.2, s.idleDelaySec)) {
      // Idle disabled and the user prefers the rest pose when tracking is gone.
      for (const b of HUMANOID_BONES_TOPO) {
        const rest = this.restLocal[b];
        if (rest) (this.targetLocal[b] ??= new THREE.Quaternion()).copy(rest);
      }
      this.hasFrame = true;
    }

    if (!this.hasFrame) {
      this.placeRoot(s, dt);
      return;
    }

    // ---- blend current local rotations toward targets (frame-rate independent).
    // During a live<->idle transition we force extra smoothing so the pose cross-fades.
    const smoothing = this.transition < 1 ? Math.max(s.smoothing, 0.9) : s.smoothing;
    const t = smoothing <= 0 ? 1 : Math.min(1, Math.max(0.02, 1 - Math.pow(Math.min(0.99, smoothing), dt * 60)));
    for (const b of HUMANOID_BONES_TOPO) {
      const node = bones[b];
      const target = this.targetLocal[b];
      if (!node || !target) continue;
      if (t >= 1) node.quaternion.copy(target);
      else node.quaternion.slerp(target, t);
    }

    this.placeRoot(s, dt);
  }

  private static readonly tmpBone: BoneTransform = { name: '', px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  private computeTargets(frame: VmcFrame, s: RetargetSettings, updateHips: boolean) {
    const byName = this.composeNormWorld(frame, s);
    this.solveTargets();
    this.readHips(byName, s, updateHips);
  }

  /** Slerp the composed model-space pose toward an animation-clip pose. */
  private blendNormWorld(pose: ClipPose, k: number) {
    if (k <= 0) return;
    for (const b of HUMANOID_BONES_TOPO) {
      const q = pose.world[b];
      if (!q) continue;
      if (k >= 1) this.normWorld[b].copy(q); else this.normWorld[b].slerp(q, k);
    }
  }

  /** Build normWorld (model-space delta from rest per bone) from a VMC frame. */
  private composeNormWorld(frame: VmcFrame, s: RetargetSettings): Map<string, BoneTransform> {
    const byName = new Map<string, BoneTransform>();
    for (const b of frame.bones) byName.set(b.name, b);

    const lookup = (b: HumanoidBone): BoneTransform | undefined => {
      const src = s.mirror ? mirrorBoneName(b) : b;
      return byName.get(src);
    };

    // Root rotation (optional) feeds into Hips.
    const rootQ = _q2.identity();
    if (s.applyRootRotation && frame.root) {
      unityToThree(frame.root, rootQ, s.mirror);
    }

    for (const b of HUMANOID_BONES_TOPO) {
      const parent = HUMANOID_PARENT[b];
      const world = this.normWorld[b];
      if (parent) world.copy(this.normWorld[parent]); else world.copy(rootQ);

      const src = lookup(b);
      const skipFingers = !s.applyFingers && FINGER_RE.test(b);
      const skipEyes = !s.applyEyes && (b === 'LeftEye' || b === 'RightEye');
      const skipLegs = s.upperBodyOnly && LEG_BONES.has(b);
      if (src && !skipFingers && !skipEyes && !skipLegs) {
        unityToThree(src, _q, s.mirror);
        world.multiply(_q);
      }
    }
    return byName;
  }

  /** Convert normWorld into local target rotations for the character's rig. */
  private solveTargets() {
    const { bones } = this.char;
    for (const b of HUMANOID_BONES_TOPO) {
      const world = this.normWorld[b];
      const node = bones[b];
      const rest = this.restModel[b];
      if (!node || !rest) continue;

      // desiredModel = world * rest ; local = inverse(parentModel) * desiredModel
      const desired = _q.copy(world).multiply(rest);
      const target = (this.targetLocal[b] ??= new THREE.Quaternion());
      if (node.parent && node.parent !== this.char.root) {
        this.modelSpaceQuaternionOfParentTarget(node, target);
        target.invert().multiply(desired);
      } else {
        target.copy(desired);
      }
    }
  }

  private readHips(byName: Map<string, BoneTransform>, s: RetargetSettings, updateHips: boolean) {
    const hips = updateHips ? byName.get(s.mirror ? mirrorBoneName('Hips') : 'Hips') ?? byName.get('OriginalHips') : undefined;
    if (hips) {
      // Unity -> three (X mirrored). Mirror toggles X again.
      const sx = s.mirror ? 1 : -1;
      this.lastHips.set(sx * hips.px, hips.py, hips.pz);
      if (this.pendingCalibrate || !this.hipsBaseline) {
        this.hipsBaseline = this.lastHips.clone();
        this.pendingCalibrate = false;
      }
    }
  }

  /**
   * Model-space rotation of a node's parent, using *target* rotations for humanoid
   * bones already processed this frame (parents precede children) and rest/current
   * rotations for intermediate nodes.
   */
  private modelSpaceQuaternionOfParentTarget(node: THREE.Object3D, out: THREE.Quaternion) {
    out.identity();
    let p = node.parent;
    const chain: THREE.Object3D[] = [];
    while (p && p !== this.char.root) { chain.push(p); p = p.parent; }
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      const hb = this.boneNameOf(n);
      const q = hb ? this.targetLocal[hb] ?? n.quaternion : n.quaternion;
      out.multiply(q);
    }
  }

  private boneLookup: Map<THREE.Object3D, HumanoidBone> | null = null;
  private boneNameOf(n: THREE.Object3D): HumanoidBone | undefined {
    if (!this.boneLookup) {
      this.boneLookup = new Map();
      for (const [name, node] of Object.entries(this.char.bones)) if (node) this.boneLookup.set(node, name as HumanoidBone);
    }
    return this.boneLookup.get(n);
  }

  private placeRoot(s: RetargetSettings, dt: number) {
    const { root, bones } = this.char;

    // Yaw offset
    root.rotation.set(0, THREE.MathUtils.degToRad(s.yawOffsetDeg), 0);

    // Horizontal sway relative to calibration (only while actually tracking).
    let dx = 0, dz = 0, dy = 0;
    if (this.hipsBaseline && this.hasFrame && this.state === 'tracking') {
      dx = (this.lastHips.x - this.hipsBaseline.x) * s.horizontalFollow;
      dz = (this.lastHips.z - this.hipsBaseline.z) * s.horizontalFollow;
      dy = (this.lastHips.y - this.hipsBaseline.y) * s.verticalFollow;
    } else if (this.state === 'idle') {
      dx = this.idleSwayX;
      dz = this.idleSwayZ;
      dy = this.idleLift;
    }
    const airborne = this.state === 'idle' && this.idleAirborne;

    // Foot grounding: find the lowest estimated sole point in model space.
    const sc = this.char.model.scale.y || 1;
    let targetY: number;
    if (s.footGrounding && this.hasFrame && !airborne) {
      // Temporarily evaluate with root at origin to read model-space positions.
      root.position.set(0, 0, 0);
      root.updateMatrixWorld(true);
      let lowest = Infinity;
      for (const fb of FOOT_BONES) {
        const node = bones[fb];
        const off = this.footSoleOffset[fb];
        if (!node || off === undefined) continue;
        node.getWorldPosition(_v);
        // Root is at origin and only yawed, so world Y == model Y.
        lowest = Math.min(lowest, _v.y - off * sc);
      }
      if (!Number.isFinite(lowest)) lowest = this.restModelMinY * sc;
      targetY = this.podiumTopY + s.floorOffset - lowest + dy;
    } else {
      targetY = this.podiumTopY + s.floorOffset - this.restModelMinY * sc + dy;
    }

    if (!this.groundInit) { this.groundY = targetY; this.groundInit = true; }
    // Smooth ground height to hide jitter but react quickly to crouches.
    const k = 1 - Math.pow(0.001, dt);
    // Airborne motion (hops, flips) must track the jump arc closely, not lag behind it.
    this.groundY += (targetY - this.groundY) * Math.min(1, k * (airborne || this.idleLift > 0.01 ? 6 : 1.5));
    // Horizontal offset is smoothed too so idle<->tracking hand-offs glide back to centre.
    this.offsetX += (dx - this.offsetX) * Math.min(1, k);
    this.offsetZ += (dz - this.offsetZ) * Math.min(1, k);

    root.position.set(this.offsetX, this.groundY, this.offsetZ);
    root.updateMatrixWorld(true);
  }
}

/**
 * Convert a Unity (left-handed, +X right) local quaternion into our three.js
 * frame (right-handed, +X = model's left) by mirroring the X axis.
 * If `mirror` is set, the pose is additionally reflected left<->right (the caller
 * swaps bone names), which is the same axis mirror again => original values.
 */
export function unityToThree(src: BoneTransform, out: THREE.Quaternion, mirror: boolean) {
  if (mirror) out.set(src.qx, src.qy, src.qz, src.qw);
  else out.set(src.qx, -src.qy, -src.qz, src.qw);
  return out.normalize();
}

/**
 * World-space bounding box of all meshes under `obj`. Skinned meshes are measured
 * in their *skinned* pose (bind-pose geometry can live in a different unit space
 * than the bones, e.g. Mixamo exports with cm geometry under a 0.01-scaled node).
 */
export function computeWorldBox(obj: THREE.Object3D): THREE.Box3 {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const skinned = o as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      skinned.skeleton.update(); // bone matrices are only refreshed during render otherwise
      skinned.computeBoundingBox();
      if (skinned.boundingBox) box.union(skinned.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
      return;
    }
    const g = mesh.geometry as THREE.BufferGeometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  });
  return box;
}
