/**
 * Procedural VMC demo stream so the studio can be exercised without a phone.
 * Uses the shared idle generator (calm stand, sway, look around) plus a wave hello
 * every ~12 s, so body, finger and face channels all move. Output mirrors the real-world packet shape observed
 * from the phone sender (/VMC/Ext/OK, /VMC/Ext/Root/Pos, 55 x /VMC/Ext/Bone/Pos,
 * 44 x /VMC/Ext/Blend/Val, /VMC/Ext/Blend/Apply).
 */
import { ARKIT_BLENDSHAPES, VMC_BONES, type BoneTransform } from '../shared/protocol';
import { makeIdleFrame, slerp, euler, type Q } from '../shared/idleAnimation';
import { encodeOscBundle, encodeOscInt, encodeOscMessage } from './oscParser';

const smoothstep = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };

const WAVE_PERIOD = 12.0;
const WAVE_LEN = 3.0;

/** 0..1 envelope of the wave, eased in/out. */
function waveEnvelope(t: number) {
  const local = (t + 4) % WAVE_PERIOD;
  if (local > WAVE_LEN) return 0;
  return smoothstep(local / 0.6) * smoothstep((WAVE_LEN - local) / 0.6);
}

export function generateTestPacket(timeSec: number): Buffer {
  const t = timeSec;
  // Calm mode: the live path has no root lift, so hops/flips would look wrong here.
  const frame = makeIdleFrame(t, { energy: 1, mode: 'calm' });
  const byName = new Map<string, BoneTransform>(frame.bones.map((b) => [b.name, b]));

  const env = waveEnvelope(t);
  if (env > 0) {
    const wave = Math.sin(t * 7.0) * 0.5 + 0.5;
    const target: Record<string, Q> = {
      RightShoulder: euler(0, 0, 0.10),
      RightUpperArm: euler(-0.30, 0.20, 0.35),
      RightLowerArm: euler(0, 0.1, 1.35 + (wave - 0.5) * 0.6),
      RightHand: euler(0.1, 0, (wave - 0.5) * 0.45),
      Head: euler(-0.05, 0.08, -0.06),
      Neck: euler(0, 0.04, -0.03),
      LeftEye: [0, 0, 0, 1], RightEye: [0, 0, 0, 1],
    };
    for (const finger of ['Index', 'Middle', 'Ring', 'Little']) {
      target[`Right${finger}Proximal`] = euler(0, 0, -0.08);
      target[`Right${finger}Intermediate`] = euler(0, 0, -0.05);
      target[`Right${finger}Distal`] = euler(0, 0, -0.03);
    }
    for (const [name, q] of Object.entries(target)) {
      const cur = byName.get(name);
      const from: Q = cur ? [cur.qx, cur.qy, cur.qz, cur.qw] : [0, 0, 0, 1];
      const r = slerp(from, q, env);
      byName.set(name, { name, px: cur?.px ?? 0, py: cur?.py ?? 0, pz: cur?.pz ?? 0, qx: r[0], qy: r[1], qz: r[2], qw: r[3] });
    }
  }

  const msgs: Buffer[] = [encodeOscInt('/VMC/Ext/OK', 1)];
  msgs.push(encodeOscMessage('/VMC/Ext/Root/Pos', ['root', 0, 0, 0, 0, 0, 0, 1]));
  for (const name of VMC_BONES) {
    if (name === 'Jaw') continue;
    const b = byName.get(name === 'OriginalHips' ? 'Hips' : name);
    const q: Q = b ? [b.qx, b.qy, b.qz, b.qw] : [0, 0, 0, 1];
    // Mimic the phone: hips carry a camera-relative offset, everything else is zero translation.
    const pos = name === 'Hips' || name === 'OriginalHips' ? [-0.03, -0.57, -0.52] : [0, 0, 0];
    msgs.push(encodeOscMessage('/VMC/Ext/Bone/Pos', [name, ...pos, ...q]));
  }

  const talk = env * Math.max(0, Math.sin(t * 7.3)) * 0.45;
  const blends: Record<string, number> = {
    ...frame.blends,
    jawOpen: (frame.blends.jawOpen ?? 0) + talk,
    mouthFunnel: (frame.blends.mouthFunnel ?? 0) + talk * 0.3,
    mouthSmileLeft: (frame.blends.mouthSmileLeft ?? 0) + env * 0.35,
    mouthSmileRight: (frame.blends.mouthSmileRight ?? 0) + env * 0.35,
    cheekSquintLeft: (frame.blends.cheekSquintLeft ?? 0) + env * 0.25,
    cheekSquintRight: (frame.blends.cheekSquintRight ?? 0) + env * 0.25,
    browInnerUp: (frame.blends.browInnerUp ?? 0) + env * 0.2,
  };
  for (const name of ARKIT_BLENDSHAPES) {
    if (name.startsWith('eyeLook')) continue; // the phone sender omits these
    msgs.push(encodeOscMessage('/VMC/Ext/Blend/Val', [name, Math.min(1, blends[name] ?? 0)]));
  }
  msgs.push(encodeOscMessage('/VMC/Ext/Blend/Apply', []));

  return encodeOscBundle(msgs);
}
