import { useEffect, useState } from 'react';
import { Radio, Wifi, WifiOff } from 'lucide-react';
import { useStudio } from '../state/store';
import { sendBridgeConfig } from '../vmc/useVmcBridge';
import { Pill, Row, Section, Toggle } from './ui';

export function NetworkPanel() {
  const cfg = useStudio((s) => s.bridgeConfig);
  const tel = useStudio((s) => s.telemetry);
  const wsConnected = useStudio((s) => s.wsConnected);
  const bridgeAvailable = useStudio((s) => s.bridgeAvailable);
  const frameFps = useStudio((s) => s.frameFps);
  const lastFrame = useStudio((s) => s.lastFrame);

  const [port, setPort] = useState('39539');
  const [sender, setSender] = useState('*');
  const [bind, setBind] = useState('0.0.0.0');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!cfg || dirty) return;
    setPort(String(cfg.listenPort));
    setSender(cfg.senderFilter);
    setBind(cfg.bindAddress);
  }, [cfg, dirty]);

  const apply = () => {
    sendBridgeConfig({ listenPort: Number(port) || 39539, senderFilter: sender.trim() || '*', bindAddress: bind.trim() || '0.0.0.0' });
    setDirty(false);
  };

  const receiving = (tel?.lastPacketAgeMs ?? Infinity) < 1500 || frameFps > 0;
  const hosted = bridgeAvailable === false;
  const status = hosted ? 'warn' : !wsConnected ? 'bad' : tel?.error ? 'bad' : receiving ? 'good' : 'warn';
  const statusText = hosted ? 'hosted preview' : !wsConnected ? 'bridge offline' : tel?.error ? 'socket error' : receiving ? `receiving ${frameFps} fps` : 'waiting for data';
  const filteringSelf = !!cfg && cfg.senderFilter !== '*' && (tel?.localAddresses ?? []).some((a) => a.address === cfg.senderFilter);

  return (
    <Section title="Network / VMC source" icon={<Radio size={14} />} badge={<Pill tone={status}>{statusText}</Pill>}>
      {hosted ? (
        <div className="hint">
          This copy is the hosted preview. Characters, dances and the podium all work, but a phone cannot send UDP to
          GitHub Pages. Clone the repo and run <code>npm run dev</code> on a computer on the same Wi-Fi as the phone.
        </div>
      ) : (
        <div className="hint">
          VMC sends UDP from your phone <em>to this computer</em>. In the phone app set the destination to one of this
          machine's IPs below and the port configured here. Do not use this computer's own address as the destination.
        </div>
      )}
      <div className="ip-list">
        {tel?.localAddresses?.length ? tel.localAddresses.map((a) => (
          <code key={a.address} className="ip" title={a.iface} onClick={() => navigator.clipboard?.writeText(`${a.address}:${cfg?.listenPort ?? port}`)}>
            {a.address}:{cfg?.listenPort ?? port} <span className="ip-iface">{a.iface}</span>
          </code>
        )) : <span className="muted">{wsConnected ? 'no LAN interfaces found' : 'start the bridge: npm run dev'}</span>}
      </div>

      <Row label="Listen port" hint="UDP port the bridge listens on (VMC default 39539, some apps use 39540)">
        <input className="text" value={port} onChange={(e) => { setPort(e.target.value); setDirty(true); }} inputMode="numeric" />
      </Row>
      <Row label="Accept from IP" hint="The phone's address (or * for anyone). Not this computer's address — packets from other senders are dropped">
        <input className="text" value={sender} onChange={(e) => { setSender(e.target.value); setDirty(true); }} placeholder="* (any)" />
      </Row>
      <Row label="Bind address" hint="Interface to bind: 0.0.0.0 for all">
        <input className="text" value={bind} onChange={(e) => { setBind(e.target.value); setDirty(true); }} />
      </Row>
      <div className="button-row">
        <button className="btn primary" onClick={apply} disabled={!wsConnected}>Apply</button>
        {tel?.senders?.map((s) => (
          <button key={`${s.address}:${s.port}`} className="btn ghost small" title="Use this sender as the filter"
            onClick={() => { setSender(s.address); setDirty(true); sendBridgeConfig({ senderFilter: s.address }); }}>
            {s.accepted ? <Wifi size={12} /> : <WifiOff size={12} />} {s.address}
          </button>
        ))}
      </div>

      <div className="telemetry">
        <div><span className="muted">packets</span> {tel?.totalPackets ?? 0}</div>
        <div><span className="muted">frames/s</span> {frameFps}</div>
        <div><span className="muted">bones</span> {lastFrame?.bones ?? tel?.lastBoneCount ?? 0}</div>
        <div><span className="muted">blendshapes</span> {lastFrame?.blends ?? tel?.lastBlendCount ?? 0}</div>
        <div><span className="muted">bound</span> {tel?.listening ? `${tel.bindAddress}:${tel.listenPort}` : '-'}</div>
        <div><span className="muted">last packet</span> {tel?.lastPacketAgeMs == null ? 'never' : tel.lastPacketAgeMs < 1000 ? 'now' : `${(tel.lastPacketAgeMs / 1000).toFixed(0)}s ago`}</div>
      </div>
      {filteringSelf && (
        <div className="error">
          Accept from IP is this computer's own address, so the phone's packets are being dropped. Set it to * or click the phone's address below.
        </div>
      )}
      {tel?.error && <div className="error">{tel.error}</div>}

      <Row label="Demo signal" hint="Fake a phone: stands, looks around and waves hello every few seconds. Only used while no real VMC data arrives. Turn off to see the true idle behaviour.">
        <Toggle value={!!cfg?.testSignal} onChange={(v) => sendBridgeConfig({ testSignal: v })} />
      </Row>
    </Section>
  );
}
