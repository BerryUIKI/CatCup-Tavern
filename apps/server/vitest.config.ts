import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Every route test builds a Fastify app and loads the tokenizer. The
        // default worker count (one per file) starves a 6-core machine and
        // trips hook timeouts, so keep the pool deliberately small.
        maxWorkers: 4,
        hookTimeout: 30_000,
    },
});
