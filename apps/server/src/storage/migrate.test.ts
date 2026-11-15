import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Migrate from './migrate.js';

let root: string;
let migrate: typeof Migrate;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

/** A data folder in the pre-profile shape: one shared tree, one settings file. */
async function writeLegacyTree(): Promise<void> {
    await mkdir(path.join(root, 'characters'), { recursive: true });
    await mkdir(path.join(root, 'chats', 'Aria'), { recursive: true });
    await mkdir(path.join(root, 'worlds'), { recursive: true });
    await mkdir(path.join(root, 'user', 'images', 'Aria'), { recursive: true });
    await writeFile(path.join(root, 'characters', 'Aria.json'), card('Aria'));
    await writeFile(path.join(root, 'chats', 'Aria', 'night.jsonl'), '{"chat_metadata":{}}\n');
    await writeFile(path.join(root, 'worlds', 'Lore.json'), '{"entries":{}}');
    await writeFile(path.join(root, 'user', 'images', 'Aria', 'pic.png'), 'x');
    await writeFile(
        path.join(root, 'regex.json'),
        JSON.stringify({ scripts: [{ scriptName: 'Trim', findRegex: '/x/g' }] }),
    );
    await writeFile(
        path.join(root, 'settings.json'),
        JSON.stringify({
            version: 1,
            activeProviderId: 'provider-1',
            providers: [
                {
                    id: 'provider-1',
                    kind: 'custom',
                    name: 'Endpoint',
                    baseUrl: 'http://127.0.0.1:1/v1',
                    model: 'old-model',
                    enabled: true,
                    headers: {},
                },
            ],
            generation: { temperature: 0.7, maxTokens: 100 },
        }),
    );
}

beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-migrate-'));
    await writeLegacyTree();
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.resetModules();
    migrate = await import('./migrate.js');
});

afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('data folder migration', () => {
    it('plans the move without touching anything', async () => {
        const plan = await migrate.planMigration();
        expect(plan.needed).toBe(true);
        expect(plan.entries.map((entry) => entry.from)).toEqual(
            expect.arrayContaining(['characters', 'chats', 'worlds', 'regex.json']),
        );
        expect(plan.providerCount).toBe(1);

        // The plan is a report, not an action.
        await expect(stat(path.join(root, 'characters', 'Aria.json'))).resolves.toBeTruthy();
        await expect(stat(path.join(root, 'profiles'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('moves content into a Default profile and writes the index last', async () => {
        const plan = await migrate.migrateDataFolder();
        expect(plan.needed).toBe(true);

        const profile = path.join(root, 'profiles', 'default');
        await expect(stat(path.join(profile, 'characters', 'Aria.json'))).resolves.toBeTruthy();
        await expect(stat(path.join(profile, 'chats', 'Aria', 'night.jsonl'))).resolves.toBeTruthy();
        await expect(stat(path.join(profile, 'worlds', 'Lore.json'))).resolves.toBeTruthy();
        await expect(stat(path.join(profile, 'user', 'images', 'Aria', 'pic.png'))).resolves.toBeTruthy();
        await expect(stat(path.join(profile, 'regex.json'))).resolves.toBeTruthy();

        // The old locations are gone, so a second run has nothing to do.
        await expect(stat(path.join(root, 'characters'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await migrate.planMigration()).needed).toBe(false);
    });

    it('lifts providers into the shared file and keeps them out of the profile', async () => {
        await migrate.migrateDataFolder();

        const providers = JSON.parse(await readFile(path.join(root, 'providers.json'), 'utf8')) as Array<{
            id: string;
            model: string;
        }>;
        expect(providers).toHaveLength(1);
        expect(providers[0]?.id).toBe('provider-1');

        const profileSettings = JSON.parse(
            await readFile(path.join(root, 'profiles', 'default', 'settings.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(profileSettings.providers).toBeUndefined();
        expect(profileSettings.activeProviderId).toBe('provider-1');
        expect(profileSettings.generation).toMatchObject({ temperature: 0.7 });

        // The pre-migration file is kept, and the index is in place.
        await expect(stat(path.join(root, 'settings.json.v1-backup'))).resolves.toBeTruthy();
        const index = JSON.parse(await readFile(path.join(root, 'settings.json'), 'utf8')) as {
            version: number;
            activeProfileId: string;
            profiles: Array<{ id: string; name: string }>;
        };
        expect(index.version).toBe(2);
        expect(index.activeProfileId).toBe('default');
        expect(index.profiles[0]?.name).toBe('Default');
    });

    it('logs each step', async () => {
        await migrate.migrateDataFolder();
        const log = await readFile(path.join(root, 'migration.log'), 'utf8');
        expect(log).toContain('migration start');
        expect(log).toContain('moved characters');
        expect(log).toContain('wrote profile index');
        expect(log).toContain('migration complete');
    });

    it('does nothing on a folder already in the new shape', async () => {
        await mkdir(path.join(root, 'profiles', 'default'), { recursive: true });
        const plan = await migrate.migrateDataFolder();
        expect(plan.needed).toBe(false);
        // The pre-profile tree is left alone rather than moved a second time.
        await expect(stat(path.join(root, 'characters', 'Aria.json'))).resolves.toBeTruthy();
    });
});
