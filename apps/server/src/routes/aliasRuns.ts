import { type AliasEvent, type AliasRun, aliasApplySchema, aliasRunRequestSchema } from '@catcup/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { badRequest, HttpError, notFound } from '../http/errors.js';
import { findRun, stopRun, subscribe } from '../runs/registry.js';
import { endSse, initSse, writeSse } from '../sse.js';
import { deleteAliasRun, listAliasRuns, readAliasRun, saveAliasRun } from '../storage/aliasRuns.js';
import { applyWorldAliases, readWorldAliases } from '../storage/worlds.js';
import { estimateAliases, startAliasRun } from '../worldinfo/aliasRun.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

/**
 * The estimate query, which arrives as strings.
 *
 * A GET has no body, so the uids come as one comma-separated value and the flag
 * as `"true"`/`"false"`. Parsing them back here keeps the estimate and the run
 * on the same request shape rather than inventing a second one.
 */
const estimateQuerySchema = z.object({
    uids: z
        .string()
        .max(200_000)
        .optional()
        .transform((value) =>
            value
                ? value
                      .split(',')
                      .map((part) => Number.parseInt(part.trim(), 10))
                      .filter((uid) => Number.isInteger(uid) && uid >= 0)
                : undefined,
        ),
    includeExisting: z
        .enum(['true', 'false'])
        .default('true')
        .transform((value) => value === 'true'),
});

/**
 * Generating a book's aliases, and writing the rows a person accepts.
 *
 * The read and write endpoints for a hand-entered set live in `worlds.ts`; this
 * file is only the run and its apply. Keeping them apart is what lets an alias
 * be saved by the entry editor without a provider, and generated in bulk without
 * touching the entry patch schema.
 */

function streamRun(reply: FastifyReply, runId: string): void {
    initSse(reply);
    let closed = false;
    const write = (event: AliasEvent): void => {
        if (closed) {
            return;
        }
        writeSse(reply, event);
        if (event.type === 'done') {
            closed = true;
            endSse(reply);
        }
    };
    const unsubscribe = subscribe<AliasRun, AliasEvent>(runId, write);
    reply.raw.on('close', unsubscribe);
}

/**
 * A listener that holds events until the stream is ready.
 *
 * Starting a run can fail — no provider, no model — and that failure has to be
 * a JSON error, which means the response cannot be hijacked yet. The engine
 * begins before the route returns, so an event can arrive in between. Buffering
 * closes both gaps.
 */
function bufferEvents(): { send: (event: AliasEvent) => void; flush: (reply: FastifyReply) => void } {
    const pending: AliasEvent[] = [];
    let write: ((event: AliasEvent) => void) | null = null;

    return {
        send: (event) => {
            if (write) {
                write(event);
            } else {
                pending.push(event);
            }
        },
        flush: (reply) => {
            initSse(reply);
            let closed = false;
            write = (event) => {
                if (closed) {
                    return;
                }
                writeSse(reply, event);
                if (event.type === 'done') {
                    closed = true;
                    endSse(reply);
                }
            };
            for (const event of pending.splice(0)) {
                write(event);
            }
        },
    };
}

