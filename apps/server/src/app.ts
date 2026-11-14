import { existsSync } from 'node:fs';
import path from 'node:path';

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import { config } from './config.js';
import { HttpError } from './http/errors.js';
import { registerAuthRoutes, requireAuth } from './routes/auth.js';
import { registerCharacterRoutes } from './routes/characters.js';
import { registerChatRoutes } from './routes/chats.js';
import { registerContextRoutes } from './routes/context.js';
import { registerDistillRoutes } from './routes/distill.js';
import { registerGenerateRoutes } from './routes/generate.js';
import { registerGroupGenerateRoutes } from './routes/groupGenerate.js';
import { registerGroupRoutes } from './routes/groups.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImageRoutes } from './routes/images.js';
import { registerImportRoutes } from './routes/import.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerPersonaRoutes } from './routes/personas.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerProfileRoutes } from './routes/profiles.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerQuickReplyRoutes } from './routes/quickReplies.js';
import { registerRegexRoutes } from './routes/regex.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSharedRoutes } from './routes/shared.js';
import { registerTtsRoutes } from './routes/tts.js';
import { registerWorldRoutes } from './routes/worlds.js';
import { prepareDataFolder } from './storage/bootstrap.js';

const PUBLIC_API_PATHS = new Set([
    '/api/health',
    '/api/auth/status',
    '/api/auth/setup',
    '/api/auth/login',
    '/api/auth/logout',
]);

export async function buildApp(): Promise<FastifyInstance> {
    // Pretty logs are for a developer looking at a terminal. A packaged build
    // has its stdout piped into the desktop shell, where pino-pretty is not
    // installed and JSON lines are easier to forward.
    const prettyLogs = !config.isProduction && process.stdout.isTTY;

    const app = Fastify({
        logger: {
            level: config.logLevel,
            redact: {
                paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
                remove: true,
            },
            ...(prettyLogs
                ? {
                      transport: {
                          target: 'pino-pretty',
                          options: {
                              translateTime: 'HH:MM:ss',
                              ignore: 'pid,hostname',
                          },
                      },
                  }
                : {}),
        },
        bodyLimit: 25 * 1024 * 1024,
    });

    await prepareDataFolder();

    await app.register(cookie);
    await app.register(multipart, {
        limits: {
            fileSize: 20 * 1024 * 1024,
            files: 50,
        },
    });
    await app.register(rateLimit, { global: false });

    app.setErrorHandler((error, request, reply) => {
        if (error instanceof HttpError) {
            return reply.code(error.statusCode).send({
                error: error.message,
                ...(error.code ? { code: error.code } : {}),
            });
        }
        if (error instanceof ZodError) {
            return reply.code(400).send({
                error: error.issues[0]?.message ?? 'Invalid request',
                code: 'VALIDATION',
            });
        }
        const errorLike = error as { code?: string; statusCode?: number };
        if (errorLike.code === 'FST_REQ_FILE_TOO_LARGE' || errorLike.statusCode === 413) {
            return reply.code(413).send({
                error: 'File or request body is too large',
                code: 'PAYLOAD_TOO_LARGE',
            });
        }

        request.log.error(error);
        return reply.code(500).send({ error: 'Internal server error' });
    });

    app.addHook('onRequest', async (request, reply) => {
        const pathname = request.url.split('?')[0] ?? request.url;
        if (!pathname.startsWith('/api/')) {
            return;
        }
        if (request.method === 'OPTIONS') {
            return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            const origin = request.headers.origin;
            if (origin) {
                try {
                    const originUrl = new URL(origin);
                    if (!request.headers.host || originUrl.host !== request.headers.host) {
                        return reply.code(403).send({ error: 'Invalid origin' });
                    }
                } catch {
                    return reply.code(403).send({ error: 'Invalid origin' });
                }
            }
        }

        if (PUBLIC_API_PATHS.has(pathname)) {
            return;
        }
        await requireAuth(request, reply);
    });

    await registerHealthRoutes(app);
    await registerAuthRoutes(app);
    await registerCharacterRoutes(app);
    await registerChatRoutes(app);
    await registerGroupRoutes(app);
    await registerSettingsRoutes(app);
    await registerTtsRoutes(app);
    await registerImageRoutes(app);
    await registerProviderRoutes(app);
    await registerProfileRoutes(app);
    await registerSharedRoutes(app);
    await registerPresetRoutes(app);
    await registerPersonaRoutes(app);
    await registerWorldRoutes(app);
    await registerRegexRoutes(app);
    await registerQuickReplyRoutes(app);
    await registerImportRoutes(app);
    await registerDistillRoutes(app);
    await registerContextRoutes(app);
    await registerGenerateRoutes(app);
    await registerGroupGenerateRoutes(app);
    await registerMemoryRoutes(app);

    const webDist = path.resolve(import.meta.dirname, '../../web/dist');
    if (existsSync(webDist)) {
        await app.register(fastifyStatic, {
            root: webDist,
            prefix: '/',
        });
        app.setNotFoundHandler((request, reply) => {
            if (request.url.startsWith('/api/')) {
                return reply.code(404).send({ error: 'Not found' });
            }
            return reply.sendFile('index.html');
        });
    } else {
        app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
    }

    return app;
}
