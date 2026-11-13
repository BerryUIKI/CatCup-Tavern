#!/usr/bin/env node
// Regenerate every icon and the in-app brand banner from the masters in
// assets/brand. Only the hand-drawn SVGs are edited by hand; everything else
// is derived, so run `pnpm icons` after changing one of them.
//
// Requires ImageMagick 7 (`magick`) on PATH and an installed workspace
// (`pnpm install`), because the Tauri set is built with the Tauri CLI.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const out = join(brand, 'export');
const web = join(root, 'apps', 'web', 'public');
const desktop = join(root, 'apps', 'desktop');
const tauriIcons = join(desktop, 'src-tauri', 'icons');

// The Tauri CLI ships as a Node entry point, so it runs without a shell.
const tauriCli = createRequire(join(desktop, 'package.json')).resolve('@tauri-apps/cli/tauri.js');

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' });

// The Tauri icon generator writes the ICNS representations in whatever order
// its parallel walk finishes, so two runs produce different bytes. Sorting the
// chunks keeps the file stable across runs without changing what it contains.
function sortIcnsChunks(file) {
    const buffer = readFileSync(file);
    if (buffer.toString('latin1', 0, 4) !== 'icns') {
        throw new Error(`${file} is not an ICNS file`);
    }
    const chunks = [];
    for (let offset = 8; offset < buffer.length; ) {
        const length = buffer.readUInt32BE(offset + 4);
        chunks.push(buffer.subarray(offset, offset + length));
        offset += length;
    }
    chunks.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
    const body = Buffer.concat(chunks);
    const header = Buffer.from(buffer.subarray(0, 8));
    header.writeUInt32BE(8 + body.length, 4);
    writeFileSync(file, Buffer.concat([header, body]));
}

try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch {
    console.error('error: ImageMagick 7 (`magick`) is required on PATH');
    process.exit(1);
}

mkdirSync(join(out, 'tauri-icons'), { recursive: true });
mkdirSync(tauriIcons, { recursive: true });

// 1. Rasterise the master at every size the web and desktop builds use.
// `png:exclude-chunks` keeps ImageMagick's creation timestamps out, so two
// runs on the same master produce byte-identical files.
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) {
    const png = join(out, `catcup-${size}.png`);
    magick(
        '-background',
        'none',
        join(brand, 'catcup-icon.svg'),
        '-resize',
        `${size}x${size}`,
        '-depth',
        '8',
        '-define',
        'png:exclude-chunks=date,time',
        png,
    );
}

// 2. Windows icon, the two favicons and the Apple touch icon.
const png = (size) => join(out, `catcup-${size}.png`);
magick(
    png(16),
    png(24),
    png(32),
    png(48),
    png(64),
    png(128),
    png(256),
    '-define',
    'png:exclude-chunks=date,time',
    join(out, 'icon.ico'),
);
magick(png(16), png(32), png(48), '-define', 'png:exclude-chunks=date,time', join(out, 'favicon.ico'));
magick(
    '-background',
    '#fdf4e2',
    join(brand, 'catcup-icon.svg'),
    '-resize',
    '180x180',
    '-flatten',
    '-depth',
    '8',
    '-define',
    'png:exclude-chunks=date,time',
    join(out, 'apple-touch-icon.png'),
);
cpSync(join(brand, 'catcup-icon.svg'), join(out, 'favicon.svg'));

// 3. The Tauri set, including the macOS .icns, from the 1024 px raster.
const tmp = join(desktop, 'src-tauri', '.icon-export');
rmSync(tmp, { recursive: true, force: true });
execFileSync(process.execPath, [tauriCli, 'icon', png(1024), '-o', tmp], { cwd: desktop, stdio: 'inherit' });
for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png']) {
    cpSync(join(tmp, file), join(tauriIcons, file));
    cpSync(join(tmp, file), join(out, 'tauri-icons', file));
}
sortIcnsChunks(join(tauriIcons, 'icon.icns'));
sortIcnsChunks(join(out, 'tauri-icons', 'icon.icns'));
rmSync(tmp, { recursive: true, force: true });

// 4. Web assets: the favicon set plus the dark banner the About tab renders.
for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
    cpSync(join(out, file), join(web, file));
}
cpSync(join(brand, 'readme-banner-d.svg'), join(web, 'brand-banner.svg'));

console.log('Icons exported to assets/brand/export and copied into apps/web/public and apps/desktop/src-tauri/icons.');
