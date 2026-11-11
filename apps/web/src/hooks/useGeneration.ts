import type { GenerateAction } from '@catcup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { streamGeneration } from '../lib/sse';
import { queryKeys } from './data';

interface GenerationState {
    streaming: boolean;
    action: GenerateAction | null;
    generationId: string | null;
    optimisticUser: string | null;
    assistantText: string;
    reasoningText: string;
    error: string | null;
}

const INITIAL_STATE: GenerationState = {
    streaming: false,
    action: null,
    generationId: null,
    optimisticUser: null,
    assistantText: '',
    reasoningText: '',
    error: null,
};

export function useGeneration(characterId: string | null, chatId: string | null, onDone?: () => void) {
    const queryClient = useQueryClient();
    const [state, setState] = useState<GenerationState>(INITIAL_STATE);
    const stateRef = useRef(state);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const invalidateChat = useCallback(async () => {
        if (!characterId || !chatId) {
            return;
        }
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.chat(characterId, chatId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) }),
        ]);
    }, [characterId, chatId, queryClient]);

    const finish = useCallback(async () => {
        await invalidateChat();
        setState((current) => ({
            ...current,
            streaming: false,
            action: null,
            generationId: null,
            optimisticUser: null,
            assistantText: '',
            reasoningText: '',
        }));
        onDone?.();
    }, [invalidateChat, onDone]);

    const finishWithError = useCallback(
        async (message: string) => {
            await invalidateChat();
            setState((current) => ({
                ...current,
                streaming: false,
                action: null,
                generationId: null,
                optimisticUser: null,
                assistantText: '',
                reasoningText: '',
                error: message,
            }));
        },
        [invalidateChat],
    );

    const start = useCallback(
        async (action: GenerateAction, message?: string) => {
            if (!characterId || !chatId || abortRef.current) {
                return;
            }

            setState({
                streaming: true,
                action,
                generationId: null,
                optimisticUser: action === 'send' ? (message ?? null) : null,
                assistantText: '',
                reasoningText: '',
                error: null,
            });

            const controller = new AbortController();
            abortRef.current = controller;
            let hadError = false;

            try {
                await streamGeneration(
                    {
                        characterId,
                        chatId,
                        action,
                        ...(message !== undefined ? { message } : {}),
                    },
                    {
                        onStart: (generationId) => setState((current) => ({ ...current, generationId })),
                        onToken: (text) =>
                            setState((current) => ({
                                ...current,
                                assistantText: current.assistantText + text,
                            })),
                        onReasoning: (text) =>
                            setState((current) => ({
                                ...current,
                                reasoningText: current.reasoningText + text,
                            })),
                        onDone: () => {
                            void finish();
                        },
                        onError: (errorMessage) => {
                            hadError = true;
                            setState((current) => ({ ...current, error: errorMessage }));
                            void finishWithError(errorMessage);
                        },
                    },
                    controller.signal,
                );
            } catch (error) {
                if ((error as DOMException).name === 'AbortError') {
                    // The server may still be persisting a partial reply.
                    window.setTimeout(() => {
                        void finish();
                    }, 400);
                } else {
                    hadError = true;
                    const messageText = error instanceof Error ? error.message : 'Generation failed';
                    setState((current) => ({ ...current, error: messageText }));
                    void finishWithError(messageText);
                }
            } finally {
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
                if (!hadError) {
                    setState((current) => ({ ...current, streaming: false }));
                }
            }
        },
        [characterId, chatId, finish, finishWithError],
    );

    const stop = useCallback(async () => {
        const current = stateRef.current;
        if (current.generationId) {
            const generationId = current.generationId;
            try {
                await api.generate.stop(generationId);
            } catch {
                // Ignore: the generation may already have finished.
            }
            window.setTimeout(() => {
                if (stateRef.current.streaming && stateRef.current.generationId === generationId) {
                    abortRef.current?.abort();
                }
            }, 5000);
        } else {
            abortRef.current?.abort();
        }
    }, []);

    const clearError = useCallback(() => {
        setState((current) => ({ ...current, error: null }));
    }, []);

    // biome-ignore lint/correctness/useExhaustiveDependencies: switching character or chat must reset generation state
    useEffect(() => {
        setState(INITIAL_STATE);
        return () => {
            abortRef.current?.abort();
        };
    }, [characterId, chatId]);

    return {
        ...state,
        start,
        stop,
        clearError,
        busy: state.streaming,
    };
}
