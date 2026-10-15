import { create } from 'zustand';
import type { BridgeConfig, BridgeTelemetry } from '../../shared/protocol';
import type { IdleMode } from '../../shared/idleAnimation';

export interface CharacterEntry {
  id: string;
  name: string;
  path: string;            // URL (or object URL for uploads)
  format: 'vrm' | 'glb' | 'gltf' | 'fbx';
  description?: string;
  license?: string;
  source?: string;
  rig?: string;
  hasBlendshapes?: boolean;
  uploaded?: boolean;
  /** Library grouping, e.g. 'animal'. Undefined = human. */
  category?: string;
  /** Desired standing height on stage in metres; overrides automatic fitting. */
  height?: number;
}

export interface HdriEntry { id: string; name: string; path: string; license?: string; source?: string; mood?: string }
export interface TextureSetEntry {
  id: string; name: string; license?: string; source?: string;
  maps: { diffuse?: string; normal?: string; roughness?: string };
}

export type PodiumStyle = 'cyber' | 'marble' | 'broadcast' | 'minimal' | 'custom';
export type BackdropStyle = 'hdri' | 'gradient' | 'solid' | 'none';
export type SurfaceId = string; // 'proc:<name>' or texture set id

export interface SurfaceSettings {
  textureId: SurfaceId;        // 'proc:default' uses the podium style's built-in material
  tint: string;                // hex color multiplied into the diffuse
  roughness: number;
  metalness: number;
  repeat: number;
}

export interface EnvironmentSettings {
  podiumStyle: PodiumStyle;
  podiumRadius: number;
  podiumHeight: number;
  podiumTop: SurfaceSettings;
  podiumSide: SurfaceSettings;
  floor: SurfaceSettings;
  showFloor: boolean;
  backdrop: BackdropStyle;
  hdriId: string | null;
  hdriAsBackground: boolean;
  hdriIntensity: number;
  backgroundColor: string;
  accentColor: string;
  keyLightIntensity: number;
  rimLightIntensity: number;
  spotlightIntensity: number;
  /** Renderer exposure. Lower it when a face looks blown out. */
  exposure: number;
  fog: boolean;
  particles: boolean;
  turntableSpeed: number;      // podium rotation (rad/s) 0 = off
  customStageUrl: string | null;
  customStageScale: number;
  customStageYOffset: number;
}

export interface TrackingSettings {
  /** 0 = pinned to podium centre, 1 = follow hips horizontally 1:1 */
  horizontalFollow: number;
  /** 0 = always grounded on podium, 1 = follow hips vertical motion 1:1 (jumps) */
  verticalFollow: number;
  footGrounding: boolean;
  floorOffset: number;         // extra Y offset in metres
  smoothing: number;           // 0 = none, 0.95 = very smooth
  mirror: boolean;
  applyFingers: boolean;
  applyFace: boolean;
  applyEyes: boolean;
  applyRootRotation: boolean;
  yawOffsetDeg: number;        // rotate whole character around Y
  scale: number;
  faceGain: number;
  holdLastPose: boolean;
  idleEnabled: boolean;
  idleDelaySec: number;
  idleEnergy: number;
  /** Force the idle animation on (preview). Not persisted. */
  idlePreview: boolean;
  idleMode: IdleMode;
  /** Counter bumped by the "surprise me" button. Not persisted. */
  idleBitRequest: number;
}

export type CameraPreset = 'full' | 'upper' | 'face' | 'hands' | 'orbit' | 'free';
/** 'sidebar' = top of the control panel, 'viewport' = pill over the 3D view, 'hidden' = nowhere. */
export type StatusPlacement = 'sidebar' | 'viewport' | 'hidden';

