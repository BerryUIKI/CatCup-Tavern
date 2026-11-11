import { existsSync } from 'node:fs';
import path from 'node:path';

import { config } from './config.js';

/**
 * Where the server's shipped assets live.
 *
 * Three layouts have to work: an explicit `CATCUP_ASSETS_DIR`, the packaged
 * build where `assets/` sits beside `dist/`, and a development checkout where
 * this module is one level below `apps/server`.
 */
export function assetsDir(): string {
    const configured = process.env.CATCUP_ASSETS_DIR?.trim();
    if (configured) {
        return path.resolve(configured);
    }

    // `dist/index.js` → `dist/../assets`; `src/assets.ts` → `src/../assets`.
    const besideOutput = path.resolve(import.meta.dirname, '../assets');
    if (existsSync(besideOutput)) {
        return besideOutput;
    }

    return path.join(config.repoRoot, 'apps/server/assets');
}

/** Absolute path of a file inside the assets folder. */
export function assetPath(...parts: string[]): string {
    return path.join(assetsDir(), ...parts);
}
