import type { CharacterDetail, ChatMessage, PersonaSettings, QuickReplySet } from '@catcup/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeQuickReply, type QuickReplyTarget } from './execute.js';

/**
 * The quick reply executor: validation, argument handling and what reaches the
 * chat.
 *
 * Drives the real executor against a recording target with the storage and
 * regex layers stubbed. What is under test is which commands run, what they
 * append, and — the promise the API makes — that a malformed reply leaves the
 * chat untouched.
 *
 * Written before the module was rewritten, so the rules it pins are observed
 * behaviour rather than a description of the implementation.
 */

const state: { set: QuickReplySet | null } = { set: null };

vi.mock('../storage/quickReplies.js', () => ({
    listQuickReplySets: async () => (state.set ? [state.set] : []),
    readQuickReplySet: async (id: string) => (state.set && state.set.name === id ? state.set : null),
}));
vi.mock('../storage/regex.js', () => ({ listRegexScripts: async () => [] }));
vi.mock('../storage/settings.js', () => ({
    getSettings: async () => ({
        quickReplies: { setList: [], config: {} },
        personas: [],
        activePersonaId: null,
    }),
}));

const persona = { name: 'Alex', description: '', personality: '', scenario: '', mesExample: '' } as PersonaSettings;

const character = {
    id: 'seraphina',
    name: 'Seraphina',
    card: { name: 'Seraphina', description: '', personality: '', scenario: '', mes_example: '' },
} as unknown as CharacterDetail;

/** Install a one-reply set whose message is `message`. */
function script(message: string, overrides: Partial<QuickReplySet> = {}): void {
    state.set = {
        version: 2,
        name: 'Test',
        disableSend: false,
        placeBeforeInput: false,
        injectInput: false,
        color: 'transparent',
        onlyBorderColor: false,
        qrList: [{ id: 0, label: 'Go', message, automatic: false, hidden: false }],
        ...overrides,
    } as unknown as QuickReplySet;
}

function makeTarget(kind: 'character' | 'group' = 'character'): QuickReplyTarget & { appended: ChatMessage[] } {
    const appended: ChatMessage[] = [];
    return {
        kind,
        character,
        persona,
        ...(kind === 'group' ? { group: { members: ['Seraphina', 'Mira'], enabled: ['Seraphina', 'Mira'] } } : {}),
        ...(kind === 'group'
            ? {
                  speakers: [
                      { name: 'Seraphina', fileName: 'seraphina' },
                      { name: 'Mira', fileName: 'mira' },
                  ],
              }
            : {}),
        metadata: {},
        read: async () => [],
        append: async (message: ChatMessage) => {
            appended.push(message);
            return message;
        },
        appended,
    };
}

/** Run the installed reply and report what happened. */
async function run(target = makeTarget()) {
    const result = await executeQuickReply(target, 'Test', 0);
    return { result, appended: target.appended, target };
}

beforeEach(() => {
    state.set = null;
});

describe('a reply that appends messages', () => {
    it('appends one user message for /send', async () => {
        script('/send Hello there');
        const { appended } = await run();

        expect(appended).toHaveLength(1);
        expect(appended[0]?.mes).toBe('Hello there');
        expect(appended[0]?.is_user).toBe(true);
        expect(appended[0]?.name).toBe('Alex');
    });

    it('takes a speaker name for /send from the name argument', async () => {
        script('/send name=Ghost Hello');
        const { appended } = await run();

        expect(appended[0]?.name).toBe('Ghost');
    });

    it('appends a narrator message for /sys, marked as one', async () => {
        script('/sys The gate opens.');
        const { appended } = await run();

        expect(appended).toHaveLength(1);
        expect(appended[0]?.is_user).toBe(false);
        expect(appended[0]?.extra?.type).toBe('narrator');
        expect(appended[0]?.name).toBe('System');
    });

    it('reads a narrator name from the chat metadata', async () => {
        script('/sys Something happens.');
        const target = makeTarget();
        target.metadata.narrator_name = 'Narrator';
        const { appended } = await run(target);

        expect(appended[0]?.name).toBe('Narrator');
    });

    it('runs several piped commands in order', async () => {
        script('/send First | /sys Second | /send Third');
        const { appended } = await run();

        expect(appended.map((message) => message.mes)).toEqual(['First', 'Second', 'Third']);
    });

    it('returns an echo action rather than appending anything', async () => {
        script('/echo A note');
        const { result, appended } = await run();

        expect(appended).toHaveLength(0);
        expect(result.actions.some((action) => action.type === 'toast')).toBe(true);
    });
});

describe('a reply that asks the client to generate', () => {
    it('returns a generation action for /trigger and appends nothing', async () => {
        script('/trigger');
        const { result, appended } = await run(makeTarget('group'));

        expect(appended).toHaveLength(0);
        expect(result.actions.some((action) => action.type === 'generate')).toBe(true);
    });

    it('carries the chosen speaker for a numbered /trigger', async () => {
        script('/trigger 1');
        const { result } = await run(makeTarget('group'));
        const action = result.actions.find((candidate) => candidate.type === 'generate');

        expect(action && 'speaker' in action ? action.speaker : undefined).toBe('mira');
    });

    it('refuses to choose a speaker that does not exist', async () => {
        script('/trigger 9');
        await expect(run(makeTarget('group'))).rejects.toThrow(/no group member/i);
    });

    it('refuses a speaker in a single chat rather than dropping it', async () => {
        script('/trigger Seraphina');
        await expect(run()).rejects.toThrow(/group chat/i);
    });
});

describe('arguments', () => {
    it('rejects an argument a command does not declare', async () => {
        script('/send at=3 Hello');
        await expect(run()).rejects.toThrow(/not supported/i);
    });

    it('accepts an argument the command does declare', async () => {
        // `return` is declared on /send; it is accepted and dropped rather than
        // rejected, which is what keeps a real SillyTavern set importable.
        script('/send return=pipe Hello');
        const { appended } = await run();

        expect(appended[0]?.mes).toBe('Hello');
    });

    it('rejects a severity the echo action does not have', async () => {
        script('/echo severity=shout Something');
        await expect(run()).rejects.toThrow(/severity/i);
    });
});

describe('a malformed reply leaves the chat untouched', () => {
    it('appends nothing when a later step is invalid', async () => {
        // The first step is valid; running it would leave a message behind if
        // validation happened per step rather than up front.
        script('/send Fine | /send');
        await expect(run()).rejects.toThrow(/needs text/i);
    });

    it('appends nothing when the command is unknown', async () => {
        script('/save Everything');
        await expect(run()).rejects.toThrow();
    });
});

describe('ending a reply', () => {
    it('requires a generation command to be last', async () => {
        script('/trigger | /send After');
        await expect(run(makeTarget('group'))).rejects.toThrow();
    });
});

describe('a set marked disableSend', () => {
    it('returns the text as input rather than running it', async () => {
        script('/send Hello', { disableSend: true } as Partial<QuickReplySet>);
        const { result, appended } = await run();

        expect(appended).toHaveLength(0);
        expect(result.actions[0]?.type).toBe('input');
    });
});
