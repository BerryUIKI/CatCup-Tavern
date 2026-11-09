import { randomBytes, type ScryptOptions, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
    password: string | Buffer,
    salt: string | Buffer,
    keylen: number,
    options: ScryptOptions,
) => Promise<Buffer>;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
    return [
        'scrypt',
        SCRYPT_PARAMS.N,
        SCRYPT_PARAMS.r,
        SCRYPT_PARAMS.p,
        salt.toString('base64url'),
        hash.toString('base64url'),
    ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') {
        return false;
    }

    const n = Number.parseInt(parts[1] ?? '', 10);
    const r = Number.parseInt(parts[2] ?? '', 10);
    const p = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
        return false;
    }

    let salt: Buffer;
    let expected: Buffer;
    try {
        salt = Buffer.from(parts[4] ?? '', 'base64url');
        expected = Buffer.from(parts[5] ?? '', 'base64url');
    } catch {
        return false;
    }
    if (salt.length === 0 || expected.length === 0) {
        return false;
    }

    const actual = await scrypt(password, salt, expected.length, { N: n, r, p });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}
