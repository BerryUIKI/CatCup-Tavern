export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return 'Unknown error';
}

export function formatTimestamp(value: number | string | Date = Date.now()): string {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleString('en-US', { hour12: false });
}

export function uniqueName(base: string, exists: (candidate: string) => boolean): string {
    if (!exists(base)) {
        return base;
    }
    for (let index = 2; index < 10000; index += 1) {
        const candidate = `${base} (${index})`;
        if (!exists(candidate)) {
            return candidate;
        }
    }
    return `${base} (${Date.now()})`;
}
