#!/usr/bin/env node
// Regenerate every icon and the in-app brand banner from the masters in
// assets/brand. Only the hand-drawn SVGs are edited by hand; everything else
// is derived, so run `pnpm icons` after changing one of them.
//
// Requires ImageMagick 7 (`magick`) on PATH and an installed workspace
// (`pnpm install`), because the Tauri set is built with the Tauri CLI.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const out = join(brand, 'export');
const web = join(root, 'apps', 'web', 'public');
const tauriIcons = join(root, 'apps', 'desktop', 'src-tauri', 'icons');

const magick = (...args) => execFileSync('magick', args, { stdio: 'inherit' });

try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
} catch {
    console.error('error: ImageMagick 7 (`magick`) is required on PATH');
    process.exit(1);
}

mkdirSync(join(out, 'tauri-icons'), { recursive: true });
mkdirSync(tauriIcons, { recursive: true });

// 1. Rasterise the master at every size the web and desktop builds use.
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
for (const size of sizes) {
    const png = join(out, `catcup-${size}.png`);
    magick('-background', 'none', join(brand, 'catcup-icon.svg'), '-resize', `${size}x${size}`, '-depth', '8', png);
}

// 2. Windows icon, the two favicons and the Apple touch icon.
const png = (size) => join(out, `catcup-${size}.png`);
magick(png(16), png(24), png(32), png(48), png(64), png(128), png(256), join(out, 'icon.ico'));
magick(png(16), png(32), png(48), join(out, 'favicon.ico'));
magick(
    '-background',
    '#fdf4e2',
    join(brand, 'catcup-icon.svg'),
    '-resize',
    '180x180',
    '-flatten',
    '-depth',
    '8',
    join(out, 'apple-touch-icon.png'),
);
cpSync(join(brand, 'catcup-icon.svg'), join(out, 'favicon.svg'));

// 3. The Tauri set, including the macOS .icns, from the 1024 px raster.
const tmp = join(root, 'apps', 'desktop', 'src-tauri', '.icon-export');
rmSync(tmp, { recursive: true, force: true });
execFileSync('pnpm', ['--filter', '@catcup/desktop', 'exec', 'tauri', 'icon', png(1024), '-o', tmp], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
});
for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png']) {
    cpSync(join(tmp, file), join(tauriIcons, file));
    cpSync(join(tmp, file), join(out, 'tauri-icons', file));
}
rmSync(tmp, { recursive: true, force: true });

// 4. Web assets: the favicon set plus the dark banner the About tab renders.
for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']) {
    cpSync(join(out, file), join(web, file));
}
cpSync(join(brand, 'readme-banner-d.svg'), join(web, 'brand-banner.svg'));

console.log('Icons exported to assets/brand/export and copied into apps/web/public and apps/desktop/src-tauri/icons.');
