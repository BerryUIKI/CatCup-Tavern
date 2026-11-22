// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/openai.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

export type CompletionRole = 'system' | 'user' | 'assistant';

/** One message in the assembled prompt. */
export interface CompletionMessage {
    /** Which prompt produced it; used by squashing and diagnostics. */
    identifier: string;
    role: CompletionRole;
    content: string;
    name?: string;
}

/** Identifiers SillyTavern refuses to merge when squashing system messages. */
const SQUASH_EXCLUDED = new Set(['newMainChat', 'newChat', 'groupNudge']);

interface Slot {
    identifier: string;
    items: CompletionMessage[];
}

/**
 * The assembled prompt.
 *
 * Mirrors SillyTavern's `ChatCompletion`: prompts occupy ordered slots, later
 * prompts can insert into an existing slot, and the final array is produced by
 * flattening slots in index order and dropping empty content.
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
     * negative. Mirrors SillyTavern's index assignment: an existing slot at
     * that index is replaced.
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
     * Merge adjacent unnamed system messages with a newline, dropping empty
     * system messages first. SillyTavern only does this when
     * `squash_system_messages` is enabled, which is off by default.
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

    /** Flatten and drop messages with empty content. Whitespace is kept. */
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
