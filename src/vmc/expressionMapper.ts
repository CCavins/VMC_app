/**
 * Maps the 52 ARKit blendshapes (as delivered by VMC /VMC/Ext/Blend/Val) onto a
 * character's facial controls:
 *
 *  - If the model exposes ARKit-named morph targets / VRM custom expressions
 *    (Ready Player Me, VRM with "perfect sync" shapes), values are applied 1:1.
 *  - Otherwise the ARKit set is reduced to the standard VRM presets:
 *    blink(Left/Right), aa, ih, ou, ee, oh, happy, angry, sad, surprised,
 *    (and VRM 0.x names: blink_l, blink_r, a, i, u, e, o, joy, angry, sorrow, fun).
 */
import * as THREE from 'three';
import type { VRM } from '@pixiv/three-vrm';

type Blends = Record<string, number>;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Blends are normalized to lowercase keys before lookup. */
function g(b: Blends, name: string): number {
  return b[name.toLowerCase()] ?? 0;
}

function mirroredName(name: string): string {
  if (name.endsWith('Left')) return name.slice(0, -4) + 'Right';
  if (name.endsWith('Right')) return name.slice(0, -5) + 'Left';
  return name;
}

/** Derive VRM 1.0 preset expression weights from ARKit blendshapes. */
export function arkitToVrmPresets(b: Blends): Record<string, number> {
  const jaw = g(b, 'jawOpen');
  const pucker = g(b, 'mouthPucker');
  const funnel = g(b, 'mouthFunnel');
  const smile = (g(b, 'mouthSmileLeft') + g(b, 'mouthSmileRight')) / 2;
  const frown = (g(b, 'mouthFrownLeft') + g(b, 'mouthFrownRight')) / 2;
  const stretch = (g(b, 'mouthStretchLeft') + g(b, 'mouthStretchRight')) / 2;
  const press = (g(b, 'mouthPressLeft') + g(b, 'mouthPressRight')) / 2;
  const browDown = (g(b, 'browDownLeft') + g(b, 'browDownRight')) / 2;
  const browUp = g(b, 'browInnerUp');
  const eyeWide = (g(b, 'eyeWideLeft') + g(b, 'eyeWideRight')) / 2;
  const squint = (g(b, 'eyeSquintLeft') + g(b, 'eyeSquintRight')) / 2;
  const closeMouth = g(b, 'mouthClose');

  const open = clamp01(jaw - closeMouth * 0.8);
  const rounded = clamp01(Math.max(pucker, funnel));

  // Vowel decomposition (rough but perceptually reasonable):
  const ou = clamp01(rounded * (1 - open * 0.4));                    // "u" - lips rounded, small opening
  const oh = clamp01(open * funnel * 1.6);                           // "o" - open + funnel
  const aa = clamp01(open * (1 - rounded) * 1.2);                    // "a" - open, unrounded
  const ee = clamp01((stretch * 0.7 + smile * 0.5) * (1 - open) * 0.9 + open * smile * 0.3); // "e" - wide
  const ih = clamp01(open * (smile + stretch) * 0.5 * (1 - rounded)); // "i" - open-ish and wide

  const happy = clamp01(smile * (1 - open * 0.3) * 1.1 + squint * 0.15);
  const angry = clamp01(browDown * 0.9 + press * 0.2);
  const sad = clamp01(frown * 1.1 + (browUp * 0.3) * frown);
  const surprised = clamp01(browUp * 0.7 * (0.4 + eyeWide * 0.6) + eyeWide * jaw * 0.4);

  const blinkL = clamp01(g(b, 'eyeBlinkLeft') * 1.1);
  const blinkR = clamp01(g(b, 'eyeBlinkRight') * 1.1);

  return {
    blinkLeft: blinkL, blinkRight: blinkR, blink: Math.min(blinkL, blinkR),
    aa, ih, ou, ee, oh,
    happy, angry, sad, surprised,
    relaxed: clamp01(squint * 0.5 * (1 - open)),
    neutral: 0,
  };
}

/** VRM 0.x preset names for the same concepts. */
const V0_ALIASES: Record<string, string[]> = {
  blinkLeft: ['blink_l', 'blinkLeft', 'Blink_L'], blinkRight: ['blink_r', 'blinkRight', 'Blink_R'], blink: ['blink', 'Blink'],
  aa: ['a', 'A'], ih: ['i', 'I'], ou: ['u', 'U'], ee: ['e', 'E'], oh: ['o', 'O'],
  happy: ['joy', 'Joy', 'fun', 'Fun'], angry: ['angry', 'Angry'], sad: ['sorrow', 'Sorrow'], surprised: ['surprised', 'Surprised'],
  relaxed: ['relaxed'],
};

export class ExpressionMapper {
  private vrm?: VRM;
  private morphMeshes: { mesh: THREE.Mesh; dict: Record<string, number> }[] = [];
  /** ARKit name (lowercase) -> list of (mesh, morph index) */
  private directMorphs = new Map<string, { mesh: THREE.Mesh; index: number }[]>();
  /** ARKit name (lowercase) -> VRM expression name */
  private directVrm = new Map<string, string>();
  private availableVrm = new Set<string>();
  readonly hasDirectArkit: boolean;
  readonly expressionCount: number;

