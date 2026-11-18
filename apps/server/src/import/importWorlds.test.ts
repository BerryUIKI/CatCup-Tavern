import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The import's report, not its scan.
 *
 * `worldIds` exists so the import dialog can offer to generate aliases for the
 * books it just wrote. If it drifted from what actually landed, the offer would
 * name a book that is not there — which is why this asserts against the folder
 * rather than against the count.
 */

let root = '';
let source = '';

afterEach(async () => {
    for (const dir of [root, source]) {
        if (dir) {
            await rm(dir, { recursive: true, force: true });
        }
    }
    root = '';
    source = '';
    vi.unstubAllEnvs();
});

async function prepare(): Promise<void> {
    root = await createProfileDataDir('catcup-import-');
    source = await mkdtemp(path.join(tmpdir(), 'catcup-st-source-'));
    await mkdir(path.join(source, 'worlds'), { recursive: true });

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();

    const { ensureDataDirs, setActiveScope } = await import('../storage/paths.js');
    setActiveScope(fixturePath(root));
    await ensureDataDirs();
}

describe('importing a SillyTavern folder', () => {
    it('reports the ids of the books it wrote', async () => {
        await prepare();
        await writeFile(
            path.join(source, 'worlds', 'eldoria.json'),
            `${JSON.stringify({ entries: { '0': { uid: 0, key: ['公主'], content: 'A princess.' } } })}\n`,
            'utf8',
        );

        const { importSillyTavern } = await import('./sillytavern.js');
        const result = await importSillyTavern(source);

        expect(result.imported.worlds).toBe(1);
        expect(result.worldIds).toEqual(['eldoria']);

        // The id is a real book on disk, which is what makes it usable as the
        // book the dialog opens next.
        const written = await readdir(fixturePath(root, 'worlds'));
        expect(written).toContain('eldoria.json');
    });

    it('reports nothing when the folder had no books', async () => {
        await prepare();
        await mkdir(path.join(source, 'characters'), { recursive: true });
        await writeFile(
            path.join(source, 'characters', 'Seraphina.json'),
            `${JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Seraphina', description: 'A mage.' } })}\n`,
            'utf8',
        );

        const { importSillyTavern } = await import('./sillytavern.js');
        const result = await importSillyTavern(source);

        expect(result.imported.characters).toBe(1);
        expect(result.worldIds).toEqual([]);
    });

    it('leaves a book out of the report when the file could not be read', async () => {
        await prepare();
        await writeFile(path.join(source, 'worlds', 'broken.json'), 'not json at all', 'utf8');
        await writeFile(path.join(source, 'worlds', 'fine.json'), `${JSON.stringify({ entries: {} })}\n`, 'utf8');

        const { importSillyTavern } = await import('./sillytavern.js');
        const result = await importSillyTavern(source);

        // A failed file is reported as an error and never as a book to offer.
        expect(result.errors.some((error) => error.includes('broken.json'))).toBe(true);
        expect(result.worldIds).toEqual(['fine']);
    });
});
