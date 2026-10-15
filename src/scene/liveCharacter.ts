import type { Retargeter } from '../vmc/retargetEngine';
import type { LoadedCharacter } from './characterLoader';

/** Shared handle so the UI (calibrate, camera presets) can reach the live rig. */
export const liveCharacter: { current: LoadedCharacter | null; retargeter: Retargeter | null } = {
  current: null,
  retargeter: null,
};

if (import.meta.env.DEV) (window as unknown as { __live: typeof liveCharacter }).__live = liveCharacter;
