import { createServer, type Server } from 'node:http';

import { DEFAULT_COMFY_WORKFLOW, DEFAULT_IMAGE_GENERATION_SETTINGS } from '@catcup/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { buildComfyWorkflow, type ComfyWorkflowValues, comfyWorkflowPlaceholders, generateImage } from './comfyui.js';

const values: ComfyWorkflowValues = {
    prompt: 'a knight holding a sign that says "%seed%"',
    negativePrompt: 'lowres',
    seed: 42,
    width: 768,
    height: 512,
    steps: 28,
    cfgScale: 6.5,
    sampler: 'euler',
    scheduler: 'karras',
    model: 'sd/dream.safetensors',
};

/** A valid 1x1 PNG, so the completion test reaches the image check. */
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function nodeInputs(graph: Record<string, unknown>, id: string): Record<string, unknown> {
    const node = graph[id] as Record<string, unknown>;
    return node.inputs as Record<string, unknown>;
}

describe('ComfyUI workflow filling', () => {
    it('substitutes placeholders with numbers and strings', () => {
        const graph = buildComfyWorkflow(DEFAULT_COMFY_WORKFLOW, values);

        expect(nodeInputs(graph, '3')).toMatchObject({
            cfg: 6.5,
            sampler_name: 'euler',
            scheduler: 'karras',
            seed: 42,
            steps: 28,
        });
        expect(nodeInputs(graph, '4').ckpt_name).toBe('sd/dream.safetensors');
        expect(nodeInputs(graph, '5')).toMatchObject({ width: 768, height: 512, batch_size: 1 });
        expect(nodeInputs(graph, '6').text).toBe(values.prompt);
        expect(nodeInputs(graph, '7').text).toBe('lowres');

        // The prompt itself contains a placeholder and must not be substituted again.
        expect(nodeInputs(graph, '6').text).toBe('a knight holding a sign that says "%seed%"');
    });

    it('leaves unknown placeholders and non-placeholder strings alone', () => {
        const template = JSON.stringify({
            '1': {
                class_type: 'SomeNode',
                inputs: { text: '%mystery%', label: 'prefix %prompt%', link: ['%prompt%', 0] },
            },
        });
        const graph = buildComfyWorkflow(template, values);
        expect(nodeInputs(graph, '1')).toEqual({
            text: '%mystery%',
            label: 'prefix %prompt%',
            link: [values.prompt, 0],
        });
    });

    it('lists the placeholders a workflow uses', () => {
        expect(comfyWorkflowPlaceholders(DEFAULT_COMFY_WORKFLOW).sort()).toEqual(
            [
                'model',
                'negative_prompt',
                'prompt',
                'sampler',
                'scheduler',
                'seed',
                'steps',
                'scale',
                'width',
                'height',
            ].sort(),
        );
        expect(comfyWorkflowPlaceholders('{ not json')).toEqual([]);
    });

    it('rejects workflows that cannot be posted', () => {
        expect(() => buildComfyWorkflow('', values)).toThrow(/not configured/);
        expect(() => buildComfyWorkflow('{', values)).toThrow(/not valid JSON/);
        expect(() => buildComfyWorkflow('[]', values)).toThrow(/must be a JSON object/);
        expect(() => buildComfyWorkflow('{}', values)).toThrow(/no nodes/);
        expect(() => buildComfyWorkflow(JSON.stringify({ nodes: [], links: [] }), values)).toThrow(
            /Save \(API Format\)/,
        );
        expect(() => buildComfyWorkflow(JSON.stringify({ '1': { inputs: {} } }), values)).toThrow(
            /class_type and inputs/,
        );
    });
});

