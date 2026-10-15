import { useRef } from 'react';
import { Image as ImageIcon, Mountain, Upload } from 'lucide-react';
import { useStudio, ENV_PRESETS, type PodiumStyle, type SurfaceSettings, type TextureSetEntry } from '../state/store';
import { PODIUM_STYLES, PROCEDURAL_SURFACES } from '../scene/environmentPresets';
import { ColorInput, Row, Section, Select, Slider, Toggle } from './ui';

let uploadCounter = 0;

function SurfaceEditor({ title, which, surface }: { title: string; which: 'podiumTop' | 'podiumSide' | 'floor'; surface: SurfaceSettings }) {
  const textureSets = useStudio((s) => s.textureSets);
  const setSurface = useStudio((s) => s.setSurface);
  const setLibrary = useStudio((s) => s.setLibrary);
  const fileRef = useRef<HTMLInputElement>(null);

  const options = [
    ...PROCEDURAL_SURFACES.map((p) => ({ value: p.id, label: p.name })),
    ...textureSets.map((t) => ({ value: t.id, label: t.name })),
  ];

  const onUpload = (files: FileList | null) => {
    if (!files || !files.length) return;
    // Heuristic: names containing "nor"/"normal" -> normal map, "rough" -> roughness, else diffuse.
    const maps: TextureSetEntry['maps'] = {};
    for (const f of Array.from(files)) {
      const url = URL.createObjectURL(f);
      const n = f.name.toLowerCase();
      if (/nor|nrm|normal/.test(n)) maps.normal = url;
      else if (/rough|rgh/.test(n)) maps.roughness = url;
      else maps.diffuse = url;
    }
    const id = `upload-tex-${++uploadCounter}`;
    const entry: TextureSetEntry = { id, name: `Uploaded ${uploadCounter}: ${files[0].name.replace(/\.[^.]+$/, '')}`, maps, license: 'user upload' };
    setLibrary({ textureSets: [...textureSets, entry] });
    setSurface(which, { textureId: id });
  };

  return (
    <div className="surface-editor">
      <div className="subheading">{title}</div>
      <Row label="Texture">
        <span className="inline">
          <Select value={surface.textureId} options={options} onChange={(v) => setSurface(which, { textureId: v })} />
          <button className="btn icon" title="Upload texture images (diffuse / normal / roughness)" onClick={() => fileRef.current?.click()}><Upload size={12} /></button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onUpload(e.target.files)} />
        </span>
      </Row>
      <Row label="Tint"><ColorInput value={surface.tint} onChange={(v) => setSurface(which, { tint: v })} /></Row>
      <Row label="Roughness"><Slider value={surface.roughness} min={0} max={1} onChange={(v) => setSurface(which, { roughness: v })} /></Row>
      <Row label="Metalness"><Slider value={surface.metalness} min={0} max={1} onChange={(v) => setSurface(which, { metalness: v })} /></Row>
      <Row label="Tiling"><Slider value={surface.repeat} min={0.25} max={12} step={0.25} onChange={(v) => setSurface(which, { repeat: v })} format={(v) => `${v}x`} /></Row>
    </div>
  );
}

