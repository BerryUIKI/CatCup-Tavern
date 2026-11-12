import type { QuickReplyAction, QuickReplyItem, QuickReplySetLink, QuickReplySetView } from '@catcup/shared';
import { useMemo } from 'react';

import { useExecuteQuickReply, useQuickReplies, useSettings } from '../hooks/data';
import type { QuickReplyChatRef } from '../lib/api';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

type InputAction = Extract<QuickReplyAction, { type: 'input' }>;
type GenerateAction = Extract<QuickReplyAction, { type: 'generate' }>;

interface QuickReplyBarProps {
    target: QuickReplyChatRef | null;
    /** The chat header's metadata, whose `quickReply.setList` ST writes per chat. */
    metadata: Record<string, unknown> | null | undefined;
    disabled: boolean;
    onInput: (action: InputAction) => void;
    onGenerate: (action: GenerateAction) => void;
}

/** Read the per-chat set links SillyTavern stores in `chat_metadata.quickReply`. */
function chatSetLinks(metadata: Record<string, unknown> | null | undefined): QuickReplySetLink[] {
    const config = metadata?.quickReply;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        return [];
    }
    const list = (config as Record<string, unknown>).setList;
    if (!Array.isArray(list)) {
        return [];
    }
    const links: QuickReplySetLink[] = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        if (typeof record.set !== 'string' || !record.set) {
            continue;
        }
        links.push({ set: record.set, isVisible: record.isVisible !== false });
    }
    return links;
}

function buttonLabel(item: QuickReplyItem): string {
    const label = item.label.trim();
    if (label) {
        return label;
    }
    const title = item.title.trim();
    if (title) {
        return title;
    }
    const firstLine = item.message.split('\n')[0]?.trim() ?? '';
    return firstLine.slice(0, 24) || 'Quick reply';
}

function groupStyle(set: QuickReplySetView) {
    const color = set.color.trim();
    if (!color || color === 'transparent') {
        return undefined;
    }
    return set.onlyBorderColor
        ? { borderColor: color }
        : { borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` };
}

/**
 * The quick reply buttons above the message box.
 *
 * Sets come from the account's set list plus any links a chat carries in its
 * header, so a chat imported from SillyTavern shows the sets it was saved with.
 * Clicking runs the reply on the server; appends land before the client applies
 * the returned input/generation directives.
 */
export function QuickReplyBar({ target, metadata, disabled, onInput, onGenerate }: QuickReplyBarProps) {
    const settings = useSettings().data;
    const setsQuery = useQuickReplies();
    const execute = useExecuteQuickReply();
    const pushToast = useAppStore((state) => state.pushToast);

    const chatLinks = useMemo(() => chatSetLinks(metadata), [metadata]);
    const activeSets = useMemo(() => {
        const enabled = settings?.quickReplies.enabled ?? false;
        if (!enabled) {
            return [];
        }
        const byName = new Map((setsQuery.data?.sets ?? []).map((set) => [set.name, set]));
        const links = [...(settings?.quickReplies.setList ?? []), ...chatLinks];
        const seen = new Set<string>();
        const result: { set: QuickReplySetView; items: QuickReplyItem[] }[] = [];
        for (const link of links) {
            if (!link.isVisible) {
                continue;
            }
            const set = byName.get(link.set);
            if (!set || seen.has(set.id)) {
                continue;
            }
            const items = set.qrList.filter((item) => !item.isHidden);
            if (items.length === 0) {
                continue;
            }
            seen.add(set.id);
            result.push({ set, items });
        }
        return result;
    }, [settings?.quickReplies, setsQuery.data?.sets, chatLinks]);

    if (!target || activeSets.length === 0) {
        return null;
    }

    const run = (set: QuickReplySetView, item: QuickReplyItem) => {
        execute.mutate(
            { target, setId: set.id, qrId: item.id },
            {
                onSuccess: (result) => {
                    for (const action of result.actions) {
                        if (action.type === 'toast') {
                            pushToast(action.message, action.severity, action.title);
                        } else if (action.type === 'input') {
                            onInput(action);
                        } else {
                            onGenerate(action);
                        }
                    }
                },
                onError: (error) => {
                    pushToast(error instanceof Error ? error.message : 'Could not run the quick reply.', 'error');
                },
            },
        );
    };

    return (
        <div className="shrink-0 bg-ink/70 px-3 pt-2 md:px-6">
            <section className="mx-auto flex w-full max-w-4xl flex-wrap items-start gap-1.5" aria-label="Quick replies">
                {activeSets.map(({ set, items }) => (
                    <div
                        key={set.id}
                        className="flex flex-wrap items-center gap-1 rounded-xl border border-line-soft bg-surface/60 p-1"
                        style={groupStyle(set)}
                        title={set.name}
                    >
                        {items.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-transparent px-2 py-1 text-xs text-parchment-dim transition hover:border-amber/40 hover:text-parchment disabled:cursor-not-allowed disabled:opacity-50"
                                title={item.title || item.message}
                                disabled={disabled || execute.isPending}
                                onClick={() => run(set, item)}
                            >
                                {buttonLabel(item)}
                            </button>
                        ))}
                    </div>
                ))}
                {execute.isPending ? <Spinner size={13} className="mt-2 text-muted" /> : null}
            </section>
        </div>
    );
}
