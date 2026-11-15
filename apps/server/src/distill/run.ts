import { randomUUID } from 'node:crypto';

import type { DistillAcceptInput, DistillChunk, DistillEntryDraft, DistillRun, ItemScope } from '@catcup/shared';
import { readBook, readBookSections } from '../storage/books.js';
import { importCharacter, setCharacterWorld } from '../storage/characters.js';
import { saveRun } from '../storage/distillRuns.js';
import { createWorld } from '../storage/worlds.js';
import { NEW_ENTRY_DEFAULTS } from '../worldinfo/entries.js';
import { createRun, emit, type RunState, releaseRun } from './registry.js';

/**
 * The run engine.
 *
 * Sections mode is the whole feature with no model call: every chapter becomes
 * one world info entry whose body is that chapter. It is deterministic, it
 * costs nothing, and — because it exercises the same run record, the same
 * progress events and the same accept path as the model mode — it is the test
 * bed the review sheet is built against.
 *
 * Model mode plugs into the same three functions later: `planRun` decides the
 * chunk list, the executor fills in the draft, and accept does not care which
 * of them produced it.
 */

/** A title's words are the keys a person would type in play, minus the filler. */
const KEY_STOPWORDS = new Set([
    'chapter',
    'part',
    'book',
    'section',
    'the',
    'of',
    'a',
    'an',
    'and',
    'to',
    'in',
    'at',
    'on',
    'for',
]);

/**
 * A Chinese chapter number, which is a numeral rather than a cue. `第一章` is
 * written without spaces, so dropping the stop words alone would keep the whole
 * title as a key.
 */
const CHINESE_CHAPTER = /^第[0-9零一二三四五六七八九十百千]+[章回节卷]$/;

/** Longest key a world info entry should carry; longer phrases never match a chat. */
const MAX_KEY_LENGTH = 40;

/** How many keys one entry gets, so a title does not flood the scanner. */
const MAX_KEYS = 4;

/**
 * Turn a chapter title into scanner keys.
 *
 * `Chapter 12` gives nothing useful — every entry would match the word
 * "chapter" — so a title made only of filler yields no keys and the entry is
 * matched by its comment instead. A real title keeps its words.
 */
