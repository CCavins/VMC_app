import { ENV_PRESETS, type PodiumStyle } from '../state/store';

export interface PodiumStyleMeta {
  id: PodiumStyle;
  name: string;
  description: string;
}

export const PODIUM_STYLES: PodiumStyleMeta[] = [
  { id: 'cyber', name: 'Cyber Neon Stage', description: 'Dark grid floor, glowing accent rings, light fog and floating particles.' },
  { id: 'marble', name: 'Classical Pedestal', description: 'Stepped marble pedestal on a wooden floor lit by a warm photo studio.' },
  { id: 'broadcast', name: 'Broadcast Turntable', description: 'Wide low turntable with LED trim and a soft studio HDRI.' },
  { id: 'minimal', name: 'Minimal Void', description: 'Thin white disc in an evenly lit white void - great for checking the rig.' },
  { id: 'custom', name: 'Custom Stage (GLB)', description: 'Import your own stage model; set the podium top height so the character stands on it.' },
];

/** Procedural surface options always available in addition to downloaded texture sets. */
export const PROCEDURAL_SURFACES = [
  { id: 'proc:default', name: 'Style default' },
  { id: 'proc:grid', name: 'Emissive grid' },
  { id: 'proc:carbon', name: 'Carbon fiber' },
  { id: 'proc:brushed', name: 'Brushed metal' },
];

export { ENV_PRESETS };
