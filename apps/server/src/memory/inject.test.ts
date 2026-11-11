import { memorySettingsSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildMemoryInjection } from './inject.js';

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
});
