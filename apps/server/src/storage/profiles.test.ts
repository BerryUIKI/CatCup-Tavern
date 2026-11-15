import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/** The seeded profile, or a failure if the index could not be read. */
async function seededProfile(): Promise<string> {
    const index = await profilesModule.readProfileIndex();
    const first = index?.profiles[0];
    if (!first) {
        throw new Error('the profile index was not seeded');
    }
    return first.id;
}

import type * as Characters from './characters.js';
import type * as Chats from './chats.js';
import type * as Paths from './paths.js';
import type * as Profiles from './profiles.js';

let root: string;
let characters: typeof Characters;
let chats: typeof Chats;
let profilesModule: typeof Profiles;
let pathsModule: typeof Paths;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-profile-scope-'));
    // A tree already in the profile shape, so no migration runs and the ids are
    // the ones this test writes.
    await mkdir(path.join(root, 'profiles', 'alpha'), { recursive: true });
    await mkdir(path.join(root, 'profiles', 'beta'), { recursive: true });

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.resetModules();
    characters = await import('./characters.js');
    chats = await import('./chats.js');
    profilesModule = await import('./profiles.js');
    pathsModule = await import('./paths.js');
}, 60_000);

afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('profile scopes', () => {
    it('keeps two characters with the same id apart', async () => {
        // Same file name in both profiles: the case that made sharing wrong.
        await mkdir(path.join(root, 'profiles', 'alpha', 'characters'), { recursive: true });
        await mkdir(path.join(root, 'profiles', 'beta', 'characters'), { recursive: true });
        await writeFile(path.join(root, 'profiles', 'alpha', 'characters', 'Mira.json'), card('Mira the innkeeper'));
        await writeFile(path.join(root, 'profiles', 'beta', 'characters', 'Mira.json'), card('Mira the detective'));

        await profilesModule.activateProfile('alpha');
        const alpha = await characters.getCharacter('Mira');
        expect(alpha?.card.name).toBe('Mira the innkeeper');

        await profilesModule.activateProfile('beta');
        const beta = await characters.getCharacter('Mira');
        expect(beta?.card.name).toBe('Mira the detective');

        // Switching back must show the first one again, not a cached copy.
        await profilesModule.activateProfile('alpha');
        expect((await characters.getCharacter('Mira'))?.card.name).toBe('Mira the innkeeper');
    });

    it('reports which profile is active from the scope path', async () => {
        await profilesModule.activateProfile('beta');
        expect(profilesModule.activeProfileId()).toBe('beta');
        expect(pathsModule.getActiveScope()).toBe(path.join(root, 'profiles', 'beta'));
    });

    it('writes a chat inside the active profile', async () => {
        await profilesModule.activateProfile('alpha');
        const chat = await characters.getCharacter('Mira');
        if (!chat) {
            throw new Error('the fixture card was not found');
        }
        const created = await chats.createChat(chat, {});
        expect(created.chatId.length).toBeGreaterThan(0);

        // A chat is filed under the card's display name, not its file id.
        const file = path.join(root, 'profiles', 'alpha', 'chats', 'Mira the innkeeper', `${created.chatId}.jsonl`);
        await expect(stat(file)).resolves.toBeTruthy();
        await expect(stat(path.join(root, 'profiles', 'beta', 'chats', 'Mira the innkeeper'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });
});

describe('profile index', () => {
    it('creates, lists, renames and archives a profile', async () => {
        await profilesModule.seedProfileIndex('First');
        const index = await profilesModule.readProfileIndex();
        expect(index?.profiles.map((entry) => entry.name)).toEqual(['First']);
        const firstId = await seededProfile();
        await profilesModule.activateProfile(firstId);

        const second = await profilesModule.createProfile({ name: 'Second' });
        const secondDir = path.join(root, 'profiles', second.id);
        expect((await profilesModule.listProfiles()).profiles.map((entry) => entry.name)).toEqual(['First', 'Second']);

        await profilesModule.renameProfile(second.id, { name: 'Second campaign' });
        expect((await profilesModule.listProfiles()).profiles.map((entry) => entry.name)).toContain('Second campaign');

        // Archiving the active profile is refused; the other one is fine.
        await expect(profilesModule.archiveProfile(firstId)).rejects.toThrow(/active/);
        await mkdir(secondDir, { recursive: true });
        await profilesModule.archiveProfile(second.id);
        expect((await profilesModule.listProfiles()).profiles.map((entry) => entry.name)).toEqual(['First']);
        expect((await profilesModule.listArchivedProfiles()).map((entry) => entry.id)).toContain(second.id);

        await profilesModule.restoreProfile(second.id);
        expect((await profilesModule.listProfiles()).profiles.map((entry) => entry.name)).toContain('Second campaign');
    });

    it('refuses to archive the last profile', async () => {
        await profilesModule.seedProfileIndex('Only');
        const onlyId = await seededProfile();
        await profilesModule.activateProfile(onlyId);
        await expect(profilesModule.archiveProfile(onlyId)).rejects.toThrow();
    });

    it('only permanently deletes an archived profile', async () => {
        await profilesModule.seedProfileIndex('Keep');
        const liveId = await seededProfile();
        await profilesModule.activateProfile(liveId);
        // A live profile is refused, so the destructive path is always two steps.
        await expect(profilesModule.deleteArchivedProfile(liveId)).rejects.toThrow(/Archive/);
    });

    it('copies configuration but never content when asked', async () => {
        await profilesModule.seedProfileIndex('Source');
        const sourceId = await seededProfile();
        await profilesModule.activateProfile(sourceId);

        await mkdir(path.join(root, 'profiles', sourceId, 'characters'), { recursive: true });
        await writeFile(path.join(root, 'profiles', sourceId, 'characters', 'Aria.json'), card('Aria'));
        await writeFile(
            path.join(root, 'profiles', sourceId, 'settings.json'),
            JSON.stringify({ version: 1, profilePreferredModel: 'copied-model' }),
        );

        const copy = await profilesModule.createProfile({ name: 'Copy', copyFromId: sourceId });
        const copiedSettings = JSON.parse(
            await readFile(path.join(root, 'profiles', copy.id, 'settings.json'), 'utf8'),
        ) as { profilePreferredModel: string };
        expect(copiedSettings.profilePreferredModel).toBe('copied-model');
        await expect(stat(path.join(root, 'profiles', copy.id, 'characters', 'Aria.json'))).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });
});
