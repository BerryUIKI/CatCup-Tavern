import type { GenerationEvent } from '@catcup/shared';
import type { FastifyReply } from 'fastify';

/** Take over the raw response and start an SSE stream. */
export function initSse(reply: FastifyReply): void {
    reply.hijack();
    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders?.();
}

export function writeSse(reply: FastifyReply, event: GenerationEvent): void {
    if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
    }
    try {
        reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
        // The client may have gone away mid-stream.
        console.warn('[sse] Failed to write event:', error);
    }
}

export function writeSseComment(reply: FastifyReply, comment: string): void {
    if (reply.raw.writableEnded || reply.raw.destroyed) {
        return;
    }
    try {
        reply.raw.write(`: ${comment}\n\n`);
    } catch {
        // Ignore a closed socket.
    }
}

export function endSse(reply: FastifyReply): void {
    if (!reply.raw.writableEnded) {
        try {
            reply.raw.end();
        } catch {
            // Ignore a closed socket.
        }
    }
}
