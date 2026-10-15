/**
 * Minimal, allocation-light OSC 1.0 parser (messages + nested #bundle) for VMC traffic.
 * Supports type tags: i f s b d h T F N I (anything else aborts that message).
 */

export type OscArg = number | string | boolean | null | Uint8Array;

export interface OscMessage {
  address: string;
  args: OscArg[];
}

function readPaddedString(buf: Buffer, offset: number, end: number): [string, number] {
  let i = offset;
  while (i < end && buf[i] !== 0) i++;
  const str = buf.toString('utf8', offset, i);
  // String is null-terminated and padded to a 4-byte boundary.
  const next = (i + 4) & ~3;
  return [str, next];
}

export function parseOscPacket(buf: Buffer, offset = 0, length = buf.length - offset, out: OscMessage[] = []): OscMessage[] {
  if (length < 4) return out;
  const end = offset + length;

  // Bundle: "#bundle\0" + 8-byte timetag + (int32 size + element)*
  if (buf[offset] === 0x23 /* # */ && buf.toString('ascii', offset, Math.min(offset + 8, end)) === '#bundle\0') {
    let pos = offset + 16;
    while (pos + 4 <= end) {
      const elemSize = buf.readInt32BE(pos);
      pos += 4;
      if (elemSize <= 0 || pos + elemSize > end) break;
      parseOscPacket(buf, pos, elemSize, out);
      pos += elemSize;
    }
    return out;
  }

  if (buf[offset] !== 0x2f /* / */) return out;

  const [address, afterAddr] = readPaddedString(buf, offset, end);
  if (afterAddr >= end) {
    out.push({ address, args: [] });
    return out;
  }
  const [tags, afterTags] = readPaddedString(buf, afterAddr, end);
  let pos = afterTags;
  const args: OscArg[] = [];

  if (tags.startsWith(',')) {
    for (let i = 1; i < tags.length; i++) {
      const t = tags[i];
      try {
        switch (t) {
          case 'i': args.push(buf.readInt32BE(pos)); pos += 4; break;
          case 'f': args.push(buf.readFloatBE(pos)); pos += 4; break;
          case 'd': args.push(buf.readDoubleBE(pos)); pos += 8; break;
          case 'h': args.push(Number(buf.readBigInt64BE(pos))); pos += 8; break;
          case 's':
          case 'S': { const [s, next] = readPaddedString(buf, pos, end); args.push(s); pos = next; break; }
          case 'b': {
            const len = buf.readInt32BE(pos); pos += 4;
            args.push(new Uint8Array(buf.subarray(pos, pos + len)));
            pos = (pos + len + 3) & ~3;
            break;
          }
          case 'T': args.push(true); break;
          case 'F': args.push(false); break;
          case 'N': args.push(null); break;
          case 'I': args.push(Infinity); break;
          default: i = tags.length; // unknown tag: stop parsing args
        }
      } catch {
        break;
      }
    }
  }

  out.push({ address, args });
  return out;
}

// ---------- OSC encoder (used by the procedural test-signal generator) ----------

function writePaddedString(str: string): Buffer {
  const raw = Buffer.from(str, 'utf8');
  const padded = Buffer.alloc((raw.length + 4) & ~3);
  raw.copy(padded);
  return padded;
}

export function encodeOscMessage(address: string, args: OscArg[]): Buffer {
  let tags = ',';
  const parts: Buffer[] = [];
  for (const a of args) {
    if (typeof a === 'number') {
      // VMC uses float32 for every numeric arg except /VMC/Ext/OK (see encodeOscInt).
      tags += 'f';
      const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b);
    } else if (typeof a === 'string') {
      tags += 's';
      parts.push(writePaddedString(a));
    } else if (typeof a === 'boolean') {
      tags += a ? 'T' : 'F';
    } else if (a === null) {
      tags += 'N';
    }
  }
  return Buffer.concat([writePaddedString(address), writePaddedString(tags), ...parts]);
}

export function encodeOscInt(address: string, value: number): Buffer {
  const b = Buffer.alloc(4); b.writeInt32BE(value);
  return Buffer.concat([writePaddedString(address), writePaddedString(',i'), b]);
}

export function encodeOscBundle(messages: Buffer[]): Buffer {
  const header = Buffer.alloc(16);
  header.write('#bundle\0', 0, 'ascii');
  header.writeUInt32BE(0, 8); header.writeUInt32BE(1, 12); // immediate timetag
  const elems = messages.map((m) => { const len = Buffer.alloc(4); len.writeInt32BE(m.length); return Buffer.concat([len, m]); });
  return Buffer.concat([header, ...elems]);
}
