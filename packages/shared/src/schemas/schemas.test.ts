import { describe, expect, it } from 'vitest';

import { characterBulkRequestSchema, characterCardDataSchema, characterFavoriteRequestSchema } from './character.js';
import { groupSchema } from './group.js';
import { DEFAULT_IMAGE_GENERATION_SETTINGS } from './images.js';
import { appSettingsSchema, DEFAULT_MEMORY_SETTINGS, DEFAULT_UI_SETTINGS, settingsPatchSchema } from './settings.js';
import { DEFAULT_TTS_SETTINGS } from './tts.js';

describe('shared schemas', () => {
    it('applies app settings defaults', () => {
        const settings = appSettingsSchema.parse({});
        expect(settings.ui.language).toBe('en');
        expect(settings.personas).toEqual([]);
        expect(settings.activePersonaId).toBeNull();
        expect(settings.memory).toEqual(DEFAULT_MEMORY_SETTINGS);
        expect(settings.tts).toEqual(DEFAULT_TTS_SETTINGS);
        expect(settings.imageGeneration).toEqual(DEFAULT_IMAGE_GENERATION_SETTINGS);
        expect(settings.imageGeneration.scheduler).toBe('normal');
        expect(settings.imageGeneration.comfyWorkflow).toContain('"%prompt%"');
        expect(DEFAULT_UI_SETTINGS.theme).toBe('tavern-dark');
    });

    it('fills character card defaults', () => {
        const card = characterCardDataSchema.parse({ name: 'Seraphina' });
        expect(card.first_mes).toBe('');
        expect(card.alternate_greetings).toEqual([]);
        expect(card.extensions).toEqual({});
    });

    it('keeps unspecified memory settings out of a partial patch', () => {
        const patch = settingsPatchSchema.parse({ memory: { enabled: true } });
        expect(patch.memory).toEqual({ enabled: true });
    });

    it('keeps unspecified TTS settings out of a partial patch', () => {
        const patch = settingsPatchSchema.parse({ tts: { enabled: true } });
        expect(patch.tts).toEqual({ enabled: true });
    });

    it('keeps unspecified image generation settings out of a partial patch', () => {
        const patch = settingsPatchSchema.parse({ imageGeneration: { enabled: true } });
        expect(patch.imageGeneration).toEqual({ enabled: true });
    });

    it('keeps ComfyUI workflow fields out of a partial patch unless sent', () => {
        const patch = settingsPatchSchema.parse({
            imageGeneration: { scheduler: 'karras', comfyWorkflow: '{"1":{}}' },
        });
        expect(patch.imageGeneration).toEqual({ scheduler: 'karras', comfyWorkflow: '{"1":{}}' });
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

describe('character library schemas', () => {
    it('requires tags for tag bulk actions', () => {
        expect(characterBulkRequestSchema.safeParse({ action: 'add-tags', ids: ['Aria'] }).success).toBe(false);
        expect(characterBulkRequestSchema.safeParse({ action: 'remove-tags', ids: ['Aria'], tags: [] }).success).toBe(
            false,
        );
        expect(
            characterBulkRequestSchema.safeParse({ action: 'add-tags', ids: ['Aria'], tags: ['fantasy'] }).success,
        ).toBe(true);
    });

    it('rejects empty and oversized id lists', () => {
        expect(characterBulkRequestSchema.safeParse({ action: 'favorite', ids: [] }).success).toBe(false);
        expect(
            characterBulkRequestSchema.safeParse({
                action: 'favorite',
                ids: Array.from({ length: 501 }, (_, index) => `id-${index}`),
            }).success,
        ).toBe(false);
    });

    it('keeps the favorite request boolean-only', () => {
        expect(characterFavoriteRequestSchema.parse({ favorite: true })).toEqual({ favorite: true });
        expect(characterFavoriteRequestSchema.safeParse({ favorite: 'true' }).success).toBe(false);
        expect(characterFavoriteRequestSchema.safeParse({ favorite: true, extra: true }).success).toBe(false);
    });

    it('rejects unsafe ids, unknown keys and tags on non-tag actions', () => {
        expect(characterBulkRequestSchema.safeParse({ action: 'favorite', ids: ['../Aria'] }).success).toBe(false);
        expect(characterBulkRequestSchema.safeParse({ action: 'favorite', ids: ['Aria'], extra: true }).success).toBe(
            false,
        );
        expect(
            characterBulkRequestSchema.safeParse({ action: 'favorite', ids: ['Aria'], tags: ['fantasy'] }).success,
        ).toBe(false);
        expect(characterBulkRequestSchema.safeParse({ action: 'add-tags', ids: ['Aria'], tags: ['a,b'] }).success).toBe(
            false,
        );
        expect(
            characterBulkRequestSchema.safeParse({ action: 'add-tags', ids: ['Aria'], tags: ['x'.repeat(201)] })
                .success,
        ).toBe(false);
        expect(
            characterBulkRequestSchema.safeParse({ action: 'add-tags', ids: ['Aria'], tags: ['x'.repeat(200)] })
                .success,
        ).toBe(true);
    });

    it('trims ids and tags', () => {
        const parsed = characterBulkRequestSchema.parse({
            action: 'add-tags',
            ids: ['  Aria  '],
            tags: ['  fantasy  '],
        });
        expect(parsed.ids).toEqual(['Aria']);
        expect(parsed.tags).toEqual(['fantasy']);
    });
});
