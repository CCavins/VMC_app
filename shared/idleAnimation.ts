/**
 * Procedural idle animation, shared by the browser (idle state when nobody is
 * tracked) and the bridge's demo signal. Produces a VmcFrame in the phone's
 * convention (Unity-space local rotations, T-pose = identity) so it can be fed
 * through the normal retargeting path.
 *
 * Modes
 *  - calm : relaxed stand with a slow weight sway, breathing and "looking around"
 *           (eyes dart to a new point of interest, the head follows a beat later).
 *  - dance: a looping groove - bounce on the beat, hip sway, alternating arm
 *           patterns that change every few bars, head bob.
 *  - mixed: calm, interrupted every 10-30 s by a random "bit": a dance burst, a wave,
 *           a stretch, a spin, a hop, a bow or a backflip, cross-faded in and out.
 *
 * Unity axis cheat-sheet (left-handed, +X = model right, +Y up, +Z forward):
 *  +X rotation nods forward/down, +Y turns right, +Z rolls the right side down.
 *  Arms: +Z lowers the left (-X) arm, -Z lowers the right (+X) arm.
 */
import type { BoneTransform, VmcFrame } from './protocol';

export type Q = [number, number, number, number];
export type IdleMode = 'calm' | 'dance' | 'mixed';
export type BitKind = 'dance' | 'wave' | 'stretch' | 'spin' | 'hop' | 'bow' | 'backflip';

export interface IdleStyle {
  /** Overall motion amount, 1 = natural. */
  energy: number;
  mode?: IdleMode;
  /**
   * The caller supplies real dance clips: for dance bits / dance mode the frame
   * carries only the calm base pose plus `bit: 'dance'` and `bitWeight` so the
   * caller can blend the clip in on top.
   */
  externalDance?: boolean;
}

export interface IdleFrame extends VmcFrame {
  idle: {
    /** Extra height above the stage for the root (jumps / flips), metres. */
    lift: number;
    /** When true the feet are off the ground: foot grounding should be bypassed. */
    airborne: boolean;
    /** Lateral pelvis shift (Unity X, metres) that the root should carry. */
    swayX: number;
    /** Name of the bit currently playing (mixed mode), null while calm. */
    bit: BitKind | null;
    /** Blend weight of the bit (0..1); 1 while a bit is fully in. */
    bitWeight: number;
  };
}

// ----------------------------------------------------------------------------- math

export function axisAngle(ax: number, ay: number, az: number, angle: number): Q {
  const len = Math.hypot(ax, ay, az) || 1;
  const s = Math.sin(angle / 2);
  return [(ax / len) * s, (ay / len) * s, (az / len) * s, Math.cos(angle / 2)];
}

