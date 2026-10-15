# How VMC Podium Studio works

## The stream

A VMC sender (the phone app) emits OSC bundles over UDP, default port **39539**, about 60
times a second. Each bundle carries:

- `/VMC/Ext/Root/Pos` — root transform
- `/VMC/Ext/Bone/Pos` — up to 55 Unity Humanoid bones, including both eyes and all 30 finger bones
- `/VMC/Ext/Blend/Val` plus `/VMC/Ext/Blend/Apply` — ARKit face blendshapes (44 from the phone used while building this)

`server/index.ts` listens with Node `dgram`, parses OSC, and forwards each bundle to the
browser as one binary WebSocket frame (`shared/frameCodec.ts`). Config (`/api/config`,
`/api/status`) covers the listen port, bind address, sender filter and the demo signal.

The sender filter (**Accept from IP**) drops packets whose source address does not match.
`*` accepts anyone. It must be the phone's address or `*`. This computer's own address
matches nothing the phone sends.

## Retargeting

Unity is left-handed with +X = model right. three.js is right-handed with +X = model left.
Bone quaternions are converted `(x, -y, -z, w)`.

The retargeter (`src/vmc/retargetEngine.ts`) does not copy local rotations onto the target
rig, because rest poses differ. For each bone it builds a model-space delta from the VMC
T-pose (`normWorld`), then solves the target's local rotation as
`inverse(parentModel) * normWorld * restModel`. Hips rotation is applied in full, so yaw
turns the whole body. Finger and eye bones can be toggled off.

Only bone **rotations** drive the body. Hips translation is replaced by podium placement:

- **Waist-up only** skips the leg chain (upper leg, knee, foot, toes) while someone is
  tracked, so the legs stay in the standing rest pose. The camera preset frames from the
  hips to just over the head. Idle animations still use the legs.
- **Horizontal follow** 0 pins the hips over the podium centre. Higher values let the
  character drift with the performer.
- **Foot grounding** measures the lowest sole each frame and keeps it on the podium top,
  so a crouch bends the knees instead of sinking the character through the stage.
- **Calibrate centre** recaptures the hips position used as the drift origin.

## Idle

`shared/idleAnimation.ts` generates a calm pose (breathing, weight shift, gaze, blinks) and
a set of short bits (wave, stretch, spin, hop, bow, backflip, and a procedural groove).
The retargeter is in one of three states:

- **tracking** — a recent frame had a moving person (at least 8 non-identity bones, not frozen)
- **waiting** — motion stopped, but the idle delay has not elapsed; the last pose is held
- **idle** — delay elapsed; the procedural pose (and, in dance styles, a clip) eases in

A frozen pose from a phone that lost the person counts as "no one there", but only after it
has been frozen for about a second, so a held pose does not flicker. Live frames resume
immediately. **Preview idle** forces the idle state so it can be tuned while a phone is connected.

## Dance clips

`src/vmc/animationClips.ts` loads an FBX or GLB, maps its skeleton by bone name, and samples
each humanoid bone as a model-space delta from that clip's own rest pose (the skin bind pose
when the file has one). That is the same `normWorld` space the live retargeter uses, so a
Mixamo clip plays on a VRM, and a VRM-shaped clip plays on a Mixamo rig, without sharing a
skeleton.

Hips translation from the clip is scaled by the ratio of hip heights and clamped so a
travelling dance stays on the podium. Jumps set an airborne flag that bypasses foot
grounding for the duration.

`src/vmc/danceController.ts` shuffles the enabled clips, plays each for at least ~14 seconds
(looping short ones) and cross-fades at the pose level. With no clips enabled, dance mode
falls back to the procedural groove.

## Characters and scale

`src/scene/characterLoader.ts` measures the rest-pose height. VRM files are in metres.
Other formats get a unit fix, then everything is clamped to roughly 1.3–1.8 m unless the
library manifest sets an explicit `height` (used for the animals and the CC0 men, whose
source files are authored at arbitrary sizes). The sidebar **Scale** slider multiplies that.

## Lighting

The stage uses an HDRI for image-based lighting plus a key light, a coloured rim light and
an optional spotlight (`src/scene/PodiumEnvironment.tsx`). VRM materials (MToon) clip
sooner than the metallic/roughness materials on the Mixamo GLBs, which is why the same
lights can wash out a human face and leave a mannequin looking fine. Preset intensities are
kept low for that reason, and **Exposure** maps to `toneMappingExposure` on the renderer.

## Why the hosted site has no tracking

GitHub Pages serves the built static files only. There is no process to bind a UDP port.
On load the page requests `/api/status` once. If that 404s it does not open a WebSocket
(so the console stays quiet) and shows a preview banner. `npm run dev` is the supported
way to track.

The Pages workflow (`.github/workflows/pages.yml`) runs `npm run assets` before the build,
because the model, HDRI and animation files are gitignored and downloaded from their
original hosts. `VITE_BASE=/VMC_app/` makes asset URLs resolve under the project-site path.
