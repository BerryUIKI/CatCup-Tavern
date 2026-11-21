import { mkdir, rm, writeFile } from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The conversation: binding, commands, the reply path and its refusals.
 *
 * These drive the real binding sidecar and the real chat storage, because the
 * behaviour that matters is what ends up on disk — "bound to the newest chat",
 * "a deleted chat is reported rather than recreated". The generation call is
 * faked, since what is under test is what happens around it.
 */

let root: string;

beforeAll(async () => {
    root = await createProfileDataDir('catcup-im-conversation-');
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();

    const { setActiveScope, ensureDataDirs } = await import('../storage/paths.js');
    setActiveScope(fixturePath(root));
    await ensureDataDirs();

    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    for (const name of ['Aurelia', 'Bram']) {
        await writeFile(
            fixturePath(root, 'characters', `${name}.json`),
            JSON.stringify({
                spec: 'chara_card_v2',
                spec_version: '2.0',
                data: { name, description: `${name} stands here.`, first_mes: `I am ${name}.` },
            }),
            'utf8',
        );
    }
}, 60_000);

afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

/** A transport that records what was sent instead of sending it. */
function recorder() {
    const sent: Array<{ chatId: string; text: string }> = [];
    return {
        sent,
        text: () => sent.map((entry) => entry.text),
        transport: {
            send: async (chatId: string, text: string) => {
                sent.push({ chatId, text });
            },
        },
    };
}

function message(text: string, chatId = 'tg-1'): { chatId: string; userId: string; text: string; messageId: string } {
    return { chatId, userId: '999', text, messageId: '1' };
}

/**
 * Fresh modules per test, so in-flight state and bindings do not leak across.
 *
 * The storage scope is reset with them: `resetModules` gives the storage layer a
 * new module instance whose scope is the config default, not the fixture.
 */
async function load() {
    vi.resetModules();
    const { setActiveScope } = await import('../storage/paths.js');
    setActiveScope(fixturePath(root));
    const conversation = await import('./conversation.js');
    const bindings = await import('./bindings.js');
    return { ...conversation, ...bindings };
}

describe('binding a conversation', () => {
    it('says so when nothing is bound', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('Hello?'), { transport: sink.transport, generate: async () => 'never' });

        expect(sink.text()[0]).toContain('/chat');
    });

    it('binds to the character’s newest chat rather than making one', async () => {
        const { handleMessage, readBinding } = await load();
        const sink = recorder();

        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });

        const binding = await readBinding('tg-1');
        expect(binding?.characterId).toBe('Aurelia');
        expect(sink.text()[0]).toContain('Aurelia');

        const { listChats } = await import('../storage/chats.js');
        const { requireCharacter } = await import('../routes/helpers.js');
        const chats = await listChats(await requireCharacter('Aurelia'));
        // One chat was created for the first bind; a second bind must reuse it.
        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });
        expect(await listChats(await requireCharacter('Aurelia'))).toHaveLength(chats.length);
    });

    it('lists the characters when /chat has no argument', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/chat'), { transport: sink.transport, generate: async () => 'never' });

        expect(sink.text()[0]).toContain('Aurelia');
        expect(sink.text()[0]).toContain('Bram');
    });

    it('names an unknown character instead of binding something else', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/chat Nobody'), { transport: sink.transport, generate: async () => 'never' });

        expect(sink.text()[0]).toContain('Nobody');
    });

    it('stores the binding in a sidecar, not in any chat file', async () => {
        const { handleMessage, bindingFileFor } = await load();
        const sink = recorder();
        await handleMessage(message('/chat Bram'), { transport: sink.transport, generate: async () => 'never' });

        const { readFile } = await import('node:fs/promises');
        const file = await readFile(bindingFileFor(), 'utf8');
        expect(JSON.parse(file).bindings['tg-1'].characterId).toBe('Bram');

        // And no chat in the profile mentions the transport: the story file is
        // exactly what it would be without an IM channel.
        const { listChats } = await import('../storage/chats.js');
        const { requireCharacter } = await import('../routes/helpers.js');
        const chats = await listChats(await requireCharacter('Bram'));
        for (const chat of chats) {
            const path = fixturePath(root, 'chats', 'Bram', `${chat.id}.jsonl`);
            const content = await readFile(path, 'utf8').catch(() => '');
            expect(content).not.toContain('telegram');
            expect(content).not.toContain('tg-1');
        }
    });
});

