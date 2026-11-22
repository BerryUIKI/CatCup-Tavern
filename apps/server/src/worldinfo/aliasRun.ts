import { randomUUID } from 'node:crypto';
import type { ScanEntry } from '@catcup/compat-st';
import { createTokenCounter, getStringHash } from '@catcup/compat-st';
import {
    type AliasEstimate,
    type AliasEvent,
    type AliasRun,
    type AliasRunItem,
    type AliasRunRequest,
    errorMessage,
    MAX_ALIAS_LENGTH,
    resolveModel,
} from '@catcup/shared';
import { mapWithConcurrency } from '../runs/concurrency.js';
import { createRun, emit, type RunState, releaseRun, subscribe } from '../runs/registry.js';
import { saveAliasRun } from '../storage/aliasRuns.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { readWorldAliases } from '../storage/worlds.js';
import { aliasMessages } from './aliasPrompts.js';
import { cleanAliases, requestAliases } from './aliasRequest.js';
import { readWorldInfoBook } from './loader.js';

/**
 * Generate a book's aliases with the active model.
 *
 * One request per entry, batched a few at a time. The unit is the entry rather
 * than the book because the review sheet's unit is the entry: a person accepts
 * one row and rejects the next, and that is only possible if each row came from
 * its own answer.
 *
 * A run is resumable, unlike book distillation's, because a large book is
 * expensive to redo. The record carries per-entry state, so a resumed run plans
 * only the rows that have no proposal yet or whose entry has changed since —
 * and `contentHash` is what makes the second case detectable.
 */

/** How many entries one run asks about at once. */
export const ALIAS_CONCURRENCY = 4;

/** A model reply listing more than this is answering a question nobody asked. */
const MAX_PROPOSED = 12;

/** The row's label: what a person scanning the review sheet recognises the entry by. */
export function labelOf(entry: ScanEntry): string {
    const comment = entry.comment.trim();
    if (comment) {
        return comment;
    }
    const key = entry.key[0]?.trim();
    return key ? key : `Entry ${entry.uid}`;
}

/** Hash of the field an alias set is generated against. */
export function contentHashOf(entry: ScanEntry): string {
    return String(getStringHash(entry.content));
}

/**
 * The rows a run would work through, in the book's order.
 *
 * An entry with no content and no keys is skipped: there is nothing for a model
 * to read, so spending a request on it produces either an empty answer or an
 * invention.
 */
export function planItems(
    entries: readonly ScanEntry[],
    aliases: Record<string, string[]>,
    options: { uids?: readonly number[]; includeExisting: boolean },
): AliasRunItem[] {
    const wanted = options.uids ? new Set(options.uids) : null;
    const items: AliasRunItem[] = [];

    for (const entry of entries) {
        if (wanted && !wanted.has(entry.uid)) {
            continue;
        }
        const existing = aliases[String(entry.uid)] ?? [];
        if (!options.includeExisting && existing.length > 0) {
            continue;
        }
        const empty = !entry.content.trim() && entry.key.length === 0;
        items.push({
            uid: entry.uid,
            label: labelOf(entry),
            state: empty ? 'skipped' : 'pending',
            ...(empty ? { message: 'This entry has no content and no keywords.' } : {}),
            existing,
        });
    }

    return items;
}

/** Everything a run needs, resolved once at the start. */
interface RunContext {
    entries: ScanEntry[];
    provider: NonNullable<Awaited<ReturnType<typeof getActiveProvider>>>;
    apiKey: string | undefined;
    model: string;
    worldId: string;
}

async function runContext(worldId: string, wanted: string | undefined): Promise<RunContext> {
    const [book, provider, settings] = await Promise.all([
        readWorldInfoBook(worldId),
        getActiveProvider(),
        getSettings(),
    ]);
    if (!book) {
        throw new Error('World info book not found');
    }
    if (!provider) {
        throw new Error('No provider is available. Configure one in Settings first.');
    }

    const resolved = resolveModel(provider, wanted ?? '', settings.profilePreferredModel);
    if (!resolved.model) {
        throw new Error('The active provider has no model selected');
    }

    return {
        entries: book.entries,
        provider,
        apiKey: await getProviderSecret(provider.id),
        model: resolved.model,
        worldId,
    };
}

/** The opening event a late subscriber is replayed. */
function startEvent(state: RunState<AliasRun, AliasEvent>): AliasEvent {
    return { type: 'start', runId: state.run.id, model: state.run.model, items: state.run.items };
}

