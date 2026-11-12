import {
    DEFAULT_BASE_URLS,
    type ModelInfo,
    PROVIDER_KIND_LABELS,
    type ProviderDraftTestInput,
    type ProviderInput,
    type ProviderKind,
    type ProviderPublic,
    type ProviderTestResult,
    type SettingsResponse,
} from '@catcup/shared';
import {
    Check,
    ChevronDown,
    Copy,
    Eye,
    EyeOff,
    KeyRound,
    PlugZap,
    Plus,
    RefreshCw,
    Save,
    Trash2,
    X,
} from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import {
    useCreateProvider,
    useDeleteProvider,
    useTestProviderDraft,
    useUpdateProvider,
    useUpdateSettings,
} from '../hooks/data';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { ConfirmDialog } from './ConfirmDialog';
import { Spinner } from './Spinner';

export interface ProviderSettingsHandle {
    isDirty(): boolean;
    /** Persist the current form. Resolves false when validation or the API fails. */
    save(): Promise<boolean>;
    /** Throw away local edits and return to the saved provider. */
    discard(): void;
}

interface HeaderRow {
    id: string;
    name: string;
    value: string;
}

interface ProviderForm {
    name: string;
    kind: ProviderKind;
    baseUrl: string;
    model: string;
    enabled: boolean;
    headers: HeaderRow[];
}

type Mode = 'existing' | 'new';
type PendingNav = { type: 'select'; id: string } | { type: 'create' } | null;

interface ProviderSettingsProps {
    settings: SettingsResponse;
    handleRef?: RefObject<ProviderSettingsHandle | null>;
}

const KIND_ORDER: ProviderKind[] = ['openai', 'anthropic', 'openrouter', 'ollama', 'custom'];

const KIND_HINTS: Record<ProviderKind, string> = {
    openai: 'OpenAI, Azure OpenAI and compatible gateways.',
    anthropic: "Anthropic's Messages API.",
    openrouter: 'One key for many hosted models.',
    ollama: 'A local Ollama server; usually no key.',
    custom: 'Any OpenAI-compatible endpoint, local or hosted.',
};

const KIND_INITIALS: Record<ProviderKind, string> = {
    openai: 'OA',
    anthropic: 'AN',
    openrouter: 'OR',
    ollama: 'OL',
    custom: 'CP',
};

const KEY_REQUIRED: ProviderKind[] = ['openai', 'openrouter', 'anthropic'];

function requiresKey(kind: ProviderKind): boolean {
    return KEY_REQUIRED.includes(kind);
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

function providerToForm(provider: ProviderPublic): ProviderForm {
    return {
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        model: provider.model,
        enabled: provider.enabled,
        headers: Object.entries(provider.headers).map(([name, value]) => ({
            id: crypto.randomUUID(),
            name,
            value,
        })),
    };
}

function formHeaders(form: ProviderForm): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const row of form.headers) {
        const name = row.name.trim();
        if (name) {
            headers[name] = row.value;
        }
    }
    return headers;
}

function headersEqual(left: Record<string, string>, right: Record<string, string>): boolean {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    return leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function formToInput(form: ProviderForm): ProviderInput {
    return {
        kind: form.kind,
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        enabled: form.enabled,
        headers: formHeaders(form),
    };
}

function formsEqual(left: ProviderForm, right: ProviderForm): boolean {
    return (
        left.name.trim() === right.name.trim() &&
        left.kind === right.kind &&
        left.baseUrl.trim() === right.baseUrl.trim() &&
        left.model.trim() === right.model.trim() &&
        left.enabled === right.enabled &&
        headersEqual(formHeaders(left), formHeaders(right))
    );
}

function cloneProviderForm(form: ProviderForm): ProviderForm {
    return { ...form, headers: form.headers.map((row) => ({ ...row })) };
}

function validateForm(form: ProviderForm): string | null {
    if (!form.name.trim()) {
        return 'Give this provider a name.';
    }
    if (form.name.trim().length > 80) {
        return 'Keep the name to 80 characters.';
    }
    const baseUrl = form.baseUrl.trim();
    if (baseUrl) {
        if (!/^https?:\/\//i.test(baseUrl)) {
            return 'The base URL must start with http:// or https://.';
        }
        try {
            new URL(baseUrl);
        } catch {
            return 'Enter a complete base URL.';
        }
    } else if (!DEFAULT_BASE_URLS[form.kind]) {
        return 'This provider type needs a base URL.';
    }
    return null;
}

function uniqueName(base: string, providers: ProviderPublic[]): string {
    const taken = new Set(providers.map((provider) => provider.name.toLowerCase()));
    if (!taken.has(base.toLowerCase())) {
        return base;
    }
    let suffix = 2;
    while (taken.has(`${base} ${suffix}`.toLowerCase())) {
        suffix += 1;
    }
    return `${base} ${suffix}`;
}

function defaultName(kind: ProviderKind): string {
    return kind === 'custom' ? 'Custom provider' : PROVIDER_KIND_LABELS[kind];
}

function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
    return (
        <section className="border-t border-line-soft pt-5 first:border-t-0 first:pt-0">
            <div className="mb-4">
                <h4 className="text-sm font-medium text-parchment">{title}</h4>
                {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p> : null}
            </div>
            {children}
        </section>
    );
}

