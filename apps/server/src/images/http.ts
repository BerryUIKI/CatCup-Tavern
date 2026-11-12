import { isRecord } from '@catcup/shared';

import { HttpError } from '../http/errors.js';
import type { ImageFormat } from './types.js';

/** Hard ceiling for one generated image, matching the audio relay's limit. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function imageFailed(message: string): HttpError {
    return new HttpError(502, message, 'IMAGE_FAILED');
}

export function imageConfig(message: string): HttpError {
    return new HttpError(400, message, 'IMAGE_CONFIG');
}

/** Validate the configured base URL and return it parsed. */
export function validateImageBaseUrl(baseUrl: string): URL {
    if (!baseUrl.trim()) {
        throw imageConfig('The image generation base URL is not configured');
    }
    try {
        const url = new URL(baseUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('unsupported protocol');
        }
        return url;
    } catch {
        throw imageConfig('The image generation base URL is not a valid HTTP URL');
    }
}

/** Identify a buffer by its magic bytes; the extension of a provider body is not trustworthy. */
export function detectImageFormat(buffer: Buffer): ImageFormat | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return 'png';
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpeg';
    }
    if (
        buffer.length >= 12 &&
        buffer.toString('ascii', 0, 4) === 'RIFF' &&
        buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
        return 'webp';
    }
    return null;
}

/** Strip a data URL prefix, decode base64 and verify it is a supported image. */
export function decodeImageBase64(value: string, source = 'image provider'): { data: Buffer; format: ImageFormat } {
    const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
    const base64 = comma >= 0 ? value.slice(comma + 1) : value;
    const data = Buffer.from(base64.replace(/\s+/g, ''), 'base64');
    if (data.length === 0) {
        throw imageFailed(`${source} returned empty image data`);
    }
    if (data.length > MAX_IMAGE_BYTES) {
        throw imageFailed(`${source} returned too much image data`);
    }
    const format = detectImageFormat(data);
    if (!format) {
        throw imageFailed(`${source} returned data that is not a PNG, JPEG or WebP image`);
    }
    return { data, format };
}

/** Read a response body with a hard size cap, cancelling the stream when exceeded. */
export async function readImageBody(response: Response, source: string): Promise<Buffer> {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        throw imageFailed(`${source} returned too much image data`);
    }

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
            if (total > MAX_IMAGE_BYTES) {
                await reader.cancel().catch(() => undefined);
                throw new Error('response body is too large');
            }
            chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
    } catch (error) {
        throw imageFailed(
            `${source} response failed: ${error instanceof Error ? error.message : 'could not read the body'}`,
        );
    }
}

/** Read a provider error body and keep the useful sentence, not the whole HTML page. */
export async function readProviderError(response: Response, source: string): Promise<string> {
    const text = await response.text().catch(() => '');
    if (!text.trim()) {
        return `${source} returned HTTP ${response.status}`;
    }
    let message = text.slice(0, 800);
    try {
        const payload: unknown = JSON.parse(text);
        if (isRecord(payload) && 'error' in payload) {
            const error = payload.error;
            if (typeof error === 'string') {
                message = error;
            } else if (isRecord(error) && typeof error.message === 'string') {
                message = error.message;
            } else if (error !== undefined) {
                message = JSON.stringify(error);
            }
        }
    } catch {
        // Not JSON; the text itself is the provider's explanation.
    }
    return `${source} returned HTTP ${response.status}: ${message.slice(0, 800)}`;
}

/** Fetch an image URL a provider returned, with the same size and protocol guards. */
export async function fetchImageUrl(url: string, source: string): Promise<{ data: Buffer; format: ImageFormat }> {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw imageFailed(`${source} returned an invalid image URL`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw imageFailed(`${source} returned an unsupported image URL`);
    }

    let response: Response;
    try {
        response = await fetch(parsed, {
            signal: AbortSignal.timeout(60_000),
            redirect: 'follow',
        });
    } catch (error) {
        throw imageFailed(
            `${source} image download failed: ${error instanceof Error ? error.message : 'network error'}`,
        );
    }
    if (!response.ok) {
        throw imageFailed(await readProviderError(response, `${source} image download`));
    }
    const data = await readImageBody(response, `${source} image download`);
    const format = detectImageFormat(data);
    if (!format) {
        throw imageFailed(`${source} image download was not a PNG, JPEG or WebP image`);
    }
    return { data, format };
}
