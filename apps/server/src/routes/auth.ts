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
import { checkPassword, createAuthFile, getAuthFile } from '../storage/auth.js';

const setupSchema = z.object({
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});

const loginSchema = z.object({
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

function isLoopback(ip: string): boolean {
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
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
        const token = request.cookies[SESSION_COOKIE];
        return {
            needsSetup: !auth,
            authenticated: auth ? Boolean(token && verifySessionToken(token, auth.sessionSecret)) : false,
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
}
