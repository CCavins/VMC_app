import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStudio } from '../state/store';
import { frameSink } from '../vmc/useVmcBridge';
import { Retargeter } from '../vmc/retargetEngine';
import { clipLibrary } from '../vmc/clipLibrary';
import { loadCharacter, type LoadedCharacter } from './characterLoader';
import { liveCharacter } from './liveCharacter';

export function Character({ podiumTopY }: { podiumTopY: number }) {
  const scene = useThree((s) => s.scene);
  const characterId = useStudio((s) => s.characterId);
  const characters = useStudio((s) => s.characters);
  const setStatus = useStudio((s) => s.setCharacterStatus);
  const setInfo = useStudio((s) => s.setCharacterInfo);
  const showSkeleton = useStudio((s) => s.showSkeleton);
  const calibrateRequested = useStudio((s) => s.calibrateRequested);

  const [loaded, setLoaded] = useState<LoadedCharacter | null>(null);
  const retargeterRef = useRef<Retargeter | null>(null);
  const skeletonRef = useRef<THREE.SkeletonHelper | null>(null);

  // Load / swap character
  useEffect(() => {
    const entry = characters.find((c) => c.id === characterId);
    if (!entry) { setLoaded(null); return; }
    let cancelled = false;
    setStatus('loading');
    loadCharacter(entry.path, entry.format, entry.name, undefined, entry.height)
      .then((char) => {
        if (cancelled) { char.dispose(); return; }
        setLoaded(char);
        setStatus('ready');
      })
      .catch((e: Error) => {
        if (cancelled) return;
        console.error(e);
        setStatus('error', e.message);
        setLoaded(null);
      });
    return () => { cancelled = true; };
  }, [characterId, characters, setStatus]);

  // Attach to scene + build retargeter
  useEffect(() => {
    if (!loaded) {
      liveCharacter.current = null;
      liveCharacter.retargeter = null;
      retargeterRef.current = null;
      setInfo(null);
      return;
    }
    scene.add(loaded.root);
    const rt = new Retargeter(loaded);
    rt.podiumTopY = podiumTopY;
    retargeterRef.current = rt;
    liveCharacter.current = loaded;
    liveCharacter.retargeter = rt;
    setInfo({
      bones: loaded.boneCount,
      fingers: loaded.fingerCount,
      expressions: rt.expressions.expressionCount,
      format: loaded.format + (loaded.vrm ? ` (VRM ${loaded.vrm.meta?.metaVersion ?? '?'})` : ''),
      name: loaded.name,
      naturalHeight: loaded.naturalHeight,
      stageHeight: loaded.naturalHeight * loaded.baseScale,
    });
    // Place it on the podium right away.
    rt.apply(null, { ...useStudio.getState().tracking }, 1 / 60);

    return () => {
      scene.remove(loaded.root);
      if (skeletonRef.current) { scene.remove(skeletonRef.current); skeletonRef.current.dispose(); skeletonRef.current = null; }
      loaded.dispose();
      if (liveCharacter.current === loaded) { liveCharacter.current = null; liveCharacter.retargeter = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, scene]);

  useEffect(() => {
    if (retargeterRef.current) retargeterRef.current.podiumTopY = podiumTopY;
  }, [podiumTopY]);

  useEffect(() => {
    if (calibrateRequested > 0) retargeterRef.current?.calibrate();
  }, [calibrateRequested]);

  // Skeleton helper toggle
  useEffect(() => {
    if (!loaded) return;
    if (showSkeleton && !skeletonRef.current) {
      const helper = new THREE.SkeletonHelper(loaded.model);
      (helper.material as THREE.LineBasicMaterial).depthTest = false;
      (helper.material as THREE.LineBasicMaterial).transparent = true;
      helper.renderOrder = 999;
      scene.add(helper);
      skeletonRef.current = helper;
    } else if (!showSkeleton && skeletonRef.current) {
      scene.remove(skeletonRef.current);
      skeletonRef.current.dispose();
      skeletonRef.current = null;
    }
  }, [showSkeleton, loaded, scene]);

  // Drive the rig every render frame.
  useFrame((_, dt) => {
    const rt = retargeterRef.current;
    if (!rt || !loaded) return;
    const tracking = useStudio.getState().tracking;
    loaded.model.scale.setScalar(loaded.baseScale * tracking.scale);

    const frame = frameSink.latest;
    frameSink.latest = null;
    rt.dance.setClips(clipLibrary.sources());
    rt.apply(frame, tracking, dt);

    const st = useStudio.getState();
    if (st.trackingState !== rt.state) st.setTrackingState(rt.state);
    const clipName = rt.danceClipName;
    if (st.danceClipName !== clipName) st.setDanceClipName(clipName);

    loaded.vrm?.update(dt);
  });

  return null;
}
