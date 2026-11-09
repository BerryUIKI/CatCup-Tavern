import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    platform: 'node',
    target: 'node24',
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    // @catcup/shared exports TypeScript source, so it must be bundled into the
    // server output instead of being resolved at runtime by Node.
    noExternal: ['@catcup/shared'],
});
