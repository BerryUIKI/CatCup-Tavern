import { type DistillEvent, distillAcceptSchema, distillRunRequestSchema } from '@catcup/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { estimateBook } from '../distill/estimate.js';
import { BookParseError } from '../distill/parse.js';
import { acceptDraft, startModelRun, startSectionsRun } from '../distill/run.js';
import { buildSkillArchive, SKILL_NAME } from '../distill/skill.js';
import { badRequest, HttpError, notFound } from '../http/errors.js';
import { findRun, stopRun, subscribe } from '../runs/registry.js';
import { endSse, initSse, writeSse } from '../sse.js';
import { createBook, deleteBook, listBooks, readBook } from '../storage/books.js';
import { deleteRun, listRuns, readRun, saveRun } from '../storage/distillRuns.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

/**
 * Stream a run's events to one client.
 *
 * Closing the stream does not stop the run: it is minutes of work and the
 * person may have closed the tab. Only the stop endpoint cancels it, and the
 * record on disk keeps the progress a reattach reads. The stream ends itself on
 * the run's `done` event, which is the only terminal one.
 */
function streamRun(reply: FastifyReply, runId: string): void {
    initSse(reply);
    const write = openStream(reply);
    const unsubscribe = subscribe(runId, write);
    reply.raw.on('close', unsubscribe);
}

/** An event writer for an already-initialized stream; ends it on the terminal event. */
function openStream(reply: FastifyReply): (event: DistillEvent) => void {
    return (event) => {
        writeSse(reply, event);
        if (event.type === 'done') {
            endSse(reply);
        }
    };
}

/**
 * A listener that holds events until the stream is ready.
 *
 * Starting a run can fail — no provider, no model — and that failure has to be
 * a JSON error, which means the response cannot be hijacked yet. But the engine
 * begins before the route returns, so an event can arrive in between. Buffering
 * closes both gaps: nothing is lost, and an error is still a normal response.
 */
function bufferEvents(): { send: (event: DistillEvent) => void; flush: (reply: FastifyReply) => void } {
    const pending: DistillEvent[] = [];
    let write: ((event: DistillEvent) => void) | null = null;

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
            write = openStream(reply);
            for (const event of pending.splice(0)) {
                write(event);
            }
        },
    };
}

export async function registerDistillRoutes(app: FastifyInstance): Promise<void> {
    // --- books -------------------------------------------------------------

    app.get('/api/distill/books', async () => ({ books: await listBooks() }));

    app.get('/api/distill/books/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const book = await readBook(id);
        if (!book) {
            throw notFound('Book not found');
        }
        return { book };
    });

    /**
     * Upload a book.
     *
     * The file is parsed before it is stored, so an unreadable or DRM-locked
     * file leaves nothing behind — and the estimate that comes back is what the
     * run dialog shows before anything is spent.
     */
    app.post('/api/distill/books', async (request, reply) => {
        if (!request.isMultipart()) {
            throw new HttpError(400, 'Upload the book as a file', 'DISTILL_FORMAT');
        }

        let uploaded: { fileName: string; buffer: Buffer } | null = null;

        for await (const part of request.parts()) {
            if (part.type !== 'file' || uploaded) {
                continue;
            }
            uploaded = { fileName: part.filename ?? 'book.txt', buffer: await part.toBuffer() };
        }

        if (!uploaded) {
            throw new HttpError(400, 'Choose a book file to upload', 'DISTILL_FORMAT');
        }

        try {
            const book = await createBook(uploaded.fileName, uploaded.buffer);
            reply.code(201);
            return { book, estimate: await estimateBook(book.id) };
        } catch (error) {
            if (error instanceof BookParseError) {
                throw new HttpError(400, error.message, error.code);
            }
            throw error;
        }
    });

    app.delete('/api/distill/books/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        if (!(await deleteBook(id))) {
            throw notFound('Book not found');
        }
        return { ok: true };
    });

    /**
     * The distillation pipeline as a portable Claude Skill, as a ZIP.
     *
     * Prompt-only: the instructions and the output contracts travel, a second
     * implementation of the chunker does not. The archive is generated from the
     * same constants a run sends, so it cannot describe prompts the server has
     * stopped using — and it needs no provider, no model and no uploaded book,
     * because nothing in it is a run.
     */
    app.get('/api/distill/skill', async (_request, reply) =>
        reply
            .header('Content-Type', 'application/zip')
            .header('Content-Disposition', `attachment; filename="${SKILL_NAME}.zip"`)
            .send(buildSkillArchive()),
    );

    // --- runs --------------------------------------------------------------

    app.get('/api/distill/runs', async () => ({ runs: await listRuns() }));

    app.get('/api/distill/runs/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const run = await readRun(id);
        if (!run) {
            throw notFound('Run not found');
        }
        return { run };
    });

    /**
     * Start a run and stream its progress.
     *
     * The response is the event stream itself, so the dialog that started the
     * run is also the one watching it. `sections` needs no model; `model` reads
     * the book once per chunk and writes up what it found.
     *
     * The listener is registered through the start call rather than after it:
     * the engine is not awaited, so a run that fails on its first request would
     * otherwise finish before anything was listening, and the stream would never
     * see its own terminal event.
     */
    app.post('/api/distill/runs', async (request, reply) => {
        const body = distillRunRequestSchema.parse(request.body ?? {});

        const book = await readBook(body.bookId);
        if (!book) {
            throw notFound('Book not found');
        }

        // The start can fail before the engine exists — no provider, no model —
        // and that has to be a JSON error, so the stream is opened only after
        // it succeeds. Events emitted in between wait in the buffer.
        const buffered = bufferEvents();

        try {
            if (body.mode === 'model') {
                await startModelRun(body.bookId, body.model, buffered.send);
            } else {
                await startSectionsRun(body.bookId, buffered.send);
            }
            buffered.flush(reply);
        } catch (error) {
            if (error instanceof Error && /provider|model selected/i.test(error.message)) {
                throw badRequest(error.message);
            }
            throw error;
        }
    });

    /** Reattach to a run that is still going. A finished one is read, not streamed. */
    app.post('/api/distill/runs/:id/attach', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const state = findRun(id);
        if (!state) {
            const stored = await readRun(id);
            if (!stored) {
                throw notFound('Run not found');
            }
            throw new HttpError(409, 'That run has already finished', 'DISTILL_FINISHED');
        }

        streamRun(reply, id);
    });

    app.post('/api/distill/runs/:id/stop', async (request) => {
        const { id } = idParams.parse(request.params);
        return { ok: stopRun(id) };
    });

    /** Write an accepted draft. The edited draft comes back from the review sheet. */
    app.post('/api/distill/runs/:id/accept', async (request) => {
        const { id } = idParams.parse(request.params);
        const run = await readRun(id);
        if (!run) {
            throw notFound('Run not found');
        }
        if (run.status === 'running') {
            throw new HttpError(409, 'That run is still going', 'DISTILL_RUNNING');
        }

        const input = distillAcceptSchema.parse(request.body ?? {});
        const accepted = await acceptDraft(input);
        const saved = { ...run, accepted };
        await saveRun(saved);

        return { run: saved, ...accepted };
    });

    app.delete('/api/distill/runs/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        if (!(await deleteRun(id))) {
            throw notFound('Run not found');
        }
        return { ok: true };
    });
}
