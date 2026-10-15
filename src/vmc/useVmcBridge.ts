/**
 * Browser side of the bridge: connects to the Node relay over WebSocket, keeps the
 * latest decoded frame in a ref (consumed by the render loop without re-rendering
 * React), and mirrors config/telemetry into the store.
 */
import { useEffect, useRef } from 'react';
import { decodeFrame } from '../../shared/frameCodec';
import type { BridgeConfig, ClientMessage, ServerMessage, VmcFrame } from '../../shared/protocol';
import { useStudio } from '../state/store';
import { publicUrl } from '../publicUrl';
import { LOCAL_BRIDGE_HTTP, LOCAL_BRIDGE_WS } from './localBridge';

export interface FrameSink {
  /** Latest frame; consumers should null it out after applying to avoid re-applying. */
  latest: VmcFrame | null;
  lastFrameAt: number;
  framesReceived: number;
}

export const frameSink: FrameSink = { latest: null, lastFrameAt: 0, framesReceived: 0 };

let socket: WebSocket | null = null;
/** Bumped every time the hook (re)connects, so sockets left open by HMR stop updating state. */
let connectionGeneration = 0;

function closeSocket() {
  if (!socket) return;
  socket.onclose = null;
  socket.onerror = null;
  socket.close();
  socket = null;
}

/** Base URL of the bridge the page is talking to. Empty until a probe succeeds. */
let bridgeHttpBase = '';

export function sendBridgeConfig(config: Partial<BridgeConfig>) {
  const msg: ClientMessage = { type: 'setConfig', config };
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  } else if (bridgeHttpBase) {
    fetch(`${bridgeHttpBase}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).catch(() => {});
  }
}

const retryListeners = new Set<() => void>();
/** Ask the hook to look for a bridge again (after the user starts the downloaded app). */
export function retryBridgeConnection() {
  for (const fn of retryListeners) fn();
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function sameOriginWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function useVmcBridge() {
  const setBridge = useStudio((s) => s.setBridge);
  const retryRef = useRef(1000);

  useEffect(() => {
    const generation = ++connectionGeneration;
    closeSocket();
    let disposed = false;
    let fpsCounter = 0;

    const fpsTimer = window.setInterval(() => {
      setBridge({ frameFps: fpsCounter });
      fpsCounter = 0;
    }, 1000);

    let socketUrl = '';
    let local = false;

    const connect = () => {
      if (disposed || generation !== connectionGeneration || !socketUrl) return;
      closeSocket();
      const ws = new WebSocket(socketUrl);
      ws.binaryType = 'arraybuffer';
      socket = ws;

      ws.onopen = () => {
        retryRef.current = 1000;
        setBridge({ wsConnected: true });
      };
      ws.onclose = () => {
        setBridge({ wsConnected: false });
        if (socket === ws) socket = null;
        if (disposed || generation !== connectionGeneration) return;
        // The dev server stays up, so keep trying. The downloadable bridge is a
        // window the user can close; don't hammer 127.0.0.1 after it goes away.
        if (!local) {
          window.setTimeout(connect, retryRef.current);
          retryRef.current = Math.min(8000, retryRef.current * 1.6);
        } else {
          window.setTimeout(() => { void locate(); }, 1200);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev) => {
        if (generation !== connectionGeneration) return;
        if (ev.data instanceof ArrayBuffer) {
          const frame = decodeFrame(ev.data);
          if (frame) {
            frameSink.latest = frame;
            frameSink.lastFrameAt = performance.now();
            frameSink.framesReceived++;
            fpsCounter++;
            // Cheap per-frame store update is throttled: only bone/blend counts once a second via fpsTimer.
            const st = useStudio.getState();
            if (!st.lastFrame || st.lastFrame.bones !== frame.bones.length || st.lastFrame.blends !== Object.keys(frame.blends).length) {
              setBridge({ lastFrame: { bones: frame.bones.length, blends: Object.keys(frame.blends).length, at: frameSink.lastFrameAt } });
            }
          }
          return;
        }
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage;
          if (msg.type === 'telemetry') setBridge({ telemetry: msg.telemetry });
          else if (msg.type === 'config') setBridge({ bridgeConfig: msg.config });
          else if (msg.type === 'error') console.warn('[bridge]', msg.message);
        } catch { /* ignore */ }
      };
    };

    // Same-origin first (npm run dev). Otherwise the downloadable bridge on loopback,
    // which an HTTPS page is allowed to reach. One probe, no reconnect storm.
    const locate = async () => {
      if (disposed || generation !== connectionGeneration) return;
      if (await probe(publicUrl('/api/status'))) {
        bridgeHttpBase = publicUrl('/api').replace(/\/api$/, '') || location.origin;
        socketUrl = sameOriginWs();
        local = false;
        setBridge({ bridgeAvailable: true, localBridge: false });
        connect();
        return;
      }
      if (await probe(`${LOCAL_BRIDGE_HTTP}/api/status`)) {
        bridgeHttpBase = LOCAL_BRIDGE_HTTP;
        socketUrl = LOCAL_BRIDGE_WS;
        local = true;
        setBridge({ bridgeAvailable: true, localBridge: true });
        connect();
        return;
      }
      bridgeHttpBase = '';
      socketUrl = '';
      local = false;
      closeSocket();
      setBridge({ bridgeAvailable: false, localBridge: false, wsConnected: false });
    };

    retryListeners.add(locate);
    void locate();

    return () => {
      disposed = true;
      window.clearInterval(fpsTimer);
      retryListeners.delete(locate);
      if (generation === connectionGeneration) closeSocket();
    };
  }, [setBridge]);
}
