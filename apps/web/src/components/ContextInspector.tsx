import type { ContextPreview } from '@catcup/shared';
import { useState } from 'react';

import { useContextPreview } from '../hooks/data';
import { cn } from '../lib/cn';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

type InspectorTab = 'prompt' | 'worldinfo' | 'budget';

const TABS: { id: InspectorTab; label: string }[] = [
    { id: 'prompt', label: 'Prompt' },
    { id: 'worldinfo', label: 'World Info' },
    { id: 'budget', label: 'Budget' },
];

interface ContextInspectorProps {
    open: boolean;
    onClose: () => void;
    characterId: string | null;
    chatId: string | null;
}

export function ContextInspector({ open, onClose, characterId, chatId }: ContextInspectorProps) {
    const [tab, setTab] = useState<InspectorTab>('prompt');
    const query = useContextPreview(characterId, chatId, open);
    const context = query.data;

    return (
        <Modal open={open} onClose={onClose} title="Context inspector" widthClassName="max-w-5xl">
            <div className="flex gap-1 border-b border-line-soft px-4 pt-3">
                {TABS.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className={cn(
                            'rounded-t-lg px-3 py-2 text-sm transition',
                            tab === item.id ? 'bg-surface text-parchment' : 'text-muted hover:text-parchment-dim',
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="p-5">
                {query.isLoading ? (
                    <div className="flex justify-center py-16">
                        <Spinner size={22} className="text-muted" />
                    </div>
                ) : query.isError ? (
                    <p className="py-10 text-center text-sm text-wine">
                        {query.error instanceof Error ? query.error.message : 'Could not build the context.'}
                    </p>
                ) : context ? (
                    <>
                        {tab === 'prompt' ? <PromptTab context={context} /> : null}
                        {tab === 'worldinfo' ? <WorldInfoTab context={context} /> : null}
                        {tab === 'budget' ? <BudgetTab context={context} /> : null}
                    </>
                ) : null}
            </div>
        </Modal>
    );
}

function PromptTab({ context }: { context: ContextPreview }) {
    return (
        <div className="space-y-2">
            <p className="text-sm text-muted">
                {context.messages.length} messages · {context.budget.total} tokens ({context.budget.counter})
                {context.budget.exceeded ? ' · over budget' : ''}
            </p>

            {context.messages.map((message, index) => (
                <article
                    // biome-ignore lint/suspicious/noArrayIndexKey: assembled messages carry no stable id
                    key={`${index}-${message.role}`}
                    className="rounded-xl border border-line-soft bg-ink-soft/60"
                >
                    <header className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted">
                        <span>
                            #{index + 1} · {message.role}
                            {message.name ? ` · ${message.name}` : ''}
                        </span>
                        <span>{message.content.length} chars</span>
                    </header>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-3 font-sans text-[13px] leading-relaxed text-parchment-dim">
                        {message.content}
                    </pre>
                </article>
            ))}
        </div>
    );
}

function WorldInfoTab({ context }: { context: ContextPreview }) {
    const info = context.worldInfo;
    const activated = info.trace.filter((line) => line.activated);
    const skipped = info.trace.length - activated.length;

    return (
        <div className="space-y-5">
            <p className="text-sm leading-relaxed text-muted">
                Books: {info.books.length > 0 ? info.books.join(', ') : 'none'} · {info.loops} scan pass(es) · budget{' '}
                {info.budget.used}/{info.budget.limit}
                {info.budget.overflowed ? ' · overflowed' : ''}
            </p>

            <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-muted">Activated ({activated.length})</h3>
                {activated.length === 0 ? (
                    <p className="text-sm text-muted">No entry fired for this chat.</p>
                ) : (
                    <ul className="space-y-1">
                        {activated.map((line) => (
                            <li
                                key={`${line.world}.${line.uid}`}
                                className="flex flex-wrap items-center gap-2 rounded-lg border border-sage/30 bg-sage/5 px-3 py-1.5 text-sm"
                            >
                                <span className="font-medium text-parchment">
                                    {line.comment || `${line.world}.${line.uid}`}
                                </span>
                                <span className="text-xs text-muted">{line.reason}</span>
                                {line.loop > 1 ? <span className="text-xs text-muted">pass {line.loop}</span> : null}
                                {line.detail ? <span className="text-xs text-parchment-dim">{line.detail}</span> : null}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
                <Bucket title="Before character" entries={info.before} />
                <Bucket title="After character" entries={info.after} />
                <Bucket title="Author's note (top)" entries={info.authorNoteTop} />
                <Bucket title="Author's note (bottom)" entries={info.authorNoteBottom} />
                <Bucket
                    title="At depth"
                    entries={info.atDepth.map(
                        (bucket) => `[d${bucket.depth} r${bucket.role}] ${bucket.entries.join(' / ')}`,
                    )}
                />
                <Bucket
                    title="Examples"
                    entries={info.examples.map(
                        (example) => `[${example.position === 0 ? 'top' : 'bottom'}] ${example.content}`,
                    )}
                />
            </section>

            <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-wider text-muted">
                    Trace ({info.trace.length}, {skipped} skipped)
                </h3>
                <div className="overflow-x-auto rounded-xl border border-line-soft">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-surface/60 text-[10px] uppercase tracking-wider text-muted">
                            <tr>
                                <th className="px-3 py-2">Entry</th>
                                <th className="px-3 py-2">Result</th>
                                <th className="px-3 py-2">Reason</th>
                                <th className="px-3 py-2">Pass</th>
                            </tr>
                        </thead>
                        <tbody>
                            {info.trace.map((line) => (
                                <tr key={`${line.world}.${line.uid}`} className="border-t border-line-soft/60">
                                    <td className="px-3 py-1.5 text-parchment-dim">
                                        {line.comment || `${line.world}.${line.uid}`}
                                    </td>
                                    <td className={cn('px-3 py-1.5', line.activated ? 'text-sage' : 'text-muted')}>
                                        {line.activated ? 'active' : 'skipped'}
                                    </td>
                                    <td className="px-3 py-1.5 text-muted">
                                        {line.reason}
                                        {line.detail ? (
                                            <span className="text-parchment-dim"> · {line.detail}</span>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-1.5 tabular-nums text-muted">{line.loop}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

function Bucket({ title, entries }: { title: string; entries: string[] }) {
    if (entries.length === 0) {
        return null;
    }
    return (
        <div className="rounded-xl border border-line-soft bg-ink-soft/50 p-3">
            <h4 className="mb-1 text-[11px] uppercase tracking-wider text-muted">{title}</h4>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-parchment-dim">
                {entries.join('\n')}
            </pre>
        </div>
    );
}

function BudgetTab({ context }: { context: ContextPreview }) {
    const rows = Object.entries(context.budget.tokenCounts).sort((a, b) => b[1] - a[1]);

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted">
                {context.budget.total} tokens in the assembled prompt, counted with {context.budget.counter}
                {context.budget.exceeded ? ' · the budget was exceeded' : ''}.
            </p>
            <div className="overflow-x-auto rounded-xl border border-line-soft">
                <table className="w-full text-left text-xs">
                    <thead className="bg-surface/60 text-[10px] uppercase tracking-wider text-muted">
                        <tr>
                            <th className="px-3 py-2">Slot</th>
                            <th className="px-3 py-2 text-right">Tokens</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([identifier, tokens]) => (
                            <tr key={identifier} className="border-t border-line-soft/60">
                                <td className="px-3 py-1.5 text-parchment-dim">{identifier}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums text-muted">{tokens}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="text-xs leading-relaxed text-parchment-dim">
                {context.budget.counterSource === 'estimate'
                    ? 'No tokenizer matches the active model, so the counts are a character-based estimate.'
                    : context.budget.counterSource === 'claude'
                      ? "Counts use Anthropic's Claude vocabulary, the same one SillyTavern ships."
                      : 'Counts use the exact tiktoken encoding for the active model, plus four tokens per message.'}
            </p>
        </div>
    );
}
