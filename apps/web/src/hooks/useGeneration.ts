import type { GenerateAction, GenerationSpeaker } from '@catcup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { streamGeneration } from '../lib/sse';
import { queryKeys } from './data';

/** Who the generation belongs to: one character chat, or one group chat. */
export type GenerationTarget = { kind: 'character'; characterId: string } | { kind: 'group'; groupId: string };

interface GenerationState {
    streaming: boolean;
    action: GenerateAction | null;
    generationId: string | null;
    optimisticUser: string | null;
    assistantText: string;
    reasoningText: string;
    /** The member the server chose to speak, for group chats. */
    speaker: GenerationSpeaker | null;
    error: string | null;
}

const INITIAL_STATE: GenerationState = {
    streaming: false,
    action: null,
    generationId: null,
    optimisticUser: null,
    assistantText: '',
    reasoningText: '',
    speaker: null,
    error: null,
};

export function useGeneration(target: GenerationTarget | null, chatId: string | null, onDone?: () => void) {
    const queryClient = useQueryClient();
    const [state, setState] = useState<GenerationState>(INITIAL_STATE);
    const stateRef = useRef(state);
    const abortRef = useRef<AbortController | null>(null);

    const targetKind = target?.kind ?? null;
    const targetId = target ? (target.kind === 'character' ? target.characterId : target.groupId) : null;

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const invalidateChat = useCallback(async () => {
        if (!targetKind || !targetId || !chatId) {
            return;
        }
        if (targetKind === 'character') {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.chat(targetId, chatId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.chats(targetId) }),
            ]);
            return;
        }
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.groupChat(targetId, chatId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(targetId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
        ]);
    }, [targetKind, targetId, chatId, queryClient]);

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
            speaker: null,
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
                speaker: null,
                error: message,
            }));
        },
        [invalidateChat],
    );

    const start = useCallback(
        async (action: GenerateAction, message?: string, speaker?: string) => {
            if (!targetKind || !targetId || !chatId || abortRef.current) {
                return;
            }

            setState({
                streaming: true,
                action,
                generationId: null,
                optimisticUser: action === 'send' ? (message ?? null) : null,
                assistantText: '',
                reasoningText: '',
                speaker: null,
                error: null,
            });

            const controller = new AbortController();
            abortRef.current = controller;
            let hadError = false;

            const path =
                targetKind === 'character'
                    ? '/api/generate'
                    : `/api/groups/${encodeURIComponent(targetId)}/chats/${encodeURIComponent(chatId)}/generate`;
            const body =
                targetKind === 'character'
                    ? {
                          characterId: targetId,
                          chatId,
                          action,
                          ...(message !== undefined ? { message } : {}),
                      }
                    : {
                          action,
                          ...(message !== undefined ? { message } : {}),
                          ...(speaker ? { speaker } : {}),
                      };

            try {
                await streamGeneration(
                    path,
                    body,
                    {
                        onStart: (generationId, selectedSpeaker) =>
                            setState((current) => ({
                                ...current,
                                generationId,
                                speaker: selectedSpeaker ?? null,
                            })),
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
        [targetKind, targetId, chatId, finish, finishWithError],
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

    // Switching character, group or chat must reset generation state.
    // biome-ignore lint/correctness/useExhaustiveDependencies: the target identity is captured by kind and id
    useEffect(() => {
        setState(INITIAL_STATE);
        return () => {
            abortRef.current?.abort();
        };
    }, [targetKind, targetId, chatId]);

    return {
        ...state,
        start,
        stop,
        clearError,
        busy: state.streaming,
    };
}
