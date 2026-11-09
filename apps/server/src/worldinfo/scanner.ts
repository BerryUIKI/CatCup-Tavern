// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { PROMPT_ROLE, WORLD_INFO_LOGIC, WORLD_INFO_POSITION } from '@catcup/shared';

import { estimateTokens } from '../prompt/tokenizer.js';
import { type KeyMatchOptions, matchesKey } from './matching.js';
import type {
    ActivationReason,
    GlobalScanData,
    ScanEntry,
    ScanInput,
    ScanMessage,
    ScanPositions,
    ScanResult,
    ScanTrace,
    SkipReason,
    WorldInfoSettings,
} from './types.js';

/** SillyTavern's defaults, used when a caller does not override them. */
export const DEFAULT_WORLD_INFO_SETTINGS: WorldInfoSettings = {
    depth: 2,
    budgetPercent: 25,
    budgetCap: 0,
    caseSensitive: false,
    matchWholeWords: false,
};

/** Upper bound SillyTavern applies to `scanDepth` and the chat buffer. */
export const MAX_SCAN_DEPTH = 1000;

/** Depth used by an `atDepth` entry that does not set one. */
export const DEFAULT_DEPTH = 4;

/**
 * Separator injected between scanned messages. It is a control character so a
 * key can never match across a message boundary.
 */
const MATCHER = '\u0001';
const JOINER = `\n${MATCHER}`;

function computeBudget(maxContext: number, settings: WorldInfoSettings): number {
    const raw = Math.round((settings.budgetPercent * maxContext) / 100) || 1;
    return settings.budgetCap > 0 && raw > settings.budgetCap ? settings.budgetCap : raw;
}

interface ScanBuffer {
    /** Text an entry is matched against, including its opt-in global context. */
    text(entry: ScanEntry, defaultDepth: number): string;
}

function optIn(enabled: boolean, value: string | undefined): string {
    return enabled && value ? JOINER + value : '';
}

function createScanBuffer(chat: readonly ScanMessage[], global: GlobalScanData): ScanBuffer {
    const messages: string[] = [];
    const limit = Math.min(chat.length, MAX_SCAN_DEPTH);
    for (let index = 0; index < limit; index += 1) {
        messages[index] = (chat[index]?.text ?? '').trim();
    }

    return {
        text(entry, defaultDepth) {
            const requested = entry.scanDepth ?? defaultDepth;
            if (requested <= 0) {
                return '';
            }

            const depth = Math.min(requested, MAX_SCAN_DEPTH);
            let result = MATCHER + messages.slice(0, depth).join(JOINER);

            result += optIn(entry.matchPersonaDescription, global.personaDescription);
            result += optIn(entry.matchCharacterDescription, global.characterDescription);
            result += optIn(entry.matchCharacterPersonality, global.characterPersonality);
            result += optIn(entry.matchCharacterDepthPrompt, global.characterDepthPrompt);
            result += optIn(entry.matchScenario, global.scenario);
            result += optIn(entry.matchCreatorNotes, global.creatorNotes);

            return result;
        },
    };
}

function passesProbability(entry: ScanEntry, random: () => number): boolean {
    if (!entry.useProbability || entry.probability >= 100) {
        return true;
    }
    return random() * 100 <= entry.probability;
}

interface SecondaryResult {
    ok: boolean;
    /** Key that satisfied the logic, when there is one to report. */
    key?: string;
}

/**
 * Apply `selectiveLogic` to the secondary keys.
 *
 * The four modes map to SillyTavern's `AND_ANY`, `NOT_ALL`, `NOT_ANY` and
 * `AND_ALL`, including their short-circuit order.
 */
function matchSecondaryKeys(
    entry: ScanEntry,
    haystack: string,
    options: KeyMatchOptions,
    substitute: (text: string) => string,
): SecondaryResult {
    const logic = entry.selectiveLogic ?? WORLD_INFO_LOGIC.AND_ANY;
    const keys = entry.keysecondary.map((key) => substitute(key).trim()).filter((key) => key.length > 0);

    let anyMatch = false;
    let allMatch = keys.length > 0;
    let firstMatch: string | undefined;

    for (const key of keys) {
        const matched = matchesKey(haystack, key, options);

        if (matched) {
            anyMatch = true;
            firstMatch ??= key;
        } else {
            allMatch = false;
        }

        if (logic === WORLD_INFO_LOGIC.AND_ANY && matched) {
            return { ok: true, key };
        }
        if (logic === WORLD_INFO_LOGIC.NOT_ALL && !matched) {
            return { ok: true, key };
        }
    }

    if (logic === WORLD_INFO_LOGIC.NOT_ANY && !anyMatch) {
        return { ok: true };
    }
    if (logic === WORLD_INFO_LOGIC.AND_ALL && allMatch) {
        return { ok: true, key: firstMatch };
    }

    return { ok: false };
}

/**
 * Run one world info scan.
 *
 * This is the M1 core: constant entries, primary and secondary keys, scan
 * depth, case and whole-word options, probability, ordering and the token
 * budget. Recursion, inclusion groups, timed effects and decorator-driven
 * external activation arrive in the next slice.
 */
