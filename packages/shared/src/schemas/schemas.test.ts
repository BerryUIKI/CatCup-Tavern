import { describe, expect, it } from 'vitest';

import { characterCardDataSchema } from './character.js';
import { groupSchema } from './group.js';
import { appSettingsSchema, DEFAULT_MEMORY_SETTINGS, DEFAULT_UI_SETTINGS } from './settings.js';

describe('shared schemas', () => {
    it('applies app settings defaults', () => {
        const settings = appSettingsSchema.parse({});
        expect(settings.ui.language).toBe('en');
        expect(settings.personas).toEqual([]);
        expect(settings.activePersonaId).toBeNull();
        expect(settings.memory).toEqual(DEFAULT_MEMORY_SETTINGS);
        expect(DEFAULT_UI_SETTINGS.theme).toBe('tavern-dark');
    });

    it('fills character card defaults', () => {
        const card = characterCardDataSchema.parse({ name: 'Seraphina' });
        expect(card.first_mes).toBe('');
        expect(card.alternate_greetings).toEqual([]);
        expect(card.extensions).toEqual({});
    });

    it('fills SillyTavern group defaults', () => {
        const group = groupSchema.parse({ id: '1', name: 'The Cup' });
        expect(group.members).toEqual([]);
        expect(group.activation_strategy).toBe(0);
        expect(group.generation_mode).toBe(0);
        expect(group.auto_mode_delay).toBe(5);
        expect(group.chats).toEqual([]);
    });

    it('preserves unknown group fields', () => {
        const group = groupSchema.parse({ id: '1', name: 'The Cup', custom_flag: 'kept' });
        expect(group).toMatchObject({ custom_flag: 'kept' });
    });
});
