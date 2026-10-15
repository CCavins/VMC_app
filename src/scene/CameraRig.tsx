import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { useStudio, type CameraPreset } from '../state/store';
import { liveCharacter } from './liveCharacter';

/**
 * Orbit camera with named presets. Presets animate the camera to a framing
 * relative to the character's height and the podium top, then hand control back
 * to the user (except 'orbit' which keeps auto-rotating).
 */
export function CameraRig({ podiumTopY }: { podiumTopY: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const preset = useStudio((s) => s.cameraPreset);
  const setPreset = useStudio((s) => s.setCameraPreset);
  const camera = useThree((s) => s.camera);

  const anim = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null>(null);

  const framing = (p: CameraPreset) => {
    const h = liveCharacter.retargeter?.restHeight ?? 1.6;
    const base = podiumTopY;
    const target = new THREE.Vector3(0, base + h * 0.5, 0);
    const pos = new THREE.Vector3(0, base + h * 0.55, h * 1.9);
    switch (p) {
      case 'full':
      case 'orbit':
        target.set(0, base + h * 0.48, 0);
        pos.set(h * 0.9, base + h * 0.6, h * 1.75);
        break;
      case 'upper':
        target.set(0, base + h * 0.78, 0);
        pos.set(0.2, base + h * 0.85, h * 0.95);
        break;
      case 'face':
        target.set(0, base + h * 0.92, 0);
        pos.set(0.08, base + h * 0.95, h * 0.42);
        break;
      case 'hands':
        target.set(0, base + h * 0.58, 0.1);
        pos.set(0.1, base + h * 0.62, h * 0.8);
        break;
      default:
        return null;
    }
    return { pos, target };
  };

  useEffect(() => {
    const f = framing(preset);
    if (!f || !controls.current) return;
    anim.current = {
      fromPos: camera.position.clone(),
      toPos: f.pos,
      fromTarget: controls.current.target.clone(),
      toTarget: f.target,
      t: 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, podiumTopY]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt * 1.8);
      const e = 1 - Math.pow(1 - a.t, 3);
      camera.position.lerpVectors(a.fromPos, a.toPos, e);
      c.target.lerpVectors(a.fromTarget, a.toTarget, e);
      if (a.t >= 1) anim.current = null;
    }
    c.autoRotate = preset === 'orbit';
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotateSpeed={0.8}
      minDistance={0.25}
      maxDistance={12}
      maxPolarAngle={Math.PI * 0.52}
      onStart={() => { anim.current = null; if (preset !== 'free' && preset !== 'orbit') setPreset('free'); }}
    />
  );
}
