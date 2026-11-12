import type { GenerationSettings } from '@catcup/shared';
import {
    BookOpen,
    Brain,
    Download,
    ImagePlus,
    Info,
    ListOrdered,
    Pencil,
    Regex,
    Save,
    Server,
    SlidersHorizontal,
    Trash2,
    Upload,
    UserRound,
    Volume2,
    Zap,
} from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';

import {
    useDeletePreset,
    useDeleteWorld,
    useImportPreset,
    useImportWorld,
    usePresets,
    useSettings,
    useUpdateSettings,
    useWorlds,
} from '../hooks/data';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { AboutTab } from './AboutTab';
import { ConfirmDialog } from './ConfirmDialog';
import { ImageSettings } from './ImageSettings';
import { MemorySettings } from './MemorySettings';
import { Modal } from './Modal';
import { PersonaSettings } from './PersonaSettings';
import { PromptOrderEditor } from './PromptOrderEditor';
import { ProviderSettings, type ProviderSettingsHandle } from './ProviderSettings';
import { QuickReplySettings } from './QuickReplySettings';
import { RegexSettings } from './RegexSettings';
import { Spinner } from './Spinner';
import { TtsSettings } from './TtsSettings';
import { WorldInfoEditor } from './WorldInfoEditor';

export type SettingsSectionId =
    | 'providers'
    | 'generation'
    | 'prompts'
    | 'worldinfo'
    | 'regex'
    | 'memory'
    | 'persona'
    | 'quickreplies'
    | 'tts'
    | 'images'
    | 'about';

type SettingsGroup = 'Model' | 'Prompt' | 'Chat' | 'Media' | 'About';

interface SettingsSection {
    id: SettingsSectionId;
    label: string;
    icon: typeof Server;
    group: SettingsGroup;
    description: string;
}

const SECTIONS: SettingsSection[] = [
    {
        id: 'providers',
        label: 'Providers',
        icon: Server,
        group: 'Model',
        description: 'Choose the model service CatCup talks to, and test it before you rely on it.',
    },
    {
        id: 'generation',
        label: 'Generation',
        icon: SlidersHorizontal,
        group: 'Model',
        description: 'Sampling defaults used by every chat unless a preset overrides them.',
    },
    {
        id: 'prompts',
        label: 'Prompts',
        icon: ListOrdered,
        group: 'Prompt',
        description: 'The active prompt preset, its order and its assembly formats.',
    },
    {
        id: 'worldinfo',
        label: 'World Info',
        icon: BookOpen,
        group: 'Prompt',
        description: 'Lorebooks scanned for every chat, and the books stored on this device.',
    },
    {
        id: 'regex',
        label: 'Regex',
        icon: Regex,
        group: 'Prompt',
        description: 'Scripts that rewrite messages on display, for the prompt, or both.',
    },
    {
        id: 'memory',
        label: 'Memory',
        icon: Brain,
        group: 'Prompt',
        description: 'A rolling summary injected into the prompt and stored with the chat.',
    },
    {
        id: 'persona',
        label: 'Persona',
        icon: UserRound,
        group: 'Chat',
        description: 'The identity you speak as, and the personas you can switch between.',
    },
    {
        id: 'quickreplies',
        label: 'Quick Replies',
        icon: Zap,
        group: 'Chat',
        description: 'Buttons and slash commands that insert text or trigger generation.',
    },
    {
        id: 'tts',
        label: 'TTS',
        icon: Volume2,
        group: 'Media',
        description: 'Speak replies aloud with browser voices or a compatible service.',
    },
    {
        id: 'images',
        label: 'Images',
        icon: ImagePlus,
        group: 'Media',
        description: 'Generate illustrations through a local or hosted image backend.',
    },
    {
        id: 'about',
        label: 'About',
        icon: Info,
        group: 'About',
        description: 'Version, storage locations and the licenses behind CatCup.',
    },
];

const GROUPS: SettingsGroup[] = ['Model', 'Prompt', 'Chat', 'Media', 'About'];

