import { type ChatMessage, getLatestSummary, type MemorySettings } from '@catcup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Eraser, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    type MemoryChatRef,
    queryKeys,
    useClearMemory,
    useSaveMemory,
    useSettings,
    useSummarizeMemory,
} from '../hooks/data';
import { useAppStore } from '../store/app';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

const ROLE_LABELS = ['system', 'user', 'assistant'] as const;

function describePosition(memory: MemorySettings): string {
    if (memory.position === -1) {
        return 'Not injected; only the {{summary}} macro sees it.';
    }
    if (memory.position === 2) {
        return 'Injected before the main prompt.';
    }
    if (memory.position === 1) {
        return `Injected in chat at depth ${memory.depth} as a ${ROLE_LABELS[memory.role] ?? 'system'} message.`;
    }
    return 'Injected after the main prompt.';
}

function wordCount(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

interface MemoryDialogProps {
    open: boolean;
    onClose: () => void;
    /** The chat the summary belongs to, or null when none is open. */
    target: MemoryChatRef | null;
    messages: ChatMessage[];
    /** Character or group name, for the heading. */
    title: string;
}

/**
 * Summary memory: read, edit, regenerate or remove the rolling summary.
 *
 * The summary itself lives on one message's `extra.memory`, exactly as
 * SillyTavern's Memory extension stores it, so the chat file stays portable.
 */
export function MemoryDialog({ open, onClose, target, messages, title }: MemoryDialogProps) {
    const settings = useSettings().data;
    const memory = settings?.memory;
    const summary = getLatestSummary(messages);
    const summarize = useSummarizeMemory();
    const save = useSaveMemory();
    const clear = useClearMemory();
    const pushToast = useAppStore((state) => state.pushToast);
    const queryClient = useQueryClient();

    const [draft, setDraft] = useState('');
    const [note, setNote] = useState('');

    // An automatic summary may have landed after the chat was last fetched;
    // opening the panel refreshes the chat so the latest value is shown.
    const targetKind = target?.kind;
    const targetId = target?.id;
    const targetChatId = target?.chatId;
    useEffect(() => {
        if (!open || !targetKind || !targetId || !targetChatId) {
            return;
        }
        const key =
            targetKind === 'character'
                ? queryKeys.chat(targetId, targetChatId)
                : queryKeys.groupChat(targetId, targetChatId);
        void queryClient.invalidateQueries({ queryKey: key });
    }, [open, targetKind, targetId, targetChatId, queryClient]);

    // Re-sync when the dialog opens or the stored summary changes, so a
    // background update shows up without wiping an in-progress edit.
    useEffect(() => {
        if (!open) {
            return;
        }
        setDraft(summary?.value ?? '');
        setNote('');
    }, [open, summary?.value]);

    const busy = summarize.isPending || save.isPending || clear.isPending;
    const dirty = draft.trim() !== (summary?.value ?? '').trim();

    const handleSummarize = () => {
        if (!target) {
            return;
        }
        setNote('');
        summarize.mutate(target, {
            onSuccess: (result) => {
                if (result.summary) {
                    pushToast('Summary updated.', 'success');
                    return;
                }
                setNote(result.reason ?? 'There is nothing new to summarize yet.');
            },
            onError: (error) =>
                pushToast(error instanceof Error ? error.message : 'Could not summarize this chat.', 'error'),
        });
    };

    const handleSave = () => {
        if (!target || !draft.trim()) {
            return;
        }
        save.mutate(
            { target, text: draft.trim() },
            {
                onSuccess: () => pushToast('Summary saved.', 'success'),
                onError: (error) =>
                    pushToast(error instanceof Error ? error.message : 'Could not save the summary.', 'error'),
            },
        );
    };

    const handleClear = () => {
        if (!target) {
            return;
        }
        if (!window.confirm('Delete the stored summary? This cannot be undone.')) {
            return;
        }
        clear.mutate(target, {
            onSuccess: (remaining) =>
                pushToast(
                    remaining ? 'Summary removed; the previous one is in effect.' : 'Summary removed.',
                    'success',
                ),
            onError: (error) =>
                pushToast(error instanceof Error ? error.message : 'Could not remove the summary.', 'error'),
        });
    };

    return (
        <Modal open={open} onClose={onClose} title="Memory" widthClassName="max-w-2xl">
            <div className="space-y-4 p-5">
                <div>
                    <h3 className="font-display text-lg text-parchment">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                        A rolling summary of this chat, injected into the prompt and stored in the chat file as
                        SillyTavern&apos;s Memory extension does.
                    </p>
                </div>

                <div className="rounded-xl border border-line-soft bg-ink-soft/50 px-3 py-2.5 text-xs leading-relaxed text-parchment-dim">
                    <p>
                        Automatic updates:{' '}
                        <span className={memory?.enabled ? 'text-sage' : 'text-parchment-dim'}>
                            {memory?.enabled ? 'on' : 'off'}
                        </span>
                        {memory ? ` · ${describePosition(memory)}` : ''}
                    </p>
                    <p className="mt-1 text-muted">
                        {summary
                            ? `Stored on message ${summary.index + 1} of ${messages.length}.`
                            : 'No summary is stored in this chat yet.'}
                    </p>
                </div>

                <div>
                    <label className="label-text" htmlFor="memory-draft">
                        Summary
                    </label>
                    <textarea
                        id="memory-draft"
                        className="input-shell min-h-40 resize-y font-normal leading-relaxed"
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder="Summarize the chat to create the first memory, or write one by hand."
                        disabled={!target || busy}
                    />
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                        <span>{wordCount(draft)} words</span>
                        {memory ? <span>Target {memory.promptWords} words</span> : null}
                    </div>
                </div>

                {note ? <p className="text-sm text-amber">{note}</p> : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                        type="button"
                        className="btn-ghost text-wine"
                        onClick={handleClear}
                        disabled={!summary || !target || busy}
                    >
                        {clear.isPending ? <Spinner size={15} /> : <Eraser size={15} />}
                        Delete
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-ghost"
                            onClick={handleSave}
                            disabled={!dirty || !draft.trim() || !target || busy}
                        >
                            {save.isPending ? <Spinner size={15} /> : null}
                            Save
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleSummarize}
                            disabled={!target || busy}
                            title="Summarize the conversation now"
                        >
                            {summarize.isPending ? <Spinner size={15} /> : <RefreshCw size={15} />}
                            Summarize now
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
