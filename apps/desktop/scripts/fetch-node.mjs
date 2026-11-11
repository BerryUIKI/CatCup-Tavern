// Put a Node runtime where Tauri expects a sidecar binary.
//
// The build copies the Node running this script, which keeps the desktop build
// working offline and on whatever Node version the developer already has. A CI
// build would download a pinned release instead.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const binaries = path.join(desktop, 'src-tauri', 'binaries');

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? 'x86_64-pc-windows-msvc';
const suffix = triple.includes('windows') ? '.exe' : '';
const destination = path.join(binaries, `node-${triple}${suffix}`);

await mkdir(binaries, { recursive: true });

const existing = await stat(destination).catch(() => null);
if (existing?.isFile()) {
    console.log(`node runtime already present at ${destination}`);
    process.exit(0);
}

await copyFile(process.execPath, destination);
console.log(`copied ${process.execPath} to ${destination}`);
