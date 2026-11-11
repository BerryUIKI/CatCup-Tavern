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
});
