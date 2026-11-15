import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { DistillRun } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { paths, resolveInside } from './paths.js';

/**
 * Run records on disk.
 *
 * A run is persisted after every chunk rather than once at the end: a reattach
 * after a tab close reads real progress, and a crash mid-run leaves a record
 * that says how far it got instead of nothing at all. The record is a
 * *record* — nothing resumes from it — so a corrupt or hand-edited file costs
 * the review sheet, not the book.
 */

function runFile(id: string): string {
    return resolveInside(paths.distill, `${id}.json`);
}

/** Write or replace a run record. */
export async function saveRun(run: DistillRun): Promise<void> {
    await writeJsonFile(runFile(run.id), run);
}

/** One run record, or `null` when it is gone. */
export async function readRun(id: string): Promise<DistillRun | null> {
    return readJsonFile<DistillRun | null>(runFile(id), null);
}

/** Every run record this profile holds, newest first. */
export async function listRuns(): Promise<DistillRun[]> {
    const names = (await readdir(paths.distill).catch(() => [] as string[])).filter((name) => name.endsWith('.json'));

    const runs = await Promise.all(
        names.map((name) => readJsonFile<DistillRun | null>(path.join(paths.distill, name), null)),
    );

    return runs.filter((run): run is DistillRun => run !== null).sort((a, b) => b.startedAt - a.startedAt);
}

/** Delete a run record. Returns false when it did not exist. */
export async function deleteRun(id: string): Promise<boolean> {
    const run = await readRun(id);
    if (!run) {
        return false;
    }
    await rm(runFile(id), { force: true });
    return true;
}
