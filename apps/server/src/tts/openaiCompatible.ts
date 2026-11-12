import type { TtsSettings } from '@catcup/shared';

import { HttpError } from '../http/errors.js';
import { joinUrl } from '../providers/http.js';

/** Audio bytes and the content type to relay to the browser. */
export interface SpeechAudio {
    data: Buffer;
    contentType: string;
}

export interface SpeechRequest {
    text: string;
    /** Voice id; falls back to the configured default. */
    voice: string;
}

const CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    opus: 'audio/ogg',
    aac: 'audio/aac',
    flac: 'audio/flac',
    wav: 'audio/wav',
};

/** OpenAI itself needs a key; a local `/audio/speech` server may not. */
export function requiresTtsKey(baseUrl: string): boolean {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return host === 'openai.com' || host.endsWith('.openai.com');
    } catch {
        return false;
    }
}

function failed(message: string): HttpError {
    return new HttpError(502, message, 'TTS_FAILED');
}

/**
 * Call an OpenAI-compatible `/audio/speech` endpoint.
 *
 * Sending `instructions` to a model that does not accept it is an error, so
 * the field is only included for the models known to support it.
 */
export async function synthesizeSpeech(
    settings: TtsSettings,
    apiKey: string | undefined,
    request: SpeechRequest,
    signal?: AbortSignal,
): Promise<SpeechAudio> {
    if (!settings.baseUrl.trim()) {
        throw new HttpError(400, 'The TTS base URL is not configured', 'TTS_CONFIG');
    }
    try {
        const url = new URL(settings.baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
    } catch {
        throw new HttpError(400, 'The TTS base URL is not a valid HTTP URL', 'TTS_CONFIG');
    }
    if (!settings.model.trim()) {
        throw new HttpError(400, 'The TTS model is not configured', 'TTS_CONFIG');
    }

    const body: Record<string, unknown> = {
        model: settings.model,
        input: request.text,
        voice: request.voice || settings.voice || 'alloy',
        response_format: settings.format,
        speed: settings.speed,
    };
    if (settings.instructions.trim() && settings.model.includes('gpt-4o-mini-tts')) {
        body.instructions = settings.instructions.trim();
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
        const timeout = AbortSignal.timeout(60_000);
        response = await fetch(joinUrl(settings.baseUrl, 'audio/speech'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
    } catch (error) {
        throw failed(`TTS provider request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw failed(`TTS request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 500)}` : ''}`);
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (contentType.includes('application/json') || contentType.startsWith('text/')) {
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > 1_000_000) {
            throw failed('TTS provider returned an oversized error response');
        }
        const text = await response.text().catch(() => '');
        let message = text.slice(0, 800);
        try {
            const payload = JSON.parse(text) as unknown;
            if (payload && typeof payload === 'object' && 'error' in payload) {
                const error = (payload as { error: unknown }).error;
                if (typeof error === 'string') {
                    message = error;
                } else if (error && typeof error === 'object' && 'message' in error) {
                    const detail = (error as { message: unknown }).message;
                    message = typeof detail === 'string' ? detail : JSON.stringify(error);
                } else if (error !== undefined) {
                    message = JSON.stringify(error);
                }
            }
        } catch {
            // Not JSON; the text itself is the provider's explanation.
        }
        throw failed(message.slice(0, 800) || `TTS provider returned ${contentType || 'an unusable body'}`);
    }

    const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
        throw failed('TTS provider returned too much audio');
    }

    let data: Buffer;
    try {
        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('empty response body');
        }
        const chunks: Buffer[] = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            if (!value) {
                continue;
            }
            total += value.byteLength;
            if (total > MAX_AUDIO_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new Error('response body is too large');
            }
            chunks.push(Buffer.from(value));
        }
        data = Buffer.concat(chunks);
    } catch (error) {
        throw failed(
            `TTS provider response failed: ${error instanceof Error ? error.message : 'could not read the body'}`,
        );
    }

    if (data.length === 0) {
        throw failed('TTS provider returned empty audio');
    }

    return {
        data,
        contentType: contentType || CONTENT_TYPES[settings.format] || 'application/octet-stream',
    };
}
