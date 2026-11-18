/**
 * Pull a JSON object out of whatever a model returned.
 *
 * Two engines ask a model for a JSON answer — book distillation and alias
 * generation — and both have to survive the same three habits: a fenced code
 * block, a sentence of preamble, and a reply that is prose with the object
 * buried in it. A reply with no object at all is not recoverable, so it returns
 * `null` and the caller decides whether to ask once more.
 */
export function extractJson(raw: string): unknown {
    const trimmed = raw.trim();

    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    const candidate = fenced?.[1]?.trim() ?? trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        // Fall through to the outermost braces.
    }

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return null;
    }
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch {
        return null;
    }
}
