import { type TtsSettings as TtsSettingsValue, ttsSettingsSchema } from '@catcup/shared';
import { Save, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useCharacters, useSettings, useUpdateSettings } from '../hooks/data';
import { useSystemVoices } from '../hooks/useTts';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
const FORMATS: TtsSettingsValue['format'][] = ['mp3', 'opus', 'aac', 'flac', 'wav'];
const PREVIEW = 'The lantern is lit. This is how this voice sounds.';

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/** Speak a short preview without touching the saved playback state. */
async function previewSystem(form: TtsSettingsValue): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        throw new Error('This browser does not support speech synthesis.');
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    const voice = synth.getVoices().find((item) => item.voiceURI === form.voice || item.name === form.voice);
    await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(PREVIEW);
        if (voice) {
            utterance.voice = voice;
        }
        utterance.rate = form.rate;
        utterance.pitch = form.pitch;
        utterance.onend = () => resolve();
        utterance.onerror = (event) => {
            if (event.error === 'canceled' || event.error === 'interrupted') {
                resolve();
            } else {
                reject(new Error(`Speech synthesis failed: ${event.error}`));
            }
        };
        synth.speak(utterance);
    });
}

async function previewRemote(form: TtsSettingsValue, audioRef?: { current: HTMLAudioElement | null }): Promise<void> {
    const blob = await api.tts.speak(PREVIEW, form.voice);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    if (audioRef) {
        audioRef.current = audio;
    }
    try {
        await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error('The generated audio could not be played.'));
            audio.play().catch(reject);
        });
    } finally {
        URL.revokeObjectURL(url);
        if (audioRef && audioRef.current === audio) {
            audioRef.current = null;
        }
    }
}

/**
 * Text-to-speech settings.
 *
 * The API key is write-only: the form shows whether one is stored, accepts a
 * replacement, and never receives the saved value. "Save & test" persists the
 * form first because the server speaks with the stored configuration.
 */
