#!/usr/bin/env node
/**
 * Downloads free, redistributable sample assets into public/.
 *
 *  - Rigged humanoid characters (VRM 0.x, VRM 1.0, and Mixamo-rigged GLB) with
 *    full finger bones; the VRM/RPM-style models also carry facial blendshapes.
 *  - CC0 HDRI environment maps and PBR texture sets from Poly Haven.
 *
 * Re-run any time with `npm run assets`. Existing files are skipped.
 * Writes public/models/manifest.json and public/environments/manifest.json which
 * the app reads to populate its character / environment pickers.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(root, 'public', 'models');
const envDir = path.join(root, 'public', 'environments');
const texDir = path.join(envDir, 'textures');

/** @type {Array<{id:string,name:string,file:string,url:string,format:'vrm'|'glb',rig:string,license:string,source:string,description:string,hasBlendshapes:boolean}>} */
const CHARACTERS = [
  {
    id: 'seed-san',
    name: 'Seed-san (VRM 1.0)',
    file: 'Seed-san.vrm',
    url: 'https://github.com/vrm-c/vrm-specification/raw/master/samples/Seed-san/vrm/Seed-san.vrm',
    format: 'vrm', rig: 'VRM 1.0 humanoid (55 bones incl. fingers)',
    license: 'VRM Consortium sample model (see embedded VRM meta)',
    source: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san',
    description: 'Official VRM Consortium 1.0 sample character with full finger rig and VRM expressions.',
    hasBlendshapes: true,
  },
  {
    id: 'avatar-sample-a',
    name: 'VRoid Avatar Sample A',
    file: 'AvatarSample_A.vrm',
    url: 'https://github.com/madjin/vrm-samples/raw/master/vroid/stable/AvatarSample_A.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid (fingers + blendshape proxy)',
    license: 'VRoid Project sample (free to use, see embedded VRM meta)',
    source: 'https://hub.vroid.com/',
    description: 'VRoid Studio sample avatar (VRM 0.x) with fingers, eye bones and lip-sync/blink blendshapes.',
    hasBlendshapes: true,
  },
  {
    id: 'avatar-sample-b',
    name: 'VRoid Avatar Sample B',
    file: 'AvatarSample_B.vrm',
    url: 'https://github.com/madjin/vrm-samples/raw/master/vroid/stable/AvatarSample_B.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid (fingers + blendshape proxy)',
    license: 'VRoid Project sample (free to use, see embedded VRM meta)',
    source: 'https://hub.vroid.com/',
    description: 'VRoid Studio sample avatar (VRM 0.x).',
    hasBlendshapes: true,
  },
  {
    id: 'avatar-sample-c',
    name: 'VRoid Avatar Sample C',
    file: 'AvatarSample_C.vrm',
    url: 'https://github.com/madjin/vrm-samples/raw/master/vroid/stable/AvatarSample_C.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid (fingers + blendshape proxy)',
    license: 'VRoid Project sample (free to use, see embedded VRM meta)',
    source: 'https://hub.vroid.com/',
    description: 'VRoid Studio sample avatar (VRM 0.x) with blinking eyelids and vowel mouth shapes.',
    hasBlendshapes: true,
  },
  {
    id: 'perfectsync-female',
    name: 'Perfect Sync Female',
    file: 'PerfectSyncFemale.vrm',
    url: 'https://github.com/hinzka/52blendshapes-for-VRoid-face/releases/download/v1.1.3/VRoid_V110_Female_v1.1.3.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid + 52 ARKit face shapes',
    license: 'VRoid sample, modified by hinzka for facial tracking (free to use with credit)',
    source: 'https://github.com/hinzka/52blendshapes-for-VRoid-face',
    description: 'Female VRoid body with all 52 ARKit blendshapes: eyelids blink, eyes look around, and the mouth forms speech shapes.',
    hasBlendshapes: true,
    height: 1.6,
  },
  {
    id: 'perfectsync-male',
    name: 'Perfect Sync Male',
    file: 'PerfectSyncMale.vrm',
    url: 'https://github.com/hinzka/52blendshapes-for-VRoid-face/releases/download/v1.1.3/VRoid_V110_Male_v1.1.3.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid + 52 ARKit face shapes',
    license: 'VRoid sample, modified by hinzka for facial tracking (free to use with credit)',
    source: 'https://github.com/hinzka/52blendshapes-for-VRoid-face',
    description: 'Male VRoid body with all 52 ARKit blendshapes: eyelids blink, eyes look around, and the mouth forms speech shapes.',
    hasBlendshapes: true,
    height: 1.75,
  },
  {
    id: 'alicia-solid',
    name: 'Alicia Solid',
    file: 'AliciaSolid.vrm',
    url: 'https://raw.githubusercontent.com/vrm-c/UniVRM/master/Tests/Models/Alicia_vrm-0.51/AliciaSolid_vrm-0.51.vrm',
    format: 'vrm', rig: 'VRM 0.x humanoid (fingers + blendshape proxy)',
    license: 'Niconi Solid / Dwango "Alicia Solid" license (free use with credit)',
    source: 'https://3d.nicovideo.jp/alicia/',
    description: 'Classic VRM 0.x reference avatar with full fingers, eye bones and facial blendshapes.',
    hasBlendshapes: true,
  },
  {
    id: 'vrm1-twist-sample',
    name: 'VRM1 Constraint Sample',
    file: 'VRM1_Constraint_Twist_Sample.vrm',
    url: 'https://github.com/vrm-c/vrm-specification/raw/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm',
    format: 'vrm', rig: 'VRM 1.0 humanoid (fingers, twist constraints)',
    license: 'CC0 1.0 (VRM Consortium sample)',
    source: 'https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample',
    description: 'Simple VRM 1.0 mannequin; useful for checking bone retargeting without textures getting in the way.',
    hasBlendshapes: false,
  },
  {
    id: 'xbot',
    name: 'Xbot (Mixamo rig, GLB)',
    file: 'Xbot.glb',
    url: 'https://github.com/mrdoob/three.js/raw/dev/examples/models/gltf/Xbot.glb',
    format: 'glb', rig: 'Mixamo (mixamorig*) humanoid with fingers',
    license: 'Adobe Mixamo (free use), redistributed in three.js examples (MIT)',
    source: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf',
    description: 'Mixamo-rigged mannequin. Demonstrates automatic bone-name mapping for non-VRM GLB characters.',
    hasBlendshapes: false,
  },
  {
    id: 'michelle',
    name: 'Michelle (Mixamo rig, GLB)',
    file: 'Michelle.glb',
    url: 'https://github.com/mrdoob/three.js/raw/dev/examples/models/gltf/Michelle.glb',
    format: 'glb', rig: 'Mixamo (mixamorig*) humanoid with fingers',
    license: 'Adobe Mixamo (free use), redistributed in three.js examples (MIT)',
    source: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf',
    description: 'Mixamo-rigged textured character.',
    hasBlendshapes: false,
  },
  // Adult male humanoids, CC0, from the same open-source-avatars registry as the animals.
  ...[
    { id: 'baldman', name: 'Baldman', file: 'Baldman.vrm', url: 'https://arweave.net/ZInk8IWljp96ivF7KI3GR49WyLPdI1zretRcEZ8NYyM', description: 'Adult bald man.' },
    { id: 'bizdude', name: 'Bizdude', file: 'Bizdude.vrm', url: 'https://arweave.net/k-_vw28ADGy2jPwnq02Tc98wC0Ey10Ia3JVYQ8qiaxM', description: 'Man in business clothes.' },
    { id: 'astronaut', name: 'Astronaut', file: 'Astronaut.vrm', url: 'https://arweave.net/T0c0z_XEPQHy3vyXz31XB22s_6JTqHdnau8exq_I8tI', description: 'Astronaut.' },
    { id: 'cool-pirate', name: 'Cool Pirate', file: 'CoolPirate.vrm', url: 'https://arweave.net/lQwSPMpcSKzL9lMYyAaQ63vHK1ATP1Xmir43jZg2Ob0', description: 'Pirate.' },
    { id: 'old-moustache', name: 'Old Moustache', file: 'OldMoustache.vrm', url: 'https://arweave.net/li-q3WXvBik3A1aYyp7azx7Mwce3taHx6OSOE1pHdKk', description: 'Older man with a moustache.' },
  ].map((a) => ({
    id: a.id, name: a.name, file: a.file, url: a.url, height: 1.75,
    format: 'vrm', rig: 'VRM 0.x humanoid (low-poly)',
    license: 'CC0 1.0',
    source: 'https://github.com/ToxSam/open-source-avatars',
    description: `${a.description} Polygonal Mind 100 Avatars, CC0.`,
    hasBlendshapes: false,
    category: 'person',
  })),
  // ---- Animal / creature avatars. All CC0 from Polygonal Mind's "100 Avatars" and
  // ToxSam, indexed by https://github.com/ToxSam/open-source-avatars (files pinned on
  // Arweave / IPFS). Humanoid VRM 0.x rigs, so body tracking works as-is; most are
  // low-poly with no finger bones or facial blendshapes (the app reports what each has).
  // `height` = standing height on stage in metres; these files are authored anywhere
  // from 1 m to nearly 3 m tall, so each is pinned to a believable size.
  ...[
    { id: 'teddy', name: 'Teddy (bear)', file: 'Teddy.vrm', url: 'https://arweave.net/KbaYR3YmtjweLgEcJAWekeh3MNAlF9ZWOYJkbNfi8MM', collection: '100Avatars R1', description: 'Stuffed teddy bear avatar.', height: 1.6 },
    { id: 'lil-teddy', name: 'Lil Teddy (bear)', file: 'LilTeddy.vrm', url: 'https://arweave.net/-3bfp6YgXDn6Qb5u463PFouqbsBzcceFKY57WU6Z-xM', collection: '100Avatars R3', description: 'Chibi teddy bear.', height: 1.25 },
    { id: 'cool-tiger', name: 'Cool Tiger', file: 'CoolTiger.vrm', url: 'https://arweave.net/2EQ5wsstsJaFOG9LXq_gVFKKgM8bnfPa3axYJ-VS1ug', collection: '100Avatars R3', description: 'Anthropomorphic tiger.', height: 1.6 },
    { id: 'buffed-wolf', name: 'Buffed Wolf', file: 'Buffedwolf.vrm', url: 'https://arweave.net/dtI-JA5uSmbJVa7w7294T_9AJ_jvfZVQx4QWFzYdvdQ', collection: '100Avatars R3', description: 'Muscular wolf character.', height: 1.7 },
    { id: 'megan-the-fox', name: 'Megan the Fox', file: 'MeganTheFox.vrm', url: 'https://arweave.net/up4WzT0YJfXv9woGseCIQnBSq3eH8KWASJJbNtuvEWY', collection: '100Avatars R3', description: 'Fox girl character.', height: 1.55 },
    { id: 'rabbit', name: 'Rabbit', file: 'Rabbit.vrm', url: 'https://arweave.net/RymRtrmhHx_f9ZDvtvIQb1noTHvILdjoTg5G7L2DR-8', collection: '100Avatars R1', description: 'Bipedal rabbit.', height: 1.6 },
    { id: 'chill-penguin', name: 'Chill Penguin', file: 'ChillPenguin.vrm', url: 'https://arweave.net/4c5EhflLKYfBtzpcLlvZY0afAwXLVdxXmpgwGaarAIQ', collection: '100Avatars R2', description: 'Penguin with short limbs; fun stress test for the retargeter.', height: 1.4 },
    { id: 'shark-person', name: 'Shark Person', file: 'SharkPerson.vrm', url: 'https://arweave.net/mW-D--cWzk7G8efvS8CXMIu_-501NHTHwY8Hi3bjRJ8', collection: '100Avatars R2', description: 'Shark-headed humanoid.', height: 1.7 },
    { id: 'chubby-tubby-cat', name: 'Chubby Tubby Cat', file: 'ChubbyTubbyCat.vrm', url: 'https://gateway.pinata.cloud/ipfs/QmY4NQRArQaEWPgyzyTuCSvyAnBUhtsshFKPjJHbbzVKLL/ChubbyTubbyCat.vrm', collection: 'ToxSam', description: 'Round cat by ToxSam.', height: 1.35 },
  ].map((a) => ({
    id: a.id, name: a.name, file: a.file, url: a.url, height: a.height,
    format: 'vrm', rig: 'VRM 0.x humanoid (low-poly, fingers vary)',
    license: 'CC0 1.0',
    source: 'https://github.com/ToxSam/open-source-avatars',
    description: `${a.description} ${a.collection}, CC0.`,
    hasBlendshapes: false,
    category: 'animal',
  })),
];

