import { describe, expect, it } from 'vitest';

import { resolvePreset } from './preset.js';

const base = { temperature: 0.8, topP: 0.9, maxTokens: 512, contextSize: 8192, stream: true };

describe('preset resolution', () => {
    it('falls back to ST defaults when the preset is empty', () => {
        const resolved = resolvePreset({}, base);

        expect(resolved.generation).toEqual(base);
        expect(resolved.formats.wi).toBe('{0}');
        expect(resolved.squashSystemMessages).toBe(false);
        expect(resolved.promptSettings.prompts).toEqual([]);
    });

    it('takes sampling parameters from the preset', () => {
        const resolved = resolvePreset(
            { temperature: 0.4, top_p: 0.95, openai_max_tokens: 1024, openai_max_context: 4096 },
            base,
        );

        expect(resolved.generation).toEqual({
            ...base,
            temperature: 0.4,
            topP: 0.95,
            maxTokens: 1024,
            contextSize: 4096,
        });
    });

    it('extracts prompts, order and assembly strings', () => {
        const resolved = resolvePreset(
            {
                prompts: [{ identifier: 'main', content: 'Hello' }],
                prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
                wi_format: '<{0}>',
                personality_format: 'Persona: {{personality}}',
                new_chat_prompt: '[new]',
                squash_system_messages: true,
            },
            base,
        );

        expect(resolved.promptSettings.prompts).toHaveLength(1);
        expect(resolved.promptSettings.promptOrder?.[0]?.order?.[0]?.identifier).toBe('main');
        expect(resolved.formats.wi).toBe('<{0}>');
        expect(resolved.formats.personality).toBe('Persona: {{personality}}');
        expect(resolved.newChatPrompt).toBe('[new]');
        expect(resolved.squashSystemMessages).toBe(true);
    });

    it('ignores a body that is not an object', () => {
        expect(resolvePreset(null, base).generation).toEqual(base);
        expect(resolvePreset('nonsense', base).generation).toEqual(base);
    });
});
