# Dance / motion clips

Files in this folder are downloaded by `npm run assets` (see `scripts/downloadAssets.mjs`)
and are not committed. The app lists them from `manifest.json` and plays them in the
**Dance** and **Calm + surprises** idle styles, retargeted onto whichever character is loaded.

## Adding your own clips (Mixamo)

1. Go to [mixamo.com](https://www.mixamo.com), pick any character and search for a dance
   (Hip Hop Dancing, Breakdance, Salsa, Twist Dance, Wave Hip Hop, Robot Hip Hop, ...).
2. Download with **Format: FBX Binary**, **Skin: Without Skin**, 30 fps. Tick "In Place" if
   the move offers it (travelling moves are clamped to the podium anyway).
3. Either drag the `.fbx` onto the app window (it is detected as an animation because it
   has no mesh; it lasts for the session), or copy it into this folder and rerun
   `npm run assets` - every extra `.fbx` / `.glb` found here is added to the manifest and
   becomes a permanent part of the dance rotation. Each clip can be switched on or off in
   the Character panel.

Any FBX / GLB with a humanoid skeleton (Mixamo, Ready Player Me, VRoid, Rigify) works -
bones are matched by name and the motion is expressed as deltas from the clip's rest pose,
so the character's own proportions and bind pose do not matter.

## Bundled clips

| Clip | Source |
| --- | --- |
| Samba Dancing | Mixamo clip redistributed in the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/fbx) |
| Hip Hop Groove (`mixamo.fbx`) | same |
