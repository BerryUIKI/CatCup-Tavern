import { describe, expect, it } from 'vitest';

import { characterCardDataSchema } from './character.js';
import { appSettingsSchema, DEFAULT_UI_SETTINGS } from './settings.js';

describe('shared schemas', () => {
    it('applies app settings defaults', () => {
        const settings = appSettingsSchema.parse({});
        expect(settings.ui.language).toBe('en');
        expect(settings.persona.name).toBe('You');
        expect(DEFAULT_UI_SETTINGS.theme).toBe('tavern-dark');
    });

    it('fills character card defaults', () => {
        const card = characterCardDataSchema.parse({ name: 'Seraphina' });
        expect(card.first_mes).toBe('');
        expect(card.alternate_greetings).toEqual([]);
        expect(card.extensions).toEqual({});
    });
});