export interface StudioState {
  // library
  characters: CharacterEntry[];
  hdris: HdriEntry[];
  textureSets: TextureSetEntry[];
  // selection
  characterId: string | null;
  characterStatus: 'idle' | 'loading' | 'ready' | 'error';
  characterError: string | null;
  characterInfo: {
    bones: number; fingers: number; expressions: number; format: string; name: string;
    /** Height as authored in the file (file units) and after normalisation (metres). */
    naturalHeight: number; stageHeight: number;
  } | null;
  // settings
  tracking: TrackingSettings;
  env: EnvironmentSettings;
  cameraPreset: CameraPreset;
  showSkeleton: boolean;
  showStats: boolean;
  /** Where the tracking status indicator is shown. */
  statusPlacement: StatusPlacement;
  // bridge
  bridgeConfig: BridgeConfig | null;
  telemetry: BridgeTelemetry | null;
  wsConnected: boolean;
  /** False on static hosting (GitHub Pages), where the UDP bridge cannot run. */
  bridgeAvailable: boolean | null;
  frameFps: number;
  lastFrame: { bones: number; blends: number; at: number } | null;
  /** Live rig state reported by the retargeter. */
  trackingState: 'tracking' | 'waiting' | 'idle';
  setTrackingState: (s: 'tracking' | 'waiting' | 'idle') => void;
  /** Dance clip currently playing (idle dance / mixed dance bit), for the UI. */
  danceClipName: string | null;
  setDanceClipName: (n: string | null) => void;
  /** Ids of bundled dance clips the user switched off (persisted). */
  disabledDanceClips: string[];
  setDanceClipEnabled: (id: string, enabled: boolean) => void;
  // actions
  setLibrary: (p: Partial<Pick<StudioState, 'characters' | 'hdris' | 'textureSets'>>) => void;
  addCharacter: (c: CharacterEntry) => void;
  selectCharacter: (id: string | null) => void;
  setCharacterStatus: (s: StudioState['characterStatus'], err?: string | null) => void;
  setCharacterInfo: (i: StudioState['characterInfo']) => void;
  setTracking: (p: Partial<TrackingSettings>) => void;
  setEnv: (p: Partial<EnvironmentSettings>) => void;
  setSurface: (which: 'podiumTop' | 'podiumSide' | 'floor', p: Partial<SurfaceSettings>) => void;
  setCameraPreset: (p: CameraPreset) => void;
  setShowSkeleton: (v: boolean) => void;
  setShowStats: (v: boolean) => void;
  setStatusPlacement: (p: StatusPlacement) => void;
  setBridge: (p: Partial<Pick<StudioState, 'bridgeConfig' | 'telemetry' | 'wsConnected' | 'frameFps' | 'lastFrame' | 'bridgeAvailable'>>) => void;
  calibrateRequested: number;
  requestCalibrate: () => void;
}

const defaultSurface = (textureId: string, tint = '#ffffff', roughness = 0.5, metalness = 0.1, repeat = 1): SurfaceSettings => ({
  textureId, tint, roughness, metalness, repeat,
});