  constructor(model: THREE.Object3D, vrm?: VRM) {
    this.vrm = vrm;

    if (vrm?.expressionManager) {
      const em = vrm.expressionManager;
      for (const e of em.expressions) this.availableVrm.add(e.expressionName);
      // Custom expressions named like ARKit shapes -> drive directly ("perfect sync")
      for (const name of Object.keys(em.customExpressionMap)) {
        const lower = name.toLowerCase();
        if (ARKIT_LOWER.has(lower)) this.directVrm.set(lower, name);
      }
    }

    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      const dict = mesh.morphTargetDictionary;
      this.morphMeshes.push({ mesh, dict });
      for (const [name, index] of Object.entries(dict)) {
        const lower = name.toLowerCase();
        if (!ARKIT_LOWER.has(lower)) continue;
        if (!this.directMorphs.has(lower)) this.directMorphs.set(lower, []);
        this.directMorphs.get(lower)!.push({ mesh, index });
      }
    });

    // Only treat as "direct" if a meaningful number of ARKit shapes exist (avoid
    // VRM models with a stray "jawOpen" custom clip hijacking the whole face).
    this.hasDirectArkit = this.directVrm.size >= 20 || (!vrm && this.directMorphs.size >= 20);
    this.expressionCount = this.availableVrm.size || this.directMorphs.size;
  }

  reset() {
    if (this.vrm?.expressionManager) {
      for (const name of this.availableVrm) this.vrm.expressionManager.setValue(name, 0);
    }
    for (const { mesh } of this.morphMeshes) mesh.morphTargetInfluences?.fill(0);
  }

  apply(blends: Blends, gain = 1, mirror = false) {
    const src: Blends = {};
    for (const [k, v] of Object.entries(blends)) src[(mirror ? mirroredName(k) : k).toLowerCase()] = v;

    if (this.hasDirectArkit) {
      if (this.vrm?.expressionManager) {
        const em = this.vrm.expressionManager;
        for (const [lower, name] of this.directVrm) em.setValue(name, clamp01(g(src, lower) * gain));
      } else {
        for (const [lower, targets] of this.directMorphs) {
          const v = clamp01(g(src, lower) * gain);
          for (const { mesh, index } of targets) mesh.morphTargetInfluences![index] = v;
        }
      }
      return;
    }

    const presets = arkitToVrmPresets(src);
    if (this.vrm?.expressionManager) {
      const em = this.vrm.expressionManager;
      const hasLR = this.availableVrm.has('blinkLeft') || this.availableVrm.has('blink_l');
      for (const [preset, value] of Object.entries(presets)) {
        if (preset === 'blink' && hasLR) continue; // prefer per-eye blink
        if ((preset === 'blinkLeft' || preset === 'blinkRight') && !hasLR) continue;
        const v = clamp01(value * gain);
        if (this.availableVrm.has(preset)) { em.setValue(preset, v); continue; }
        for (const alias of V0_ALIASES[preset] ?? []) {
          if (this.availableVrm.has(alias)) { em.setValue(alias, v); break; }
        }
      }
      return;
    }

    // Non-VRM GLB with generic morph names (e.g. "viseme_aa", "mouthOpen", "blink")
    for (const { mesh, dict } of this.morphMeshes) {
      const inf = mesh.morphTargetInfluences!;
      for (const [name, index] of Object.entries(dict)) {
        const lower = name.toLowerCase();
        let v: number | undefined;
        if (/^(blink|eyesclosed|eyeclosed)$/.test(lower)) v = presets.blink;
        else if (/blink.*(l|left)$/.test(lower)) v = presets.blinkLeft;
        else if (/blink.*(r|right)$/.test(lower)) v = presets.blinkRight;
        else if (/mouthopen|jawopen|viseme_aa|^aa?$/.test(lower)) v = presets.aa;
        else if (/viseme_o|^oh?$/.test(lower)) v = presets.oh;
        else if (/viseme_u|^ou?$/.test(lower)) v = presets.ou;
        else if (/viseme_e|^ee?$/.test(lower)) v = presets.ee;
        else if (/viseme_i|^ih?$/.test(lower)) v = presets.ih;
        else if (/smile|happy|joy/.test(lower)) v = presets.happy;
        else if (/angry/.test(lower)) v = presets.angry;
        else if (/sad|sorrow|frown/.test(lower)) v = presets.sad;
        else if (/surprise/.test(lower)) v = presets.surprised;
        if (v !== undefined) inf[index] = clamp01(v * gain);
      }
    }
  }
}

const ARKIT_LOWER = new Set([
  'eyeblinkleft', 'eyeblinkright', 'eyesquintleft', 'eyesquintright', 'eyewideleft', 'eyewideright',
  'eyelookupleft', 'eyelookupright', 'eyelookdownleft', 'eyelookdownright', 'eyelookinleft', 'eyelookinright', 'eyelookoutleft', 'eyelookoutright',
  'browdownleft', 'browdownright', 'browinnerup', 'browouterupleft', 'browouterupright',
  'jawforward', 'jawleft', 'jawopen', 'jawright',
  'mouthleft', 'mouthright', 'mouthfrownleft', 'mouthfrownright', 'mouthsmileleft', 'mouthsmileright',
  'mouthdimpleleft', 'mouthdimpleright', 'mouthpressleft', 'mouthpressright', 'mouthrollupper', 'mouthrolllower',
  'mouthupperupleft', 'mouthupperupright', 'mouthlowerdownleft', 'mouthlowerdownright', 'mouthfunnel', 'mouthpucker',
  'mouthshruglower', 'mouthshrugupper', 'mouthstretchleft', 'mouthstretchright', 'mouthclose',
  'cheekpuff', 'cheeksquintleft', 'cheeksquintright', 'nosesneerleft', 'nosesneerright', 'tongueout',
]);
