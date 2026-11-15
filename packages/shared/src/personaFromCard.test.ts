import { describe, expect, it } from 'vitest';

import { personaFromCard, resolvePersona } from './persona.js';
import type { Persona } from './schemas/settings.js';

/**
 * A persona can carry a card's voice, but it must not change what an ordinary
 * two-field persona does. Both halves are pinned here.
 */

describe('resolvePersona with the optional fields', () => {
    it('leaves a two-field persona exactly as it was', () => {
        const personas: Persona[] = [{ id: 'a', name: 'Alex', description: 'A traveler.' }];
        const resolved = resolvePersona({ personas, activePersonaId: 'a' });

        expect(resolved).toEqual({ name: 'Alex', description: 'A traveler.' });
        expect(resolved).not.toHaveProperty('personality');
        expect(resolved).not.toHaveProperty('mesExample');
    });

    it('carries the optional fields when the persona has them', () => {
        const personas: Persona[] = [
            {
                id: 'mira',
                name: 'Mira',
                description: 'Runs the inn.',
                personality: 'Dry, watchful.',
                scenario: 'A rain-soaked evening.',
                mesExample: '{{user}}: Is there a room?\n{{char}}: One.',
            },
        ];
        const resolved = resolvePersona({ personas, activePersonaId: 'mira' });

        expect(resolved.personality).toBe('Dry, watchful.');
        expect(resolved.scenario).toBe('A rain-soaked evening.');
        expect(resolved.mesExample).toContain('Is there a room?');
    });

    it('drops an empty optional field rather than carrying an empty string', () => {
        const personas: Persona[] = [{ id: 'a', name: 'Alex', description: '', personality: '' }];
        expect(resolvePersona({ personas, activePersonaId: 'a' })).toEqual({ name: 'Alex', description: '' });
    });
});

describe('personaFromCard', () => {
    it('carries the fields that make sense from the user seat', () => {
        const persona = personaFromCard({
            name: 'Mira',
            description: 'Runs the Cat’s Cup.',
            personality: 'Dry.',
            scenario: 'A rain-soaked evening.',
            mes_example: '<START>\n{{user}}: Room?\n{{char}}: One.',
        });

        expect(persona).toEqual({
            name: 'Mira',
            description: 'Runs the Cat’s Cup.',
            personality: 'Dry.',
            scenario: 'A rain-soaked evening.',
            mesExample: '<START>\n{{user}}: Room?\n{{char}}: One.',
        });
    });

    it('omits fields the card leaves empty, so the persona stays two-field', () => {
        const persona = personaFromCard({ name: 'Bram', description: 'A traveller.', personality: '', scenario: '  ' });
        expect(persona).toEqual({ name: 'Bram', description: 'A traveller.' });
    });

    it('never carries first_mes: the opening line is the assistant speaking', () => {
        const persona = personaFromCard({ name: 'Mira', description: 'x' });
        expect(persona).not.toHaveProperty('first_mes');
        expect(persona).not.toHaveProperty('firstMes');
    });

    it('truncates a name the persona field cannot hold', () => {
        const persona = personaFromCard({ name: 'x'.repeat(120) });
        expect(persona.name.length).toBe(80);
    });
});