export function TtsSettings() {
    const settingsQuery = useSettings();
    const settings = settingsQuery.data;
    const updateSettings = useUpdateSettings();
    const characters = useCharacters().data ?? [];
    const pushToast = useAppStore((state) => state.pushToast);
    const voices = useSystemVoices();

    const [form, setForm] = useState<TtsSettingsValue>(() => ({
        ...(settings?.tts ?? ttsSettingsSchema.parse({})),
    }));
    const [apiKey, setApiKey] = useState('');
    const [removeKey, setRemoveKey] = useState(false);
    const [previewing, setPreviewing] = useState(false);
    const previewAudioRef = useRef<HTMLAudioElement | null>(null);
    const editedRef = useRef(false);

    // Leaving the tab or dialog must not leave the test voice talking.
    useEffect(
        () => () => {
            const audio = previewAudioRef.current;
            previewAudioRef.current = null;
            if (audio) {
                audio.pause();
                audio.src = '';
            }
        },
        [],
    );

    useEffect(() => {
        if (!settings?.tts || editedRef.current) {
            return;
        }
        setForm({ ...settings.tts });
    }, [settings?.tts]);

    const set = <Key extends keyof TtsSettingsValue>(key: Key, value: TtsSettingsValue[Key]) => {
        editedRef.current = true;
        setForm((current) => ({ ...current, [key]: value }));
    };

    const setCharacterVoice = (characterId: string, value: string) => {
        editedRef.current = true;
        setForm((current) => {
            const next = { ...current.characterVoices };
            if (value.trim()) {
                next[characterId] = value.trim();
            } else {
                delete next[characterId];
            }
            return { ...current, characterVoices: next };
        });
    };

    const payload = () => ({
        tts: form,
        // The key controls only exist for the remote backend; a hidden control
        // must not change the stored key.
        ...(form.backend === 'openai-compatible'
            ? removeKey
                ? { ttsApiKey: '' }
                : apiKey.trim()
                  ? { ttsApiKey: apiKey.trim() }
                  : {}
            : {}),
    });

    const validateForm = (): string | null => {
        if (!Number.isFinite(form.speed) || form.speed < 0.25 || form.speed > 4) {
            return 'Speed must be between 0.25 and 4.';
        }
        if (!Number.isFinite(form.rate) || form.rate < 0.1 || form.rate > 2) {
            return 'Rate must be between 0.1 and 2.';
        }
        if (!Number.isFinite(form.pitch) || form.pitch < 0 || form.pitch > 2) {
            return 'Pitch must be between 0 and 2.';
        }
        return null;
    };

    const handleSave = () => {
        const invalid = validateForm();
        if (invalid) {
            pushToast(invalid, 'error');
            return;
        }
        updateSettings.mutate(payload(), {
            onSuccess: () => {
                editedRef.current = false;
                setApiKey('');
                setRemoveKey(false);
                pushToast('Text-to-speech settings saved.', 'success');
            },
            onError: (error) => pushToast(errorMessage(error, 'Could not save the TTS settings.'), 'error'),
        });
    };

    const handleTest = async () => {
        if (!form.enabled) {
            pushToast('Enable text to speech before testing a voice.', 'info');
            return;
        }
        const invalid = validateForm();
        if (invalid) {
            pushToast(invalid, 'error');
            return;
        }
        setPreviewing(true);
        try {
            await updateSettings.mutateAsync(payload());
            editedRef.current = false;
            setApiKey('');
            setRemoveKey(false);
            if (form.backend === 'system') {
                await previewSystem(form);
            } else {
                await previewRemote(form, previewAudioRef);
            }
        } catch (error) {
            pushToast(errorMessage(error, 'Could not play the test voice.'), 'error');
        } finally {
            setPreviewing(false);
        }
    };

    const hasKey = settings?.ttsHasKey ?? false;
    const systemVoices = form.backend === 'system';
    const speechAvailable = typeof window !== 'undefined' && 'speechSynthesis' in window;
    /** A saved voice from the other backend, kept visible instead of silently showing Default. */
    const unknownVoiceOption = (value: string) =>
        value && !voices.some((voice) => voice.id === value) ? (
            <option value={value}>{value} (not in this browser)</option>
        ) : null;

    return (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Speak character replies with the browser&apos;s own voices or an OpenAI-compatible{' '}
                <code>/audio/speech</code> endpoint. A play button appears on every reply, and autoplay follows new
                replies when it is enabled.
            </p>

            <label className="flex items-center gap-2 text-sm text-parchment-dim">
                <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => set('enabled', event.target.checked)}
                    className="size-4 accent-amber"
                />
                Enable text to speech
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label-text" htmlFor="tts-backend">
                        Backend
                    </label>
                    <select
                        id="tts-backend"
                        className="input-shell"
                        value={form.backend}
                        onChange={(event) => set('backend', event.target.value as TtsSettingsValue['backend'])}
                    >
                        <option value="system">Browser voices (local)</option>
                        <option value="openai-compatible">OpenAI-compatible endpoint</option>
                    </select>
                </div>
                <div>
                    <label className="label-text" htmlFor="tts-autoplay">
                        Autoplay
                    </label>
                    <label className="input-shell flex h-10 items-center gap-2">
                        <input
                            id="tts-autoplay"
                            type="checkbox"
                            checked={form.autoplay}
                            onChange={(event) => set('autoplay', event.target.checked)}
                            className="size-4 accent-amber"
                        />
                        <span className="text-sm text-parchment-dim">Speak each new reply</span>
                    </label>
                </div>
            </div>

            {systemVoices && !speechAvailable ? (
                <p className="text-xs text-amber">
                    This browser does not support speech synthesis. Use the OpenAI-compatible backend or a browser that
                    does.
                </p>
            ) : null}

            {systemVoices ? (
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label className="label-text" htmlFor="tts-system-voice">
                            Default voice
                        </label>
                        <select
                            id="tts-system-voice"
                            className="input-shell"
                            value={form.voice}
                            onChange={(event) => set('voice', event.target.value)}
                        >
                            <option value="">Browser default</option>
                            {unknownVoiceOption(form.voice)}
                            {voices.map((voice) => (
                                <option key={voice.id} value={voice.id}>
                                    {voice.name} ({voice.lang})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="label-text" htmlFor="tts-rate">
                                Rate
                            </label>
                            <input
                                id="tts-rate"
                                type="number"
                                min={0.1}
                                max={2}
                                step={0.05}
                                className="input-shell"
                                value={form.rate}
                                onChange={(event) => set('rate', Number(event.target.value))}
                            />
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-pitch">
                                Pitch
                            </label>
                            <input
                                id="tts-pitch"
                                type="number"
                                min={0}
                                max={2}
                                step={0.05}
                                className="input-shell"
                                value={form.pitch}
                                onChange={(event) => set('pitch', Number(event.target.value))}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-4 rounded-xl border border-line-soft bg-surface/40 p-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="label-text" htmlFor="tts-base-url">
                                Base URL
                            </label>
                            <input
                                id="tts-base-url"
                                className="input-shell"
                                value={form.baseUrl}
                                maxLength={500}
                                onChange={(event) => set('baseUrl', event.target.value)}
                            />
                            <p className="mt-1 text-[11px] text-muted">
                                OpenAI, or a local server exposing <code>/audio/speech</code>.
                            </p>
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-model">
                                Model
                            </label>
                            <input
                                id="tts-model"
                                className="input-shell"
                                value={form.model}
                                maxLength={200}
                                onChange={(event) => set('model', event.target.value)}
                            />
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-voice">
                                Default voice
                            </label>
                            <input
                                id="tts-voice"
                                className="input-shell"
                                list="tts-voice-options"
                                value={form.voice}
                                maxLength={200}
                                placeholder="Default (alloy)"
                                onChange={(event) => set('voice', event.target.value)}
                            />
                            <datalist id="tts-voice-options">
                                {OPENAI_VOICES.map((voice) => (
                                    <option key={voice} value={voice} />
                                ))}
                            </datalist>
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-format">
                                Audio format
                            </label>
                            <select
                                id="tts-format"
                                className="input-shell"
                                value={form.format}
                                onChange={(event) => set('format', event.target.value as TtsSettingsValue['format'])}
                            >
                                {FORMATS.map((format) => (
                                    <option key={format} value={format}>
                                        {format}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-speed">
                                Speed
                            </label>
                            <input
                                id="tts-speed"
                                type="number"
                                min={0.25}
                                max={4}
                                step={0.05}
                                className="input-shell"
                                value={form.speed}
                                onChange={(event) => set('speed', Number(event.target.value))}
                            />
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-key">
                                API key
                            </label>
                            <input
                                id="tts-key"
                                type="password"
                                className="input-shell"
                                autoComplete="off"
                                placeholder={hasKey ? 'A key is saved; enter a new one to replace it' : 'API key'}
                                value={apiKey}
                                onChange={(event) => {
                                    editedRef.current = true;
                                    setApiKey(event.target.value);
                                    if (event.target.value) {
                                        setRemoveKey(false);
                                    }
                                }}
                            />
                            {hasKey ? (
                                <label className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                                    <input
                                        type="checkbox"
                                        checked={removeKey}
                                        onChange={(event) => {
                                            editedRef.current = true;
                                            setRemoveKey(event.target.checked);
                                            if (event.target.checked) {
                                                setApiKey('');
                                            }
                                        }}
                                        className="size-3.5 accent-amber"
                                    />
                                    Remove the saved key
                                </label>
                            ) : (
                                <p className="mt-1 text-[11px] text-muted">
                                    Stored in <code>data/secrets.json</code>; the browser only learns whether one is
                                    set.
                                </p>
                            )}
                        </div>
                    </div>
                    <div>
                        <label className="label-text" htmlFor="tts-instructions">
                            Voice instructions (optional)
                        </label>
                        <textarea
                            id="tts-instructions"
                            className="input-shell min-h-20 resize-y"
                            value={form.instructions}
                            maxLength={2000}
                            placeholder="e.g. Speak with a warm, unhurried tone."
                            onChange={(event) => set('instructions', event.target.value)}
                        />
                        <p className="mt-1 text-[11px] text-muted">
                            Sent only to models that support it, such as <code>gpt-4o-mini-tts</code>.
                        </p>
                    </div>
                </div>
            )}

            <div className="border-t border-line-soft pt-4">
                <label className="label-text" htmlFor="tts-narrator-voice">
                    Narrator voice
                </label>
                {systemVoices ? (
                    <select
                        id="tts-narrator-voice"
                        className="input-shell"
                        value={form.narratorVoice}
                        onChange={(event) => set('narratorVoice', event.target.value)}
                    >
                        <option value="">Use the default voice</option>
                        {unknownVoiceOption(form.narratorVoice)}
                        {voices.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                                {voice.name} ({voice.lang})
                            </option>
                        ))}
                    </select>
                ) : (
                    <input
                        id="tts-narrator-voice"
                        className="input-shell"
                        list="tts-voice-options"
                        value={form.narratorVoice}
                        maxLength={200}
                        placeholder="Default voice"
                        onChange={(event) => set('narratorVoice', event.target.value)}
                    />
                )}
                <p className="mt-1 text-[11px] text-muted">Used for narrator notes from a quick reply.</p>
            </div>

            <div>
                <div className="flex items-center justify-between">
                    <span className="label-text mb-0">Character voices</span>
                    <span className="text-[11px] text-muted">Empty uses the default voice.</span>
                </div>
                <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-line-soft bg-surface/30 p-2">
                    {characters.length === 0 ? (
                        <p className="p-2 text-xs text-muted">No characters in the library yet.</p>
                    ) : null}
                    {characters.map((character) => (
                        <div key={character.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-parchment-dim">{character.name}</span>
                            {systemVoices ? (
                                <select
                                    className="input-shell h-8 w-56 py-1 text-xs"
                                    value={form.characterVoices[character.id] ?? ''}
                                    onChange={(event) => setCharacterVoice(character.id, event.target.value)}
                                    aria-label={`Voice for ${character.name}`}
                                >
                                    <option value="">Default voice</option>
                                    {unknownVoiceOption(form.characterVoices[character.id] ?? '')}
                                    {voices.map((voice) => (
                                        <option key={voice.id} value={voice.id}>
                                            {voice.name} ({voice.lang})
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    className="input-shell h-8 w-56 py-1 text-xs"
                                    list="tts-voice-options"
                                    value={form.characterVoices[character.id] ?? ''}
                                    maxLength={200}
                                    placeholder={form.voice ? `Default (${form.voice})` : 'Default (alloy)'}
                                    onChange={(event) => setCharacterVoice(character.id, event.target.value)}
                                    aria-label={`Voice for ${character.name}`}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="border-t border-line-soft pt-4">
                <span className="label-text mb-0">Text preparation</span>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm text-parchment-dim">
                        <input
                            type="checkbox"
                            checked={form.skipCodeBlocks}
                            onChange={(event) => set('skipCodeBlocks', event.target.checked)}
                            className="size-4 accent-amber"
                        />
                        Skip code blocks
                    </label>
                    <label className="flex items-center gap-2 text-sm text-parchment-dim">
                        <input
                            type="checkbox"
                            checked={form.stripTags}
                            onChange={(event) => set('stripTags', event.target.checked)}
                            className="size-4 accent-amber"
                        />
                        Strip formatting tags
                    </label>
                    <label className="flex items-center gap-2 text-sm text-parchment-dim">
                        <input
                            type="checkbox"
                            checked={form.stripAsterisks}
                            onChange={(event) => set('stripAsterisks', event.target.checked)}
                            className="size-4 accent-amber"
                        />
                        Remove asterisks
                    </label>
                </div>
            </div>

            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void handleTest()}
                    disabled={updateSettings.isPending || previewing}
                >
                    {previewing ? <Spinner size={15} /> : <Volume2 size={15} />}
                    Save &amp; test
                </button>
                <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={updateSettings.isPending || previewing}
                >
                    {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                    Save TTS settings
                </button>
            </div>
        </div>
    );
}
