import type { CharacterSummary, GroupView } from '@catcup/shared';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useCreateGroup, useDeleteGroup, useUpdateGroup } from '../hooks/data';
import { useAppStore } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface MemberDraft {
    fileName: string;
    name: string;
    avatarUrl: string | null;
    /** False when the card behind a stored member is gone. */
    available: boolean;
}

interface GroupEditorProps {
    open: boolean;
    /** The group to edit, or null to create one. */
    group: GroupView | null;
    characters: CharacterSummary[];
    onClose: () => void;
    onSaved: (group: GroupView, created: boolean) => void;
    onDeleted?: (id: string) => void;
}

const ACTIVATION_OPTIONS = [
    { value: 0, label: 'Natural — a mentioned member replies, otherwise turns rotate' },
    { value: 1, label: 'List — members reply in turn' },
    { value: 2, label: 'Manual — you pick who replies when you send' },
    { value: 3, label: 'Pooled — a random member who has not spoken yet' },
];

function draftsFromGroup(group: GroupView): MemberDraft[] {
    return group.memberDetails.map((member) => ({
        fileName: member.fileName,
        name: member.name,
        avatarUrl: member.avatarUrl,
        available: member.id !== null,
    }));
}

export function GroupEditor({ open, group, characters, onClose, onSaved, onDeleted }: GroupEditorProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const createMutation = useCreateGroup();
    const updateMutation = useUpdateGroup(group?.id ?? null);
    const deleteMutation = useDeleteGroup();

    const [name, setName] = useState('');
    const [members, setMembers] = useState<MemberDraft[]>([]);
    const [disabledMembers, setDisabledMembers] = useState<string[]>([]);
    const [activationStrategy, setActivationStrategy] = useState(0);
    const [allowSelfResponses, setAllowSelfResponses] = useState(false);
    const [query, setQuery] = useState('');

    // Reset the draft when the dialog opens for a different group.
    // biome-ignore lint/correctness/useExhaustiveDependencies: resetting is keyed to the opened entity
    useEffect(() => {
        if (!open) {
            return;
        }
        setName(group?.name ?? '');
        setMembers(group ? draftsFromGroup(group) : []);
        setDisabledMembers(group?.disabled_members ?? []);
        setActivationStrategy(group?.activation_strategy ?? 0);
        setAllowSelfResponses(group?.allow_self_responses ?? false);
        setQuery('');
    }, [open, group?.id]);

    const selected = useMemo(() => new Set(members.map((member) => member.fileName)), [members]);
    const normalizedQuery = query.trim().toLowerCase();
    const candidates = useMemo(() => {
        const free = characters.filter((character) => !selected.has(character.fileName));
        if (!normalizedQuery) {
            return free;
        }
        return free.filter(
            (character) =>
                character.name.toLowerCase().includes(normalizedQuery) ||
                character.creator.toLowerCase().includes(normalizedQuery) ||
                character.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
        );
    }, [characters, selected, normalizedQuery]);

    const addMember = (character: CharacterSummary) => {
        setMembers((current) => [
            ...current,
            {
                fileName: character.fileName,
                name: character.name,
                avatarUrl: character.avatarUrl,
                available: true,
            },
        ]);
    };

    const removeMember = (fileName: string) => {
        setMembers((current) => current.filter((member) => member.fileName !== fileName));
        setDisabledMembers((current) => current.filter((entry) => entry !== fileName));
    };

    const move = (index: number, delta: number) => {
        setMembers((current) => {
            const target = index + delta;
            if (target < 0 || target >= current.length) {
                return current;
            }
            const next = [...current];
            const [item] = next.splice(index, 1);
            if (item) {
                next.splice(target, 0, item);
            }
            return next;
        });
    };

    const toggleDisabled = (fileName: string) => {
        setDisabledMembers((current) =>
            current.includes(fileName) ? current.filter((entry) => entry !== fileName) : [...current, fileName],
        );
    };

    const saving = createMutation.isPending || updateMutation.isPending;
    const canSave = members.length > 0 && (!group || name.trim().length > 0) && !saving;

    const handleSave = () => {
        if (!canSave) {
            return;
        }
        const payload = {
            ...(name.trim() ? { name: name.trim() } : {}),
            members: members.map((member) => member.fileName),
            disabled_members: disabledMembers.filter((entry) => members.some((member) => member.fileName === entry)),
            activation_strategy: activationStrategy,
            generation_mode: group?.generation_mode ?? 0,
            allow_self_responses: allowSelfResponses,
        };

        if (group) {
            updateMutation.mutate(payload, {
                onSuccess: (updated) => {
                    onSaved(updated, false);
                    pushToast('Group updated.', 'success');
                    onClose();
                },
                onError: (error) => pushToast(error.message, 'error'),
            });
            return;
        }

        createMutation.mutate(
            { ...payload, members: payload.members },
            {
                onSuccess: (created) => {
                    onSaved(created, true);
                    pushToast('Group created.', 'success');
                    onClose();
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleDelete = () => {
        if (!group) {
            return;
        }
        if (
            !window.confirm(
                'Delete this group and every chat in it? The character cards are not touched, but group chats cannot be recovered.',
            )
        ) {
            return;
        }
        deleteMutation.mutate(group.id, {
            onSuccess: () => {
                pushToast('Group deleted.', 'success');
                onDeleted?.(group.id);
                onClose();
            },
            onError: (error) => pushToast(error.message, 'error'),
        });
    };

    return (
        <Modal open={open} onClose={onClose} title={group ? 'Edit group' : 'New group'} widthClassName="max-w-3xl">
            <div className="space-y-5 p-5">
                <div>
                    <label className="label-text" htmlFor="group-name">
                        Group name
                    </label>
                    <input
                        id="group-name"
                        className="input-shell"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder={members.length > 0 ? `Group: ${members.map((m) => m.name).join(', ')}` : 'The Cup'}
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        Leave it empty to name the group after its members.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    <div className="min-w-0">
                        <span className="label-text">Members ({members.length})</span>
                        <div className="max-h-64 overflow-y-auto rounded-xl border border-line bg-ink-soft/60">
                            {members.length === 0 ? (
                                <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
                                    Add at least one character. SillyTavern groups usually have two or three.
                                </p>
                            ) : (
                                <ul className="divide-y divide-line-soft">
                                    {members.map((member, index) => (
                                        <li key={member.fileName} className="flex items-center gap-2 px-2.5 py-2">
                                            <CharacterAvatar name={member.name} src={member.avatarUrl} size={30} />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm text-parchment">{member.name}</p>
                                                {member.available ? (
                                                    <label className="flex items-center gap-1.5 text-[11px] text-muted">
                                                        <input
                                                            type="checkbox"
                                                            className="size-3 accent-amber"
                                                            aria-label={`Mute ${member.name}`}
                                                            checked={disabledMembers.includes(member.fileName)}
                                                            onChange={() => toggleDisabled(member.fileName)}
                                                        />
                                                        Muted
                                                    </label>
                                                ) : (
                                                    <p className="text-[11px] text-wine/90">Card missing</p>
                                                )}
                                            </div>
                                            <div className="flex flex-col">
                                                <button
                                                    type="button"
                                                    className="icon-btn size-6"
                                                    onClick={() => move(index, -1)}
                                                    disabled={index === 0}
                                                    aria-label={`Move ${member.name} up`}
                                                >
                                                    <ArrowUp size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-btn size-6"
                                                    onClick={() => move(index, 1)}
                                                    disabled={index === members.length - 1}
                                                    aria-label={`Move ${member.name} down`}
                                                >
                                                    <ArrowDown size={12} />
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                className="icon-btn size-7 hover:text-wine"
                                                onClick={() => removeMember(member.fileName)}
                                                aria-label={`Remove ${member.name}`}
                                            >
                                                <X size={14} />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                            Order matters for list mode. Muted members stay in the group but do not reply.
                        </p>
                    </div>

                    <div className="min-w-0">
                        <span className="label-text">Add a character</span>
                        <div className="relative">
                            <Search
                                size={14}
                                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                            />
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                placeholder="Search the library"
                                className="input-shell py-2 pl-9 text-sm"
                                aria-label="Search characters to add"
                            />
                        </div>
                        <div className="mt-2 max-h-52 overflow-y-auto rounded-xl border border-line bg-ink-soft/60">
                            {candidates.length === 0 ? (
                                <p className="px-3 py-6 text-center text-xs leading-relaxed text-muted">
                                    {characters.length === 0
                                        ? 'No characters in the library yet.'
                                        : 'Every character is already in the group.'}
                                </p>
                            ) : (
                                <ul className="divide-y divide-line-soft">
                                    {candidates.map((character) => (
                                        <li key={character.id}>
                                            <button
                                                type="button"
                                                className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition hover:bg-surface/70"
                                                onClick={() => addMember(character)}
                                            >
                                                <CharacterAvatar
                                                    name={character.name}
                                                    src={character.avatarUrl}
                                                    size={28}
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-parchment">
                                                        {character.name}
                                                    </span>
                                                    <span className="block truncate text-[11px] text-muted">
                                                        {character.tags.slice(0, 3).join(' · ') ||
                                                            character.creator ||
                                                            'No tags'}
                                                    </span>
                                                </span>
                                                <Plus size={15} className="shrink-0 text-amber/80" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label className="label-text" htmlFor="group-activation">
                            Reply order
                        </label>
                        <select
                            id="group-activation"
                            className="input-shell"
                            value={activationStrategy}
                            onChange={(event) => setActivationStrategy(Number(event.target.value))}
                        >
                            {ACTIVATION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col justify-end">
                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                className="size-4 accent-amber"
                                checked={allowSelfResponses}
                                onChange={(event) => setAllowSelfResponses(event.target.checked)}
                            />
                            Allow a member to reply to itself
                        </label>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                            Off by default: the member who spoke last waits for someone else.
                        </p>
                    </div>
                </div>

                <p className="text-[11px] leading-relaxed text-muted/70">
                    CatCup currently generates one reply per turn and uses the replying member's own card, the
                    SillyTavern “swap” generation mode.
                </p>
                {group && group.generation_mode !== 0 ? (
                    <p className="text-[11px] leading-relaxed text-amber/80">
                        This group is stored with SillyTavern's append generation mode. CatCup keeps the setting but
                        still replies with one member's card.
                    </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-4">
                    {group ? (
                        <button
                            type="button"
                            className="btn-ghost text-wine/90 hover:border-wine/50"
                            onClick={handleDelete}
                            disabled={deleteMutation.isPending || saving}
                        >
                            {deleteMutation.isPending ? <Spinner size={14} /> : <Trash2 size={14} />}
                            Delete group
                        </button>
                    ) : (
                        <span />
                    )}
                    <div className="ml-auto flex items-center gap-2">
                        <button type="button" className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="button" className="btn-primary" onClick={handleSave} disabled={!canSave}>
                            {saving ? <Spinner size={15} /> : null}
                            {group ? 'Save changes' : 'Create group'}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
