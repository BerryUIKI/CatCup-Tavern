import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest } from '../http/errors.js';
import { getSettings, getTtsSecret } from '../storage/settings.js';
import { requiresTtsKey, type SpeechAudio, synthesizeSpeech } from '../tts/openaiCompatible.js';

const speakSchema = z.object({
    text: z.string().trim().min(1).max(4000),
    voice: z.string().trim().max(200).optional(),
});

export async function registerTtsRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/tts/speak', async (request, reply) => {
        const body = speakSchema.parse(request.body ?? {});
        const settings = await getSettings();
        const tts = settings.tts;

        if (!tts.enabled) {
            throw badRequest('Text to speech is disabled', 'TTS_DISABLED');
        }
        if (tts.backend !== 'openai-compatible') {
            throw badRequest('The selected TTS backend runs in the browser', 'TTS_SYSTEM_BACKEND');
        }

        const apiKey = await getTtsSecret();
        if (requiresTtsKey(tts.baseUrl) && !apiKey) {
            throw badRequest('No TTS API key is configured', 'TTS_KEY_MISSING');
        }

        // If the browser stops playback or navigates away, abort the upstream
        // request instead of paying for audio nobody will hear. The response's
        // close event fires on a premature disconnect; a normal end has
        // `writableEnded` set and leaves the finished request alone.
        const controller = new AbortController();
        const onClose = () => {
            if (!reply.raw.writableEnded) {
                controller.abort();
            }
        };
        reply.raw.on('close', onClose);

        let audio: SpeechAudio;
        try {
            audio = await synthesizeSpeech(
                tts,
                apiKey,
                { text: body.text, voice: body.voice ?? tts.voice },
                controller.signal,
            );
        } finally {
            reply.raw.off('close', onClose);
        }

        reply.header('Content-Type', audio.contentType).header('Cache-Control', 'no-store');
        reply.send(audio.data);
    });
}
