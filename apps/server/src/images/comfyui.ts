import { randomInt, randomUUID } from 'node:crypto';

import type { ImageGenerationSettings } from '@catcup/shared';
import { isRecord } from '@catcup/shared';

import type { HttpError } from '../http/errors.js';
import { joinUrl } from '../providers/http.js';
import {
    detectImageFormat,
    imageConfig,
    imageFailed,
    readImageBody,
    readProviderError,
    validateImageBaseUrl,
} from './http.js';
import type { GeneratedImageData, ImageRequest } from './types.js';

/** A workflow with a cold model load can take minutes; SillyTavern waits too. */
const REQUEST_TIMEOUT_MS = 300_000;
const INTERRUPT_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 500;

/** Values substituted for the `%name%` placeholders in a workflow. */
export interface ComfyWorkflowValues {
    prompt: string;
    negativePrompt: string;
    seed: number;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    scheduler: string;
    model: string;
}

/**
 * Placeholder name to value. Numeric placeholders become JSON numbers, as
 * SillyTavern's text replacement produces, because ComfyUI's KSampler rejects
 * quoted integers.
 */
const PLACEHOLDERS: Record<string, keyof ComfyWorkflowValues> = {
    prompt: 'prompt',
    negative_prompt: 'negativePrompt',
    seed: 'seed',
    width: 'width',
    height: 'height',
    steps: 'steps',
    scale: 'cfgScale',
    sampler: 'sampler',
    scheduler: 'scheduler',
    model: 'model',
};

function substitute(value: unknown, values: ComfyWorkflowValues): unknown {
    if (typeof value === 'string') {
        const match = /^%([a-z_]+)%$/.exec(value);
        const key = match?.[1];
        return key && Object.hasOwn(PLACEHOLDERS, key) ? values[PLACEHOLDERS[key]] : value;
    }
    if (Array.isArray(value)) {
        return value.map((item) => substitute(item, values));
    }
    if (isRecord(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, values)]));
    }
    return value;
}

function collectPlaceholders(value: unknown, found: Set<string>): void {
    if (typeof value === 'string') {
        const match = /^%([a-z_]+)%$/.exec(value);
        if (match?.[1]) {
            found.add(match[1]);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectPlaceholders(item, found);
        }
        return;
    }
    if (isRecord(value)) {
        for (const item of Object.values(value)) {
            collectPlaceholders(item, found);
        }
    }
}

/**
 * The placeholder names a workflow actually uses, in the order they appear.
 * Invalid JSON yields an empty list; `buildComfyWorkflow` reports the error.
 */
export function comfyWorkflowPlaceholders(template: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(template);
    } catch {
        return [];
    }
    const found = new Set<string>();
    collectPlaceholders(parsed, found);
    return [...found];
}

function assertComfyGraph(value: unknown): asserts value is Record<string, unknown> {
    if (!isRecord(value)) {
        throw imageConfig('The ComfyUI workflow must be a JSON object');
    }
    if (Array.isArray(value.nodes) || Array.isArray(value.links)) {
        throw imageConfig(
            'That is a ComfyUI interface workflow. Export it with "Save (API Format)" and paste the API workflow instead',
        );
    }
    const entries = Object.entries(value);
    if (entries.length === 0) {
        throw imageConfig('The ComfyUI workflow has no nodes');
    }
    for (const [id, node] of entries) {
        if (!isRecord(node) || typeof node.class_type !== 'string' || !isRecord(node.inputs)) {
            throw imageConfig(
                `The ComfyUI workflow node "${id}" is not in API format; every node needs class_type and inputs`,
            );
        }
    }
}

/**
 * Parse and fill a ComfyUI API-format workflow.
 *
 * Only a string that is exactly `%name%` is replaced, matching SillyTavern's
 * `"%name%"` token semantics. The graph is walked after parsing, so a prompt
 * that happens to contain a placeholder cannot alter another field.
 */
export function buildComfyWorkflow(template: string, values: ComfyWorkflowValues): Record<string, unknown> {
    const text = template.trim();
    if (!text) {
        throw imageConfig('The ComfyUI workflow is not configured');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw imageConfig('The ComfyUI workflow is not valid JSON');
    }
    const graph = substitute(parsed, values);
    assertComfyGraph(graph);
    return graph;
}

function randomSeed(): number {
    return randomInt(0, 2 ** 32);
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
        headers.authorization = `Basic ${Buffer.from(apiKey).toString('base64')}`;
    }
    return headers;
}

