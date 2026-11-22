import { randomUUID } from 'node:crypto';

import {
    type DistillAcceptInput,
    type DistillChunk,
    type DistillDraft,
    type DistillEntryDraft,
    type DistillEvent,
    type DistillRun,
    errorMessage,
    type ItemScope,
    resolveModel,
} from '@catcup/shared';

import { createTokenCounter } from '../prompt/tokenizer.js';
import { createRun, emit, type RunState, releaseRun, subscribe } from '../runs/registry.js';
import { readBook, readBookSections } from '../storage/books.js';
import { importCharacter, setCharacterWorld } from '../storage/characters.js';
import { saveRun } from '../storage/distillRuns.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { createWorld } from '../storage/worlds.js';
import { NEW_ENTRY_DEFAULTS } from '../worldinfo/entries.js';
import { analyzeChunk } from './analyze.js';
import { chunkBook, chunkBudget } from './chunk.js';
import { mergeAnalyses } from './merge.js';
import { outlineClusters } from './outline.js';
import type { Section } from './sections.js';

/**
 * The run engine.
 *
 * Sections mode is the whole feature with no model call: every chapter becomes
 * one world info entry whose body is that chapter. It is deterministic, it
 * costs nothing, and — because it exercises the same run record, the same
 * progress events and the same accept path as the model mode — it is the test
 * bed the review sheet is built against.
 *
 * Model mode adds three stages on top: one analysis request per chunk, a merge
 * that clusters what the requests found, and one outline request per entity
 * worth writing up. Accept does not know which of them produced the draft.
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

/** One row per request a model run will make, so the list is the real cost. */
export function modelChunks(chunks: readonly { label: string }[]): DistillChunk[] {
    return chunks.map((chunk, index) => ({
        index,
        stage: 'analyze' as const,
        label: chunk.label,
        state: 'pending' as const,
    }));
}

/** Everything a model run needs, resolved once at the start. */
interface ModelContext {
    provider: NonNullable<Awaited<ReturnType<typeof getActiveProvider>>>;
    apiKey: string | undefined;
    model: string;
    /** Sections, so a chunk's chapter label can be recovered from its section ids. */
    sections: readonly Section[];
    chunks: ReturnType<typeof chunkBook>;
}

/** Resolve the provider, key, model and chunk plan a model run will use. */
async function modelContext(bookId: string, wanted: string | undefined): Promise<ModelContext> {
    const [provider, settings, sections] = await Promise.all([
        getActiveProvider(),
        getSettings(),
        readBookSections(bookId),
    ]);
    if (!provider) {
        throw new Error('No provider is available. Configure one in Settings first.');
    }

    const resolved = resolveModel(provider, wanted ?? '', settings.profilePreferredModel);
    if (!resolved.model) {
        throw new Error('The active provider has no model selected');
    }

    const counter = createTokenCounter(provider.kind, resolved.model);
    return {
        provider,
        apiKey: await getProviderSecret(provider.id),
        model: resolved.model,
        sections,
        chunks: chunkBook(sections, counter.count, chunkBudget(settings.generation.contextSize)),
    };
}

/** The section title a chunk starts in, for its row and for the draft's chapter. */
function chapterOf(sections: readonly Section[], chunk: { sections: number[] }): string {
    return sections[chunk.sections[0] ?? 0]?.title ?? 'Unfiled';
}

/**
 * Start a sections run.
 *
 * The draft is built from the stored source file, so it always reflects what
 * was uploaded. A run over a large book yields immediately to the event loop
 * between chapters, which is what lets the progress rows arrive one at a time
 * instead of all at once when the loop finishes.
 *
 * `onEvent` is subscribed **before** the engine runs, so even a run that fails
 * on its very first step reports it. Passing a listener here rather than after
 * the call is what closes that gap.
 */
export async function startSectionsRun(bookId: string, onEvent?: (event: DistillEvent) => void): Promise<RunState> {
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

    const state = createRun<DistillRun, DistillEvent>(run, run.id, (current) => ({
        type: 'start',
        runId: current.run.id,
        model: current.run.model,
        chunks: current.run.chunks,
    }));
    if (onEvent) {
        subscribe(run.id, onEvent);
    }
    void executeSections(state, sections);
    return state;
}

/**
 * Start a model run.
 *
 * The plan is resolved before the registry entry exists, so a missing provider
 * is a failed request rather than a run that fails a second later.
 */
export async function startModelRun(
    bookId: string,
    wanted: string | undefined,
    onEvent?: (event: DistillEvent) => void,
): Promise<RunState> {
    const book = await readBook(bookId);
    if (!book) {
        throw new Error('Book not found');
    }

    const context = await modelContext(bookId, wanted);
    const run: DistillRun = {
        id: randomUUID(),
        bookId,
        bookName: book.name,
        mode: 'model',
        model: context.model,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        chunks: modelChunks(context.chunks),
        draft: null,
    };
    await saveRun(run);

    const state = createRun<DistillRun, DistillEvent>(run, run.id, (current) => ({
        type: 'start',
        runId: current.run.id,
        model: current.run.model,
        chunks: current.run.chunks,
    }));
    if (onEvent) {
        subscribe(run.id, onEvent);
    }
    void executeModel(state, context);
    return state;
}

