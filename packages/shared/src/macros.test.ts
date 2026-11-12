import { describe, expect, it } from 'vitest';

import { substituteMacros } from './macros.js';

const context = {
    char: 'Seraphina',
    user: 'Alex',
    description: 'A guardian.',
    personality: 'Kind.',
    scenario: 'A glade.',
};

describe('substituteMacros', () => {
    it('replaces the card and persona macros', () => {
        expect(substituteMacros('{{char}} greets {{user}} and {{persona}}.', context)).toBe(
            'Seraphina greets Alex and Alex.',
        );
    });

    it('tolerates whitespace inside the braces', () => {
        expect(substituteMacros('{{ char }} / {{  user  }}', context)).toBe('Seraphina / Alex');
    });

    it('leaves unknown macros untouched', () => {
        expect(substituteMacros('{{random}} stays', context)).toBe('{{random}} stays');
    });

    it('uses the card fields', () => {
        expect(substituteMacros('{{description}} {{personality}} {{scenario}}', context)).toBe(
            'A guardian. Kind. A glade.',
        );
    });

    it('expands original once and then empties it', () => {
        expect(substituteMacros('{{original}} / {{original}}', { ...context, original: 'base' })).toBe('base / ');
    });

    it('escapes each value rather than the whole string', () => {
        expect(substituteMacros('^{{char}}$', context, { escapeValue: (value) => value.replace(/\$/g, '\\$') })).toBe(
            '^Seraphina$',
        );
    });

    it('expands the group macros', () => {
        const groupContext = { ...context, group: ['Seraphina', 'Mira'], groupNotMuted: ['Mira'] };
        expect(substituteMacros('{{group}} / {{groupNotMuted}}', groupContext)).toBe('Seraphina, Mira / Mira');
    });

    it('uses the member list for charIfNotGroup in a group', () => {
        const groupContext = { ...context, group: ['Seraphina', 'Mira'] };
        expect(substituteMacros('{{charIfNotGroup}}', groupContext)).toBe('Seraphina, Mira');
        expect(substituteMacros('{{charIfNotGroup}}', context)).toBe('Seraphina');
    });

    it('lists the other members and the user for notChar', () => {
        const groupContext = { ...context, group: ['Seraphina', 'Mira'] };
        expect(substituteMacros('{{notChar}}', groupContext)).toBe('Mira, Alex');
    });

    it('expands the summary and words macros', () => {
        const memoryContext = { ...context, summary: 'They met in the glade.', words: 120 };
        expect(substituteMacros('{{summary}} ({{words}} words)', memoryContext)).toBe(
            'They met in the glade. (120 words)',
        );
    });

    it('empties summary and words when they are not set', () => {
        expect(substituteMacros('[{{summary}}]', context)).toBe('[]');
        expect(substituteMacros('[{{words}}]', context)).toBe('[]');
    });
});
