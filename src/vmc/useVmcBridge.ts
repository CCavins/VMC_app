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

export function sendBridgeConfig(config: Partial<BridgeConfig>) {
  const msg: ClientMessage = { type: 'setConfig', config };
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  } else {
    // Fallback when the socket is down: use HTTP.
    fetch(publicUrl('/api/config'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).catch(() => {});
  }
}

function wsUrl() {
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

    const connect = () => {
      if (disposed || generation !== connectionGeneration) return;
      closeSocket();
      const ws = new WebSocket(wsUrl());
      ws.binaryType = 'arraybuffer';
      socket = ws;

      ws.onopen = () => {
        retryRef.current = 1000;
        setBridge({ wsConnected: true });
      };
      ws.onclose = () => {
        setBridge({ wsConnected: false });
        if (socket === ws) socket = null;
        if (!disposed) {
          window.setTimeout(connect, retryRef.current);
          retryRef.current = Math.min(8000, retryRef.current * 1.6);
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

    // Static hosts (GitHub Pages) have no UDP bridge. Probe once and stay quiet
    // instead of reconnecting a WebSocket that can never open.
    (async () => {
      let available = false;
      try {
        const res = await fetch(publicUrl('/api/status'), { signal: AbortSignal.timeout(2000) });
        available = res.ok;
      } catch { available = false; }
      if (disposed) return;
      setBridge({ bridgeAvailable: available });
      if (available) connect();
    })();

    return () => {
      disposed = true;
      window.clearInterval(fpsTimer);
      if (generation === connectionGeneration) closeSocket();
    };
  }, [setBridge]);
}
