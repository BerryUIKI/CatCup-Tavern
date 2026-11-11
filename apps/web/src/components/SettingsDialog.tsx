import type {
    GenerationSettings,
    ModelInfo,
    PersonaSettings,
    ProviderInput,
    ProviderKind,
    ProviderPublic,
    ProviderTestResult,
} from '@catcup/shared';
import { DEFAULT_BASE_URLS, PROVIDER_KIND_LABELS } from '@catcup/shared';
import {
    BookOpen,
    Check,
    Download,
    Pencil,
    PlugZap,
    Regex,
    Save,
    Server,
    SlidersHorizontal,
    Trash2,
    Upload,
    UserRound,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    useDeletePreset,
    useDeleteWorld,
    useImportPreset,
    useImportWorld,
    usePresets,
    useSettings,
    useTestProvider,
    useUpdateProvider,
    useUpdateSettings,
    useWorlds,
} from '../hooks/data';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { Modal } from './Modal';
import { PromptOrderEditor } from './PromptOrderEditor';
import { RegexSettings } from './RegexSettings';
import { Spinner } from './Spinner';
import { WorldInfoEditor } from './WorldInfoEditor';

type Tab = 'connection' | 'generation' | 'persona' | 'prompts' | 'worldinfo' | 'regex';

interface ProviderForm {
    name: string;
    kind: ProviderKind;
    baseUrl: string;
    model: string;
    enabled: boolean;
    headers: Record<string, string>;
}

function formToInput(form: ProviderForm, apiKey?: string): ProviderInput {
    return {
        kind: form.kind,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        enabled: form.enabled,
        headers: form.headers,
        ...(apiKey !== undefined ? { apiKey } : {}),
    };
}

function SliderField({
    label,
    hint,
    min,
    max,
    step,
    value,
    onChange,
}: {
    label: string;
    hint: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
}) {
    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <span className="label-text mb-0">{label}</span>
                <span className="text-xs tabular-nums text-parchment-dim">{value}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="mt-2 w-full accent-amber"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted/70">{hint}</p>
        </div>
    );
}

function NumberField({
    id,
    label,
    hint,
    min,
    max,
    value,
    onChange,
}: {
    id: string;
    label: string;
    hint: string;
    min: number;
    max: number;
    value: number;
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
                value={value}
                onChange={(event) => onChange(Number(event.target.value))}
                className="input-shell"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted/70">{hint}</p>
        </div>
    );
}

