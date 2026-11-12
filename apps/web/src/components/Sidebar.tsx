import type { CharacterSummary, GroupView, ProviderPublic } from '@catcup/shared';
import { BookOpen, FolderInput, LogOut, Pencil, Search, Settings2, Sparkles, Upload, Users, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import type { LibraryTab } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Logo } from './Logo';
import { Spinner } from './Spinner';

interface SidebarProps {
    characters: CharacterSummary[];
    loading: boolean;
    selectedCharacterId: string | null;
    onSelect: (id: string) => void;
    onEditCharacter: (id: string) => void;
    groups: GroupView[];
    groupsLoading: boolean;
    selectedGroupId: string | null;
    libraryTab: LibraryTab;
    onSelectLibraryTab: (tab: LibraryTab) => void;
    onSelectGroup: (id: string) => void;
    onNewGroup: () => void;
    onEditGroup: (id: string) => void;
    onImportSillyTavern: () => void;
    onAddSample: () => void;
    addingSample: boolean;
    onImport: (files: File[]) => void;
    importing: boolean;
    providers: ProviderPublic[];
    activeProviderId: string | null;
    onSwitchProvider: (id: string) => void;
    activeProviderName: string | null;
    activeProviderReady: boolean;
    onOpenSettings: () => void;
    onLogout: () => void;
    loggingOut: boolean;
    open: boolean;
    onClose: () => void;
}

const ACTIVATION_SHORT = ['Natural', 'List', 'Manual', 'Pooled'];

