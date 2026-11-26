import { type TtsSettings as TtsSettingsValue, ttsSettingsSchema } from '@catcup/shared';
import { Save, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useCharacters, useSettings, useUpdateSettings } from '../hooks/data';
import { useSystemVoices } from '../hooks/useTts';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Combobox } from './Combobox';
import { Select } from './Select';
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

    /**
     * The voice rows, with a saved voice this browser does not list kept visible.
     *
     * Without it, a voice stored by another browser would silently read as
     * "Default" and be overwritten on the next save.
     */
    const voiceOptions = (value: string, emptyLabel: string) => [
        { value: '', label: emptyLabel },
        ...(value && !voices.some((voice) => voice.id === value)
            ? [{ value, label: `${value} (not in this browser)` }]
            : []),
        ...voices.map((voice) => ({ value: voice.id, label: `${voice.name} (${voice.lang})` })),
    ];

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
                    <Select<string>
                        id="tts-backend"
                        label="Backend"
                        value={form.backend}
                        onChange={(value) => set('backend', value as TtsSettingsValue['backend'])}
                        options={[
                            { value: 'system', label: 'Browser voices (local)' },
                            { value: 'openai-compatible', label: 'OpenAI-compatible endpoint' },
                        ]}
                    />
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
                        <Select<string>
                            id="tts-system-voice"
                            label="Default voice"
                            value={form.voice}
                            onChange={(value) => set('voice', value)}
                            options={voiceOptions(form.voice, 'Browser default')}
                        />
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
                            <p className="mt-1 text-footnote text-muted">
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
                            <Combobox
                                id="tts-voice"
                                value={form.voice}
                                onChange={(value) => set('voice', value)}
                                maxLength={200}
                                placeholder="Default (alloy)"
                                options={OPENAI_VOICES.map((voice) => ({ value: voice }))}
                                emptyHint="A voice name the list does not carry can still be typed."
                            />
                        </div>
                        <div>
                            <label className="label-text" htmlFor="tts-format">
                                Audio format
                            </label>
                            <Select<string>
                                id="tts-format"
                                label="Audio format"
                                value={form.format}
                                onChange={(value) => set('format', value as TtsSettingsValue['format'])}
                                options={FORMATS.map((format) => ({ value: format, label: format }))}
                            />
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
                                <label className="mt-1 flex items-center gap-2 text-footnote text-muted">
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
                                <p className="mt-1 text-footnote text-muted">
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
                        <p className="mt-1 text-footnote text-muted">
                            Sent only to models that support it, such as <code>gpt-4o-mini-tts</code>.
                        </p>
                    </div>
                </div>
            )}

            <div className="border-t border-line-soft pt-4">
                {systemVoices ? (
                    <Select<string>
                        id="tts-narrator-voice"
                        label="Narrator voice"
                        value={form.narratorVoice}
                        onChange={(value) => set('narratorVoice', value)}
                        options={voiceOptions(form.narratorVoice, 'Use the default voice')}
                    />
                ) : (
                    <Combobox
                        id="tts-narrator-voice"
                        value={form.narratorVoice}
                        onChange={(value) => set('narratorVoice', value)}
                        maxLength={200}
                        placeholder="Default voice"
                        options={OPENAI_VOICES.map((voice) => ({ value: voice }))}
                        emptyHint="A voice name the list does not carry can still be typed."
                    />
                )}
                <p className="mt-1 text-footnote text-muted">Used for narrator notes from a quick reply.</p>
            </div>

            <div>
                <div className="flex items-center justify-between">
                    <span className="label-text mb-0">Character voices</span>
                    <span className="text-footnote text-muted">Empty uses the default voice.</span>
                </div>
                <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-line-soft bg-surface/30 p-2">
                    {characters.length === 0 ? (
                        <p className="p-2 text-xs text-muted">No characters in the library yet.</p>
                    ) : null}
                    {characters.map((character) => (
                        <div key={character.id} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-sm text-parchment-dim">{character.name}</span>
                            {systemVoices ? (
                                <Select<string>
                                    label={`Voice for ${character.name}`}
                                    hideLabel
                                    size="sm"
                                    className="w-56"
                                    value={form.characterVoices[character.id] ?? ''}
                                    onChange={(value) => setCharacterVoice(character.id, value)}
                                    options={voiceOptions(form.characterVoices[character.id] ?? '', 'Default voice')}
                                />
                            ) : (
                                <div className="w-56">
                                    <Combobox
                                        value={form.characterVoices[character.id] ?? ''}
                                        onChange={(value) => setCharacterVoice(character.id, value)}
                                        maxLength={200}
                                        placeholder={form.voice ? `Default (${form.voice})` : 'Default (alloy)'}
                                        options={OPENAI_VOICES.map((voice) => ({ value: voice }))}
                                        emptyHint="A voice name the list does not carry can still be typed."
                                    />
                                </div>
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
