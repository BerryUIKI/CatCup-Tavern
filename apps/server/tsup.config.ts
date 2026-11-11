import { defineConfig } from 'tsup';

/**
 * Set `CATCUP_BUNDLE_DEPS=1` to inline every dependency.
 *
 * The desktop build ships one file next to the bundled Node runtime, so there
 * is no `node_modules` to install beside it. The normal web build leaves
 * dependencies external and resolves them from the workspace.
 */
const bundleDependencies = process.env.CATCUP_BUNDLE_DEPS === '1';

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
    noExternal: bundleDependencies ? [/.*/] : ['@catcup/shared'],
    /**
     * Dependencies are CommonJS and call `require` internally. In an ESM bundle
     * esbuild turns those into a dynamic require that throws, so the bundle
     * needs a real `require` in scope.
     */
    banner: bundleDependencies
        ? {
              js: "import { createRequire as __catcupCreateRequire } from 'node:module'; const require = __catcupCreateRequire(import.meta.url);",
          }
        : undefined,
});
