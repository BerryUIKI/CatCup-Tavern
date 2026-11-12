import { splitSpeechText } from '@catcup/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { useSettings } from './data';

export interface SystemVoice {
    /** voiceURI, which is what the settings store. */
    id: string;
    name: string;
    lang: string;
}

/** Browser speech-synthesis voices; empty until the browser reports them. */
export function useSystemVoices(): SystemVoice[] {
    const [voices, setVoices] = useState<SystemVoice[]>([]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
            return;
        }
        const load = () => {
            setVoices(
                window.speechSynthesis.getVoices().map((voice) => ({
                    id: voice.voiceURI || voice.name,
                    name: voice.name,
                    lang: voice.lang,
                })),
            );
        };
        load();
        window.speechSynthesis.addEventListener('voiceschanged', load);
        return () => {
            window.speechSynthesis.removeEventListener('voiceschanged', load);
        };
    }, []);

    return voices;
}

/**
 * Play a message through the configured backend.
 *
 * System speech is chunked small because Chrome mishandles long utterances;
 * the remote endpoint is chunked under OpenAI's input limit and played in
 * order. `speakingKey` is the message key the caller passed to `speak`.
 */
export function useTts() {
    const settings = useSettings().data?.tts;
    const enabled = settings?.enabled ?? false;
    const pushToast = useAppStore((state) => state.pushToast);
    const [speakingKey, setSpeakingKey] = useState<string | null>(null);
    const runRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    /** Resolves a pending audio-playback promise when playback is stopped. */
    const stopPlaybackRef = useRef<(() => void) | null>(null);

    const stop = useCallback(() => {
        runRef.current += 1;
        abortRef.current?.abort();
        abortRef.current = null;
        stopPlaybackRef.current?.();
        stopPlaybackRef.current = null;
        const audio = audioRef.current;
        audioRef.current = null;
        if (audio) {
            audio.pause();
            audio.src = '';
        }
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
        setSpeakingKey(null);
    }, []);

    // A navigated-away chat should not keep talking.
    useEffect(() => () => stop(), [stop]);

    // Turning the feature off should silence whatever is playing.
    useEffect(() => {
        if (!enabled) {
            stop();
        }
    }, [enabled, stop]);

    const speakSystem = useCallback(
        async (text: string, voiceId: string, runId: number) => {
            if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
                throw new Error('This browser does not support speech synthesis.');
            }
            const synth = window.speechSynthesis;
            synth.cancel();
            // Chrome can drop an utterance queued in the same task as a
            // cancel; ST defers its speak call for the same reason.
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            if (runId !== runRef.current) {
                return;
            }
            const voice = synth.getVoices().find((item) => item.voiceURI === voiceId || item.name === voiceId);
            const chunks = splitSpeechText(text, 180);

            for (const chunk of chunks) {
                if (runId !== runRef.current) {
                    return;
                }
                await new Promise<void>((resolve, reject) => {
                    const utterance = new SpeechSynthesisUtterance(chunk);
                    if (voice) {
                        utterance.voice = voice;
                    }
                    utterance.rate = settings?.rate ?? 1;
                    utterance.pitch = settings?.pitch ?? 1;
                    let settled = false;
                    let timer = 0;
                    const finish = (error?: Error) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        window.clearTimeout(timer);
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    };
                    utterance.onend = () => finish();
                    utterance.onerror = (event) => {
                        if (event.error === 'canceled' || event.error === 'interrupted') {
                            finish();
                        } else {
                            finish(new Error(`Speech synthesis failed: ${event.error}`));
                        }
                    };
                    // A speech engine that never reports end must not leave the
                    // Stop button stuck on; cancel and move on.
                    timer = window.setTimeout(
                        () => {
                            synth.cancel();
                            finish();
                        },
                        Math.max(5000, chunk.length * 120),
                    );
                    synth.speak(utterance);
                });
            }
        },
        [settings?.rate, settings?.pitch],
    );

    const speakRemote = useCallback(async (text: string, voiceId: string, runId: number) => {
        const controller = new AbortController();
        abortRef.current = controller;
        const chunks = splitSpeechText(text, 3500);

        for (const chunk of chunks) {
            if (runId !== runRef.current) {
                return;
            }
            const blob = await api.tts.speak(chunk, voiceId, controller.signal);
            if (runId !== runRef.current) {
                return;
            }
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audioRef.current = audio;
            try {
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const finish = () => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        stopPlaybackRef.current = null;
                        resolve();
                    };
                    stopPlaybackRef.current = finish;
                    audio.onended = finish;
                    audio.onerror = () => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        stopPlaybackRef.current = null;
                        reject(new Error('The generated audio could not be played.'));
                    };
                    audio.play().catch((error: unknown) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        stopPlaybackRef.current = null;
                        reject(error instanceof Error ? error : new Error('The generated audio could not be played.'));
                    });
                });
            } finally {
                URL.revokeObjectURL(url);
                if (audioRef.current === audio) {
                    audioRef.current = null;
                }
            }
        }
    }, []);

    const speak = useCallback(
        async (key: string, text: string, voiceId: string) => {
            if (!settings?.enabled) {
                return;
            }
            const content = text.trim();
            if (!content) {
                return;
            }
            stop();
            const runId = runRef.current;
            setSpeakingKey(key);
            try {
                if (settings.backend === 'system') {
                    await speakSystem(content, voiceId, runId);
                } else {
                    await speakRemote(content, voiceId, runId);
                }
            } catch (error) {
                if (runId !== runRef.current) {
                    return;
                }
                if ((error as DOMException).name === 'AbortError') {
                    return;
                }
                if ((error as DOMException).name === 'NotAllowedError') {
                    pushToast('The browser blocked audio playback. Press play on the message.', 'info');
                    return;
                }
                pushToast(error instanceof Error ? error.message : 'Could not play the voice.', 'error');
            } finally {
                if (runId === runRef.current) {
                    setSpeakingKey(null);
                }
            }
        },
        [settings, stop, speakSystem, speakRemote, pushToast],
    );

    const voiceFor = useCallback(
        (characterId: string | null | undefined, narrator = false) => {
            if (!settings) {
                return '';
            }
            if (narrator) {
                return settings.narratorVoice || settings.voice;
            }
            return (characterId ? settings.characterVoices[characterId] : '') || settings.voice;
        },
        [settings],
    );

    return {
        enabled,
        autoplay: settings?.autoplay ?? false,
        settings,
        speakingKey,
        speak,
        stop,
        voiceFor,
    };
}
