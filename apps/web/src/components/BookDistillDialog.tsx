import type { DistillBookEstimate, DistilledBook, DistillMode, DistillRun, ItemScope } from '@catcup/shared';
import { BookOpen, Download, FileText, Play, RotateCw, Square, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    useAcceptDistill,
    useDeleteBook,
    useDistillBooks,
    useDistillRuns,
    useSettings,
    useUploadBook,
} from '../hooks/data';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { streamDistill } from '../lib/sse';
import { useAppStore } from '../store/app';
import { ReviewSheet, type ReviewState } from './DistillReview';
import { Modal } from './Modal';
import { Select } from './Select';
import { Spinner } from './Spinner';

/**
 * Turn a book into a world info book.
 *
 * Three steps in one dialog, because the work between them is one continuous
 * action rather than three decisions. Choose, run, review.
 *
 * The run is server-side and is deliberately **not** tied to this dialog: a
 * book takes minutes, and closing the tab must not throw it away. Reopening
 * looks for a run still in flight and offers to reattach — that is the only
 * history the dialog shows, because a finished run has already been reviewed or
 * discarded.
 */

type Step = 'choose' | 'run' | 'review';

const SOURCE_EXTENSIONS = /\.(txt|md|epub)$/i;

function Stepper({ step }: { step: Step }) {
    const steps: Array<[Step, string]> = [
        ['choose', 'Choose'],
        ['run', 'Run'],
        ['review', 'Review'],
    ];
    const active = steps.findIndex(([value]) => value === step);

    return (
        <ol aria-label="Distillation steps" className="flex items-center gap-2 text-xs">
            {steps.map(([value, label], index) => (
                <li className="flex items-center gap-2" key={value}>
                    <span
                        className={cn(
                            'flex size-5 items-center justify-center rounded-full text-[10px] tabular-nums',
                            index === active
                                ? 'bg-amber text-ink'
                                : index < active
                                  ? 'bg-sage/25 text-sage'
                                  : 'bg-surface-3 text-muted',
                        )}
                    >
                        {index + 1}
                    </span>
                    <span className={index === active ? 'text-parchment' : 'text-muted'}>{label}</span>
                    {index < steps.length - 1 ? <span className="text-line">·</span> : null}
                </li>
            ))}
        </ol>
    );
}

