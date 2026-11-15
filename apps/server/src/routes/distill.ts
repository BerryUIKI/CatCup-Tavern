import { distillAcceptSchema, distillRunRequestSchema } from '@catcup/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { estimateBook } from '../distill/estimate.js';
import { BookParseError } from '../distill/parse.js';
import { findRun, stopRun, subscribe } from '../distill/registry.js';
import { acceptDraft, startSectionsRun } from '../distill/run.js';
import { HttpError, notFound } from '../http/errors.js';
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
    const unsubscribe = subscribe(runId, (event) => {
        writeSse(reply, event);
        if (event.type === 'done') {
            unsubscribe();
            endSse(reply);
        }
    });
    reply.raw.on('close', unsubscribe);
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
     * run is also the one watching it. `sections` needs no model; `model` is the
     * pipeline in a later slice and answers `400` until it exists, rather than
     * silently producing a sections draft under a model's name.
     */
    app.post('/api/distill/runs', async (request, reply) => {
        const body = distillRunRequestSchema.parse(request.body ?? {});
        if (body.mode === 'model') {
            throw new HttpError(400, 'Model distillation is not available yet', 'DISTILL_UNSUPPORTED');
        }

        const book = await readBook(body.bookId);
        if (!book) {
            throw notFound('Book not found');
        }

        const state = await startSectionsRun(body.bookId);
        streamRun(reply, state.run.id);
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
