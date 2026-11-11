import { randomBytes } from 'node:crypto';

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

export async function checkPassword(password: string): Promise<boolean> {
    const auth = await getAuthFile();
    if (!auth) {
        return false;
    }
    return verifyPassword(password, auth.passwordHash);
}