export function BookDistillDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [step, setStep] = useState<Step>('choose');
    const [book, setBook] = useState<DistilledBook | null>(null);
    const [estimate, setEstimate] = useState<DistillBookEstimate | null>(null);
    const [run, setRun] = useState<DistillRun | null>(null);
    const [draft, setDraft] = useState<ReviewState | null>(null);
    const [worldName, setWorldName] = useState('');
    const [scope, setScope] = useState<ItemScope>('profile');
    const [mode, setMode] = useState<DistillMode>('sections');
    const [model, setModel] = useState('');
    const [busy, setBusy] = useState(false);
    const [runningId, setRunningId] = useState<string | null>(null);
    const [dropping, setDropping] = useState(false);
    const streamRef = useRef<AbortController | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const { data: books = [] } = useDistillBooks();
    const { data: runs = [] } = useDistillRuns();
    const { data: settings } = useSettings();
    const upload = useUploadBook();
    const removeBook = useDeleteBook();
    const accept = useAcceptDistill(run?.id ?? null);
    const pushToast = useAppStore((state) => state.pushToast);

    const liveRun = runs.find((candidate) => candidate.status === 'running') ?? null;

    /** The models the active provider serves, which is what `resolveModel` picks from. */
    const provider =
        settings?.providers.find((item) => item.id === settings.activeProviderId) ?? settings?.providers[0];
    const models = provider?.models ?? [];
    const ready = provider?.enabled ?? false;

    const reset = useCallback(() => {
        streamRef.current?.abort();
        streamRef.current = null;
        setStep('choose');
        setBook(null);
        setEstimate(null);
        setRun(null);
        setDraft(null);
        setBusy(false);
        setRunningId(null);
    }, []);

    useEffect(() => {
        if (!open) {
            streamRef.current?.abort();
            streamRef.current = null;
            reset();
        }
    }, [open, reset]);

    /** Follow a run's events until it finishes. */
    const follow = useCallback(
        async (path: string, body: Record<string, unknown>) => {
            const controller = new AbortController();
            streamRef.current = controller;
            setBusy(true);

            try {
                await streamDistill(
                    path,
                    body,
                    {
                        start: (event) => {
                            setRunningId(event.runId);
                            setRun((current) =>
                                current
                                    ? { ...current, chunks: event.chunks }
                                    : {
                                          id: event.runId,
                                          bookId: book?.id ?? '',
                                          bookName: book?.name ?? '',
                                          mode,
                                          model: event.model,
                                          status: 'running',
                                          startedAt: Date.now(),
                                          finishedAt: null,
                                          chunks: event.chunks,
                                          draft: null,
                                      },
                            );
                        },
                        chunk: (event) => {
                            setRun((current) => {
                                if (!current) {
                                    return current;
                                }
                                return {
                                    ...current,
                                    chunks: current.chunks.map((chunk) =>
                                        chunk.index === event.chunk.index ? event.chunk : chunk,
                                    ),
                                };
                            });
                        },
                        done: (event) => {
                            setRun(event.run);
                            setRunningId(null);
                            if (event.run.draft) {
                                setDraft({ entries: event.run.draft.entries, characters: event.run.draft.characters });
                                setWorldName(book?.name ?? event.run.bookName);
                                setStep('review');
                            }
                            if (event.run.status === 'stopped') {
                                pushToast('The run was stopped. Nothing was written.', 'info');
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
        [book?.id, book?.name, mode, pushToast],
    );

    const start = () => {
        if (!book) {
            return;
        }
        void follow('/api/distill/runs', {
            bookId: book.id,
            mode,
            ...(mode === 'model' && model ? { model } : {}),
        });
    };

    const reattach = () => {
        if (!liveRun) {
            return;
        }
        setRun(liveRun);
        setStep('run');
        void follow(`/api/distill/runs/${encodeURIComponent(liveRun.id)}/attach`, {});
    };

    const stop = async () => {
        if (!runningId) {
            return;
        }
        await fetch(`/api/distill/runs/${encodeURIComponent(runningId)}/stop`, {
            method: 'POST',
            credentials: 'same-origin',
        }).catch(() => undefined);
    };

    const pick = async (file: File | undefined) => {
        if (!file) {
            return;
        }
        if (!SOURCE_EXTENSIONS.test(file.name)) {
            pushToast('Books must be .txt, .md or .epub files.', 'info');
            return;
        }
        try {
            const data = await upload.mutateAsync(file);
            setBook(data.book);
            setEstimate(data.estimate);
            setStep('run');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'The book could not be read', 'error');
        }
    };

    const acceptDraft = async () => {
        if (!draft) {
            return;
        }
        try {
            const result = await accept.mutateAsync({
                entries: draft.entries,
                characters: draft.characters,
                world: { id: worldName.trim() || 'book', scope },
                characterScope: scope,
                linkWorld: true,
            });
            pushToast(
                `Wrote ${draft.entries.filter((entry) => entry.accepted).length} entries and ${result.characterIds.length} characters.`,
                'success',
            );
            onClose();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'The draft could not be written', 'error');
        }
    };

    const chunkSummary = run
        ? `${run.chunks.filter((chunk) => chunk.state === 'done').length} of ${run.chunks.length} chapters`
        : '';

    return (
        <Modal open={open} onClose={onClose} title="Distil from a book" widthClassName="max-w-4xl">
            <div className="space-y-4 p-5">
                <div className="flex items-center justify-between gap-3">
                    <Stepper step={step} />
                    {liveRun ? (
                        <button className="btn-ghost py-1.5 text-xs" onClick={reattach} type="button">
                            <RotateCw className="size-3.5" />
                            Reattach to a running book
                        </button>
                    ) : null}
                </div>

                {step === 'choose' ? (
                    <div className="space-y-4">
                        <section
                            aria-label="Upload a book"
                            className={cn(
                                'rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
                                dropping ? 'border-amber/60 bg-amber/5' : 'border-line',
                            )}
                            onDragLeave={() => setDropping(false)}
                            onDragOver={(event) => {
                                event.preventDefault();
                                setDropping(true);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                setDropping(false);
                                void pick(event.dataTransfer.files[0]);
                            }}
                        >
                            <BookOpen className="mx-auto mb-3 size-8 text-muted" />
                            <p className="text-sm text-parchment">Drop a book here, or choose one.</p>
                            <p className="field-hint">A `.txt`, `.md` or `.epub` file, up to 20 MB.</p>
                            <button
                                className="btn-primary mt-4"
                                disabled={upload.isPending}
                                onClick={() => fileRef.current?.click()}
                                type="button"
                            >
                                {upload.isPending ? <Spinner size={15} /> : <Upload className="size-4" />}
                                {upload.isPending ? 'Reading…' : 'Choose a file'}
                            </button>
                            <input
                                accept=".txt,.md,.epub"
                                className="hidden"
                                onChange={(event) => void pick(event.target.files?.[0])}
                                ref={fileRef}
                                type="file"
                            />
                        </section>

                        {books.length > 0 ? (
                            <section className="space-y-2">
                                <h3 className="text-[11px] uppercase tracking-[0.14em] text-muted/80">
                                    Already uploaded
                                </h3>
                                <ul className="space-y-1">
                                    {books.map((item) => (
                                        <li
                                            className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface/40 px-3 py-2"
                                            key={item.id}
                                        >
                                            <FileText className="size-4 shrink-0 text-muted" />
                                            <button
                                                className="min-w-0 flex-1 text-left text-sm text-parchment hover:text-amber"
                                                onClick={() => {
                                                    setBook(item);
                                                    setEstimate(null);
                                                    setStep('run');
                                                }}
                                                type="button"
                                            >
                                                <span className="truncate">{item.name}</span>
                                                <span className="ml-2 text-[11px] text-muted">
                                                    {item.sections.length} chapter
                                                    {item.sections.length === 1 ? '' : 's'}
                                                </span>
                                            </button>
                                            <button
                                                aria-label={`Delete ${item.name}`}
                                                className="icon-btn size-7 text-muted hover:text-wine"
                                                onClick={() => removeBook.mutate(item.id)}
                                                type="button"
                                            >
                                                <Trash2 className="size-3.5" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}

                        <section className="rounded-xl border border-line-soft bg-surface/40 px-3 py-2.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-medium text-parchment-dim">Distil somewhere else</p>
                                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                                        Download this pipeline as a Claude Skill: the same prompts and output contract,
                                        for a book distilled in Claude Code with no server run.
                                    </p>
                                </div>
                                <a
                                    className="btn-ghost shrink-0 px-2 py-1 text-xs"
                                    download="book-distill.zip"
                                    href={api.distill.skillUrl()}
                                    title="Download the prompts and output contract as a Claude Skill"
                                >
                                    <Download size={13} />
                                    Skill
                                </a>
                            </div>
                        </section>
                    </div>
                ) : null}

                {step === 'run' && book ? (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-line bg-surface/40 p-4">
                            <p className="text-sm text-parchment">{book.name}</p>
                            <p className="mt-1 text-xs text-muted">
                                {book.sections.length} chapter{book.sections.length === 1 ? '' : 's'}
                                {estimate
                                    ? ` · about ${estimate.chunks} request${estimate.chunks === 1 ? '' : 's'} and ${estimate.promptTokens.toLocaleString()} prompt tokens`
                                    : ''}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-muted">
                                {mode === 'sections'
                                    ? 'Sections only writes one world info entry per chapter, straight from the text, with no model call. It costs nothing and finishes immediately.'
                                    : 'A model draft reads every chapter, merges what it finds and writes each recurring character up as a card. It costs one request per chapter plus one per recurring entity.'}
                            </p>
                        </div>

                        <fieldset className="space-y-2">
                            <legend className="label-text">Mode</legend>
                            {(
                                [
                                    ['sections', 'Sections only', 'Free, instant, one entry per chapter'],
                                    ['model', 'Model draft', 'Reads the book and writes up what it finds'],
                                ] as const
                            ).map(([value, label, hint]) => (
                                <label
                                    className={cn(
                                        'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition',
                                        mode === value
                                            ? 'border-amber/50 bg-amber/10'
                                            : 'border-line-soft hover:border-line',
                                    )}
                                    key={value}
                                >
                                    <input
                                        checked={mode === value}
                                        className="mt-0.5 size-3.5 accent-amber"
                                        name="distill-mode"
                                        onChange={() => setMode(value)}
                                        type="radio"
                                        value={value}
                                    />
                                    <span className="min-w-0">
                                        <span className="block text-sm text-parchment">{label}</span>
                                        <span className="block text-[11px] text-muted">{hint}</span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                        {mode === 'model' ? (
                            <div>
                                <Select<string>
                                    id="distill-model"
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
                                    <p className="field-hint text-wine">
                                        The model draft needs an enabled provider with at least one model. Configure one
                                        in Settings → Providers.
                                    </p>
                                ) : (
                                    <p className="field-hint">The choice applies to this run only; it is not saved.</p>
                                )}
                            </div>
                        ) : null}

                        {run ? (
                            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line-soft p-3">
                                <ul className="space-y-1">
                                    {run.chunks.map((chunk) => (
                                        <li className="flex items-center gap-2 text-xs" key={chunk.index}>
                                            <span
                                                className={cn(
                                                    'size-1.5 shrink-0 rounded-full',
                                                    chunk.state === 'done'
                                                        ? 'bg-sage'
                                                        : chunk.state === 'running'
                                                          ? 'bg-amber'
                                                          : chunk.state === 'incomplete'
                                                            ? 'bg-wine'
                                                            : 'bg-line',
                                                )}
                                            />
                                            <span className="truncate text-parchment-dim">{chunk.label}</span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="pt-1 text-[11px] text-muted">{chunkSummary}</p>
                            </div>
                        ) : null}

                        <div className="flex items-center gap-2">
                            {runningId ? (
                                <button className="btn-ghost" onClick={() => void stop()} type="button">
                                    <Square className="size-3.5" />
                                    Stop
                                </button>
                            ) : (
                                <button
                                    className="btn-primary"
                                    disabled={busy || (mode === 'model' && (!ready || models.length === 0))}
                                    onClick={start}
                                    type="button"
                                >
                                    <Play className="size-4" />
                                    Start
                                </button>
                            )}
                            <button className="btn-ghost" onClick={() => setStep('choose')} type="button">
                                Choose another book
                            </button>
                        </div>
                    </div>
                ) : null}

                {step === 'review' && draft ? (
                    <div className="space-y-4">
                        <ReviewSheet
                            draft={draft}
                            onChange={setDraft}
                            onScopeChange={setScope}
                            onWorldNameChange={setWorldName}
                            scope={scope}
                            worldName={worldName}
                        />
                        <div className="flex items-center gap-2">
                            <button
                                className="btn-primary"
                                disabled={accept.isPending}
                                onClick={() => void acceptDraft()}
                                type="button"
                            >
                                {accept.isPending ? <Spinner size={15} /> : null}
                                Accept selected
                            </button>
                            <button className="btn-ghost" onClick={() => setStep('run')} type="button">
                                Back
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
