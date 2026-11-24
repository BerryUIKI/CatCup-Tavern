// Written for CatCup. Asking the active model for an image prompt, and
// cleaning up what comes back.

import {
    type ChatMessage,
    DEFAULT_IMAGE_PROMPT_TEMPLATE,
    DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
    type ImageGenerationSettings,
    type ProviderConfig,
} from '@catcup/shared';

import { HttpError } from '../http/errors.js';
import { getAdapter, type PromptMessage } from '../providers/index.js';

export interface DraftImagePromptInput {
    settings: ImageGenerationSettings;
    provider: ProviderConfig;
    apiKey?: string;
    messages: ChatMessage[];
    characterName: string;
    userName: string;
    signal: AbortSignal;
}

/**
 * Turn a model's reply into a comma-separated image prompt.
 *
 * SillyTavern strips nearly everything outside a small ASCII set. CatCup keeps
 * Unicode letters and numbers so names and non-English descriptions survive,
 * and keeps Stable Diffusion weight syntax such as `(smile:1.2)`.
 */
export function cleanImagePrompt(text: string): string {
    let value = text.trim();
    if (!value) {
        return '';
    }
    value = value.replace(/^\s*(?:image\s+)?prompt\s*:\s*/i, '');
    value = value.replace(/["“”]/g, '');
    value = value.replace(/\r?\n+/g, ', ');
    value = value.replace(/[^\p{L}\p{N}.,:_()[\]{}/|#'<>+-]+/gu, ' ');
    value = value.replace(/\s+/g, ' ').trim();

    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', ')
        .slice(0, 4000)
        .trim();
}

function historyMessages(input: DraftImagePromptInput): PromptMessage[] {
    const lines = input.messages
        .filter((message) => message.mes.trim() && !message.is_system && message.extra?.type !== 'narrator')
        .slice(-input.settings.contextMessages)
        .map((message) => {
            const speaker = message.name || (message.is_user ? input.userName : input.characterName);
            return `${speaker}: ${message.mes.trim()}`;
        });

    return [
        {
            role: 'system',
            content: input.settings.promptTemplate.trim() || DEFAULT_IMAGE_PROMPT_TEMPLATE,
        },
        {
            role: 'user',
            content: `Recent chat:\n${lines.join('\n') || '(The chat is empty.)'}\n\nWrite only the image prompt.`,
        },
    ];
}

/**
 * Ask the active chat model for an image prompt describing the recent scene.
 *
 * The provider interface is streaming-only, so the adapter's text chunks are
 * collected and cleaned. Reasoning chunks are ignored.
 */
export async function draftImagePrompt(input: DraftImagePromptInput): Promise<string> {
    const adapter = getAdapter(input.provider);
    let text = '';
    try {
        for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
            // A prompt draft is not a character speaking, so it uses the
            // provider default rather than a character's model choice.
            model: input.provider.defaultModel,
            messages: historyMessages(input),
            temperature: 1,
            topP: 1,
            maxTokens: 400,
            signal: input.signal,
        })) {
            if (chunk.type === 'text') {
                text += chunk.text;
            }
        }
    } catch (error) {
        throw new HttpError(
            502,
            `Could not draft an image prompt: ${error instanceof Error ? error.message : 'chat provider failed'}`,
            'IMAGE_PROMPT_FAILED',
        );
    }

    const cleaned = cleanImagePrompt(text);
    if (!cleaned) {
        throw new HttpError(502, 'The chat model returned no image prompt', 'IMAGE_PROMPT_FAILED');
    }
    return cleaned;
}

export interface DraftPortraitPromptInput {
    settings: ImageGenerationSettings;
    provider: ProviderConfig;
    apiKey?: string;
    card: { name: string; description: string; personality: string };
    signal: AbortSignal;
}

/**
 * A portrait request's messages.
 *
 * The card is the whole input. The description comes first because that is
 * where appearance lives; the personality is included because it decides the
 * expression and the pose, which is what makes two portraits of two characters
 * from the same book look like different people rather than the same model in
 * two coats.
 *
 * The name is sent as data, not as an instruction: a model that has heard of a
 * name can otherwise draw the wrong character entirely.
 */
export function portraitMessages(input: DraftPortraitPromptInput): PromptMessage[] {
    const description = input.card.description.trim();
    const personality = input.card.personality.trim();

    return [
        {
            role: 'system',
            content: input.settings.portraitPromptTemplate.trim() || DEFAULT_PORTRAIT_PROMPT_TEMPLATE,
        },
        {
            role: 'user',
            content: [
                '<character>',
                `Name: ${input.card.name}`,
                description ? `Description: ${description}` : '',
                personality ? `Personality: ${personality}` : '',
                '</character>',
                '',
                'Write only the image prompt for a portrait of this character.',
            ]
                .filter((line) => line !== '')
                .join('\n'),
        },
    ];
}

/**
 * Ask the active chat model for a portrait prompt built from a card.
 *
 * Nothing about a chat is involved, which is why this works for a character that
 * has never been spoken to — a distilled card, or one just imported.
 */
export async function draftPortraitPrompt(input: DraftPortraitPromptInput): Promise<string> {
    const adapter = getAdapter(input.provider);
    let text = '';
    try {
        for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
            model: input.provider.defaultModel,
            messages: portraitMessages(input),
            temperature: 1,
            topP: 1,
            maxTokens: 400,
            signal: input.signal,
        })) {
            if (chunk.type === 'text') {
                text += chunk.text;
            }
        }
    } catch (error) {
        throw new HttpError(
            502,
            `Could not draft a portrait prompt: ${error instanceof Error ? error.message : 'chat provider failed'}`,
            'IMAGE_PROMPT_FAILED',
        );
    }

    const cleaned = cleanImagePrompt(text);
    if (!cleaned) {
        throw new HttpError(502, 'The chat model returned no portrait prompt', 'IMAGE_PROMPT_FAILED');
    }
    return cleaned;
}
