import type {
    AuthorNoteSettings,
    CharacterDetail,
    ChatMessage,
    PersonaSettings,
    WorldInfoConfig,
} from '@catcup/shared';

import { loadWorldInfoEntries } from '../worldinfo/loader.js';
import { buildWorldInfoPrompt } from '../worldinfo/prompt.js';
import { scanWorldInfo } from '../worldinfo/scanner.js';
import { ensureTimedWorldInfo } from '../worldinfo/timedEffects.js';
import type { WorldInfoPrompt } from '../worldinfo/types.js';
import { type MacroContext, substituteMacros } from './macros.js';

export interface WorldInfoTurnInput {
    character: CharacterDetail;
    messages: readonly ChatMessage[];
    persona: PersonaSettings;
    config: WorldInfoConfig;
    authorNote: AuthorNoteSettings;
    contextSize: number;
    /** Generation type: `normal`, `regenerate` or `continue`. */
    trigger: string;
    /**
     * The chat's live `chat_metadata`. `timedWorldInfo` is read and mutated in
     * place; the caller persists it.
     */
    metadata: Record<string, unknown>;
}

export interface WorldInfoTurnResult {
    prompt: WorldInfoPrompt;
    /** Books that were scanned, for diagnostics. */
    books: string[];
}

/**
 * SillyTavern's Author's Note schedule: due on every Nth user message, and
 * never before the first one.
 */
export function isAuthorNoteDue(messages: readonly ChatMessage[], interval: number): boolean {
    const userMessages = messages.filter((message) => message.is_user).length;
    if (userMessages <= 0 || interval <= 0) {
        return false;
    }

    const tillInsertion = userMessages >= interval ? userMessages % interval : interval - userMessages;
    return tillInsertion === 0;
}

export function createMacroContext(character: CharacterDetail, persona: PersonaSettings): MacroContext {
    const card = character.card;
    return {
        char: card.name || character.name,
        user: persona.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
    };
}

/**
 * Run the world info scan for one generation.
 *
 * The chat passed to the scanner is the full non-system conversation, newest
 * first, because its length is the timed-effect clock. Never pass a
 * context-trimmed history here.
 */
export async function scanWorldInfoForTurn(input: WorldInfoTurnInput): Promise<WorldInfoTurnResult> {
    const card = input.character.card;
    const characterWorld = typeof card.extensions.world === 'string' ? card.extensions.world : '';
    const books = [...new Set([...input.config.globalBooks, characterWorld].filter(Boolean))];

    const entries = await loadWorldInfoEntries(books);
    const macroContext = createMacroContext(input.character, input.persona);
    const substitute = (text: string) => substituteMacros(text, macroContext);

    const chat = input.messages
        .filter((message) => !message.is_system)
        .map((message) => ({ text: message.mes }))
        .reverse();

    const state = ensureTimedWorldInfo(input.metadata);

    const scan = scanWorldInfo({
        entries,
        chat,
        maxContext: input.contextSize,
        settings: {
            depth: input.config.depth,
            budgetPercent: input.config.budgetPercent,
            budgetCap: input.config.budgetCap,
            caseSensitive: input.config.caseSensitive,
            matchWholeWords: input.config.matchWholeWords,
            useGroupScoring: input.config.useGroupScoring,
            recursive: input.config.recursive,
            minActivations: input.config.minActivations,
            minActivationsDepthMax: input.config.minActivationsDepthMax,
            maxRecursionSteps: input.config.maxRecursionSteps,
        },
        globalScanData: {
            trigger: input.trigger,
            personaDescription: input.persona.description,
            characterDescription: card.description,
            characterPersonality: card.personality,
            scenario: card.scenario,
            creatorNotes: card.creator_notes,
        },
        activeCharacter: { id: input.character.id },
        timed: { state },
        substitute,
    });

    const noteEnabled = input.authorNote.enabled && input.authorNote.prompt.trim().length > 0;
    const shouldAddAuthorNote = noteEnabled && isAuthorNoteDue(input.messages, input.authorNote.interval);

    const prompt = buildWorldInfoPrompt(scan, {
        shouldAddAuthorNote,
        originalAuthorNote: shouldAddAuthorNote ? substitute(input.authorNote.prompt) : '',
        note: {
            position: input.authorNote.position,
            depth: input.authorNote.depth,
            role: input.authorNote.role,
            scan: input.authorNote.scan,
        },
    });

    return { prompt, books };
}