describe('talking to the bound character', () => {
    it('sends the message to generation and answers with the reply', async () => {
        const { handleMessage } = await load();
        const sink = recorder();
        const calls: Array<{ characterId: string; chatId: string; message: string }> = [];

        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });
        await handleMessage(message('I open the gate.'), {
            transport: sink.transport,
            generate: async (input) => {
                calls.push(input);
                return 'It swings inward.';
            },
        });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.message).toBe('I open the gate.');
        expect(calls[0]?.characterId).toBe('Aurelia');
        expect(sink.text().at(-1)).toBe('It swings inward.');
    });

    it('splits a long reply into several messages', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });
        await handleMessage(message('Tell me everything.'), {
            transport: sink.transport,
            generate: async () => `${'word '.repeat(1500)}`,
        });

        // 7,500 characters cannot be one Telegram message.
        const replyChunks = sink.sent.slice(1);
        expect(replyChunks.length).toBeGreaterThan(1);
        for (const chunk of replyChunks) {
            expect(chunk.text.length).toBeLessThanOrEqual(4096);
        }
    });

    it('turns a provider failure into a sentence instead of silence', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });
        await handleMessage(message('Hello.'), {
            transport: sink.transport,
            generate: async () => {
                throw new Error('The provider is down');
            },
        });

        // Silence looks exactly like a bot that has died, which is the one
        // outcome this must never produce.
        expect(sink.text().at(-1)).toContain('The provider is down');
    });

    it('refuses a second message while one is generating', async () => {
        const { handleMessage } = await load();
        const sink = recorder();
        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });

        let release: (text: string) => void = () => {};
        const pending = new Promise<string>((resolve) => {
            release = resolve;
        });

        let reached: () => void = () => {};
        const started = new Promise<void>((resolve) => {
            reached = resolve;
        });

        const first = handleMessage(message('Slow one.'), {
            transport: sink.transport,
            generate: async () => {
                // Signal from inside the fake rather than racing a timer: the
                // in-flight marker is set before `generate` is called, so once
                // this runs the second message is guaranteed to see it.
                reached();
                return pending;
            },
        });
        await started;

        await handleMessage(message('Impatient one.'), {
            transport: sink.transport,
            generate: async () => 'should never run',
        });

        expect(sink.text().at(-1)).toContain('Still writing');
        release('Done.');
        await first;
    });

    it('reports a chat deleted from the app and unbinds, rather than recreating it', async () => {
        const { handleMessage, readBinding, setBinding } = await load();
        const sink = recorder();

        await setBinding('tg-1', { characterId: 'Aurelia', chatId: 'deleted-chat' });
        await handleMessage(message('Still there?'), {
            transport: sink.transport,
            generate: async () => 'never',
        });

        expect(sink.text().at(-1)).toContain('gone');
        // Recreating would fork the story without telling anyone.
        expect(await readBinding('tg-1')).toBeNull();
    });
});

describe('the other commands', () => {
    it('/who names the character and the chat', async () => {
        const { handleMessage } = await load();
        const sink = recorder();
        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });

        await handleMessage(message('/who'), { transport: sink.transport, generate: async () => 'never' });
        expect(sink.text().at(-1)).toContain('Aurelia');
    });

    it('/stop says so when nothing is running', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/stop'), { transport: sink.transport, generate: async () => 'never' });
        expect(sink.text().at(-1)).toContain('Nothing is being written');
    });

    it('/help lists the commands', async () => {
        const { handleMessage } = await load();
        const sink = recorder();

        await handleMessage(message('/help'), { transport: sink.transport, generate: async () => 'never' });
        const text = sink.text().join('\n');
        for (const command of ['/chat', '/new', '/stop', '/who']) {
            expect(text).toContain(command);
        }
    });

    it('/new starts a fresh chat and rebinds to it', async () => {
        const { handleMessage, readBinding } = await load();
        const sink = recorder();
        await handleMessage(message('/chat Aurelia'), { transport: sink.transport, generate: async () => 'never' });
        const before = await readBinding('tg-1');

        await handleMessage(message('/new'), { transport: sink.transport, generate: async () => 'never' });
        const after = await readBinding('tg-1');

        expect(after?.characterId).toBe('Aurelia');
        expect(after?.chatId).not.toBe(before?.chatId);
    });
});