export const ENV_PRESETS: Record<Exclude<PodiumStyle, 'custom'>, EnvironmentSettings> = {
  cyber: {
    podiumStyle: 'cyber', podiumRadius: 0.9, podiumHeight: 0.35,
    podiumTop: defaultSurface('proc:default', '#15181f', 0.35, 0.7),
    podiumSide: defaultSurface('proc:default', '#0c0f16', 0.4, 0.8),
    floor: defaultSurface('proc:grid', '#05070b', 0.6, 0.2, 1),
    showFloor: true, backdrop: 'gradient', hdriId: 'moonless_golf', hdriAsBackground: false, hdriIntensity: 0.22,
    backgroundColor: '#05060a', accentColor: '#19e6ff', keyLightIntensity: 0.75, rimLightIntensity: 0.22, spotlightIntensity: 1.4, exposure: 0.58,
    fog: true, particles: true, turntableSpeed: 0, customStageUrl: null, customStageScale: 1, customStageYOffset: 0,
  },
  marble: {
    podiumStyle: 'marble', podiumRadius: 0.8, podiumHeight: 0.5,
    podiumTop: defaultSurface('marble_01', '#ffffff', 0.25, 0.0, 1),
    podiumSide: defaultSurface('marble_01', '#f2efe9', 0.3, 0.0, 2),
    floor: defaultSurface('wood_floor_deck', '#d8c7ad', 0.6, 0.0, 6),
    showFloor: true, backdrop: 'hdri', hdriId: 'brown_photostudio_02', hdriAsBackground: true, hdriIntensity: 0.45,
    backgroundColor: '#2a241f', accentColor: '#d4af37', keyLightIntensity: 0.9, rimLightIntensity: 0.3, spotlightIntensity: 1.5, exposure: 0.7,
    fog: false, particles: false, turntableSpeed: 0, customStageUrl: null, customStageScale: 1, customStageYOffset: 0,
  },
  broadcast: {
    podiumStyle: 'broadcast', podiumRadius: 1.1, podiumHeight: 0.18,
    podiumTop: defaultSurface('proc:default', '#2b2f36', 0.45, 0.3),
    podiumSide: defaultSurface('metal_plate', '#a8adb5', 0.5, 0.9, 3),
    floor: defaultSurface('concrete_floor_worn_001', '#8a8d92', 0.85, 0.05, 8),
    showFloor: true, backdrop: 'hdri', hdriId: 'studio_small_09', hdriAsBackground: false, hdriIntensity: 0.45,
    backgroundColor: '#1b1e24', accentColor: '#ff4d6d', keyLightIntensity: 1.0, rimLightIntensity: 0.4, spotlightIntensity: 2.5, exposure: 0.7,
    fog: false, particles: false, turntableSpeed: 0.15, customStageUrl: null, customStageScale: 1, customStageYOffset: 0,
  },
  minimal: {
    podiumStyle: 'minimal', podiumRadius: 0.75, podiumHeight: 0.08,
    podiumTop: defaultSurface('proc:default', '#f4f4f6', 0.7, 0.0),
    podiumSide: defaultSurface('proc:default', '#e3e4e8', 0.7, 0.0),
    floor: defaultSurface('proc:default', '#ffffff', 0.9, 0.0),
    showFloor: true, backdrop: 'solid', hdriId: 'studio_small_09', hdriAsBackground: false, hdriIntensity: 0.55,
    backgroundColor: '#f6f6f8', accentColor: '#222222', keyLightIntensity: 1.15, rimLightIntensity: 0.25, spotlightIntensity: 0, exposure: 0.85,
    fog: false, particles: false, turntableSpeed: 0, customStageUrl: null, customStageScale: 1, customStageYOffset: 0,
  },
};

export const DEFAULT_TRACKING: TrackingSettings = {
  horizontalFollow: 0,
  verticalFollow: 0,
  footGrounding: true,
  floorOffset: 0,
  smoothing: 0.35,
  mirror: false,
  applyFingers: true,
  applyFace: true,
  applyEyes: true,
  applyRootRotation: true,
  yawOffsetDeg: 0,
  scale: 1,
  faceGain: 1,
  holdLastPose: true,
  idleEnabled: true,
  idleDelaySec: 3,
  idleEnergy: 1,
  idlePreview: false,
  idleMode: 'mixed',
  idleBitRequest: 0,
};

const LS_KEY = 'vmc-studio-settings-v1';

/** Previous preset light levels, which washed out VRM faces. Adopt the current preset when untouched. */
const LEGACY_LIGHTS: Record<string, { key: number; rim: number; spot: number }[]> = {
  cyber: [{ key: 2.5, rim: 4, spot: 25 }, { key: 1.15, rim: 0.45, spot: 3 }],
  marble: [{ key: 2, rim: 1, spot: 6 }, { key: 1.3, rim: 0.45, spot: 2.5 }],
  broadcast: [{ key: 3, rim: 2.5, spot: 15 }, { key: 1.6, rim: 0.9, spot: 5 }],
  minimal: [{ key: 2.5, rim: 0.5, spot: 0 }, { key: 1.7, rim: 0.35, spot: 0 }],
};

function migrateEnv(saved: Partial<EnvironmentSettings> | undefined): EnvironmentSettings {
  const style = saved?.podiumStyle && saved.podiumStyle !== 'custom' ? saved.podiumStyle : 'cyber';
  const preset = ENV_PRESETS[style];
  const env: EnvironmentSettings = { ...preset, ...(saved ?? {}) };
  const legacy = LEGACY_LIGHTS[style]?.some((l) => saved?.keyLightIntensity === l.key && saved.rimLightIntensity === l.rim && saved.spotlightIntensity === l.spot);
  if (legacy) {
    env.keyLightIntensity = preset.keyLightIntensity;
    env.rimLightIntensity = preset.rimLightIntensity;
    env.spotlightIntensity = preset.spotlightIntensity;
    env.hdriIntensity = preset.hdriIntensity;
    env.exposure = preset.exposure;
  }
  if (typeof env.exposure !== 'number') env.exposure = preset.exposure;
  return env;
}

