import { describe, expect, it } from 'vitest';

import { characterCardDataSchema } from './character.js';
import { groupSchema } from './group.js';
import { DEFAULT_IMAGE_GENERATION_SETTINGS } from './images.js';
import { providerDraftTestSchema } from './provider.js';
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

    it('applies draft provider defaults and keeps its key separate', () => {
        const parsed = providerDraftTestSchema.parse({
            provider: { kind: 'openai', name: 'Draft', apiKey: 'ignored' },
        });
        expect(parsed.provider.baseUrl).toBe('');
        expect(parsed.provider.enabled).toBe(true);
        expect(parsed.provider.headers).toEqual({});
        expect('apiKey' in parsed.provider).toBe(false);
        expect(parsed.apiKey).toBeUndefined();
        expect(() => providerDraftTestSchema.parse({ provider: { kind: 'openai' } })).toThrow();
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
