/**
 * Wire types shared between the Node UDP/OSC bridge (server/) and the browser (src/).
 *
 * Frame layout (binary, little-endian) sent over WebSocket at up to 60 Hz:
 *
 *   u8   kind            = 0x01 (FRAME)
 *   f64  timestampMs
 *   u8   rootPresent     (0/1)
 *   f32 x 7 root         px py pz qx qy qz qw   (always written; zeros if absent)
 *   u16  boneCount
 *   repeated boneCount times:
 *     u8  boneIndex      index into VMC_BONES
 *     f32 x 7            px py pz qx qy qz qw
 *   u16  blendCount
 *   repeated blendCount times:
 *     u8  blendIndex     index into ARKIT_BLENDSHAPES (255 = custom, followed by string)
 *     f32 value
 *
 * Control messages (config, telemetry) are JSON text frames.
 */

export const VMC_BONES = [
  'Hips', 'OriginalHips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head',
  'LeftShoulder', 'LeftUpperArm', 'LeftLowerArm', 'LeftHand',
  'LeftThumbProximal', 'LeftThumbIntermediate', 'LeftThumbDistal',
  'LeftIndexProximal', 'LeftIndexIntermediate', 'LeftIndexDistal',
  'LeftMiddleProximal', 'LeftMiddleIntermediate', 'LeftMiddleDistal',
  'LeftRingProximal', 'LeftRingIntermediate', 'LeftRingDistal',
  'LeftLittleProximal', 'LeftLittleIntermediate', 'LeftLittleDistal',
  'RightShoulder', 'RightUpperArm', 'RightLowerArm', 'RightHand',
  'RightThumbProximal', 'RightThumbIntermediate', 'RightThumbDistal',
  'RightIndexProximal', 'RightIndexIntermediate', 'RightIndexDistal',
  'RightMiddleProximal', 'RightMiddleIntermediate', 'RightMiddleDistal',
  'RightRingProximal', 'RightRingIntermediate', 'RightRingDistal',
  'RightLittleProximal', 'RightLittleIntermediate', 'RightLittleDistal',
  'LeftUpperLeg', 'LeftLowerLeg', 'LeftFoot', 'LeftToes',
  'RightUpperLeg', 'RightLowerLeg', 'RightFoot', 'RightToes',
  'LeftEye', 'RightEye', 'Jaw',
] as const;

export type VmcBoneName = (typeof VMC_BONES)[number];

export const VMC_BONE_INDEX: Record<string, number> = Object.fromEntries(
  VMC_BONES.map((b, i) => [b, i]),
);

export const ARKIT_BLENDSHAPES = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight',
  'eyeLookUpLeft', 'eyeLookUpRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight',
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'jawForward', 'jawLeft', 'jawOpen', 'jawRight',
  'mouthLeft', 'mouthRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthDimpleLeft', 'mouthDimpleRight', 'mouthPressLeft', 'mouthPressRight',
  'mouthRollUpper', 'mouthRollLower', 'mouthUpperUpLeft', 'mouthUpperUpRight',
  'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthFunnel', 'mouthPucker',
  'mouthShrugLower', 'mouthShrugUpper', 'mouthStretchLeft', 'mouthStretchRight', 'mouthClose',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut',
] as const;

export type ArkitBlendshape = (typeof ARKIT_BLENDSHAPES)[number];

export const ARKIT_BLENDSHAPE_INDEX: Record<string, number> = Object.fromEntries(
  ARKIT_BLENDSHAPES.map((b, i) => [b.toLowerCase(), i]),
);

export const FRAME_KIND = 0x01;
export const CUSTOM_BLEND_INDEX = 255;

export interface BoneTransform {
  /** VMC bone name (Unity Humanoid naming). */
  name: string;
  px: number; py: number; pz: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface VmcFrame {
  timestampMs: number;
  root: BoneTransform | null;
  bones: BoneTransform[];
  /** blendshape name (as received) -> value 0..1 */
  blends: Record<string, number>;
}

export interface BridgeConfig {
  /** UDP port the bridge listens on. */
  listenPort: number;
  /** Interface to bind (0.0.0.0 = all). */
  bindAddress: string;
  /** Only accept packets from this IP. '*' or '' = accept any sender. */
  senderFilter: string;
  /** When true, the bridge synthesizes a procedural test stream if no packets arrive. */
  testSignal: boolean;
}

export interface BridgeTelemetry {
  listening: boolean;
  listenPort: number;
  bindAddress: string;
  senderFilter: string;
  localAddresses: { iface: string; address: string }[];
  /** Senders observed in the last few seconds. */
  senders: { address: string; port: number; packets: number; lastSeenMs: number; accepted: boolean }[];
  /** Accepted VMC packets per second. */
  fps: number;
  totalPackets: number;
  lastBoneCount: number;
  lastBlendCount: number;
  lastPacketAgeMs: number | null;
  testSignal: boolean;
  error: string | null;
}

export type ServerMessage =
  | { type: 'telemetry'; telemetry: BridgeTelemetry }
  | { type: 'config'; config: BridgeConfig }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'setConfig'; config: Partial<BridgeConfig> }
  | { type: 'getConfig' };

export const DEFAULT_CONFIG: BridgeConfig = {
  listenPort: 39539,
  bindAddress: '0.0.0.0',
  senderFilter: '*',
  testSignal: false,
};
