/**
 * Refuse a source file that contains a NUL byte.
 *
 * This exists because it happened twice in one afternoon. A patch that meant to
 * write `'\0'` inside a string literal wrote a literal control character
 * instead, and the same edit lost a backslash from a regex. The code still
 * typechecked and its tests still passed — what flagged it was `git diff`
 * calling the file binary, which is a poor way to find out.
 *
 * A NUL in a source file is never intentional here: nothing in this codebase
 * parses binary fixtures from `.ts`, and the two places that must talk about
 * control characters (`isValidSkinId`, and the test that pins it) compare code
 * points instead of writing one.
 *
 * Run through `pnpm lint:nul`, which CI calls beside `biome check`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCANNED = ['apps', 'packages', 'scripts', 'docs', '.github'];
const EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.mjs',
    '.cjs',
    '.css',
    '.json',
    '.md',
    '.yml',
    '.yaml',
    '.rs',
    '.toml',
]);
const SKIP = new Set(['node_modules', 'dist', 'target', '.git', '.ref', 'data', 'coverage']);

/** Every file under `directory`, skipping the folders that are not source. */
function* walk(directory) {
    for (const name of readdirSync(directory)) {
        if (SKIP.has(name)) {
            continue;
        }
        const full = path.join(directory, name);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            yield* walk(full);
        } else if (EXTENSIONS.has(path.extname(name))) {
            yield full;
        }
    }
}

const offenders = [];
for (const target of SCANNED) {
    const start = path.join(ROOT, target);
    let exists = true;
    try {
        statSync(start);
    } catch {
        exists = false;
    }
    if (!exists) {
        continue;
    }
    for (const file of walk(start)) {
        const bytes = readFileSync(file);
        if (!bytes.includes(0)) {
            continue;
        }
        // Report the line, so the fix does not need the file opened in a tool
        // that shows control characters.
        const before = bytes.subarray(0, bytes.indexOf(0)).toString('utf8');
        offenders.push(`${path.relative(ROOT, file)}:${before.split('\n').length}`);
    }
}

if (offenders.length > 0) {
    console.error('A NUL byte in a source file is always a mistake, and usually a lost escape:');
    for (const offender of offenders) {
        console.error(`  ${offender}`);
    }
    console.error('Compare code points, or build the character with String.fromCharCode(0).');
    process.exit(1);
}
