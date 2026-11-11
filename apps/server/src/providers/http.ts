export interface SseEvent {
    event: string;
    data: string;
}

export function joinUrl(baseUrl: string, suffix: string): string {
    const base = baseUrl.trim().replace(/\/+$/, '');
    const path = suffix.replace(/^\/+/, '');
    return `${base}/${path}`;
}

export async function ensureOk(response: Response, service: string): Promise<void> {
    if (response.ok) {
        return;
    }
    let detail = '';
    try {
        detail = (await response.text()).slice(0, 800);
    } catch {
        // The response body may already be consumed or empty.
    }
    throw new Error(`${service} request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
}

function parseSseBlock(block: string): SseEvent | null {
    let event = 'message';
    const dataLines: string[] = [];

    for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) {
            continue;
        }
        if (line.startsWith('event:')) {
            event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    }

    if (dataLines.length === 0) {
        return null;
    }
    return { event, data: dataLines.join('\n') };
}

/** Parse an SSE response body into events. Handles CRLF and partial reads. */
export async function* parseSse(response: Response): AsyncGenerator<SseEvent> {
    if (!response.body) {
        throw new Error('Provider returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');

            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const parsed = parseSseBlock(block);
                if (parsed) {
                    yield parsed;
                }
                boundary = buffer.indexOf('\n\n');
            }
        }

        const tail = parseSseBlock(buffer.replace(/\r\n/g, '\n').trim());
        if (tail) {
            yield tail;
        }
    } finally {
        reader.releaseLock();
    }
}

/** Parse an NDJSON response body (Ollama) line by line. */
export async function* parseNdjson(response: Response): AsyncGenerator<string> {
    if (!response.body) {
        throw new Error('Provider returned an empty response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf('\n');
            while (boundary >= 0) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);
                if (line) {
                    yield line;
                }
                boundary = buffer.indexOf('\n');
            }
        }

        const tail = buffer.trim();
        if (tail) {
            yield tail;
        }
    } finally {
        reader.releaseLock();
    }
}

export function numberOrUndefined(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
