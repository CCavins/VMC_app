import { Activity, Camera, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useState } from 'react';
import { useStudio, type CameraPreset, type StatusPlacement } from '../state/store';
import { NetworkPanel } from './NetworkPanel';
import { CharacterPanel } from './CharacterPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { TrackingStatus, useTrackingStatus } from './TrackingStatus';
import { Row, Section, Select, Toggle } from './ui';

const STATUS_PLACEMENTS: { value: StatusPlacement; label: string }[] = [
  { value: 'sidebar', label: 'Top of this panel' },
  { value: 'viewport', label: 'Over the 3D view' },
  { value: 'hidden', label: 'Hidden' },
];

const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: 'full', label: 'Full body' },
  { id: 'upper', label: 'Upper body' },
  { id: 'face', label: 'Face' },
  { id: 'hands', label: 'Hands' },
  { id: 'orbit', label: 'Orbit 360' },
];

export function ControlPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const cameraPreset = useStudio((s) => s.cameraPreset);
  const setCameraPreset = useStudio((s) => s.setCameraPreset);
  const showStats = useStudio((s) => s.showStats);
  const setShowStats = useStudio((s) => s.setShowStats);
  const statusPlacement = useStudio((s) => s.statusPlacement);
  const setStatusPlacement = useStudio((s) => s.setStatusPlacement);
  const { label: statusLabel, tone: statusTone } = useTrackingStatus();

  if (collapsed) {
    return (
      <button className="panel-toggle" onClick={() => setCollapsed(false)} title={`Show controls (${statusLabel})`}>
        <PanelRightOpen size={16} />
        {statusPlacement === 'sidebar' && <span className={`dot ${statusTone}`} />}
      </button>
    );
  }

  return (
    <aside className="control-panel">
      <header className="panel-header">
        <div>
          <div className="app-title">VMC Podium Studio</div>
          <div className="app-subtitle">live body, finger and face capture to 3D characters</div>
        </div>
        <button className="btn icon ghost" onClick={() => setCollapsed(true)} title="Hide controls"><PanelRightClose size={16} /></button>
      </header>
      {statusPlacement === 'sidebar' && <TrackingStatus variant="sidebar" />}

      <div className="panel-scroll">
        <NetworkPanel />
        <CharacterPanel />
        <Section title="Camera & view" icon={<Camera size={14} />} defaultOpen={false}>
          <div className="camera-row">
            {CAMERA_PRESETS.map((p) => (
              <button key={p.id} className={`btn small ${cameraPreset === p.id ? 'primary' : ''}`} onClick={() => setCameraPreset(p.id)}>{p.label}</button>
            ))}
          </div>
          <div className="hint">Drag to orbit, scroll to zoom, right-drag to pan. Any manual move switches to free camera.</div>
          <Row label="Tracking status"><Select value={statusPlacement} options={STATUS_PLACEMENTS} onChange={setStatusPlacement} /></Row>
          <Row label="Performance stats"><Toggle value={showStats} onChange={setShowStats} /></Row>
        </Section>
        <EnvironmentPanel />
        <Section title="How it works" icon={<Activity size={14} />} defaultOpen={false}>
          <div className="hint">
            The phone streams VMC Protocol (OSC over UDP): 55 humanoid bone rotations including all 30 finger joints and both eyes,
            plus 52 ARKit face blendshapes, ~60 times a second. A local Node bridge decodes the packets and relays them to this page over
            WebSocket. Rotations are retargeted from Unity's humanoid T-pose onto whichever rig is loaded (VRM 0.x / 1.0, Mixamo, RPM, Blender
            naming), hips stay centred on the podium and the lowest foot is kept on the podium surface every frame.
          </div>
        </Section>
      </div>
    </aside>
  );
}
