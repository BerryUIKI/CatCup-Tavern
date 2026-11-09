import type { CharacterDetail, ChatMessage, GenerationSettings, PersonaSettings } from '@catcup/shared';

import type { PromptMessage } from '../providers/types.js';
import { estimateTokens } from './tokenizer.js';

export interface BuildPromptInput {
    character: CharacterDetail;
    messages: ChatMessage[];
    persona: PersonaSettings;
    settings: GenerationSettings;
}

const DEFAULT_MAIN_PROMPT = "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.";

/**
 * Substitute the macros used by SillyTavern cards and presets.
 * Unknown macros are left untouched so user content is never silently lost.
 */
export function substituteMacros(text: string, character: CharacterDetail, persona: PersonaSettings): string {
    const card = character.card;
    const now = new Date();
    const replacements: Record<string, string> = {
        char: card.name,
        user: persona.name,
        persona: persona.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        time: now.toLocaleTimeString('zh-CN', { hour12: false }),
        date: now.toLocaleDateString('zh-CN'),
        original: '',
    };

    return text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name: string) => {
        const value = replacements[name.toLowerCase()];
        return value === undefined ? match : value;
    });
}

function buildSystemContent(input: BuildPromptInput): string {
    const { character, persona } = input;
    const card = character.card;
    const parts: string[] = [];

    const mainPrompt = card.system_prompt.trim() || DEFAULT_MAIN_PROMPT;
    parts.push(substituteMacros(mainPrompt, character, persona));

    if (persona.description.trim()) {
        parts.push(`[User persona: ${persona.name}]\n${substituteMacros(persona.description, character, persona)}`);
    }

    const sheet: string[] = [];
    if (card.description.trim()) {
        sheet.push(`[Character: ${card.name}]\n${substituteMacros(card.description, character, persona)}`);
    }
    if (card.personality.trim()) {
        sheet.push(`Personality:\n${substituteMacros(card.personality, character, persona)}`);
    }
    if (card.scenario.trim()) {
        sheet.push(`Scenario:\n${substituteMacros(card.scenario, character, persona)}`);
    }
    if (card.mes_example.trim()) {
        sheet.push(`Example dialogue:\n${substituteMacros(card.mes_example, character, persona)}`);
    }
    if (sheet.length > 0) {
        parts.push(sheet.join('\n\n'));
    }

    return parts.filter(Boolean).join('\n\n');
}

/**
 * M0 prompt pipeline:
 *   main prompt + persona + character sheet -> recent history -> post-history.
 * M1 replaces the middle with a full ST Prompt Manager / World Info pipeline.
 */
export function buildPrompt(input: BuildPromptInput): PromptMessage[] {
    const { character, messages, persona, settings } = input;
    const systemContent = buildSystemContent(input);

    const history: PromptMessage[] = messages
        .filter((message) => message.mes.trim() !== '' && !message.is_system)
        .map((message) => ({
            role: message.is_user ? ('user' as const) : ('assistant' as const),
            content: substituteMacros(message.mes, character, persona),
        }));

    const budget = Math.max(512, settings.contextSize - settings.maxTokens);
    let used = estimateTokens(systemContent) + 4;
    const kept: PromptMessage[] = [];

    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (!message) {
            continue;
        }
        const cost = estimateTokens(message.content) + 4;
        if (used + cost > budget && kept.length > 0) {
            break;
        }
        kept.unshift(message);
        used += cost;
    }

    // Some providers reject a prompt without a user turn (a fresh card has only
    // an assistant greeting). ST uses the same idea for new chats.
    if (!kept.some((message) => message.role === 'user')) {
        kept.unshift({ role: 'user', content: '[Start of chat]' });
    }

    const result: PromptMessage[] = [];
    if (systemContent) {
        result.push({ role: 'system', content: systemContent });
    }
    result.push(...kept);

    const postHistory = character.card.post_history_instructions.trim();
    if (postHistory) {
        result.push({
            role: 'system',
            content: substituteMacros(postHistory, character, persona),
        });
    }

    return result;
}
