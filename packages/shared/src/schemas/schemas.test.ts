import { describe, expect, it } from 'vitest';

import { characterBulkRequestSchema, characterCardDataSchema, characterFavoriteRequestSchema } from './character.js';
import { groupSchema } from './group.js';
import { DEFAULT_IMAGE_GENERATION_SETTINGS } from './images.js';
import {
    DEFAULT_BASE_URLS,
    expectsKey,
    PROTOCOL_LABELS,
    PROVIDER_TEMPLATES,
    protocolFor,
    providerConfigSchema,
    providerDraftTestSchema,
    providerInitials,
    providerSummary,
} from './provider.js';
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

describe('provider protocol and templates', () => {
    it('resolves the three OpenAI-shaped kinds to one protocol', () => {
        expect(protocolFor('openai')).toBe('openai');
        expect(protocolFor('openrouter')).toBe('openai');
        expect(protocolFor('custom')).toBe('openai');
        expect(protocolFor('anthropic')).toBe('anthropic');
        expect(protocolFor('ollama')).toBe('ollama');
    });

    it('describes each protocol, not each vendor', () => {
        // The label is the wire format; the vendor name lives on the template.
        expect(PROTOCOL_LABELS.openai).toBe('OpenAI Chat Completions');
        expect(PROTOCOL_LABELS.anthropic).toBe('Anthropic Messages');
        expect(PROTOCOL_LABELS.ollama).toBe('Ollama native');
    });

    it('offers one template per service, each naming a kind and a real default URL', () => {
        expect(PROVIDER_TEMPLATES.map((template) => template.id)).toEqual([
            'openai',
            'anthropic',
            'openrouter',
            'ollama',
            'gemini',
        ]);
        for (const template of PROVIDER_TEMPLATES) {
            expect(template.kind).toBe(template.id);
            expect(DEFAULT_BASE_URLS[template.kind]).not.toBe('');
            expect(template.initials).toHaveLength(2);
        }
        // A custom provider is the absence of a template, so it has no default.
        expect(DEFAULT_BASE_URLS.custom).toBe('');
    });

    it('marks a custom provider with no vendor initials', () => {
        expect(providerInitials('openai')).toBe('OA');
        expect(providerInitials('openrouter')).toBe('OR');
        expect(providerInitials('custom')).toBe('CP');
    });

    it('summarises a row by its service, or by its protocol when it has none', () => {
        expect(providerSummary('openrouter', 'glm-5.3')).toBe('OpenRouter · glm-5.3');
        expect(providerSummary('openrouter', '')).toBe('OpenRouter');
        // A custom provider names no vendor: the protocol is the only fact stored.
        expect(providerSummary('custom', 'llama3')).toBe('OpenAI Chat Completions · llama3');
    });

    it('expects a key only from the hosted kinds', () => {
        expect(expectsKey('openai')).toBe(true);
        expect(expectsKey('openrouter')).toBe(true);
        expect(expectsKey('anthropic')).toBe(true);
        expect(expectsKey('ollama')).toBe(false);
        expect(expectsKey('custom')).toBe(false);
    });

    it('keeps a stored kind exactly as it was written', () => {
        // The stored discriminator did not change with the protocol naming, so a
        // file from 0.3.x loads without a migration and without a request change.
        const parsed = providerConfigSchema.parse({
            id: 'p1',
            kind: 'custom',
            name: 'Local',
            baseUrl: 'http://127.0.0.1:8080/v1',
            models: ['a-model'],
        });
        expect(parsed.kind).toBe('custom');
        expect(parsed.defaultModel).toBe('a-model');
    });
});
