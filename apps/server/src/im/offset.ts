import { isRecord } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from '../storage/jsonFile.js';
import { paths, resolveInside } from '../storage/paths.js';

/**
 * Where the poll loop had got to.
 *
 * Telegram keeps an update until a `getUpdates` call acknowledges it — for
 * roughly 24 hours — and an unacknowledged update is delivered again on the next
 * poll. With the offset held only in memory, every restart re-delivers
 * everything that arrived since the last acknowledged one: a bot restarted twice
 * in an afternoon answers the same message twice, for real, to the person who
 * sent it.
 *
 * Two approaches are common and this file takes the second. The bot libraries
 * that do not persist the offset either accept the replay or drop the backlog on
 * start (`drop_pending_updates`), and both lose something: the first duplicates,
 * the second discards messages that arrived while the app was legitimately
 * shutting down. Storing the offset costs one small file and loses neither.
 *
 * What it does **not** claim is exactly-once delivery. The offset is written
 * after a batch is handled, so a crash between handling and writing returns that
 * batch on the next start. At-least-once is what the platform offers; this
 * shrinks the window from "every restart" to "a crash in the middle of a
 * message".
 *
 * A sidecar beside the profile, next to `im-telegram.json`, because it belongs
 * to the binding rather than to anything the story carries.
 */

interface OffsetFile {
    version: 1;
    /** Transport kind, so a second platform's offset cannot collide. */
    transport: string;
    /** The next `update_id` to ask for. */
    offset: number;
}

function offsetPath(transport: string): string {
    return resolveInside(paths.root, `im-${transport}-offset.json`);
}

/**
 * Read a stored offset, or `0`.
 *
 * A corrupt or missing file reads as `0`, which asks Telegram for everything it
 * still holds. That is the same behaviour as no persistence at all, which is a
 * recoverable worst case: a duplicate reply is annoying, and refusing to start
 * because a sidecar could not be parsed is worse.
 */
export async function readOffset(transport = 'telegram'): Promise<number> {
    let raw: unknown = null;
    try {
        raw = await readJsonFile<unknown>(offsetPath(transport), null);
    } catch {
        // `readJsonFile` rethrows a parse error on purpose — most of its callers
        // want to know that a file is corrupt. Here a lost offset is the cheaper
        // failure by far, so it is caught rather than propagated.
        return 0;
    }
    if (!isRecord(raw) || typeof raw.offset !== 'number' || !Number.isFinite(raw.offset)) {
        return 0;
    }
    return Math.max(0, Math.floor(raw.offset));
}

/** Store how far the loop has got. Never throws: a lost offset is not worth a failed poll. */
export async function writeOffset(offset: number, transport = 'telegram'): Promise<void> {
    try {
        await writeJsonFile(offsetPath(transport), {
            version: 1,
            transport,
            offset: Math.max(0, Math.floor(offset)),
        } satisfies OffsetFile);
    } catch (error) {
        // Logged rather than propagated: the poll loop is the reason the bot
        // exists, and it must not die because a sidecar could not be written.
        console.warn('[im] Could not save the poll offset:', error);
    }
}

/** Where the offset file lives, for a test or a diagnostic. */
export function offsetFileFor(transport = 'telegram'): string {
    return offsetPath(transport);
}