/** ComfyUI validation errors name each node and the value it rejected. */
function nodeErrorLines(value: unknown): string[] {
    if (!isRecord(value)) {
        return [];
    }
    const lines: string[] = [];
    for (const [nodeId, node] of Object.entries(value)) {
        if (!isRecord(node)) {
            continue;
        }
        const classType = typeof node.class_type === 'string' ? node.class_type : 'node';
        const errors = Array.isArray(node.errors) ? node.errors : [];
        for (const error of errors) {
            if (!isRecord(error)) {
                continue;
            }
            const message = [error.message, error.details]
                .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
                .join(': ');
            lines.push(`${classType} [${nodeId}]${message ? `: ${message}` : ''}`);
        }
    }
    return lines;
}

/**
 * ComfyUI rejects an unexecutable graph with HTTP 400 and puts the per-node
 * reasons in `node_errors`, which the generic provider-error helper does not
 * read. Keep them: a mistyped checkpoint or sampler name is the most common
 * setup mistake, and the job never reaches `/history` to produce a traceback.
 */
async function readComfyPromptError(response: Response): Promise<HttpError> {
    const text = await response.text().catch(() => '');
    const prefix = `ComfyUI returned HTTP ${response.status}`;
    if (!text.trim()) {
        return imageFailed(prefix);
    }

    let message = text.slice(0, 800);
    let nodeDetails: string[] = [];
    try {
        const payload: unknown = JSON.parse(text);
        if (isRecord(payload)) {
            const error = payload.error;
            if (typeof error === 'string') {
                message = error;
            } else if (isRecord(error)) {
                const errorMessage = typeof error.message === 'string' ? error.message : '';
                const errorDetails = typeof error.details === 'string' ? error.details : '';
                message = [errorMessage, errorDetails].filter(Boolean).join(': ') || message;
            }
            nodeDetails = nodeErrorLines(payload.node_errors);
        }
    } catch {
        // The text itself is ComfyUI's explanation.
    }
    return imageFailed(
        `${prefix}: ${message.slice(0, 800)}${nodeDetails.length ? `\n\n${nodeDetails.join('\n')}` : ''}`,
    );
}

/** ComfyUI reports a failed node in `status.messages` as `execution_error`. */
function executionError(item: Record<string, unknown>): string | null {
    const status = isRecord(item.status) ? item.status : null;
    if (status?.status_str !== 'error') {
        return null;
    }
    const details: string[] = [];
    const messages = Array.isArray(status.messages) ? status.messages : [];
    for (const message of messages) {
        if (!Array.isArray(message) || message[0] !== 'execution_error' || !isRecord(message[1])) {
            continue;
        }
        const data = message[1];
        const nodeType = typeof data.node_type === 'string' ? data.node_type : 'node';
        const nodeId = typeof data.node_id === 'string' || typeof data.node_id === 'number' ? data.node_id : '?';
        const errorType = typeof data.exception_type === 'string' ? data.exception_type : 'Error';
        const errorMessage = typeof data.exception_message === 'string' ? data.exception_message : '';
        details.push(`${nodeType} [${nodeId}] ${errorType}: ${errorMessage}`.trim());
    }
    return details.length
        ? `ComfyUI generation failed:\n\n${details.join('\n')}`
        : 'ComfyUI generation failed; its history reports an error but no node traceback';
}

interface ComfyImageRef {
    filename: string;
    subfolder: string;
    type: string;
}

