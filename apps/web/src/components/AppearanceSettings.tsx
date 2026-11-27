import { checkSkin, SKIN_CONTRAST_PAIRS, type SkinManifest, skinManifestSchema } from '@catcup/shared';
import { AlertTriangle, Check, Paintbrush, RotateCcw, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useImportSkin, useInstallSkin, useRemoveSkin, useSettings, useSkins, useUpdateSettings } from '../hooks/data';
import { cn } from '../lib/cn';
import { type RegisterSettingsDraft, useSettingsDraftHandle } from '../lib/settingsDraft';
import { useAppStore } from '../store/app';
import { applySkin, type InstalledSkin, toInstalledSkin, useSkinStore } from '../store/skin';
import { Spinner } from './Spinner';

/**
 * Appearance: which skin is applied, and what installing one tells you first.
 *
 * A skin is a file a person brings; the app carries one built-in theme. That is
 * why this panel has no colour pickers. A picker would be a second way to make
 * a skin, and the two would immediately disagree about what a skin is — this
 * one reads `catcup.skin` and nothing else. See `docs/RFC/0007-skins-and-packs.md`.
 */

/** What the review sheet shows before a skin is accepted. */
interface PendingSkin {
    fileName: string;
    manifest: SkinManifest;
    installed: InstalledSkin;
    warnings: { foreground: string; background: string; ratio: number }[];
    unreadable: string[];
    /** The file to upload, when the manifest came out of an archive. */
    kind?: 'manifest' | 'archive';
    file?: File;
}

/**
 * Read a `.json` skin the way the container will read a `.catcup`.
 *
 * Two shapes arrive here. A bare `manifest.json` is read and validated in the
 * browser, so the review sheet can show its tokens and warnings before a single
 * byte is sent. A `.catcup` is a ZIP, which the browser cannot open — the server
 * reads it, so the file is uploaded and the review sheet appears once it has.
 *
 * The browser's copy of the schema is the same one the server validates with,
 * so a manifest refused here would be refused there, and the two paths cannot
 * drift about what a skin is.
 */
async function readSkinFile(file: File): Promise<PendingSkin> {
    // A `.catcup` is a ZIP: the manifest is inside it and only the server can
    // read one. The review sheet still needs the manifest to show what will be
    // installed, so an archive is previewed after the upload rather than
    // before — `kind` says which happened.
    if (/\.catcup$/i.test(file.name)) {
        return {
            kind: 'archive',
            fileName: file.name,
            file,
            // Filled in by the caller once the server has read the archive.
            manifest: {} as SkinManifest,
            installed: { id: '', name: file.name, scope: 'app', colorScheme: 'dark', hasCss: false, properties: {} },
            warnings: [],
            unreadable: [],
        };
    }

    const text = await file.text();
    if (text.length > 256 * 1024) {
        throw new Error('A skin manifest is capped at 256 KB.');
    }

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error('That file is not valid JSON.');
    }

    const parsed = skinManifestSchema.safeParse(raw);
    if (!parsed.success) {
        // Name what is wrong rather than "invalid skin": the whole point of the
        // whitelist is that the author can act on the message.
        const issue = parsed.error.issues[0];
        const where = issue?.path.join('.') || 'manifest';
        throw new Error(`${where}: ${issue?.message ?? 'the manifest is not valid'}`);
    }

    const installed = toInstalledSkin(parsed.data);
    const check = checkSkin(parsed.data.tokens, SKIN_CONTRAST_PAIRS);
    return {
        kind: 'manifest',
        fileName: file.name,
        manifest: parsed.data,
        installed,
        warnings: check.findings,
        unreadable: check.unreadable,
    };
}

