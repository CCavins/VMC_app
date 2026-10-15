import { useRef } from 'react';
import { Crosshair, SkipForward, Sparkles, Upload, User, X } from 'lucide-react';
import { useStudio, DEFAULT_TRACKING } from '../state/store';
import { registerUploadedCharacter } from '../state/uploads';
import type { IdleMode } from '../../shared/idleAnimation';
import { clipLibrary, useClipLibrary } from '../vmc/clipLibrary';
import { Pill, Row, Section, Select, Slider, Toggle } from './ui';

const IDLE_MODES: { value: IdleMode; label: string }[] = [
  { value: 'calm', label: 'Calm (stand & look around)' },
  { value: 'mixed', label: 'Calm + surprises' },
  { value: 'dance', label: 'Dance' },
];

export function CharacterPanel() {
  const characters = useStudio((s) => s.characters);
  const characterId = useStudio((s) => s.characterId);
  const status = useStudio((s) => s.characterStatus);
  const error = useStudio((s) => s.characterError);
  const info = useStudio((s) => s.characterInfo);
  const select = useStudio((s) => s.selectCharacter);
  const addCharacter = useStudio((s) => s.addCharacter);
  const tracking = useStudio((s) => s.tracking);
  const setTracking = useStudio((s) => s.setTracking);
  const requestCalibrate = useStudio((s) => s.requestCalibrate);
  const showSkeleton = useStudio((s) => s.showSkeleton);
  const setShowSkeleton = useStudio((s) => s.setShowSkeleton);
  const trackingState = useStudio((s) => s.trackingState);
  const danceClipName = useStudio((s) => s.danceClipName);
  const setDanceClipEnabled = useStudio((s) => s.setDanceClipEnabled);
  const clips = useClipLibrary();
  const fileRef = useRef<HTMLInputElement>(null);
  const clipRef = useRef<HTMLInputElement>(null);

  const toggleClip = (id: string, enabled: boolean) => {
    clipLibrary.setEnabled(id, enabled);
    setDanceClipEnabled(id, enabled);
  };

  const current = characters.find((c) => c.id === characterId);

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (!/\.(vrm|glb|gltf|fbx)$/i.test(f.name)) continue;
      const entry = registerUploadedCharacter(f);
      addCharacter(entry);
      select(entry.id);
    }
  };

  const statusPill = status === 'ready' ? <Pill tone="good">ready</Pill>
    : status === 'loading' ? <Pill tone="warn">loading</Pill>
    : status === 'error' ? <Pill tone="bad">error</Pill> : <Pill>none</Pill>;

  const groups: { title: string; items: typeof characters }[] = [
    { title: 'Faces — blink and mouth', items: characters.filter((c) => !c.uploaded && (!c.category || c.category === 'person') && c.hasBlendshapes) },
    { title: 'People', items: characters.filter((c) => !c.uploaded && (!c.category || c.category === 'person') && !c.hasBlendshapes) },
    { title: 'Animals & creatures', items: characters.filter((c) => !c.uploaded && c.category === 'animal') },
    { title: 'Imported', items: characters.filter((c) => c.uploaded) },
  ].filter((g) => g.items.length > 0);

  const card = (c: (typeof characters)[number]) => (
    <button key={c.id} className={`char-card ${c.id === characterId ? 'active' : ''}`} onClick={() => select(c.id)} title={c.description}>
      <span className="char-name">{c.name}</span>
      <span className="char-meta">{c.format.toUpperCase()}{c.hasBlendshapes ? ' · face' : ''}{c.uploaded ? ' · uploaded' : ''}</span>
    </button>
  );

  return (
    <Section title="Character" icon={<User size={14} />} badge={statusPill}>
      {groups.map((g) => (
        <div key={g.title}>
          <div className="subheading">{g.title}</div>
          <div className="character-grid">{g.items.map(card)}</div>
        </div>
      ))}
      <div className="character-grid" style={{ marginTop: 6 }}>
        <button className="char-card upload" onClick={() => fileRef.current?.click()}>
          <Upload size={16} />
          <span className="char-name">Import</span>
          <span className="char-meta">.vrm .glb .gltf .fbx</span>
        </button>
        <input ref={fileRef} type="file" accept=".vrm,.glb,.gltf,.fbx" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>
      {error && <div className="error">{error}</div>}
      {current && (
        <div className="char-info">
          <div>{current.description}</div>
          {info && (
            <div className="muted">
              {info.format} - {info.bones} bones mapped ({info.fingers} finger bones), {info.expressions} expressions
              <br />
              height {info.stageHeight.toFixed(2)} m
              {Math.abs(info.stageHeight - info.naturalHeight) > 0.01 && ` (file: ${info.naturalHeight.toFixed(2)}, auto-fitted)`}
              {tracking.scale !== 1 && ` x ${tracking.scale.toFixed(2)} scale`}
            </div>
          )}
          {current.license && <div className="muted">License: {current.license}{current.source && <> - <a href={current.source} target="_blank" rel="noreferrer">source</a></>}</div>}
        </div>
      )}

      <div className="subheading">Podium placement</div>
      <Row label="Horizontal follow" hint="0 = pinned to the podium centre, 1 = follow your hips 1:1 as you move around">
        <Slider value={tracking.horizontalFollow} min={0} max={1} onChange={(v) => setTracking({ horizontalFollow: v })} format={(v) => v === 0 ? 'locked' : `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Vertical follow" hint="0 = feet always on the podium (crouches still bend the knees), 1 = follow hips height (jumps)">
        <Slider value={tracking.verticalFollow} min={0} max={1} onChange={(v) => setTracking({ verticalFollow: v })} format={(v) => v === 0 ? 'grounded' : `${Math.round(v * 100)}%`} />
      </Row>
      <Row label="Foot grounding" hint="Keep the lowest foot on the podium surface every frame">
        <Toggle value={tracking.footGrounding} onChange={(v) => setTracking({ footGrounding: v })} />
      </Row>
      <Row label="Height offset" hint="Nudge the character up/down (metres)">
        <Slider value={tracking.floorOffset} min={-0.2} max={0.3} step={0.005} onChange={(v) => setTracking({ floorOffset: v })} format={(v) => `${(v * 100).toFixed(1)} cm`} />
      </Row>
      <Row label="Facing" hint="Rotate the character on the podium">
        <Slider value={tracking.yawOffsetDeg} min={-180} max={180} step={1} onChange={(v) => setTracking({ yawOffsetDeg: v })} format={(v) => `${v.toFixed(0)} deg`} />
      </Row>
      <Row label="Scale">
        <Slider value={tracking.scale} min={0.5} max={1.6} step={0.01} onChange={(v) => setTracking({ scale: v })} format={(v) => `${v.toFixed(2)}x`} />
      </Row>
      <div className="button-row">
        <button className="btn" onClick={requestCalibrate} title="Use the current hips position as the podium centre"><Crosshair size={12} /> Calibrate centre</button>
        <button className="btn ghost" onClick={() => setTracking({ ...DEFAULT_TRACKING })}>Reset</button>
      </div>

      <div className="subheading">Tracking</div>
      <Row label="Smoothing" hint="Blend toward incoming rotations; higher = smoother but laggier">
        <Slider value={tracking.smoothing} min={0} max={0.9} onChange={(v) => setTracking({ smoothing: v })} />
      </Row>
      <Row label="Mirror" hint="Swap left/right so the character mirrors you like a mirror would">
        <Toggle value={tracking.mirror} onChange={(v) => setTracking({ mirror: v })} />
      </Row>
      <Row label="Fingers"><Toggle value={tracking.applyFingers} onChange={(v) => setTracking({ applyFingers: v })} /></Row>
      <Row label="Face (blendshapes)"><Toggle value={tracking.applyFace} onChange={(v) => setTracking({ applyFace: v })} /></Row>
      <Row label="Face gain">
        <Slider value={tracking.faceGain} min={0.2} max={2} onChange={(v) => setTracking({ faceGain: v })} format={(v) => `${v.toFixed(1)}x`} />
      </Row>
      <Row label="Eye bones"><Toggle value={tracking.applyEyes} onChange={(v) => setTracking({ applyEyes: v })} /></Row>
      <Row label="Root rotation" hint="Apply /VMC/Ext/Root/Pos rotation on top of the hips">
        <Toggle value={tracking.applyRootRotation} onChange={(v) => setTracking({ applyRootRotation: v })} />
      </Row>
      <Row label="Show skeleton"><Toggle value={showSkeleton} onChange={setShowSkeleton} /></Row>

      <div className="subheading">When nobody is tracked</div>
      <div className="hint">
        If the stream stops, or the phone keeps sending a frozen / empty pose because it lost the person, the character waits for the
        delay below, then eases into an idle animation. Live tracking resumes the moment real motion comes back.
        {' '}Current state: <strong>{trackingState}</strong>.
      </div>
      <Row label="Idle animation"><Toggle value={tracking.idleEnabled} onChange={(v) => setTracking({ idleEnabled: v })} /></Row>
      <Row label="Idle delay" hint="How long tracking must be lost before idle starts; short dropouts just hold the pose">
        <Slider value={tracking.idleDelaySec} min={0.5} max={15} step={0.5} onChange={(v) => setTracking({ idleDelaySec: v })} format={(v) => `${v.toFixed(1)} s`} />
      </Row>
      <Row label="Idle style" hint="Calm: stand, sway and look around. Dance: a looping groove. Calm + surprises: calm, with a random bit (dance burst, wave, stretch, spin, hop, bow, backflip) every 10-30 s">
        <Select value={tracking.idleMode} options={IDLE_MODES} onChange={(v) => setTracking({ idleMode: v })} />
      </Row>
      <Row label="Idle motion" hint="How much the idle animation moves">
        <Slider value={tracking.idleEnergy} min={0} max={2} onChange={(v) => setTracking({ idleEnergy: v })} format={(v) => `${v.toFixed(1)}x`} />
      </Row>
      <Row label="Preview idle" hint="Force the idle animation while this is on, even with live tracking, so you can tune it">
        <Toggle value={tracking.idlePreview} onChange={(v) => setTracking({ idlePreview: v })} />
      </Row>
      {tracking.idleMode === 'mixed' && (
        <Row label="Surprise" hint="Skip the wait and play the next random bit now (only while idle)">
          <button className="btn small" disabled={trackingState !== 'idle'} onClick={() => setTracking({ idleBitRequest: tracking.idleBitRequest + 1 })}>
            <Sparkles size={13} /> Do something
          </button>
        </Row>
      )}
      {tracking.idleMode === 'dance' && clips.some((c) => c.enabled && c.status === 'ready') && (
        <Row label="Next dance" hint="Cross-fade to another clip now (only while idle)">
          <button className="btn small" disabled={trackingState !== 'idle'} onClick={() => setTracking({ idleBitRequest: tracking.idleBitRequest + 1 })}>
            <SkipForward size={13} /> Skip
          </button>
        </Row>
      )}
      {tracking.idleMode !== 'calm' && (
        <>
          <div className="subheading">
            Dance clips
            {danceClipName && <span className="muted"> - now playing: {danceClipName}</span>}
          </div>
          <div className="hint">
            Full-body motion-captured dances (Mixamo skeleton) retargeted onto the current character. Enabled clips are shuffled in
            Dance mode and used for the dance bursts in Calm + surprises. With every clip off, the built-in procedural groove plays.
            {' '}Add more: download any dance from <a href="https://www.mixamo.com" target="_blank" rel="noreferrer">Mixamo</a> as FBX,
            &quot;Without Skin&quot;, then drop the file on the window or import it here.
          </div>
          <div className="clip-list">
            {clips.map((c) => (
              <label key={c.entry.id} className={`clip-row ${c.status}`} title={c.error ?? c.entry.source ?? ''}>
                <input type="checkbox" checked={c.enabled} disabled={c.status !== 'ready'} onChange={(e) => toggleClip(c.entry.id, e.target.checked)} />
                <span className="clip-name">{c.entry.name}</span>
                <span className="clip-meta">
                  {c.status === 'loading' ? 'loading…' : c.status === 'error' ? 'failed' : `${c.duration?.toFixed(0)} s`}
                  {c.entry.uploaded ? ' · imported' : ''}
                </span>
                {c.entry.uploaded && (
                  <button className="btn tiny" title="Remove" onClick={(e) => { e.preventDefault(); clipLibrary.remove(c.entry.id); }}>
                    <X size={12} />
                  </button>
                )}
              </label>
            ))}
            {clips.length === 0 && <div className="muted">No clips found - run <code>npm run assets</code> or import one.</div>}
          </div>
          <button className="btn" onClick={() => clipRef.current?.click()}><Upload size={14} /> Import dance clip (.fbx / .glb)</button>
          <input
            ref={clipRef}
            type="file"
            accept=".fbx,.glb"
            multiple
            hidden
            onChange={(e) => {
              for (const f of Array.from(e.target.files ?? [])) void clipLibrary.importFile(f);
              e.target.value = '';
            }}
          />
        </>
      )}
      {!tracking.idleEnabled && (
        <Row label="Hold last pose" hint="With idle off: keep the last pose (on) or return to T-pose (off) when tracking is lost">
          <Toggle value={tracking.holdLastPose} onChange={(v) => setTracking({ holdLastPose: v })} />
        </Row>
      )}
    </Section>
  );
}
