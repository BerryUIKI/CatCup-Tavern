/**
 * In-flight generations, keyed by the id the client uses to stop one.
 *
 * Both single-character and group generations register here so the shared
 * `/api/generate/:id/stop` endpoint can abort either kind.
 */
export const activeGenerations = new Map<string, AbortController>();