export function scanWorldInfo(input: ScanInput): ScanResult {
    const settings: WorldInfoSettings = { ...DEFAULT_WORLD_INFO_SETTINGS, ...input.settings };
    const countTokens = input.countTokens ?? estimateTokens;
    const random = input.random ?? Math.random;
    const substitute = input.substitute ?? ((text: string) => text);
    const globalScanData = input.globalScanData ?? {};
    const trigger = globalScanData.trigger ?? 'normal';

    const buffer = createScanBuffer(input.chat, globalScanData);
    const budgetLimit = computeBudget(input.maxContext, settings);

    const sorted = [...input.entries].sort((a, b) => b.order - a.order);
    const traceMap = new Map<ScanEntry, ScanTrace>();

    const record = (
        entry: ScanEntry,
        activated: boolean,
        reason: ActivationReason | SkipReason,
        detail?: string,
    ): void => {
        const existing = traceMap.get(entry);
        if (existing) {
            existing.activated = activated;
            existing.reason = reason;
            existing.detail = detail;
            return;
        }
        traceMap.set(entry, {
            loop: 1,
            world: entry.world,
            uid: entry.uid,
            comment: entry.comment,
            activated,
            reason,
            detail,
        });
    };

    const candidates: ScanEntry[] = [];

    for (const entry of sorted) {
        if (entry.disable) {
            record(entry, false, 'disabled');
            continue;
        }

        if (entry.triggers.length > 0 && !entry.triggers.includes(trigger)) {
            record(entry, false, 'trigger-filter', trigger);
            continue;
        }

        // SillyTavern checks the activation decorator before the suppression
        // one, so an entry carrying both is activated.
        if (entry.decorators.includes('@@activate')) {
            record(entry, true, 'decorator-activate');
            candidates.push(entry);
            continue;
        }

        if (entry.decorators.includes('@@dont_activate')) {
            record(entry, false, 'decorator-dont-activate');
            continue;
        }

        if (entry.constant) {
            record(entry, true, 'constant');
            candidates.push(entry);
            continue;
        }

        if (entry.key.length === 0) {
            record(entry, false, 'no-keys');
            continue;
        }

        const haystack = buffer.text(entry, settings.depth);
        const matchOptions: KeyMatchOptions = {
            caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
            matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
        };

        const primaryKey = entry.key
            .map((key) => substitute(key).trim())
            .find((key) => key.length > 0 && matchesKey(haystack, key, matchOptions));

        if (!primaryKey) {
            record(entry, false, 'primary-key-miss');
            continue;
        }

        const hasSecondary = entry.selective && entry.keysecondary.length > 0;
        if (!hasSecondary) {
            record(entry, true, 'primary-key', primaryKey);
            candidates.push(entry);
            continue;
        }

        const secondary = matchSecondaryKeys(entry, haystack, matchOptions, substitute);
        if (!secondary.ok) {
            record(entry, false, 'secondary-key-miss', primaryKey);
            continue;
        }

        record(entry, true, 'secondary-key', secondary.key ? `${primaryKey} / ${secondary.key}` : primaryKey);
        candidates.push(entry);
    }

    const activated: ScanEntry[] = [];
    const resolvedContent = new Map<ScanEntry, string>();
    const budgetParts: string[] = [];
    let budgetUsed = 0;
    let overflowed = false;
    let remainingIgnoreBudget = candidates.filter((entry) => entry.ignoreBudget).length;

    for (const entry of candidates) {
        if (entry.ignoreBudget) {
            remainingIgnoreBudget -= 1;
        }

        // Once the budget is exhausted only `ignoreBudget` entries may still
        // activate. SillyTavern breaks out after the last of them.
        if (overflowed && !entry.ignoreBudget) {
            if (remainingIgnoreBudget > 0) {
                record(entry, false, 'budget-exceeded', `${budgetUsed}/${budgetLimit}`);
                continue;
            }
            break;
        }

        if (!passesProbability(entry, random)) {
            record(entry, false, 'probability-failed', `${entry.probability}%`);
            continue;
        }

        const content = substitute(entry.content);
        budgetParts.push(content);
        budgetUsed = countTokens(budgetParts.join('\n'));

        if (!entry.ignoreBudget && budgetUsed >= budgetLimit) {
            overflowed = true;
            record(entry, false, 'budget-exceeded', `${budgetUsed}/${budgetLimit}`);
            continue;
        }

        resolvedContent.set(entry, content);
        activated.push(entry);
    }

    const positions: ScanPositions = {
        before: [],
        after: [],
        authorNoteTop: [],
        authorNoteBottom: [],
        atDepth: [],
    };

    // Entries are walked from highest to lowest `order` and unshifted, which
    // leaves each bucket in ascending order, matching SillyTavern's output.
    for (const entry of [...activated].sort((a, b) => b.order - a.order)) {
        const content = (resolvedContent.get(entry) ?? '').trim();
        if (!content) {
            continue;
        }

        switch (entry.position) {
            case WORLD_INFO_POSITION.BEFORE_CHAR:
                positions.before.unshift(content);
                break;
            case WORLD_INFO_POSITION.AFTER_CHAR:
                positions.after.unshift(content);
                break;
            case WORLD_INFO_POSITION.AN_TOP:
                positions.authorNoteTop.unshift(content);
                break;
            case WORLD_INFO_POSITION.AN_BOTTOM:
                positions.authorNoteBottom.unshift(content);
                break;
            case WORLD_INFO_POSITION.AT_DEPTH: {
                const depth = entry.depth ?? DEFAULT_DEPTH;
                const role = entry.role ?? PROMPT_ROLE.SYSTEM;
                const bucket = positions.atDepth.find(
                    (candidate) => candidate.depth === depth && candidate.role === role,
                );
                if (bucket) {
                    bucket.entries.unshift(content);
                } else {
                    positions.atDepth.push({ depth, role, entries: [content] });
                }
                break;
            }
            default:
                // Example-message, outlet and unknown positions are wired up
                // with the Prompt Manager; ignoring them beats mis-injecting.
                break;
        }
    }

    return {
        positions,
        activated,
        trace: [...traceMap.values()],
        budget: { limit: budgetLimit, used: budgetUsed, overflowed },
        loops: 1,
    };
}
