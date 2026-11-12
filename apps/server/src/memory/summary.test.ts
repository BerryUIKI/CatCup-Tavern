import type { CharacterDetail, ChatMessage, GenerationSettings } from '@catcup/shared';
import { memorySettingsSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import {
    buildSummaryRequest,
    buildSummaryTranscript,
    countWords,
    shouldAutoSummarize,
    summaryProgress,
} from './summary.js';

const character = {
    id: 'Seraphina',
    fileName: 'Seraphina.json',
    name: 'Seraphina',
    card: {
        name: 'Seraphina',
        description: 'A guardian of Eldoria.',
        personality: 'Kind and watchful.',
        scenario: 'A forest glade.',
        first_mes: 'Welcome, traveler.',
        mes_example: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        group_only_greetings: [],
    },
} as unknown as CharacterDetail;

const persona = { name: 'Alex', description: '' };
const generation: GenerationSettings = {
    temperature: 1,
    topP: 1,
    maxTokens: 256,
    contextSize: 4096,
    stream: true,
};

function memory(overrides: Record<string, unknown> = {}) {
    return memorySettingsSchema.parse(overrides);
}

function user(mes: string, extra?: Record<string, unknown>): ChatMessage {
    return { name: 'Alex', is_user: true, mes, ...(extra ? { extra } : {}) };
}

function reply(mes: string, extra?: Record<string, unknown>): ChatMessage {
    return { name: 'Seraphina', is_user: false, mes, ...(extra ? { extra } : {}) };
}

const countChars = (text: string) => text.length;

describe('buildSummaryTranscript', () => {
    const messages = [reply('Welcome.'), user('Hello.'), reply('You came.'), user('I did.'), reply('Good.')];

    it('keeps settled messages and always excludes the newest', () => {
        const transcript = buildSummaryTranscript({
            messages,
            startIndex: 0,
            budget: 10_000,
            countTokens: countChars,
        });

        expect(transcript).not.toBeNull();
        expect(transcript?.text).toContain('Seraphina:\nWelcome.');
        expect(transcript?.text).toContain('Alex:\nI did.');
        expect(transcript?.text).not.toContain('Seraphina:\nGood.');
        expect(transcript?.lastUsedIndex).toBe(3);
        expect(transcript?.messages).toBe(4);
    });

    it('starts after the latest summary', () => {
        const transcript = buildSummaryTranscript({
            messages,
            startIndex: 2,
            budget: 10_000,
            countTokens: countChars,
        });

        expect(transcript?.text).not.toContain('Welcome.');
        expect(transcript?.text).toContain('You came.');
        expect(transcript?.lastUsedIndex).toBe(3);
    });

    it('keeps the oldest messages when the budget overflows', () => {
        const first = 'Seraphina:\nWelcome.';
        const both = `${first}\n\nAlex:\nHello.`;
        const transcript = buildSummaryTranscript({
            messages,
            startIndex: 0,
            budget: both.length - 1,
            countTokens: countChars,
        });

        expect(transcript?.text).toBe(first);
        expect(transcript?.lastUsedIndex).toBe(0);
    });

    it('honours maxMessages', () => {
        const transcript = buildSummaryTranscript({
            messages,
            startIndex: 0,
            budget: 10_000,
            countTokens: countChars,
            maxMessages: 2,
        });

        expect(transcript?.messages).toBe(2);
        expect(transcript?.lastUsedIndex).toBe(1);
    });

    it('skips system and empty messages', () => {
        const withSystem = [
            reply('One.'),
            { name: 'System', is_user: false, is_system: true, mes: 'hidden' } as ChatMessage,
            reply('Two.'),
            reply('   '),
            user('newest'),
        ];
        const transcript = buildSummaryTranscript({
            messages: withSystem,
            startIndex: 0,
            budget: 10_000,
            countTokens: countChars,
        });

        expect(transcript?.text).toBe('Seraphina:\nOne.\n\nSeraphina:\nTwo.');
        expect(transcript?.lastUsedIndex).toBe(2);
    });

    it('returns null when only the newest message exists', () => {
        expect(
            buildSummaryTranscript({
                messages: [user('Alone.')],
                startIndex: 0,
                budget: 10_000,
                countTokens: countChars,
            }),
        ).toBeNull();
    });
});

describe('summaryProgress', () => {
    it('counts messages and words after the latest summary', () => {
        const messages = [reply('one two'), reply('three', { memory: 'old' }), user('four five six')];
        expect(summaryProgress(messages)).toEqual({ messages: 1, words: 3, latestIndex: 1 });
    });
});

describe('countWords', () => {
    it("uses SillyTavern's extractAllWords pattern", () => {
        expect(countWords('one — two... ***')).toBe(2);
        expect(countWords("don't stop")).toBe(3);
    });
});

describe('shouldAutoSummarize', () => {
    const messages = [reply('Welcome.'), user('Hello.'), reply('You came.'), user('I did.')];

    it('is off unless automatic summaries are enabled', () => {
        expect(shouldAutoSummarize(messages, memory({ promptInterval: 1 }))).toBe(false);
    });

    it('fires when the message interval is reached', () => {
        expect(shouldAutoSummarize(messages, memory({ enabled: true, promptInterval: 4 }))).toBe(true);
        expect(shouldAutoSummarize(messages, memory({ enabled: true, promptInterval: 5 }))).toBe(false);
    });

    it('counts only messages after the latest summary', () => {
        const summarized = [reply('Welcome.'), reply('Hello.', { memory: 'summary' }), user('Again.'), reply('Yes.')];
        expect(shouldAutoSummarize(summarized, memory({ enabled: true, promptInterval: 2 }))).toBe(true);
        expect(shouldAutoSummarize(summarized, memory({ enabled: true, promptInterval: 3 }))).toBe(false);
    });

    it('fires on the word trigger', () => {
        const long = [reply('one two three four five'), user('newest')];
        expect(shouldAutoSummarize(long, memory({ enabled: true, promptInterval: 0, promptForceWords: 6 }))).toBe(true);
        expect(shouldAutoSummarize(long, memory({ enabled: true, promptInterval: 0, promptForceWords: 7 }))).toBe(
            false,
        );
    });

    it('needs something before the newest message to summarize', () => {
        expect(shouldAutoSummarize([user('Alone.')], memory({ enabled: true, promptInterval: 1 }))).toBe(false);
        expect(
            shouldAutoSummarize(
                [{ name: 'System', is_user: false, is_system: true, mes: 'note' }, user('newest')],
                memory({ enabled: true, promptInterval: 1 }),
            ),
        ).toBe(false);
    });

    it('does nothing when both triggers are zero', () => {
        expect(shouldAutoSummarize(messages, memory({ enabled: true, promptInterval: 0, promptForceWords: 0 }))).toBe(
            false,
        );
    });
});

describe('buildSummaryRequest', () => {
    const messages = [
        reply('Welcome.', { memory: 'They met at the gate.' }),
        user('Hello.'),
        reply('You came.'),
        user('I did.'),
    ];

    function requestOf(result: ReturnType<typeof buildSummaryRequest>) {
        if ('reason' in result) {
            throw new Error(result.reason);
        }
        return result.request;
    }

    it('builds a system instruction and a transcript with the previous summary', () => {
        const request = requestOf(
            buildSummaryRequest({
                messages,
                character,
                persona,
                memory: memory(),
                generation,
                countTokens: countChars,
            }),
        );

        expect(request.prompt).toHaveLength(2);
        expect(request.prompt[0]).toMatchObject({ role: 'system' });
        expect(request.prompt[0]?.content).toContain('200 words');
        expect(request.prompt[0]?.content).not.toContain('{{words}}');
        expect(request.prompt[1]?.role).toBe('user');
        expect(request.prompt[1]?.content).toBe('They met at the gate.\n\nAlex:\nHello.\n\nSeraphina:\nYou came.');
        // The newest message is excluded and the summary is stored on the
        // last covered message.
        expect(request.lastUsedIndex).toBe(2);
        expect(request.transcriptMessages).toBe(2);
    });

    it('expands macros and the target length in the prompt', () => {
        const request = requestOf(
            buildSummaryRequest({
                messages,
                character,
                persona,
                memory: memory({ prompt: 'Summarize {{char}} for {{user}} in {{words}} words.', promptWords: 120 }),
                generation,
                countTokens: countChars,
            }),
        );

        expect(request.prompt[0]?.content).toBe('Summarize Seraphina for Alex in 120 words.');
    });

    it('uses the response length override', () => {
        const request = requestOf(
            buildSummaryRequest({
                messages,
                character,
                persona,
                memory: memory({ responseLength: 64 }),
                generation,
                countTokens: countChars,
            }),
        );

        expect(request.maxTokens).toBe(64);
    });

    it('reports why there is nothing new to summarize', () => {
        expect(
            buildSummaryRequest({
                messages: [user('Alone.')],
                character,
                persona,
                memory: memory(),
                generation,
                countTokens: countChars,
            }),
        ).toEqual({ reason: 'No new messages to summarize.' });
    });

    it('reports an empty prompt', () => {
        expect(
            buildSummaryRequest({
                messages,
                character,
                persona,
                memory: memory({ prompt: '   ' }),
                generation,
                countTokens: countChars,
            }),
        ).toEqual({ reason: 'The summary prompt is empty.' });
    });

    it('reports an exhausted context budget', () => {
        expect(
            buildSummaryRequest({
                messages,
                character,
                persona,
                memory: memory(),
                generation: { ...generation, contextSize: 512, maxTokens: 512 },
                countTokens: countChars,
            }),
        ).toEqual({ reason: 'The context budget leaves no room for a summary request.' });
    });

    it('includes the group roster in the macro context', () => {
        const request = requestOf(
            buildSummaryRequest({
                messages,
                character,
                persona,
                group: { members: ['Seraphina', 'Mira'], enabled: ['Mira'] },
                memory: memory({ prompt: 'Members: {{group}}; speaking: {{groupNotMuted}}.' }),
                generation,
                countTokens: countChars,
            }),
        );

        expect(request.prompt[0]?.content).toBe('Members: Seraphina, Mira; speaking: Mira.');
    });
});