const TABS: { id: Tab; label: string; icon: typeof Server }[] = [
    { id: 'connection', label: 'Connection', icon: Server },
    { id: 'generation', label: 'Generation', icon: SlidersHorizontal },
    { id: 'persona', label: 'Persona', icon: UserRound },
    { id: 'prompts', label: 'Prompts', icon: SlidersHorizontal },
    { id: 'worldinfo', label: 'World Info', icon: BookOpen },
    { id: 'regex', label: 'Regex', icon: Regex },
];

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const settingsQuery = useSettings();
    const settings = settingsQuery.data;
    const updateSettings = useUpdateSettings();
    const updateProvider = useUpdateProvider();
    const testProvider = useTestProvider();
    const presetsQuery = usePresets();
    const importPreset = useImportPreset();
    const deletePreset = useDeletePreset();
    const presets = presetsQuery.data?.presets ?? [];
    const worldsQuery = useWorlds();
    const importWorld = useImportWorld();
    const deleteWorldMutation = useDeleteWorld();
    const worlds = worldsQuery.data?.worlds ?? [];
    const globalBooks = settings?.worldInfo.globalBooks ?? [];
    const pushToast = useAppStore((state) => state.pushToast);

    const [tab, setTab] = useState<Tab>('connection');
    const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
    const [providerForm, setProviderForm] = useState<ProviderForm | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
    const [providerError, setProviderError] = useState<string | null>(null);
    const [generationForm, setGenerationForm] = useState<GenerationSettings | null>(null);
    const [personaForm, setPersonaForm] = useState<PersonaSettings | null>(null);
    const [editingBookId, setEditingBookId] = useState<string | null>(null);
    const initializedRef = useRef(false);

    const selectedProvider = settings?.providers.find((provider) => provider.id === selectedProviderId) ?? null;
    const isActive = settings?.activeProviderId === selectedProviderId;

    const loadProvider = useCallback((provider: ProviderPublic) => {
        setSelectedProviderId(provider.id);
        setProviderForm({
            name: provider.name,
            kind: provider.kind,
            baseUrl: provider.baseUrl,
            model: provider.model,
            enabled: provider.enabled,
            headers: provider.headers,
        });
        setApiKey('');
        setModels([]);
        setTestResult(null);
        setProviderError(null);
    }, []);

    useEffect(() => {
        if (!open) {
            initializedRef.current = false;
            setEditingBookId(null);
            return;
        }
        if (!settings || initializedRef.current) {
            return;
        }
        initializedRef.current = true;
        setGenerationForm({ ...settings.generation });
        setPersonaForm({ ...settings.persona });
        const initial =
            settings.providers.find((provider) => provider.id === settings.activeProviderId) ?? settings.providers[0];
        if (initial) {
            loadProvider(initial);
        }
    }, [open, settings, loadProvider]);

    const handleKindChange = (kind: ProviderKind) => {
        setProviderForm((current) => {
            if (!current) {
                return current;
            }
            const previousDefault = DEFAULT_BASE_URLS[current.kind];
            const shouldReplace = !current.baseUrl || current.baseUrl === previousDefault;
            return {
                ...current,
                kind,
                baseUrl: shouldReplace ? DEFAULT_BASE_URLS[kind] : current.baseUrl,
            };
        });
    };

    const handleSaveProvider = async () => {
        if (!providerForm || !selectedProvider) {
            return;
        }
        setProviderError(null);
        try {
            await updateProvider.mutateAsync({
                id: selectedProvider.id,
                input: formToInput(providerForm, apiKey.trim() ? apiKey.trim() : undefined),
            });
            setApiKey('');
            pushToast('Provider settings saved.', 'success');
        } catch (error) {
            setProviderError(error instanceof Error ? error.message : 'Could not save the provider.');
        }
    };

    const handleSaveAndTest = async () => {
        if (!providerForm || !selectedProvider) {
            return;
        }
        setProviderError(null);
        setTestResult(null);
        try {
            await updateProvider.mutateAsync({
                id: selectedProvider.id,
                input: formToInput(providerForm, apiKey.trim() ? apiKey.trim() : undefined),
            });
            setApiKey('');
            const result = await testProvider.mutateAsync({ id: selectedProvider.id });
            setTestResult(result);
            if (result.models && result.models.length > 0) {
                setModels(result.models);
            }
        } catch (error) {
            setTestResult({
                ok: false,
                message: error instanceof Error ? error.message : 'Connection failed.',
            });
        }
    };

    const handleClearKey = async () => {
        if (!providerForm || !selectedProvider) {
            return;
        }
        try {
            await updateProvider.mutateAsync({
                id: selectedProvider.id,
                input: formToInput(providerForm, ''),
            });
            setApiKey('');
            pushToast('Saved API key removed.', 'success');
        } catch (error) {
            setProviderError(error instanceof Error ? error.message : 'Could not remove the API key.');
        }
    };

    const handleSetActive = async () => {
        if (!selectedProvider) {
            return;
        }
        try {
            await updateSettings.mutateAsync({ activeProviderId: selectedProvider.id });
            pushToast(`${selectedProvider.name} is now the active provider.`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not change the active provider.', 'error');
        }
    };

    const handleSaveGeneration = async () => {
        if (!generationForm) {
            return;
        }
        try {
            await updateSettings.mutateAsync({ generation: generationForm });
            pushToast('Generation settings saved.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save generation settings.', 'error');
        }
    };

    const handleSavePersona = async () => {
        if (!personaForm) {
            return;
        }
        try {
            await updateSettings.mutateAsync({ persona: personaForm });
            pushToast('Persona saved.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the persona.', 'error');
        }
    };

    const handleSelectPreset = async (id: string | null) => {
        try {
            await updateSettings.mutateAsync({ activePresetId: id });
            pushToast(id ? `Activated preset "${id}".` : 'Using the built-in prompt defaults.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not change the preset.', 'error');
        }
    };

    const handleImportPreset = async (file: File) => {
        try {
            const preset = JSON.parse(await file.text()) as unknown;
            const result = await importPreset.mutateAsync({ fileName: file.name, preset });
            await updateSettings.mutateAsync({ activePresetId: result.preset.id });
            pushToast(`Imported and activated "${result.preset.id}".`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not import the preset.', 'error');
        }
    };

    const handleDeletePreset = async () => {
        const id = settings?.activePresetId;
        if (!id) {
            return;
        }
        try {
            await deletePreset.mutateAsync(id);
            pushToast(`Deleted preset "${id}".`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not delete the preset.', 'error');
        }
    };

    const handleToggleBook = async (id: string, enabled: boolean) => {
        const next = enabled ? [...new Set([...globalBooks, id])] : globalBooks.filter((book) => book !== id);
        try {
            await updateSettings.mutateAsync({ worldInfo: { globalBooks: next } });
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not update the world info books.', 'error');
        }
    };

    const handleImportWorld = async (file: File) => {
        try {
            const book = JSON.parse(await file.text()) as unknown;
            const result = await importWorld.mutateAsync({ fileName: file.name, book });
            await updateSettings.mutateAsync({
                worldInfo: { globalBooks: [...new Set([...globalBooks, result.world.id])] },
            });
            pushToast(`Imported and enabled "${result.world.id}".`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not import the world info book.', 'error');
        }
    };

    const handleDeleteWorld = async (id: string) => {
        if (!window.confirm(`Delete the world info book "${id}"? This cannot be undone.`)) {
            return;
        }
        try {
            await deleteWorldMutation.mutateAsync(id);
            pushToast(`Deleted "${id}".`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not delete the book.', 'error');
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Settings" widthClassName="max-w-4xl">
            <div className="flex gap-1 border-b border-line-soft px-4 pt-3">
                {TABS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => setTab(item.id)}
                            className={cn(
                                'flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2 text-sm transition',
                                tab === item.id
                                    ? 'border-amber text-parchment'
                                    : 'border-transparent text-muted hover:text-parchment-dim',
                            )}
                        >
                            <Icon size={15} />
                            {item.label}
                        </button>
                    );
                })}
            </div>

            {settingsQuery.isLoading || !settings ? (
                <div className="flex justify-center p-12">
                    <Spinner size={20} className="text-muted" />
                </div>
            ) : tab === 'connection' ? (
                <div className="grid gap-5 p-5 md:grid-cols-[220px_1fr]">
                    <div className="space-y-1.5">
                        <p className="label-text mb-2">Providers</p>
                        {settings.providers.map((provider) => (
                            <button
                                key={provider.id}
                                type="button"
                                onClick={() => loadProvider(provider)}
                                className={cn(
                                    'flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition',
                                    provider.id === selectedProviderId
                                        ? 'border-amber/40 bg-surface-2'
                                        : 'border-transparent hover:bg-surface/70',
                                )}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="truncate text-sm font-medium text-parchment">
                                            {provider.name}
                                        </span>
                                        {provider.id === settings.activeProviderId ? (
                                            <Check size={13} className="shrink-0 text-sage" />
                                        ) : null}
                                    </span>
                                    <span className="block text-[11px] text-muted">
                                        {PROVIDER_KIND_LABELS[provider.kind]}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        'mt-1 size-1.5 shrink-0 rounded-full',
                                        provider.hasKey || provider.kind === 'ollama' ? 'bg-sage' : 'bg-amber/70',
                                    )}
                                    title={
                                        provider.hasKey || provider.kind === 'ollama'
                                            ? 'Ready'
                                            : 'API key may be required'
                                    }
                                />
                            </button>
                        ))}
                        <p className="pt-2 text-[11px] leading-relaxed text-muted/70">
                            Keys are stored in the server&apos;s data directory and are never sent to the browser.
                        </p>
                    </div>

                    <div className="min-w-0">
                        {!providerForm || !selectedProvider ? (
                            <p className="text-sm text-muted">No provider selected.</p>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div>
                                        <label className="label-text" htmlFor="provider-name">
                                            Name
                                        </label>
                                        <input
                                            id="provider-name"
                                            className="input-shell"
                                            value={providerForm.name}
                                            onChange={(event) =>
                                                setProviderForm((current) =>
                                                    current ? { ...current, name: event.target.value } : current,
                                                )
                                            }
                                        />
                                    </div>
                                    <div>
                                        <label className="label-text" htmlFor="provider-kind">
                                            Type
                                        </label>
                                        <select
                                            id="provider-kind"
                                            className="input-shell"
                                            value={providerForm.kind}
                                            onChange={(event) => handleKindChange(event.target.value as ProviderKind)}
                                        >
                                            {Object.entries(PROVIDER_KIND_LABELS).map(([kind, label]) => (
                                                <option key={kind} value={kind}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="label-text" htmlFor="provider-base-url">
                                        Base URL
                                    </label>
                                    <input
                                        id="provider-base-url"
                                        className="input-shell"
                                        value={providerForm.baseUrl}
                                        placeholder={DEFAULT_BASE_URLS[providerForm.kind] || 'https://example.com/v1'}
                                        onChange={(event) =>
                                            setProviderForm((current) =>
                                                current ? { ...current, baseUrl: event.target.value } : current,
                                            )
                                        }
                                    />
                                </div>

                                <div>
                                    <label className="label-text" htmlFor="provider-model">
                                        Model
                                    </label>
                                    <input
                                        id="provider-model"
                                        className="input-shell"
                                        list="provider-models"
                                        value={providerForm.model}
                                        placeholder="e.g. claude-sonnet-5-5"
                                        onChange={(event) =>
                                            setProviderForm((current) =>
                                                current ? { ...current, model: event.target.value } : current,
                                            )
                                        }
                                    />
                                    <datalist id="provider-models">
                                        {models.map((model) => (
                                            <option key={model.id} value={model.id}>
                                                {model.name ?? model.id}
                                            </option>
                                        ))}
                                    </datalist>
                                </div>

                                <div>
                                    <label className="label-text" htmlFor="provider-key">
                                        API key
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            id="provider-key"
                                            type="password"
                                            autoComplete="off"
                                            className="input-shell"
                                            value={apiKey}
                                            placeholder={
                                                selectedProvider.hasKey
                                                    ? 'Saved — leave blank to keep'
                                                    : 'API key (if required)'
                                            }
                                            onChange={(event) => setApiKey(event.target.value)}
                                        />
                                        {selectedProvider.hasKey ? (
                                            <button
                                                type="button"
                                                className="btn-ghost shrink-0 px-2.5"
                                                onClick={() => void handleClearKey()}
                                                disabled={updateProvider.isPending}
                                            >
                                                Remove
                                            </button>
                                        ) : null}
                                    </div>
                                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                                        Stored in data/secrets.json. The browser only receives a “has key” flag.
                                    </p>
                                </div>

                                <label className="flex items-center gap-2 text-sm text-parchment-dim">
                                    <input
                                        type="checkbox"
                                        className="size-4 accent-amber"
                                        checked={providerForm.enabled}
                                        onChange={(event) =>
                                            setProviderForm((current) =>
                                                current
                                                    ? {
                                                          ...current,
                                                          enabled: event.target.checked,
                                                      }
                                                    : current,
                                            )
                                        }
                                    />
                                    Enabled
                                </label>

                                {providerError ? (
                                    <div className="rounded-lg border border-wine/50 bg-wine/15 px-3 py-2 text-sm leading-relaxed text-parchment">
                                        {providerError}
                                    </div>
                                ) : null}

                                {testResult ? (
                                    <div
                                        className={cn(
                                            'rounded-lg border px-3 py-2 text-sm text-parchment',
                                            testResult.ok ? 'border-sage/40 bg-sage/10' : 'border-wine/50 bg-wine/15',
                                        )}
                                    >
                                        <p className="font-medium">
                                            {testResult.ok ? 'Connection OK' : 'Connection failed'}
                                        </p>
                                        <p className="mt-1 text-xs leading-relaxed text-parchment-dim">
                                            {testResult.message}
                                        </p>
                                    </div>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <button
                                        type="button"
                                        className="btn-primary"
                                        onClick={() => void handleSaveProvider()}
                                        disabled={updateProvider.isPending}
                                    >
                                        {updateProvider.isPending ? <Spinner size={15} /> : <Save size={15} />}
                                        Save provider
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={() => void handleSaveAndTest()}
                                        disabled={updateProvider.isPending || testProvider.isPending}
                                    >
                                        {testProvider.isPending ? <Spinner size={15} /> : <PlugZap size={15} />}
                                        Save &amp; test
                                    </button>
                                    {!isActive ? (
                                        <button
                                            type="button"
                                            className="btn-ghost"
                                            onClick={() => void handleSetActive()}
                                            disabled={updateSettings.isPending}
                                        >
                                            {updateSettings.isPending ? <Spinner size={15} /> : <Check size={15} />}
                                            Set as active
                                        </button>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 text-xs text-sage">
                                            <Check size={13} />
                                            Active
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : tab === 'generation' ? (
                <div className="space-y-5 p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        Defaults for every chat. Per-character presets will layer on top of these later.
                    </p>

                    {generationForm ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                            <SliderField
                                label="Temperature"
                                hint="Higher values are more creative and unpredictable."
                                min={0}
                                max={2}
                                step={0.05}
                                value={generationForm.temperature}
                                onChange={(value) =>
                                    setGenerationForm((current) =>
                                        current ? { ...current, temperature: value } : current,
                                    )
                                }
                            />
                            <SliderField
                                label="Top P"
                                hint="Limits sampling to the most likely tokens."
                                min={0}
                                max={1}
                                step={0.01}
                                value={generationForm.topP}
                                onChange={(value) =>
                                    setGenerationForm((current) => (current ? { ...current, topP: value } : current))
                                }
                            />
                            <NumberField
                                id="max-tokens"
                                label="Max tokens"
                                hint="Upper bound for each reply."
                                min={1}
                                max={200000}
                                value={generationForm.maxTokens}
                                onChange={(value) =>
                                    setGenerationForm((current) =>
                                        current ? { ...current, maxTokens: value } : current,
                                    )
                                }
                            />
                            <NumberField
                                id="context-size"
                                label="Context size"
                                hint="Token budget used when trimming chat history."
                                min={512}
                                max={2000000}
                                value={generationForm.contextSize}
                                onChange={(value) =>
                                    setGenerationForm((current) =>
                                        current ? { ...current, contextSize: value } : current,
                                    )
                                }
                            />
                        </div>
                    ) : null}

                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleSaveGeneration()}
                        disabled={updateSettings.isPending}
                    >
                        {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                        Save generation settings
                    </button>
                </div>
            ) : tab === 'persona' ? (
                <div className="space-y-4 p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        Your persona is how the model refers to you in prompts.
                    </p>

                    {personaForm ? (
                        <>
                            <div>
                                <label className="label-text" htmlFor="persona-name">
                                    Display name
                                </label>
                                <input
                                    id="persona-name"
                                    className="input-shell"
                                    value={personaForm.name}
                                    placeholder="You"
                                    onChange={(event) =>
                                        setPersonaForm((current) =>
                                            current ? { ...current, name: event.target.value } : current,
                                        )
                                    }
                                />
                            </div>
                            <div>
                                <label className="label-text" htmlFor="persona-description">
                                    Description
                                </label>
                                <textarea
                                    id="persona-description"
                                    rows={8}
                                    className="input-shell resize-y leading-relaxed"
                                    value={personaForm.description}
                                    placeholder="Optional description of your persona…"
                                    onChange={(event) =>
                                        setPersonaForm((current) =>
                                            current ? { ...current, description: event.target.value } : current,
                                        )
                                    }
                                />
                            </div>
                        </>
                    ) : null}

                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleSavePersona()}
                        disabled={updateSettings.isPending}
                    >
                        {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                        Save persona
                    </button>
                </div>
            ) : tab === 'prompts' ? (
                <div className="space-y-5 p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        An imported SillyTavern OpenAI preset supplies the prompt list, its order, the assembly formats
                        and the sampling parameters. With no preset selected, the built-in SillyTavern defaults are
                        used.
                    </p>

                    <div>
                        <label className="label-text" htmlFor="active-preset">
                            Active preset
                        </label>
                        <select
                            id="active-preset"
                            className="input-shell"
                            value={settings?.activePresetId ?? ''}
                            disabled={updateSettings.isPending}
                            onChange={(event) => void handleSelectPreset(event.target.value || null)}
                        >
                            <option value="">Built-in defaults</option>
                            {presets.map((preset) => (
                                <option key={preset.id} value={preset.id}>
                                    {preset.id} ({preset.promptCount} prompts)
                                </option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-parchment-dim">
                            {settings?.activePresetId
                                ? `Active: ${settings.activePresetId}`
                                : 'No preset selected. Preset files in data/presets take effect once activated.'}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className={cn('btn-ghost cursor-pointer', importPreset.isPending && 'opacity-60')}>
                            {importPreset.isPending ? <Spinner size={15} /> : <Upload size={15} />}
                            Import JSON
                            <input
                                type="file"
                                accept=".json,application/json"
                                className="sr-only"
                                disabled={importPreset.isPending}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (file) {
                                        void handleImportPreset(file);
                                    }
                                }}
                            />
                        </label>

                        {settings?.activePresetId ? (
                            <>
                                <a className="btn-ghost" href={api.presets.exportUrl(settings.activePresetId)} download>
                                    <Download size={15} />
                                    Export
                                </a>
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => void handleDeletePreset()}
                                    disabled={deletePreset.isPending}
                                >
                                    {deletePreset.isPending ? <Spinner size={15} /> : <Trash2 size={15} />}
                                    Delete
                                </button>
                            </>
                        ) : null}
                    </div>

                    {settings?.activePresetId ? (
                        <div className="border-t border-line-soft pt-4">
                            <PromptOrderEditor key={settings.activePresetId} presetId={settings.activePresetId} />
                        </div>
                    ) : null}
                </div>
            ) : editingBookId ? (
                <WorldInfoEditor bookId={editingBookId} onClose={() => setEditingBookId(null)} />
            ) : tab === 'regex' ? (
                <RegexSettings />
            ) : (
                <div className="space-y-5 p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        Books stored in <code className="text-parchment-dim">data/worlds</code>. Enabled books are
                        scanned for every chat; a character's own book, from its card, is added automatically.
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                        <label className={cn('btn-ghost cursor-pointer', importWorld.isPending && 'opacity-60')}>
                            {importWorld.isPending ? <Spinner size={15} /> : <Upload size={15} />}
                            Import JSON
                            <input
                                type="file"
                                accept=".json,application/json"
                                className="sr-only"
                                disabled={importWorld.isPending}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (file) {
                                        void handleImportWorld(file);
                                    }
                                }}
                            />
                        </label>
                        {worldsQuery.isLoading ? <Spinner size={15} className="text-muted" /> : null}
                    </div>

                    {worlds.length === 0 ? (
                        <p className="text-sm text-muted">
                            No books yet. Import a SillyTavern world info JSON file to get started.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {worlds.map((world) => (
                                <li
                                    key={world.id}
                                    className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/50 px-3 py-2"
                                >
                                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={globalBooks.includes(world.id)}
                                            onChange={(event) => void handleToggleBook(world.id, event.target.checked)}
                                        />
                                        <span className="truncate text-sm text-parchment">{world.id}</span>
                                        <span className="shrink-0 text-xs text-muted">{world.entryCount} entries</span>
                                    </label>
                                    <a
                                        className="icon-btn size-7"
                                        href={api.worlds.exportUrl(world.id)}
                                        download
                                        title="Export"
                                        aria-label={`Export ${world.id}`}
                                    >
                                        <Download size={14} />
                                    </a>
                                    <button
                                        type="button"
                                        className="icon-btn size-7"
                                        onClick={() => setEditingBookId(world.id)}
                                        title="Edit entries"
                                        aria-label={`Edit ${world.id}`}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn size-7 hover:text-wine"
                                        onClick={() => void handleDeleteWorld(world.id)}
                                        title="Delete"
                                        aria-label={`Delete ${world.id}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </Modal>
    );
}
