/**
 * Swappable stage: podium geometry per style, re-skinnable surfaces, HDRI /
 * gradient / solid backdrops, lighting rig, and an optional user-imported GLB stage.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useStudio, type EnvironmentSettings, type SurfaceSettings, type TextureSetEntry } from '../state/store';
import { useSurfaceMaterialProps } from './materials';
import { computeWorldBox } from '../vmc/retargetEngine';

// ----------------------------------------------------------------------------

function SurfaceMaterial({ surface, textureSets, accent, fallbackColor, side }: {
  surface: SurfaceSettings; textureSets: TextureSetEntry[]; accent: string; fallbackColor?: string; side?: THREE.Side;
}) {
  const props = useSurfaceMaterialProps(surface, textureSets, accent, fallbackColor);
  return <meshStandardMaterial {...props} side={side ?? THREE.FrontSide} />;
}

// ----------------------------------------------------------------------------
// Podium geometries
// ----------------------------------------------------------------------------

function CyberPodium({ env, textureSets }: { env: EnvironmentSettings; textureSets: TextureSetEntry[] }) {
  const r = env.podiumRadius, h = env.podiumHeight;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r, r * 1.04, h, 64, 1, false]} />
        <SurfaceMaterial surface={env.podiumSide} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r, 64]} />
        <SurfaceMaterial surface={env.podiumTop} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      {/* glowing edge rings */}
      <mesh position={[0, h + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.96, r * 1.0, 96]} />
        <meshBasicMaterial color={env.accentColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 1.08, r * 1.12, 96]} />
        <meshBasicMaterial color={env.accentColor} toneMapped={false} transparent opacity={0.6} />
      </mesh>
      {/* under-glow */}
      <pointLight position={[0, 0.05, 0]} color={env.accentColor} intensity={3} distance={3} decay={2} />
    </group>
  );
}

function MarblePodium({ env, textureSets }: { env: EnvironmentSettings; textureSets: TextureSetEntry[] }) {
  const r = env.podiumRadius, h = env.podiumHeight;
  const baseH = Math.min(0.12, h * 0.3);
  const capH = Math.min(0.08, h * 0.2);
  const shaftH = Math.max(0.02, h - baseH - capH);
  return (
    <group>
      <mesh position={[0, baseH / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r * 1.15, r * 1.22, baseH, 12]} />
        <SurfaceMaterial surface={env.podiumSide} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, baseH + shaftH / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r * 0.92, r, shaftH, 24]} />
        <SurfaceMaterial surface={env.podiumSide} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, baseH + shaftH + capH / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r * 1.05, r * 0.95, capH, 12]} />
        <SurfaceMaterial surface={env.podiumTop} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r * 1.05, 64]} />
        <SurfaceMaterial surface={env.podiumTop} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      {/* gold trim: a flat band around the cap edge (torus lies in XY by default, so lay it down) */}
      <mesh position={[0, baseH + shaftH + capH - 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r * 1.05, 0.008, 12, 96]} />
        <meshStandardMaterial color={env.accentColor} metalness={1} roughness={0.25} />
      </mesh>
    </group>
  );
}

function BroadcastPodium({ env, textureSets }: { env: EnvironmentSettings; textureSets: TextureSetEntry[] }) {
  const r = env.podiumRadius, h = env.podiumHeight;
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (groupRef.current && env.turntableSpeed) groupRef.current.rotation.y += env.turntableSpeed * dt;
  });
  return (
    <group ref={groupRef}>
      <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r, r, h, 96]} />
        <SurfaceMaterial surface={env.podiumSide} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r, 96]} />
        <SurfaceMaterial surface={env.podiumTop} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      {/* LED trim strip: horizontal band around the drum */}
      <mesh position={[0, h * 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[r + 0.005, 0.012, 8, 128]} />
        <meshBasicMaterial color={env.accentColor} toneMapped={false} />
      </mesh>
      {/* top markings */}
      <mesh position={[0, h + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.3, r * 0.31, 64]} />
        <meshBasicMaterial color={'#ffffff'} transparent opacity={0.25} />
      </mesh>
      <mesh position={[0, h + 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.9, r * 0.92, 96]} />
        <meshBasicMaterial color={env.accentColor} transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function MinimalPodium({ env, textureSets }: { env: EnvironmentSettings; textureSets: TextureSetEntry[] }) {
  const r = env.podiumRadius, h = env.podiumHeight;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[r, r, h, 96]} />
        <SurfaceMaterial surface={env.podiumSide} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
      <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[r, 96]} />
        <SurfaceMaterial surface={env.podiumTop} textureSets={textureSets} accent={env.accentColor} />
      </mesh>
    </group>
  );
}

/** User-imported stage GLB. Lowest point is placed on Y = 0 + yOffset. */
function CustomStage({ url, scale, yOffset }: { url: string; scale: number; yOffset: number }) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.loadAsync(url).then((gltf) => {
      if (cancelled) return;
      const scene = gltf.scene;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; }
      });
      setObj(scene);
    }).catch((e) => console.error('Stage load failed', e));
    return () => { cancelled = true; };
  }, [url]);

  const wrapper = useMemo(() => new THREE.Group(), []);
  useEffect(() => {
    if (!obj) return;
    wrapper.clear();
    wrapper.add(obj);
    obj.scale.setScalar(scale);
    const box = computeWorldBox(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.set(-center.x, -box.min.y + yOffset, -center.z);
  }, [obj, scale, yOffset, wrapper]);

  return <primitive object={wrapper} />;
}

// ----------------------------------------------------------------------------
// Backdrop
// ----------------------------------------------------------------------------

