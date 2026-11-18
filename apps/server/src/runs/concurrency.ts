/**
 * Run asynchronous tasks with a fixed pool, preserving result order.
 *
 * Two engines need this: book distillation fans out over entities and alias
 * generation fans out over entries. Both need the same two guarantees — no more
 * than N requests in flight, and results in the order they were asked for — and
 * neither needs a dependency for it.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            const item = items[index];
            if (item !== undefined) {
                results[index] = await task(item, index);
            }
        }
    });

    await Promise.all(workers);
    return results;
}
