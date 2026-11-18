import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { AliasRun } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { paths, resolveInside } from './paths.js';

/**
 * Alias run records on disk.
 *
 * Written after every row rather than once at the end, for the same reason a
 * distill record is: a reattach after a tab close reads real progress, and a
 * crash mid-run leaves a record that says how far it got.
 *
 * Unlike a distill record, this one *is* resumed from — `startAliasRun` takes a
 * stored run back and plans only the rows that still need work. That is why the
 * per-entry state is the file's substance and the summary is not.
 */

function runFile(id: string): string {
    return resolveInside(paths.aliasRuns, `${id}.json`);
}

/** Write or replace a run record. */
export async function saveAliasRun(run: AliasRun): Promise<void> {
    await writeJsonFile(runFile(run.id), run);
}

/** One run record, or `null` when it is gone. */
export async function readAliasRun(id: string): Promise<AliasRun | null> {
    return readJsonFile<AliasRun | null>(runFile(id), null);
}

/** Every run record this profile holds, newest first. */
export async function listAliasRuns(): Promise<AliasRun[]> {
    const names = (await readdir(paths.aliasRuns).catch(() => [] as string[])).filter((name) => name.endsWith('.json'));

    const runs = await Promise.all(
        names.map((name) => readJsonFile<AliasRun | null>(path.join(paths.aliasRuns, name), null)),
    );

    return runs.filter((run): run is AliasRun => run !== null).sort((a, b) => b.startedAt - a.startedAt);
}

/** Delete a run record. Returns false when it did not exist. */
export async function deleteAliasRun(id: string): Promise<boolean> {
    const run = await readAliasRun(id);
    if (!run) {
        return false;
    }
    await rm(runFile(id), { force: true });
    return true;
}