export function mul(a: Q, b: Q): Q {
  const [ax, ay, az, aw] = a; const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Yaw (Y) then pitch (X) then roll (Z), all in radians. */
export const euler = (x: number, y: number, z: number): Q =>
  mul(mul(axisAngle(0, 1, 0, y), axisAngle(1, 0, 0, x)), axisAngle(0, 0, 1, z));

export function slerp(a: Q, b: Q, k: number): Q {
  if (k <= 0) return a;
  if (k >= 1) return b;
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  if (dot > 0.9995) {
    const r: Q = [a[0] + (bx - a[0]) * k, a[1] + (by - a[1]) * k, a[2] + (bz - a[2]) * k, a[3] + (bw - a[3]) * k];
    const n = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th = Math.acos(dot), s = Math.sin(th);
  const wa = Math.sin((1 - k) * th) / s, wb = Math.sin(k * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

export function bone(name: string, q: Q): BoneTransform {
  return { name, px: 0, py: 0, pz: 0, qx: q[0], qy: q[1], qz: q[2], qw: q[3] };
}

const IDENTITY: Q = [0, 0, 0, 1];
const smoothstep = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Smooth pseudo-random drift in roughly -1..1 built from incommensurate sines. */
function drift(t: number, seed: number, speed = 1) {
  return (
    Math.sin(t * 0.31 * speed + seed) * 0.5 +
    Math.sin(t * 0.17 * speed + seed * 2.3) * 0.3 +
    Math.sin(t * 0.53 * speed + seed * 0.7) * 0.2
  );
}

/** Deterministic hash of an integer -> [0, 1). */
function rand(i: number, salt = 0) {
  let x = (i * 374761393 + salt * 668265263) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ----------------------------------------------------------------------------- pose type

type Pose = Record<string, Q>;
type Blends = Record<string, number>;

interface PoseResult {
  pose: Pose;
  blends: Blends;
  swayX: number;
  lift: number;
  airborne: boolean;
}

function blendPose(a: Pose, b: Pose, k: number): Pose {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const out: Pose = { ...a };
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) out[n] = slerp(a[n] ?? IDENTITY, b[n] ?? IDENTITY, k);
  return out;
}

function blendBlends(a: Blends, b: Blends, k: number): Blends {
  const out: Blends = { ...a };
  for (const n of new Set([...Object.keys(a), ...Object.keys(b)])) out[n] = lerp(a[n] ?? 0, b[n] ?? 0, k);
  return out;
}

function blendResult(a: PoseResult, b: PoseResult, k: number): PoseResult {
  return {
    pose: blendPose(a.pose, b.pose, k),
    blends: blendBlends(a.blends, b.blends, k),
    swayX: lerp(a.swayX, b.swayX, k),
    lift: lerp(a.lift, b.lift, k),
    airborne: k > 0.5 ? b.airborne : a.airborne,
  };
}

/** Relaxed, slightly curled fingers with a slow micro-movement. */
function relaxedFingers(pose: Pose, t: number, e: number, curlScale = 1) {
  for (const side of ['Left', 'Right'] as const) {
    const sign = side === 'Left' ? 1 : -1;
    const wiggle = drift(t, side === 'Left' ? 12 : 13, 1.2) * 0.06;
    for (const [finger, base] of [['Index', 0.22], ['Middle', 0.30], ['Ring', 0.36], ['Little', 0.42]] as const) {
      const curl = (base + wiggle) * e * curlScale;
      pose[`${side}${finger}Proximal`] = axisAngle(0, 0, 1, sign * curl);
      pose[`${side}${finger}Intermediate`] = axisAngle(0, 0, 1, sign * curl * 1.1);
      pose[`${side}${finger}Distal`] = axisAngle(0, 0, 1, sign * curl * 0.6);
    }
    pose[`${side}ThumbProximal`] = euler(0, -sign * 0.25 * e, sign * 0.1 * e);
    pose[`${side}ThumbIntermediate`] = euler(0, -sign * 0.2 * e, 0);
    pose[`${side}ThumbDistal`] = euler(0, -sign * 0.15 * e, 0);
  }
}

// ----------------------------------------------------------------------------- calm

/**
 * Piecewise "look around" schedule. Time is split into segments of varying length
 * (2.5 - 6.5 s). Each segment has a target gaze; the move to it happens at the start
 * of the segment. `lag` delays the result (used to make the head trail the eyes).
 */
function gazeAt(t: number, lag: number) {
  const tt = Math.max(0, t - lag);
  let start = 0, i = 0;
  for (;;) {
    const len = 2.5 + rand(i, 1) * 4.0;
    if (tt < start + len || i > 100000) break;
    start += len; i++;
  }
  const local = tt - start;
  const prevYaw = (rand(i - 1, 2) - 0.5) * 2, prevPitch = (rand(i - 1, 3) - 0.5) * 2;
  const yaw = (rand(i, 2) - 0.5) * 2, pitch = (rand(i, 3) - 0.5) * 2;
  const moveDur = 0.55 + rand(i, 4) * 0.5;
  const k = smoothstep(local / moveDur);
  return {
    yaw: prevYaw + (yaw - prevYaw) * k,
    pitch: prevPitch + (pitch - prevPitch) * k,
    bigTurn: Math.abs(yaw - prevYaw) > 0.8,
    segmentStart: start,
  };
}

function calmPose(t: number, e: number): PoseResult {
  const pose: Pose = {};
  const breath = Math.sin(t * 1.35) * 0.5 + 0.5;

  // Weight sway: period wanders between ~6 and 9 s, shaped to linger at each side.
  // sway = +1 -> weight on the LEFT leg, -1 -> on the RIGHT leg.
  const swayPhase = t * 0.85 + Math.sin(t * 0.11) * 1.2;
  const swayRaw = Math.sin(swayPhase);
  const sway = Math.sign(swayRaw) * Math.pow(Math.abs(swayRaw), 0.7);
  const roll = 0.11 * e;

  // Pelvis shifts over the loaded foot and hikes up on that side, so the free hip
  // drops (measured: -Z roll raises the left hip). Spine/chest counter-roll so the
  // shoulders stay close to level.
  pose.Hips = euler(0.015 * e, drift(t, 2.1, 0.45) * 0.06 * e - sway * 0.03 * e, -sway * roll);
  pose.Spine = euler(-0.02 * e + breath * 0.02 * e, sway * 0.02 * e, sway * roll * 0.45);
  pose.Chest = euler(breath * 0.035 * e, drift(t, 3.3, 0.4) * 0.03 * e, sway * roll * 0.35);
  pose.UpperChest = euler(breath * 0.02 * e, 0, sway * roll * 0.15);

  // Looking around: eyes first, head ~0.18 s later and only part of the way.
  const eyes = gazeAt(t, 0);
  const head = gazeAt(t, 0.18);
  const headYaw = head.yaw * 0.42 * e + drift(t, 7.7, 0.4) * 0.03 * e;
  const headPitch = 0.02 * e - head.pitch * 0.14 * e + drift(t, 6.4, 0.6) * 0.02 * e;
  const headRoll = head.yaw * -0.05 * e + drift(t, 8.1, 0.5) * 0.02 * e;
  pose.Neck = euler(headPitch * 0.35 + 0.03 * e, headYaw * 0.3, headRoll * 0.3);
  pose.Head = euler(headPitch * 0.65, headYaw * 0.7, headRoll * 0.7);
  const eyeYaw = (eyes.yaw - head.yaw * 0.42) * 0.28 * e + drift(t, 15.5, 1.3) * 0.02 * e;
  const eyePitch = (eyes.pitch * 0.12 - head.pitch * 0.07) * e + drift(t, 14.2, 1.1) * 0.015 * e;
  pose.LeftEye = pose.RightEye = euler(-eyePitch, eyeYaw, 0);

  // Arms hanging relaxed; forearms drift between pronation states.
  const armSwing = drift(t, 9.9, 0.5) * 0.04 * e;
  const lHang = 1.27 * e + sway * 0.03 * e + breath * 0.015 * e;
  const rHang = 1.27 * e - sway * 0.03 * e + breath * 0.015 * e;
  pose.LeftShoulder = euler(0, 0, 0.04 * e - sway * 0.01 * e);
  pose.LeftUpperArm = euler(0.10 * e + armSwing, 0.10 * e, lHang);
  pose.LeftLowerArm = euler(0, -0.30 * e - breath * 0.03 * e + drift(t, 10.6, 0.5) * 0.05 * e, 0.06 * e);
  pose.LeftHand = euler(0.04 * e, 0.10 * e, 0.12 * e + drift(t, 10.1, 0.9) * 0.05 * e);
  pose.RightShoulder = euler(0, 0, -0.04 * e - sway * 0.01 * e);
  pose.RightUpperArm = euler(0.10 * e - armSwing, -0.10 * e, -rHang);
  pose.RightLowerArm = euler(0, 0.30 * e + breath * 0.03 * e - drift(t, 11.6, 0.5) * 0.05 * e, -0.06 * e);
  pose.RightHand = euler(0.04 * e, -0.10 * e, -0.12 * e - drift(t, 11.3, 0.9) * 0.05 * e);
  relaxedFingers(pose, t, e);

  // Legs: contrapposto - loaded leg straight, free leg soft at the knee and turned out.
  const freeL = Math.max(0, -sway), freeR = Math.max(0, sway);
  const bendL = 0.03 * e + freeL * 0.16 * e;
  const bendR = 0.03 * e + freeR * 0.16 * e;
  pose.LeftUpperLeg = euler(-bendL * 0.55, 0.04 * e + freeL * 0.10 * e, sway * roll * 0.9);
  pose.LeftLowerLeg = euler(bendL, 0, 0);
  pose.LeftFoot = euler(-bendL * 0.45, 0, 0);
  pose.RightUpperLeg = euler(-bendR * 0.55, -0.04 * e - freeR * 0.10 * e, sway * roll * 0.9);
  pose.RightLowerLeg = euler(bendR, 0, 0);
  pose.RightFoot = euler(-bendR * 0.45, 0, 0);

  // Face: blink on big gaze changes plus a slow periodic blink; relaxed mouth.
  const sinceTurn = t - eyes.segmentStart;
  const turnBlink = eyes.bigTurn && sinceTurn < 0.16 ? Math.sin((sinceTurn / 0.16) * Math.PI) : 0;
  const blinkPhase = (t % 4.7) / 4.7;
  const periodicBlink = blinkPhase < 0.05 ? Math.sin((blinkPhase / 0.05) * Math.PI) : 0;
  const b = Math.min(1, turnBlink + periodicBlink);
  const smile = 0.10 + (drift(t, 16.1, 0.3) * 0.5 + 0.5) * 0.12;

  return {
    pose,
    blends: {
      eyeBlinkLeft: b, eyeBlinkRight: b,
      mouthSmileLeft: smile, mouthSmileRight: smile,
      browInnerUp: 0.04 + Math.max(0, eyes.pitch) * 0.08,
      jawOpen: 0.02 + breath * 0.01,
    },
    swayX: -sway * 0.045 * e, // weight on the left leg => pelvis moves left (Unity -X)
    lift: 0,
    airborne: false,
  };
}

// ----------------------------------------------------------------------------- dance

const BPM = 118;

/**
 * Looping groove. `t` is local dance time (seconds from the start of the dance so
 * it always begins on a down-beat). Arm pattern changes every 4 bars.
 */
function dancePose(t: number, e: number): PoseResult {
  const pose: Pose = {};
  const beat = (t * BPM) / 60;             // continuous beat count
  const bar = Math.floor(beat / 4);
  const phase = beat % 1;                   // 0..1 within a beat
  const half = (beat % 2) / 2;              // 0..1 across two beats
  const a = Math.min(1.4, e);               // dance amplitude (capped so it never flails)

  // Bounce: dip on each beat (knees), rebound between.
  const dip = Math.pow(Math.sin(phase * Math.PI), 2);       // 0 at beat, 1 mid-beat
  const bounce = (1 - dip) * 0.10 * a + 0.06 * a;           // knee bend amount
  // Hip sway: left-right across two beats.
  const sway = Math.sin(half * Math.PI * 2);
  // Groove pattern per 4 bars.
  const pattern = Math.floor(rand(bar >> 2, 21) * 3);

  pose.Hips = euler(0.04 * a + dip * 0.03 * a, Math.sin(beat * Math.PI) * 0.12 * a, -sway * 0.10 * a);
  pose.Spine = euler(0.03 * a, -Math.sin(beat * Math.PI) * 0.10 * a, sway * 0.06 * a);
  pose.Chest = euler(-0.02 * a + dip * 0.04 * a, -Math.sin(beat * Math.PI) * 0.08 * a, sway * 0.04 * a);
  pose.UpperChest = euler(dip * 0.02 * a, 0, 0);
  // Head bob (nod on the beat) with a little side tilt following the sway.
  pose.Neck = euler(dip * 0.08 * a - 0.02 * a, Math.sin(beat * Math.PI * 0.5) * 0.08 * a, sway * 0.04 * a);
  pose.Head = euler(dip * 0.12 * a - 0.04 * a, Math.sin(beat * Math.PI * 0.5) * 0.12 * a, sway * 0.06 * a);
  pose.LeftEye = pose.RightEye = euler(0, Math.sin(beat * Math.PI * 0.5) * 0.06, 0);

  // Arms by pattern.
  if (pattern === 0) {
    // Pump: elbows bent, forearms pumping up and down alternately.
    const pumpL = Math.sin(beat * Math.PI) * 0.5 + 0.5;
    const pumpR = 1 - pumpL;
    pose.LeftShoulder = euler(0, 0, 0.05 * a);
    pose.LeftUpperArm = euler(-0.35 * a, 0.25 * a, 0.85 * a);
    pose.LeftLowerArm = euler(0, -0.2 * a, -(1.25 + pumpL * 0.55) * a);
    pose.LeftHand = euler(0, 0, -0.2 * a);
    pose.RightShoulder = euler(0, 0, -0.05 * a);
    pose.RightUpperArm = euler(-0.35 * a, -0.25 * a, -0.85 * a);
    pose.RightLowerArm = euler(0, 0.2 * a, (1.25 + pumpR * 0.55) * a);
    pose.RightHand = euler(0, 0, 0.2 * a);
  } else if (pattern === 1) {
    // Hands up, swaying overhead side to side.
    const wave = Math.sin(half * Math.PI * 2);
    pose.LeftShoulder = euler(0, 0, -0.15 * a);
    pose.LeftUpperArm = euler(-0.2 * a, 0.1 * a, -(1.35 + wave * 0.25) * a);
    pose.LeftLowerArm = euler(0, 0.1 * a, -(0.35 - wave * 0.25) * a);
    pose.LeftHand = euler(0, 0, wave * 0.3 * a);
    pose.RightShoulder = euler(0, 0, 0.15 * a);
    pose.RightUpperArm = euler(-0.2 * a, -0.1 * a, (1.35 - wave * 0.25) * a);
    pose.RightLowerArm = euler(0, -0.1 * a, (0.35 + wave * 0.25) * a);
    pose.RightHand = euler(0, 0, wave * 0.3 * a);
  } else {
    // Disco point: one arm up to the opposite corner, the other on the hip, alternating each bar.
    const k = smoothstep(Math.abs(Math.sin(beat * Math.PI * 0.25)) * 1.6 - 0.3);
    const upL = k, upR = 1 - k;
    pose.LeftShoulder = euler(0, 0, lerp(0.05, -0.15, upL) * a);
    pose.LeftUpperArm = euler(lerp(0.1, -0.9, upL) * a, lerp(0.2, 0.3, upL) * a, lerp(0.95, -1.2, upL) * a);
    pose.LeftLowerArm = euler(0, lerp(-1.2, -0.1, upL) * a, lerp(0.1, -0.2, upL) * a);
    pose.LeftHand = euler(0, 0, 0);
    pose.RightShoulder = euler(0, 0, lerp(-0.05, 0.15, upR) * a);
    pose.RightUpperArm = euler(lerp(0.1, -0.9, upR) * a, lerp(-0.2, -0.3, upR) * a, lerp(-0.95, 1.2, upR) * a);
    pose.RightLowerArm = euler(0, lerp(1.2, 0.1, upR) * a, lerp(-0.1, 0.2, upR) * a);
    pose.RightHand = euler(0, 0, 0);
  }
  relaxedFingers(pose, t, e, 0.6);

  // Legs: bounce with a slight step-touch (free leg lifts a bit on the off-beat).
  const stepL = Math.max(0, Math.sin(half * Math.PI * 2)) * 0.12 * a;
  const stepR = Math.max(0, -Math.sin(half * Math.PI * 2)) * 0.12 * a;
  pose.LeftUpperLeg = euler(-bounce * 0.9 - stepL, 0.12 * a, sway * 0.05 * a);
  pose.LeftLowerLeg = euler(bounce * 1.8 + stepL * 1.5, 0, 0);
  pose.LeftFoot = euler(-bounce * 0.9 - stepL * 0.5, 0, 0);
  pose.RightUpperLeg = euler(-bounce * 0.9 - stepR, -0.12 * a, sway * 0.05 * a);
  pose.RightLowerLeg = euler(bounce * 1.8 + stepR * 1.5, 0, 0);
  pose.RightFoot = euler(-bounce * 0.9 - stepR * 0.5, 0, 0);

  const blinkPhase = (t % 3.9) / 3.9;
  const blink = blinkPhase < 0.05 ? Math.sin((blinkPhase / 0.05) * Math.PI) : 0;
  const grin = 0.45 + dip * 0.15;
  return {
    pose,
    blends: {
      eyeBlinkLeft: blink, eyeBlinkRight: blink,
      mouthSmileLeft: grin, mouthSmileRight: grin,
      cheekSquintLeft: 0.2, cheekSquintRight: 0.2,
      browInnerUp: 0.15, jawOpen: 0.06 + dip * 0.05,
    },
    swayX: -sway * 0.03 * a,
    lift: 0,
    airborne: false,
  };
}

// ----------------------------------------------------------------------------- bits

interface BitDef { kind: BitKind; duration: number; weight: number; fadeIn: number; fadeOut: number }
const BITS: BitDef[] = [
  { kind: 'dance', duration: 11, weight: 3, fadeIn: 0.7, fadeOut: 0.9 },
  { kind: 'wave', duration: 3.2, weight: 3, fadeIn: 0.5, fadeOut: 0.6 },
  { kind: 'stretch', duration: 4.2, weight: 2, fadeIn: 0.6, fadeOut: 0.8 },
  { kind: 'spin', duration: 1.9, weight: 1.5, fadeIn: 0.25, fadeOut: 0.5 },
  { kind: 'hop', duration: 1.5, weight: 1.5, fadeIn: 0.2, fadeOut: 0.5 },
  { kind: 'bow', duration: 3.0, weight: 2, fadeIn: 0.5, fadeOut: 0.7 },
  { kind: 'backflip', duration: 2.4, weight: 1.5, fadeIn: 0.25, fadeOut: 0.6 },
];
const BIT_BY_KIND = Object.fromEntries(BITS.map((b) => [b.kind, b])) as Record<BitKind, BitDef>;

function pickBit(i: number): BitDef {
  const total = BITS.reduce((s, b) => s + b.weight, 0);
  let r = rand(i, 31) * total;
  for (const b of BITS) { r -= b.weight; if (r <= 0) return b; }
  return BITS[0];
}

/** Wave hello with the right arm, layered over a base pose. */
export function wavePose(base: PoseResult, local: number, t: number): PoseResult {
  const pose: Pose = { ...base.pose };
  const wave = Math.sin(t * 7.0) * 0.5 + 0.5;
  pose.RightShoulder = euler(0, 0, 0.10);
  pose.RightUpperArm = euler(-0.30, 0.20, 0.35);
  pose.RightLowerArm = euler(0, 0.1, 1.35 + (wave - 0.5) * 0.6);
  pose.RightHand = euler(0.1, 0, (wave - 0.5) * 0.45);
  pose.Head = euler(-0.05, 0.08, -0.06);
  pose.Neck = euler(0, 0.04, -0.03);
  pose.LeftEye = pose.RightEye = IDENTITY;
  for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
    pose[`Right${finger}Proximal`] = euler(0, 0, -0.08);
    pose[`Right${finger}Intermediate`] = euler(0, 0, -0.05);
    pose[`Right${finger}Distal`] = euler(0, 0, -0.03);
  }
  pose.RightThumbProximal = euler(0, 0.15, -0.05);
  const talk = Math.max(0, Math.sin(local * 7.3)) * 0.35;
  return {
    ...base, pose,
    blends: { ...base.blends, mouthSmileLeft: 0.45, mouthSmileRight: 0.45, cheekSquintLeft: 0.25, cheekSquintRight: 0.25, browInnerUp: 0.25, jawOpen: 0.02 + talk, mouthFunnel: talk * 0.3 },
  };
}

function stretchPose(base: PoseResult, local: number, dur: number): PoseResult {
  const pose: Pose = { ...base.pose };
  // Arms rise overhead, back arches, hold, then come down (the fade-out does the rest).
  const up = smoothstep(local / 1.1) * smoothstep((dur - local) / 1.0);
  const reach = 1.5 * up;
  const arch = 0.12 * up;
  pose.Spine = euler(-arch * 0.5, 0, 0);
  pose.Chest = euler(-arch * 0.5, 0, 0);
  pose.UpperChest = euler(-arch * 0.3, 0, 0);
  pose.Neck = euler(-0.15 * up, 0, 0);
  pose.Head = euler(-0.25 * up, 0, 0);
  pose.LeftShoulder = euler(0, 0, -0.2 * up);
  pose.LeftUpperArm = euler(-0.15 * up, 0.1 * up, -reach);
  pose.LeftLowerArm = euler(0, 0.1, -0.15 * up);
  pose.LeftHand = euler(0, 0, 0.1 * up);
  pose.RightShoulder = euler(0, 0, 0.2 * up);
  pose.RightUpperArm = euler(-0.15 * up, -0.1 * up, reach);
  pose.RightLowerArm = euler(0, -0.1, 0.15 * up);
  pose.RightHand = euler(0, 0, -0.1 * up);
  // Fingers splay.
  for (const side of ['Left', 'Right'] as const) {
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      pose[`${side}${finger}Proximal`] = IDENTITY; pose[`${side}${finger}Intermediate`] = IDENTITY; pose[`${side}${finger}Distal`] = IDENTITY;
    }
  }
  // Up on the toes at the peak.
  pose.LeftFoot = euler(0.25 * up, 0, 0);
  pose.RightFoot = euler(0.25 * up, 0, 0);
  pose.LeftEye = pose.RightEye = euler(-0.1 * up, 0, 0);
  return { ...base, pose, lift: 0.04 * up, blends: { ...base.blends, eyeBlinkLeft: Math.max(base.blends.eyeBlinkLeft ?? 0, 0.6 * up), eyeBlinkRight: Math.max(base.blends.eyeBlinkRight ?? 0, 0.6 * up), jawOpen: 0.15 * up, mouthSmileLeft: 0.1, mouthSmileRight: 0.1 } };
}

function spinPose(base: PoseResult, local: number, dur: number): PoseResult {
  const pose: Pose = { ...base.pose };
  const k = smoothstep(local / (dur * 0.85));
  const yaw = Math.PI * 2 * k;
  // A little hop at the start carries the turn; arms open slightly for balance.
  const hopK = Math.max(0, Math.sin(Math.min(1, local / 0.55) * Math.PI));
  pose.Hips = mul(euler(0, yaw, 0), base.pose.Hips ?? IDENTITY);
  pose.LeftUpperArm = euler(0.1, 0.1, 0.95 - hopK * 0.3);
  pose.RightUpperArm = euler(0.1, -0.1, -(0.95 - hopK * 0.3));
  pose.LeftLowerArm = euler(0, -0.4, 0.1);
  pose.RightLowerArm = euler(0, 0.4, -0.1);
  pose.Head = euler(0, Math.sin(k * Math.PI) * 0.35, 0); // head leads the turn
  const bend = hopK * 0.35 + 0.05;
  pose.LeftUpperLeg = euler(-bend * 0.5, 0.05, 0); pose.LeftLowerLeg = euler(bend, 0, 0); pose.LeftFoot = euler(-bend * 0.4, 0, 0);
  pose.RightUpperLeg = euler(-bend * 0.5, -0.05, 0); pose.RightLowerLeg = euler(bend, 0, 0); pose.RightFoot = euler(-bend * 0.4, 0, 0);
  return { ...base, pose, lift: hopK * 0.12, airborne: hopK > 0.3, swayX: 0, blends: { ...base.blends, mouthSmileLeft: 0.4, mouthSmileRight: 0.4 } };
}

function hopPose(base: PoseResult, local: number): PoseResult {
  const pose: Pose = { ...base.pose };
  // crouch (0-0.25 s) -> airborne (0.25-0.95 s) -> land (0.95-1.5 s)
  const crouch = local < 0.25 ? smoothstep(local / 0.25) : local < 0.95 ? 0 : 1 - smoothstep((local - 0.95) / 0.5);
  const airU = local >= 0.25 && local < 0.95 ? (local - 0.25) / 0.7 : -1;
  const air = airU >= 0 ? 4 * airU * (1 - airU) : 0;
  const bend = 0.6 * crouch + 0.25 * air;
  pose.Hips = euler(0.1 * crouch, 0, 0);
  pose.Spine = euler(0.1 * crouch - 0.05 * air, 0, 0);
  pose.LeftUpperLeg = euler(-bend * 0.6, 0.05, 0); pose.LeftLowerLeg = euler(bend * 1.3, 0, 0); pose.LeftFoot = euler(-bend * 0.6 + air * 0.5, 0, 0);
  pose.RightUpperLeg = euler(-bend * 0.6, -0.05, 0); pose.RightLowerLeg = euler(bend * 1.3, 0, 0); pose.RightFoot = euler(-bend * 0.6 + air * 0.5, 0, 0);
  // Arms swing back in the crouch and throw up in the air.
  const armZ = lerp(1.25, 1.6, crouch) - air * 2.6;
  pose.LeftShoulder = euler(0, 0, -0.1 * air); pose.RightShoulder = euler(0, 0, 0.1 * air);
  pose.LeftUpperArm = euler(0.35 * crouch - 0.2 * air, 0.1, armZ);
  pose.RightUpperArm = euler(0.35 * crouch - 0.2 * air, -0.1, -armZ);
  pose.LeftLowerArm = euler(0, -0.2, -0.2 * air); pose.RightLowerArm = euler(0, 0.2, 0.2 * air);
  pose.Head = euler(-0.15 * air + 0.1 * crouch, 0, 0);
  return { ...base, pose, lift: air * 0.45, airborne: airU >= 0, swayX: 0, blends: { ...base.blends, jawOpen: 0.2 * air, mouthSmileLeft: 0.5, mouthSmileRight: 0.5, browInnerUp: 0.3 * air } };
}

function bowPose(base: PoseResult, local: number, dur: number): PoseResult {
  const pose: Pose = { ...base.pose };
  const k = smoothstep(local / 0.9) * smoothstep((dur - local) / 0.9);
  pose.Hips = euler(0.35 * k, 0, 0);
  pose.Spine = euler(0.30 * k, 0, 0);
  pose.Chest = euler(0.20 * k, 0, 0);
  pose.Neck = euler(0.15 * k, 0, 0);
  pose.Head = euler(0.10 * k, 0, 0);
  // Right hand across the waist, left arm sweeping out.
  pose.RightUpperArm = euler(0.35 * k, -0.2 * k, -(1.1 + 0.1 * k));
  pose.RightLowerArm = euler(0, 1.9 * k, -0.2 * k);
  pose.RightHand = euler(0, 0.4 * k, 0);
  pose.LeftUpperArm = euler(0.2 * k, 0.1, 1.25 - 0.9 * k);
  pose.LeftLowerArm = euler(0, -0.35 - 0.2 * k, 0.1);
  pose.LeftHand = euler(0, 0, 0.3 * k);
  // Legs stay straight-ish; slight knee softening keeps the feet planted.
  pose.LeftUpperLeg = euler(-0.3 * k, 0.05, 0); pose.LeftLowerLeg = euler(0.05 + 0.05 * k, 0, 0); pose.LeftFoot = euler(0.25 * k, 0, 0);
  pose.RightUpperLeg = euler(-0.3 * k, -0.05, 0); pose.RightLowerLeg = euler(0.05 + 0.05 * k, 0, 0); pose.RightFoot = euler(0.25 * k, 0, 0);
  pose.LeftEye = pose.RightEye = euler(-0.15 * k, 0, 0);
  return { ...base, pose, swayX: 0, blends: { ...base.blends, eyeBlinkLeft: Math.max(base.blends.eyeBlinkLeft ?? 0, 0.5 * k), eyeBlinkRight: Math.max(base.blends.eyeBlinkRight ?? 0, 0.5 * k), mouthSmileLeft: 0.4, mouthSmileRight: 0.4 } };
}

function backflipPose(base: PoseResult, local: number): PoseResult {
  const pose: Pose = { ...base.pose };
  // wind-up crouch 0-0.45 s, airborne 0.45-1.55 s (full backward rotation), land 1.55-2.4 s
  const T0 = 0.45, T1 = 1.55, T2 = 2.4;
  const crouch = local < T0 ? smoothstep(local / T0) : local < T1 ? 0 : 1 - smoothstep((local - T1) / (T2 - T1));
  const airU = local >= T0 && local < T1 ? (local - T0) / (T1 - T0) : -1;
  const air = airU >= 0 ? 4 * airU * (1 - airU) : 0;
  const landed = local >= T1 ? 1 - smoothstep((local - T1) / (T2 - T1)) : 0;
  // Rotation: eased so it accelerates into the tuck and slows out for the landing.
  const rot = airU >= 0 ? -Math.PI * 2 * smoothstep(airU) : 0;
  const tuck = airU >= 0 ? Math.pow(Math.sin(airU * Math.PI), 0.6) : 0;

  const bend = 0.75 * crouch + 0.4 * landed;
  pose.Hips = euler(rot + 0.25 * crouch + 0.15 * landed, 0, 0);
  pose.Spine = euler(0.15 * crouch + 0.35 * tuck + 0.1 * landed, 0, 0);
  pose.Chest = euler(0.10 * crouch + 0.25 * tuck, 0, 0);
  pose.Neck = euler(-0.1 * crouch + 0.1 * tuck, 0, 0);
  pose.Head = euler(-0.25 * crouch - 0.2 * air * (1 - tuck), 0, 0);
  // Legs: crouch, then tuck knees to chest mid-air, extend for landing.
  const thigh = bend * 0.6 + tuck * 1.6;
  const knee = bend * 1.3 + tuck * 2.1;
  pose.LeftUpperLeg = euler(-thigh, 0.05, 0); pose.LeftLowerLeg = euler(knee, 0, 0); pose.LeftFoot = euler(-bend * 0.5 + tuck * 0.3, 0, 0);
  pose.RightUpperLeg = euler(-thigh, -0.05, 0); pose.RightLowerLeg = euler(knee, 0, 0); pose.RightFoot = euler(-bend * 0.5 + tuck * 0.3, 0, 0);
  // Arms: swing back in the crouch, throw overhead at take-off, grab shins in the tuck, out for balance on landing.
  const throwUp = airU >= 0 ? Math.max(0, 1 - airU * 2.5) : 0;
  const armZ = lerp(1.25, 1.7, crouch) - throwUp * 2.9 - tuck * 0.2 - landed * 0.5;
  pose.LeftShoulder = euler(0, 0, -0.1 * throwUp); pose.RightShoulder = euler(0, 0, 0.1 * throwUp);
  pose.LeftUpperArm = euler(0.4 * crouch - 0.3 * throwUp + 0.6 * tuck, 0.1, armZ);
  pose.RightUpperArm = euler(0.4 * crouch - 0.3 * throwUp + 0.6 * tuck, -0.1, -armZ);
  pose.LeftLowerArm = euler(0, -0.2 - 0.9 * tuck, -0.1 * throwUp); pose.RightLowerArm = euler(0, 0.2 + 0.9 * tuck, 0.1 * throwUp);
  pose.LeftEye = pose.RightEye = IDENTITY;
  return {
    ...base, pose,
    lift: air * 1.05 + crouch * -0.0,
    airborne: airU >= 0,
    swayX: 0,
    blends: { ...base.blends, eyeBlinkLeft: tuck * 0.8, eyeBlinkRight: tuck * 0.8, jawOpen: 0.15 * air, mouthSmileLeft: 0.5 * landed + 0.2, mouthSmileRight: 0.5 * landed + 0.2, browInnerUp: 0.3 * air },
  };
}

function bitPose(kind: BitKind, base: PoseResult, local: number, t: number, e: number, dur: number): PoseResult {
  switch (kind) {
    case 'dance': return dancePose(local, e);
    case 'wave': return wavePose(base, local, t);
    case 'stretch': return stretchPose(base, local, dur);
    case 'spin': return spinPose(base, local, dur);
    case 'hop': return hopPose(base, local);
    case 'bow': return bowPose(base, local, dur);
    case 'backflip': return backflipPose(base, local);
  }
}

// ----------------------------------------------------------------------------- mixed schedule

interface Slot { calmStart: number; bitStart: number; bitEnd: number; bit: BitDef; index: number }

/** Deterministic schedule: calm stretch of 10-30 s, then a bit, repeat. */
function slotAt(t: number): Slot {
  let start = 0, i = 0;
  for (;;) {
    const calmLen = 10 + rand(i, 41) * 20;
    const bit = pickBit(i);
    const end = start + calmLen + bit.duration;
    if (t < end || i > 100000) return { calmStart: start, bitStart: start + calmLen, bitEnd: end, bit, index: i };
    start = end; i++;
  }
}

/** Time of the next bit start at or after `t` (used by the "surprise me" button). */
export function nextBitStart(t: number): number {
  const s = slotAt(t);
  if (t < s.bitStart) return s.bitStart;
  // Already inside a bit: next slot.
  return slotAt(s.bitEnd + 0.001).bitStart;
}

/** Which bit (if any) is scheduled around `t`, with its blend weight. */
export function scheduledBit(t: number): { kind: BitKind; local: number; weight: number; duration: number } | null {
  const s = slotAt(t);
  if (t < s.bitStart - s.bit.fadeIn) return null;
  const local = t - s.bitStart;
  const w = smoothstep((local + s.bit.fadeIn) / s.bit.fadeIn) * smoothstep((s.bit.duration - local) / s.bit.fadeOut);
  if (w <= 0) return null;
  return { kind: s.bit.kind, local: Math.max(0, local), weight: w, duration: s.bit.duration };
}

// ----------------------------------------------------------------------------- entry

function toFrame(t: number, r: PoseResult, bit: BitKind | null, bitWeight = 0): IdleFrame {
  const bones: BoneTransform[] = [];
  for (const [name, q] of Object.entries(r.pose)) bones.push(bone(name, q));
  const hips = bones.find((b) => b.name === 'Hips');
  if (hips) hips.px = r.swayX;
  return {
    timestampMs: t * 1000,
    root: { name: 'root', px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 },
    bones,
    blends: r.blends,
    idle: { lift: r.lift, airborne: r.airborne, swayX: r.swayX, bit, bitWeight },
  };
}

export function makeIdleFrame(t: number, style: IdleStyle = { energy: 1 }): IdleFrame {
  const e = style.energy;
  const mode = style.mode ?? 'calm';
  const ext = !!style.externalDance;
  if (mode === 'dance') {
    // With an external dance source the caller blends real clips over the calm base.
    if (ext) return toFrame(t, calmPose(t, e), 'dance', 1);
    return toFrame(t, dancePose(t, e), 'dance', 1);
  }

  const calm = calmPose(t, e);
  if (mode === 'calm') return toFrame(t, calm, null);

  const sched = scheduledBit(t);
  if (!sched) return toFrame(t, calm, null);
  if (ext && sched.kind === 'dance') return toFrame(t, calm, 'dance', sched.weight);
  const bitR = bitPose(sched.kind, calm, sched.local, t, e, sched.duration);
  return toFrame(t, blendResult(calm, bitR, sched.weight), sched.kind, sched.weight);
}
