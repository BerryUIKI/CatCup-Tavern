import { type ImageBackend, type ImageGenerationSettings, imageGenerationSettingsSchema } from '@catcup/shared';
import { Save, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useSettings, useUpdateSettings } from '../hooks/data';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

const BACKEND_DEFAULTS: Record<ImageBackend, string> = {
    automatic1111: 'http://127.0.0.1:7860',
    comfyui: 'http://127.0.0.1:8188',
    'openai-compatible': 'https://api.openai.com/v1',
};

const SAMPLERS = ['Euler a', 'Euler', 'DPM++ 2M', 'DPM++ 2M Karras', 'DDIM', 'UniPC'];

const COMFY_SAMPLERS = [
    'euler',
    'euler_ancestral',
    'heun',
    'dpm_2',
    'dpm_2_ancestral',
    'lms',
    'dpmpp_2s_ancestral',
    'dpmpp_sde',
    'dpmpp_2m',
    'dpmpp_2m_sde',
    'dpmpp_3m_sde',
    'ddpm',
    'lcm',
    'ddim',
    'uni_pc',
];

const SCHEDULERS = ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta'];

const PLACEHOLDER_NAMES = [
    'prompt',
    'negative_prompt',
    'seed',
    'width',
    'height',
    'steps',
    'scale',
    'sampler',
    'scheduler',
    'model',
];

function collectWorkflowPlaceholders(value: unknown, found: Set<string>): void {
    if (typeof value === 'string') {
        const match = /^%([a-z_]+)%$/.exec(value);
        if (match?.[1] && PLACEHOLDER_NAMES.includes(match[1])) {
            found.add(match[1]);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectWorkflowPlaceholders(item, found);
        }
        return;
    }
    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) {
            collectWorkflowPlaceholders(item, found);
        }
    }
}

/**
 * Placeholder names the server will actually substitute: a value that is
 * exactly `%name%`, mirroring its graph walk rather than a text search.
 */
function workflowPlaceholders(workflow: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(workflow);
    } catch {
        return [];
    }
    const found = new Set<string>();
    collectWorkflowPlaceholders(parsed, found);
    return [...found];
}

/** The same checks the server runs before posting a graph, for an early error. */
function workflowProblem(workflow: string): string | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(workflow);
    } catch {
        return 'The ComfyUI workflow is not valid JSON.';
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return 'The ComfyUI workflow must be a JSON object.';
    }
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.nodes) || Array.isArray(record.links)) {
        return 'Paste the API-format workflow: in ComfyUI use Save (API Format).';
    }
    const entries = Object.entries(record);
    if (entries.length === 0) {
        return 'The ComfyUI workflow has no nodes.';
    }
    for (const [id, node] of entries) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            return `Node "${id}" is not a JSON object.`;
        }
        const item = node as Record<string, unknown>;
        const inputs = item.inputs;
        if (typeof item.class_type !== 'string' || !inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
            return `Node "${id}" needs a class_type and an inputs object.`;
        }
    }
    return null;
}

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
            // Only swap a sampler that is still the other backend's default.
            const sampler =
                backend === 'comfyui' && (current.sampler === 'DDIM' || !current.sampler.trim())
                    ? 'euler'
                    : backend === 'automatic1111' && (current.sampler === 'euler' || !current.sampler.trim())
                      ? 'DDIM'
                      : current.sampler;
            return { ...current, backend, baseUrl, sampler };
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
        if (form.backend === 'comfyui') {
            if (!form.comfyWorkflow.trim()) {
                return 'The ComfyUI workflow is required.';
            }
            const problem = workflowProblem(form.comfyWorkflow);
            if (problem) {
                return problem;
            }
            if (!form.model.trim() && workflowPlaceholders(form.comfyWorkflow).includes('model')) {
                return 'This workflow uses %model%; enter the checkpoint name in Model.';
            }
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
    const isComfy = form.backend === 'comfyui';
    const comfyPlaceholders = isComfy ? workflowPlaceholders(form.comfyWorkflow) : [];

    return (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Generate illustrations from the chat with Automatic1111/Forge, a ComfyUI workflow or any
                OpenAI-compatible <code>/images/generations</code> endpoint. Images are stored in the character or group
                gallery and can be inserted into the chat.
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
                        <option value="comfyui">ComfyUI (local workflow)</option>
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
                            : isComfy
                              ? 'The ComfyUI root, without /prompt.'
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
                        placeholder={isOpenAi ? 'gpt-image-1' : isComfy ? 'checkpoint.safetensors' : 'Optional label'}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        {isOpenAi
                            ? 'Required by the endpoint.'
                            : isComfy
                              ? 'Replaces %model% in the workflow; leave empty if the workflow names its own checkpoint.'
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
                    </p>{' '}
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
                            {(isComfy ? COMFY_SAMPLERS : SAMPLERS).map((sampler) => (
                                <option key={sampler} value={sampler} />
                            ))}
                        </datalist>
                    </div>
                    {isComfy ? (
                        <div>
                            <label className="label-text" htmlFor="image-scheduler">
                                Scheduler
                            </label>
                            <input
                                id="image-scheduler"
                                className="input-shell"
                                list="image-schedulers"
                                value={form.scheduler}
                                onChange={(event) => set('scheduler', event.target.value)}
                            />
                            <datalist id="image-schedulers">
                                {SCHEDULERS.map((scheduler) => (
                                    <option key={scheduler} value={scheduler} />
                                ))}
                            </datalist>
                        </div>
                    ) : null}
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

            {isComfy ? (
                <div>
                    <label className="label-text" htmlFor="image-workflow">
                        API workflow (JSON)
                    </label>
                    <textarea
                        id="image-workflow"
                        className="input-shell min-h-64 w-full resize-y font-mono text-xs leading-relaxed"
                        value={form.comfyWorkflow}
                        onChange={(event) => set('comfyWorkflow', event.target.value)}
                        spellCheck={false}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        Export the workflow from ComfyUI with <strong>Save (API Format)</strong> and paste it here.
                        Placeholders are replaced before the graph is sent: %prompt%, %negative_prompt%, %seed%,
                        %width%, %height%, %steps%, %scale%, %sampler%, %scheduler% and %model%.
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        {comfyPlaceholders.length > 0
                            ? `Placeholders in use: ${comfyPlaceholders.map((name) => `%${name}%`).join(', ')}`
                            : 'No placeholders found; this workflow uses its own fixed values.'}
                    </p>
                </div>
            ) : null}

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
