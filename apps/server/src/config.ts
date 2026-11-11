import path from 'node:path';

import dotenv from 'dotenv';

/**
 * Repository root. Works from both `apps/server/src` (dev) and
 * `apps/server/dist` (build), because both are three levels below the root.
 */
export const repoRoot = path.resolve(import.meta.dirname, '../../..');

// Root .env first, then a package-local .env for overrides. dotenv does not
// overwrite variables that are already present.
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

function parsePort(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '', 10);
    // 0 asks the OS for a free port; the desktop shell relies on it and reads
    // the real port from the `CATCUP_READY` line.
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
        return 8000;
    }
    return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined) {
        return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

const dataDirValue = process.env.CATCUP_DATA_DIR?.trim();

export const config = {
    repoRoot,
    version: '0.1.0',
    host: process.env.CATCUP_HOST?.trim() || '127.0.0.1',
    port: parsePort(process.env.CATCUP_PORT),
    /**
     * Relative CATCUP_DATA_DIR values resolve from the process cwd. The default
     * is the repository-level ./data directory.
     */
    dataDir: dataDirValue ? path.resolve(process.cwd(), dataDirValue) : path.join(repoRoot, 'data'),
    logLevel: process.env.CATCUP_LOG_LEVEL?.trim() || 'info',
    allowRemoteSetup: parseBoolean(process.env.CATCUP_ALLOW_REMOTE_SETUP, false),
    isProduction: process.env.NODE_ENV === 'production',
} as const;

export type AppConfig = typeof config;
