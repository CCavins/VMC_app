# Environments

Populated by `npm run assets`. Contains CC0 HDRI light probes (`*.hdr`) and PBR texture
sets (`textures/*_diff|nor_gl|rough_1k.jpg`) from Poly Haven. `manifest.json` lists what is
available; the studio's Environment panel reads it.

To add your own:

- HDRI: drop an equirectangular `.hdr`/`.exr` here and add an entry under `hdris`.
- Texture set: drop diffuse/normal/roughness JPG/PNGs in `textures/` and add an entry under `textures`.
- Whole stage: drag a `.glb` onto the studio window (or use "Import stage") - the podium top
  height is adjustable so the character can be placed on any imported geometry.