type PendingLeave = { type: 'section'; id: SettingsSectionId } | { type: 'close' } | null;

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const settingsQuery = useSettings();
    const settings = settingsQuery.data;
    const updateSettings = useUpdateSettings();
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

    const [section, setSection] = useState<SettingsSectionId>('providers');
    const [generationForm, setGenerationForm] = useState<GenerationSettings | null>(null);
    const [editingBookId, setEditingBookId] = useState<string | null>(null);
    const [pendingLeave, setPendingLeave] = useState<PendingLeave>(null);
    const [leaveBusy, setLeaveBusy] = useState(false);
    const initializedRef = useRef(false);
    const providerRef = useRef<ProviderSettingsHandle | null>(null);

    const activeSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
    const ActiveSectionIcon = activeSection?.icon ?? Server;

    useEffect(() => {
        if (!open) {
            initializedRef.current = false;
            setEditingBookId(null);
            setPendingLeave(null);
            setLeaveBusy(false);
            return;
        }
        if (!settings || initializedRef.current) {
            return;
        }
        initializedRef.current = true;
        setGenerationForm({ ...settings.generation });
    }, [open, settings]);

    const providerIsDirty = () => section === 'providers' && (providerRef.current?.isDirty() ?? false);

    const requestSection = (next: SettingsSectionId) => {
        if (next === section) {
            return;
        }
        if (providerIsDirty()) {
            setPendingLeave({ type: 'section', id: next });
            return;
        }
        setSection(next);
        setEditingBookId(null);
    };

    const requestClose = () => {
        if (providerIsDirty()) {
            setPendingLeave({ type: 'close' });
            return;
        }
        onClose();
    };

    const finishLeave = (discard: boolean) => {
        const pending = pendingLeave;
        setPendingLeave(null);
        if (!pending) {
            return;
        }
        if (discard) {
            providerRef.current?.discard();
        }
        if (pending.type === 'close') {
            onClose();
            return;
        }
        setSection(pending.id);
        setEditingBookId(null);
    };

    const saveAndLeave = async () => {
        const provider = providerRef.current;
        if (!provider) {
            finishLeave(false);
            return;
        }
        setLeaveBusy(true);
        const saved = await provider.save();
        setLeaveBusy(false);
        if (saved) {
            finishLeave(false);
        } else {
            // Keep the panel open so its inline error stays visible.
            setPendingLeave(null);
        }
    };

    const handleNavKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const index = SECTIONS.findIndex((item) => item.id === section);
        let nextIndex = index;
        if (event.key === 'ArrowDown') {
            nextIndex = (index + 1) % SECTIONS.length;
        } else if (event.key === 'ArrowUp') {
            nextIndex = (index - 1 + SECTIONS.length) % SECTIONS.length;
        } else if (event.key === 'Home') {
            nextIndex = 0;
        } else {
            nextIndex = SECTIONS.length - 1;
        }
        const next = SECTIONS[nextIndex];
        if (next) {
            document.getElementById(`settings-tab-${next.id}`)?.focus();
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

    const renderGenerationPanel = () => (
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
                            setGenerationForm((current) => (current ? { ...current, temperature: value } : current))
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
                            setGenerationForm((current) => (current ? { ...current, maxTokens: value } : current))
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
                            setGenerationForm((current) => (current ? { ...current, contextSize: value } : current))
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
    );

    const renderPromptsPanel = () => (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                An imported SillyTavern OpenAI preset supplies the prompt list, its order, the assembly formats and the
                sampling parameters. With no preset selected, the built-in SillyTavern defaults are used.
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
    );

    const renderWorldInfoPanel = () => (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Books stored in <code className="text-parchment-dim">data/worlds</code>. Enabled books are scanned for
                every chat; a character&apos;s own book, from its card, is added automatically.
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
    );

    const renderPanel = () => {
        if (settingsQuery.isError) {
            return (
                <div className="flex h-full items-center justify-center p-8">
                    <div className="max-w-md text-center">
                        <p className="font-display text-lg text-parchment">Settings could not be loaded</p>
                        <p className="mt-2 text-sm leading-relaxed text-muted">
                            {settingsQuery.error instanceof Error
                                ? settingsQuery.error.message
                                : 'The server did not return the settings.'}
                        </p>
                        <button
                            type="button"
                            className="btn-ghost mt-4"
                            onClick={() => void settingsQuery.refetch()}
                            disabled={settingsQuery.isFetching}
                        >
                            {settingsQuery.isFetching ? <Spinner size={15} /> : null}
                            Try again
                        </button>
                    </div>
                </div>
            );
        }

        if (!settings) {
            return (
                <div className="flex h-full items-center justify-center p-12">
                    <Spinner size={20} className="text-muted" />
                </div>
            );
        }

        if (section === 'providers') {
            return <ProviderSettings settings={settings} handleRef={providerRef} />;
        }

        const panel =
            section === 'generation' ? (
                renderGenerationPanel()
            ) : section === 'prompts' ? (
                renderPromptsPanel()
            ) : section === 'worldinfo' && editingBookId ? (
                <WorldInfoEditor bookId={editingBookId} onClose={() => setEditingBookId(null)} />
            ) : section === 'worldinfo' ? (
                renderWorldInfoPanel()
            ) : section === 'persona' ? (
                <PersonaSettings />
            ) : section === 'memory' ? (
                <MemorySettings />
            ) : section === 'quickreplies' ? (
                <QuickReplySettings />
            ) : section === 'regex' ? (
                <RegexSettings />
            ) : section === 'tts' ? (
                <TtsSettings />
            ) : section === 'images' ? (
                <ImageSettings />
            ) : (
                <AboutTab />
            );

        return <div className="h-full overflow-y-auto">{panel}</div>;
    };

    return (
        <>
            <Modal
                open={open}
                onClose={requestClose}
                title="Settings"
                widthClassName="max-w-5xl"
                bodyClassName="overflow-hidden"
            >
                <div className="flex h-[min(78dvh,760px)] flex-col md:flex-row">
                    <div className="shrink-0 border-b border-line-soft p-3 md:hidden">
                        <label className="label-text" htmlFor="settings-section-select">
                            Settings section
                        </label>
                        <select
                            id="settings-section-select"
                            className="input-shell"
                            value={section}
                            onChange={(event) => requestSection(event.target.value as SettingsSectionId)}
                        >
                            {GROUPS.map((group) => (
                                <optgroup key={group} label={group}>
                                    {SECTIONS.filter((item) => item.group === group).map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.label}
                                        </option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    <nav
                        className="hidden w-52 shrink-0 overflow-y-auto border-r border-line-soft px-3 py-4 md:block"
                        aria-label="Settings sections"
                    >
                        <div role="tablist" aria-orientation="vertical" onKeyDown={handleNavKeyDown}>
                            {GROUPS.map((group) => (
                                <div key={group} role="presentation" className="mb-4 last:mb-0">
                                    <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                                        {group}
                                    </p>
                                    <div className="space-y-0.5">
                                        {SECTIONS.filter((item) => item.group === group).map((item) => {
                                            const Icon = item.icon;
                                            const active = item.id === section;
                                            return (
                                                <button
                                                    key={item.id}
                                                    id={`settings-tab-${item.id}`}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={active}
                                                    aria-controls={`settings-panel-${item.id}`}
                                                    tabIndex={active ? 0 : -1}
                                                    onClick={() => requestSection(item.id)}
                                                    className={cn(
                                                        'relative flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
                                                        active
                                                            ? 'bg-amber/10 text-parchment'
                                                            : 'text-muted hover:bg-surface/60 hover:text-parchment-dim',
                                                    )}
                                                >
                                                    {active ? (
                                                        <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-amber" />
                                                    ) : null}
                                                    <Icon
                                                        size={15}
                                                        className={active ? 'shrink-0 text-amber' : 'shrink-0'}
                                                    />
                                                    <span className="truncate">{item.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </nav>

                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <div className="flex shrink-0 items-start gap-3 border-b border-line-soft px-4 py-4 md:px-5">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber/25 bg-amber/10 text-amber">
                                <ActiveSectionIcon size={18} />
                            </span>
                            <div className="min-w-0">
                                <h3
                                    id={`settings-heading-${section}`}
                                    className="font-display text-lg leading-tight text-parchment"
                                >
                                    {activeSection?.label}
                                </h3>
                                <p className="mt-1 text-xs leading-relaxed text-muted">{activeSection?.description}</p>
                            </div>
                        </div>
                        <div
                            id={`settings-panel-${section}`}
                            role="tabpanel"
                            aria-labelledby={`settings-heading-${section}`}
                            className="min-h-0 flex-1 overflow-hidden"
                        >
                            {renderPanel()}
                        </div>
                    </div>
                </div>
            </Modal>

            <ConfirmDialog
                open={pendingLeave !== null}
                title="Save changes before leaving?"
                description="Your provider changes have not been saved. Save them before continuing, or discard the edits."
                confirmLabel="Save and continue"
                alternateLabel="Discard changes"
                cancelLabel="Keep editing"
                onConfirm={() => void saveAndLeave()}
                onAlternate={() => finishLeave(true)}
                onCancel={() => setPendingLeave(null)}
                busy={leaveBusy}
                initialFocus="cancel"
            />
        </>
    );
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
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>
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
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>
        </div>
    );
}