describe('ComfyUI cancellation', () => {
    let server: Server | undefined;

    afterAll(async () => {
        if (server) {
            await new Promise<void>((resolve) => server?.close(() => resolve()));
        }
    });

    it('posts /interrupt when the caller aborts', async () => {
        let interrupted = false;
        let historyCalls = 0;

        server = createServer((request, response) => {
            if (request.method === 'POST' && request.url === '/prompt') {
                request.resume();
                request.on('end', () => {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ prompt_id: 'slow' }));
                });
                return;
            }
            if (request.method === 'GET' && request.url === '/history/slow') {
                historyCalls += 1;
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end('{}');
                return;
            }
            if (request.method === 'POST' && request.url === '/interrupt') {
                interrupted = true;
                response.writeHead(200);
                response.end();
                return;
            }
            response.writeHead(404);
            response.end();
        });
        await new Promise<void>((resolve) => {
            server?.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;

        const controller = new AbortController();
        const pending = generateImage(
            {
                ...DEFAULT_IMAGE_GENERATION_SETTINGS,
                backend: 'comfyui',
                baseUrl: `http://127.0.0.1:${port}`,
                model: 'ckpt.safetensors',
            },
            undefined,
            {
                prompt: 'slow job',
                negativePrompt: '',
                width: 512,
                height: 512,
                steps: 20,
                cfgScale: 7,
                sampler: 'euler',
                scheduler: 'normal',
                seed: 1,
            },
            controller.signal,
        );
        const outcome = pending.then(
            () => null,
            (error: Error) => error,
        );

        for (let attempt = 0; attempt < 200 && historyCalls === 0; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(historyCalls).toBeGreaterThan(0);

        controller.abort();
        const error = await outcome;
        expect(error?.message).toMatch(/cancelled/);

        for (let attempt = 0; attempt < 100 && !interrupted; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(interrupted).toBe(true);
    }, 15_000);

    it('does not interrupt a job that already finished', async () => {
        let interrupted = false;
        let viewStarted = false;

        const finished = createServer((request, response) => {
            if (request.method === 'POST' && request.url === '/prompt') {
                request.resume();
                request.on('end', () => {
                    response.writeHead(200, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ prompt_id: 'done' }));
                });
                return;
            }
            if (request.method === 'GET' && request.url === '/history/done') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(
                    JSON.stringify({
                        done: {
                            status: { status_str: 'success', completed: true },
                            outputs: { '9': { images: [{ filename: 'done.png', subfolder: '', type: 'output' }] } },
                        },
                    }),
                );
                return;
            }
            if (request.method === 'GET' && request.url?.startsWith('/view')) {
                viewStarted = true;
                setTimeout(() => {
                    if (!response.writableEnded && !response.destroyed) {
                        response.writeHead(200, { 'content-type': 'image/png' });
                        response.end(png);
                    }
                }, 300);
                return;
            }
            if (request.method === 'POST' && request.url === '/interrupt') {
                interrupted = true;
                response.writeHead(200);
                response.end();
                return;
            }
            response.writeHead(404);
            response.end();
        });

        await new Promise<void>((resolve) => {
            finished.listen(0, '127.0.0.1', resolve);
        });
        try {
            const address = finished.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const controller = new AbortController();
            const pending = generateImage(
                {
                    ...DEFAULT_IMAGE_GENERATION_SETTINGS,
                    backend: 'comfyui',
                    baseUrl: `http://127.0.0.1:${port}`,
                    model: 'ckpt.safetensors',
                },
                undefined,
                {
                    prompt: 'finished job',
                    negativePrompt: '',
                    width: 512,
                    height: 512,
                    steps: 20,
                    cfgScale: 7,
                    sampler: 'euler',
                    scheduler: 'normal',
                    seed: 1,
                },
                controller.signal,
            );
            const outcome = pending.then(
                () => null,
                (error: Error) => error,
            );

            for (let attempt = 0; attempt < 300 && !viewStarted; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(viewStarted).toBe(true);

            controller.abort();
            const error = await outcome;
            expect(error?.message).toMatch(/cancelled/);

            await new Promise((resolve) => setTimeout(resolve, 150));
            expect(interrupted).toBe(false);
        } finally {
            await new Promise<void>((resolve) => {
                finished.close(() => resolve());
            });
        }
    }, 15_000);
});
