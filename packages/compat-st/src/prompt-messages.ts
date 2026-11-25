// Written for CatCup. The assembled prompt as an ordered set of slots, with a
// running token cost and the optional system-message squash.

export type CompletionRole = 'system' | 'user' | 'assistant';

/** One message in the assembled prompt. */
export interface CompletionMessage {
    /** Which prompt produced it; used by squashing and diagnostics. */
    identifier: string;
    role: CompletionRole;
    content: string;
    name?: string;
}

/**
 * Identifiers the squash refuses to merge.
 *
 * These are boundary markers rather than instruction: merging one into the
 * message above it would move the boundary, and the model would read the turn
 * below as part of a different section.
 */
const SQUASH_EXCLUDED = new Set(['newMainChat', 'newChat', 'groupNudge']);

interface Slot {
    identifier: string;
    items: CompletionMessage[];
}

/**
 * The assembled prompt.
 *
 * Prompts occupy ordered slots. A prompt placed at an explicit index replaces
 * whatever is there, and one without an index is appended — that is what lets
 * the preset's order list decide the arrangement while a prompt the user added
 * later lands at the end.
 *
 * The final message array is the slots flattened in index order with empty
 * content dropped. Slot identity is kept until then because the token report
 * and the squash both need to know which prompt a message came from.
 */
export class ChatCompletion {
    private readonly slots: Array<Slot | undefined> = [];
    private spent = 0;

    constructor(
        readonly budget: number,
        private readonly countMessage: (message: CompletionMessage) => number,
    ) {}

    /** Tokens still available. Can go negative if a caller ignores it. */
    get remaining(): number {
        return this.budget - this.spent;
    }

    get overBudget(): boolean {
        return this.spent > this.budget;
    }

    has(identifier: string): boolean {
        return this.slots.some((slot) => slot?.identifier === identifier);
    }

    indexOf(identifier: string): number {
        return this.slots.findIndex((slot) => slot?.identifier === identifier);
    }

    /** Cost of a set of messages without adding them. */
    cost(items: readonly CompletionMessage[]): number {
        return items.reduce((sum, item) => sum + this.countMessage(item), 0);
    }

    /**
     * Place a group at a slot index, or append when `index` is null or
     * negative.
     *
     * An existing slot at that index is *replaced*, not merged: the caller
     * owns that position, and keeping the old messages underneath would
     * duplicate content the new group is meant to supersede.
     *
     * The cost is added unconditionally, including for messages that the
     * flatten will later drop for being empty. That is deliberate — a prompt
     * that contributes nothing still reserves its slot, and the budget report
     * should show the reservation rather than hide it.
     */
    add(identifier: string, index: number | null, items: readonly CompletionMessage[]): void {
        const slot: Slot = { identifier, items: [...items] };
        if (index !== null && index >= 0) {
            this.slots[index] = slot;
        } else {
            this.slots.push(slot);
        }
        this.spent += this.cost(items);
    }

    /** Add one message to an existing slot. No-op when the slot is absent. */
    insert(identifier: string, message: CompletionMessage, position: 'start' | 'end'): void {
        const slot = this.slots.find((candidate) => candidate?.identifier === identifier);
        if (!slot) {
            return;
        }
        if (message.content) {
            if (position === 'start') {
                slot.items.unshift(message);
            } else {
                slot.items.push(message);
            }
            this.spent += this.countMessage(message);
        }
    }

    private flatten(): CompletionMessage[] {
        const messages: CompletionMessage[] = [];
        for (const slot of this.slots) {
            if (slot) {
                messages.push(...slot.items);
            }
        }
        return messages;
    }

    /**
     * Merge adjacent unnamed system messages into one, separated by newlines.
     *
     * Off by default. It exists for providers that dislike consecutive system
     * turns, and the cost is that every boundary between two system prompts
     * disappears — which is why three identifiers are excluded: those are
     * boundaries a caller relies on.
     *
     * Empty system messages are dropped on the way through, since merging an
     * empty one would only add a stray newline to its neighbour.
     *
     * The slots collapse into one at the end. After a squash the original slot
     * boundaries no longer describe the messages, so keeping them would make
     * the token report lie.
     */
    squashSystemMessages(): void {
        const squashable = (message: CompletionMessage): boolean =>
            !SQUASH_EXCLUDED.has(message.identifier) && message.role === 'system' && !message.name;

        const result: CompletionMessage[] = [];
        let last: CompletionMessage | undefined;

        for (const message of this.flatten()) {
            if (message.role === 'system' && !message.content) {
                continue;
            }

            if (squashable(message) && last && squashable(last)) {
                last.content += `\n${message.content}`;
                continue;
            }

            result.push(message);
            last = message;
        }

        this.slots.length = 0;
        this.slots.push({ identifier: 'root', items: result });
    }

    /**
     * The final message array, with empty content dropped.
     *
     * Whitespace-only content is kept. It is a real message to a model, and a
     * prompt that deliberately contributes a blank line would otherwise lose
     * it without any indication.
     */
    getChat(): CompletionMessage[] {
        return this.flatten().filter((message) => Boolean(message.content));
    }

    /** Token cost per identifier, for the context inspector. */
    tokenCounts(): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const slot of this.slots) {
            if (!slot) {
                continue;
            }
            counts[slot.identifier] = (counts[slot.identifier] ?? 0) + this.cost(slot.items);
        }
        return counts;
    }
}
