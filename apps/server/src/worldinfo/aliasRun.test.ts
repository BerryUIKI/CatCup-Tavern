import { createServer, type Server } from 'node:http';

import { type AliasRun, MAX_ALIAS_LENGTH } from '@catcup/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * Alias generation, end to end against a stub provider.
 *
 * The stub answers with a scripted list, so what is under test is everything
 * around the model: the plan, the batching, what gets filtered out of a reply,
 * the record a resume reads, and the sidecar an apply writes. No network, no
 * key, no cost.
 */

/** A promise with its settler held, so an event can resolve it from outside. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

interface Stub {
    server: Server;
    baseUrl: string;
    close: () => Promise<void>;
    requests: () => string[];
    setReplies: (replies: string[]) => void;
}

async function stubProvider(replies: string[]): Promise<Stub> {
    let index = 0;
    let scripted = replies;
    const bodies: string[] = [];

    const server = createServer((request, response) => {
        let payload = '';
        request.on('data', (chunk) => {
            payload += chunk;
        });
        request.on('end', () => {
            if (!request.url?.endsWith('/chat/completions')) {
                response.writeHead(404);
                response.end();
                return;
            }
            bodies.push(payload);
            const reply = scripted[Math.min(index, scripted.length - 1)] ?? '';
            index += 1;
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
            response.write('data: [DONE]\n\n');
            response.end();
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    return {
        server,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise<void>((done) => server.close(() => done())),
        requests: () => bodies,
        setReplies: (next) => {
            index = 0;
            scripted = next;
        },
    };
}

const BOOK = {
    entries: {
        '0': {
            uid: 0,
            key: ['公主'],
            content: 'The princess Aurelia rules the realm from the ivory keep.',
            comment: 'The Princess',
        },
        '1': {
            uid: 1,
            key: ['knight'],
            content: 'Ser Bram, a knight sworn to the ivory keep.',
            comment: 'Ser Bram',
        },
        '2': { uid: 2, key: [], content: '', comment: 'Empty entry' },
    },
};

let root: string;
let stub: Stub;

beforeAll(async () => {
    root = await createProfileDataDir('catcup-alias-run-');
    stub = await stubProvider(['{"aliases":["王女","Aurelia"]}']);

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();

    const { ensureDataDirs, setActiveScope } = await import('../storage/paths.js');
    setActiveScope(fixturePath(root));
    await ensureDataDirs();

    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(fixturePath(root, 'worlds'), { recursive: true });
    await writeFile(fixturePath(root, 'worlds', 'eldoria.json'), `${JSON.stringify(BOOK, null, 2)}\n`, 'utf8');

    // One provider, active, pointed at the stub.
    const { writeJsonFile } = await import('../storage/jsonFile.js');
    const { paths } = await import('../storage/paths.js');
    await writeJsonFile(paths.providers, [
        {
            id: 'stub',
            name: 'Stub',
            kind: 'openai',
            baseUrl: stub.baseUrl,
            enabled: true,
            models: ['stub-model'],
            defaultModel: 'stub-model',
        },
    ]);
    await writeJsonFile(paths.settings, { activeProviderId: 'stub', profilePreferredModel: 'stub-model' });
}, 60_000);

afterAll(async () => {
    await stub.close();
    vi.unstubAllEnvs();
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
});

describe('planning a run', () => {
    it('plans one row per entry and skips an entry with nothing to read', async () => {
        const { planItems } = await import('../worldinfo/aliasRun.js');
        const items = planItems(
            [
                {
                    uid: 0,
                    comment: 'The Princess',
                    key: ['公主'],
                    content: 'text',
                    autoKeys: [],
                } as never,
                { uid: 2, comment: 'Empty entry', key: [], content: '', autoKeys: [] } as never,
            ],
            {},
            { includeExisting: true },
        );

        expect(items.map((item) => [item.uid, item.state])).toEqual([
            [0, 'pending'],
            [2, 'skipped'],
        ]);
        expect(items[0]?.label).toBe('The Princess');
    });

    it('falls back to the first key, then the uid, for a row label', async () => {
        const { labelOf } = await import('../worldinfo/aliasRun.js');
        expect(labelOf({ uid: 7, comment: '  ', key: ['猫'] } as never)).toBe('猫');
        expect(labelOf({ uid: 7, comment: '', key: [] } as never)).toBe('Entry 7');
    });

    it('narrows to the uids a person asked for', async () => {
        const { planItems } = await import('../worldinfo/aliasRun.js');
        const items = planItems(
            [
                { uid: 0, comment: 'a', key: ['a'], content: 'text', autoKeys: [] } as never,
                { uid: 1, comment: 'b', key: ['b'], content: 'text', autoKeys: [] } as never,
            ],
            {},
            { uids: [1], includeExisting: true },
        );

        expect(items.map((item) => item.uid)).toEqual([1]);
    });
});

describe('cleaning a model reply', () => {
    it('drops a repeat of a key or an existing alias, case-insensitively', async () => {
        const { cleanAliases } = await import('../worldinfo/aliasRequest.js');
        expect(cleanAliases(['公主', '王女', 'AURELIA', 'aurelia'], ['公主'], ['Aurelia'], 100, 12)).toEqual(['王女']);
    });

    it('drops a phrase too long to ever match, and caps the list', async () => {
        const { cleanAliases } = await import('../worldinfo/aliasRequest.js');
        const long = 'x'.repeat(MAX_ALIAS_LENGTH + 1);
        const many = Array.from({ length: 40 }, (_value, index) => `name ${index}`);

        const kept = cleanAliases([long, ...many], [], [], MAX_ALIAS_LENGTH, 12);
        expect(kept).not.toContain(long);
        expect(kept).toHaveLength(12);
    });

    it('collapses whitespace and ignores non-strings', async () => {
        const { cleanAliases } = await import('../worldinfo/aliasRequest.js');
        expect(cleanAliases(['  the   Princess ', 42 as never], [], [], 100, 12)).toEqual(['the Princess']);
    });
});

describe('a run against a stub provider', () => {
    it('fills a proposal for every readable row and writes the record', async () => {
        const { startAliasRun } = await import('../worldinfo/aliasRun.js');
        stub.setReplies(['{"aliases":["王女","Aurelia","the Princess"]}']);

        // Wait for the terminal event, the same signal a client follows. The
        // in-memory status flips before the record is written, so polling it
        // would read a file that still says `running`.
        const finished = deferred<AliasRun>();
        const state = await startAliasRun(
            'eldoria',
            { includeExisting: true },
            { onEvent: (event) => event.type === 'done' && finished.resolve(event.run) },
        );
        const final = await finished.promise;

        expect(final.status).toBe('done');
        expect(state.run.status).toBe('done');
        expect(state.run.items.map((item) => item.state)).toEqual(['done', 'done', 'skipped']);
        // Every offered name survives: none repeats the entry's own key, and
        // "the Princess" is the comment rather than a key, so it is a real gap.
        expect(state.run.items[0]?.proposed).toEqual(['王女', 'Aurelia', 'the Princess']);
        expect(state.run.items[2]?.state).toBe('skipped');

        const { readAliasRun } = await import('../storage/aliasRuns.js');
        const stored = await readAliasRun(state.run.id);
        expect(stored?.status).toBe('done');
        expect(stored?.items).toHaveLength(3);
    }, 30_000);

    it('records an unusable reply as an incomplete row without failing the run', async () => {
        const { startAliasRun } = await import('../worldinfo/aliasRun.js');
        stub.setReplies(['I could not think of anything.']);

        const finished = deferred<AliasRun>();
        await startAliasRun(
            'eldoria',
            { includeExisting: true },
            { onEvent: (event) => event.type === 'done' && finished.resolve(event.run) },
        );
        const final = await finished.promise;

        expect(final.status).toBe('done');
        expect(final.items.filter((item) => item.state === 'incomplete')).toHaveLength(2);
        expect(final.message).toMatch(/could not be read/);
    }, 30_000);

    it('refuses to start with no provider at all', async () => {
        const { writeJsonFile } = await import('../storage/jsonFile.js');
        const { paths } = await import('../storage/paths.js');
        const { clearSettingsCache } = await import('../storage/settings.js');

        await writeJsonFile(paths.providers, []);
        await writeJsonFile(paths.settings, { activeProviderId: null });
        clearSettingsCache();

        const { startAliasRun } = await import('../worldinfo/aliasRun.js');
        await expect(startAliasRun('eldoria', { includeExisting: true })).rejects.toThrow(/provider/i);

        await writeJsonFile(paths.providers, [
            {
                id: 'stub',
                name: 'Stub',
                kind: 'openai',
                baseUrl: stub.baseUrl,
                enabled: true,
                models: ['stub-model'],
                defaultModel: 'stub-model',
            },
        ]);
        await writeJsonFile(paths.settings, { activeProviderId: 'stub', profilePreferredModel: 'stub-model' });
        clearSettingsCache();
    }, 30_000);
});

describe('resuming a run', () => {
    it('keeps a proposal whose entry has not changed and replans the one that did', async () => {
        const { replanned } = await import('../worldinfo/aliasRun.js');
        const { getStringHash } = await import('@catcup/compat-st');

        const same = 'the same content';
        const rows = [
            {
                uid: 0,
                label: 'same',
                state: 'done' as const,
                existing: [],
                proposed: ['one'],
                contentHash: String(getStringHash(same)),
            },
            {
                uid: 1,
                label: 'changed',
                state: 'done' as const,
                existing: [],
                proposed: ['two'],
                contentHash: String(getStringHash('the old content')),
            },
        ];

        const entries = [
            { uid: 0, content: same, key: [], comment: 'same' },
            { uid: 1, content: 'the new content', key: [], comment: 'changed' },
        ];

        const planned = replanned(rows, entries as never, {});

        expect(planned[0]?.state).toBe('done');
        expect(planned[0]?.proposed).toEqual(['one']);
        expect(planned[1]?.state).toBe('pending');
    });

    it('leaves a skipped row skipped when its entry is still blank', async () => {
        const { replanned } = await import('../worldinfo/aliasRun.js');
        // Skipping is a decision the plan made, not a failure: re-asking an
        // empty entry would spend a request on the model reading nothing.
        const planned = replanned(
            [{ uid: 2, label: 'Blank', state: 'skipped' as const, existing: [] }],
            [{ uid: 2, content: '', key: [], comment: 'Blank' }] as never,
            {},
        );

        expect(planned[0]?.state).toBe('skipped');
    });

    it('re-plans a skipped row whose entry was written since', async () => {
        const { replanned } = await import('../worldinfo/aliasRun.js');
        const planned = replanned(
            [{ uid: 2, label: 'Blank', state: 'skipped' as const, existing: [] }],
            [{ uid: 2, content: 'Now it says something.', key: ['x'], comment: 'Blank' }] as never,
            {},
        );

        expect(planned[0]?.state).toBe('pending');
    });

    it('skips a row whose entry was deleted while the run was stopped', async () => {
        const { replanned } = await import('../worldinfo/aliasRun.js');
        const planned = replanned(
            [{ uid: 9, label: 'gone', state: 'done' as const, existing: [], proposed: ['x'] }],
            [],
            {},
        );

        expect(planned[0]?.state).toBe('skipped');
        expect(planned[0]?.message).toMatch(/no longer in the book/);
    });

    it('picks up an alias a person added while the run was stopped', async () => {
        const { replanned } = await import('../worldinfo/aliasRun.js');
        const planned = replanned(
            [{ uid: 0, label: 'a', state: 'pending' as const, existing: [] }],
            [{ uid: 0, content: 'text', key: [], comment: 'a' }] as never,
            { '0': ['hand-typed'] },
        );

        expect(planned[0]?.existing).toEqual(['hand-typed']);
    });
});

describe('applying a run', () => {
    it('writes every row into the sidecar and leaves the book alone', async () => {
        const { applyWorldAliases } = await import('../storage/worlds.js');
        const { readFile } = await import('node:fs/promises');

        const before = await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8');
        const result = await applyWorldAliases(
            'eldoria',
            [
                { uid: 0, aliases: ['王女', 'Aurelia'] },
                { uid: 1, aliases: ['Bram'] },
            ],
            new Map([[0, 'hash-of-entry-0']]),
        );

        expect(result).toEqual({ updated: 2, kept: 0 });

        const after = await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8');
        expect(after).toBe(before);
        expect(after).not.toContain('王女');

        const sidecar = JSON.parse(await readFile(fixturePath(root, 'worlds', 'eldoria.aliases.json'), 'utf8'));
        expect(sidecar.entries['0']).toEqual({
            aliases: ['王女', 'Aurelia'],
            generatedFrom: 'hash-of-entry-0',
            // The timestamp is stamped by the writer; assert the shape only.
            generatedAt: expect.any(Number),
        });
        // No provenance for a row the run did not generate.
        expect(sidecar.entries['1']).toEqual({ aliases: ['Bram'] });
    });

    it('skips a row whose entry is gone rather than failing the batch', async () => {
        const { applyWorldAliases } = await import('../storage/worlds.js');
        const result = await applyWorldAliases('eldoria', [
            { uid: 0, aliases: ['王女'] },
            { uid: 999, aliases: ['ghost'] },
        ]);

        expect(result).toEqual({ updated: 1, kept: 1 });
    });

    it('records the model a row was generated with, and shows it in the view', async () => {
        const { applyWorldAliases, readWorldAliases } = await import('../storage/worlds.js');
        await applyWorldAliases(
            'eldoria',
            [{ uid: 0, aliases: ['王女'] }],
            new Map([[0, 'hash-of-entry-0']]),
            'cheap-model-7b',
        );

        const view = await readWorldAliases('eldoria');
        expect(view.generated['0']?.model).toBe('cheap-model-7b');
        expect(view.generated['0']?.from).toBe('hash-of-entry-0');
    });

    it('leaves the model out of a hand-entered set', async () => {
        const { applyWorldAliases, readWorldAliases } = await import('../storage/worlds.js');
        // No provenance map, so this is a hand edit rather than a generation —
        // a model name on it would claim the row came from somewhere it did not.
        await applyWorldAliases('eldoria', [{ uid: 1, aliases: ['Bram'] }], new Map(), 'cheap-model-7b');

        const view = await readWorldAliases('eldoria');
        expect(view.generated['1']).toBeUndefined();
        expect(view.aliases['1']).toEqual(['Bram']);
    });

    it('reports a stale set once the entry content moves past it', async () => {
        const { readWorldAliases, writeWorldAliases } = await import('../storage/worlds.js');
        const { getStringHash } = await import('@catcup/compat-st');
        const { readEntriesForEditor } = await import('../worldinfo/entries.js');
        const { writeJsonFile, readJsonFile } = await import('../storage/jsonFile.js');
        const raw = await readJsonFile<Record<string, unknown>>(fixturePath(root, 'worlds', 'eldoria.json'), {});
        const entry = readEntriesForEditor(raw)[0];
        expect(entry).toBeDefined();
        const current = String(getStringHash(entry?.content ?? ''));

        // A generated set against the content as it is now is not stale.
        await writeWorldAliases('eldoria', 0, ['王女']);
        const { setGeneratedAliases } = await import('../worldinfo/aliases.js');
        await setGeneratedAliases(fixturePath(root, 'worlds', 'eldoria.json'), 'eldoria', 0, ['王女'], current);
        expect((await readWorldAliases('eldoria')).stale).toEqual([]);

        // Move the content and it is.
        const book = await readJsonFile<Record<string, unknown>>(fixturePath(root, 'worlds', 'eldoria.json'), {});
        const container = book.entries as Record<string, Record<string, unknown>>;
        const first = Object.values(container)[0];
        if (first) {
            first.content = 'Rewritten entirely, with no princess in it.';
        }
        await writeJsonFile(fixturePath(root, 'worlds', 'eldoria.json'), book);

        expect((await readWorldAliases('eldoria')).stale).toEqual([0]);
    });
});
