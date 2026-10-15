import { useEffect, useState } from 'react';
import { Studio } from './scene/Studio';
import { ControlPanel } from './components/ControlPanel';
import { TrackingStatus } from './components/TrackingStatus';
import { registerUploadedCharacter } from './state/uploads';
import { useStudio, type CharacterEntry, type HdriEntry, type TextureSetEntry } from './state/store';
import { useVmcBridge } from './vmc/useVmcBridge';
import { clipLibrary, type ClipEntry } from './vmc/clipLibrary';
import { looksLikeClipFile, parseModelFile } from './vmc/animationClips';
import { publicUrl } from './publicUrl';

interface ModelsManifest { characters: (Omit<CharacterEntry, 'format'> & { format: string; file: string })[] }
interface EnvManifest { hdris: HdriEntry[]; textures: TextureSetEntry[] }
interface AnimManifest { clips: (ClipEntry & { path: string })[] }

let dropCounter = 0;

/** Drop handler for .fbx / .glb: animation-only files become dance clips, the rest characters. */
async function importModelFile(f: File) {
  const st = useStudio.getState();
  const parsed = await parseModelFile(f).catch(() => null);
  if (parsed && looksLikeClipFile(parsed.root, parsed.animations)) {
    const id = `clip-drop-${++dropCounter}-${f.name}`;
    clipLibrary.addParsed(parsed, { id, name: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), uploaded: true });
    if (st.tracking.idleMode === 'calm') st.setTracking({ idleMode: 'mixed' });
    return;
  }
  const entry = registerUploadedCharacter(f);
  st.addCharacter(entry);
  st.selectCharacter(entry.id);
}

export default function App() {
  useVmcBridge();
  const setLibrary = useStudio((s) => s.setLibrary);
  const addCharacter = useStudio((s) => s.addCharacter);
  const selectCharacter = useStudio((s) => s.selectCharacter);
  const setEnv = useStudio((s) => s.setEnv);
  const statusPlacement = useStudio((s) => s.statusPlacement);
  const bridgeAvailable = useStudio((s) => s.bridgeAvailable);
  const [dragging, setDragging] = useState(false);

  // Load asset manifests produced by scripts/downloadAssets.mjs
  useEffect(() => {
    (async () => {
      try {
        const [models, envs, anims] = await Promise.all([
          fetch(publicUrl('/models/manifest.json')).then((r) => (r.ok ? (r.json() as Promise<ModelsManifest>) : { characters: [] })),
          fetch(publicUrl('/environments/manifest.json')).then((r) => (r.ok ? (r.json() as Promise<EnvManifest>) : { hdris: [], textures: [] })),
          fetch(publicUrl('/animations/manifest.json')).then((r) => (r.ok ? (r.json() as Promise<AnimManifest>) : { clips: [] })).catch(() => ({ clips: [] })),
        ]);
        const disabled = useStudio.getState().disabledDanceClips;
        for (const clip of anims.clips ?? []) clipLibrary.add({ ...clip, path: publicUrl(clip.path) }, !disabled.includes(clip.id));
        const characters: CharacterEntry[] = (models.characters ?? []).map((c) => ({
          ...c,
          path: publicUrl(c.path),
          format: (c.format === 'vrm' ? 'vrm' : c.format === 'fbx' ? 'fbx' : c.format === 'gltf' ? 'gltf' : 'glb'),
        }));
        const hdris = (envs.hdris ?? []).map((h) => ({ ...h, path: publicUrl(h.path) }));
        const textureSets = (envs.textures ?? []).map((t) => ({
          ...t,
          maps: Object.fromEntries(Object.entries(t.maps).map(([k, v]) => [k, publicUrl(v)])),
        }));
        setLibrary({ characters, hdris, textureSets });
        const st = useStudio.getState();
        const stillExists = characters.some((c) => c.id === st.characterId);
        if (!stillExists) {
          const first = characters.find((c) => c.format === 'vrm') ?? characters[0];
          if (first) selectCharacter(first.id);
        } else if (st.characterId) {
          selectCharacter(st.characterId); // trigger load
        }
        // Make sure the persisted HDRI still exists
        if (st.env.hdriId && !hdris.some((h) => h.id === st.env.hdriId)) setEnv({ hdriId: hdris[0]?.id ?? null });
      } catch (e) {
        console.warn('Asset manifests missing; run `npm run assets`.', e);
      }
    })();
  }, [setLibrary, selectCharacter, setEnv]);

  // Drag & drop characters / stages / HDRIs anywhere on the window.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragging(true); };
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setDragging(false); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const f of files) {
        const n = f.name.toLowerCase();
        if (/\.vrm$/.test(n)) {
          const entry = registerUploadedCharacter(f);
          addCharacter(entry);
          selectCharacter(entry.id);
        } else if (/\.(fbx|glb)$/.test(n)) {
          // Ambiguous: shift-drop = stage; animation-only files = dance clip; otherwise character.
          if (e.shiftKey && n.endsWith('.glb')) setEnv({ podiumStyle: 'custom', customStageUrl: URL.createObjectURL(f), showFloor: false });
          else void importModelFile(f);
        } else if (/\.gltf$/.test(n)) {
          if (e.shiftKey) setEnv({ podiumStyle: 'custom', customStageUrl: URL.createObjectURL(f), showFloor: false });
          else { const entry = registerUploadedCharacter(f); addCharacter(entry); selectCharacter(entry.id); }
        } else if (/\.hdr$/.test(n)) {
          const st = useStudio.getState();
          const id = `drop-hdri-${Date.now()}`;
          setLibrary({ hdris: [...st.hdris, { id, name: f.name, path: URL.createObjectURL(f) }] });
          setEnv({ hdriId: id, backdrop: 'hdri', hdriAsBackground: true });
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addCharacter, selectCharacter, setEnv, setLibrary]);

  return (
    <div className="app">
      <div className="viewport">
        <Studio />
        {statusPlacement === 'viewport' && <TrackingStatus variant="viewport" />}
        {bridgeAvailable === false && (
          <div className="static-banner">
            Hosted preview. Characters, dances and the podium work here. For live tracking, download the VMC Bridge from the Network panel and leave it running.
          </div>
        )}
      </div>
      <ControlPanel />
      {dragging && (
        <div className="drop-overlay">
          <div>Drop a character (.vrm / .glb / .fbx), a dance clip (Mixamo .fbx), an HDRI (.hdr), or hold Shift to drop a stage (.glb)</div>
        </div>
      )}
    </div>
  );
}