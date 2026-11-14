import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { activateFixtureScope, createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

let root: string;
let groups: typeof import('./groups.js');

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

async function writeGroupFile(id: string, body: Record<string, unknown>): Promise<void> {
    await writeFile(fixturePath(root, 'groups', `${id}.json`), JSON.stringify({ id, ...body }));
}

function requireCreated(created: Awaited<ReturnType<typeof groups.createGroupChat>>) {
    if (!created) {
        throw new Error('The group chat was not created');
    }
    return created;
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-groups-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await mkdir(fixturePath(root, 'groups'), { recursive: true });
    await writeFile(fixturePath(root, 'characters', 'Aria.json'), card('Aria'));
    await writeFile(fixturePath(root, 'characters', 'Bram.json'), card('Bram'));

    // config reads CATCUP_DATA_DIR once, at import time; reset the registry so
    // the storage modules pick up the temporary directory.
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.resetModules();
    await activateFixtureScope(root);
    groups = await import('./groups.js');
}, 60_000);

afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('group storage', () => {
    it('creates a SillyTavern-shaped group file', async () => {
        const file = await groups.createGroup({
            name: 'The Cup',
            members: ['Aria.json', 'Aria.json', 'Bram.json'],
        });

        expect(file.group.id).toMatch(/^\d+/);
        expect(file.group.members).toEqual(['Aria.json', 'Bram.json']);
        expect(file.group.activation_strategy).toBe(0);
        expect(file.group.generation_mode).toBe(0);
        expect(file.group.chats).toEqual([]);

        const raw = JSON.parse(await readFile(fixturePath(root, 'groups', `${file.group.id}.json`), 'utf8'));
        expect(raw).toMatchObject({
            id: file.group.id,
            name: 'The Cup',
            members: ['Aria.json', 'Bram.json'],
            chat_id: '',
            chats: [],
        });
    });

    it('keeps only muted names that are members when creating', async () => {
        const file = await groups.createGroup({
            name: 'Muted',
            members: ['Aria.json'],
            disabled_members: ['Aria.json', 'Bram.json'],
        });

        expect(file.group.disabled_members).toEqual(['Aria.json']);
    });

    it('keeps unknown fields when a group is edited', async () => {
        await writeGroupFile('meta', {
            name: 'Old name',
            members: ['Aria.json'],
            custom_flag: 'kept',
        });

        const updated = await groups.updateGroup('meta', { name: 'New name' });

        expect(updated?.group.name).toBe('New name');
        const raw = JSON.parse(await readFile(fixturePath(root, 'groups', 'meta.json'), 'utf8'));
        expect(raw.custom_flag).toBe('kept');
        expect(raw.id).toBe('meta');
    });

    it('drops disabled members that are no longer in the group', async () => {
        await writeGroupFile('disabled', {
            name: 'Disabled',
            members: ['Aria.json', 'Bram.json'],
            disabled_members: ['Bram.json'],
        });

        const updated = await groups.updateGroup('disabled', { members: ['Aria.json'] });

        expect(updated?.group.disabled_members).toEqual([]);
    });

    it('lists groups newest first', async () => {
        const list = await groups.listGroups();
        expect(list.map((file) => file.group.id)).toContain('meta');
    });
});

describe('group chat storage', () => {
    it('creates, lists and reads a group chat', async () => {
        const { group } = await groups.createGroup({ name: 'Round table', members: ['Aria.json', 'Bram.json'] });
        const created = requireCreated(await groups.createGroupChat(group.id, 'first night'));

        expect(created.chat.chatId).toBe('first night');
        expect(created.group.group.chat_id).toBe('first night');
        expect(created.group.group.chats).toEqual(['first night']);

        await groups.appendGroupMessage(created.group.group, 'first night', {
            name: 'Aria',
            is_user: false,
            mes: 'Welcome, traveller.',
            original_avatar: 'Aria.json',
        });

        const chat = await groups.readGroupChat(created.group.group, 'first night');
        expect(chat?.messages).toHaveLength(1);
        expect(chat?.messages[0]?.original_avatar).toBe('Aria.json');

        // SillyTavern keeps the speaker's avatar at the top level of the line.
        const raw = await readFile(fixturePath(root, 'group chats', 'first night.jsonl'), 'utf8');
        const messageLine = raw.split('\n')[1] ?? '';
        expect(JSON.parse(messageLine)).toMatchObject({ name: 'Aria', original_avatar: 'Aria.json' });

        const summaries = await groups.listGroupChats(created.group.group);
        expect(summaries).toMatchObject([{ id: 'first night', messageCount: 1 }]);
    });

    it('appends several greetings in one write', async () => {
        const { group } = await groups.createGroup({ name: 'Seeded', members: ['Aria.json', 'Bram.json'] });
        const created = requireCreated(await groups.createGroupChat(group.id, 'seed test'));

        await groups.appendGroupMessages(created.group.group, 'seed test', [
            { name: 'Aria', is_user: false, mes: 'Hello.' },
            { name: 'Bram', is_user: false, mes: 'Stew is on.' },
        ]);

        const chat = await groups.readGroupChat(created.group.group, 'seed test');
        expect(chat?.messages.map((message) => message.name)).toEqual(['Aria', 'Bram']);
    });

    it('renames a chat and moves the group to it', async () => {
        const { group } = await groups.createGroup({ name: 'Renames', members: ['Aria.json'] });
        await groups.createGroupChat(group.id, 'before');

        const renamed = await groups.renameGroupChat(group.id, 'before', 'after');

        if (!renamed) {
            throw new Error('The chat was not renamed');
        }
        expect(renamed.chat.chatId).toBe('after');
        expect(renamed.group.group.chats).toEqual(['after']);
        expect(renamed.group.group.chat_id).toBe('after');
        expect(await groups.readGroupChat(renamed.group.group, 'before')).toBeNull();
    });

    it('does not make a second file when a chat keeps its name', async () => {
        const { group } = await groups.createGroup({ name: 'Same name', members: ['Aria.json'] });
        await groups.createGroupChat(group.id, 'steady');

        const updated = await groups.renameGroupChat(group.id, 'steady', 'steady');

        expect(updated?.group.group.chats).toEqual(['steady']);
    });

    it('deletes a chat and removes it from the group', async () => {
        const { group } = await groups.createGroup({ name: 'Deletes', members: ['Aria.json'] });
        await groups.createGroupChat(group.id, 'gone');

        const updated = await groups.deleteGroupChat(group.id, 'gone');

        expect(updated?.group.chats).toEqual([]);
        expect(updated?.group.chat_id).toBe('');
    });

    it('deletes a group together with its chats', async () => {
        const { group } = await groups.createGroup({ name: 'Short lived', members: ['Aria.json'] });
        const created = requireCreated(await groups.createGroupChat(group.id, 'last words'));
        await groups.appendGroupMessage(created.group.group, 'last words', {
            name: 'Aria',
            is_user: false,
            mes: 'Bye.',
            original_avatar: 'Aria.json',
        });

        expect(await groups.deleteGroup(group.id)).toBe(true);
        expect(await groups.getGroup(group.id)).toBeNull();
        expect(await groups.readGroupChat(created.group.group, 'last words')).toBeNull();
    });
});
