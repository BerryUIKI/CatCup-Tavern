import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { forbidden, HttpError } from '../http/errors.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../security/password.js';
import {
    createSessionToken,
    SESSION_COOKIE,
    SESSION_MAX_AGE_SECONDS,
    verifySessionToken,
} from '../security/session.js';
import { checkPassword, createAuthFile, deleteAuthFile, getAuthFile, setPassword } from '../storage/auth.js';

const setupSchema = z.object({
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

const loginSchema = z.object({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/**
 * An empty `password` removes the password and returns to open mode, which is
 * only reachable in desktop mode. `currentPassword` is required to change or
 * remove an existing one.
 */
const passwordSchema = z.object({
    password: z.union([z.literal(''), z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)]),
    currentPassword: z.string().max(PASSWORD_MAX_LENGTH).optional(),
});

function isLoopback(ip: string): boolean {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Whether this install runs without a password.
 *
 * Only the desktop shape can be open, and only while no password is stored:
 * the shell binds loopback and the user is already authenticated by the OS
 * session. Web and LAN keep the password model, and setting a password in the
 * desktop app turns the login screen back on.
 */
export async function isOpenSession(): Promise<boolean> {
    if (!config.desktop) {
        return false;
    }
    return (await getAuthFile()) === null;
}

function setSessionCookie(reply: FastifyReply, secret: string): void {
    reply.setCookie(SESSION_COOKIE, createSessionToken(secret), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: SESSION_MAX_AGE_SECONDS,
        secure: reply.request.protocol === 'https',
    });
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (await isOpenSession()) {
        return;
    }

    const auth = await getAuthFile();
    if (!auth) {
        reply.code(401).send({ error: 'Setup required', code: 'NEEDS_SETUP' });
        return;
    }

    const token = request.cookies[SESSION_COOKIE];
    if (!token || !verifySessionToken(token, auth.sessionSecret)) {
        reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/auth/status', async (request) => {
        const auth = await getAuthFile();
        const open = await isOpenSession();
        const token = request.cookies[SESSION_COOKIE];
        return {
            needsSetup: !auth && !config.desktop,
            authenticated: open || (auth ? Boolean(token && verifySessionToken(token, auth.sessionSecret)) : false),
            openSession: open,
        };
    });

    app.post(
        '/api/auth/setup',
        { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const auth = await getAuthFile();
            if (auth) {
                throw new HttpError(409, 'Already initialized', 'ALREADY_INITIALIZED');
            }
            if (!isLoopback(request.ip) && !config.allowRemoteSetup) {
                throw forbidden('The first password must be set on the machine running the server');
            }

            const body = setupSchema.parse(request.body ?? {});
            const created = await createAuthFile(body.password);
            setSessionCookie(reply, created.sessionSecret);
            return { ok: true };
        },
    );

    app.post(
        '/api/auth/login',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            const auth = await getAuthFile();
            if (!auth) {
                throw new HttpError(409, 'Setup required', 'NEEDS_SETUP');
            }

            const body = loginSchema.parse(request.body ?? {});
            const valid = await checkPassword(body.password);
            if (!valid) {
                throw new HttpError(401, 'Incorrect password', 'INVALID_PASSWORD');
            }

            setSessionCookie(reply, auth.sessionSecret);
            return { ok: true };
        },
    );

    app.post('/api/auth/logout', async (_request, reply) => {
        reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return { ok: true };
    });

    /**
     * Setting or removing the password from the desktop app.
     *
     * Web and LAN installs already have a password screen, so this route only
     * exists in desktop mode. Without a password the desktop opens directly;
     * `POST` with an empty string removes it again and returns to open mode.
     */
    app.put(
        '/api/auth/password',
        { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
        async (request, reply) => {
            if (!config.desktop) {
                throw forbidden('The password can only be changed from the desktop app');
            }

            const body = passwordSchema.parse(request.body ?? {});
            const auth = await getAuthFile();
            if (auth && !(await checkPassword(body.currentPassword ?? ''))) {
                throw new HttpError(401, 'Incorrect password', 'INVALID_PASSWORD');
            }

            if (body.password === '') {
                await deleteAuthFile();
                reply.clearCookie(SESSION_COOKIE, { path: '/' });
                return { ok: true, openSession: true };
            }

            const saved = await setPassword(body.password);
            setSessionCookie(reply, saved.sessionSecret);
            return { ok: true, openSession: false };
        },
    );
}
