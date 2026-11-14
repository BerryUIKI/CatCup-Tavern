import { rm } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

let root: string;
let app: FastifyInstance;
let cookie: string;

const novel = ['Chapter 1', 'Mira lit the lamp.', '', 'Chapter 2', 'Bram arrived.'].join('\n');

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

/** Upload a book the way the dialog does, as multipart. */
async function upload(fileName: string, body: Buffer) {
    const boundary = '----catcupbookboundary';
    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, body, tail]);

    return app.inject({
        method: 'POST',
        url: '/api/distill/books',
        payload,
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-distill-routes-');
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'a long enough password' },
        remoteAddress: '127.0.0.1',
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';
});

afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('book upload', () => {
    it('stores a text book and returns its sections and an estimate', async () => {
        const response = await upload('novel.txt', Buffer.from(novel, 'utf8'));
        expect(response.statusCode).toBe(201);

        const body = response.json() as {
            book: { id: string; name: string; format: string; sections: { title: string }[] };
            estimate: { chunks: number; promptTokens: number };
        };
        expect(body.book.id).toBe('novel');
        expect(body.book.format).toBe('txt');
        expect(body.book.sections.map((section) => section.title)).toEqual(['Chapter 1', 'Chapter 2']);
        expect(body.estimate.chunks).toBe(1);
        expect(body.estimate.promptTokens).toBeGreaterThan(0);
    });

    it('refuses a format it cannot read, and stores nothing', async () => {
        const response = await upload('book.pdf', Buffer.from('%PDF-1.4'));
        expect(response.statusCode).toBe(400);
        expect((response.json() as { code: string }).code).toBe('DISTILL_FORMAT');

        const listed = await call('GET', '/api/distill/books');
        const ids = (listed.json() as { books: { id: string }[] }).books.map((book) => book.id);
        expect(ids).not.toContain('book');
    });

    it('refuses an EPUB nothing can unpack', async () => {
        const response = await upload('broken.epub', Buffer.from('not a zip at all'));
        expect(response.statusCode).toBe(400);
        expect((response.json() as { code: string }).code).toBe('DISTILL_FORMAT');
    });

    it('refuses an upload with no file', async () => {
        const response = await call('POST', '/api/distill/books');
        expect(response.statusCode).toBe(400);
        expect((response.json() as { code: string }).code).toBe('DISTILL_FORMAT');
    });
});

describe('book listing', () => {
    it('returns one book by id and 404 for a missing one', async () => {
        const found = await call('GET', '/api/distill/books/novel');
        expect(found.statusCode).toBe(200);
        expect((found.json() as { book: { fileName: string } }).book.fileName).toBe('novel.txt');

        const missing = await call('GET', '/api/distill/books/nothing');
        expect(missing.statusCode).toBe(404);
    });

    it('deletes a book and its folder', async () => {
        const created = await upload('throwaway.txt', Buffer.from(novel, 'utf8'));
        const id = (created.json() as { book: { id: string } }).book.id;

        const removed = await call('DELETE', `/api/distill/books/${encodeURIComponent(id)}`);
        expect(removed.statusCode).toBe(200);

        const again = await call('DELETE', `/api/distill/books/${encodeURIComponent(id)}`);
        expect(again.statusCode).toBe(404);
    });

    it('stores the book inside the active profile, not at the data root', async () => {
        const created = await upload('scoped.txt', Buffer.from(novel, 'utf8'));
        const id = (created.json() as { book: { id: string } }).book.id;

        const stored = await import('node:fs/promises').then((fs) =>
            fs
                .stat(fixturePath(root, 'books', id, 'source.txt'))
                .then(() => true)
                .catch(() => false),
        );
        expect(stored).toBe(true);
    });
});
