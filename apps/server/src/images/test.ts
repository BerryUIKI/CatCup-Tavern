import type { ImageGenerationSettings } from '@catcup/shared';

import { joinUrl } from '../providers/http.js';
import { imageFailed, readProviderError, validateImageBaseUrl } from './http.js';

const TEST_TIMEOUT_MS = 15_000;

/**
 * Check that the image endpoint answers. A1111 exposes `/sdapi/v1/options`;
 * OpenAI-compatible servers usually answer `/models`, though a server can
 * generate images without implementing that route.
 */
export async function testImageBackend(settings: ImageGenerationSettings, apiKey: string | undefined): Promise<void> {
    validateImageBaseUrl(settings.baseUrl);

    const endpoint = settings.backend === 'automatic1111' ? 'sdapi/v1/options' : 'models';
    const headers: Record<string, string> = {};
    if (apiKey) {
        headers.authorization =
            settings.backend === 'automatic1111'
                ? `Basic ${Buffer.from(apiKey).toString('base64')}`
                : `Bearer ${apiKey}`;
    }

    let response: Response;
    try {
        response = await fetch(joinUrl(settings.baseUrl, endpoint), {
            headers,
            signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        });
    } catch (error) {
        throw imageFailed(
            `The image backend did not answer: ${error instanceof Error ? error.message : 'network error'}`,
        );
    }

    if (!response.ok) {
        throw imageFailed(await readProviderError(response, 'Image backend'));
    }
    try {
        await response.body?.cancel();
    } catch {
        // The connection check already succeeded; draining the body is best-effort.
    }
}
