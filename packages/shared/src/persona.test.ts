import { describe, expect, it } from 'vitest';

import { resolvePersona } from './persona.js';
import type { Persona } from './schemas/settings.js';

const personas: Persona[] = [
    { id: 'a', name: 'Alex', description: 'A traveler.' },
    { id: 'b', name: 'Rowan', description: 'A scholar.' },
];

describe('resolvePersona', () => {
    it('uses the account default when the chat pins nothing', () => {
        expect(resolvePersona({ personas, activePersonaId: 'b' })).toEqual({
            name: 'Rowan',
            description: 'A scholar.',
        });
    });

    it('prefers the persona a chat pinned', () => {
        expect(resolvePersona({ personas, activePersonaId: 'b' }, 'a').name).toBe('Alex');
    });

    it('falls back to the first persona when the active id is unknown', () => {
        expect(resolvePersona({ personas, activePersonaId: 'gone' }).name).toBe('Alex');
        expect(resolvePersona({ personas, activePersonaId: 'a' }, 'gone').name).toBe('Alex');
    });

    it('returns the built-in default when there are no personas', () => {
        expect(resolvePersona({ personas: [], activePersonaId: null })).toEqual({ name: 'You', description: '' });
    });

    it('never returns the internal id', () => {
        const resolved = resolvePersona({ personas, activePersonaId: 'a' });
        expect(resolved).not.toHaveProperty('id');
    });
});