/** @type {Array<{id:string,name:string,file:string,url:string,license:string,source:string,mood:string}>} */
const HDRIS = [
  { id: 'studio_small_09', name: 'Soft Studio', file: 'studio_small_09_1k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr', license: 'CC0', source: 'https://polyhaven.com/a/studio_small_09', mood: 'neutral studio softboxes' },
  { id: 'brown_photostudio_02', name: 'Photo Studio', file: 'brown_photostudio_02_1k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr', license: 'CC0', source: 'https://polyhaven.com/a/brown_photostudio_02', mood: 'warm photo studio' },
  { id: 'moonless_golf', name: 'Night Sky', file: 'moonless_golf_1k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr', license: 'CC0', source: 'https://polyhaven.com/a/moonless_golf', mood: 'dark outdoor night' },
  { id: 'venice_sunset', name: 'Venice Sunset', file: 'venice_sunset_1k.hdr', url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/venice_sunset_1k.hdr', license: 'CC0', source: 'https://polyhaven.com/a/venice_sunset', mood: 'golden hour outdoors' },
];

/** PBR texture sets (diffuse / normal (GL) / roughness) */
const TEXTURE_SETS = [
  { id: 'marble_01', name: 'Polished Marble', slug: 'marble_01' },
  { id: 'wood_floor_deck', name: 'Wood Stage Deck', slug: 'wood_floor_deck' },
  { id: 'metal_plate', name: 'Industrial Metal Plate', slug: 'metal_plate' },
  { id: 'concrete_floor_worn_001', name: 'Worn Concrete', slug: 'concrete_floor_worn_001' },
].map((t) => ({
  ...t,
  license: 'CC0',
  source: `https://polyhaven.com/a/${t.slug}`,
  maps: {
    diffuse: `${t.slug}_diff_1k.jpg`,
    normal: `${t.slug}_nor_gl_1k.jpg`,
    roughness: `${t.slug}_rough_1k.jpg`,
  },
  urls: {
    diffuse: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${t.slug}/${t.slug}_diff_1k.jpg`,
    normal: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${t.slug}/${t.slug}_nor_gl_1k.jpg`,
    roughness: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${t.slug}/${t.slug}_rough_1k.jpg`,
  },
}));

/**
 * Dance / motion clips on a Mixamo skeleton. These two are the Mixamo clips that the
 * three.js project redistributes with its examples (same provenance as the X Bot /
 * Michelle characters above). Add any Mixamo download ("FBX", "Without Skin") to
 * public/animations/ and it will be picked up by `npm run assets` if listed here, or
 * drag it straight onto the app window.
 */
const ANIMATIONS = [
  {
    id: 'samba-dancing',
    name: 'Samba Dancing',
    file: 'SambaDancing.fbx',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/fbx/Samba%20Dancing.fbx',
    license: 'Mixamo (via three.js examples)',
    source: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/fbx',
  },
  {
    id: 'mixamo-dance',
    name: 'Hip Hop Groove',
    file: 'MixamoDance.fbx',
    url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/fbx/mixamo.fbx',
    license: 'Mixamo (via three.js examples)',
    source: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/fbx',
  },
];
const animDir = path.join(root, 'public', 'animations');

async function exists(p) {
  try { const s = await stat(p); return s.size > 0; } catch { return false; }
}

async function download(url, dest, label) {
  if (await exists(dest)) { console.log(`  = ${label} (cached)`); return true; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      const s = await stat(dest);
      if (s.size === 0) throw new Error('empty file');
      console.log(`  + ${label} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
      return true;
    } catch (e) {
      if (attempt === 3) console.warn(`  ! ${label} failed: ${e.message}`);
      else await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return false;
}

async function main() {
  await mkdir(modelsDir, { recursive: true });
  await mkdir(texDir, { recursive: true });

  console.log('Characters ->', path.relative(root, modelsDir));
  const characters = [];
  for (const c of CHARACTERS) {
    const ok = await download(c.url, path.join(modelsDir, c.file), c.name);
    if (ok) characters.push({ ...c, path: `/models/${c.file}` });
  }
  await writeFile(path.join(modelsDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), characters }, null, 2));

  console.log('HDRIs ->', path.relative(root, envDir));
  const hdris = [];
  for (const h of HDRIS) {
    const ok = await download(h.url, path.join(envDir, h.file), h.name);
    if (ok) hdris.push({ ...h, path: `/environments/${h.file}` });
  }

  console.log('Textures ->', path.relative(root, texDir));
  const textures = [];
  for (const t of TEXTURE_SETS) {
    let all = true;
    for (const [kind, url] of Object.entries(t.urls)) {
      all = (await download(url, path.join(texDir, t.maps[kind]), `${t.name} ${kind}`)) && all;
    }
    if (all) {
      textures.push({
        id: t.id, name: t.name, license: t.license, source: t.source,
        maps: Object.fromEntries(Object.entries(t.maps).map(([k, f]) => [k, `/environments/textures/${f}`])),
      });
    }
  }
  await writeFile(path.join(envDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), hdris, textures }, null, 2));

  console.log('Animations ->', path.relative(root, animDir));
  await mkdir(animDir, { recursive: true });
  const clips = [];
  for (const a of ANIMATIONS) {
    const ok = await download(a.url, path.join(animDir, a.file), a.name);
    if (ok) clips.push({ id: a.id, name: a.name, license: a.license, source: a.source, path: `/animations/${a.file}` });
  }
  // Any extra .fbx / .glb the user copied into public/animations/ (e.g. Mixamo downloads).
  const known = new Set(ANIMATIONS.map((a) => a.file));
  for (const f of (await readdir(animDir)).sort()) {
    if (known.has(f) || !/\.(fbx|glb)$/i.test(f)) continue;
    const name = f.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    clips.push({ id: `local-${f}`, name, license: 'user-provided', source: 'local', path: `/animations/${f}` });
    console.log(`  + ${name} (local file)`);
  }
  await writeFile(path.join(animDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), clips }, null, 2));

  console.log(`Done: ${characters.length}/${CHARACTERS.length} characters, ${hdris.length}/${HDRIS.length} HDRIs, ${textures.length}/${TEXTURE_SETS.length} texture sets, ${clips.length}/${ANIMATIONS.length} animation clips.`);
  if (characters.length < CHARACTERS.length || hdris.length < HDRIS.length || textures.length < TEXTURE_SETS.length || clips.length < ANIMATIONS.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
