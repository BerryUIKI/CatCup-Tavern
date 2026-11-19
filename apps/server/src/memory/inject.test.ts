import { memorySettingsSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildMemoryInjection, formatMemoryText, selectSummaries, summariesForTurn } from './inject.js';

const context = {
    char: 'Seraphina',
    user: 'Alex',
    description: '',
    personality: '',
    scenario: '',
};

function memory(overrides: Record<string, unknown> = {}) {
    return memorySettingsSchema.parse(overrides);
}

describe('buildMemoryInjection', () => {
    it('formats the summary with the default template', () => {
        expect(buildMemoryInjection(memory(), { value: 'They met.', index: 2 }, context)).toEqual({
            content: '[Summary: They met.]',
            position: 0,
            role: 0,
            depth: 2,
        });
    });

    it('expands macros in the template', () => {
        const injection = buildMemoryInjection(
            memory({ template: '{{char}} remembers: {{summary}}', position: 1, role: 1, depth: 4 }),
            { value: 'The gate opened.', index: 0 },
            context,
        );

        expect(injection).toEqual({
            content: 'Seraphina remembers: The gate opened.',
            position: 1,
            role: 1,
            depth: 4,
        });
    });

    it('falls back to the plain Summary: prefix for an empty template', () => {
        const injection = buildMemoryInjection(memory({ template: '   ' }), { value: 'They met.', index: 0 }, context);
        expect(injection?.content).toBe('Summary: They met.');
    });

    it('returns null with no summary or position -1', () => {
        expect(buildMemoryInjection(memory(), null, context)).toBeNull();
        expect(buildMemoryInjection(memory({ position: -1 }), { value: 'They met.', index: 0 }, context)).toBeNull();
    });

    it('still formats the text when the position is none', () => {
        expect(formatMemoryText(memory({ position: -1 }), { value: 'They met.', index: 0 }, context)).toBe(
            '[Summary: They met.]',
        );
    });
});

describe('the two-sided summary budget', () => {
    const summaries = [
        { value: 'Chapter one: they met at the gate.', index: 4 },
        // Deliberately fat: a long middle summary is what the two-sided rule
        // has to be able to drop while keeping a short earliest one.
        { value: `Chapter five: ${'the oath was broken. '.repeat(4)}`, index: 40 },
        { value: 'Chapter nine: the orchard burned.', index: 90 },
    ];

    /** One token per character, so a budget can be reasoned about exactly. */
    const cost = (summary: { value: string }) => summary.value.length;

    it('sends only the newest when append-only is off', () => {
        // This is SillyTavern's behaviour and what the app did before: one
        // summary, always the latest, regardless of how many the file holds.
        expect(summariesForTurn(memory({ appendOnly: false }), summaries, cost)).toEqual([summaries[2]]);
    });

    it('keeps the newest and the earliest when append-only is on', () => {
        const chosen = summariesForTurn(memory({ appendOnly: true }), summaries, cost);

        // The complaint is that a long chat forgets its own beginning, so the
        // earliest must survive even when a middle summary would also fit.
        expect(chosen).toContainEqual(summaries[0]);
        expect(chosen).toContainEqual(summaries[2]);
    });

    it('drops the middle before it drops the start', () => {
        // Room for the newest plus one more, and the middle is far too fat to
        // be that one. Newest-first fills the first slot; the earliest is added
        // afterwards, so the summary that goes is the middle.
        const room = summaries[2].value.length + summaries[0].value.length;
        const chosen = selectSummaries(summaries, cost, room);

        expect(chosen).toEqual([summaries[2], summaries[0]]);
        expect(chosen).not.toContainEqual(summaries[1]);
    });

    it('always keeps the newest, even when it alone overruns the budget', () => {
        const chosen = selectSummaries(summaries, cost, 1);

        // An empty memory block would be worse than a slightly over-budget one,
        // and the caller has already reserved room for the newest.
        expect(chosen).toEqual([summaries[2]]);
    });

    it('returns nothing for a chat with no summaries', () => {
        expect(summariesForTurn(memory({ appendOnly: true }), [], cost)).toEqual([]);
        expect(selectSummaries([], cost, 1000)).toEqual([]);
    });

    it('wraps every summary in the template and orders newest first', () => {
        const injection = buildMemoryInjection(
            memory({ template: '[{{summary}}]' }),
            [summaries[0], summaries[2]],
            context,
        );

        // Newest at the top: the most recent settled state is what a turn acts
        // on, and each range stays visibly separate.
        expect(injection?.content).toBe('[Chapter nine: the orchard burned.]\n\n[Chapter one: they met at the gate.]');
    });
});
