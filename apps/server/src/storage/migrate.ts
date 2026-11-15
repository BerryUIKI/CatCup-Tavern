import { appendFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { PROFILE_INDEX_VERSION } from '@catcup/shared';

import { config } from '../config.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { paths, SCOPED_DIRECTORIES } from './paths.js';

/** The id the pre-profile tree becomes. */
export const DEFAULT_PROFILE_ID = 'default';

const LOG_FILE = 'migration.log';

export interface MigrationPlanEntry {
    /** Relative path inside the data folder. */
    from: string;
    /** Where it goes, relative to the profile folder. */
    to: string;
    kind: 'directory' | 'file';
    /** File count for a directory, `1` for a file, `0` when absent. */
    files: number;
    bytes: number;
}

export interface MigrationPlan {
    needed: boolean;
    /** Why nothing is needed, when `needed` is false. */
    reason?: string;
    root: string;
    profileDir: string;
    entries: MigrationPlanEntry[];
    totalBytes: number;
    /** Providers found in the old settings file, to be lifted into the shared list. */
    providerCount: number;
}

async function measure(target: string): Promise<{ files: number; bytes: number; exists: boolean }> {
    const info = await stat(target).catch(() => null);
    if (!info) {
        return { files: 0, bytes: 0, exists: false };
    }
    if (!info.isDirectory()) {
        return { files: 1, bytes: info.size, exists: true };
    }
    let files = 0;
    let bytes = 0;
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const nested = await measure(path.join(target, entry.name));
        files += entry.isDirectory() ? nested.files : 1;
        bytes += nested.bytes;
    }
    return { files, bytes, exists: true };
}

/**
 * Work out what a migration would do, without doing it.
 *
 * This is what `CATCUP_MIGRATE_DRY_RUN=1` prints, and it is the same function
 * the real run executes, so the plan a person reads is the plan that happens.
 */
export async function planMigration(): Promise<MigrationPlan> {
    const root = config.dataDir;
    const profileDir = path.join(root, 'profiles', DEFAULT_PROFILE_ID);
    const empty: MigrationPlan = {
        needed: false,
        root,
        profileDir,
        entries: [],
        totalBytes: 0,
        providerCount: 0,
    };

    // A tree that already has a profile folder has been migrated (or was
    // created in the new shape) and is left alone.
    if (await measure(path.join(root, 'profiles')).then((info) => info.exists)) {
        return { ...empty, reason: 'profiles folder already exists' };
    }

    const entries: MigrationPlanEntry[] = [];
    for (const folder of SCOPED_DIRECTORIES) {
        const measured = await measure(path.join(root, folder));
        if (measured.exists && measured.files > 0) {
            entries.push({
                from: folder,
                to: folder,
                kind: 'directory',
                files: measured.files,
                bytes: measured.bytes,
            });
        }
    }
    const regex = await measure(paths.regex);
    if (regex.exists) {
        entries.push({ from: 'regex.json', to: 'regex.json', kind: 'file', files: 1, bytes: regex.bytes });
    }

    const settingsRaw = await readJsonFile<unknown>(path.join(root, 'settings.json'), null);
    const providerCount =
        settingsRaw &&
        typeof settingsRaw === 'object' &&
        Array.isArray((settingsRaw as { providers?: unknown[] }).providers)
            ? (settingsRaw as { providers: unknown[] }).providers.length
            : 0;

    const anyContent = entries.length > 0 || providerCount > 0;
    const settingsExists = await measure(path.join(root, 'settings.json')).then((info) => info.exists);
    if (!anyContent && !settingsExists) {
        return { ...empty, reason: 'nothing to migrate' };
    }

    return {
        needed: true,
        root,
        profileDir,
        entries,
        totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
        providerCount,
    };
}

/** Format the plan for the console and for `migration.log`. */
export function describePlan(plan: MigrationPlan): string[] {
    const lines = [`Data folder: ${plan.root}`, `Profile:      ${plan.profileDir}`];
    for (const entry of plan.entries) {
        lines.push(`  move ${entry.from} -> ${entry.to}  (${entry.files} file(s), ${entry.bytes} bytes)`);
    }
    if (plan.providerCount > 0) {
        lines.push(`  lift ${plan.providerCount} provider(s) into providers.json`);
    }
    lines.push(`Total to move: ${plan.totalBytes} bytes`);
    return lines;
}

async function log(line: string): Promise<void> {
    try {
        await appendFile(path.join(config.dataDir, LOG_FILE), `${new Date().toISOString()} ${line}\n`, 'utf8');
    } catch {
        // A data folder that cannot be written to is reported by the migration
        // itself; failing here would only replace one error with another.
    }
}

/**
 * Move a pre-profile data folder into the new shape.
 *
 * Steps are renames within one volume, so nothing is copied. The index is the
 * last write: until it lands, the server still sees the old shape. Any failure
 * before that point moves everything back and rethrows, so a failed migration
 * leaves the tree exactly as it was.
 */
export async function migrateDataFolder(): Promise<MigrationPlan> {
    const plan = await planMigration();
    if (!plan.needed) {
        return plan;
    }

    const moved: Array<{ from: string; to: string }> = [];
    await mkdir(plan.profileDir, { recursive: true });
    await log(`migration start: ${plan.entries.length} item(s), ${plan.totalBytes} bytes`);

    try {
        for (const entry of plan.entries) {
            const from = path.join(plan.root, entry.from);
            const to = path.join(plan.profileDir, entry.to);
            // A rename cannot create parents, and `user/images` needs two.
            await mkdir(path.dirname(to), { recursive: true });
            await rename(from, to);
            moved.push({ from, to });
            await log(`moved ${entry.from}`);
        }

        // Providers become machine-wide; the profile keeps only the choice.
        const settingsPath = path.join(plan.root, 'settings.json');
        const settingsRaw = await readJsonFile<Record<string, unknown> | null>(settingsPath, null);
        if (settingsRaw && Array.isArray(settingsRaw.providers)) {
            await writeJsonFile(paths.providers, settingsRaw.providers);
            const profileSettings = { ...settingsRaw };
            delete profileSettings.providers;
            await writeJsonFile(path.join(plan.profileDir, 'settings.json'), profileSettings);
            await rename(settingsPath, `${settingsPath}.v1-backup`);
            await log(`lifted ${settingsRaw.providers.length} provider(s) into providers.json`);
        }

        // The index is the point of no return, and it is one atomic write.
        // It keeps the `default` id so a person who knows where things were
        // can still find them, and so the migration is repeatable on a copy.
        await writeJsonFile(paths.globalSettings, {
            version: PROFILE_INDEX_VERSION,
            activeProfileId: DEFAULT_PROFILE_ID,
            profiles: [{ id: DEFAULT_PROFILE_ID, name: 'Default', description: '' }],
        });
        await log('wrote profile index');
    } catch (error) {
        await log(`migration failed: ${error instanceof Error ? error.message : String(error)}`);
        for (const entry of moved.reverse()) {
            await rename(entry.to, entry.from).catch(() => {});
        }
        throw error;
    }

    await log('migration complete');
    return plan;
}
