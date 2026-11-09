import type { CharacterSummary } from '@catcup/shared';
import { BookOpen, LogOut, Search, Settings2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { CharacterAvatar } from './CharacterAvatar';
import { Logo } from './Logo';
import { Spinner } from './Spinner';

interface SidebarProps {
    characters: CharacterSummary[];
    loading: boolean;
    selectedCharacterId: string | null;
    onSelect: (id: string) => void;
    onImport: (files: File[]) => void;
    importing: boolean;
    activeProviderName: string | null;
    activeProviderReady: boolean;
    onOpenSettings: () => void;
    onLogout: () => void;
    loggingOut: boolean;
    open: boolean;
    onClose: () => void;
}

export function Sidebar({
    characters,
    loading,
    selectedCharacterId,
    onSelect,
    onImport,
    importing,
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
    const filtered = normalizedQuery
        ? characters.filter(
              (character) =>
                  character.name.toLowerCase().includes(normalizedQuery) ||
                  character.creator.toLowerCase().includes(normalizedQuery) ||
                  character.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
          )
        : characters;

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) {
            return;
        }
        onImport(Array.from(files));
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <aside
            className={cn(
                'fixed inset-y-0 left-0 z-40 flex w-[286px] flex-col border-r border-line-soft bg-ink-soft/95 backdrop-blur-xl transition-transform duration-200 md:static md:z-auto md:translate-x-0 md:bg-ink-soft/55',
                open ? 'translate-x-0 shadow-2xl shadow-black/60' : '-translate-x-full md:translate-x-0',
            )}
            aria-label="Character library"
        >
            <div className="flex items-center gap-3 px-4 pb-3 pt-5">
                <Logo size={38} className="shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                    <h1 className="truncate font-display text-lg leading-tight tracking-wide text-parchment">
                        CatCup Tavern
                    </h1>
                    <p className="text-[11px] text-muted">Stories, served warm.</p>
                </div>
                <button
                    type="button"
                    className="icon-btn md:hidden"
                    onClick={onClose}
                    aria-label="Close character library"
                >
                    <X size={18} />
                </button>
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
                        placeholder="Search characters"
                        className="input-shell py-2 pl-9 text-sm"
                        aria-label="Search characters"
                    />
                </div>
            </div>

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
                    accept=".png,.json"
                    multiple
                    className="hidden"
                    onChange={(event) => handleFiles(event.target.files)}
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {loading ? (
                    <div className="flex justify-center py-10">
                        <Spinner size={18} className="text-muted" />
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm leading-relaxed text-muted">
                        {characters.length === 0
                            ? 'No characters yet. Import a PNG or JSON card to open the first door.'
                            : 'No characters match this search.'}
                    </div>
                ) : (
                    <div className="space-y-1">
                        {filtered.map((character) => {
                            const active = character.id === selectedCharacterId;
                            return (
                                <button
                                    key={character.id}
                                    type="button"
                                    onClick={() => onSelect(character.id)}
                                    className={cn(
                                        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition',
                                        active ? 'bg-surface-2 ring-1 ring-amber/25' : 'hover:bg-surface/70',
                                    )}
                                >
                                    <CharacterAvatar name={character.name} src={character.avatarUrl} size={38} />
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
                                    {active ? <span className="size-1.5 shrink-0 rounded-full bg-amber" /> : null}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="border-t border-line-soft px-3 py-3">
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-surface/60 px-3 py-2">
                    <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted/70">Active provider</p>
                        <p className="truncate text-xs text-parchment-dim">{activeProviderName ?? 'Not configured'}</p>
                    </div>
                    <span
                        className={cn('size-2 shrink-0 rounded-full', activeProviderReady ? 'bg-sage' : 'bg-amber/70')}
                        title={activeProviderReady ? 'Provider ready' : 'API key may be required'}
                    />
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
