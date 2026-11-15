import { mkdir, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

let root: string;
let app: FastifyInstance;
let cookie: string;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name,
            first_mes: `Hello from ${name}.`,
        },
    });
}

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

async function createSet(name: string, patch: Record<string, unknown> = {}) {
    const created = await call('POST', '/api/quick-replies', { name });
    expect(created.statusCode).toBe(201);
    const set = created.json().set as Record<string, unknown>;
    if (Object.keys(patch).length === 0) {
        return set;
    }
    const body = { ...set, ...patch };
    delete body.id;
    const saved = await call('PUT', `/api/quick-replies/${encodeURIComponent(String(set.id))}`, body);
    expect(saved.statusCode).toBe(200);
    return saved.json().set as Record<string, unknown>;
}

async function createChat(): Promise<string> {
    const created = await call('POST', '/api/characters/Aria/chats', {});
    expect(created.statusCode).toBe(200);
    return created.json().chat.chatId as string;
}

async function chatMessages(chatId: string): Promise<Array<Record<string, unknown>>> {
    const response = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
    expect(response.statusCode).toBe(200);
    return response.json().chat.messages as Array<Record<string, unknown>>;
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-quick-replies-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await writeFile(fixturePath(root, 'characters', 'Aria.json'), card('Aria'));
    await writeFile(fixturePath(root, 'characters', 'Bram.json'), card('Bram'));

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'a long enough password' },
        remoteAddress: '127.0.0.1',
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}, 60_000);

afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('quick reply routes', () => {
    it('creates, updates, exports and deletes a set', async () => {
        const created = await call('POST', '/api/quick-replies', { name: 'Combat' });
        expect(created.statusCode).toBe(201);
        expect(created.json().set).toMatchObject({
            id: 'Combat',
            version: 2,
            name: 'Combat',
            qrList: [],
            idIndex: 0,
        });

        const saved = await call('PUT', '/api/quick-replies/Combat', {
            ...created.json().set,
            qrList: [{ id: 1, label: 'Attack', message: '/send I attack.' }],
            idIndex: 1,
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json().set.qrList).toHaveLength(1);

        const list = await call('GET', '/api/quick-replies');
        expect(list.json().sets).toHaveLength(1);

        const exported = await call('GET', '/api/quick-replies/Combat/export');
        expect(exported.statusCode).toBe(200);
        const body = JSON.parse(exported.body) as Record<string, unknown>;
        expect(body).not.toHaveProperty('id');
        expect(body).toMatchObject({ name: 'Combat', version: 2 });
        expect(body.qrList).toHaveLength(1);

        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'Combat', isVisible: true }] },
        });

        const removed = await call('DELETE', '/api/quick-replies/Combat');
        expect(removed.statusCode).toBe(200);

        const empty = await call('GET', '/api/quick-replies');
        expect(empty.json().sets).toEqual([]);
        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.quickReplies.setList).toEqual([]);
    });

    it('keeps fields a save does not mention', async () => {
        const set = await createSet('Preserve');
        const first: Record<string, unknown> = {
            ...set,
            custom_flag: 'kept',
            qrList: [{ id: 1, label: 'A', message: 'a', custom_reply_flag: 'kept' }],
            idIndex: 1,
        };
        delete first.id;
        const saved = await call('PUT', '/api/quick-replies/Preserve', first);
        expect(saved.statusCode).toBe(200);

        // The second save omits the unknown top-level and reply fields.
        const second = await call('PUT', '/api/quick-replies/Preserve', {
            version: 2,
            name: 'Preserve',
            qrList: [{ id: 1, label: 'B', message: 'b' }],
            idIndex: 1,
        });
        expect(second.statusCode).toBe(200);

        const list = await call('GET', '/api/quick-replies');
        const stored = (list.json().sets as Array<Record<string, unknown>>).find((item) => item.name === 'Preserve');
        expect(stored).toMatchObject({ custom_flag: 'kept' });
        const items = (stored?.qrList ?? []) as Array<Record<string, unknown>>;
        expect(items[0]).toMatchObject({
            label: 'B',
            message: 'b',
            custom_reply_flag: 'kept',
        });
    });

    it('renames a set and points the account set list at the new name', async () => {
        const set = await createSet('Old names');
        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'Old names', isVisible: true }] },
        });

        const body: Record<string, unknown> = { ...set, name: 'New names' };
        delete body.id;
        const renamed = await call('PUT', `/api/quick-replies/${encodeURIComponent(String(set.id))}`, body);
        expect(renamed.statusCode).toBe(200);
        expect(renamed.json().set).toMatchObject({ id: 'New names', name: 'New names' });
        expect(renamed.json().renamedFrom).toBe('Old names');

        // The old file is gone; the list is the route that can prove it.
        const list = await call('GET', '/api/quick-replies');
        const names = (list.json().sets as Array<{ name: string }>).map((item) => item.name);
        expect(names).not.toContain('Old names');
        expect(names).toContain('New names');

        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.quickReplies.setList).toEqual([{ set: 'New names', isVisible: true }]);
    });

    it('rewrites the set list when a rename keeps the same file id', async () => {
        // "A/B" sanitizes to the file id "AB"; renaming to "AB" changes only
        // the display name, and the set list still has to follow it.
        const set = await createSet('A/B');
        expect(set.id).toBe('AB');
        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'A/B', isVisible: true }] },
        });

        const body: Record<string, unknown> = { ...set, name: 'AB' };
        delete body.id;
        const renamed = await call('PUT', '/api/quick-replies/AB', body);
        expect(renamed.statusCode).toBe(200);
        expect(renamed.json().set).toMatchObject({ id: 'AB', name: 'AB' });
        expect(renamed.json().renamedFrom).toBe('A/B');

        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.quickReplies.setList).toEqual([{ set: 'AB', isVisible: true }]);
    });

    it('rejects a duplicate set name', async () => {
        await createSet('Twin');
        const duplicate = await call('POST', '/api/quick-replies', { name: 'twin' });
        expect(duplicate.statusCode).toBe(409);

        const other = await createSet('Other');
        const body: Record<string, unknown> = { ...other, name: 'Twin' };
        delete body.id;
        const renamed = await call('PUT', `/api/quick-replies/${encodeURIComponent(String(other.id))}`, body);
        expect(renamed.statusCode).toBe(409);
    });

    it('keeps the set list when only enabled is patched', async () => {
        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'Combat', isVisible: true }] },
        });
        const partial = await call('PATCH', '/api/settings', { quickReplies: { enabled: false } });
        expect(partial.statusCode).toBe(200);
        expect(partial.json().settings.quickReplies).toMatchObject({
            enabled: false,
            setList: [{ set: 'Combat', isVisible: true }],
        });
    });

    it('imports a SillyTavern set and a single quick reply object', async () => {
        const imported = await call('POST', '/api/quick-replies/import', {
            data: {
                version: 2,
                name: 'Imported',
                qrList: [{ id: 1, label: 'Hi', message: 'Hello there' }],
                idIndex: 1,
            },
        });
        expect(imported.statusCode).toBe(201);
        expect(imported.json().set).toMatchObject({ id: 'Imported', name: 'Imported' });
        expect(imported.json().set.qrList[0]).toMatchObject({ label: 'Hi', message: 'Hello there' });

        const single = await call('POST', '/api/quick-replies/import', {
            data: { label: 'Ping', message: '/echo ping' },
        });
        expect(single.statusCode).toBe(201);
        expect(single.json().set).toMatchObject({ name: 'Ping' });
        expect(single.json().set.qrList).toHaveLength(1);

        // Older sets may omit ids; every imported reply still needs a unique one.
        const legacy = await call('POST', '/api/quick-replies/import', {
            data: {
                version: 2,
                name: 'Legacy',
                qrList: [
                    { label: 'One', message: 'one' },
                    { label: 'Two', message: 'two' },
                ],
            },
        });
        expect(legacy.statusCode).toBe(201);
        expect(legacy.json().set.qrList.map((item: { id: number }) => item.id)).toEqual([1, 2]);

        const invalid = await call('POST', '/api/quick-replies/import', { data: { nope: true } });
        expect(invalid.statusCode).toBe(400);
    });

    it('returns input text for a plain-text quick reply', async () => {
        const chatId = await createChat();
        const set = await createSet('Text', {
            qrList: [{ id: 1, label: 'Greet', message: 'Hello {{char}}.' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            actions: [
                {
                    type: 'input',
                    text: 'Hello Aria.',
                    submit: true,
                    inject: false,
                    placeBefore: false,
                },
            ],
            appended: [],
        });
    });

    it('appends the messages /send and /sys create', async () => {
        const chatId = await createChat();
        const before = await chatMessages(chatId);
        const set = await createSet('Messages', {
            qrList: [
                { id: 1, label: 'Send', message: '/send name="Tester" Hello there' },
                { id: 2, label: 'Narrate', message: '/sys The sky darkens.' },
            ],
            idIndex: 2,
        });

        const sent = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(sent.statusCode).toBe(200);
        expect(sent.json().appended).toMatchObject([{ name: 'Tester', is_user: true, mes: 'Hello there' }]);

        const narrated = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 2,
        });
        expect(narrated.statusCode).toBe(200);
        expect(narrated.json().appended).toMatchObject([{ name: 'System', is_user: false, mes: 'The sky darkens.' }]);
        expect(narrated.json().appended[0].extra).toMatchObject({ type: 'narrator' });

        const after = await chatMessages(chatId);
        expect(after).toHaveLength(before.length + 2);
        expect(after.at(-2)).toMatchObject({ name: 'Tester', is_user: true, mes: 'Hello there' });
        expect(after.at(-1)).toMatchObject({ mes: 'The sky darkens.' });
    });

    it('appends then returns a generation directive for /send | /trigger', async () => {
        const chatId = await createChat();
        const set = await createSet('Chain', {
            qrList: [{ id: 1, label: 'Say and ask', message: '/send one | /trigger' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().appended).toMatchObject([{ is_user: true, mes: 'one' }]);
        expect(response.json().actions).toEqual([{ type: 'generate', mode: 'trigger' }]);
    });

    it('refuses a generation command that is not last', async () => {
        const chatId = await createChat();
        const before = await chatMessages(chatId);
        const set = await createSet('Bad chain', {
            qrList: [{ id: 1, label: 'Bad', message: '/trigger | /send two' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('/trigger must be the last command');
        expect(await chatMessages(chatId)).toHaveLength(before.length);
    });

    it('validates the whole script before appending anything', async () => {
        const chatId = await createChat();
        const before = await chatMessages(chatId);
        const set = await createSet('Partial', {
            qrList: [{ id: 1, label: 'Bad tail', message: '/send one | /send' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('/send command needs text');
        expect(await chatMessages(chatId)).toHaveLength(before.length);
    });

    it('runs another quick reply by label', async () => {
        const chatId = await createChat();
        await createSet('Nested', {
            qrList: [
                { id: 1, label: 'Nested echo', message: '/echo nested hello' },
                { id: 2, label: 'Nested text', message: 'Hello {{char}}.' },
            ],
            idIndex: 2,
        });
        const outer = await createSet('Outer', {
            qrList: [
                { id: 1, label: 'Run nested', message: '/run Nested echo' },
                { id: 2, label: 'Run text', message: '/run Nested text' },
            ],
            idIndex: 2,
        });
        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'Nested', isVisible: true }] },
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: outer.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().actions).toEqual([{ type: 'toast', message: 'nested hello', severity: 'info' }]);

        // A nested plain-text reply is expanded and inserted like a top-level one.
        const text = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: outer.id,
            qrId: 2,
        });
        expect(text.statusCode).toBe(200);
        expect(text.json().actions).toEqual([
            { type: 'input', text: 'Hello Aria.', submit: true, inject: false, placeBefore: false },
        ]);
    });

    it('runs a bare label only from an active set, or by Set.Label', async () => {
        const chatId = await createChat();
        await createSet('Inactive', {
            qrList: [{ id: 1, label: 'Inactive echo', message: '/echo inactive hello' }],
            idIndex: 1,
        });
        const outer = await createSet('Outer inactive', {
            qrList: [
                { id: 1, label: 'Bare', message: '/run Inactive echo' },
                { id: 2, label: 'Qualified', message: '/run Inactive.Inactive echo' },
            ],
            idIndex: 2,
        });
        await call('PATCH', '/api/settings', {
            quickReplies: { enabled: true, setList: [{ set: 'Nested', isVisible: true }] },
        });

        const bare = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: outer.id,
            qrId: 1,
        });
        expect(bare.statusCode).toBe(400);
        expect(bare.json().error).toContain('No quick reply named "Inactive echo"');

        const qualified = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: outer.id,
            qrId: 2,
        });
        expect(qualified.statusCode).toBe(200);
        expect(qualified.json().actions).toEqual([{ type: 'toast', message: 'inactive hello', severity: 'info' }]);
    });

    it('expands macros in command arguments', async () => {
        const chatId = await createChat();
        const set = await createSet('Macros', {
            qrList: [
                { id: 1, label: 'Name', message: '/send name="{{char}}" Hello' },
                { id: 2, label: 'Title', message: '/echo title="{{user}}" Done' },
                { id: 3, label: 'Timeout', message: '/echo timeout=5000 Done too' },
            ],
            idIndex: 3,
        });

        const send = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(send.statusCode).toBe(200);
        expect(send.json().appended[0]).toMatchObject({ name: 'Aria', mes: 'Hello' });

        const echo = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 2,
        });
        expect(echo.statusCode).toBe(200);
        expect(echo.json().actions).toEqual([{ type: 'toast', message: 'Done', title: 'You', severity: 'info' }]);

        // Echo's other ST arguments are consumed, not shown in the toast.
        const timeout = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 3,
        });
        expect(timeout.statusCode).toBe(200);
        expect(timeout.json().actions).toEqual([{ type: 'toast', message: 'Done too', severity: 'info' }]);
    });

    it('returns the message literally when disableSend is on', async () => {
        const chatId = await createChat();
        const set = await createSet('Draft', {
            disableSend: true,
            placeBeforeInput: true,
            injectInput: true,
            qrList: [{ id: 1, label: 'Draft', message: '/send not run' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            actions: [
                {
                    type: 'input',
                    text: '/send not run',
                    submit: false,
                    inject: true,
                    placeBefore: true,
                },
            ],
            appended: [],
        });
    });

    it('rejects an unsupported command without touching the chat', async () => {
        const chatId = await createChat();
        const before = await chatMessages(chatId);
        const set = await createSet('Unsupported', {
            qrList: [{ id: 1, label: 'Bad', message: '/setvar x 1' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('Unsupported quick reply command');
        expect(await chatMessages(chatId)).toHaveLength(before.length);
    });

    it('reports a missing set or quick reply', async () => {
        const chatId = await createChat();
        const set = await createSet('Missing');

        const missingSet = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: 'Not here',
            qrId: 1,
        });
        expect(missingSet.statusCode).toBe(404);

        const missingReply = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 99,
        });
        expect(missingReply.statusCode).toBe(404);
    });

    it('runs in a group chat and resolves a /trigger speaker', async () => {
        const group = await call('POST', '/api/groups', { name: 'Quick group', members: ['Aria', 'Bram'] });
        expect(group.statusCode).toBe(201);
        const groupId = group.json().group.id as string;
        const createdChat = await call('POST', `/api/groups/${groupId}/chats`, {});
        expect(createdChat.statusCode).toBe(201);
        const chatId = createdChat.json().chat.chatId as string;

        const set = await createSet('Group replies', {
            qrList: [
                { id: 1, label: 'Narrate', message: '/sys The room falls silent.' },
                { id: 2, label: 'Ask Bram', message: '/trigger 1' },
                { id: 3, label: 'Speak', message: '/send Hello, group.' },
                { id: 4, label: 'Ask by macro', message: '/trigger {{char}}' },
            ],
            idIndex: 4,
        });

        const narrated = await call(
            'POST',
            `/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}/quick-replies/execute`,
            { setId: set.id, qrId: 1 },
        );
        expect(narrated.statusCode).toBe(200);
        expect(narrated.json().appended[0]).toMatchObject({ mes: 'The room falls silent.' });
        expect(narrated.json().appended[0].extra).toMatchObject({ type: 'narrator' });

        const triggered = await call(
            'POST',
            `/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}/quick-replies/execute`,
            { setId: set.id, qrId: 2 },
        );
        expect(triggered.statusCode).toBe(200);
        expect(triggered.json().actions).toEqual([{ type: 'generate', mode: 'trigger', speaker: 'Bram.json' }]);

        const spoken = await call(
            'POST',
            `/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}/quick-replies/execute`,
            { setId: set.id, qrId: 3 },
        );
        expect(spoken.statusCode).toBe(200);
        expect(spoken.json().appended[0]).toMatchObject({ is_user: true, mes: 'Hello, group.' });

        // The command argument sees the same macros as message text.
        const byMacro = await call(
            'POST',
            `/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}/quick-replies/execute`,
            { setId: set.id, qrId: 4 },
        );
        expect(byMacro.statusCode).toBe(200);
        expect(byMacro.json().actions).toEqual([{ type: 'generate', mode: 'trigger', speaker: 'Bram' }]);
    });

    it('rejects an unknown /run target without appending', async () => {
        const chatId = await createChat();
        const set = await createSet('Runs nowhere', {
            qrList: [{ id: 1, label: 'Run missing', message: '/send hi | /run Nowhere' }],
            idIndex: 1,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('No quick reply named "Nowhere"');
    });

    it('rejects unsupported named arguments on /run', async () => {
        const chatId = await createChat();
        const set = await createSet('Run args', {
            qrList: [
                { id: 1, label: 'Echo', message: '/echo hi' },
                { id: 2, label: 'Run with args', message: '/run args="x" Echo' },
            ],
            idIndex: 2,
        });

        const response = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 2,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('The "args" argument is not supported for /run');
    });
});
