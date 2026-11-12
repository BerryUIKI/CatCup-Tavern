import type {
    AuthorNoteSettings,
    CharacterDetail,
    ChatMessage,
    PersonaSettings,
    RegexScript,
    WorldInfoConfig,
} from '@catcup/shared';
import { applyRegexScripts, REGEX_PLACEMENT } from '@catcup/shared';

import { loadWorldInfoEntries } from '../worldinfo/loader.js';
import { buildWorldInfoPrompt } from '../worldinfo/prompt.js';
import { scanWorldInfo } from '../worldinfo/scanner.js';
import { ensureTimedWorldInfo } from '../worldinfo/timedEffects.js';
import type { ScanResult, WorldInfoPrompt } from '../worldinfo/types.js';
import { type MacroContext, substituteMacros } from './macros.js';

/** Group member names for `{{group}}`, `{{groupNotMuted}}` and friends. */
export interface GroupMacroMembers {
    /** Every member name, muted members included. */
    members: readonly string[];
    /** Members that may reply. */
    enabled: readonly string[];
}

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
    /** Token counter for the budget; defaults to the shared estimator. */
    countTokens?: (text: string) => number;
    /** Scripts with the `WORLD_INFO` placement, applied per entry. */
    regexScripts?: readonly RegexScript[];
    /** Macro expansion for those scripts. */
    substitute?: (text: string, escapeValues: boolean) => string;
    /** Member names for group macros while the scan expands chat text. */
    group?: GroupMacroMembers;
    /** Latest summary for `{{summary}}` in entries and the author's note. */
    summary?: string;
    /**
     * Text scanned alongside the chat but outside its depth clock, such as the
     * summary when the Memory settings include it in world info scanning.
     */
    extraScanText?: string;
}

export interface WorldInfoTurnResult {
    prompt: WorldInfoPrompt;
    /** The raw scan, for the context inspector. */
    scan: ScanResult;
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

export function createMacroContext(
    character: CharacterDetail,
    persona: PersonaSettings,
    group?: GroupMacroMembers,
    summary?: string,
): MacroContext {
    const card = character.card;
    return {
        char: card.name || character.name,
        user: persona.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        ...(group ? { group: group.members, groupNotMuted: group.enabled } : {}),
        ...(summary ? { summary } : {}),
    };
}

/**
 * Drop duplicate book ids, ignoring case.
 *
 * A card can bind the same book that is also enabled globally, and on a
 * case-insensitive filesystem `Eldoria` and `eldoria` are one file. Loading it
 * twice would double its entries and skew the budget.
 */
export function dedupeBooks(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const books: string[] = [];

    for (const id of ids) {
        const trimmed = id.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) {
            continue;
        }
        seen.add(key);
        books.push(trimmed);
    }

    return books;
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
    const books = dedupeBooks([...input.config.globalBooks, characterWorld]);

    const entries = await loadWorldInfoEntries(books);
    const macroContext = createMacroContext(input.character, input.persona, input.group, input.summary);
    const substitute = (text: string) => substituteMacros(text, macroContext);

    // The scanner sees the same text the prompt will: greetings keep their raw
    // macros in storage, so they are expanded here without touching the chat.
    const chat = input.messages
        .filter((message) => !message.is_system)
        .map((message) => ({ text: substitute(message.mes) }))
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
        ...(input.extraScanText?.trim() ? { injections: [input.extraScanText] } : {}),
        ...(input.countTokens ? { countTokens: input.countTokens } : {}),
        // `WORLD_INFO` scripts run on each entry as it enters the prompt, with
        // the entry's own depth when it is injected at depth.
        transformContent: (_entry, content, depth) =>
            applyRegexScripts(input.regexScripts ?? [], content, REGEX_PLACEMENT.WORLD_INFO, {
                isPrompt: true,
                ...(typeof depth === 'number' ? { depth } : {}),
                substitute: input.substitute,
            }),
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

    return { prompt, scan, books };
}
