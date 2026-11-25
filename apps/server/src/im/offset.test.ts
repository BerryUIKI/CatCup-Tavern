import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The poll offset sidecar.
 *
 * Its whole job is to stop a restart from re-answering what Telegram still
 * holds, so the tests are about the two ways it can fail: reading a value it
 * should not, and turning a lost file into a dead bot.
 */

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'catcup-im-offset-'));
    const { setActiveScope } = await import('../storage/paths.js');
    setActiveScope(dir);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

const load = async () => {
    const { readOffset, writeOffset, offsetFileFor } = await import('./offset.js');
    return { readOffset, writeOffset, offsetFileFor };
};

describe('the poll offset', () => {
    it('starts at zero when nothing was ever stored', async () => {
        const { readOffset } = await load();
        expect(await readOffset()).toBe(0);
    });

    it('reads back what it wrote', async () => {
        const { readOffset, writeOffset } = await load();
        await writeOffset(4321);
        expect(await readOffset()).toBe(4321);
    });

    it('treats a corrupt file as zero rather than failing', async () => {
        // A bot that will not start because a sidecar is unreadable is worse
        // than one that repeats a message, so this is the recoverable answer.
        const { readOffset, offsetFileFor } = await load();
        await writeFile(offsetFileFor(), 'not json at all', 'utf8');
        expect(await readOffset()).toBe(0);
    });

    it('rejects a value that is not a usable number', async () => {
        const { readOffset, offsetFileFor } = await load();

        for (const body of [{ offset: 'many' }, { offset: null }, { offset: Number.NaN }, { nope: 1 }]) {
            await writeFile(offsetFileFor(), JSON.stringify(body), 'utf8');
            expect(await readOffset()).toBe(0);
        }
    });

    it('never stores a negative or fractional offset', async () => {
        const { readOffset, writeOffset } = await load();

        await writeOffset(-5);
        expect(await readOffset()).toBe(0);

        await writeOffset(11.9);
        expect(await readOffset()).toBe(11);
    });

    it('keeps each transport in its own file', async () => {
        // A second platform must not inherit Telegram's position in its own
        // update stream — the numbers mean nothing across platforms.
        const { readOffset, writeOffset, offsetFileFor } = await load();
        await writeOffset(99);
        expect(offsetFileFor('telegram')).not.toBe(offsetFileFor('discord'));
        expect(await readOffset('discord')).toBe(0);
        expect(await readOffset('telegram')).toBe(99);
    });

    it('swallows a write failure instead of taking the bot down', async () => {
        const { writeOffset } = await load();
        // An unwritable directory: the scope points at a path that is a file.
        const { setActiveScope } = await import('../storage/paths.js');
        setActiveScope(path.join(dir, 'not-a-directory'));
        await writeFile(path.join(dir, 'not-a-directory'), 'x', 'utf8');
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(writeOffset(7)).resolves.toBeUndefined();
    });
});