export async function registerAliasRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/worlds/:id/aliases/runs', async (request) => {
        const { id } = idParams.parse(request.params);
        const runs = (await listAliasRuns()).filter((run) => run.worldId === id);
        return { runs };
    });

    app.get('/api/worlds/:id/aliases/estimate', async (request) => {
        const { id } = idParams.parse(request.params);
        const query = estimateQuerySchema.parse(request.query ?? {});
        const body = aliasRunRequestSchema.parse({
            includeExisting: query.includeExisting,
            ...(query.uids ? { uids: query.uids } : {}),
        });
        try {
            return { estimate: await estimateAliases(id, body) };
        } catch (error) {
            throw notFound(error instanceof Error ? error.message : 'World info book not found');
        }
    });

    /**
     * Start a run and stream its progress.
     *
     * The response is the event stream itself, so the dialog that started the
     * run is also the one watching it. The listener is registered through the
     * start call rather than after it: the engine is not awaited, so a run that
     * fails on its first request would otherwise finish before anything was
     * listening.
     */
    app.post('/api/worlds/:id/aliases/runs', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const body = aliasRunRequestSchema.parse(request.body ?? {});
        const buffered = bufferEvents();

        try {
            await startAliasRun(id, body, { onEvent: buffered.send });
            buffered.flush(reply);
        } catch (error) {
            if (error instanceof Error && /provider|model selected/i.test(error.message)) {
                throw badRequest(error.message);
            }
            throw notFound(error instanceof Error ? error.message : 'The run could not start');
        }
    });

    /** Reattach to a run that is still going. A finished one is read, not streamed. */
    app.post('/api/worlds/:id/aliases/runs/:runId/attach', async (request, reply) => {
        const { runId } = z.object({ runId: z.string().min(1).max(200) }).parse(request.params);
        const state = findRun<AliasRun, AliasEvent>(runId);
        if (!state) {
            const stored = await readAliasRun(runId);
            if (!stored) {
                throw notFound('Run not found');
            }
            throw new HttpError(409, 'That run has already finished', 'ALIAS_FINISHED');
        }

        streamRun(reply, runId);
    });

    app.get('/api/worlds/:id/aliases/runs/:runId', async (request) => {
        const { runId } = z.object({ runId: z.string().min(1).max(200) }).parse(request.params);
        const run = await readAliasRun(runId);
        if (!run) {
            throw notFound('Run not found');
        }
        return { run };
    });

    app.post('/api/worlds/:id/aliases/runs/:runId/stop', async (request) => {
        const { runId } = z.object({ runId: z.string().min(1).max(200) }).parse(request.params);
        return { ok: stopRun(runId) };
    });

    /**
     * Restart a recorded run, keeping every proposal still worth keeping.
     *
     * This is the resume book distillation does not have. A row that finished
     * and whose entry has not changed keeps its proposal and is not asked again;
     * everything else is planned fresh. The reply is a new stream, so a client
     * reattaching to a stopped run follows the same code path as starting one.
     */
    app.post('/api/worlds/:id/aliases/runs/:runId/resume', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const { runId } = z.object({ runId: z.string().min(1).max(200) }).parse(request.params);
        const stored = await readAliasRun(runId);
        if (!stored) {
            throw notFound('Run not found');
        }
        if (findRun(runId)) {
            throw new HttpError(409, 'That run is still going', 'ALIAS_RUNNING');
        }

        const body = aliasRunRequestSchema.parse(request.body ?? {});
        const buffered = bufferEvents();

        try {
            await startAliasRun(id, body, { onEvent: buffered.send, resumeOf: stored });
            buffered.flush(reply);
        } catch (error) {
            if (error instanceof Error && /provider|model selected/i.test(error.message)) {
                throw badRequest(error.message);
            }
            throw notFound(error instanceof Error ? error.message : 'The run could not start');
        }
    });

    /**
     * Write the rows a person kept.
     *
     * The client owns the chips, so what arrives is what is stored. A row the
     * book no longer holds is skipped rather than failing the batch: an entry
     * deleted between the run and the apply should cost that row, not the work.
     */
    app.post('/api/worlds/:id/aliases/apply', async (request) => {
        const { id } = idParams.parse(request.params);
        const body = aliasApplySchema.parse(request.body ?? {});

        // Provenance travels with the run, not with each row: a row's hash was
        // stamped when it was planned, and the apply is the only moment it is
        // known which run a row came from. The model goes with it for the same
        // reason — a book filled in over several runs cannot otherwise say
        // which rows came from the cheap one.
        const from = new Map<number, string>();
        const runId = z.object({ runId: z.string().max(200).optional() }).parse(request.query ?? {}).runId;
        const run = runId ? await readAliasRun(runId) : null;
        for (const item of run?.items ?? []) {
            if (item.contentHash) {
                from.set(item.uid, item.contentHash);
            }
        }

        try {
            const result = await applyWorldAliases(id, body.entries, from, run?.model ?? '');
            if (run) {
                await saveAliasRun({ ...run, applied: result });
            }
            return result;
        } catch (error) {
            throw notFound(error instanceof Error ? error.message : 'The aliases could not be written');
        }
    });

    app.delete('/api/worlds/:id/aliases/runs/:runId', async (request) => {
        const { runId } = z.object({ runId: z.string().min(1).max(200) }).parse(request.params);
        return { ok: await deleteAliasRun(runId) };
    });

    /** A reminder for the client: the book's stale rows are what a refresh targets. */
    app.get('/api/worlds/:id/aliases/stale', async (request) => {
        const { id } = idParams.parse(request.params);
        const view = await readWorldAliases(id);
        return { stale: view.stale };
    });
}