/**
 * What a run would cost, before it starts.
 *
 * The request count is exact — it is the rows the run would plan — and the
 * token figure comes from the same tokenizer the chat budget uses, so a person
 * reading "42 requests" is reading the number they are about to spend.
 */
export async function estimateAliases(worldId: string, request: AliasRunRequest): Promise<AliasEstimate> {
    const [book, provider, settings] = await Promise.all([
        readWorldInfoBook(worldId),
        getActiveProvider(),
        getSettings(),
    ]);
    if (!book) {
        throw new Error('World info book not found');
    }

    const aliasView = await readWorldAliases(worldId);
    const items = planItems(book.entries, aliasView.aliases, {
        ...(request.uids ? { uids: request.uids } : {}),
        includeExisting: request.includeExisting,
    });

    const model = provider ? resolveModel(provider, request.model ?? '', settings.profilePreferredModel).model : '';
    const counter = provider
        ? createTokenCounter(provider.kind, model)
        : { count: (text: string) => Math.ceil(text.length / 3.6) };

    let promptTokens = 0;
    for (const item of items) {
        const entry = book.entries.find((candidate) => candidate.uid === item.uid);
        if (!entry) {
            continue;
        }
        for (const message of aliasMessages({
            title: labelOf(entry),
            keys: entry.key,
            existing: item.existing,
            content: entry.content,
        })) {
            promptTokens += counter.count(message.content);
        }
    }

    return {
        requests: items.filter((item) => item.state === 'pending').length,
        withAliases: items.filter((item) => item.existing.length > 0).length,
        empty: items.filter((item) => item.state === 'skipped').length,
        promptTokens,
        model,
    };
}

/**
 * Start a run.
 *
 * The context is resolved before the registry entry exists, so a missing
 * provider is a failed request rather than a run that fails a second later.
 *
 * `resumeOf` restarts a recorded run instead of a fresh one. Rows that already
 * have a proposal are kept unless the entry's content moved underneath them,
 * which is the case `contentHash` exists for: a proposal that describes text
 * which no longer exists is worse than no proposal.
 */
export async function startAliasRun(
    worldId: string,
    request: AliasRunRequest,
    options: { onEvent?: (event: AliasEvent) => void; resumeOf?: AliasRun } = {},
): Promise<RunState<AliasRun, AliasEvent>> {
    const context = await runContext(worldId, request.model);
    const aliasView = await readWorldAliases(worldId);

    const run: AliasRun = options.resumeOf
        ? {
              ...options.resumeOf,
              status: 'running',
              finishedAt: null,
              message: undefined,
              items: replanned(options.resumeOf.items, context.entries, aliasView.aliases),
          }
        : {
              id: randomUUID(),
              worldId,
              model: context.model,
              status: 'running',
              startedAt: Date.now(),
              finishedAt: null,
              items: planItems(context.entries, aliasView.aliases, {
                  ...(request.uids ? { uids: request.uids } : {}),
                  includeExisting: request.includeExisting,
              }),
          };

    // Stamp the hash each pending row will be generated against, so a later
    // resume can tell a kept proposal from a stale one even without a run in
    // flight to compare with.
    for (const item of run.items) {
        if (item.state !== 'pending') {
            continue;
        }
        const entry = context.entries.find((candidate) => candidate.uid === item.uid);
        if (entry) {
            item.contentHash = contentHashOf(entry);
        }
    }

    await saveAliasRun(run);

    const state = createRun<AliasRun, AliasEvent>(run, run.id, startEvent);
    if (options.onEvent) {
        subscribe<AliasRun, AliasEvent>(run.id, options.onEvent);
    }
    void execute(state, context);
    return state;
}

/**
 * Rebuild a recorded run's rows for a resume.
 *
 * A row that finished keeps its proposal only when the entry still hashes to
 * what it was generated from. Everything else goes back to pending and will be
 * asked again, which is what makes a resume after an edit correct rather than
 * merely cheap.
 *
 * A row that was **skipped** stays skipped. Skipping is a decision the plan made
 * — the entry had nothing to read — not a failure to retry, and an entry that
 * was empty when the run was planned is still empty now. Re-planning it would
 * spend a request on a model reading an empty string.
 */