function loadPersisted(): Partial<Pick<StudioState, 'tracking' | 'env' | 'characterId' | 'statusPlacement' | 'disabledDanceClips'>> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const placement = parsed.statusPlacement;
    return {
      tracking: { ...DEFAULT_TRACKING, ...(parsed.tracking ?? {}), idlePreview: false, idleBitRequest: 0 },
      env: migrateEnv(parsed.env),
      characterId: parsed.characterId ?? null,
      statusPlacement: placement === 'viewport' || placement === 'hidden' ? placement : 'sidebar',
      disabledDanceClips: Array.isArray(parsed.disabledDanceClips) ? parsed.disabledDanceClips.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return {};
  }
}

export const useStudio = create<StudioState>((set, get) => {
  const persisted = loadPersisted();
  return {
    characters: [], hdris: [], textureSets: [],
    characterId: persisted.characterId ?? null,
    characterStatus: 'idle', characterError: null, characterInfo: null,
    tracking: persisted.tracking ?? DEFAULT_TRACKING,
    env: persisted.env ?? ENV_PRESETS.cyber,
    cameraPreset: 'full',
    showSkeleton: false,
    showStats: false,
    statusPlacement: persisted.statusPlacement ?? 'sidebar',
    bridgeConfig: null, telemetry: null, wsConnected: false, bridgeAvailable: null, frameFps: 0, lastFrame: null,
    trackingState: 'waiting',
    setTrackingState: (trackingState) => set({ trackingState }),
    danceClipName: null,
    setDanceClipName: (danceClipName) => set({ danceClipName }),
    disabledDanceClips: persisted.disabledDanceClips ?? [],
    setDanceClipEnabled: (id, enabled) => set((s) => ({
      disabledDanceClips: enabled ? s.disabledDanceClips.filter((x) => x !== id) : [...new Set([...s.disabledDanceClips, id])],
    })),
    calibrateRequested: 0,

    setLibrary: (p) => set(p),
    addCharacter: (c) => set((s) => ({ characters: [...s.characters.filter((x) => x.id !== c.id), c] })),
    selectCharacter: (id) => set({ characterId: id, characterStatus: id ? 'loading' : 'idle', characterError: null, characterInfo: null }),
    setCharacterStatus: (characterStatus, err = null) => set({ characterStatus, characterError: err }),
    setCharacterInfo: (characterInfo) => set({ characterInfo }),
    setTracking: (p) => set((s) => ({ tracking: { ...s.tracking, ...p } })),
    setEnv: (p) => set((s) => ({ env: { ...s.env, ...p } })),
    setSurface: (which, p) => set((s) => ({ env: { ...s.env, [which]: { ...s.env[which], ...p } } })),
    setCameraPreset: (cameraPreset) => set({ cameraPreset }),
    setShowSkeleton: (showSkeleton) => set({ showSkeleton }),
    setShowStats: (showStats) => set({ showStats }),
    setStatusPlacement: (statusPlacement) => set({ statusPlacement }),
    setBridge: (p) => set(p),
    requestCalibrate: () => set({ calibrateRequested: get().calibrateRequested + 1 }),
  };
});

// Dev convenience: poke at the store from the browser console (`__studio.getState()`).
if (import.meta.env.DEV) (window as unknown as { __studio: typeof useStudio }).__studio = useStudio;

// Persist a subset of settings.
let persistTimer: number | null = null;
useStudio.subscribe((s) => {
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      const chosen = s.characters.find((c) => c.id === s.characterId);
      localStorage.setItem(LS_KEY, JSON.stringify({
        tracking: s.tracking,
        env: { ...s.env, customStageUrl: s.env.customStageUrl?.startsWith('blob:') ? null : s.env.customStageUrl },
        characterId: chosen?.uploaded ? null : s.characterId,
        statusPlacement: s.statusPlacement,
        disabledDanceClips: s.disabledDanceClips,
      }));
    } catch { /* ignore quota errors */ }
  }, 300);
});
