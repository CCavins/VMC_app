# VMC Podium Studio

A motion-capture stage for the [VMC Protocol](https://protocol.vmc.info/). A phone sends body,
finger, eye and face tracking over UDP; this app retargets it onto a rigged 3D character
standing on a podium you can orbit in 360°.

**Hosted preview:** [ccavins.github.io/VMC_app](https://ccavins.github.io/VMC_app/)

The preview has every character, dance, idle mode and podium. It cannot receive live
tracking, because a phone sends UDP to a computer on your network and GitHub Pages is a
static site. For a phone, run it locally.

```
phone (VMC / OSC over UDP :39539)  ->  server/  Node bridge  ->  WebSocket  ->  browser (React + three.js)
```

## Run it locally

```bash
npm install     # also downloads the free sample characters, dances, HDRIs and textures
npm run dev     # UDP bridge on :8787 and the Vite dev server on :5173
```

Open http://localhost:5173.

### Point the phone at this computer

1. Phone and computer on the same Wi-Fi.
2. In the phone's VMC app, set the **destination** to one of the addresses shown in the
   **Network** panel (this computer's LAN IP) and the port (default `39539`).
3. Leave **Accept from IP** as `*`, or set it to the **phone's** address.

   That field is a filter on who this computer accepts. It is not the destination. Setting
   it to this computer's own IP drops every packet from the phone. If that happens the
   panel says so, and lists the phone as a rejected sender you can click.

The status pill turns green and shows frames per second once packets arrive. **Demo signal**
plays a stand-and-wave with no phone connected. Turn it off to see the real idle behaviour.

## What you can do

- Switch characters (people, animals, and anything you drop in) without stopping the stream.
- Orbit, zoom and pan the camera, or jump to full-body / waist / close-up presets.
- Swap podium styles (cyber, marble, broadcast, minimal, or your own GLB stage), surface
  textures and HDRI lighting.
- When the phone loses the person, the character waits (Idle delay), then eases into an
  idle. Tracking resumes the moment real motion comes back.
- Idle styles: **Calm** (stand, sway, look around), **Dance** (motion-captured Mixamo
  clips, cross-faded), or **Calm + surprises** (calm, with an occasional dance, wave,
  stretch, spin, hop, bow or backflip).

## Characters

Bundled free models are downloaded into `public/models/` by `npm run assets` (not committed;
they are fetched again in the Pages build):

- VRM people: Seed-san, two VRoid samples, Alicia Solid, a VRM 1.0 mannequin
- Adult male CC0 avatars: Baldman, Bizdude, Astronaut, Cool Pirate, Old Moustache
  (Polygonal Mind *100 Avatars*, via [open-source-avatars](https://github.com/ToxSam/open-source-avatars))
- Mixamo rigs: Xbot, Michelle
- CC0 creatures: two bears, tiger, wolf, fox, rabbit, penguin, shark, cat

Drag a `.vrm`, `.glb`, `.gltf` or `.fbx` onto the window, or use **Import**. Rigs are mapped
by VRM humanoid metadata when present, otherwise by bone name (Mixamo `mixamorig*`, Ready
Player Me, Blender `upper_arm.L`, VRoid `J_Bip_L_*`). The rest pose must be a T-pose.
Quadrupeds are not supported: the VMC stream is a human skeleton.

Faces drive ARKit morph targets directly when the model has them, otherwise the closest VRM
expression presets (blink, mouth shapes, happy/angry/sad/surprised).

More sources are listed in [`public/models/README.md`](public/models/README.md).

## Dances

Dance mode and the dance bursts in Calm + surprises play Mixamo clips (Samba Dancing and
Hip Hop Groove ship with the app) retargeted onto the current character. Add your own:

1. On [Mixamo](https://www.mixamo.com), download a dance as **FBX Binary**, **Without Skin**, 30 fps.
2. Drop the file on the window, use **Import dance clip**, or copy it into `public/animations/`
   and rerun `npm run assets`.

Details: [`public/animations/README.md`](public/animations/README.md).

## Lighting

VRM faces wash out when the key light, rim light and spotlight stack up. The built-in
presets are set for readable faces. If a character still looks blown out, lower **Exposure**
in Environment → Backdrop and lighting (or the key light). Exposure is the renderer-wide
control; the other three sliders are the individual lights.

## Project layout

| path | what it is |
| --- | --- |
| `server/` | UDP/OSC receiver, binary frame encoder, WebSocket + `/api` |
| `shared/` | Frame codec and the procedural idle/dance generator (used by the browser and the demo signal) |
| `src/vmc/` | Retargeter, expression mapper, Mixamo clip import, dance playlist |
| `src/scene/` | three.js stage, character loading, camera |
| `src/components/` | Control panel |
| `scripts/downloadAssets.mjs` | Fetches the free sample assets |
| `docs/how-it-works.md` | Retargeting, podium grounding, idle and deployment notes |

## Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | bridge + web dev server |
| `npm run server` | bridge only (`BRIDGE_PORT`, `VMC_PORT`, `VMC_SENDER`) |
| `npm run assets` | (re)download sample characters, dances, HDRIs and textures |
| `npm run build` | type-check and build the web app into `dist/` |

`VITE_BASE` sets the Vite base path. Leave it unset locally. The Pages workflow sets it to
`/VMC_app/`.

## Publishing

Pushes to `main` run [`.github/workflows/pages.yml`](.github/workflows/pages.yml): download
assets, build, deploy to GitHub Pages. The site is a preview. Live tracking stays local.
