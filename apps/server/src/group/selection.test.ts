import type { ChatMessage, Group } from '@catcup/shared';
import { groupSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { findCurrentSpeaker, type GroupSpeaker, lastAssistantSpeaker, selectGroupSpeaker } from './selection.js';

const members: GroupSpeaker[] = [
    { id: 'Aria', fileName: 'Aria.json', name: 'Aria' },
    { id: 'Bram', fileName: 'Bram.json', name: 'Bram' },
    { id: 'Cass', fileName: 'Cass.json', name: 'Cass' },
];

function makeGroup(patch: Partial<Group> = {}): Group {
    return groupSchema.parse({
        id: '1',
        name: 'The Cup',
        members: ['Aria.json', 'Bram.json', 'Cass.json'],
        ...patch,
    });
}

function message(name: string, originalAvatar: string | null, mes = ''): ChatMessage {
    return {
        name,
        is_user: false,
        mes,
        ...(originalAvatar ? { original_avatar: originalAvatar } : {}),
    };
}

function userMessage(mes: string): ChatMessage {
    return { name: 'You', is_user: true, mes };
}

describe('group speaker selection', () => {
    it('honours an explicit speaker by file name, id or name', () => {
        const group = makeGroup();
        for (const speaker of ['Bram.json', 'Bram', 'Bram']) {
            const selected = selectGroupSpeaker({ group, members, messages: [], action: 'send', speaker });
            expect(selected?.speaker.fileName).toBe('Bram.json');
            expect(selected?.reason).toBe('explicit');
        }
    });

    it('never selects a disabled member', () => {
        const group = makeGroup({ disabled_members: ['Aria.json'] });
        const selected = selectGroupSpeaker({ group, members, messages: [], action: 'send' });
        expect(selected?.speaker.fileName).not.toBe('Aria.json');

        const explicit = selectGroupSpeaker({
            group,
            members,
            messages: [],
            action: 'send',
            speaker: 'Aria.json',
        });
        expect(explicit?.speaker.fileName).not.toBe('Aria.json');
    });

    it('returns null when every member is disabled', () => {
        const group = makeGroup({ disabled_members: ['Aria.json', 'Bram.json', 'Cass.json'] });
        expect(selectGroupSpeaker({ group, members, messages: [], action: 'send' })).toBeNull();
    });

    it('keeps the current speaker for regenerate and continue', () => {
        const group = makeGroup();
        const history = [userMessage('Hello'), message('Bram', 'Bram.json', 'Well met.')];

        for (const action of ['regenerate', 'continue'] as const) {
            const selected = selectGroupSpeaker({ group, members, messages: history, action });
            expect(selected?.speaker.fileName).toBe('Bram.json');
            expect(selected?.reason).toBe('current');
        }
    });

    it('rotates list order after the last speaker', () => {
        const group = makeGroup({ activation_strategy: 1 });
        const selected = selectGroupSpeaker({
            group,
            members,
            messages: [userMessage('Hi'), message('Aria', 'Aria.json', 'Hello.')],
            action: 'send',
        });
        expect(selected?.speaker.fileName).toBe('Bram.json');
        expect(selected?.reason).toBe('list');
    });

    it('falls back to the first member when manual has no pick', () => {
        const group = makeGroup({ activation_strategy: 2 });
        const selected = selectGroupSpeaker({ group, members, messages: [], action: 'send' });
        expect(selected?.speaker.fileName).toBe('Aria.json');
        expect(selected?.reason).toBe('manual');
    });

    it('picks a member mentioned in the typed message', () => {
        const group = makeGroup();
        const selected = selectGroupSpeaker({
            group,
            members,
            messages: [],
            action: 'send',
            message: 'Cass, what do you think?',
        });
        expect(selected?.speaker.fileName).toBe('Cass.json');
        expect(selected?.reason).toBe('natural-mention');
    });

    it('moves to the next member when nobody is mentioned', () => {
        const group = makeGroup();
        const selected = selectGroupSpeaker({
            group,
            members,
            messages: [userMessage('Hi'), message('Aria', 'Aria.json', 'Hello.')],
            action: 'send',
            message: 'Interesting.',
        });
        expect(selected?.speaker.fileName).toBe('Bram.json');
        expect(selected?.reason).toBe('natural-next');
    });

    it('does not let the last speaker answer its own reply unless allowed', () => {
        const group = makeGroup();
        const history = [userMessage('Hi'), message('Aria', 'Aria.json', 'Hello.')];

        const blocked = selectGroupSpeaker({ group, members, messages: history, action: 'send' });
        expect(blocked?.speaker.fileName).toBe('Bram.json');

        const allowed = selectGroupSpeaker({
            group: makeGroup({ allow_self_responses: true }),
            members,
            messages: history,
            action: 'send',
            message: 'Aria?',
        });
        expect(allowed?.speaker.fileName).toBe('Aria.json');
    });

    it('keeps a lone member replying even when self responses are off', () => {
        const group = makeGroup({ members: ['Aria.json'], disabled_members: [] });
        const selected = selectGroupSpeaker({
            group,
            members: [members[0] as GroupSpeaker],
            messages: [userMessage('Hi'), message('Aria', 'Aria.json', 'Hello.')],
            action: 'send',
        });
        expect(selected?.speaker.fileName).toBe('Aria.json');
    });

    it('uses the injected random source for pooled order', () => {
        const group = makeGroup({ activation_strategy: 3 });
        const first = selectGroupSpeaker({
            group,
            members,
            messages: [userMessage('Hi')],
            action: 'send',
            random: () => 0,
        });
        const last = selectGroupSpeaker({
            group,
            members,
            messages: [userMessage('Hi')],
            action: 'send',
            random: () => 0.99,
        });
        expect(first?.speaker.fileName).toBe('Aria.json');
        expect(last?.speaker.fileName).toBe('Cass.json');
    });

    it('prefers members who have not spoken since the user for pooled order', () => {
        const group = makeGroup({ activation_strategy: 3 });
        // The message being regenerated belongs to a member who left the group,
        // so selection falls through to the pooled rules: Aria and Bram have
        // spoken since the user's message, Cass has not.
        const selected = selectGroupSpeaker({
            group,
            members,
            messages: [
                userMessage('Hi'),
                message('Aria', 'Aria.json', 'Hello.'),
                message('Bram', 'Bram.json', 'Evening.'),
                message('Gone', 'Gone.json', 'Farewell.'),
            ],
            action: 'regenerate',
            random: () => 0,
        });
        expect(selected?.speaker.fileName).toBe('Cass.json');
        expect(selected?.reason).toBe('pooled');
    });

    it('reads the last speaker from history', () => {
        expect(lastAssistantSpeaker([userMessage('Hi'), message('Aria', 'Aria.json', 'Hello.')])).toBe('Aria.json');
        expect(lastAssistantSpeaker([message('Aria', null, 'No avatar.')])).toBeNull();
    });
});

describe('current group speaker', () => {
    const resolved = [
        { speaker: members[0] as GroupSpeaker, enabled: true },
        { speaker: members[1] as GroupSpeaker, enabled: false },
    ];

    it('finds the speaker from original_avatar, muted or not', () => {
        const result = findCurrentSpeaker(resolved, [userMessage('Hi'), message('Bram', 'Bram.json', 'Hello.')]);

        expect(result && 'speaker' in result ? result.speaker.speaker.fileName : null).toBe('Bram.json');
    });

    it('falls back to the member name for legacy messages', () => {
        const result = findCurrentSpeaker(resolved, [message('Bram', null, 'Hello.')]);

        expect(result && 'speaker' in result ? result.speaker.speaker.fileName : null).toBe('Bram.json');
    });

    it('reports a member whose card is gone', () => {
        expect(findCurrentSpeaker(resolved, [message('Gone', 'Gone.json', 'Bye.')])).toEqual({ missing: true });
    });

    it('returns null when nobody has spoken', () => {
        expect(findCurrentSpeaker(resolved, [])).toBeNull();
    });

    it('skips narrator messages when finding the last speaker', () => {
        const narrator: ChatMessage = {
            name: 'Narrator',
            is_user: false,
            mes: 'Rain falls.',
            original_avatar: 'Aria.json',
            extra: { type: 'narrator' },
        };
        const history = [message('Bram', 'Bram.json', 'Hello.'), narrator];

        expect(lastAssistantSpeaker(history)).toBe('Bram.json');
        expect(findCurrentSpeaker(resolved, history)).toMatchObject({
            speaker: { speaker: { fileName: 'Bram.json' } },
        });
    });
});