export function AppearanceSettings({ registerDraft }: { registerDraft?: RegisterSettingsDraft }) {
    const settings = useSettings().data;
    const updateSettings = useUpdateSettings();
    const pushToast = useAppStore((state) => state.pushToast);
    const skinsQuery = useSkins();
    const importSkin = useImportSkin();
    const installSkin = useInstallSkin();
    const removeSkin = useRemoveSkin();
    const installed = useSkinStore((state) => state.installed);
    const setInstalled = useSkinStore((state) => state.setInstalled);
    const active = useSkinStore((state) => state.active);
    const setActive = useSkinStore((state) => state.setActive);
    const fileRef = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState<PendingSkin | null>(null);
    const [reading, setReading] = useState(false);

    const activeId = settings?.ui.skinId ?? '';

    // The server is the source of truth: a skin is installed once and survives
    // a reload, a restart and a profile switch. The store is a mirror the
    // applier reads, not a second copy that could drift.
    useEffect(() => {
        if (skinsQuery.data) {
            setInstalled(skinsQuery.data.skins.map(toInstalledSkin));
        }
    }, [skinsQuery.data, setInstalled]);

    // The mirror the list draws from. Applying the skin is `SkinApplier`'s job,
    // at the app root: an effect here would only run while Settings is open,
    // which is exactly the bug the root component exists to avoid.
    useEffect(() => {
        setActive(installed.find((skin) => skin.id === activeId) ?? null);
    }, [activeId, installed, setActive]);

    const missingReference = activeId !== '' && active === null;
    const sorted = useMemo(() => [...installed].sort((a, b) => a.name.localeCompare(b.name)), [installed]);

    const choose = async (skin: InstalledSkin | null) => {
        try {
            await updateSettings.mutateAsync({ ui: { skinId: skin?.id ?? '' } });
            pushToast(skin ? `${skin.name} is now the active skin.` : 'Back to the built-in theme.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not switch the skin.', 'error');
        }
    };

    const accept = async () => {
        if (!pending) {
            return;
        }
        try {
            // An archive is read and stored by the server in one step; a bare
            // manifest was already validated here, so it is sent as-is. Both
            // end in the same stored file, because the route validates either.
            const skin = pending.file
                ? (await importSkin.mutateAsync(pending.file)).skin
                : (await installSkin.mutateAsync(pending.manifest)).skin;
            setPending(null);
            await choose(toInstalledSkin(skin));
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not install the skin.', 'error');
        }
    };

    /**
     * Removing the active skin clears the selection first, then the file.
     *
     * The other order would leave `ui.skinId` naming a skin that no longer
     * exists for as long as the two requests are apart — which is exactly the
     * state the panel draws a warning about.
     */
    const remove = async (skin: InstalledSkin) => {
        try {
            if (active?.id === skin.id) {
                await choose(null);
            }
            await removeSkin.mutateAsync(skin.id);
            pushToast(`${skin.name} was removed.`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not remove the skin.', 'error');
        }
    };

    useSettingsDraftHandle(registerDraft, {
        // Choosing a skin saves immediately, so there is never a pending edit
        // for the leave guard to hold. It registers anyway, because the guard's
        // rule is "every panel that can lose something", and a future field
        // here should not have to remember to add itself.
        isDirty: () => false,
        save: async () => true,
        discard: () => {},
    });

    const pickFile = async (file: File | undefined) => {
        if (!file) {
            return;
        }
        setReading(true);
        try {
            setPending(await readSkinFile(file));
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not read the skin.', 'error');
        } finally {
            setReading(false);
        }
    };

    return (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                A skin changes colours, type, spacing and elevation — everything the interface is painted with, and
                nothing about how it behaves.
            </p>

            {missingReference ? (
                <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-danger/40 bg-wine/10 px-3 py-2 text-sm text-parchment-dim"
                >
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
                    <span>
                        The skin this profile selected is no longer installed, so the built-in theme is showing.
                    </span>
                </div>
            ) : null}

            <section aria-labelledby="skin-list-heading">
                <h3 id="skin-list-heading" className="mb-2 text-sm font-medium text-parchment">
                    Installed skins
                </h3>

                <ul className="space-y-2">
                    <li
                        className={cn(
                            'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                            active === null ? 'border-amber/40 bg-amber/5' : 'border-line bg-surface/50',
                        )}
                    >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-amber/25 bg-amber/10 text-amber">
                            <Paintbrush size={16} aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-parchment">Built-in theme</p>
                            <p className="truncate text-footnote text-muted">The tavern ledger this app ships with.</p>
                        </div>
                        {active === null ? (
                            <span className="flex items-center gap-1 text-xs text-amber">
                                <Check size={13} aria-hidden="true" />
                                Active
                            </span>
                        ) : (
                            <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-xs"
                                onClick={() => void choose(null)}
                                disabled={updateSettings.isPending}
                            >
                                Use
                            </button>
                        )}
                    </li>

                    {sorted.map((skin) => {
                        const isActive = active?.id === skin.id;
                        return (
                            <li
                                key={skin.id}
                                className={cn(
                                    'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                                    isActive ? 'border-amber/40 bg-amber/5' : 'border-line bg-surface/50',
                                )}
                            >
                                <span
                                    className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line"
                                    style={{ background: skin.properties['--color-surface'] ?? undefined }}
                                    aria-hidden="true"
                                >
                                    <span
                                        className="size-4 rounded-full"
                                        style={{ background: skin.properties['--color-amber'] ?? undefined }}
                                    />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-parchment">{skin.name}</p>
                                    <p className="truncate text-footnote text-muted">
                                        {skin.description ?? `${skin.colorScheme} theme`}
                                    </p>
                                </div>
                                {isActive ? (
                                    <span className="flex items-center gap-1 text-xs text-amber">
                                        <Check size={13} aria-hidden="true" />
                                        Active
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        className="btn-ghost px-2 py-1 text-xs"
                                        onClick={() => void choose(skin)}
                                        disabled={updateSettings.isPending}
                                    >
                                        Use
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn-ghost px-2 py-1 text-xs hover:border-danger/50 hover:text-danger"
                                    onClick={() => void remove(skin)}
                                >
                                    Remove
                                </button>
                            </li>
                        );
                    })}
                </ul>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => fileRef.current?.click()}
                        disabled={reading}
                    >
                        {reading || importSkin.isPending || installSkin.isPending ? (
                            <Spinner size={15} />
                        ) : (
                            <Upload size={15} />
                        )}
                        Install a skin…
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".catcup,.json,application/json"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            void pickFile(file);
                        }}
                    />
                    {active ? (
                        <button
                            type="button"
                            className="btn-ghost ml-auto"
                            onClick={() => {
                                applySkin(null);
                                setActive(null);
                            }}
                            title="Clear the skin from this window without changing what is saved"
                        >
                            <RotateCcw size={15} />
                            Preview the built-in theme
                        </button>
                    ) : null}
                </div>
            </section>

            {pending ? (
                <section
                    aria-labelledby="skin-review-heading"
                    className="rounded-xl border border-line bg-surface-2/60 p-4"
                >
                    <h3 id="skin-review-heading" className="font-display text-base text-parchment">
                        Install {pending.manifest.name}?
                    </h3>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                        <dt className="text-muted">File</dt>
                        <dd className="truncate text-parchment-dim">{pending.fileName}</dd>
                        <dt className="text-muted">Version</dt>
                        <dd className="text-parchment-dim">{pending.manifest.version}</dd>
                        <dt className="text-muted">Applies to</dt>
                        <dd className="text-parchment-dim">
                            {pending.manifest.scope === 'app' ? 'The whole window' : 'Only content the app scopes'}
                        </dd>
                        <dt className="text-muted">Tokens</dt>
                        <dd className="text-parchment-dim">{Object.keys(pending.installed.properties).length}</dd>
                        {pending.manifest.license ? (
                            <>
                                <dt className="text-muted">Licence</dt>
                                <dd className="truncate text-parchment-dim">{pending.manifest.license}</dd>
                            </>
                        ) : null}
                    </dl>

                    {pending.warnings.length > 0 ? (
                        <div className="mt-3">
                            <p className="flex items-center gap-1.5 text-sm text-amber">
                                <AlertTriangle size={14} aria-hidden="true" />
                                {pending.warnings.length === 1
                                    ? 'One pair falls under 4.5:1'
                                    : `${pending.warnings.length} pairs fall under 4.5:1`}
                            </p>
                            <ul className="mt-1 space-y-0.5 text-footnote text-muted">
                                {pending.warnings.map((warning) => (
                                    <li key={`${warning.foreground}-${warning.background}`}>
                                        {warning.foreground} on {warning.background}: {warning.ratio.toFixed(2)}:1
                                    </li>
                                ))}
                            </ul>
                            <p className="mt-1.5 text-footnote leading-relaxed text-muted">
                                This does not stop the install. It is here so a skin that is hard to read is a choice
                                rather than a surprise.
                            </p>
                        </div>
                    ) : null}

                    {pending.unreadable.length > 0 ? (
                        <p className="mt-2 text-footnote leading-relaxed text-muted">
                            {pending.unreadable.length === 1
                                ? 'One pair uses a colour syntax the checker cannot read'
                                : `${pending.unreadable.length} pairs use a colour syntax the checker cannot read`}
                            , so they were not measured.
                        </p>
                    ) : null}

                    <div className="mt-4 flex items-center justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setPending(null)}>
                            Cancel
                        </button>
                        <button type="button" className="btn-primary" onClick={() => void accept()}>
                            Install and use
                        </button>
                    </div>
                </section>
            ) : null}
        </div>
    );
}