export function ProviderSettings({ settings, handleRef }: ProviderSettingsProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const createProvider = useCreateProvider();
    const updateProvider = useUpdateProvider();
    const deleteProvider = useDeleteProvider();
    const updateSettings = useUpdateSettings();
    const testDraft = useTestProviderDraft();
    const idPrefix = useId();

    const initialProvider =
        settings.providers.find((provider) => provider.id === settings.activeProviderId) ??
        settings.providers.find((provider) => provider.enabled) ??
        settings.providers[0] ??
        null;

    const [mode, setMode] = useState<Mode>(initialProvider ? 'existing' : 'new');
    const [selectedId, setSelectedId] = useState<string | null>(initialProvider?.id ?? null);
    const [form, setForm] = useState<ProviderForm | null>(initialProvider ? providerToForm(initialProvider) : null);
    const [savedForm, setSavedForm] = useState<ProviderForm | null>(
        initialProvider ? providerToForm(initialProvider) : null,
    );
    const [apiKey, setApiKey] = useState('');
    const [removeKey, setRemoveKey] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});
    const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
    const [error, setError] = useState<string | null>(null);
    const [savedFlash, setSavedFlash] = useState(false);
    const [pendingNav, setPendingNav] = useState<PendingNav>(null);
    const [pendingBusy, setPendingBusy] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const previousSelectionRef = useRef<string | null>(initialProvider?.id ?? null);
    const savedTimerRef = useRef<number | null>(null);
    const savingRef = useRef(false);
    const testRequestRef = useRef(0);
    const selectionRef = useRef({ mode, selectedId });
    const saveShortcutRef = useRef<{ save: () => Promise<boolean>; busy: boolean }>({
        save: async () => false,
        busy: false,
    });

    useEffect(() => {
        selectionRef.current = { mode, selectedId };
    }, [mode, selectedId]);

    useEffect(
        () => () => {
            if (savedTimerRef.current !== null) {
                window.clearTimeout(savedTimerRef.current);
            }
        },
        [],
    );

    const selectedProvider =
        mode === 'existing' ? (settings.providers.find((provider) => provider.id === selectedId) ?? null) : null;
    const isActive = mode === 'existing' && selectedId !== null && settings.activeProviderId === selectedId;
    const resultKey = mode === 'new' ? 'draft' : (selectedId ?? 'draft');
    const currentResult = testResults[resultKey];
    const currentModels = models[resultKey] ?? [];
    const storedKey = Boolean(selectedProvider?.hasKey);
    const typedKey = apiKey.trim().length > 0;
    const willRemoveKey = removeKey && storedKey;
    const anyEnabled = settings.providers.some((provider) => provider.enabled);

    const dirty =
        mode === 'new'
            ? form !== null
            : form !== null && savedForm !== null
              ? !formsEqual(form, savedForm) || typedKey || removeKey
              : form !== null;

    const flashSaved = () => {
        if (savedTimerRef.current !== null) {
            window.clearTimeout(savedTimerRef.current);
        }
        setSavedFlash(true);
        savedTimerRef.current = window.setTimeout(() => {
            setSavedFlash(false);
            savedTimerRef.current = null;
        }, 1800);
    };

    const clearResultForKey = (key: string) => {
        testRequestRef.current += 1;
        setTestResults((current) => {
            if (!(key in current)) {
                return current;
            }
            const next = { ...current };
            delete next[key];
            return next;
        });
        setModels((current) => {
            if (!(key in current)) {
                return current;
            }
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const clearTest = () => clearResultForKey(resultKey);

    const patchForm = (patch: Partial<ProviderForm>, options?: { invalidateTest?: boolean }) => {
        setForm((current) => (current ? { ...current, ...patch } : current));
        setError(null);
        setSavedFlash(false);
        if (options?.invalidateTest) {
            clearTest();
        }
    };

    const changeKind = (kind: ProviderKind) => {
        setForm((current) => {
            if (!current) {
                return current;
            }
            const previousDefault = DEFAULT_BASE_URLS[current.kind];
            const shouldReplace = !current.baseUrl.trim() || current.baseUrl === previousDefault;
            return {
                ...current,
                kind,
                baseUrl: shouldReplace ? DEFAULT_BASE_URLS[kind] : current.baseUrl,
            };
        });
        setError(null);
        setSavedFlash(false);
        clearTest();
    };

    const selectProvider = (id: string) => {
        const provider = settings.providers.find((candidate) => candidate.id === id);
        if (!provider) {
            return;
        }
        const next = providerToForm(provider);
        setMode('existing');
        setSelectedId(provider.id);
        setForm(next);
        setSavedForm(next);
        setApiKey('');
        setRemoveKey(false);
        setShowKey(false);
        setError(null);
        previousSelectionRef.current = provider.id;
        selectionRef.current = { mode: 'existing', selectedId: provider.id };
        testRequestRef.current += 1;
    };

    const beginCreate = () => {
        previousSelectionRef.current = selectedId ?? previousSelectionRef.current;
        setMode('new');
        setSelectedId(null);
        setForm(null);
        setSavedForm(null);
        setApiKey('');
        setRemoveKey(false);
        setShowKey(false);
        setError(null);
        clearResultForKey('draft');
        selectionRef.current = { mode: 'new', selectedId: null };
    };

    const chooseKind = (kind: ProviderKind) => {
        setForm({
            name: uniqueName(defaultName(kind), settings.providers),
            kind,
            baseUrl: DEFAULT_BASE_URLS[kind],
            model: '',
            enabled: true,
            headers: [],
        });
        setError(null);
        clearResultForKey('draft');
    };

    const cancelCreate = () => {
        const previous = previousSelectionRef.current
            ? settings.providers.find((provider) => provider.id === previousSelectionRef.current)
            : null;
        const fallback =
            previous ??
            settings.providers.find((provider) => provider.id === settings.activeProviderId) ??
            settings.providers.find((provider) => provider.enabled) ??
            settings.providers[0] ??
            null;

        if (fallback) {
            selectProvider(fallback.id);
            return;
        }

        setMode('new');
        setSelectedId(null);
        setForm(null);
        setSavedForm(null);
        setApiKey('');
        setRemoveKey(false);
        setShowKey(false);
        setError(null);
        selectionRef.current = { mode: 'new', selectedId: null };
    };

    const discard = () => {
        setError(null);
        setApiKey('');
        setRemoveKey(false);
        setShowKey(false);
        clearResultForKey(resultKey);
        if (mode === 'new') {
            cancelCreate();
            return;
        }
        if (savedForm) {
            setForm(cloneProviderForm(savedForm));
            return;
        }
        const provider = selectedProvider ?? settings.providers.find((item) => item.id === selectedId) ?? null;
        if (provider) {
            const next = providerToForm(provider);
            setForm(next);
            setSavedForm(next);
        }
    };

    const save = async (): Promise<boolean> => {
        if (!form || savingRef.current) {
            return false;
        }
        const problem = validateForm(form);
        if (problem) {
            setError(problem);
            return false;
        }
        if (mode === 'existing' && !dirty) {
            return true;
        }

        setError(null);
        const input: ProviderInput = {
            ...formToInput(form),
            ...(typedKey ? { apiKey: apiKey.trim() } : willRemoveKey ? { apiKey: '' } : {}),
        };
        const started = { mode, selectedId };
        savingRef.current = true;

        try {
            if (started.mode === 'new') {
                const created = await createProvider.mutateAsync(input);
                if (selectionRef.current.mode === 'new') {
                    const next = providerToForm(created);
                    setMode('existing');
                    setSelectedId(created.id);
                    setForm(next);
                    setSavedForm(next);
                    previousSelectionRef.current = created.id;
                    selectionRef.current = { mode: 'existing', selectedId: created.id };
                    setApiKey('');
                    setRemoveKey(false);
                    setShowKey(false);
                    flashSaved();
                }
                pushToast(`Added ${created.name}.`, 'success');
                return true;
            }

            if (!started.selectedId) {
                return false;
            }
            const updated = await updateProvider.mutateAsync({ id: started.selectedId, input });
            const stillSelected =
                selectionRef.current.mode === 'existing' && selectionRef.current.selectedId === started.selectedId;
            if (stillSelected) {
                const next = providerToForm(updated);
                setForm(next);
                setSavedForm(next);
                setApiKey('');
                setRemoveKey(false);
                setShowKey(false);
                flashSaved();
            }
            pushToast('Provider saved.', 'success');
            return true;
        } catch (caught) {
            setError(errorMessage(caught, 'Could not save the provider.'));
            return false;
        } finally {
            savingRef.current = false;
        }
    };

    // Keep the keyboard shortcut pointed at the latest save closure and busy state.
    useEffect(() => {
        saveShortcutRef.current = {
            save,
            busy: createProvider.isPending || updateProvider.isPending || testDraft.isPending,
        };
    });

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
                return;
            }
            if (document.querySelector('[role="alertdialog"]')) {
                return;
            }
            event.preventDefault();
            if (!saveShortcutRef.current.busy) {
                void saveShortcutRef.current.save();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const runTest = async (withModels: boolean) => {
        if (!form) {
            return;
        }
        const problem = validateForm(form);
        if (problem) {
            setError(problem);
            return;
        }

        setError(null);
        const requestId = ++testRequestRef.current;
        const body: ProviderDraftTestInput = {
            provider: formToInput(form),
            ...(mode === 'existing' && selectedId && !typedKey && !willRemoveKey
                ? { savedProviderId: selectedId }
                : {}),
            ...(typedKey ? { apiKey: apiKey.trim() } : willRemoveKey ? { apiKey: '' } : {}),
        };

        try {
            const result = await testDraft.mutateAsync(body);
            if (testRequestRef.current !== requestId) {
                return;
            }
            setTestResults((current) => ({ ...current, [resultKey]: result }));
            if (withModels && result.ok) {
                setModels((current) => ({ ...current, [resultKey]: result.models ?? [] }));
            }
        } catch (caught) {
            if (testRequestRef.current !== requestId) {
                return;
            }
            setTestResults((current) => ({
                ...current,
                [resultKey]: { ok: false, message: errorMessage(caught, 'Connection failed.') },
            }));
        }
    };

    const requestSelect = (id: string) => {
        if (mode === 'existing' && id === selectedId) {
            return;
        }
        if (dirty) {
            setPendingNav({ type: 'select', id });
            return;
        }
        selectProvider(id);
    };

    const requestCreate = () => {
        if (mode === 'new') {
            return;
        }
        if (dirty) {
            setPendingNav({ type: 'create' });
            return;
        }
        beginCreate();
    };

    const applyPending = () => {
        const nav = pendingNav;
        setPendingNav(null);
        if (!nav) {
            return;
        }
        if (nav.type === 'select') {
            selectProvider(nav.id);
        } else {
            beginCreate();
        }
    };

    const saveAndApplyPending = async () => {
        setPendingBusy(true);
        const ok = await save();
        setPendingBusy(false);
        if (ok) {
            applyPending();
        } else {
            setPendingNav(null);
        }
    };

    const discardAndApplyPending = () => {
        discard();
        applyPending();
    };

    const activateProvider = async () => {
        if (!selectedId || dirty || !form?.enabled) {
            return;
        }
        setError(null);
        try {
            await updateSettings.mutateAsync({ activeProviderId: selectedId });
            pushToast(`${form.name.trim() || 'Provider'} is now active.`, 'success');
        } catch (caught) {
            setError(errorMessage(caught, 'Could not change the active provider.'));
        }
    };

    const duplicate = async () => {
        if (!form || mode === 'new') {
            return;
        }
        setError(null);
        try {
            const created = await createProvider.mutateAsync({
                ...formToInput(form),
                name: uniqueName(`${form.name.trim() || 'Provider'} copy`, settings.providers),
            });
            const next = providerToForm(created);
            setMode('existing');
            setSelectedId(created.id);
            setForm(next);
            setSavedForm(next);
            previousSelectionRef.current = created.id;
            selectionRef.current = { mode: 'existing', selectedId: created.id };
            testRequestRef.current += 1;
            setApiKey('');
            setRemoveKey(false);
            setShowKey(false);
            pushToast(`Added ${created.name}. Add its API key if it needs one.`, 'success');
        } catch (caught) {
            setError(errorMessage(caught, 'Could not duplicate the provider.'));
        }
    };

    const removeProvider = async () => {
        if (!selectedId) {
            return;
        }
        setError(null);
        try {
            await deleteProvider.mutateAsync(selectedId);
            const remaining = settings.providers.filter((provider) => provider.id !== selectedId);
            const next = remaining.find((provider) => provider.enabled) ?? remaining[0] ?? null;
            setDeleteOpen(false);
            if (next) {
                selectProvider(next.id);
            } else {
                setMode('new');
                setSelectedId(null);
                setForm(null);
                setSavedForm(null);
                setApiKey('');
                setRemoveKey(false);
                setShowKey(false);
                previousSelectionRef.current = null;
                selectionRef.current = { mode: 'new', selectedId: null };
                testRequestRef.current += 1;
            }
            pushToast('Provider deleted.', 'success');
        } catch (caught) {
            setError(errorMessage(caught, 'Could not delete the provider.'));
            setDeleteOpen(false);
        }
    };

    const updateHeader = (id: string, patch: Partial<HeaderRow>) => {
        setForm((current) =>
            current
                ? {
                      ...current,
                      headers: current.headers.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                  }
                : current,
        );
        setError(null);
        clearTest();
    };

    useImperativeHandle(handleRef, () => ({
        isDirty: () => dirty,
        save,
        discard,
    }));

    const modelListId = `${idPrefix}-models`;
    const formId = `${idPrefix}-provider-form`;
    const keyId = `${idPrefix}-provider-key`;
    const switchId = `${idPrefix}-provider-enabled`;
    const headerCount = form ? form.headers.filter((row) => row.name.trim()).length : 0;
    const useDisabledReason = dirty
        ? 'Save your changes before switching the active provider.'
        : !form?.enabled
          ? 'Enable this provider before using it.'
          : 'Make this the provider new messages use.';

    const createBusy = createProvider.isPending;
    const updateBusy = updateProvider.isPending;
    const testBusy = testDraft.isPending;
    const saveBusy = createBusy || updateBusy;

    const renderPicker = () => (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-3 border-b border-line-soft px-4 py-3 md:px-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-amber/25 bg-amber/10 text-[11px] font-semibold tracking-wide text-amber">
                    +
                </span>
                <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium text-parchment">Add provider</h4>
                    <p className="truncate text-[11px] text-muted">Choose the service this provider talks to.</p>
                </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
                <div className="grid gap-2 sm:grid-cols-2">
                    {KIND_ORDER.map((kind) => (
                        <button
                            key={kind}
                            type="button"
                            onClick={() => chooseKind(kind)}
                            className="rounded-xl border border-line bg-surface/50 p-4 text-left transition hover:border-amber/50 hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                        >
                            <span className="flex items-center gap-2">
                                <span className="flex size-8 items-center justify-center rounded-lg border border-line bg-ink-soft/70 text-[10px] font-semibold tracking-wide text-parchment-dim">
                                    {KIND_INITIALS[kind]}
                                </span>
                                <span className="text-sm font-medium text-parchment">{PROVIDER_KIND_LABELS[kind]}</span>
                            </span>
                            <span className="mt-2 block text-xs leading-relaxed text-muted">{KIND_HINTS[kind]}</span>
                            <span className="mt-2 block truncate font-mono text-[11px] text-parchment-dim">
                                {DEFAULT_BASE_URLS[kind] || 'Custom base URL'}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="mt-5 flex justify-end">
                    {settings.providers.length > 0 ? (
                        <button type="button" className="btn-ghost" onClick={cancelCreate}>
                            Cancel
                        </button>
                    ) : null}
                </div>
            </div>
        </div>
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            {!anyEnabled ? (
                <div className="shrink-0 border-b border-amber/30 bg-amber/10 px-4 py-2 text-xs leading-relaxed text-parchment-dim">
                    No provider is enabled. Chats will not generate until one is enabled and saved.
                </div>
            ) : null}

            <div className="flex min-h-0 flex-1">
                <div className="hidden w-60 shrink-0 flex-col border-r border-line-soft lg:flex">
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {settings.providers.length === 0 ? (
                            <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted">
                                No providers yet.
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {settings.providers.map((provider) => {
                                    const active = provider.id === settings.activeProviderId;
                                    const keyMissing = requiresKey(provider.kind) && !provider.hasKey;
                                    const selected = mode === 'existing' && provider.id === selectedId;
                                    return (
                                        <li key={provider.id}>
                                            <button
                                                type="button"
                                                onClick={() => requestSelect(provider.id)}
                                                aria-current={selected ? 'true' : undefined}
                                                aria-label={`${provider.name}, ${PROVIDER_KIND_LABELS[provider.kind]}${
                                                    active ? ', active' : ''
                                                }${!provider.enabled ? ', disabled' : ''}${
                                                    keyMissing ? ', no API key saved' : ''
                                                }`}
                                                className={cn(
                                                    'relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
                                                    selected
                                                        ? 'bg-surface-2 ring-1 ring-amber/30'
                                                        : 'hover:bg-surface/70',
                                                )}
                                            >
                                                {selected ? (
                                                    <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-amber" />
                                                ) : null}
                                                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-ink-soft/70 text-[10px] font-semibold tracking-wide text-parchment-dim">
                                                    {KIND_INITIALS[provider.kind]}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex items-center gap-1.5">
                                                        <span
                                                            className={cn(
                                                                'truncate text-sm',
                                                                provider.enabled
                                                                    ? 'text-parchment'
                                                                    : 'text-parchment-dim',
                                                            )}
                                                        >
                                                            {provider.name}
                                                        </span>
                                                        {active ? (
                                                            <Check size={12} className="shrink-0 text-amber" />
                                                        ) : null}
                                                    </span>
                                                    <span className="block truncate text-[11px] text-muted">
                                                        {PROVIDER_KIND_LABELS[provider.kind]}
                                                        {provider.model ? ` · ${provider.model}` : ''}
                                                    </span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1">
                                                    {keyMissing ? (
                                                        <KeyRound
                                                            size={12}
                                                            className="text-amber/80"
                                                            aria-label="No API key saved"
                                                        />
                                                    ) : provider.hasKey ? (
                                                        <KeyRound
                                                            size={12}
                                                            className="text-sage/80"
                                                            aria-label="API key stored"
                                                        />
                                                    ) : null}
                                                    {!provider.enabled ? (
                                                        <span className="rounded-full border border-line px-1.5 py-0.5 text-[11px] text-muted">
                                                            Off
                                                        </span>
                                                    ) : null}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                    <div className="shrink-0 border-t border-line-soft p-2">
                        <button
                            type="button"
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2 text-sm text-muted transition hover:border-amber/50 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={requestCreate}
                            disabled={mode === 'new'}
                            title={mode === 'new' ? 'Finish or cancel the new provider first' : undefined}
                        >
                            <Plus size={15} />
                            Add provider
                        </button>
                    </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="shrink-0 border-b border-line-soft p-3 lg:hidden">
                        <label className="label-text" htmlFor={`${idPrefix}-provider-select`}>
                            Provider
                        </label>
                        <div className="flex items-center gap-2">
                            <select
                                id={`${idPrefix}-provider-select`}
                                className="input-shell min-w-0 flex-1"
                                value={mode === 'new' ? '' : (selectedId ?? '')}
                                onChange={(event) => {
                                    if (event.target.value) {
                                        requestSelect(event.target.value);
                                    }
                                }}
                            >
                                {mode === 'new' ? <option value="">New provider…</option> : null}
                                {settings.providers.map((provider) => (
                                    <option key={provider.id} value={provider.id}>
                                        {provider.name}
                                        {provider.id === settings.activeProviderId ? ' (active)' : ''}
                                        {!provider.enabled ? ' (disabled)' : ''}
                                        {requiresKey(provider.kind) && !provider.hasKey ? ' (no key)' : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                className="btn-ghost shrink-0"
                                onClick={requestCreate}
                                disabled={mode === 'new'}
                                aria-label="Add provider"
                                title={mode === 'new' ? 'Finish or cancel the new provider first' : 'Add provider'}
                            >
                                <Plus size={15} />
                                Add
                            </button>
                        </div>
                    </div>

                    {mode === 'new' && !form ? (
                        renderPicker()
                    ) : !form ? (
                        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted">
                            No provider selected.
                        </div>
                    ) : (
                        <form
                            id={formId}
                            noValidate
                            className="flex min-h-0 flex-1 flex-col"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void save();
                            }}
                        >
                            <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-4 py-3 md:px-5">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-ink-soft/70 text-[11px] font-semibold tracking-wide text-parchment-dim">
                                    {KIND_INITIALS[form.kind]}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <h4 className="truncate text-sm font-medium text-parchment">
                                        {form.name.trim() || 'New provider'}
                                    </h4>
                                    <p className="truncate text-[11px] text-muted">
                                        {PROVIDER_KIND_LABELS[form.kind]}
                                        {form.model.trim() ? ` · ${form.model.trim()}` : ''}
                                        {!form.enabled ? ' · Disabled' : ''}
                                        {isActive ? ' · Active' : ''}
                                    </p>
                                </div>
                                {mode === 'existing' ? (
                                    isActive ? (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-1 text-[11px] text-amber">
                                            <Check size={12} />
                                            Active provider
                                        </span>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-2">
                                            {!form.enabled ? (
                                                <span className="text-[11px] text-muted">
                                                    Enable this provider to use it.
                                                </span>
                                            ) : dirty ? (
                                                <span className="text-[11px] text-amber">
                                                    Save changes to activate.
                                                </span>
                                            ) : null}
                                            <button
                                                type="button"
                                                className="btn-ghost"
                                                onClick={() => void activateProvider()}
                                                disabled={dirty || !form.enabled || updateSettings.isPending}
                                                title={useDisabledReason}
                                            >
                                                <Check size={15} />
                                                Use provider
                                            </button>
                                        </div>
                                    )
                                ) : null}
                            </header>

                            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5">
                                <div className="space-y-6">
                                    <FormSection
                                        title="Connection"
                                        description="Where CatCup sends chat requests and which model it asks for."
                                    >
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <div>
                                                <label className="label-text" htmlFor={`${idPrefix}-provider-name`}>
                                                    Name
                                                </label>
                                                <input
                                                    id={`${idPrefix}-provider-name`}
                                                    className="input-shell"
                                                    value={form.name}
                                                    maxLength={80}
                                                    required
                                                    onChange={(event) => patchForm({ name: event.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="label-text" htmlFor={`${idPrefix}-provider-kind`}>
                                                    Type
                                                </label>
                                                <select
                                                    id={`${idPrefix}-provider-kind`}
                                                    className="input-shell"
                                                    value={form.kind}
                                                    onChange={(event) => changeKind(event.target.value as ProviderKind)}
                                                >
                                                    {KIND_ORDER.map((kind) => (
                                                        <option key={kind} value={kind}>
                                                            {PROVIDER_KIND_LABELS[kind]}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="mt-4">
                                            <label className="label-text" htmlFor={`${idPrefix}-provider-base-url`}>
                                                Base URL
                                            </label>
                                            <input
                                                id={`${idPrefix}-provider-base-url`}
                                                className="input-shell"
                                                type="url"
                                                value={form.baseUrl}
                                                maxLength={500}
                                                spellCheck={false}
                                                placeholder={DEFAULT_BASE_URLS[form.kind] || 'https://example.com/v1'}
                                                onChange={(event) =>
                                                    patchForm({ baseUrl: event.target.value }, { invalidateTest: true })
                                                }
                                            />
                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <p className="field-hint mt-0">
                                                    {DEFAULT_BASE_URLS[form.kind]
                                                        ? `Default: ${DEFAULT_BASE_URLS[form.kind]}`
                                                        : 'Required for a custom endpoint.'}
                                                </p>
                                                {DEFAULT_BASE_URLS[form.kind] &&
                                                form.baseUrl !== DEFAULT_BASE_URLS[form.kind] ? (
                                                    <button
                                                        type="button"
                                                        className="inline-flex min-h-8 items-center text-[11px] text-amber/80 transition hover:text-amber"
                                                        onClick={() =>
                                                            patchForm(
                                                                { baseUrl: DEFAULT_BASE_URLS[form.kind] },
                                                                { invalidateTest: true },
                                                            )
                                                        }
                                                    >
                                                        Use default
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>

                                        <div className="mt-4">
                                            <label className="label-text" htmlFor={`${idPrefix}-provider-model`}>
                                                Model
                                            </label>
                                            <div className="flex gap-2">
                                                <input
                                                    id={`${idPrefix}-provider-model`}
                                                    className="input-shell"
                                                    list={currentModels.length > 0 ? modelListId : undefined}
                                                    value={form.model}
                                                    maxLength={200}
                                                    spellCheck={false}
                                                    placeholder="e.g. gpt-5"
                                                    onChange={(event) => patchForm({ model: event.target.value })}
                                                />
                                                <button
                                                    type="button"
                                                    className="btn-ghost shrink-0"
                                                    onClick={() => void runTest(true)}
                                                    disabled={testBusy || !form}
                                                    title="Ask the provider for its model list; this also tests the connection"
                                                >
                                                    {testBusy ? <Spinner size={15} /> : <RefreshCw size={15} />}
                                                    Fetch models
                                                </button>
                                            </div>
                                            <datalist id={modelListId}>
                                                {currentModels.map((model) => (
                                                    <option key={model.id} value={model.id}>
                                                        {model.name ?? model.id}
                                                    </option>
                                                ))}
                                            </datalist>
                                            <p className="field-hint">
                                                Any model id is accepted; the list is only a suggestion.
                                                {currentModels.length > 0
                                                    ? ` ${currentModels.length} model(s) loaded.`
                                                    : ''}
                                            </p>
                                        </div>
                                    </FormSection>

                                    <FormSection
                                        title="Authentication"
                                        description="The key is write-only: the browser only learns whether one is stored."
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <label className="label-text mb-0" htmlFor={keyId}>
                                                API key
                                            </label>
                                            <div className="flex items-center gap-2">
                                                {willRemoveKey ? (
                                                    <span className="rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[10px] text-amber">
                                                        Removal pending
                                                    </span>
                                                ) : typedKey ? (
                                                    <span className="rounded-full border border-sage/40 bg-sage/10 px-2 py-0.5 text-[10px] text-sage">
                                                        New key
                                                    </span>
                                                ) : storedKey ? (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-sage/40 bg-sage/10 px-2 py-0.5 text-[10px] text-sage">
                                                        <KeyRound size={10} />
                                                        Key stored
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <div className="relative mt-2">
                                            <input
                                                id={keyId}
                                                className="input-shell pr-11"
                                                type={showKey ? 'text' : 'password'}
                                                value={apiKey}
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder={
                                                    storedKey
                                                        ? 'Saved — enter a new key to replace it'
                                                        : 'API key (if required)'
                                                }
                                                onChange={(event) => {
                                                    setApiKey(event.target.value);
                                                    if (event.target.value.trim()) {
                                                        setRemoveKey(false);
                                                    }
                                                    setError(null);
                                                    clearTest();
                                                }}
                                            />
                                            <button
                                                type="button"
                                                className="icon-btn absolute right-1.5 top-1/2 size-8 -translate-y-1/2"
                                                onClick={() => setShowKey((current) => !current)}
                                                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                                            >
                                                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                                            </button>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                            {storedKey && !willRemoveKey ? (
                                                <button
                                                    type="button"
                                                    className="inline-flex min-h-8 items-center text-[11px] text-muted transition hover:text-wine"
                                                    onClick={() => {
                                                        setRemoveKey(true);
                                                        setApiKey('');
                                                    }}
                                                >
                                                    Clear saved key
                                                </button>
                                            ) : null}
                                            {willRemoveKey ? (
                                                <>
                                                    <p className="m-0 text-[11px] text-amber">
                                                        The saved key will be removed when you save.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        className="inline-flex min-h-8 items-center text-[11px] text-muted transition hover:text-parchment"
                                                        onClick={() => setRemoveKey(false)}
                                                    >
                                                        Undo
                                                    </button>
                                                </>
                                            ) : null}
                                        </div>
                                        <p className="field-hint">
                                            Stored in <code>data/secrets.json</code> on the server. The browser only
                                            receives a &ldquo;has key&rdquo; flag.
                                        </p>
                                        {form.kind === 'ollama' ? (
                                            <p className="field-hint">Ollama usually needs no key; leave this blank.</p>
                                        ) : null}
                                    </FormSection>

                                    <details className="group rounded-xl border border-line-soft bg-ink-soft/40 px-4 py-3">
                                        <summary className="flex cursor-pointer select-none items-center gap-2 text-sm text-parchment-dim">
                                            <ChevronDown
                                                size={15}
                                                className="transition group-open:rotate-180"
                                                aria-hidden="true"
                                            />
                                            Advanced
                                            <span className="text-[11px] text-muted">
                                                {headerCount} custom header{headerCount === 1 ? '' : 's'}
                                            </span>
                                        </summary>
                                        <div className="mt-4 space-y-2">
                                            {form.headers.length === 0 ? (
                                                <p className="text-xs text-muted">No custom headers.</p>
                                            ) : null}
                                            {form.headers.map((row) => (
                                                <div
                                                    key={row.id}
                                                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"
                                                >
                                                    <input
                                                        className="input-shell py-2 text-xs"
                                                        value={row.name}
                                                        placeholder="Header name"
                                                        aria-label="Header name"
                                                        spellCheck={false}
                                                        onChange={(event) =>
                                                            updateHeader(row.id, { name: event.target.value })
                                                        }
                                                    />
                                                    <input
                                                        className="input-shell py-2 text-xs"
                                                        value={row.value}
                                                        placeholder="Value"
                                                        aria-label="Header value"
                                                        spellCheck={false}
                                                        onChange={(event) =>
                                                            updateHeader(row.id, { value: event.target.value })
                                                        }
                                                    />
                                                    <button
                                                        type="button"
                                                        className="icon-btn size-9 hover:text-wine"
                                                        onClick={() => {
                                                            setForm((current) =>
                                                                current
                                                                    ? {
                                                                          ...current,
                                                                          headers: current.headers.filter(
                                                                              (item) => item.id !== row.id,
                                                                          ),
                                                                      }
                                                                    : current,
                                                            );
                                                            setError(null);
                                                            clearTest();
                                                        }}
                                                        aria-label="Remove header"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                className="btn-ghost mt-1 px-2.5 py-1.5 text-xs"
                                                onClick={() => {
                                                    setForm((current) =>
                                                        current
                                                            ? {
                                                                  ...current,
                                                                  headers: [
                                                                      ...current.headers,
                                                                      {
                                                                          id: crypto.randomUUID(),
                                                                          name: '',
                                                                          value: '',
                                                                      },
                                                                  ],
                                                              }
                                                            : current,
                                                    );
                                                    setError(null);
                                                    clearTest();
                                                }}
                                            >
                                                <Plus size={14} />
                                                Add header
                                            </button>
                                            <p className="field-hint">
                                                Sent with every request. Some providers need headers such as{' '}
                                                <code>HTTP-Referer</code>.
                                            </p>
                                        </div>
                                    </details>

                                    <FormSection
                                        title="Provider state"
                                        description="Disabled providers are skipped when CatCup picks a model."
                                    >
                                        <div className="flex items-start gap-3">
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={form.enabled}
                                                aria-labelledby={switchId}
                                                disabled={isActive}
                                                onClick={() => patchForm({ enabled: !form.enabled })}
                                                className={cn(
                                                    'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-50',
                                                    form.enabled
                                                        ? 'border-amber/50 bg-amber/80'
                                                        : 'border-line bg-ink-soft',
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        'inline-block size-4 rounded-full bg-parchment transition',
                                                        form.enabled ? 'translate-x-6' : 'translate-x-1',
                                                    )}
                                                />
                                            </button>
                                            <div className="min-w-0">
                                                <p id={switchId} className="text-sm font-medium text-parchment">
                                                    Enabled
                                                </p>
                                                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                                                    {isActive
                                                        ? 'The active provider stays enabled. Choose another provider first if you want to disable it.'
                                                        : 'Enabled providers can be selected for chats and fallback.'}
                                                </p>
                                            </div>
                                        </div>
                                    </FormSection>

                                    {mode === 'existing' ? (
                                        <FormSection
                                            title="Provider actions"
                                            description="Duplicate this configuration, or remove it and its saved key."
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <button
                                                    type="button"
                                                    className="btn-ghost"
                                                    onClick={() => void duplicate()}
                                                    disabled={createBusy}
                                                >
                                                    {createBusy ? <Spinner size={15} /> : <Copy size={15} />}
                                                    Duplicate provider
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn-ghost hover:border-wine/50 hover:text-wine"
                                                    onClick={() => setDeleteOpen(true)}
                                                    disabled={
                                                        deleteProvider.isPending || settings.providers.length <= 1
                                                    }
                                                    title={
                                                        settings.providers.length <= 1
                                                            ? 'Keep at least one provider'
                                                            : 'Delete this provider and its saved key'
                                                    }
                                                >
                                                    {deleteProvider.isPending ? (
                                                        <Spinner size={15} />
                                                    ) : (
                                                        <Trash2 size={15} />
                                                    )}
                                                    Delete provider
                                                </button>
                                            </div>
                                            {settings.providers.length <= 1 ? (
                                                <p className="field-hint">Keep at least one provider.</p>
                                            ) : null}
                                        </FormSection>
                                    ) : null}
                                </div>
                            </div>

                            {error ? (
                                <div
                                    className="max-h-24 shrink-0 overflow-y-auto border-t border-wine/40 bg-wine/10 px-4 py-2 text-sm leading-relaxed text-parchment md:px-5"
                                    role="alert"
                                >
                                    {error}
                                </div>
                            ) : null}

                            {currentResult ? (
                                <div
                                    className={cn(
                                        'flex shrink-0 items-start gap-2 border-t px-4 py-2 text-xs leading-relaxed md:px-5',
                                        currentResult.ok
                                            ? 'border-sage/40 bg-sage/10 text-parchment-dim'
                                            : 'border-wine/40 bg-wine/10 text-parchment-dim',
                                    )}
                                    role={currentResult.ok ? 'status' : 'alert'}
                                >
                                    <span
                                        className={cn('mt-0.5 shrink-0', currentResult.ok ? 'text-sage' : 'text-wine')}
                                    >
                                        {currentResult.ok ? <Check size={14} /> : <X size={14} />}
                                    </span>
                                    <span className="max-h-24 min-w-0 flex-1 overflow-y-auto">
                                        <span className="font-medium text-parchment">
                                            {currentResult.ok ? 'Connection OK' : 'Connection failed'}
                                        </span>
                                        {' — '}
                                        {currentResult.message}
                                    </span>
                                    <button
                                        type="button"
                                        className="icon-btn size-8 shrink-0"
                                        onClick={() =>
                                            setTestResults((current) => {
                                                const next = { ...current };
                                                delete next[resultKey];
                                                return next;
                                            })
                                        }
                                        aria-label="Dismiss connection result"
                                    >
                                        <X size={13} />
                                    </button>
                                </div>
                            ) : null}

                            <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line-soft px-4 py-3 md:px-5">
                                <div className="mr-auto flex items-center gap-2 text-xs text-muted">
                                    {mode === 'new' ? (
                                        <span>Not saved yet</span>
                                    ) : dirty ? (
                                        <>
                                            <span className="size-1.5 rounded-full bg-amber" aria-hidden="true" />
                                            <span className="text-amber">Unsaved changes</span>
                                            <button
                                                type="button"
                                                className="inline-flex min-h-8 items-center text-muted transition hover:text-parchment"
                                                onClick={discard}
                                            >
                                                Discard
                                            </button>
                                        </>
                                    ) : savedFlash ? (
                                        <>
                                            <Check size={13} className="text-sage" />
                                            <span className="text-sage">Saved</span>
                                        </>
                                    ) : null}
                                </div>
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => void runTest(false)}
                                    disabled={testBusy || saveBusy || !form}
                                >
                                    {testBusy ? <Spinner size={15} /> : <PlugZap size={15} />}
                                    Test connection
                                </button>
                                {mode === 'new' ? (
                                    <>
                                        <button type="button" className="btn-ghost" onClick={cancelCreate}>
                                            Cancel
                                        </button>
                                        <button type="submit" className="btn-primary" disabled={createBusy}>
                                            {createBusy ? <Spinner size={15} /> : <Plus size={15} />}
                                            Create provider
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="submit"
                                        className="btn-primary"
                                        disabled={!dirty || updateBusy || testBusy}
                                    >
                                        {updateBusy ? <Spinner size={15} /> : <Save size={15} />}
                                        Save changes
                                    </button>
                                )}
                            </footer>
                        </form>
                    )}
                </div>
            </div>

            <ConfirmDialog
                open={pendingNav !== null}
                title="Save changes first?"
                description="Your provider changes have not been saved. Save them before continuing, or discard the edits."
                confirmLabel="Save and continue"
                alternateLabel="Discard changes"
                cancelLabel="Keep editing"
                onConfirm={() => void saveAndApplyPending()}
                onAlternate={discardAndApplyPending}
                onCancel={() => setPendingNav(null)}
                busy={pendingBusy}
                initialFocus="cancel"
            />

            <ConfirmDialog
                open={deleteOpen}
                title={`Delete ${selectedProvider?.name || form?.name.trim() || 'this provider'}?`}
                description="Its configuration and saved API key are removed. Chats that use it will fail until another provider is active."
                confirmLabel="Delete provider"
                cancelLabel="Keep provider"
                tone="danger"
                onConfirm={() => void removeProvider()}
                onCancel={() => setDeleteOpen(false)}
                busy={deleteProvider.isPending}
                initialFocus="cancel"
            />
        </div>
    );
}
