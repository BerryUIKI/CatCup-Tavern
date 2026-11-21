import { errorMessage } from '@catcup/shared';

import { createSessionToken, SESSION_COOKIE } from '../security/session.js';
import { getAuthFile } from '../storage/auth.js';
import type { GenerateFn } from './conversation.js';

/**
 * Producing a reply for an IM message.
 *
 * This calls CatCup's **own** `/api/generate` route over loopback rather than
 * reimplementing prompt assembly. That is a deliberate trade:
 *
 * - The route is 120 lines of macro context, preset resolution, regex scripts,
 *   memory injection, world info scanning and the summary trigger. A second
 *   copy would drift from it within a release, and the drift would show up as an
 *   IM reply that reads subtly differently from the same reply in the app.
 * - `app.inject` cannot stand in: the route hijacks the response for SSE, which
 *   injection does not carry. So this is a real HTTP call to the real server.
 * - The server is already listening and stays local: this never leaves the
 *   machine, and the cookie it mints never leaves the process.
 *
 * The cost is a round trip and an SSE parse. Both are cheap next to a model
 * call, and both are things this file can be wrong about only visibly.
 */

export interface LoopbackOptions {
    /** The address the server is listening on, e.g. `http://127.0.0.1:8000`. */
    baseUrl: () => string | null;
}

/** Read an SSE body into the events it carried. */
function parseSse(body: string): Array<Record<string, unknown>> {
    const events: Array<Record<string, unknown>> = [];

    for (const block of body.split(/\n\n+/)) {
        const data = block
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');
        if (!data) {
            continue;
        }
        try {
            events.push(JSON.parse(data) as Record<string, unknown>);
        } catch {
            // A malformed block is dropped; the stream's terminal event is what
            // matters, and a missing one is reported below.
        }
    }

    return events;
}

/**
 * Build the `generate` seam.
 *
 * Failure is a thrown error with a sentence a person can read. The conversation
 * turns it into a message — silence looks exactly like a bot that has died,
 * which is the one outcome this must never produce.
 */
export function loopbackGenerate(options: LoopbackOptions): GenerateFn {
    return async (input) => {
        const base = options.baseUrl();
        if (!base) {
            throw new Error('the server has not finished starting');
        }

        const auth = await getAuthFile();
        if (!auth) {
            // Open desktop mode has no auth file, and its API requires none.
            // An empty cookie is the honest thing to send; the route treats an
            // unauthenticated loopback request the same as the app does.
        }

        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (auth) {
            headers.cookie = `${SESSION_COOKIE}=${createSessionToken(auth.sessionSecret)}`;
        }

        const response = await fetch(`${base}/api/generate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                characterId: input.characterId,
                chatId: input.chatId,
                action: 'send',
                message: input.message,
            }),
        });

        if (!response.ok) {
            // A JSON error body is what the route sends before it opens the
            // stream; a 400 carries the reason a person needs.
            const detail = await response
                .json()
                .then((body: unknown) => (body as { error?: string }).error)
                .catch(() => null);
            throw new Error(detail ?? `the server answered ${response.status}`);
        }

        const events = parseSse(await response.text());

        // Token events carry the reply as it arrives; the `done` event carries
        // the stored message. Tokens are used because they are what the model
        // actually produced — `done` is the same text after regex transforms,
        // and a transformed reply is what the chat file holds, so either would
        // do; tokens avoid depending on that.
        const text = events
            .filter((event) => event.type === 'token')
            .map((event) => (typeof event.text === 'string' ? event.text : ''))
            .join('');

        const failure = events.find((event) => event.type === 'error');
        if (failure) {
            throw new Error(typeof failure.message === 'string' ? failure.message : 'the reply failed');
        }

        if (!text.trim()) {
            // A `done` without tokens means the provider answered without text,
            // which the route already treats as an error; surface it as one.
            throw new Error('the model returned nothing');
        }

        return text;
    };
}

/** A sentence for a caught error, without leaking a stack. */
export function describeFailure(error: unknown): string {
    return errorMessage(error) || 'the reply failed';
}
