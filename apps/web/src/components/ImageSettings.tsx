import { type ImageBackend, type ImageGenerationSettings, imageGenerationSettingsSchema } from '@catcup/shared';
import { Save, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSettings, useUpdateSettings } from '../hooks/data';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

const BACKEND_DEFAULTS: Record<ImageBackend, string> = {
    automatic1111: 'http://127.0.0.1:7860',
    'openai-compatible': 'https://api.openai.com/v1',
};

const SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ 2M Karras', 'DDIM', 'UniPC'];

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function NumberField({
    id,
    label,
    value,
    min,
    max,
    step,
    hint,
    onChange,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    hint?: string;
    onChange: (value: number) => void;
}) {
    return (
        <div>
            <label className="label-text" htmlFor={id}>
                {label}
            </label>
            <input
                id={id}
                type="number"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="input-shell"
            />
            {hint ? <p className="mt-1 text-[11px] leading-relaxed text-muted/70">{hint}</p> : null}
        </div>
    );
}

/**
 * Image generation settings.
 *
 * The API key is write-only: the form only knows whether one is stored. A1111
 * takes `user:password` for HTTP Basic auth; OpenAI-compatible endpoints take
 * a bearer token.
 */
export function ImageSettings() {
    const settingsQuery = useSettings();
    const settings = settingsQuery.data;
    const updateSettings = useUpdateSettings();
    const pushToast = useAppStore((state) => state.pushToast);

    const [form, setForm] = useState<ImageGenerationSettings>(() => ({
        ...(settings?.imageGeneration ?? imageGenerationSettingsSchema.parse({})),
    }));
    const [apiKey, setApiKey] = useState('');
    const [removeKey, setRemoveKey] = useState(false);
    const [testing, setTesting] = useState(false);
    const editedRef = useRef(false);

    useEffect(() => {
        if (!settings?.imageGeneration || editedRef.current) {
            return;
        }
        setForm({ ...settings.imageGeneration });
    }, [settings?.imageGeneration]);

    const set = <Key extends keyof ImageGenerationSettings>(key: Key, value: ImageGenerationSettings[Key]) => {
        editedRef.current = true;
        setForm((current) => ({ ...current, [key]: value }));
    };

    const changeBackend = (backend: ImageBackend) => {
        editedRef.current = true;
        setForm((current) => {
            const currentDefault = BACKEND_DEFAULTS[current.backend];
            const nextDefault = BACKEND_DEFAULTS[backend];
            const baseUrl =
                !current.baseUrl.trim() || current.baseUrl.trim() === currentDefault ? nextDefault : current.baseUrl;
            return { ...current, backend, baseUrl };
        });
    };

    const payload = () => ({
        imageGeneration: form,
        ...(removeKey ? { imageApiKey: '' } : apiKey.trim() ? { imageApiKey: apiKey.trim() } : {}),
    });

    const validate = (): string | null => {
        if (form.width < 64 || form.width > 2048 || form.height < 64 || form.height > 2048) {
            return 'Width and height must be between 64 and 2048.';
        }
        if (!Number.isInteger(form.width) || !Number.isInteger(form.height)) {
            return 'Width and height must be whole numbers.';
        }
        if (form.steps < 1 || form.steps > 150) {
            return 'Steps must be between 1 and 150.';
        }
        if (form.cfgScale < 1 || form.cfgScale > 30) {
            return 'CFG scale must be between 1 and 30.';
        }
        if (form.seed < -1 || form.seed > 2 ** 32 - 1) {
            return 'Seed must be -1 or a 32-bit non-negative integer.';
        }
        if (form.contextMessages < 1 || form.contextMessages > 50) {
            return 'Context messages must be between 1 and 50.';
        }
        if (!form.baseUrl.trim()) {
            return 'The base URL is required.';
        }
        if (form.backend === 'openai-compatible' && !form.model.trim()) {
            return 'The model is required for an OpenAI-compatible endpoint.';
        }
        return null;
    };

    const save = async (test: boolean) => {
        const invalid = validate();
        if (invalid) {
            pushToast(invalid, 'error');
            return;
        }

        try {
            await updateSettings.mutateAsync(payload());
            editedRef.current = false;
            setApiKey('');
            setRemoveKey(false);
            if (test) {
                setTesting(true);
                await api.images.test();
                pushToast('The image backend answered.', 'success');
            } else {
                pushToast('Image generation settings saved.', 'success');
            }
        } catch (error) {
            pushToast(
                errorMessage(error, test ? 'Could not reach the image backend.' : 'Could not save the settings.'),
                'error',
            );
        } finally {
            setTesting(false);
        }
    };

    const hasKey = settings?.imageHasKey ?? false;
    const isOpenAi = form.backend === 'openai-compatible';

    return (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Generate illustrations from the chat with Automatic1111/Forge or any OpenAI-compatible{' '}
                <code>/images/generations</code> endpoint. Images are stored in the character or group gallery and can
                be inserted into the chat.
            </p>

            <label className="flex items-center gap-2 text-sm text-parchment-dim">
                <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => set('enabled', event.target.checked)}
                    className="size-4 accent-amber"
                />
                Enable image generation
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label-text" htmlFor="image-backend">
                        Backend
                    </label>
                    <select
                        id="image-backend"
                        className="input-shell"
                        value={form.backend}
                        onChange={(event) => changeBackend(event.target.value as ImageBackend)}
                    >
                        <option value="automatic1111">Automatic1111 / Forge (local)</option>
                        <option value="openai-compatible">OpenAI-compatible endpoint</option>
                    </select>
                </div>

                <div>
                    <label className="label-text" htmlFor="image-base-url">
                        Base URL
                    </label>
                    <input
                        id="image-base-url"
                        className="input-shell"
                        value={form.baseUrl}
                        onChange={(event) => set('baseUrl', event.target.value)}
                        placeholder={BACKEND_DEFAULTS[form.backend]}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        {isOpenAi
                            ? 'The API root, usually ending in /v1.'
                            : 'The A1111 or Forge root, without /sdapi/v1.'}
                    </p>
                </div>

                <div>
                    <label className="label-text" htmlFor="image-model">
                        Model
                    </label>
                    <input
                        id="image-model"
                        className="input-shell"
                        value={form.model}
                        onChange={(event) => set('model', event.target.value)}
                        placeholder={isOpenAi ? 'gpt-image-1' : 'Optional label'}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        {isOpenAi
                            ? 'Required by the endpoint.'
                            : 'A1111 uses the checkpoint selected in its own interface.'}
                    </p>
                </div>

                <div>
                    <label className="label-text" htmlFor="image-api-key">
                        API key
                    </label>
                    <input
                        id="image-api-key"
                        type="password"
                        className="input-shell"
                        value={apiKey}
                        onChange={(event) => {
                            setApiKey(event.target.value);
                            if (event.target.value) {
                                setRemoveKey(false);
                            }
                        }}
                        placeholder={
                            hasKey ? 'A key is stored — type to replace' : isOpenAi ? 'Bearer token' : 'Optional'
                        }
                        autoComplete="off"
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        {isOpenAi
                            ? 'Sent as a bearer token. Only api.openai.com requires one.'
                            : 'Sent as HTTP Basic credentials, as user:password.'}
                    </p>
                    {hasKey ? (
                        <label className="mt-2 flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                checked={removeKey}
                                onChange={(event) => {
                                    setRemoveKey(event.target.checked);
                                    if (event.target.checked) {
                                        setApiKey('');
                                    }
                                }}
                                className="size-4 accent-amber"
                            />
                            Remove the stored key
                        </label>
                    ) : null}
                </div>

                <NumberField
                    id="image-width"
                    label="Width"
                    value={form.width}
                    min={64}
                    max={2048}
                    step={64}
                    onChange={(value) => set('width', value)}
                />
                <NumberField
                    id="image-height"
                    label="Height"
                    value={form.height}
                    min={64}
                    max={2048}
                    step={64}
                    onChange={(value) => set('height', value)}
                />
            </div>

            {isOpenAi ? null : (
                <div className="grid gap-4 sm:grid-cols-3">
                    <NumberField
                        id="image-steps"
                        label="Steps"
                        value={form.steps}
                        min={1}
                        max={150}
                        onChange={(value) => set('steps', value)}
                    />
                    <NumberField
                        id="image-cfg"
                        label="CFG scale"
                        value={form.cfgScale}
                        min={1}
                        max={30}
                        step={0.1}
                        onChange={(value) => set('cfgScale', value)}
                    />
                    <div>
                        <label className="label-text" htmlFor="image-sampler">
                            Sampler
                        </label>
                        <input
                            id="image-sampler"
                            className="input-shell"
                            list="image-samplers"
                            value={form.sampler}
                            onChange={(event) => set('sampler', event.target.value)}
                        />
                        <datalist id="image-samplers">
                            {SAMPLERS.map((sampler) => (
                                <option key={sampler} value={sampler} />
                            ))}
                        </datalist>
                    </div>
                    <NumberField
                        id="image-seed"
                        label="Seed"
                        value={form.seed}
                        min={-1}
                        max={2 ** 32 - 1}
                        hint="-1 picks a random seed."
                        onChange={(value) => set('seed', value)}
                    />
                </div>
            )}

            <div>
                <label className="label-text" htmlFor="image-prefix">
                    Prompt prefix
                </label>
                <textarea
                    id="image-prefix"
                    className="input-shell min-h-16 w-full resize-y"
                    value={form.promptPrefix}
                    onChange={(event) => set('promptPrefix', event.target.value)}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                    Added before every prompt, after the comma-separated tags.
                </p>
            </div>

            {isOpenAi ? null : (
                <div>
                    <label className="label-text" htmlFor="image-negative">
                        Negative prompt
                    </label>
                    <textarea
                        id="image-negative"
                        className="input-shell min-h-20 w-full resize-y"
                        value={form.negativePrompt}
                        onChange={(event) => set('negativePrompt', event.target.value)}
                    />
                </div>
            )}

            <div>
                <label className="label-text" htmlFor="image-template">
                    Draft-from-chat instruction
                </label>
                <textarea
                    id="image-template"
                    className="input-shell min-h-32 w-full resize-y"
                    value={form.promptTemplate}
                    onChange={(event) => set('promptTemplate', event.target.value)}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                    Sent to the active chat provider when you press “Draft from chat”; it should ask for only visible
                    details.
                </p>
            </div>

            <NumberField
                id="image-context"
                label="Context messages"
                value={form.contextMessages}
                min={1}
                max={50}
                hint="How many recent messages are sent to the chat model when drafting."
                onChange={(value) => set('contextMessages', value)}
            />

            <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void save(true)}
                    disabled={updateSettings.isPending || testing}
                >
                    {testing ? <Spinner size={15} /> : <WandSparkles size={15} />}
                    Save &amp; test
                </button>
                <button
                    type="button"
                    className="btn-primary"
                    onClick={() => void save(false)}
                    disabled={updateSettings.isPending || testing}
                >
                    {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                    Save
                </button>
            </div>
        </div>
    );
}
