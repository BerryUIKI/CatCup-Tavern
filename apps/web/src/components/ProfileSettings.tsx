import type { ProfileSummary } from '@catcup/shared';
import { Archive, ArchiveRestore, Check, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
    useActivateProfile,
    useArchiveProfile,
    useCreateProfile,
    useDeleteProfile,
    useProfiles,
    useRenameProfile,
    useRestoreProfile,
} from '../hooks/data';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countsLine(profile: ProfileSummary): string {
    const parts = [
        `${profile.counts.characters} ${profile.counts.characters === 1 ? 'character' : 'characters'}`,
        `${profile.counts.chats} ${profile.counts.chats === 1 ? 'chat' : 'chats'}`,
        `${profile.counts.books} ${profile.counts.books === 1 ? 'book' : 'books'}`,
        `${profile.counts.presets} ${profile.counts.presets === 1 ? 'preset' : 'presets'}`,
    ];
    return parts.join(' · ');
}

/**
 * Settings → Profiles.
 *
 * Unlike the Providers panel this one applies immediately — every action is a
 * request of its own — so it has no dirty state and no save bar, which is what
 * DESIGN.md asks for an immediate-apply panel.
 */
export function ProfileSettings() {
    const profilesQuery = useProfiles();
    const createProfile = useCreateProfile();
    const renameProfile = useRenameProfile();
    const activateProfile = useActivateProfile();
    const archiveProfile = useArchiveProfile();
    const restoreProfile = useRestoreProfile();
    const deleteProfile = useDeleteProfile();
    const pushToast = useAppStore((state) => state.pushToast);
    const resetSelection = useAppStore((state) => state.resetSelection);

    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [copyFrom, setCopyFrom] = useState(true);
    const [renaming, setRenaming] = useState<ProfileSummary | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [confirming, setConfirming] = useState<
        { kind: 'archive'; profile: ProfileSummary } | { kind: 'delete'; profile: ProfileSummary } | null
    >(null);

    const data = profilesQuery.data;
    if (!data) {
        return (
            <div className="flex h-full items-center justify-center p-12">
                <Spinner size={20} className="text-muted" />
            </div>
        );
    }

    const active = data.profiles.find((profile) => profile.id === data.activeProfileId);
    const error = (caught: unknown) =>
        pushToast(caught instanceof Error ? caught.message : 'The profile action failed.', 'error');

    const handleCreate = () => {
        const name = newName.trim();
        if (!name) {
            return;
        }
        createProfile.mutate(
            {
                name,
                ...(copyFrom && active ? { copyFromId: active.id } : {}),
            },
            {
                onSuccess: (profile) => {
                    setCreating(false);
                    setNewName('');
                    pushToast(`Created ${profile.name}.`, 'success');
                },
                onError: error,
            },
        );
    };

    const handleRename = () => {
        if (!renaming || !renameValue.trim()) {
            return;
        }
        renameProfile.mutate(
            { id: renaming.id, patch: { name: renameValue.trim() } },
            {
                onSuccess: () => {
                    setRenaming(null);
                    pushToast('Profile renamed.', 'success');
                },
                onError: error,
            },
        );
    };

    const handleActivate = (profile: ProfileSummary) => {
        activateProfile.mutate(profile.id, {
            onSuccess: () => {
                resetSelection();
                pushToast(`Switched to ${profile.name}.`, 'success');
            },
            onError: error,
        });
    };

    const renderRow = (profile: ProfileSummary) => (
        <li
            key={profile.id}
            className={cn(
                'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5',
                profile.active ? 'border-amber/35 bg-amber/5' : 'border-line-soft bg-ink-soft/50',
            )}
        >
            <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm text-parchment">
                    {profile.name}
                    {profile.active ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 text-[10px] text-amber">
                            <Check size={10} />
                            Active
                        </span>
                    ) : null}
                    {profile.archived ? (
                        <span className="rounded-full border border-line/70 px-2 py-0.5 text-[10px] text-muted">
                            Archived
                        </span>
                    ) : null}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted">
                    {profile.archived ? 'Archived' : countsLine(profile)} · {formatSize(profile.sizeBytes)}
                </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {profile.archived ? (
                    <>
                        <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() =>
                                restoreProfile.mutate(profile.id, {
                                    onSuccess: () => pushToast(`Restored ${profile.name}.`, 'success'),
                                    onError: error,
                                })
                            }
                        >
                            <ArchiveRestore size={13} />
                            Restore
                        </button>
                        <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs text-wine/90 hover:border-wine/50"
                            onClick={() => setConfirming({ kind: 'delete', profile })}
                        >
                            <Trash2 size={13} />
                            Delete
                        </button>
                    </>
                ) : (
                    <>
                        {!profile.active ? (
                            <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-xs"
                                onClick={() => handleActivate(profile)}
                                disabled={activateProfile.isPending}
                            >
                                {activateProfile.isPending && activateProfile.variables === profile.id ? (
                                    <Spinner size={13} />
                                ) : null}
                                Make active
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="icon-btn size-8"
                            onClick={() => {
                                setRenaming(profile);
                                setRenameValue(profile.name);
                            }}
                            title="Rename"
                            aria-label={`Rename ${profile.name}`}
                        >
                            <Pencil size={13} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn size-8"
                            onClick={() => setConfirming({ kind: 'archive', profile })}
                            disabled={profile.active}
                            title={profile.active ? 'The active profile cannot be archived' : 'Archive'}
                            aria-label={`Archive ${profile.name}`}
                        >
                            <Archive size={13} />
                        </button>
                    </>
                )}
            </div>
        </li>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 py-3 md:px-5">
                <div className="min-w-0">
                    <h4 className="text-sm font-medium text-parchment">Profiles</h4>
                    <p className="truncate text-[11px] text-muted">
                        A profile is its own cast, lorebooks, presets and settings. The provider list is shared.
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-primary shrink-0 px-3 py-1.5 text-xs"
                    onClick={() => setCreating(true)}
                >
                    <Plus size={14} />
                    New profile
                </button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5">
                <ul className="space-y-2">{data.profiles.map(renderRow)}</ul>

                {data.archived.length > 0 ? (
                    <section>
                        <h5 className="label-text">Archived</h5>
                        <ul className="space-y-2">{data.archived.map(renderRow)}</ul>
                    </section>
                ) : null}
            </div>

            <Modal open={creating} onClose={() => setCreating(false)} title="New profile" widthClassName="max-w-lg">
                <div className="space-y-4 p-5">
                    <div>
                        <label className="label-text" htmlFor="new-profile-name">
                            Name
                        </label>
                        <input
                            id="new-profile-name"
                            className="input-shell"
                            value={newName}
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleCreate();
                                }
                            }}
                            placeholder="e.g. Novel"
                        />
                    </div>
                    <label className="flex items-start gap-2 text-xs text-parchment-dim">
                        <input
                            type="checkbox"
                            className="mt-0.5 size-3.5 accent-amber"
                            checked={copyFrom}
                            onChange={(event) => setCopyFrom(event.target.checked)}
                        />
                        <span>
                            Copy configuration from <strong>{active?.name ?? 'the active profile'}</strong>
                            <span className="mt-0.5 block text-[11px] text-muted">
                                Settings, regex and personas only — the cast, chats, lorebooks and presets start empty.
                            </span>
                        </span>
                    </label>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleCreate}
                            disabled={!newName.trim() || createProfile.isPending}
                        >
                            {createProfile.isPending ? <Spinner size={14} /> : <Copy size={14} />}
                            Create
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal
                open={renaming !== null}
                onClose={() => setRenaming(null)}
                title="Rename profile"
                widthClassName="max-w-lg"
            >
                <div className="space-y-4 p-5">
                    <div>
                        <label className="label-text" htmlFor="rename-profile-name">
                            Name
                        </label>
                        <input
                            id="rename-profile-name"
                            className="input-shell"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleRename();
                                }
                            }}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleRename}
                            disabled={!renameValue.trim() || renameProfile.isPending}
                        >
                            {renameProfile.isPending ? <Spinner size={14} /> : null}
                            Rename
                        </button>
                    </div>
                </div>
            </Modal>

            <ConfirmDialog
                open={confirming !== null}
                tone={confirming?.kind === 'delete' ? 'danger' : 'default'}
                title={
                    confirming?.kind === 'delete'
                        ? `Delete ${confirming.profile.name} permanently?`
                        : `Archive ${confirming?.profile.name ?? 'this profile'}?`
                }
                description={
                    confirming?.kind === 'delete'
                        ? 'The folder and everything in it is removed from disk. This cannot be undone.'
                        : confirming
                          ? `Its ${countsLine(confirming.profile)} move to the archive. Nothing is deleted, and Restore brings them back.`
                          : ''
                }
                confirmLabel={confirming?.kind === 'delete' ? 'Delete permanently' : 'Archive'}
                onCancel={() => setConfirming(null)}
                onConfirm={() => {
                    const target = confirming;
                    setConfirming(null);
                    if (!target) {
                        return;
                    }
                    if (target.kind === 'archive') {
                        archiveProfile.mutate(target.profile.id, {
                            onSuccess: () => pushToast(`Archived ${target.profile.name}.`, 'success'),
                            onError: error,
                        });
                    } else {
                        deleteProfile.mutate(target.profile.id, {
                            onSuccess: () => pushToast(`Deleted ${target.profile.name}.`, 'success'),
                            onError: error,
                        });
                    }
                }}
                busy={archiveProfile.isPending || deleteProfile.isPending}
            />
        </div>
    );
}
