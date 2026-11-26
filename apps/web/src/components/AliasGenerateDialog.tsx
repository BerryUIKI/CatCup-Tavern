import type { AliasRun, AliasRunItem } from '@catcup/shared';
import { Play, RefreshCw, RotateCw, Sparkles, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAliasEstimate, useApplyAliases, useSettings } from '../hooks/data';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { streamAliases } from '../lib/sse';
import { useAppStore } from '../store/app';
import { AliasReview, type AliasReviewRow, keptOf, rowsFromRun } from './AliasReview';
import { Modal } from './Modal';
import { Select } from './Select';
import { Spinner } from './Spinner';

/**
 * Generate a book's aliases with the active model.
 *
 * Two steps, because the work between them is continuous rather than two
 * decisions: run, then review. The run is server-side and deliberately not tied
 * to this dialog — a hundred-entry book is minutes of work, and closing the tab
 * must not throw it away. Reopening looks for a run still in flight and offers
 * to reattach, which is also how a stopped run is resumed: it keeps every
 * proposal whose entry has not changed since.
 *
 * Nothing is written until the review is accepted, and what is written is the
 * sidecar — the book file is never touched, which is what keeps an entry's
 * identity hash and its timed effects intact.
 */

type Step = 'run' | 'review';

export function AliasGenerateDialog({
    open,
    bookId,
    /** Restrict the run to one entry, which is what a stale badge's refresh does. */
    onlyUid,
    onClose,
}: {
    open: boolean;
    bookId: string;
    onlyUid?: number;
    onClose: () => void;
}) {
    const [step, setStep] = useState<Step>('run');
    const [includeExisting, setIncludeExisting] = useState(true);
    const [model, setModel] = useState('');
    const [run, setRun] = useState<AliasRun | null>(null);
    const [rows, setRows] = useState<AliasReviewRow[]>([]);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const streamRef = useRef<AbortController | null>(null);

    const { data: estimateResult } = useAliasEstimate(open ? bookId : null, includeExisting);
    const estimate = estimateResult?.estimate ?? null;
    const { data: settings } = useSettings();
    const apply = useApplyAliases(bookId);
    const pushToast = useAppStore((state) => state.pushToast);

    const provider =
        settings?.providers.find((item) => item.id === settings.activeProviderId) ?? settings?.providers[0];
    const models = provider?.models ?? [];
    const ready = provider?.enabled ?? false;

    const reset = useCallback(() => {
        streamRef.current?.abort();
        streamRef.current = null;
        setStep('run');
        setRun(null);
        setRows([]);
        setRunningId(null);
        setBusy(false);
    }, []);

    useEffect(() => {
        if (!open) {
            streamRef.current?.abort();
            streamRef.current = null;
            reset();
        }
    }, [open, reset]);

    /**
     * Find a run to reattach to.
     *
     * Only a run still in flight is offered, because a finished one has either
     * been reviewed or discarded. A stopped run is the exception the dialog
     * cares about: it is offered as a resume rather than an attach, and the
     * resume is what keeps its finished rows.
     */
    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        void api.worlds
            .aliasRuns(bookId)
            .then((data) => {
                if (cancelled) {
                    return;
                }
                const latest = data.runs.find(
                    (candidate) => onlyUid === undefined || candidate.items.some((item) => item.uid === onlyUid),
                );
                if (latest && (latest.status === 'running' || latest.status === 'stopped')) {
                    setRun(latest);
                }
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open, bookId, onlyUid]);

    /** Follow a run's events until it finishes. */
    const follow = useCallback(
        async (path: string, body: Record<string, unknown>) => {
            const controller = new AbortController();
            streamRef.current = controller;
            setBusy(true);

            const merge = (item: AliasRunItem): void => {
                setRun((current) => {
                    if (!current) {
                        return current;
                    }
                    return {
                        ...current,
                        items: current.items.map((row) => (row.uid === item.uid ? item : row)),
                    };
                });
            };

            try {
                await streamAliases(
                    path,
                    body,
                    {
                        start: (event) => {
                            setRunningId(event.runId);
                            setRun((current) => {
                                if (current && current.id === event.runId) {
                                    return { ...current, items: event.items, model: event.model };
                                }
                                return {
                                    id: event.runId,
                                    worldId: bookId,
                                    model: event.model,
                                    status: 'running',
                                    startedAt: Date.now(),
                                    finishedAt: null,
                                    items: event.items,
                                };
                            });
                        },
                        item: (event) => merge(event.item),
                        done: (event) => {
                            setRun(event.run);
                            setRunningId(null);
                            setRows(rowsFromRun(event.run));
                            setStep('review');
                            if (event.run.status === 'stopped') {
                                pushToast('The run was stopped. Nothing was written; you can resume it.', 'info');
                            }
                        },
                        error: (event) => pushToast(event.message, 'error'),
                    },
                    controller.signal,
                );
            } catch (error) {
                if (!controller.signal.aborted) {
                    pushToast(error instanceof Error ? error.message : 'The run failed', 'error');
                }
            } finally {
                setBusy(false);
                setRunningId(null);
            }
        },
        [bookId, pushToast],
    );

    const start = () => {
        const body = {
            includeExisting,
            ...(onlyUid !== undefined ? { uids: [onlyUid] } : {}),
            ...(model ? { model } : {}),
        };
        void follow(`/api/worlds/${encodeURIComponent(bookId)}/aliases/runs`, body);
    };

    const resume = () => {
        if (!run) {
            return;
        }
        void follow(`/api/worlds/${encodeURIComponent(bookId)}/aliases/runs/${encodeURIComponent(run.id)}/resume`, {
            includeExisting: true,
            ...(model ? { model } : {}),
        });
    };

    /**
     * Join a run that is still going, wherever it was started.
     *
     * A run outlives this dialog, so reopening the book while one is in flight
     * joins it rather than starting a second one beside it. The stream replays
     * the opening event, which is what draws the rows that already finished.
     */
    const reattach = () => {
        if (!run) {
            return;
        }
        setStep('run');
        void follow(`/api/worlds/${encodeURIComponent(bookId)}/aliases/runs/${encodeURIComponent(run.id)}/attach`, {});
    };

    const stop = async () => {
        if (!runningId) {
            return;
        }
        await fetch(`/api/worlds/${encodeURIComponent(bookId)}/aliases/runs/${encodeURIComponent(runningId)}/stop`, {
            method: 'POST',
            credentials: 'same-origin',
        }).catch(() => undefined);
    };

    const save = async () => {
        const entries = rows.filter((row) => row.accepted).map((row) => ({ uid: row.uid, aliases: keptOf(row) }));
        if (entries.length === 0) {
            pushToast('Nothing was kept, so nothing was written.', 'info');
            onClose();
            return;
        }
        try {
            const result = await apply.mutateAsync({ runId: run?.id ?? null, entries });
            pushToast(`Wrote aliases for ${result.updated} ${result.updated === 1 ? 'entry' : 'entries'}.`, 'success');
            onClose();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'The aliases could not be written', 'error');
        }
    };

    const done = run?.items.filter((item) => item.state === 'done').length ?? 0;
    const total = run?.items.filter((item) => item.state !== 'skipped').length ?? 0;
    const resumable = run?.status === 'stopped' && !runningId;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={onlyUid === undefined ? 'Generate aliases' : 'Refresh this entry’s aliases'}
            widthClassName="max-w-3xl"
        >
            <div className="space-y-4 p-5">
                {step === 'run' ? (
                    <>
                        <section className="rounded-xl border border-line bg-surface/40 p-4">
                            <p className="text-sm text-parchment">{bookId}</p>
                            <p className="mt-1 text-xs text-muted">
                                {onlyUid === undefined ? 'Every entry in this book' : 'Only the entry you opened'}
                                {estimate
                                    ? ` · ${estimate.requests} request${estimate.requests === 1 ? '' : 's'} · about ${estimate.promptTokens.toLocaleString()} prompt tokens`
                                    : ''}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-muted">
                                One request per entry. The model sees the entry’s keywords, title and content, and
                                proposes the other names it should answer to. Nothing is written until you review it,
                                and the changes go in a file beside the book rather than into it.
                            </p>
                            {estimate && estimate.empty > 0 ? (
                                <p className="mt-1 text-footnote text-muted">
                                    {estimate.empty} empty {estimate.empty === 1 ? 'entry is' : 'entries are'} skipped,
                                    because there is nothing for the model to read.
                                </p>
                            ) : null}
                        </section>

                        <div className="space-y-2">
                            <Select<string>
                                id="alias-model"
                                label="Model"
                                disabled={!ready || models.length === 0}
                                value={model}
                                onChange={setModel}
                                options={[
                                    { value: '', label: 'Provider default' },
                                    ...models.map((item) => ({ value: item, label: item })),
                                ]}
                            />
                            {!ready || models.length === 0 ? (
                                <p className="field-hint text-danger">
                                    Generating aliases needs an enabled provider with at least one model. Configure one
                                    in Settings → Providers.
                                </p>
                            ) : (
                                <p className="field-hint">The choice applies to this run only; it is not saved.</p>
                            )}
                        </div>

                        <label className="flex items-start gap-2 text-xs text-parchment-dim">
                            <input
                                checked={includeExisting}
                                className="mt-0.5 size-3.5 accent-amber"
                                onChange={(event) => setIncludeExisting(event.target.checked)}
                                type="checkbox"
                            />
                            <span>
                                Include entries that already have aliases
                                <span className="mt-0.5 block text-footnote text-muted">
                                    Off means only entries with none are asked about, which is what a second pass over a
                                    partly finished book wants.
                                </span>
                            </span>
                        </label>

                        {run && run.items.length > 0 ? (
                            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line-soft p-3">
                                <ul className="space-y-1">
                                    {run.items.slice(0, 400).map((item) => (
                                        <li className="flex items-center gap-2 text-xs" key={item.uid}>
                                            <span
                                                className={cn(
                                                    'size-1.5 shrink-0 rounded-full',
                                                    item.state === 'done'
                                                        ? 'bg-sage'
                                                        : item.state === 'running'
                                                          ? 'bg-amber'
                                                          : item.state === 'incomplete'
                                                            ? 'bg-wine'
                                                            : item.state === 'skipped'
                                                              ? 'bg-line'
                                                              : 'bg-line',
                                                )}
                                            />
                                            <span className="truncate text-parchment-dim">{item.label}</span>
                                            {item.proposed && item.proposed.length > 0 ? (
                                                <span className="ml-auto shrink-0 text-caption text-muted">
                                                    {item.proposed.length} new
                                                </span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                                <p className="pt-1 text-footnote text-muted">
                                    {done} of {total} read
                                </p>
                            </div>
                        ) : null}

                        <div className="flex flex-wrap items-center gap-2">
                            {runningId ? (
                                <button className="btn-ghost" onClick={() => void stop()} type="button">
                                    <Square className="size-3.5" />
                                    Stop
                                </button>
                            ) : run?.status === 'running' ? (
                                <button className="btn-primary" onClick={reattach} type="button">
                                    <RotateCw className="size-4" />
                                    Join the run in progress
                                </button>
                            ) : resumable ? (
                                <>
                                    <button className="btn-primary" onClick={resume} type="button">
                                        <RotateCw className="size-4" />
                                        Resume
                                    </button>
                                    <button className="btn-ghost" onClick={start} type="button">
                                        <Play className="size-3.5" />
                                        Start over
                                    </button>
                                </>
                            ) : (
                                <button
                                    className="btn-primary"
                                    disabled={busy || !ready || models.length === 0}
                                    onClick={start}
                                    type="button"
                                >
                                    {busy ? <Spinner size={15} /> : <Sparkles className="size-4" />}
                                    Start
                                </button>
                            )}
                            {resumable ? (
                                <p className="text-footnote text-muted">
                                    Resume keeps every entry that already has an answer; only the rest is asked again.
                                </p>
                            ) : null}
                        </div>
                    </>
                ) : null}

                {step === 'review' && run ? (
                    <>
                        <AliasReview onChange={setRows} rows={rows} run={run} />
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                className="btn-primary"
                                disabled={apply.isPending}
                                onClick={() => void save()}
                                type="button"
                            >
                                {apply.isPending ? <Spinner size={15} /> : <RefreshCw className="size-4" />}
                                Write kept names
                            </button>
                            <button className="btn-ghost" onClick={() => setStep('run')} type="button">
                                Back
                            </button>
                            <p className="text-footnote text-muted">
                                Saved beside the book; the book file is not touched.
                            </p>
                        </div>
                    </>
                ) : null}
            </div>
        </Modal>
    );
}
