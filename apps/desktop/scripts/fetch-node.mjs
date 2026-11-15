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

/**
 * The target triple Tauri will look for.
 *
 * `TAURI_ENV_TARGET_TRIPLE` is only set for `beforeBuildCommand` hooks, and
 * this project has no such hook, so the common case is to derive it from the
 * running Node. Hard-coding the Windows triple — as this script used to — means
 * a macOS or Linux build silently ships a Windows executable.
 */
function targetTriple() {
    if (process.env.TAURI_ENV_TARGET_TRIPLE) {
        return process.env.TAURI_ENV_TARGET_TRIPLE;
    }

    const architecture = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    if (process.platform === 'win32') {
        return `${architecture}-pc-windows-msvc`;
    }
    if (process.platform === 'darwin') {
        return `${architecture}-apple-darwin`;
    }
    return `${architecture}-unknown-linux-gnu`;
}

const triple = targetTriple();
const suffix = triple.includes('windows') ? '.exe' : '';
// Not `node`: a deb or rpm install puts external binaries in `/usr/bin`, where
// `node` collides with the distribution's nodejs package and would replace the
// user's runtime.
const destination = path.join(binaries, `catcup-node-${triple}${suffix}`);

await mkdir(binaries, { recursive: true });

const existing = await stat(destination).catch(() => null);
if (existing?.isFile()) {
    console.log(`node runtime already present at ${destination}`);
    process.exit(0);
}

await copyFile(process.execPath, destination);
console.log(`copied ${process.execPath} to ${destination}`);