export function Sidebar({
    characters,
    loading,
    selectedCharacterId,
    onSelect,
    onEditCharacter,
    groups,
    groupsLoading,
    selectedGroupId,
    libraryTab,
    onSelectLibraryTab,
    onSelectGroup,
    onNewGroup,
    onEditGroup,
    onImportSillyTavern,
    onAddSample,
    addingSample,
    onImport,
    importing,
    providers,
    activeProviderId,
    onSwitchProvider,
    activeProviderName,
    activeProviderReady,
    onOpenSettings,
    onLogout,
    loggingOut,
    open,
    onClose,
}: SidebarProps) {
    const [query, setQuery] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const normalizedQuery = query.trim().toLowerCase();
    const switchableProviders = providers.filter((provider) => provider.enabled);
    const filteredCharacters = normalizedQuery
        ? characters.filter(
              (character) =>
                  character.name.toLowerCase().includes(normalizedQuery) ||
                  character.creator.toLowerCase().includes(normalizedQuery) ||
                  character.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
          )
        : characters;
    const filteredGroups = normalizedQuery
        ? groups.filter(
              (group) =>
                  group.name.toLowerCase().includes(normalizedQuery) ||
                  group.memberDetails.some((member) => member.name.toLowerCase().includes(normalizedQuery)),
          )
        : groups;

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) {
            return;
        }
        onImport(Array.from(files));
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const tabButton = (tab: LibraryTab, label: string, icon: ReactNode) => (
        <button
            type="button"
            onClick={() => onSelectLibraryTab(tab)}
            className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                libraryTab === tab
                    ? 'bg-surface-2 text-parchment ring-1 ring-amber/25'
                    : 'text-muted hover:text-parchment-dim',
            )}
            aria-pressed={libraryTab === tab}
        >
            {icon}
            {label}
        </button>
    );

    return (
        <aside
            className={cn(
                'fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-line-soft bg-ink-soft/95 backdrop-blur-xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:bg-ink-soft/55',
                open ? 'translate-x-0 shadow-2xl shadow-black/60' : '-translate-x-full md:translate-x-0',
            )}
            aria-label="Library"
        >
            <div className="flex items-center gap-3 px-4 pb-3 pt-5">
                <Logo size={38} className="shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                    <h1 className="truncate font-display text-lg leading-tight tracking-wide text-parchment">
                        CatCup Tavern
                    </h1>
                    <p className="text-[11px] text-muted">Stories, served warm.</p>
                </div>
                <button type="button" className="icon-btn md:hidden" onClick={onClose} aria-label="Close library">
                    <X size={18} />
                </button>
            </div>

            <div className="mx-3 mb-2 grid grid-cols-2 gap-1 rounded-xl border border-line/70 bg-ink/50 p-1">
                {tabButton('characters', 'Characters', <BookOpen size={13} />)}
                {tabButton('groups', 'Groups', <Users size={13} />)}
            </div>

            <div className="px-3 pb-2">
                <div className="relative">
                    <Search
                        size={15}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={libraryTab === 'groups' ? 'Search groups' : 'Search characters'}
                        className="input-shell py-2 pl-9 text-sm"
                        aria-label={libraryTab === 'groups' ? 'Search groups' : 'Search characters'}
                    />
                </div>
            </div>

            {libraryTab === 'characters' ? (
                <div className="px-3 pb-3">
                    <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted transition hover:border-amber/50 hover:text-parchment disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                    >
                        {importing ? <Spinner size={15} /> : <Upload size={16} />}
                        {importing ? 'Importing…' : 'Import character card'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.json,.charx"
                        multiple
                        className="hidden"
                        onChange={(event) => handleFiles(event.target.files)}
                    />
                    <button
                        type="button"
                        className="mt-2 flex w-full items-center justify-center gap-2 text-xs text-muted transition hover:text-parchment"
                        onClick={onImportSillyTavern}
                    >
                        <FolderInput size={14} />
                        Import from SillyTavern
                    </button>
                </div>
            ) : (
                <div className="px-3 pb-3">
                    <button
                        type="button"
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm text-muted transition hover:border-amber/50 hover:text-parchment"
                        onClick={onNewGroup}
                    >
                        <Users size={16} />
                        New group
                    </button>
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {libraryTab === 'characters' ? (
                    loading ? (
                        <div className="flex justify-center py-10">
                            <Spinner size={18} className="text-muted" />
                        </div>
                    ) : filteredCharacters.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm leading-relaxed text-muted">
                            {characters.length === 0 ? (
                                <>
                                    <p>No characters yet. Import a PNG or JSON card to open the first door.</p>
                                    <button
                                        type="button"
                                        className="btn-ghost mx-auto mt-3"
                                        onClick={onAddSample}
                                        disabled={addingSample}
                                    >
                                        {addingSample ? <Spinner size={15} /> : <Sparkles size={15} />}
                                        Add the sample character
                                    </button>
                                </>
                            ) : (
                                'No characters match this search.'
                            )}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {filteredCharacters.map((character) => {
                                const active = character.id === selectedCharacterId;
                                return (
                                    <div
                                        key={character.id}
                                        className={cn(
                                            'flex items-center rounded-xl transition',
                                            active ? 'bg-surface-2 ring-1 ring-amber/25' : 'hover:bg-surface/70',
                                        )}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onSelect(character.id)}
                                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left"
                                        >
                                            <CharacterAvatar
                                                name={character.name}
                                                src={character.avatarUrl}
                                                size={38}
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-center gap-1.5">
                                                    <span className="truncate text-sm font-medium text-parchment">
                                                        {character.name}
                                                    </span>
                                                    {character.hasCharacterBook ? (
                                                        <BookOpen
                                                            size={12}
                                                            className="shrink-0 text-sage/80"
                                                            aria-label="Has a character book"
                                                        />
                                                    ) : null}
                                                </span>
                                                <span className="block truncate text-[11px] text-muted">
                                                    {character.tags.length > 0
                                                        ? character.tags.slice(0, 2).join(' · ')
                                                        : character.creator || 'No tags'}
                                                </span>
                                            </span>
                                            {active ? (
                                                <span className="size-1.5 shrink-0 rounded-full bg-amber" />
                                            ) : null}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onEditCharacter(character.id)}
                                            aria-label={`Edit ${character.name}`}
                                            className="icon-btn mr-1.5 size-7 shrink-0 text-muted hover:text-parchment"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )
                ) : groupsLoading ? (
                    <div className="flex justify-center py-10">
                        <Spinner size={18} className="text-muted" />
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm leading-relaxed text-muted">
                        {groups.length === 0 ? (
                            <>
                                <p>No groups yet. Bring two or more characters into one room.</p>
                                <button type="button" className="btn-ghost mx-auto mt-3" onClick={onNewGroup}>
                                    <Users size={15} />
                                    New group
                                </button>
                            </>
                        ) : (
                            'No groups match this search.'
                        )}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {filteredGroups.map((group) => {
                            const active = group.id === selectedGroupId;
                            return (
                                <div
                                    key={group.id}
                                    className={cn(
                                        'flex items-center rounded-xl transition',
                                        active ? 'bg-surface-2 ring-1 ring-amber/25' : 'hover:bg-surface/70',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => onSelectGroup(group.id)}
                                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left"
                                    >
                                        <CharacterAvatar
                                            name={group.name}
                                            src={
                                                group.memberDetails.find((member) => member.avatarUrl)?.avatarUrl ??
                                                null
                                            }
                                            size={38}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5">
                                                <span className="truncate text-sm font-medium text-parchment">
                                                    {group.name}
                                                </span>
                                                {group.disabled_members.length > 0 ? (
                                                    <span
                                                        className="size-1.5 shrink-0 rounded-full bg-muted/60"
                                                        title="Some members are muted"
                                                    />
                                                ) : null}
                                            </span>
                                            <span className="block truncate text-[11px] text-muted">
                                                {group.memberDetails.length}{' '}
                                                {group.memberDetails.length === 1 ? 'member' : 'members'} ·{' '}
                                                {ACTIVATION_SHORT[group.activation_strategy] ?? 'Natural'}
                                            </span>
                                        </span>
                                        {active ? <span className="size-1.5 shrink-0 rounded-full bg-amber" /> : null}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onEditGroup(group.id)}
                                        aria-label={`Edit ${group.name}`}
                                        className="icon-btn mr-1.5 size-7 shrink-0 text-muted hover:text-parchment"
                                    >
                                        <Pencil size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="border-t border-line-soft px-3 py-3">
                <div className="mb-2 rounded-lg bg-surface/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted/70">Active provider</p>
                        <span
                            className={cn(
                                'size-2 shrink-0 rounded-full',
                                activeProviderReady ? 'bg-sage' : 'bg-amber/70',
                            )}
                            title={activeProviderReady ? 'Provider ready' : 'API key may be required'}
                        />
                    </div>
                    {switchableProviders.length > 1 ? (
                        <select
                            className="mt-1 w-full rounded border border-line bg-ink px-1.5 py-1 text-xs text-parchment-dim"
                            value={activeProviderId ?? ''}
                            onChange={(event) => onSwitchProvider(event.target.value)}
                            aria-label="Active provider"
                        >
                            {switchableProviders.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                    {provider.name}
                                    {provider.model ? ` — ${provider.model}` : ''}
                                </option>
                            ))}
                        </select>
                    ) : (
                        <p className="truncate text-xs text-parchment-dim">{activeProviderName ?? 'Not configured'}</p>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button type="button" className="btn-ghost flex-1 justify-start" onClick={onOpenSettings}>
                        <Settings2 size={16} />
                        Settings
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onLogout}
                        disabled={loggingOut}
                        title="Sign out"
                        aria-label="Sign out"
                    >
                        {loggingOut ? <Spinner size={16} /> : <LogOut size={17} />}
                    </button>
                </div>
            </div>
        </aside>
    );
}
