// Copy the built server, its assets and the one dependency that cannot be
// bundled into the Tauri resources folder.
//
// `CATCUP_BUNDLE_DEPS=1 pnpm --filter @catcup/server build` has to run first;
// this script only lays out files.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '../..');
const server = path.join(repo, 'apps', 'server');
const target = path.join(desktop, 'src-tauri', 'bundle', 'server');

const skipMaps = (source) => !source.endsWith('.map');

async function requireDir(directory, hint) {
    const info = await stat(directory).catch(() => null);
    if (!info?.isDirectory()) {
        throw new Error(`${directory} is missing. ${hint}`);
    }
}

await requireDir(
    path.join(server, 'dist'),
    'Build the server first: CATCUP_BUNDLE_DEPS=1 pnpm --filter @catcup/server build',
);
await requireDir(path.join(repo, 'apps', 'web', 'dist'), 'Build the SPA first: pnpm --filter @catcup/web build');

await rm(target, { recursive: true, force: true });
await mkdir(path.join(target, 'node_modules', '@agnai'), { recursive: true });

await cp(path.join(server, 'dist'), path.join(target, 'dist'), { recursive: true, filter: skipMaps });
await cp(path.join(server, 'assets'), path.join(target, 'assets'), { recursive: true });

// The server serves the SPA from `../../web/dist` relative to its own dist, so
// the bundle keeps that same shape: `server/` and `web/` side by side.
await cp(path.join(repo, 'apps', 'web', 'dist'), path.join(desktop, 'src-tauri', 'bundle', 'web', 'dist'), {
    recursive: true,
});

// The Claude tokenizer package ships a UMD wrapper that only loads through
// `require`, so it stays a real module next to the bundle. `dereference` copies
// the pnpm symlink's target instead of recreating the link, which Windows
// refuses without developer mode.
await cp(
    path.join(server, 'node_modules', '@agnai', 'web-tokenizers'),
    path.join(target, 'node_modules', '@agnai', 'web-tokenizers'),
    { recursive: true, dereference: true, filter: skipMaps },
);

console.log(`server bundled into ${target}`);
