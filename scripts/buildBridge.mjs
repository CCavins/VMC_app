/**
 * Bundle the VMC Bridge and wrap it in a Node single-file executable for this OS.
 * Run on macOS and Windows (GitHub Actions does both). Output is dist-bridge/<zip name>.zip.
 */
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-bridge');
const bundle = path.join(outDir, 'vmc-bridge.cjs');
const blob = path.join(outDir, 'sea-prep.blob');
const hostPlatform = process.platform;
const hostArch = process.arch;
const target = process.env.BRIDGE_TARGET || `${hostPlatform}-${hostArch}`;
const [platform, arch] = target.split('-');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

/** Node binary of the same version as this process, for the target OS. */
async function nodeBinary() {
  if (platform === hostPlatform && arch === hostArch) return process.execPath;
  const ver = process.version;
  const plat = platform === 'win32' ? 'win' : platform;
  const folder = `node-${ver}-${plat}-${arch}`;
  const archive = platform === 'win32' ? `${folder}.zip` : `${folder}.tar.gz`;
  const url = `https://nodejs.org/dist/${ver}/${archive}`;
  const dest = path.join(outDir, archive);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Could not download ${url} (HTTP ${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const extract = path.join(outDir, 'node-bin');
  await mkdir(extract, { recursive: true });
  if (archive.endsWith('.zip')) run('unzip', ['-q', dest, '-d', extract]);
  else run('tar', ['-xzf', dest, '-C', extract]);
  return platform === 'win32'
    ? path.join(extract, folder, 'node.exe')
    : path.join(extract, folder, 'bin', 'node');
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

async function zipDir(folder, zipPath) {
  await rm(zipPath, { force: true });
  const r = platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${folder}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' })
    : spawnSync('ditto', ['-c', '-k', '--keepParent', path.join(folder, 'VMC Bridge.app'), zipPath], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('zip failed');
}

const names = {
  'darwin-arm64': 'VMC-Bridge-mac-arm64',
  'darwin-x64': 'VMC-Bridge-mac-x64',
  'win32-x64': 'VMC-Bridge-windows-x64',
};
const key = `${platform}-${arch}`;
const product = names[key];
if (!product) throw new Error(`No VMC Bridge build for ${key}. Use macOS (arm64 or x64) or Windows x64.`);

await mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, 'bridge-app', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  // Node's own modules stay in the executable. `ws` is bundled.
  external: ['node:*'],
  banner: { js: "process.env.NODE_NO_WARNINGS='1';" },
});

await writeFile(path.join(outDir, 'sea-config.json'), JSON.stringify({
  main: bundle,
  output: blob,
  disableExperimentalSEAWarning: true,
}, null, 2));

run(process.execPath, ['--experimental-sea-config', path.join(outDir, 'sea-config.json')]);

const binName = platform === 'win32' ? 'vmc-bridge.exe' : 'vmc-bridge';
const bin = path.join(outDir, binName);
await copyFile(await nodeBinary(), bin);
if (platform === 'darwin') run('codesign', ['--remove-signature', bin]);

const postject = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
const inject = [postject, bin, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', FUSE];
if (platform === 'darwin') inject.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, inject);
if (platform === 'darwin') run('codesign', ['--sign', '-', bin]);
await chmod(bin, 0o755);

const stage = path.join(outDir, product);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
if (platform === 'darwin') {
  const app = path.join(stage, 'VMC Bridge.app');
  const macos = path.join(app, 'Contents', 'MacOS');
  await mkdir(macos, { recursive: true });
  await copyFile(bin, path.join(macos, 'vmc-bridge'));
  await chmod(path.join(macos, 'vmc-bridge'), 0o755);
  await writeFile(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>vmc-bridge</string>
  <key>CFBundleIdentifier</key><string>com.ccavins.vmc-bridge</string>
  <key>CFBundleName</key><string>VMC Bridge</string>
  <key>CFBundleDisplayName</key><string>VMC Bridge</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.1</string>
  <key>CFBundleVersion</key><string>0.1.1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  run('codesign', ['--force', '--sign', '-', app]);
} else {
  await copyFile(bin, path.join(stage, 'VMC Bridge.exe'));
}

const zipPath = path.join(outDir, `${product}.zip`);
await zipDir(stage, zipPath);
console.log(`Built ${zipPath}`);
