// Written for CatCup. Editing a world info book's entries: the template a new
// one starts from, uid allocation, the editor's sort and a patch merge that
// keeps the fields the editor does not model.

import { isRecord, type WorldInfoEntryPatch, type WorldInfoEntryView, worldInfoEntrySchema } from '@catcup/shared';

import { extractEntries, resolveUid } from './loader.js';

const MAX_UID = 1_000_000;

/**
 * What a newly created entry contains.
 *
 * These are the values `docs/DATA-FORMATS.md` records as an entry's defaults,
 * and they have to be the same ones a card's book converts to or an edit made
 * here would produce an entry the other clients read differently from one they
 * created themselves. `null` is a real value, not "absent": it means unset, and
 * the scanner falls back to the default when it sees it.
 */
export const NEW_ENTRY_DEFAULTS: Readonly<Record<string, unknown>> = {
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: false,
    order: 100,
    position: 0,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: false,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: true,
    depth: 4,
    outletName: '',
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    triggers: [],
};

export interface EntryLocation {
    /** The object that holds every entry. */
    container: Record<string, unknown>;
    /** Key of the entry inside the container. */
    key: string;
    /** The entry itself. Mutating it updates the book. */
    value: Record<string, unknown>;
}

/**
 * Find the object that holds the entries, creating one when the book has none.
 *
 * `raw` is mutated when the container has to be created, which is how an empty
 * book gains its `entries` object.
 */
export function ensureEntryContainer(raw: Record<string, unknown>): Record<string, unknown> {
    const existing = extractEntries(raw);
    if (existing) {
        return existing;
    }
    raw.entries = {};
    return raw.entries as Record<string, unknown>;
}

/**
 * Locate one entry by uid.
 *
 * Uids are resolved exactly as the loader resolves them, so an entry edited
 * through the API is always the entry the scanner read, even in a hand-written
 * file where the record key and the `uid` field disagree.
 */
export function findEntryLocation(raw: unknown, uid: number): EntryLocation | null {
    const container = extractEntries(raw);
    return container ? findEntryInContainer(container, uid) : null;
}

/** Locate an entry inside an already-extracted container. */
export function findEntryInContainer(container: Record<string, unknown>, uid: number): EntryLocation | null {
    let index = 0;
    for (const [key, value] of Object.entries(container)) {
        if (isRecord(value) && resolveUid(value, key, index) === uid) {
            return { container, key, value };
        }
        index += 1;
    }
    return null;
}

/**
 * The lowest uid the book is not using.
 *
 * A gap is reused rather than a new maximum appended, because uid is an
 * identity a chat's timed-effect records point at — leaving holes would grow
 * them without bound over a long-lived book. Entries are counted by their
 * *resolved* uid, so a hand-written record keyed by name cannot collide with
 * the number picked here.
 */
export function nextFreeUid(container: Record<string, unknown>): number {
    const used = new Set<number>();
    let index = 0;
    for (const [key, value] of Object.entries(container)) {
        if (isRecord(value)) {
            used.add(resolveUid(value, key, index));
        }
        index += 1;
    }

    for (let uid = 0; uid < MAX_UID; uid += 1) {
        if (!used.has(uid)) {
            return uid;
        }
    }

    throw new Error('World info book has no free uid');
}

/** Append a blank entry built from the defaults above. */
export function appendEntry(container: Record<string, unknown>): {
    uid: number;
    value: Record<string, unknown>;
} {
    const uid = nextFreeUid(container);
    const value: Record<string, unknown> = { uid, ...structuredClone(NEW_ENTRY_DEFAULTS) };
    container[String(uid)] = value;
    return { uid, value };
}

/**
 * Copy an entry under a free uid.
 *
 * Only the uid is replaced, so the copy keeps its source's `displayIndex` and
 * lands next to it in the editor, which is what "duplicate" means to the person
 * who pressed it. The tie is then broken by insertion order and then uid, which
 * is the same order the editor sorts by.
 */
export function duplicateEntry(
    container: Record<string, unknown>,
    uid: number,
): { uid: number; value: Record<string, unknown> } | null {
    const location = findEntryInContainer(container, uid);
    if (!location) {
        return null;
    }

    const nextUid = nextFreeUid(container);
    const copy = structuredClone(location.value);
    copy.uid = nextUid;
    container[String(nextUid)] = copy;
    return { uid: nextUid, value: copy };
}

/**
 * The order the editor lists entries in.
 *
 * `displayIndex` first, with uid as the fallback for an entry that has none;
 * then the authored insertion `order` descending; then uid. Sorting a copy
 * leaves the caller's array in file order, which matters because that order is
 * what gets written back.
 */
export function sortEntriesForEditor(entries: readonly WorldInfoEntryView[]): WorldInfoEntryView[] {
    return [...entries].sort((a, b) => {
        const aDisplay = a.displayIndex ?? a.uid;
        const bDisplay = b.displayIndex ?? b.uid;
        if (aDisplay !== bDisplay) {
            return aDisplay - bDisplay;
        }
        if (a.order !== b.order) {
            return b.order - a.order;
        }
        return a.uid - b.uid;
    });
}

/**
 * Merge a validated patch into a stored entry.
 *
 * Merging rather than replacing is what preserves everything the editor does
 * not model: `extensions`, `vectorized` and any field a newer client or another
 * tool wrote. Key lists are trimmed and emptied, because a stray space is
 * enough to stop a key from matching and an empty string would sit in the list
 * looking like a key that never fires.
 */
export function applyEntryPatch(value: Record<string, unknown>, patch: WorldInfoEntryPatch): Record<string, unknown> {
    for (const [field, next] of Object.entries(patch)) {
        if (next === undefined) {
            continue;
        }
        if (field === 'key' || field === 'keysecondary' || field === 'triggers') {
            value[field] = (next as string[]).map((item) => item.trim()).filter(Boolean);
            continue;
        }
        value[field] = next;
    }
    return value;
}

/**
 * Build the editor's view of a book: every valid entry with its resolved uid,
 * in display order.
 *
 * The content is the stored text, decorators included. The scanner's parse
 * strips decorators, so reusing its output here would quietly delete them the
 * first time an entry was saved.
 */
export function readEntriesForEditor(raw: unknown): WorldInfoEntryView[] {
    const container = extractEntries(raw);
    if (!container) {
        return [];
    }

    const entries: WorldInfoEntryView[] = [];
    let index = 0;

    for (const [key, value] of Object.entries(container)) {
        const parsed = worldInfoEntrySchema.safeParse(value);
        if (parsed.success && isRecord(value)) {
            entries.push({ ...parsed.data, uid: resolveUid(value, key, index) });
        }
        index += 1;
    }

    return sortEntriesForEditor(entries);
}

/**
 * Assign contiguous `displayIndex` values in the given order.
 *
 * Uids the caller does not mention keep their position, so dragging three
 * entries in a fifty-entry book does not renumber the other forty-seven.
 */
export function reorderEntries(container: Record<string, unknown>, uids: readonly number[]): void {
    let index = 0;
    for (const uid of uids) {
        const location = findEntryInContainer(container, uid);
        if (!location) {
            continue;
        }
        location.value.displayIndex = index;
        index += 1;
    }
}
