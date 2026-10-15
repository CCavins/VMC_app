/**
 * Surface material helpers: loads PBR texture sets (diffuse/normal/roughness) with
 * caching, and generates a few procedural textures (grid, carbon fiber, brushed
 * metal) so the podium/floor can be re-skinned without downloads.
 */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { SurfaceSettings, TextureSetEntry } from '../state/store';

const textureCache = new Map<string, Promise<THREE.Texture>>();
const loader = new THREE.TextureLoader();

function loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
  const key = `${url}|${srgb}`;
  let p = textureCache.get(key);
  if (!p) {
    p = loader.loadAsync(url).then((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    });
    textureCache.set(key, p);
  }
  return p;
}

// ------------------------------- procedural ---------------------------------

const procCache = new Map<string, THREE.Texture>();

function canvasTexture(id: string, draw: (ctx: CanvasRenderingContext2D, size: number) => void, size = 512, srgb = true) {
  const key = `${id}|${srgb}`;
  const cached = procCache.get(key);
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  procCache.set(key, t);
  return t;
}

export function gridTexture(accent: string) {
  return canvasTexture(`grid:${accent}`, (ctx, s) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo((s / 4) * i, 0); ctx.lineTo((s / 4) * i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (s / 4) * i); ctx.lineTo(s, (s / 4) * i); ctx.stroke();
    }
  });
}

export function carbonTexture() {
  return canvasTexture('carbon', (ctx, s) => {
    const cell = s / 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const horizontal = (x + y) % 2 === 0;
      const grad = horizontal
        ? ctx.createLinearGradient(x * cell, 0, (x + 1) * cell, 0)
        : ctx.createLinearGradient(0, y * cell, 0, (y + 1) * cell);
      grad.addColorStop(0, '#1a1c20'); grad.addColorStop(0.5, '#3a3d44'); grad.addColorStop(1, '#1a1c20');
      ctx.fillStyle = grad;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  });
}

export function brushedTexture() {
  return canvasTexture('brushed', (ctx, s) => {
    ctx.fillStyle = '#9a9ea6';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 4000; i++) {
      const y = Math.random() * s;
      const len = 20 + Math.random() * 200;
      const x = Math.random() * s;
      ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${0.02 + Math.random() * 0.05})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
    }
  });
}

export function brushedRoughness() {
  return canvasTexture('brushed-rough', (ctx, s) => {
    ctx.fillStyle = '#505050';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 3000; i++) {
      const y = Math.random() * s;
      ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
    }
  }, 512, false);
}

// ----------------------------- hook / material ------------------------------

export interface SurfaceMaps {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  emissiveMap?: THREE.Texture;
}

export function useSurfaceMaps(surface: SurfaceSettings, textureSets: TextureSetEntry[], accent: string): SurfaceMaps {
  const [maps, setMaps] = useState<SurfaceMaps>({});
  const set = textureSets.find((t) => t.id === surface.textureId);

  useEffect(() => {
    let cancelled = false;
    const id = surface.textureId;
    if (id === 'proc:grid') { setMaps({ map: gridTexture('#202020'), emissiveMap: gridTexture(accent) }); return; }
    if (id === 'proc:carbon') { setMaps({ map: carbonTexture() }); return; }
    if (id === 'proc:brushed') { setMaps({ map: brushedTexture(), roughnessMap: brushedRoughness() }); return; }
    if (!set) { setMaps({}); return; }
    Promise.all([
      set.maps.diffuse ? loadTexture(set.maps.diffuse, true) : Promise.resolve(undefined),
      set.maps.normal ? loadTexture(set.maps.normal, false) : Promise.resolve(undefined),
      set.maps.roughness ? loadTexture(set.maps.roughness, false) : Promise.resolve(undefined),
    ]).then(([map, normalMap, roughnessMap]) => {
      if (!cancelled) setMaps({ map, normalMap, roughnessMap });
    }).catch(() => { if (!cancelled) setMaps({}); });
    return () => { cancelled = true; };
  }, [surface.textureId, set, accent]);

  // Apply repeat without cloning textures (shared across meshes is fine here).
  useEffect(() => {
    for (const t of Object.values(maps)) if (t) t.repeat.set(surface.repeat, surface.repeat);
  }, [maps, surface.repeat]);

  return maps;
}

/** Build props for a <meshStandardMaterial>. */
export function useSurfaceMaterialProps(surface: SurfaceSettings, textureSets: TextureSetEntry[], accent: string, fallbackColor?: string) {
  const maps = useSurfaceMaps(surface, textureSets, accent);
  return useMemo(() => {
    const isGrid = surface.textureId === 'proc:grid';
    return {
      color: maps.map ? surface.tint : fallbackColor ?? surface.tint,
      map: maps.map ?? null,
      normalMap: maps.normalMap ?? null,
      roughnessMap: maps.roughnessMap ?? null,
      roughness: surface.roughness,
      metalness: surface.metalness,
      emissive: isGrid ? accent : '#000000',
      emissiveMap: maps.emissiveMap ?? null,
      emissiveIntensity: isGrid ? 1.2 : 0,
    };
  }, [maps, surface, accent, fallbackColor]);
}