export function replanned(
    previous: readonly AliasRunItem[],
    entries: readonly ScanEntry[],
    aliases: Record<string, string[]>,
): AliasRunItem[] {
    const byUid = new Map(entries.map((entry) => [entry.uid, entry]));
    const items: AliasRunItem[] = [];

    for (const item of previous) {
        const entry = byUid.get(item.uid);
        if (!entry) {
            // The entry was deleted while the run was stopped.
            items.push({ ...item, state: 'skipped', message: 'This entry is no longer in the book.' });
            continue;
        }

        const existing = aliases[String(item.uid)] ?? item.existing;
        // A skipped row is re-evaluated: an entry that was blank when the run
        // was planned may have been written since, and one that is still blank
        // must not be asked about.
        if (item.state === 'skipped') {
            const blank = !entry.content.trim() && entry.key.length === 0;
            items.push({
                ...item,
                existing,
                state: blank ? 'skipped' : 'pending',
                message: blank ? 'This entry has no content and no keywords.' : undefined,
            });
            continue;
        }

        const unchanged = item.state === 'done' && item.contentHash === contentHashOf(entry);
        items.push({
            ...item,
            existing,
            state: unchanged ? 'done' : 'pending',
            ...(unchanged ? {} : { message: undefined }),
        });
    }

    return items;
}

/** Persist a run's current state and tell everyone watching. */
async function progress(state: RunState<AliasRun, AliasEvent>, item: AliasRunItem): Promise<void> {
    await saveAliasRun(state.run);
    emit(state, { type: 'item', item });

    const total = state.run.items.filter((row) => row.state !== 'skipped').length;
    const done = state.run.items.filter((row) => row.state === 'done' || row.state === 'incomplete').length;
    emit(state, { type: 'progress', done, total });
}

async function execute(state: RunState<AliasRun, AliasEvent>, context: RunContext): Promise<void> {
    const { run, controller } = state;
    // No `start` event here: `subscribe` replays the opening event itself, so a
    // listener registered before the engine began would otherwise be sent it
    // twice — and the dialog would draw every row twice on a resume.

    try {
        const pending = run.items.filter((item) => item.state === 'pending');

        await mapWithConcurrency(pending, ALIAS_CONCURRENCY, async (item) => {
            if (controller.signal.aborted) {
                throw new Error('stopped');
            }

            const entry = context.entries.find((candidate) => candidate.uid === item.uid);
            if (!entry) {
                item.state = 'skipped';
                item.message = 'This entry is no longer in the book.';
                await progress(state, item);
                return;
            }

            item.state = 'running';
            emit(state, { type: 'item', item });

            const outcome = await requestAliases({
                provider: context.provider,
                apiKey: context.apiKey,
                model: context.model,
                title: labelOf(entry),
                keys: entry.key,
                existing: item.existing,
                content: entry.content,
                signal: controller.signal,
            });

            if (!outcome.reply) {
                item.state = 'incomplete';
                // Two failures read differently to a person: a request that
                // never arrived is a provider problem, a reply that could not be
                // read is a model problem, and the fix for one is not the other.
                item.message = outcome.unreachable
                    ? `The provider refused the request: ${outcome.problem ?? 'no answer'}.`
                    : `The model’s reply could not be read: ${outcome.problem ?? 'unexpected answer'}.`;
            } else {
                item.proposed = cleanAliases(
                    outcome.reply.aliases,
                    entry.key,
                    item.existing,
                    MAX_ALIAS_LENGTH,
                    MAX_PROPOSED,
                );
                item.contentHash = contentHashOf(entry);
                item.state = 'done';
                if (item.proposed.length === 0) {
                    item.message = 'The model found no other name for this entry.';
                }
            }

            await progress(state, item);
            // Let a socket write and a stop request in between rows.
            await new Promise((resolve) => setImmediate(resolve));
        });

        run.status = 'done';
        run.finishedAt = Date.now();
        const unreadable = run.items.filter((item) => item.state === 'incomplete').length;
        const proposed = run.items.filter((item) => (item.proposed?.length ?? 0) > 0).length;
        run.message =
            unreadable > 0
                ? `${unreadable} entr${unreadable === 1 ? 'y' : 'ies'} could not be read; the rest finished.`
                : `${proposed} entr${proposed === 1 ? 'y' : 'ies'} got new names.`;

        await saveAliasRun(run);
        emit(state, { type: 'done', run });
    } catch (error) {
        const stopped = controller.signal.aborted;
        run.status = stopped ? 'stopped' : 'failed';
        run.finishedAt = Date.now();
        run.message = stopped
            ? 'Stopped before it finished. Nothing was written.'
            : errorMessage(error) || 'The run failed';
        // Rows still in flight were interrupted mid-request; they are planned
        // again by a resume rather than left looking like work in progress.
        for (const item of run.items) {
            if (item.state === 'running') {
                item.state = 'pending';
            }
        }
        await saveAliasRun(run);
        emit(state, { type: 'done', run });
    } finally {
        releaseRun(run.id);
    }
}
