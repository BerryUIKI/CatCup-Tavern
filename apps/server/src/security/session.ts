import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'catcup_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_MAX_AGE_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

interface SessionPayload {
    v: 1;
    exp: number;
}

function sign(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(secret: string, now = Date.now()): string {
    const payload: SessionPayload = { v: 1, exp: now + SESSION_TTL_MS };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): boolean {
    const parts = token.split('.');
    if (parts.length !== 2) {
        return false;
    }
    const [encoded, signature] = parts;
    if (!encoded || !signature) {
        return false;
    }

    const expectedSignature = sign(encoded, secret);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
        return false;
    }

    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
        return payload.v === 1 && typeof payload.exp === 'number' && payload.exp > now;
    } catch {
        return false;
    }
}
