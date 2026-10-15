/**
 * VMC bridge: listens for VMC Protocol OSC packets over UDP, decodes them, and
 * relays compact binary frames to browser clients over WebSocket. Also exposes a
 * small JSON control channel (WebSocket + HTTP) to reconfigure the listening
 * port / bind address / sender IP filter at runtime and to report telemetry.
 */
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { parseOscPacket, type OscMessage } from './oscParser';
import { encodeFrame } from '../shared/frameCodec';
import { generateTestPacket } from './testSignal';
import {
  DEFAULT_CONFIG,
  type BoneTransform,
  type BridgeConfig,
  type BridgeTelemetry,
  type ClientMessage,
  type ServerMessage,
  type VmcFrame,
} from '../shared/protocol';

const HTTP_PORT = Number(process.env.BRIDGE_PORT ?? 8787);
const SENDER_TTL_MS = 5000;

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

let config: BridgeConfig = { ...DEFAULT_CONFIG };
if (process.env.VMC_PORT) config.listenPort = Number(process.env.VMC_PORT);
if (process.env.VMC_SENDER) config.senderFilter = process.env.VMC_SENDER;

let udp: dgram.Socket | null = null;
let udpError: string | null = null;
let listening = false;

interface SenderStat { address: string; port: number; packets: number; lastSeenMs: number; accepted: boolean }
const senders = new Map<string, SenderStat>();

let totalPackets = 0;
let packetsThisSecond = 0;
let fps = 0;
let lastPacketMs: number | null = null;
let lastBoneCount = 0;
let lastBlendCount = 0;

// Per-frame accumulator. VMC senders may spread one frame across several UDP
// bundles; /VMC/Ext/Blend/Apply (or the next Root/Pos) marks a frame boundary.
let pendingRoot: BoneTransform | null = null;
let pendingBones = new Map<string, BoneTransform>();
let pendingBlends: Record<string, number> = {};
let pendingDirty = false;

const clients = new Set<WebSocket>();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function localAddresses() {
  const out: { iface: string; address: string }[] = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal) out.push({ iface, address: n.address });
    }
  }
  return out;
}

function senderAccepted(address: string): boolean {
  const f = config.senderFilter.trim();
  if (!f || f === '*' || f.toLowerCase() === 'any') return true;
  return f.split(',').map((s) => s.trim()).filter(Boolean).includes(address);
}

