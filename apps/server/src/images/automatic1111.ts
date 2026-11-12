import type { ImageGenerationSettings } from '@catcup/shared';

import { joinUrl } from '../providers/http.js';
import { decodeImageBase64, imageFailed, readProviderError, validateImageBaseUrl } from './http.js';
import type { GeneratedImageData, ImageRequest } from './types.js';

const REQUEST_TIMEOUT_MS = 180_000;

interface Automatic1111Response {
    images?: unknown;
    info?: unknown;
}

function seedFromInfo(info: unknown): number | null {
    if (typeof info !== 'string' || !info.trim()) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(info);
        if (parsed && typeof parsed === 'object') {
            const record = parsed as Record<string, unknown>;
            for (const value of [record.seed, Array.isArray(record.all_seeds) ? record.all_seeds[0] : undefined]) {
                if (typeof value === 'number' && Number.isFinite(value)) {
                    return Math.trunc(value);
                }
            }
        }
    } catch {
        // A1111's `info` is usually JSON, but it is not part of the contract.
    }
    return null;
}

/**
 * Call Automatic1111/Forge's `/sdapi/v1/txt2img`.
 *
 * A1111 does not need a key. If one is configured it is sent as HTTP Basic
 * auth, which is how a protected instance expects `user:password`.
 */
export async function generateImage(
    settings: ImageGenerationSettings,
    apiKey: string | undefined,
    request: ImageRequest,
    signal?: AbortSignal,
): Promise<GeneratedImageData> {
    validateImageBaseUrl(settings.baseUrl);

    const body: Record<string, unknown> = {
        prompt: request.prompt,
        negative_prompt: request.negativePrompt,
        steps: request.steps,
        cfg_scale: request.cfgScale,
        width: request.width,
        height: request.height,
        sampler_name: request.sampler,
        batch_size: 1,
        n_iter: 1,
        save_images: false,
        send_images: true,
    };
    if (request.seed >= 0) {
        body.seed = request.seed;
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
        headers.authorization = `Basic ${Buffer.from(apiKey).toString('base64')}`;
    }

    let response: Response;
    try {
        const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
        response = await fetch(joinUrl(settings.baseUrl, 'sdapi/v1/txt2img'), {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
    } catch (error) {
        throw imageFailed(`Automatic1111 request failed: ${error instanceof Error ? error.message : 'network error'}`);
    }

    if (!response.ok) {
        throw imageFailed(await readProviderError(response, 'Automatic1111'));
    }

    let payload: Automatic1111Response;
    try {
        payload = (await response.json()) as Automatic1111Response;
    } catch {
        throw imageFailed('Automatic1111 returned a response that is not JSON');
    }

    const image = Array.isArray(payload.images) ? payload.images[0] : undefined;
    if (typeof image !== 'string' || !image.trim()) {
        throw imageFailed('Automatic1111 returned no image');
    }

    const decoded = decodeImageBase64(image, 'Automatic1111');
    return {
        data: decoded.data,
        format: decoded.format,
        seed: seedFromInfo(payload.info),
        model: settings.model.trim(),
    };
}