/** The first image any output node produced. */
function firstOutputImage(outputs: unknown): ComfyImageRef | null {
    if (!isRecord(outputs)) {
        return null;
    }
    for (const output of Object.values(outputs)) {
        if (!isRecord(output) || !Array.isArray(output.images)) {
            continue;
        }
        for (const image of output.images) {
            if (isRecord(image) && typeof image.filename === 'string' && image.filename.trim()) {
                return {
                    filename: image.filename,
                    subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
                    type: typeof image.type === 'string' ? image.type : 'output',
                };
            }
        }
    }
    return null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new Error('aborted'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * Run one image through a ComfyUI workflow.
 *
 * The adapter posts the filled graph to `/prompt`, polls `/history/<id>` until
 * the job finishes, then downloads the first image from `/view`. When the
 * browser disconnects or the job times out, `/interrupt` cancels the running
 * job so ComfyUI does not keep a GPU busy for a reply nobody will see; the
 * adapter only interrupts a job this request queued and has not finished.
 */
export async function generateImage(
    settings: ImageGenerationSettings,
    apiKey: string | undefined,
    request: ImageRequest,
    signal?: AbortSignal,
): Promise<GeneratedImageData> {
    validateImageBaseUrl(settings.baseUrl);
    if (comfyWorkflowPlaceholders(settings.comfyWorkflow).includes('model') && !settings.model.trim()) {
        throw imageConfig('The ComfyUI workflow uses %model%, but no checkpoint name is configured');
    }

    const seed = request.seed >= 0 ? request.seed : randomSeed();
    const graph = buildComfyWorkflow(settings.comfyWorkflow, {
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        seed,
        width: request.width,
        height: request.height,
        steps: request.steps,
        cfgScale: request.cfgScale,
        sampler: request.sampler,
        scheduler: request.scheduler || 'normal',
        model: settings.model.trim(),
    });

    const headers = authHeaders(apiKey);
    const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;

    let ownsJob = false;
    let jobSettled = false;
    const interrupt = () => {
        // An abort during the /view download, or before ComfyUI confirmed the
        // prompt, must not interrupt whatever job happens to be running.
        if (!ownsJob || jobSettled) {
            return;
        }
        void fetch(joinUrl(settings.baseUrl, 'interrupt'), {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(INTERRUPT_TIMEOUT_MS),
        }).catch(() => undefined);
    };
    requestSignal.addEventListener('abort', interrupt, { once: true });

    const failure = (what: string, error?: unknown): never => {
        if (signal?.aborted) {
            throw imageFailed(`ComfyUI ${what} was cancelled`);
        }
        if (deadline.aborted) {
            throw imageFailed('ComfyUI did not finish the image within five minutes');
        }
        throw imageFailed(
            `ComfyUI ${what} failed: ${error instanceof Error ? error.message : 'the request was aborted'}`,
        );
    };

    try {
        let promptResponse: Response;
        try {
            promptResponse = await fetch(joinUrl(settings.baseUrl, 'prompt'), {
                method: 'POST',
                headers,
                body: JSON.stringify({ prompt: graph, client_id: randomUUID() }),
                signal: requestSignal,
            });
        } catch (error) {
            return failure('request', error);
        }
        if (!promptResponse.ok) {
            throw await readComfyPromptError(promptResponse);
        }

        let queued: unknown;
        try {
            queued = await promptResponse.json();
        } catch (error) {
            if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
                return failure('request', error);
            }
            throw imageFailed('ComfyUI returned a response that is not JSON');
        }
        const promptId = isRecord(queued) && typeof queued.prompt_id === 'string' ? queued.prompt_id : null;
        if (!promptId) {
            throw imageFailed('ComfyUI did not return a prompt id');
        }
        ownsJob = true;

        while (true) {
            let historyResponse: Response;
            try {
                historyResponse = await fetch(joinUrl(settings.baseUrl, `history/${encodeURIComponent(promptId)}`), {
                    headers,
                    signal: requestSignal,
                });
            } catch (error) {
                return failure('poll', error);
            }
            if (!historyResponse.ok) {
                throw imageFailed(await readProviderError(historyResponse, 'ComfyUI'));
            }

            let history: unknown;
            try {
                history = await historyResponse.json();
            } catch (error) {
                if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
                    return failure('poll', error);
                }
                throw imageFailed('ComfyUI returned a history response that is not JSON');
            }

            const recorded = isRecord(history) ? history[promptId] : undefined;
            if (isRecord(recorded)) {
                jobSettled = true;
                const error = executionError(recorded);
                if (error) {
                    throw imageFailed(error);
                }
                const image = firstOutputImage(recorded.outputs);
                if (!image) {
                    throw imageFailed(
                        'ComfyUI finished without an image; add a SaveImage node to the workflow and try again',
                    );
                }

                const viewUrl = new URL(joinUrl(settings.baseUrl, 'view'));
                viewUrl.searchParams.set('filename', image.filename);
                viewUrl.searchParams.set('subfolder', image.subfolder);
                viewUrl.searchParams.set('type', image.type);

                let imageResponse: Response;
                try {
                    imageResponse = await fetch(viewUrl, { headers, signal: requestSignal });
                } catch (fetchError) {
                    return failure('image download', fetchError);
                }
                if (!imageResponse.ok) {
                    throw imageFailed(await readProviderError(imageResponse, 'ComfyUI'));
                }
                const data = await readImageBody(imageResponse, 'ComfyUI');
                const format = detectImageFormat(data);
                if (!format) {
                    throw imageFailed('ComfyUI returned data that is not a PNG, JPEG or WebP image');
                }
                return { data, format, seed, model: settings.model.trim() };
            }

            try {
                await sleep(POLL_INTERVAL_MS, requestSignal);
            } catch {
                return failure('generation');
            }
        }
    } finally {
        requestSignal.removeEventListener('abort', interrupt);
    }
}
