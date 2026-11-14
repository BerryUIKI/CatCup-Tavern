import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, TEST_PROFILE_ID } from '../testHelpers/profile.js';

/**
 * The shared layer, exercised against a real data folder.
 *
 * These tests drive the storage modules directly rather than the routes: the
 * rule being checked — the profile's item wins on a collision, and a move keeps
 * the id so every existing link still resolves — is a storage invariant, and a
 * route test would only restate it.
 */

let root: string;

/** Point the storage layer at a scratch data folder in the profile shape. */
async function useDataFolder(): Promise<typeof import('../storage/paths.js')> {
    const paths = await import('../storage/paths.js');
    paths.setActiveScope(path.join(root, 'profiles', TEST_PROFILE_ID));
    await paths.ensureDataDirs();
    return paths;
}

async function writeCard(directory: string, id: string, name: string): Promise<void> {
    await mkdir(directory, { recursive: true });
    const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description: 'x', extensions: {} } };
    await writeFile(path.join(directory, `${id}.json`), JSON.stringify(card), 'utf8');
}

beforeEach(async () => {
    vi.resetModules();
    root = await createProfileDataDir('catcup-shared-');
    process.env.CATCUP_DATA_DIR = root;
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.CATCUP_DATA_DIR;
});

describe('the shared scope', () => {
    it('shows a shared card to the profile, and the profile card wins a collision', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.sharedCharacters, 'Mira', 'Mira the traveller');
        await writeCard(paths.paths.characters, 'Mira', 'Mira the detective');

        const characters = await import('../storage/characters.js');
        const listed = await characters.listCharacters();

        // One row, not two: an id addresses one card.
        expect(listed).toHaveLength(1);
        expect(listed[0]?.scope).toBe('profile');
        expect(listed[0]?.shadowed).toBe(true);
        expect(listed[0]?.name).toBe('Mira the detective');

        // And a lookup by id agrees with the listing.
        expect((await characters.getCharacter('Mira'))?.name).toBe('Mira the detective');
    });

    it('resolves a shared card by id when the profile has none', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.sharedCharacters, 'Nyx', 'Nyx');

        const characters = await import('../storage/characters.js');
        const found = await characters.getCharacter('Nyx');

        expect(found?.scope).toBe('shared');
        expect(found?.name).toBe('Nyx');
    });

    it('keeps the id across a move, so an existing chat or group link still resolves', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.characters, 'Mira', 'Mira');

        const characters = await import('../storage/characters.js');
        const moved = await characters.changeCharacterScope('Mira', 'shared');

        expect(moved).toMatchObject({ id: 'Mira', scope: 'shared' });
        const found = await characters.getCharacter('Mira');
        expect(found?.scope).toBe('shared');

        // The old scope is empty, so the card exists exactly once.
        const again = await characters.listCharacters();
        expect(again).toHaveLength(1);
    });

    it('copies a shared card into the profile under a free id, leaving the original', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.sharedCharacters, 'Mira', 'Shared Mira');
        await writeCard(paths.paths.characters, 'Mira', 'Own Mira');

        const characters = await import('../storage/characters.js');
        const copy = await characters.copyCharacterIntoScope('Mira', 'profile');

        // The profile already had `Mira`, so the copy takes the next free name.
        expect(copy.scope).toBe('profile');
        expect(copy.id).not.toBe('Mira');

        // Both originals survive: copy never deletes.
        const shared = await characters.getCharacter('Mira');
        expect(shared?.scope).toBe('profile');
        expect(shared?.name).toBe('Own Mira');
    });

    it('refuses to move an item onto an id the destination already holds', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.characters, 'Mira', 'Own Mira');
        await writeCard(paths.paths.sharedCharacters, 'Mira', 'Shared Mira');

        const characters = await import('../storage/characters.js');
        await expect(characters.changeCharacterScope('Mira', 'shared')).rejects.toThrow(/already has an item/i);
    });

    it('leaves the profile folder untouched when another profile owns the same id', async () => {
        const paths = await useDataFolder();
        await writeCard(paths.paths.characters, 'Mira', 'Novel Mira');

        // A second profile with its own Mira, written by hand as a folder.
        const other = path.join(root, 'profiles', 'mystery');
        await writeCard(path.join(other, 'characters'), 'Mira', 'Mystery Mira');

        const characters = await import('../storage/characters.js');
        expect((await characters.getCharacter('Mira'))?.name).toBe('Novel Mira');

        paths.setActiveScope(other);
        expect((await characters.getCharacter('Mira'))?.name).toBe('Mystery Mira');
    });
});

