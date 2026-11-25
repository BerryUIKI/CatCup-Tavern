import type { AliasEstimate, ExistingInstallPlan, ExistingInstallResult } from '@catcup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FolderInput, Import, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { AliasGenerateDialog } from './AliasGenerateDialog';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { TelegramImport } from './TelegramImport';

function Counts({ counts }: { counts: { characters: number; chats: number; worlds: number; presets: number } }) {
    return (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(
                [
                    ['Characters', counts.characters],
                    ['Chats', counts.chats],
                    ['World info', counts.worlds],
                    ['Presets', counts.presets],
                ] as const
            ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-2">
                    <dt className="text-[10px] uppercase tracking-[0.14em] text-muted/70">{label}</dt>
                    <dd className="tabular-nums text-parchment">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * Copy an existing installation in one go.
 *
 * The server does the reading, so the path is a path on the machine running
 * CatCup. A scan comes first: nothing is written until the user has seen what
 * was found.
 *
 * Books get one extra step. An alias set is worth most the moment a book
 * arrives — that is when the person is thinking about it — and least three
 * weeks later, when they would have to remember that a button exists. So the
 * finished state offers to generate them, with the per-book request count shown
 * before anything is spent.
 */
export function ImportFromInstall({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [path, setPath] = useState('');
    const [plan, setPlan] = useState<ExistingInstallPlan | null>(null);
    const [result, setResult] = useState<ExistingInstallResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [estimates, setEstimates] = useState<AliasEstimate[] | null>(null);
    const [estimating, setEstimating] = useState(false);
    const [generating, setGenerating] = useState<string | null>(null);
    const queryClient = useQueryClient();
    const pushToast = useAppStore((state) => state.pushToast);

    useEffect(() => {
        if (!open) {
            setPath('');
            setPlan(null);
            setResult(null);
            setBusy(false);
            setEstimates(null);
            setEstimating(false);
            setGenerating(null);
        }
    }, [open]);

    const describe = (error: unknown) => (error instanceof Error ? error.message : 'Import failed');

    const scan = async () => {
        if (!path.trim()) {
            return;
        }
        setBusy(true);
        try {
            const data = await api.importFromInstall(path.trim(), true);
            if ('plan' in data) {
                setPlan(data.plan);
                setResult(null);
            }
        } catch (error) {
            pushToast(describe(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    const run = async () => {
        setBusy(true);
        try {
            const data = await api.importFromInstall(path.trim(), false);
            if ('result' in data) {
                setResult(data.result);
                setPlan(null);
                void queryClient.invalidateQueries({ queryKey: ['characters'] });
                void queryClient.invalidateQueries({ queryKey: ['groups'] });
                void queryClient.invalidateQueries({ queryKey: ['worlds'] });
                void queryClient.invalidateQueries({ queryKey: ['presets'] });
                pushToast(
                    `Imported ${data.result.imported.characters} characters and ${data.result.imported.chats} chats.`,
                    'success',
                );

                // The counts are what turn the offer into a decision rather
                // than a guess, so they are fetched before it is shown.
                if (data.result.worldIds.length > 0) {
                    setEstimating(true);
                    void Promise.all(
                        data.result.worldIds.map((id) =>
                            api.worlds
                                .estimateAliases(id, { includeExisting: true })
                                .then((entry) => entry.estimate)
                                .catch(() => null),
                        ),
                    )
                        .then((list) => setEstimates(list.filter((entry): entry is AliasEstimate => entry !== null)))
                        .finally(() => setEstimating(false));
                }
            }
        } catch (error) {
            pushToast(describe(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Modal open={open} onClose={onClose} title="Import from another app" widthClassName="max-w-2xl">
                <div className="space-y-4 p-5">
                    <TelegramImport />

                    <p className="text-sm leading-relaxed text-muted">
                        Point at a user folder from another roleplay client — the one that holds{' '}
                        <code className="text-parchment-dim">characters</code>,{' '}
                        <code className="text-parchment-dim">chats</code> and{' '}
                        <code className="text-parchment-dim">worlds</code>. Nothing is copied until you confirm the
                        scan.
                    </p>

                    <div>
                        <label className="label-text" htmlFor="import-path">
                            Data folder
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="import-path"
                                className="input-shell font-mono text-xs"
                                placeholder="C:\roleplay\data\default-user"
                                value={path}
                                onChange={(event) => setPath(event.target.value)}
                            />
                            <button
                                type="button"
                                className="btn-ghost shrink-0"
                                onClick={() => void scan()}
                                disabled={busy || !path.trim()}
                            >
                                {busy && !plan ? <Spinner size={15} /> : <FolderInput size={15} />}
                                Scan
                            </button>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                            Group chats, backgrounds, themes and the other app&apos;s own settings are not imported.
                        </p>
                    </div>

                    {plan ? (
                        <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
                            <Counts counts={plan} />
                            <p className="text-[11px] leading-relaxed text-muted">
                                From {plan.sources.length} folder{plan.sources.length === 1 ? '' : 's'}
                                {plan.sources.length > 0 ? `: ${plan.sources.join(', ')}` : ''}
                            </p>
                            {plan.errors.length > 0 ? (
                                <ul className="list-inside list-disc text-xs text-wine">
                                    {plan.errors.slice(0, 5).map((error) => (
                                        <li key={error}>{error}</li>
                                    ))}
                                </ul>
                            ) : null}
                            <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>
                                {busy ? <Spinner size={15} /> : <Import size={15} />}
                                Import these
                            </button>
                        </div>
                    ) : null}

                    {result ? (
                        <div className="space-y-3 rounded-xl border border-sage/40 bg-sage/10 p-4">
                            <p className="text-sm text-parchment">Import finished.</p>
                            <Counts counts={result.imported} />
                            {result.skippedChats.length > 0 ? (
                                <p className="text-xs leading-relaxed text-parchment-dim">
                                    {result.skippedChats.length} chat file
                                    {result.skippedChats.length === 1 ? '' : 's'} could not be matched to an imported
                                    character and {result.skippedChats.length === 1 ? 'was' : 'were'} skipped.
                                </p>
                            ) : null}
                            {result.errors.length > 0 ? (
                                <ul className="list-inside list-disc text-xs text-wine">
                                    {result.errors.slice(0, 5).map((error) => (
                                        <li key={error}>{error}</li>
                                    ))}
                                </ul>
                            ) : null}

                            {result.worldIds.length > 0 ? (
                                <div className="border-t border-sage/30 pt-3">
                                    <p className="text-xs font-medium text-parchment-dim">
                                        Give the imported books more names?
                                    </p>
                                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                                        A book fires when a chat repeats one of its keywords. Asking the active model
                                        for the other names each entry answers to closes the gap where the chat says
                                        something else — and it is cheapest to do now, while the book is still the thing
                                        you are looking at.
                                    </p>

                                    {estimating ? (
                                        <p className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                                            <Spinner size={12} />
                                            Counting the requests…
                                        </p>
                                    ) : null}

                                    {estimates && estimates.length > 0 ? (
                                        <ul className="mt-2 space-y-1">
                                            {result.worldIds.map((id, index) => {
                                                const estimate = estimates[index];
                                                return (
                                                    <li
                                                        className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface/60 px-3 py-1.5"
                                                        key={id}
                                                    >
                                                        <span className="min-w-0 flex-1 truncate font-mono text-xs text-parchment-dim">
                                                            {id}
                                                        </span>
                                                        {estimate ? (
                                                            <span className="shrink-0 text-[11px] text-muted">
                                                                {estimate.requests} request
                                                                {estimate.requests === 1 ? '' : 's'} · ~
                                                                {estimate.promptTokens.toLocaleString()} tokens
                                                            </span>
                                                        ) : null}
                                                        <button
                                                            className="btn-ghost shrink-0 px-2 py-0.5 text-[11px]"
                                                            onClick={() => setGenerating(id)}
                                                            type="button"
                                                        >
                                                            <Sparkles size={11} />
                                                            Generate
                                                        </button>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    ) : null}

                                    <p className="mt-1 text-[11px] text-muted/70">
                                        Nothing runs unless you ask, and a large book is a real bill — the count above
                                        is what it would spend.
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </Modal>

            {generating ? (
                <AliasGenerateDialog
                    bookId={generating}
                    open
                    onClose={() => {
                        setGenerating(null);
                        void queryClient.invalidateQueries({ queryKey: ['worldAliases'] });
                    }}
                />
            ) : null}
        </>
    );
}