function GradientDome({ color, accent }: { color: string; accent: string }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { top: { value: new THREE.Color(color).lerp(new THREE.Color(accent), 0.18) }, bottom: { value: new THREE.Color(color) } },
    vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos; void main(){ float t = clamp(vPos.y / 40.0 + 0.5, 0.0, 1.0); t = smoothstep(0.0,1.0,t); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
  }), []);
  useEffect(() => {
    mat.uniforms.top.value = new THREE.Color(color).lerp(new THREE.Color(accent), 0.18);
    mat.uniforms.bottom.value = new THREE.Color(color);
  }, [color, accent, mat]);
  return (
    <mesh material={mat} renderOrder={-10}>
      <sphereGeometry args={[60, 32, 16]} />
    </mesh>
  );
}

function SceneBackground({ env }: { env: EnvironmentSettings }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (env.backdrop === 'solid' || env.backdrop === 'gradient' || env.backdrop === 'none' || !env.hdriAsBackground) {
      scene.background = new THREE.Color(env.backgroundColor);
    }
    if (env.fog) scene.fog = new THREE.FogExp2(env.backgroundColor, env.backdrop === 'hdri' && env.hdriAsBackground ? 0.02 : 0.06);
    else scene.fog = null;
    return () => { scene.fog = null; };
  }, [scene, env.backdrop, env.backgroundColor, env.fog, env.hdriAsBackground]);
  return null;
}

// ----------------------------------------------------------------------------

export function PodiumEnvironment() {
  const env = useStudio((s) => s.env);
  const textureSets = useStudio((s) => s.textureSets);
  const hdris = useStudio((s) => s.hdris);
  const hdri = hdris.find((h) => h.id === env.hdriId) ?? null;
  const useHdriBackground = env.backdrop === 'hdri' && env.hdriAsBackground && !!hdri;

  return (
    <group>
      <SceneBackground env={env} />

      {/* Image-based lighting (always on when an HDRI exists; it is the nicest fill light) */}
      {hdri && (
        <Suspense fallback={null}>
          <Environment
            files={hdri.path}
            background={useHdriBackground}
            backgroundBlurriness={0.25}
            environmentIntensity={env.hdriIntensity}
            backgroundIntensity={env.hdriIntensity}
          />
        </Suspense>
      )}
      {env.backdrop === 'gradient' && <GradientDome color={env.backgroundColor} accent={env.accentColor} />}

      {/* Lighting rig */}
      <hemisphereLight intensity={hdri ? 0.15 : 0.6} color={'#ffffff'} groundColor={env.backgroundColor} />
      <directionalLight
        position={[2.5, 4.5, 3]}
        intensity={env.keyLightIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={15}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={4}
        shadow-camera-bottom={-1}
      />
      <directionalLight position={[-3, 3, -3]} intensity={env.rimLightIntensity} color={env.accentColor} />
      {env.spotlightIntensity > 0 && (
        <spotLight
          position={[0, 4.5, 0.6]}
          angle={0.55}
          penumbra={0.6}
          intensity={env.spotlightIntensity}
          color={'#ffffff'}
          castShadow={false}
          decay={1.2}
        />
      )}

      {/* Floor */}
      {env.showFloor && env.podiumStyle !== 'custom' && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]} receiveShadow>
            <circleGeometry args={[40, 64]} />
            <SurfaceMaterial surface={env.floor} textureSets={textureSets} accent={env.accentColor} />
          </mesh>
          {env.podiumStyle === 'cyber' && (
            <Grid
              position={[0, 0.002, 0]}
              args={[40, 40]}
              cellSize={0.5}
              cellThickness={0.6}
              cellColor={new THREE.Color(env.accentColor).multiplyScalar(0.25)}
              sectionSize={2.5}
              sectionThickness={1.2}
              sectionColor={env.accentColor}
              fadeDistance={22}
              fadeStrength={1.5}
              infiniteGrid
            />
          )}
        </>
      )}

      {/* Podium */}
      {env.podiumStyle === 'cyber' && <CyberPodium env={env} textureSets={textureSets} />}
      {env.podiumStyle === 'marble' && <MarblePodium env={env} textureSets={textureSets} />}
      {env.podiumStyle === 'broadcast' && <BroadcastPodium env={env} textureSets={textureSets} />}
      {env.podiumStyle === 'minimal' && <MinimalPodium env={env} textureSets={textureSets} />}
      {env.podiumStyle === 'custom' && env.customStageUrl && (
        <CustomStage url={env.customStageUrl} scale={env.customStageScale} yOffset={env.customStageYOffset} />
      )}
      {env.podiumStyle === 'custom' && !env.customStageUrl && (
        <mesh position={[0, env.podiumHeight / 2, 0]} receiveShadow>
          <cylinderGeometry args={[env.podiumRadius, env.podiumRadius, Math.max(0.01, env.podiumHeight), 48]} />
          <meshStandardMaterial color={'#555a66'} wireframe />
        </mesh>
      )}

      {env.particles && (
        // Ambient particles live in a ring of volumes around the stage, never in the
        // column above the podium, so nothing drifts across the character.
        <>
          <Sparkles count={40} scale={[6, 3, 1.5]} position={[0, 1.6, -3.5]} size={2.5} speed={0.25} color={env.accentColor} opacity={0.6} />
          <Sparkles count={30} scale={[1.5, 3, 5]} position={[-3.5, 1.6, 0]} size={2.5} speed={0.25} color={env.accentColor} opacity={0.6} />
          <Sparkles count={30} scale={[1.5, 3, 5]} position={[3.5, 1.6, 0]} size={2.5} speed={0.25} color={env.accentColor} opacity={0.6} />
        </>
      )}
    </group>
  );
}
