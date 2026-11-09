/**
 * Minimal per-key async mutex.
 *
 * The app is single-user, but a generation, a message edit and a settings save
 * can still race on the same file. Calls with the same key run sequentially.
 */
const queues = new Map<string, Promise<unknown>>();

export function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    queues.set(
        key,
        next.then(
            () => undefined,
            () => undefined,
        ),
    );
    return next;
}
