import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { hashPassword, verifyPassword } from '../security/password.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { paths } from './paths.js';

export interface AuthFile {
    version: 1;
    passwordHash: string;
    sessionSecret: string;
    createdAt: string;
}

let cache: AuthFile | null | undefined;

export async function getAuthFile(): Promise<AuthFile | null> {
    if (cache !== undefined) {
        return cache;
    }
    const stored = await readJsonFile<AuthFile | null>(paths.auth, null);
    cache = stored && stored.version === 1 && stored.passwordHash && stored.sessionSecret ? stored : null;
    return cache;
}

export async function createAuthFile(password: string): Promise<AuthFile> {
    const auth: AuthFile = {
        version: 1,
        passwordHash: await hashPassword(password),
        sessionSecret: randomBytes(32).toString('base64url'),
        createdAt: new Date().toISOString(),
    };
    await writeJsonFile(paths.auth, auth);
    cache = auth;
    return auth;
}

/**
 * Set or replace the password.
 *
 * An existing file keeps its session secret, so other signed-in devices stay
 * signed in when the password changes. The desktop app is single-user on one
 * machine, and rotating the secret would sign its own webview out for no gain.
 */
export async function setPassword(password: string): Promise<AuthFile> {
    const existing = await getAuthFile();
    const auth: AuthFile = {
        version: 1,
        passwordHash: await hashPassword(password),
        sessionSecret: existing?.sessionSecret ?? randomBytes(32).toString('base64url'),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await writeJsonFile(paths.auth, auth);
    cache = auth;
    return auth;
}

export async function deleteAuthFile(): Promise<void> {
    await rm(paths.auth, { force: true });
    cache = null;
}

/** Drop the in-process cache. Tests reload the module; nothing else needs this. */
export function resetAuthCache(): void {
    cache = undefined;
}

export async function checkPassword(password: string): Promise<boolean> {
    const auth = await getAuthFile();
    if (!auth) {
        return false;
    }
    return verifyPassword(password, auth.passwordHash);
}
