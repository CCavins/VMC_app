import { Canvas, useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { Stats } from '@react-three/drei';
import * as THREE from 'three';
import { useStudio } from '../state/store';
import { PodiumEnvironment } from './PodiumEnvironment';
import { Character } from './Character';
import { CameraRig } from './CameraRig';

/** Applies the exposure slider. VRM/MToon faces clip when this sits at 1 with a strong key light. */
function Exposure() {
  const exposure = useStudio((s) => s.env.exposure);
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    gl.toneMappingExposure = exposure ?? 0.85;
  }, [gl, exposure]);
  return null;
}

export function Studio() {
  const env = useStudio((s) => s.env);
  const showStats = useStudio((s) => s.showStats);
  // For custom stages, "podiumHeight" is the user-set standing height.
  const podiumTopY = env.podiumHeight;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [1.6, 1.4, 3.2], fov: 38, near: 0.05, far: 200 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.58 }}
      onCreated={({ gl }) => {
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <Exposure />
      <PodiumEnvironment />
      <Character podiumTopY={podiumTopY} />
      <CameraRig podiumTopY={podiumTopY} />
      {showStats && <Stats className="stats" />}
    </Canvas>
  );
}