export function keysFromTitle(title: string): string[] {
    const trimmed = title.trim();
    if (CHINESE_CHAPTER.test(trimmed)) {
        return [];
    }

    const words = trimmed
        .toLowerCase()
        .split(/[^\p{L}\p{N}'-]+/u)
        // A lone number is a chapter number, never a word someone types in play.
        .filter(
            (word) =>
                word.length > 1 && !/^\d+$/.test(word) && word.length <= MAX_KEY_LENGTH && !KEY_STOPWORDS.has(word),
        );

    return [...new Set(words)].slice(0, MAX_KEYS);
}

/** Build the entry drafts a sections run produces, one per chapter. */
export function sectionsDraft(sections: readonly { title: string; text: string }[]): DistillEntryDraft[] {
    return sections.map((section) => ({
        key: keysFromTitle(section.title),
        keysecondary: [],
        comment: section.title,
        content: section.text,
        // A chapter is present throughout its own part of the story but is not
        // a constant: making every chapter constant would spend the whole
        // budget on the first message.
        constant: false,
        position: 0,
        chapter: section.title,
        mentions: 1,
        confidence: 'high' as const,
        evidence: section.text.slice(0, 240),
        accepted: true,
    }));
}

/** The chunk rows the progress list shows for a sections run. */
export function sectionChunks(sections: readonly { title: string }[]): DistillChunk[] {
    return sections.map((section, index) => ({
        index,
        stage: 'analyze' as const,
        label: section.title,
        state: 'pending' as const,
    }));
}

/**
 * Start a sections run.
 *
 * The draft is built from the stored source file, so it always reflects what
 * was uploaded. A run over a large book yields immediately to the event loop
 * between chapters, which is what lets the progress rows arrive one at a time
 * instead of all at once when the loop finishes.
 */
export async function startSectionsRun(bookId: string): Promise<RunState> {
    const book = await readBook(bookId);
    if (!book) {
        throw new Error('Book not found');
    }

    const sections = await readBookSections(bookId);
    const run: DistillRun = {
        id: randomUUID(),
        bookId,
        bookName: book.name,
        mode: 'sections',
        model: '',
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        chunks: sectionChunks(sections),
        draft: null,
    };
    await saveRun(run);

    const state = createRun(run);
    // The caller registers its listener before this resolves, so the first
    // `start` event cannot race ahead of the dialog that is watching for it.
    void execute(state, sections);
    return state;
}

async function execute(state: RunState, sections: readonly { title: string; text: string }[]): Promise<void> {
    const { run, controller } = state;
    emit(state, { type: 'start', runId: run.id, model: '', chunks: run.chunks });

    try {
        const entries: DistillEntryDraft[] = [];

        for (const [index, section] of sections.entries()) {
            if (controller.signal.aborted) {
                throw new Error('stopped');
            }

            const chunk = run.chunks[index];
            if (chunk) {
                chunk.state = 'running';
                emit(state, { type: 'chunk', chunk, found: { entries: entries.length, characters: 0 } });
            }

            const entry = sectionsDraft([section])[0];
            if (entry) {
                entries.push(entry);
            }

            if (chunk) {
                chunk.state = 'done';
                emit(state, { type: 'chunk', chunk, found: { entries: entries.length, characters: 0 } });
            }
            emit(state, { type: 'progress', done: index + 1, total: sections.length });

            await saveRun({ ...run, draft: { entries, characters: [] } });
            // Let a socket write and a stop request in before the next chapter.
            await new Promise((resolve) => setImmediate(resolve));
        }

        const finished: DistillRun = {
            ...run,
            status: 'done',
            finishedAt: Date.now(),
            draft: { entries, characters: [] },
        };
        await saveRun(finished);
        emit(state, { type: 'done', run: finished });
    } catch (error) {
        const stopped = controller.signal.aborted;
        const finished: DistillRun = {
            ...run,
            status: stopped ? 'stopped' : 'failed',
            finishedAt: Date.now(),
            message: stopped
                ? 'Stopped before it finished. Nothing was written.'
                : error instanceof Error
                  ? error.message
                  : 'The run failed',
        };
        await saveRun(finished);
        emit(state, { type: 'done', run: finished });
    } finally {
        releaseRun(run.id);
    }
}

/** Assemble a stored world info book from accepted entry drafts. */
export function buildWorldBook(entries: readonly DistillEntryDraft[]): { entries: Record<string, unknown> } {
    const book: Record<string, unknown> = {};

    entries.forEach((entry, uid) => {
        book[String(uid)] = {
            ...structuredClone(NEW_ENTRY_DEFAULTS),
            uid,
            key: entry.key,
            keysecondary: entry.keysecondary,
            comment: entry.comment,
            content: entry.content,
            constant: entry.constant,
            position: entry.position,
            displayIndex: uid,
        };
    });

    return { entries: book };
}

/** A character draft as a V2 card, the shape the library imports. */
export function buildCard(draft: DistillAcceptInput['characters'][number], world: string | null): Buffer {
    const payload = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: draft.name,
            description: draft.description,
            personality: draft.personality,
            scenario: draft.scenario,
            first_mes: draft.first_mes,
            mes_example: draft.mes_example,
            tags: draft.tags,
            creator: 'CatCup distillation',
            creator_notes: draft.aliases.length > 0 ? `Also known as: ${draft.aliases.join(', ')}` : '',
            character_version: '1.0',
            extensions: {
                ...(world ? { world } : {}),
                // Provenance, so a card made this way can say what it came from.
                catcup_distill: { aliases: draft.aliases, mentions: draft.mentions, confidence: draft.confidence },
            },
        },
    };

    return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export interface AcceptResult {
    worldId: string;
    scope: ItemScope;
    characterIds: string[];
}

/**
 * Write an accepted draft.
 *
 * The client owns the inline edits, so what arrives here is the draft to keep.
 * Nothing is written for an entry that was unticked, which is the promise the
 * review sheet makes.
 */
export async function acceptDraft(input: DistillAcceptInput): Promise<AcceptResult> {
    const entries = input.entries.filter((entry) => entry.accepted);
    const characters = input.characters.filter((character) => character.accepted);

    const world = await createWorld({
        fileName: input.world.id,
        book: buildWorldBook(entries),
        scope: input.world.scope,
    });

    const characterIds: string[] = [];
    for (const character of characters) {
        const card = await importCharacter(
            `${character.name}.json`,
            buildCard(character, input.linkWorld ? world.id : null),
            input.characterScope,
        );
        if (input.linkWorld) {
            // Addressed by scope: the profile may already hold a card of this
            // id, and a profile-first lookup would patch that one instead.
            await setCharacterWorld(card.id, world.id, input.characterScope);
        }
        characterIds.push(card.id);
    }

    return { worldId: world.id, scope: input.world.scope, characterIds };
}
