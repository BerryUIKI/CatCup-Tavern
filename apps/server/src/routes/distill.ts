import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { estimateBook } from '../distill/estimate.js';
import { BookParseError } from '../distill/parse.js';
import { HttpError, notFound } from '../http/errors.js';
import { createBook, deleteBook, listBooks, readBook } from '../storage/books.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

export async function registerDistillRoutes(app: FastifyInstance): Promise<void> {
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
}