function broadcast(data: Uint8Array | string) {
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function telemetry(): BridgeTelemetry {
  const now = Date.now();
  for (const [k, s] of senders) if (now - s.lastSeenMs > SENDER_TTL_MS) senders.delete(k);
  return {
    listening,
    listenPort: config.listenPort,
    bindAddress: config.bindAddress,
    senderFilter: config.senderFilter,
    localAddresses: localAddresses(),
    senders: [...senders.values()].map((s) => ({ ...s, accepted: senderAccepted(s.address) })),
    fps,
    totalPackets,
    lastBoneCount,
    lastBlendCount,
    lastPacketAgeMs: lastPacketMs === null ? null : now - lastPacketMs,
    testSignal: config.testSignal,
    error: udpError,
  };
}

function flushFrame(timestampMs: number) {
  if (!pendingDirty) return;
  const frame: VmcFrame = {
    timestampMs,
    root: pendingRoot,
    bones: [...pendingBones.values()],
    blends: pendingBlends,
  };
  lastBoneCount = frame.bones.length;
  lastBlendCount = Object.keys(frame.blends).length;
  broadcast(encodeFrame(frame));
  pendingBones = new Map();
  pendingBlends = {};
  pendingRoot = null;
  pendingDirty = false;
}

function handleOsc(messages: OscMessage[], timestampMs: number) {
  for (const m of messages) {
    const a = m.args;
    switch (m.address) {
      case '/VMC/Ext/Root/Pos': {
        // A new root means a new frame if we already have bones buffered.
        if (pendingBones.size > 0) flushFrame(timestampMs);
        if (a.length >= 8) {
          pendingRoot = {
            name: 'root',
            px: a[1] as number, py: a[2] as number, pz: a[3] as number,
            qx: a[4] as number, qy: a[5] as number, qz: a[6] as number, qw: a[7] as number,
          };
          pendingDirty = true;
        }
        break;
      }
      case '/VMC/Ext/Bone/Pos': {
        if (a.length >= 8 && typeof a[0] === 'string') {
          pendingBones.set(a[0], {
            name: a[0],
            px: a[1] as number, py: a[2] as number, pz: a[3] as number,
            qx: a[4] as number, qy: a[5] as number, qz: a[6] as number, qw: a[7] as number,
          });
          pendingDirty = true;
        }
        break;
      }
      case '/VMC/Ext/Blend/Val': {
        if (a.length >= 2 && typeof a[0] === 'string') {
          pendingBlends[a[0]] = a[1] as number;
          pendingDirty = true;
        }
        break;
      }
      case '/VMC/Ext/Blend/Apply':
        flushFrame(timestampMs);
        break;
      default:
        break; // /VMC/Ext/OK, /VMC/Ext/T, trackers, etc. are ignored for now
    }
  }
}

// ----------------------------------------------------------------------------
// UDP listener (re-creatable at runtime)
// ----------------------------------------------------------------------------

function closeUdp(): Promise<void> {
  return new Promise((resolve) => {
    if (!udp) return resolve();
    const s = udp;
    udp = null;
    listening = false;
    try { s.close(() => resolve()); } catch { resolve(); }
  });
}

async function startUdp() {
  await closeUdp();
  udpError = null;
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp = sock;

  sock.on('error', (err) => {
    udpError = `${err.message}`;
    listening = false;
    console.error('[udp] error:', err.message);
    try { sock.close(); } catch { /* ignore */ }
    if (udp === sock) udp = null;
  });

  sock.on('message', (msg, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`;
    const now = Date.now();
    const stat = senders.get(key) ?? { address: rinfo.address, port: rinfo.port, packets: 0, lastSeenMs: now, accepted: true };
    stat.packets++;
    stat.lastSeenMs = now;
    stat.accepted = senderAccepted(rinfo.address);
    senders.set(key, stat);
    if (!stat.accepted) return;

    totalPackets++;
    packetsThisSecond++;
    lastPacketMs = now;
    try {
      handleOsc(parseOscPacket(msg), now);
    } catch (e) {
      console.warn('[osc] parse failure:', (e as Error).message);
    }
  });

  await new Promise<void>((resolve) => {
    sock.once('listening', () => {
      listening = true;
      const addr = sock.address();
      console.log(`[udp] listening for VMC on ${addr.address}:${addr.port} (sender filter: ${config.senderFilter || '*'})`);
      resolve();
    });
    sock.once('error', () => resolve());
    try {
      sock.bind(config.listenPort, config.bindAddress || '0.0.0.0');
    } catch (e) {
      udpError = (e as Error).message;
      resolve();
    }
  });
}

// ----------------------------------------------------------------------------
// Test-signal generator
// ----------------------------------------------------------------------------

let testTimer: NodeJS.Timeout | null = null;
function updateTestSignal() {
  if (config.testSignal && !testTimer) {
    const start = Date.now();
    testTimer = setInterval(() => {
      // Only synthesize when nothing real has arrived recently.
      if (lastPacketMs !== null && Date.now() - lastPacketMs < 1000) return;
      const pkt = generateTestPacket((Date.now() - start) / 1000);
      handleOsc(parseOscPacket(pkt), Date.now());
    }, 1000 / 60);
  } else if (!config.testSignal && testTimer) {
    clearInterval(testTimer);
    testTimer = null;
  }
}

// ----------------------------------------------------------------------------
// Config changes
// ----------------------------------------------------------------------------

async function applyConfig(patch: Partial<BridgeConfig>) {
  const next: BridgeConfig = { ...config, ...patch };
  next.listenPort = Math.max(1, Math.min(65535, Math.floor(Number(next.listenPort) || DEFAULT_CONFIG.listenPort)));
  next.bindAddress = (next.bindAddress || '0.0.0.0').trim();
  next.senderFilter = (next.senderFilter ?? '*').trim() || '*';
  const needsRebind = next.listenPort !== config.listenPort || next.bindAddress !== config.bindAddress || !listening;
  config = next;
  if (needsRebind) await startUdp();
  updateTestSignal();
  broadcast(JSON.stringify({ type: 'config', config } satisfies ServerMessage));
  broadcast(JSON.stringify({ type: 'telemetry', telemetry: telemetry() } satisfies ServerMessage));
}

// ----------------------------------------------------------------------------
// HTTP + WebSocket
// ----------------------------------------------------------------------------

function cors(req: http.IncomingMessage, res: http.ServerResponse) {
  // Echo the origin. Chrome's local-network check rejects Access-Control-Allow-Origin: *.
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ config, telemetry: telemetry() }));
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        await applyConfig(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ config, telemetry: telemetry() }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('VMC bridge: use /ws, /api/status, /api/config');
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  send(ws, { type: 'config', config });
  send(ws, { type: 'telemetry', telemetry: telemetry() });
  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === 'setConfig') await applyConfig(msg.config);
      else if (msg.type === 'getConfig') send(ws, { type: 'config', config });
    } catch (e) {
      send(ws, { type: 'error', message: (e as Error).message });
    }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

setInterval(() => {
  fps = packetsThisSecond;
  packetsThisSecond = 0;
  if (clients.size) broadcast(JSON.stringify({ type: 'telemetry', telemetry: telemetry() } satisfies ServerMessage));
}, 1000);

export interface BridgeStartOptions {
  /** Interface for the browser socket. The downloadable bridge uses 127.0.0.1. */
  host?: string;
  /** Print phone instructions and open the deployed site. */
  companion?: boolean;
  openBrowser?: boolean;
  pageUrl?: string;
}

export function startBridge(opts: BridgeStartOptions = {}) {
  const pageUrl = opts.pageUrl || process.env.BRIDGE_PAGE || 'https://ccavins.github.io/VMC_app/';
  const onListen = () => {
    const where = opts.host ? `${opts.host}:${HTTP_PORT}` : `port ${HTTP_PORT}`;
    console.log(`[bridge] http/ws on ${where}  (ws path /ws)`);
    const ips = localAddresses();
    if (opts.companion) {
      console.log('');
      console.log('VMC Bridge is running. Leave this window open.');
      console.log('');
      console.log('On the phone\'s VMC app, set the destination to one of these addresses');
      console.log(`and port ${config.listenPort}:`);
      if (ips.length) for (const a of ips) console.log(`  ${a.address}   (${a.iface})`);
      else console.log('  (no network address found — connect this computer to Wi-Fi)');
      console.log('');
      console.log('Then use the studio page. It connects to this bridge on its own:');
      console.log(`  ${pageUrl}`);
      console.log('');
      if (opts.openBrowser !== false) openPage(pageUrl);
    } else {
      console.log(`[bridge] point your VMC sender at one of this machine's IPs: ${ips.map((a) => `${a.address} (${a.iface})`).join(', ') || 'none found'}`);
    }
    void startUdp().then(updateTestSignal);
  };
  if (opts.host) httpServer.listen(HTTP_PORT, opts.host, onListen);
  else httpServer.listen(HTTP_PORT, onListen);
}

function openPage(url: string) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* the printed URL is enough */ }
}

// Started directly with `tsx server/index.ts` or `npm run server`. The downloadable
// bridge imports startBridge instead, so this does not run inside that bundle.
const invokedDirectly = process.argv[1] && /[/\\]server[/\\]index\.ts$/.test(process.argv[1]);
if (invokedDirectly) startBridge();

const shutdown = () => { void closeUdp().then(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
