import { useCallback, useRef, useState } from 'react';

import { streamGeneration } from '../lib/sse';

interface UseImpersonationOptions {
    characterId: string | null;
    chatId: string | null;
    /** Receives the whole draft so far, so the composer fills as tokens arrive. */
    onDraft: (text: string) => void;
}

/**
 * Ask the model to write the next message as the user.
 *
 * The reply is a draft: it streams into the composer and is never stored, so
 * only the user's own Send turns it into a message. SillyTavern's Impersonate
 * button works the same way.
 */
export function useImpersonation({ characterId, chatId, onDraft }: UseImpersonationOptions) {
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const clearError = useCallback(() => setError(null), []);

    const start = useCallback(async () => {
        if (!characterId || !chatId || abortRef.current) {
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setStreaming(true);
        setError(null);

        let draft = '';
        try {
            await streamGeneration(
                '/api/generate',
                { characterId, chatId, action: 'impersonate' },
                {
                    onToken: (text) => {
                        draft += text;
                        onDraft(draft);
                    },
                    // A stopped stream still ends with `done` when some text
                    // had arrived, so the partial draft is kept as it is.
                    onDone: (message) => {
                        onDraft(message.mes);
                    },
                    onError: (message) => setError(message),
                },
                controller.signal,
            );
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Could not write the message.');
        } finally {
            abortRef.current = null;
            setStreaming(false);
        }
    }, [characterId, chatId, onDraft]);

    const stop = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    return { start, stop, streaming, error, clearError };
}