export function EnvironmentPanel() {
  const env = useStudio((s) => s.env);
  const setEnv = useStudio((s) => s.setEnv);
  const hdris = useStudio((s) => s.hdris);
  const setLibrary = useStudio((s) => s.setLibrary);
  const stageRef = useRef<HTMLInputElement>(null);
  const hdriRef = useRef<HTMLInputElement>(null);

  const applyPreset = (style: PodiumStyle) => {
    if (style === 'custom') {
      setEnv({ podiumStyle: 'custom', showFloor: false, particles: false, fog: false });
    } else {
      setEnv({ ...ENV_PRESETS[style] });
    }
  };

  const onStage = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setEnv({ podiumStyle: 'custom', customStageUrl: URL.createObjectURL(f), customStageScale: 1, customStageYOffset: 0 });
  };

  const onHdri = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    const id = `upload-hdri-${++uploadCounter}`;
    setLibrary({ hdris: [...hdris, { id, name: f.name, path: URL.createObjectURL(f), license: 'user upload' }] });
    setEnv({ hdriId: id, backdrop: 'hdri', hdriAsBackground: true });
  };

  return (
    <Section title="Environment / Podium" icon={<Mountain size={14} />} defaultOpen={false}>
      <div className="preset-grid">
        {PODIUM_STYLES.map((p) => (
          <button key={p.id} className={`preset-card ${env.podiumStyle === p.id ? 'active' : ''}`} onClick={() => applyPreset(p.id)} title={p.description}>
            {p.name}
          </button>
        ))}
      </div>

      <div className="subheading">Podium</div>
      {env.podiumStyle === 'custom' ? (
        <>
          <div className="button-row">
            <button className="btn" onClick={() => stageRef.current?.click()}><Upload size={12} /> Import stage (.glb/.gltf)</button>
            <input ref={stageRef} type="file" accept=".glb,.gltf" hidden onChange={(e) => onStage(e.target.files)} />
            {env.customStageUrl && <span className="muted">stage loaded</span>}
          </div>
          <Row label="Stage scale"><Slider value={env.customStageScale} min={0.05} max={5} step={0.01} onChange={(v) => setEnv({ customStageScale: v })} format={(v) => `${v.toFixed(2)}x`} /></Row>
          <Row label="Stage Y offset"><Slider value={env.customStageYOffset} min={-2} max={2} step={0.01} onChange={(v) => setEnv({ customStageYOffset: v })} format={(v) => `${v.toFixed(2)} m`} /></Row>
          <Row label="Standing height" hint="Y position where the character's feet rest on your stage">
            <Slider value={env.podiumHeight} min={-1} max={3} step={0.005} onChange={(v) => setEnv({ podiumHeight: v })} format={(v) => `${v.toFixed(2)} m`} />
          </Row>
        </>
      ) : (
        <>
          <Row label="Radius"><Slider value={env.podiumRadius} min={0.4} max={2} step={0.01} onChange={(v) => setEnv({ podiumRadius: v })} format={(v) => `${v.toFixed(2)} m`} /></Row>
          <Row label="Height"><Slider value={env.podiumHeight} min={0.02} max={1.2} step={0.01} onChange={(v) => setEnv({ podiumHeight: v })} format={(v) => `${v.toFixed(2)} m`} /></Row>
          <Row label="Turntable" hint="Slowly rotate the podium (broadcast style only rotates geometry)">
            <Slider value={env.turntableSpeed} min={0} max={1} step={0.01} onChange={(v) => setEnv({ turntableSpeed: v })} format={(v) => v === 0 ? 'off' : `${v.toFixed(2)} rad/s`} />
          </Row>
          <Row label="Accent color"><ColorInput value={env.accentColor} onChange={(v) => setEnv({ accentColor: v })} /></Row>
          <SurfaceEditor title="Podium top" which="podiumTop" surface={env.podiumTop} />
          <SurfaceEditor title="Podium side" which="podiumSide" surface={env.podiumSide} />
          <Row label="Show floor"><Toggle value={env.showFloor} onChange={(v) => setEnv({ showFloor: v })} /></Row>
          {env.showFloor && <SurfaceEditor title="Floor" which="floor" surface={env.floor} />}
        </>
      )}

      <div className="subheading">Backdrop and lighting</div>
      <Row label="Backdrop">
        <Select value={env.backdrop} onChange={(v) => setEnv({ backdrop: v })} options={[
          { value: 'hdri', label: 'HDRI sky' }, { value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid color' }, { value: 'none', label: 'None' },
        ]} />
      </Row>
      <Row label="HDRI (lighting)">
        <span className="inline">
          <Select value={env.hdriId ?? ''} onChange={(v) => setEnv({ hdriId: v || null })} options={[{ value: '', label: 'None' }, ...hdris.map((h) => ({ value: h.id, label: h.name }))]} />
          <button className="btn icon" title="Upload .hdr" onClick={() => hdriRef.current?.click()}><ImageIcon size={12} /></button>
          <input ref={hdriRef} type="file" accept=".hdr" hidden onChange={(e) => onHdri(e.target.files)} />
        </span>
      </Row>
      {env.backdrop === 'hdri' && <Row label="HDRI visible"><Toggle value={env.hdriAsBackground} onChange={(v) => setEnv({ hdriAsBackground: v })} /></Row>}
      <Row label="HDRI intensity"><Slider value={env.hdriIntensity} min={0} max={3} onChange={(v) => setEnv({ hdriIntensity: v })} /></Row>
      <Row label="Background"><ColorInput value={env.backgroundColor} onChange={(v) => setEnv({ backgroundColor: v })} /></Row>
      <Row label="Exposure" hint="Turn this down when a face looks washed out and the eyes or skin detail disappear">
        <Slider value={env.exposure ?? 0.85} min={0.4} max={1.6} step={0.05} onChange={(v) => setEnv({ exposure: v })} format={(v) => v.toFixed(2)} />
      </Row>
      <Row label="Key light"><Slider value={env.keyLightIntensity} min={0} max={6} onChange={(v) => setEnv({ keyLightIntensity: v })} /></Row>
      <Row label="Rim light"><Slider value={env.rimLightIntensity} min={0} max={8} onChange={(v) => setEnv({ rimLightIntensity: v })} /></Row>
      <Row label="Spotlight"><Slider value={env.spotlightIntensity} min={0} max={60} step={0.5} onChange={(v) => setEnv({ spotlightIntensity: v })} /></Row>
      <Row label="Fog"><Toggle value={env.fog} onChange={(v) => setEnv({ fog: v })} /></Row>
      <Row label="Particles"><Toggle value={env.particles} onChange={(v) => setEnv({ particles: v })} /></Row>
    </Section>
  );
}