async function executeSections(state: RunState, sections: readonly { title: string; text: string }[]): Promise<void> {
    const { run, controller } = state;
    // No `start` event here: `subscribe` replays it, so a listener registered
    // before the engine began would otherwise be sent the opening event twice.

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

        await finishRun(state, 'done', { entries, characters: [] });
    } catch (error) {
        await failRun(state, error);
    }
}

/**
 * Run the model pipeline: analyse, merge, outline.
 *
 * Each stage waits for the one before it — a merge cannot start until every
 * chunk has been read — so the progress rows fill in three waves. A chunk whose
 * reply could not be used is marked incomplete and the run carries on; the
 * finished record says which chapters were skipped.
 */
async function executeModel(state: RunState, context: ModelContext): Promise<void> {
    const { run, controller } = state;
    // See `executeSections`: the replay in `subscribe` is the only `start`.

    try {
        const analyses: Awaited<ReturnType<typeof analyzeChunk>>[] = [];
        const chapters: string[] = [];

        for (const [index, chunk] of context.chunks.entries()) {
            if (controller.signal.aborted) {
                throw new Error('stopped');
            }

            const chapter = chapterOf(context.sections, chunk);
            chapters.push(chapter);

            const row = run.chunks[index];
            if (row) {
                row.state = 'running';
                emit(state, { type: 'chunk', chunk: row, found: { entries: 0, characters: 0 } });
            }

            const analysis = await analyzeChunk({
                provider: context.provider,
                apiKey: context.apiKey,
                model: context.model,
                text: chunk.text,
                chapter,
                signal: controller.signal,
            });
            analyses.push(analysis);

            if (row) {
                row.state = analysis ? 'done' : 'incomplete';
                if (!analysis) {
                    row.message = 'The model’s reply could not be read; this chapter was skipped.';
                }
                emit(state, {
                    type: 'chunk',
                    chunk: row,
                    found: {
                        entries: analyses.reduce((sum, item) => sum + (item?.facts.length ?? 0), 0),
                        characters: analyses.reduce((sum, item) => sum + (item?.characters.length ?? 0), 0),
                    },
                });
            }
            emit(state, { type: 'progress', done: index + 1, total: context.chunks.length });

            // A stop during a model request must not take the run down with it.
            await new Promise((resolve) => setImmediate(resolve));
        }

        const skipped = run.chunks.filter((row) => row.state === 'incomplete').length;
        if (skipped > 0) {
            run.message = `${skipped} chapter${skipped === 1 ? '' : 's'} could not be read and were skipped.`;
        }

        const clusters = await mergeAnalyses({
            analyses,
            chapters,
            provider: context.provider,
            apiKey: context.apiKey,
            model: context.model,
            signal: controller.signal,
        });

        // The outline stage gets its own rows, appended after the analysis ones,
        // so the progress list tells a person what the time is being spent on.
        const outlineRows: DistillChunk[] = clusters.map((cluster, index) => ({
            index: context.chunks.length + index,
            stage: 'outline' as const,
            label: cluster.name,
            state: 'pending' as const,
        }));
        run.chunks.push(...outlineRows);
        emit(state, { type: 'progress', done: context.chunks.length, total: run.chunks.length });

        const draft = await outlineClusters(
            clusters,
            {
                provider: context.provider,
                apiKey: context.apiKey,
                model: context.model,
                signal: controller.signal,
            },
            (done, total) => {
                for (const row of outlineRows.slice(0, done)) {
                    row.state = 'done';
                }
                emit(state, {
                    type: 'progress',
                    done: context.chunks.length + done,
                    total: context.chunks.length + total,
                });
                const latest = outlineRows[done - 1];
                if (latest) {
                    emit(state, { type: 'chunk', chunk: latest, found: { entries: 0, characters: 0 } });
                }
            },
        );

        await finishRun(state, 'done', draft);
    } catch (error) {
        await failRun(state, error);
    }
}

/** Persist a finished run and tell everyone watching. */
async function finishRun(state: RunState, status: 'done', draft: DistillDraft): Promise<void> {
    const finished: DistillRun = {
        ...state.run,
        status,
        finishedAt: Date.now(),
        draft,
    };
    await saveRun(finished);
    emit(state, { type: 'done', run: finished });
    releaseRun(state.run.id);
}

/** Record why a run stopped or failed, and tell everyone watching. */
async function failRun(state: RunState, error: unknown): Promise<void> {
    const stopped = state.controller.signal.aborted;
    const finished: DistillRun = {
        ...state.run,
        status: stopped ? 'stopped' : 'failed',
        finishedAt: Date.now(),
        message: stopped ? 'Stopped before it finished. Nothing was written.' : errorMessage(error) || 'The run failed',
    };
    await saveRun(finished);
    emit(state, { type: 'done', run: finished });
    releaseRun(state.run.id);
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
