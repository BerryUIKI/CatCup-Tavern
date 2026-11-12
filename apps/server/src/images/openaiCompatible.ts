import type { ImageGenerationSettings } from '@catcup/shared';
import { isRecord } from '@catcup/shared';

import { joinUrl } from '../providers/http.js';
import {
    decodeImageBase64,
    fetchImageUrl,
    imageConfig,
    imageFailed,
    readProviderError,
    validateImageBaseUrl,
} from './http.js';
import type { GeneratedImageData, ImageRequest } from './types.js';

const REQUEST_TIMEOUT_MS = 180_000;

/** OpenAI itself needs a key; a local `/images/generations` server may not. */
export function requiresImageKey(baseUrl: string): boolean {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase();
        return host === 'openai.com' || host.endsWith('.openai.com');
    } catch {
        return false;
    }
}

/**
 * OpenAI's image models accept a fixed set of sizes. Map the configured
 * aspect ratio onto the closest supported value, as SillyTavern does.
 */
export function openAiImageSize(model: string, width: number, height: number): string {
    const name = model.toLowerCase();
    const landscape = width > height;
    const portrait = height > width;

    if (name.includes('dall-e-3')) {
        return portrait ? '1024x1792' : landscape ? '1792x1024' : '1024x1024';
    }
    if (name.includes('gpt-image')) {
        return portrait ? '1024x1536' : landscape ? '1536x1024' : '1024x1024';
    }
    if (name.includes('dall-e-2')) {
        return '1024x1024';
    }
    return `${width}x${height}`;
}

interface OpenAiImageItem {
    b64_json?: unknown;
    url?: unknown;
}

function firstImageItem(payload: unknown): OpenAiImageItem | null {
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
        return null;
    }
    const item = payload.data[0];
    return isRecord(item) ? (item as OpenAiImageItem) : null;
}

/**
 * Call an OpenAI-compatible `/images/generations` endpoint.
 *
 * `response_format` is only requested for the DALL·E models that support it;
 * the gpt-image family returns base64 by default. A provider that answers with
 * an image URL is followed server-side, with the same size and protocol guards.
 */
export async function generateImage(
    settings: ImageGenerationSettings,
    apiKey: string | undefined,
    request: ImageRequest,
    signal?: AbortSignal,
): Promise<GeneratedImageData> {
    validateImageBaseUrl(settings.baseUrl);
    if (!settings.model.trim()) {
        throw imageConfig('The image model is not configured');
    }

    const model = settings.model.trim();
    const body: Record<string, unknown> = {
        model,
        prompt: request.prompt,
        n: 1,
        size: openAiImageSize(model, request.width, request.height),
    };
    if (model.toLowerCase().includes('dall-e')) {
        body.response_format = 'b64_json';
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        response = await fetch(joinUrl(settings.baseUrl, 'images/generations'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
    } catch (error) {
        throw imageFailed(`Image provider request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }

    if (!response.ok) {
        throw imageFailed(await readProviderError(response, 'Image provider'));
    }

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw imageFailed('Image provider returned a response that is not JSON');
    }

    const item = firstImageItem(payload);
    if (!item) {
        throw imageFailed('Image provider returned no image');
    }

    if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
        const decoded = decodeImageBase64(item.b64_json, 'Image provider');
        return { data: decoded.data, format: decoded.format, seed: null, model };
    }
    if (typeof item.url === 'string' && item.url.trim()) {
        const fetched = await fetchImageUrl(item.url, 'Image provider');
        return { data: fetched.data, format: fetched.format, seed: null, model };
    }

    throw imageFailed('Image provider returned an image entry without data or a URL');
}