describe('worlds across scopes', () => {
    const book = { entries: { 0: { uid: 0, key: ['mira'], content: 'A traveller.' } } };

    it('lists and reads a shared book, and the profile book shadows it', async () => {
        const paths = await useDataFolder();
        const worlds = await import('../storage/worlds.js');

        await worlds.createWorld({ fileName: 'Eldoria', book, scope: 'shared' });
        await worlds.createWorld({ fileName: 'Eldoria', book: { entries: {} }, scope: 'profile' });

        const listed = await worlds.listWorlds();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.scope).toBe('profile');
        expect(listed[0]?.shadowed).toBe(true);
        expect((await worlds.readWorld('Eldoria'))?.scope).toBe('profile');
        expect(paths.paths.sharedWorlds).toContain('shared');
    });

    it('edits a shared book in place rather than the profile copy', async () => {
        const paths = await useDataFolder();
        const worlds = await import('../storage/worlds.js');
        await worlds.createWorld({ fileName: 'Eldoria', book, scope: 'shared' });

        const result = await worlds.updateWorldEntry('Eldoria', 0, { content: 'Changed.' });
        expect(result.status).toBe('ok');

        const read = await worlds.readWorld('Eldoria');
        expect(read?.scope).toBe('shared');
        expect(read?.entries[0]?.content).toBe('Changed.');
        expect(paths.paths.sharedWorlds).toContain('shared');
    });
});

describe('regex across scopes', () => {
    it('runs profile rules before shared ones', async () => {
        await useDataFolder();
        const regex = await import('../storage/regex.js');

        await regex.createRegexScript({ scriptName: 'shared', findRegex: 'a', replaceString: 'b' }, 'shared');
        await regex.createRegexScript({ scriptName: 'own', findRegex: 'c', replaceString: 'd' }, 'profile');

        const listed = await regex.listRegexScripts();
        expect(listed.map((script) => `${script.scope}:${script.scriptName}`)).toEqual([
            'profile:own',
            'shared:shared',
        ]);
    });

    it('drops a shared rule whose id a profile rule uses, and marks the winner', async () => {
        await useDataFolder();
        const regex = await import('../storage/regex.js');
        const { mkdir, writeFile } = await import('node:fs/promises');
        const paths = await import('../storage/paths.js');

        // Write the two files by hand: a create mints a fresh id, and the case
        // under test is the one where both scopes carry the same id.
        const script = { id: 'rule-1', scriptName: 'shared', findRegex: 'a', replaceString: 'b' };
        await mkdir(paths.paths.shared, { recursive: true });
        await writeFile(paths.paths.sharedRegex, JSON.stringify({ scripts: [script] }), 'utf8');
        await writeFile(paths.paths.regex, JSON.stringify({ scripts: [{ ...script, scriptName: 'own' }] }), 'utf8');

        const listed = await regex.listRegexScripts();
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({ id: 'rule-1', scope: 'profile', scriptName: 'own', shadowed: true });
    });

    it('imports into the target scope without wiping the other list', async () => {
        await useDataFolder();
        const regex = await import('../storage/regex.js');
        await regex.createRegexScript({ scriptName: 'shared rule' }, 'shared');

        await regex.importRegexScripts([{ scriptName: 'imported' }], 'replace', 'profile');

        const scopes = (await regex.listRegexScripts()).map((script) => `${script.scope}:${script.scriptName}`);
        expect(scopes).toEqual(['profile:imported', 'shared:shared rule']);
    });
});

describe('personas across scopes', () => {
    it('merges the shared list into the profile and marks a shadowing id', async () => {
        await useDataFolder();
        const { addSharedPersona, listAllPersonas } = await import('../storage/personas.js');

        const shared = await addSharedPersona('Alex', 'A reusable persona');
        const merged = await listAllPersonas([{ id: shared.id, name: 'Own Alex', description: '' }]);

        // One entry per id: the profile's version is what a pin resolves to.
        expect(merged).toHaveLength(1);
        expect(merged[0]?.name).toBe('Own Alex');
    });

    it('keeps a shared persona out of the profile settings file', async () => {
        const paths = await useDataFolder();
        const { addSharedPersona } = await import('../storage/personas.js');
        const settings = await import('../storage/settings.js');

        await addSharedPersona('Alex', 'shared');
        // Writing settings must not persist the shared persona into the profile.
        await settings.updateSettings({ generation: { temperature: 0.9 } });

        const raw = JSON.parse(await (await import('node:fs/promises')).readFile(paths.paths.settings, 'utf8')) as {
            personas: { name: string; scope?: string }[];
        };

        expect(raw.personas.some((persona) => persona.name === 'Alex')).toBe(false);
        // `scope` is derived on read, never stored.
        expect(raw.personas.every((persona) => persona.scope === undefined)).toBe(true);
        // …but it is visible through the merged read.
        expect((await settings.getSettings()).personas.some((persona) => persona.name === 'Alex')).toBe(true);
    });

    it('does not duplicate a shared persona after a later settings save', async () => {
        await useDataFolder();
        const { addSharedPersona } = await import('../storage/personas.js');
        const { getSettingsResponse, updateSettings } = await import('../storage/settings.js');

        await addSharedPersona('Alex', 'shared');
        // A second save is where a merge-then-write bug would show: the merged
        // list would be persisted and come back as a profile entry as well.
        await updateSettings({ generation: { temperature: 0.5 } });

        const response = await getSettingsResponse();
        const alex = response.personas.filter((persona) => persona.name === 'Alex');
        expect(alex).toHaveLength(1);
        expect(alex[0]?.scope).toBe('shared');
    });
});
