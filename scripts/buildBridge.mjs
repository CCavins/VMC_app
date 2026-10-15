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

const README = `VMC Bridge
=========

This small program receives VMC tracking from your phone and hands it to the
studio page at https://ccavins.github.io/VMC_app/

1. Run "Start VMC Bridge" and leave the window open.
2. macOS: if it says the app can't be opened, right-click it and choose Open.
   Windows: if SmartScreen appears, choose More info, then Run anyway.
   Allow the firewall prompt on private networks so the phone can reach this computer.
3. In the phone's VMC app, set the destination to the address printed in the
   window and port 39539. That address is this computer, not the phone.
4. Open the studio page in Chrome, Edge, or Firefox on THIS computer.
   It connects to the bridge on its own. If the page was already open, click Connect.

The browser and this program have to be on the same computer. The phone only
sends tracking; it does not need to show the page.
`;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

async function zipDir(folder, zipPath) {
  await rm(zipPath, { force: true });
  const r = platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${folder}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' })
    : spawnSync('zip', ['-r', '-q', zipPath, path.basename(folder)], { cwd: path.dirname(folder), stdio: 'inherit' });
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
await mkdir(stage, { recursive: true });
await copyFile(bin, path.join(stage, binName));
await writeFile(path.join(stage, 'README.txt'), README);
if (platform === 'darwin') {
  const command = `#!/bin/bash
cd "$(dirname "$0")"
chmod +x ./vmc-bridge
xattr -d com.apple.quarantine ./vmc-bridge 2>/dev/null || true
# The executable warns once that it cannot load optional native addons. It runs without them.
export NODE_NO_WARNINGS=1
./vmc-bridge
`;
  await writeFile(path.join(stage, 'Start VMC Bridge.command'), command);
  await chmod(path.join(stage, 'Start VMC Bridge.command'), 0o755);
} else {
  const bat = `@echo off
cd /d "%~dp0"
set NODE_NO_WARNINGS=1
vmc-bridge.exe
echo.
pause
`;
  await writeFile(path.join(stage, 'Start VMC Bridge.bat'), bat);
}

const zipPath = path.join(outDir, `${product}.zip`);
await zipDir(stage, zipPath);
console.log(`Built ${zipPath}`);
