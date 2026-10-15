import {
  ARKIT_BLENDSHAPES,
  ARKIT_BLENDSHAPE_INDEX,
  CUSTOM_BLEND_INDEX,
  FRAME_KIND,
  VMC_BONES,
  VMC_BONE_INDEX,
  type BoneTransform,
  type VmcFrame,
} from './protocol';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Encode a VmcFrame into a compact binary buffer (see protocol.ts header for layout). */
export function encodeFrame(frame: VmcFrame): Uint8Array {
  const blendEntries = Object.entries(frame.blends);
  const knownBones = frame.bones.filter((b) => VMC_BONE_INDEX[b.name] !== undefined);

  // Worst-case size: header + bones + blends with custom names.
  let size = 1 + 8 + 1 + 7 * 4 + 2 + knownBones.length * (1 + 7 * 4) + 2;
  const encodedCustomNames: (Uint8Array | null)[] = blendEntries.map(([name]) =>
    ARKIT_BLENDSHAPE_INDEX[name.toLowerCase()] === undefined ? textEncoder.encode(name) : null,
  );
  for (const custom of encodedCustomNames) size += 1 + 4 + (custom ? 1 + custom.length : 0);

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let o = 0;

  view.setUint8(o, FRAME_KIND); o += 1;
  view.setFloat64(o, frame.timestampMs, true); o += 8;
  view.setUint8(o, frame.root ? 1 : 0); o += 1;
  const r = frame.root;
  const rootVals = r ? [r.px, r.py, r.pz, r.qx, r.qy, r.qz, r.qw] : [0, 0, 0, 0, 0, 0, 1];
  for (const v of rootVals) { view.setFloat32(o, v, true); o += 4; }

  view.setUint16(o, knownBones.length, true); o += 2;
  for (const b of knownBones) {
    view.setUint8(o, VMC_BONE_INDEX[b.name]); o += 1;
    for (const v of [b.px, b.py, b.pz, b.qx, b.qy, b.qz, b.qw]) { view.setFloat32(o, v, true); o += 4; }
  }

  view.setUint16(o, blendEntries.length, true); o += 2;
  blendEntries.forEach(([name, value], i) => {
    const idx = ARKIT_BLENDSHAPE_INDEX[name.toLowerCase()];
    if (idx !== undefined) {
      view.setUint8(o, idx); o += 1;
    } else {
      const custom = encodedCustomNames[i]!;
      view.setUint8(o, CUSTOM_BLEND_INDEX); o += 1;
      view.setUint8(o, Math.min(255, custom.length)); o += 1;
      bytes.set(custom.subarray(0, 255), o); o += Math.min(255, custom.length);
    }
    view.setFloat32(o, value, true); o += 4;
  });

  return bytes.subarray(0, o);
}

/** Decode a binary frame produced by encodeFrame. Returns null if the buffer is not a frame. */
export function decodeFrame(data: ArrayBuffer | Uint8Array): VmcFrame | null {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 1 || view.getUint8(0) !== FRAME_KIND) return null;
  let o = 1;

  const timestampMs = view.getFloat64(o, true); o += 8;
  const rootPresent = view.getUint8(o) === 1; o += 1;
  const rootVals: number[] = [];
  for (let i = 0; i < 7; i++) { rootVals.push(view.getFloat32(o, true)); o += 4; }
  const root: BoneTransform | null = rootPresent
    ? { name: 'root', px: rootVals[0], py: rootVals[1], pz: rootVals[2], qx: rootVals[3], qy: rootVals[4], qz: rootVals[5], qw: rootVals[6] }
    : null;

  const boneCount = view.getUint16(o, true); o += 2;
  const bones: BoneTransform[] = new Array(boneCount);
  for (let i = 0; i < boneCount; i++) {
    const idx = view.getUint8(o); o += 1;
    const name = VMC_BONES[idx] ?? `Unknown${idx}`;
    const vals: number[] = [];
    for (let k = 0; k < 7; k++) { vals.push(view.getFloat32(o, true)); o += 4; }
    bones[i] = { name, px: vals[0], py: vals[1], pz: vals[2], qx: vals[3], qy: vals[4], qz: vals[5], qw: vals[6] };
  }

  const blendCount = view.getUint16(o, true); o += 2;
  const blends: Record<string, number> = {};
  for (let i = 0; i < blendCount; i++) {
    const idx = view.getUint8(o); o += 1;
    let name: string;
    if (idx === CUSTOM_BLEND_INDEX) {
      const len = view.getUint8(o); o += 1;
      name = textDecoder.decode(bytes.subarray(o, o + len)); o += len;
    } else {
      name = ARKIT_BLENDSHAPES[idx] ?? `Unknown${idx}`;
    }
    blends[name] = view.getFloat32(o, true); o += 4;
  }

  return { timestampMs, root, bones, blends };
}
