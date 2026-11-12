import type { CharacterSummary } from '@catcup/shared';
import {
    ArrowUpDown,
    BookOpen,
    Check,
    ListChecks,
    Pencil,
    Sparkles,
    Star,
    StarOff,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { CharacterAvatar } from './CharacterAvatar';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

type SortKey = 'name' | 'name-desc' | 'updated' | 'created' | 'favorite';
type TagAction = 'add' | 'remove';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
    { value: 'name', label: 'Name (A–Z)' },
    { value: 'name-desc', label: 'Name (Z–A)' },
    { value: 'updated', label: 'Recently changed' },
    { value: 'created', label: 'Newest created' },
    { value: 'favorite', label: 'Favorites first' },
];

const SORT_STORAGE_KEY = 'catcup.library.sort';
const FAVORITES_STORAGE_KEY = 'catcup.library.favoritesOnly';

function readStorage(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorage(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // A blocked storage area only costs the preference for this session.
    }
}

function isSortKey(value: string | null): value is SortKey {
    return (
        value === 'name' || value === 'name-desc' || value === 'updated' || value === 'created' || value === 'favorite'
    );
}

function compareName(left: CharacterSummary, right: CharacterSummary): number {
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

/** A stable tiebreaker so equal names do not swap between refetches. */
function compareIds(left: CharacterSummary, right: CharacterSummary): number {
    return left.id.localeCompare(right.id);
}

const BULK_BUTTON =
    'flex items-center justify-center gap-1 rounded-lg border border-line/60 px-2 py-1 text-[11px] text-parchment-dim transition hover:border-amber/40 hover:text-parchment disabled:cursor-not-allowed disabled:opacity-40';

interface CharacterLibraryProps {
    characters: CharacterSummary[];
    loading: boolean;
    query: string;
    onClearQuery: () => void;
    selectedCharacterId: string | null;
    onSelect: (id: string) => void;
    onEdit: (id: string) => void;
    onToggleFavorite: (character: CharacterSummary) => void;
    onBulkFavorite: (ids: string[], favorite: boolean) => void;
    onBulkTag: (ids: string[], mode: TagAction, tag: string) => void;
    onBulkDelete: (ids: string[]) => void;
    onAddSample: () => void;
    addingSample: boolean;
    /** A favorite or bulk mutation is in flight; library actions wait for it. */
    busy: boolean;
}

/**
 * Character list with tag/favorite filters, sorting and a bulk-action mode.
 *
 * The view preferences survive a reload in `localStorage`; the tag filter and
 * the selection are deliberately session-only.
 */
export function CharacterLibrary({
    characters,
    loading,
    query,
    onClearQuery,
    selectedCharacterId,
    onSelect,
    onEdit,
    onToggleFavorite,
    onBulkFavorite,
    onBulkTag,
    onBulkDelete,
    onAddSample,
    addingSample,
    busy,
}: CharacterLibraryProps) {
    const [sort, setSort] = useState<SortKey>(() => {
        const stored = readStorage(SORT_STORAGE_KEY);
        return isSortKey(stored) ? stored : 'name';
    });
    const [favoritesOnly, setFavoritesOnly] = useState(() => readStorage(FAVORITES_STORAGE_KEY) === '1');
    const [tagFilters, setTagFilters] = useState<Set<string>>(() => new Set());
    const [selecting, setSelecting] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [tagAction, setTagAction] = useState<TagAction>('add');
    const [tagDialogOpen, setTagDialogOpen] = useState(false);
    const [tagDraft, setTagDraft] = useState('');
    const tagInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (tagDialogOpen) {
            tagInputRef.current?.focus();
        }
    }, [tagDialogOpen]);

    useEffect(() => {
        if (selectedIds.size === 0 && tagDialogOpen) {
            setTagDialogOpen(false);
            setTagDraft('');
        }
    }, [selectedIds.size, tagDialogOpen]);

    useEffect(() => writeStorage(SORT_STORAGE_KEY, sort), [sort]);
    useEffect(() => writeStorage(FAVORITES_STORAGE_KEY, favoritesOnly ? '1' : '0'), [favoritesOnly]);

    const normalizedQuery = query.trim().toLowerCase();
    const allTags = useMemo(() => {
        const tags = new Map<string, { key: string; label: string; count: number }>();
        for (const character of characters) {
            for (const tag of character.tags) {
                const label = tag.trim();
                if (!label) {
                    continue;
                }
                const key = label.toLowerCase();
                const current = tags.get(key);
                if (current) {
                    current.count += 1;
                } else {
                    tags.set(key, { key, label, count: 1 });
                }
            }
        }
        return [...tags.values()].sort(
            (left, right) => right.count - left.count || left.label.localeCompare(right.label),
        );
    }, [characters]);

    const filtered = useMemo(
        () =>
            characters.filter((character) => {
                if (favoritesOnly && !character.fav) {
                    return false;
                }
                if (tagFilters.size > 0) {
                    const characterTags = new Set(character.tags.map((tag) => tag.toLowerCase()));
                    if (![...tagFilters].every((tag) => characterTags.has(tag))) {
                        return false;
                    }
                }
                if (!normalizedQuery) {
                    return true;
                }
                return (
                    character.name.toLowerCase().includes(normalizedQuery) ||
                    character.creator.toLowerCase().includes(normalizedQuery) ||
                    character.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))
                );
            }),
        [characters, favoritesOnly, tagFilters, normalizedQuery],
    );

    const sorted = useMemo(() => {
        const list = [...filtered];
        list.sort((left, right) => {
            switch (sort) {
                case 'name-desc':
                    return compareName(right, left) || compareIds(left, right);
                case 'updated':
                    return right.updatedAt - left.updatedAt || compareName(left, right) || compareIds(left, right);
                case 'created':
                    return right.createdAt - left.createdAt || compareName(left, right) || compareIds(left, right);
                case 'favorite':
                    return Number(right.fav) - Number(left.fav) || compareName(left, right) || compareIds(left, right);
                default:
                    return compareName(left, right) || compareIds(left, right);
            }
        });
        return list;
    }, [filtered, sort]);

    const visibleIds = useMemo(() => new Set(sorted.map((character) => character.id)), [sorted]);
    const favoriteCount = characters.filter((character) => character.fav).length;
    const hasFilters = Boolean(normalizedQuery || favoritesOnly || tagFilters.size > 0);
    const emptyMessage =
        favoritesOnly && tagFilters.size === 0 && !normalizedQuery
            ? 'No favorites yet. Use the star on a character to keep it here.'
            : tagFilters.size > 0 && !favoritesOnly && !normalizedQuery
              ? 'No characters have all of these tags.'
              : 'No characters match these filters.';
    const allSelected = sorted.length > 0 && sorted.every((character) => selectedIds.has(character.id));
    const actionsReady = selectedIds.size > 0 && !busy;

    useEffect(() => {
        setSelectedIds((current) => {
            if (current.size === 0) {
                return current;
            }
            const next = new Set([...current].filter((id) => visibleIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [visibleIds]);

    useEffect(() => {
        setTagFilters((current) => {
            if (current.size === 0) {
                return current;
            }
            const available = new Set(allTags.map((tag) => tag.key));
            const next = new Set([...current].filter((key) => available.has(key)));
            return next.size === current.size ? current : next;
        });
    }, [allTags]);

    useEffect(() => {
        if (characters.length === 0 && selecting) {
            setSelecting(false);
            setSelectedIds(new Set());
        }
    }, [characters.length, selecting]);

    const clearFilters = () => {
        setFavoritesOnly(false);
        setTagFilters(new Set());
        onClearQuery();
    };

    const toggleSelectionMode = () => {
        if (selecting) {
            setSelecting(false);
            setSelectedIds(new Set());
        } else {
            setSelecting(true);
        }
    };

    const toggleSelected = (id: string) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const selectAll = () => setSelectedIds(new Set(sorted.map((character) => character.id)));
    const clearSelected = () => setSelectedIds(new Set());

    const openTagDialog = (action: TagAction) => {
        setTagAction(action);
        setTagDraft('');
        setTagDialogOpen(true);
    };

    const tagInvalid = tagDraft.includes(',');

    const submitTag = () => {
        const tag = tagDraft.trim();
        if (!tag || tag.includes(',') || selectedIds.size === 0) {
            return;
        }
        onBulkTag([...selectedIds], tagAction, tag);
        setTagDialogOpen(false);
        setTagDraft('');
    };

    const confirmDelete = () => {
        if (selectedIds.size === 0) {
            return;
        }
        const count = selectedIds.size;
        if (
            !window.confirm(
                `Delete ${count} ${count === 1 ? 'character' : 'characters'}? Their card files and CharX assets are removed; chats stay on disk but no longer appear in the library. This cannot be undone.`,
            )
        ) {
            return;
        }
        onBulkDelete([...selectedIds]);
        setSelecting(false);
        setSelectedIds(new Set());
    };

    if (loading) {
        return (
            <div className="flex justify-center py-10">
                <Spinner size={18} className="text-muted" />
            </div>
        );
    }

    if (characters.length === 0) {
        return (
            <div className="px-4 py-10 text-center text-sm leading-relaxed text-muted">
                <p>No characters yet. Import a PNG, JSON or CharX card to open the first door.</p>
                <button type="button" className="btn-ghost mx-auto mt-3" onClick={onAddSample} disabled={addingSample}>
                    {addingSample ? <Spinner size={15} /> : <Sparkles size={15} />}
                    Add the sample character
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="sticky top-0 z-10 -mx-1 mb-1 bg-ink-soft/95 px-1 pb-1 backdrop-blur">
                <div className="flex items-center gap-1">
                    <div className="relative min-w-0 flex-1">
                        <ArrowUpDown
                            size={12}
                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                            aria-hidden="true"
                        />
                        <select
                            aria-label="Sort characters"
                            value={sort}
                            onChange={(event) => setSort(event.target.value as SortKey)}
                            className="input-shell w-full py-1.5 pl-7 pr-1 text-xs"
                        >
                            {SORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        onClick={() => setFavoritesOnly((current) => !current)}
                        aria-pressed={favoritesOnly}
                        aria-label={favoritesOnly ? 'Show all characters' : 'Show favorites only'}
                        title={favoritesOnly ? 'Show all characters' : 'Show favorites only'}
                        className={cn(
                            'flex h-[30px] shrink-0 items-center gap-1 rounded-lg border px-2 text-[11px] transition',
                            favoritesOnly
                                ? 'border-amber/50 bg-amber/10 text-amber'
                                : 'border-line/60 text-muted hover:border-line hover:text-parchment',
                        )}
                    >
                        <Star size={12} className={favoritesOnly ? 'fill-current' : ''} aria-hidden="true" />
                        {favoriteCount}
                    </button>
                    <button
                        type="button"
                        onClick={toggleSelectionMode}
                        aria-pressed={selecting}
                        aria-label={selecting ? 'Exit selection mode' : 'Select characters'}
                        title={selecting ? 'Exit selection mode' : 'Select characters'}
                        className={cn(
                            'icon-btn size-[30px] shrink-0 rounded-lg border',
                            selecting
                                ? 'border-amber/50 bg-amber/10 text-amber'
                                : 'border-line/60 text-muted hover:text-parchment',
                        )}
                    >
                        {selecting ? <X size={14} /> : <ListChecks size={14} />}
                    </button>
                </div>

                {allTags.length > 0 ? (
                    <div className="mt-1.5 flex items-center gap-1 overflow-x-auto pb-0.5">
                        <Tag size={12} className="shrink-0 text-muted" aria-hidden="true" />
                        {allTags.map((tag) => (
                            <button
                                key={tag.key}
                                type="button"
                                onClick={() =>
                                    setTagFilters((current) => {
                                        const next = new Set(current);
                                        if (next.has(tag.key)) {
                                            next.delete(tag.key);
                                        } else {
                                            next.add(tag.key);
                                        }
                                        return next;
                                    })
                                }
                                aria-pressed={tagFilters.has(tag.key)}
                                title={`${tag.label} (${tag.count})`}
                                className={cn(
                                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-4 transition',
                                    tagFilters.has(tag.key)
                                        ? 'border-amber/50 bg-amber/10 text-amber'
                                        : 'border-line/60 text-muted hover:border-line hover:text-parchment-dim',
                                )}
                            >
                                {tag.label}
                                <span className="ml-1 opacity-60">{tag.count}</span>
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted/80">
                    <span aria-live="polite">
                        {hasFilters
                            ? `${sorted.length} of ${characters.length}`
                            : `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`}
                    </span>
                    {hasFilters ? (
                        <button type="button" onClick={clearFilters} className="text-amber/80 hover:text-amber">
                            Clear filters
                        </button>
                    ) : null}
                </div>

                {selecting ? (
                    <div className="mt-1 rounded-xl border border-amber/25 bg-amber/5 p-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="font-medium text-parchment-dim">{selectedIds.size} selected</span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="text-muted transition hover:text-parchment disabled:opacity-40"
                                    onClick={allSelected ? clearSelected : selectAll}
                                    disabled={sorted.length === 0}
                                >
                                    {allSelected ? 'None' : 'All'}
                                </button>
                                <button
                                    type="button"
                                    className="text-muted transition hover:text-parchment"
                                    onClick={toggleSelectionMode}
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                        <div className="mt-1.5 grid grid-cols-2 gap-1">
                            <button
                                type="button"
                                className={BULK_BUTTON}
                                onClick={() => onBulkFavorite([...selectedIds], true)}
                                disabled={!actionsReady}
                            >
                                <Star size={12} aria-hidden="true" />
                                Favorite
                            </button>
                            <button
                                type="button"
                                className={BULK_BUTTON}
                                onClick={() => onBulkFavorite([...selectedIds], false)}
                                disabled={!actionsReady}
                            >
                                <StarOff size={12} aria-hidden="true" />
                                Unfavorite
                            </button>
                            <button
                                type="button"
                                className={BULK_BUTTON}
                                onClick={() => openTagDialog('add')}
                                disabled={!actionsReady}
                            >
                                <Tag size={12} aria-hidden="true" />
                                Add tag
                            </button>
                            <button
                                type="button"
                                className={BULK_BUTTON}
                                onClick={() => openTagDialog('remove')}
                                disabled={!actionsReady}
                            >
                                <Tag size={12} aria-hidden="true" />
                                Remove tag
                            </button>
                            <button
                                type="button"
                                className={cn(
                                    BULK_BUTTON,
                                    'col-span-2 text-red-300 hover:border-red-400/40 hover:text-red-200',
                                )}
                                onClick={confirmDelete}
                                disabled={!actionsReady}
                            >
                                <Trash2 size={12} aria-hidden="true" />
                                Delete selected
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>

            {sorted.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm leading-relaxed text-muted">
                    <p>{emptyMessage}</p>
                    <button type="button" className="btn-ghost mx-auto mt-3" onClick={clearFilters}>
                        Clear filters
                    </button>
                </div>
            ) : (
                <div className="space-y-1">
                    {sorted.map((character) => {
                        const active = character.id === selectedCharacterId;
                        const selected = selectedIds.has(character.id);
                        return (
                            <div
                                key={character.id}
                                className={cn(
                                    'flex items-center rounded-xl transition',
                                    selecting
                                        ? selected
                                            ? 'bg-amber/10 ring-1 ring-amber/30'
                                            : 'hover:bg-surface/70'
                                        : active
                                          ? 'bg-surface-2 ring-1 ring-amber/25'
                                          : 'hover:bg-surface/70',
                                )}
                            >
                                {selecting ? (
                                    <span
                                        className={cn(
                                            'ml-1.5 flex size-4 shrink-0 items-center justify-center rounded border',
                                            selected
                                                ? 'border-amber bg-amber text-ink'
                                                : 'border-line/80 text-transparent',
                                        )}
                                        aria-hidden="true"
                                    >
                                        <Check size={11} strokeWidth={3} />
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => (selecting ? toggleSelected(character.id) : onSelect(character.id))}
                                    aria-pressed={selecting ? selected : undefined}
                                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left"
                                >
                                    <CharacterAvatar name={character.name} src={character.avatarUrl} size={36} />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5">
                                            <span className="truncate text-sm font-medium text-parchment">
                                                {character.name}
                                            </span>
                                            {selecting && character.fav ? (
                                                <Star
                                                    size={11}
                                                    className="shrink-0 fill-current text-amber"
                                                    aria-label="Favorite"
                                                />
                                            ) : null}
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
                                                ? character.tags
                                                      .slice(0, 2)
                                                      .map((tag) => tag.trim())
                                                      .join(' · ')
                                                : character.creator || 'No tags'}
                                        </span>
                                    </span>
                                    {!selecting && active ? (
                                        <span className="size-1.5 shrink-0 rounded-full bg-amber" />
                                    ) : null}
                                </button>
                                {selecting ? null : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => onToggleFavorite(character)}
                                            aria-label={
                                                character.fav
                                                    ? `Remove ${character.name} from favorites`
                                                    : `Add ${character.name} to favorites`
                                            }
                                            aria-pressed={character.fav}
                                            title={character.fav ? 'Remove from favorites' : 'Add to favorites'}
                                            disabled={busy}
                                            className={cn(
                                                'icon-btn size-7 shrink-0 disabled:opacity-40',
                                                character.fav ? 'text-amber' : 'text-muted hover:text-parchment',
                                            )}
                                        >
                                            <Star size={13} className={character.fav ? 'fill-current' : ''} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onEdit(character.id)}
                                            aria-label={`Edit ${character.name}`}
                                            className="icon-btn mr-1.5 size-7 shrink-0 text-muted hover:text-parchment"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal
                open={tagDialogOpen && selectedIds.size > 0}
                onClose={() => setTagDialogOpen(false)}
                title={tagAction === 'add' ? 'Add a tag' : 'Remove a tag'}
                widthClassName="max-w-md"
            >
                <div className="space-y-3 p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        {tagAction === 'add' ? 'Add this tag to' : 'Remove this tag from'} {selectedIds.size}{' '}
                        {selectedIds.size === 1 ? 'selected character' : 'selected characters'}.
                    </p>
                    <div>
                        <label className="label-text" htmlFor="library-bulk-tag">
                            Tag
                        </label>
                        <input
                            id="library-bulk-tag"
                            ref={tagInputRef}
                            className="input-shell"
                            value={tagDraft}
                            onChange={(event) => setTagDraft(event.target.value)}
                            list="library-bulk-tag-options"
                            placeholder="e.g. fantasy"
                            maxLength={200}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    submitTag();
                                }
                            }}
                        />
                        <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                            {tagInvalid
                                ? 'Tags cannot contain commas.'
                                : 'Case-insensitive; the spelling already on a card is kept.'}
                        </p>
                        <datalist id="library-bulk-tag-options">
                            {allTags.map((tag) => (
                                <option key={tag.key} value={tag.label} />
                            ))}
                        </datalist>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setTagDialogOpen(false)}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={submitTag}
                            disabled={!tagDraft.trim() || tagInvalid || busy}
                        >
                            {tagAction === 'add' ? 'Add tag' : 'Remove tag'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
