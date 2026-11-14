import { randomUUID } from 'node:crypto';

import {
    type AppSettings,
    appSettingsSchema,
    DEFAULT_AUTHOR_NOTE,
    DEFAULT_BASE_URLS,
    DEFAULT_GENERATION_SETTINGS,
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    DEFAULT_MEMORY_SETTINGS,
    DEFAULT_PERSONA,
    DEFAULT_QUICK_REPLY_SETTINGS,
    DEFAULT_TTS_SETTINGS,
    DEFAULT_UI_SETTINGS,
    DEFAULT_WORLD_INFO_CONFIG,
    isRecord,
    LEGACY_PERSONA_ID,
    type ProviderConfig,
    type ProviderInput,
    type ProviderPublic,
    personaSchema,
    providerConfigSchema,
    type PersonaView,
    type SettingsPatch,
    type SettingsResponse,
} from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths } from './paths.js';
import { listAllPersonas, listSharedPersonas } from './personas.js';

function createDefaultSettings(): AppSettings {
    const providers: ProviderConfig[] = [
        {
            id: randomUUID(),
            kind: 'openai',
            name: 'OpenAI',
            baseUrl: DEFAULT_BASE_URLS.openai,
            models: ['gpt-5'],
            defaultModel: 'gpt-5',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'anthropic',
            name: 'Anthropic',
            baseUrl: DEFAULT_BASE_URLS.anthropic,
            models: ['claude-sonnet-5-5'],
            defaultModel: 'claude-sonnet-5-5',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'openrouter',
            name: 'OpenRouter',
            baseUrl: DEFAULT_BASE_URLS.openrouter,
            models: [],
            defaultModel: '',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'ollama',
            name: 'Ollama',
            baseUrl: DEFAULT_BASE_URLS.ollama,
            models: ['llama3.2'],
            defaultModel: 'llama3.2',
            enabled: true,
            headers: {},
        },
    ];

    return {
        version: 1,
        activeProviderId: providers[0]?.id ?? null,
        profilePreferredModel: '',
        providers,
        activePresetId: null,
        generation: { ...DEFAULT_GENERATION_SETTINGS },
        personas: [{ id: LEGACY_PERSONA_ID, ...DEFAULT_PERSONA }],
        activePersonaId: LEGACY_PERSONA_ID,
        ui: { ...DEFAULT_UI_SETTINGS },
        worldInfo: { ...DEFAULT_WORLD_INFO_CONFIG },
        authorNote: { ...DEFAULT_AUTHOR_NOTE },
        memory: { ...DEFAULT_MEMORY_SETTINGS },
        quickReplies: { ...DEFAULT_QUICK_REPLY_SETTINGS },
        tts: { ...DEFAULT_TTS_SETTINGS },
        imageGeneration: { ...DEFAULT_IMAGE_GENERATION_SETTINGS },
    };
}

interface NormalizedSettings {
    settings: AppSettings;
    changed: boolean;
    corrupt: boolean;
    /** Providers to persist to the shared file, when the profile file carried them. */
    providersFromProfile?: ProviderConfig[];
}

/**
 * Normalize a profile's settings file.
 *
 * Providers are shared by every profile and live in `providers.json`, so this
 * function does not own them: a file that still carries a `providers` array is
 * one written before the split, and the caller lifts that array out into the
 * shared file. Everything else is per profile.
 */
function normalizeSettings(raw: unknown): NormalizedSettings {
    if (!isRecord(raw)) {
        return { settings: createDefaultSettings(), changed: true, corrupt: raw !== null };
    }

    const parsed = appSettingsSchema.safeParse(raw);
    if (!parsed.success) {
        return { settings: createDefaultSettings(), changed: true, corrupt: true };
    }

    const settings = parsed.data;
    let changed = false;

    // A settings file written before the provider list was shared keeps its
    // providers here; the caller moves them to `providers.json`.
    let providersFromProfile: ProviderConfig[] | undefined;
    if (Array.isArray(raw.providers)) {
        providersFromProfile = settings.providers.map((provider) => ({ ...provider }));
        changed = true;
    }

    // Files written before the persona list carry one `persona` object. Promote
    // it once so the list is the only source of truth from then on.
    if (settings.personas.length === 0) {
        const legacy = personaSchema.safeParse(isRecord(raw) ? raw.persona : undefined);
        settings.personas = [
            {
                id: LEGACY_PERSONA_ID,
                name: legacy.success ? legacy.data.name : DEFAULT_PERSONA.name,
                description: legacy.success ? legacy.data.description : DEFAULT_PERSONA.description,
            },
        ];
        settings.activePersonaId = LEGACY_PERSONA_ID;
        changed = true;
    } else if (settings.activePersonaId && !settings.personas.some((item) => item.id === settings.activePersonaId)) {
        settings.activePersonaId = settings.personas[0]?.id ?? null;
        changed = true;
    }

    return { settings, changed, corrupt: false, ...(providersFromProfile ? { providersFromProfile } : {}) };
}

/** Settle the profile's active provider against the shared provider list. */
function normalizeActiveProvider(settings: AppSettings, providers: readonly ProviderConfig[]): boolean {
    const active = providers.find((provider) => provider.id === settings.activeProviderId);
    if (active?.enabled) {
        return false;
    }
    const nextActive = providers.find((provider) => provider.enabled)?.id ?? null;
    if (settings.activeProviderId === nextActive) {
        return false;
    }
    settings.activeProviderId = nextActive;
    return true;
}

let cachedSettings: AppSettings | null = null;

/**
 * Read the shared provider list from `providers.json`.
 *
 * A missing file means a data folder written before the split: the providers
 * are created once from the defaults, and the first mutation writes them out.
 *
 * A record written before #76 carries one `model` string; it is read as a
 * one-entry list with that entry as the default, so an existing provider keeps
 * the model it was using.
 */
async function loadSharedProviders(): Promise<ProviderConfig[]> {
    const raw = await readJsonFile<unknown>(paths.providers, null);
    if (!Array.isArray(raw)) {
        return createDefaultSettings().providers;
    }

    const providers: ProviderConfig[] = [];
    for (const candidate of raw) {
        const parsed = providerConfigSchema.safeParse(candidate);
        if (!parsed.success) {
            continue;
        }
        const provider = parsed.data;
        if (isRecord(candidate) && 'model' in candidate && !('models' in candidate)) {
            const legacyModel = typeof candidate.model === 'string' ? candidate.model.trim() : '';
            provider.models = legacyModel ? [legacyModel] : [];
            provider.defaultModel = legacyModel;
        }
        providers.push(provider);
    }
    return providers;
}

async function saveSharedProviders(providers: readonly ProviderConfig[]): Promise<void> {
    await writeJsonFile(paths.providers, providers);
}

async function loadSettingsUnlocked(): Promise<AppSettings> {
    if (cachedSettings) {
        return cachedSettings;
    }

    const raw = await readJsonFile<unknown>(paths.settings, null);
    const normalized = normalizeSettings(raw);
    const { settings, corrupt, providersFromProfile } = normalized;
    let changed = normalized.changed;

    if (corrupt && raw !== null) {
        const backup = `${paths.settings}.corrupt-${Date.now()}`;
        await writeJsonFile(backup, raw);
        console.error(`[settings] Invalid settings.json backed up to ${backup}`);
    }

    // A file that still carries providers predates the split: move them to the
    // shared file once and stop writing them into the profile.
    if (providersFromProfile) {
        await saveSharedProviders(providersFromProfile);
    }
    const providers = providersFromProfile ?? (await loadSharedProviders());
    settings.providers = providers;
    if (normalizeActiveProvider(settings, providers)) {
        changed = true;
    }

    // A persona marked reusable lives in `data/shared/personas.json`. It joins
    // the profile's own list here, so every consumer of `getSettings()` — the
    // prompt assembler, a chat's persona pin — resolves against one list without
    // each of them merging it separately. `writeProfileSettings` filters the
    // shared entries out again, which is why this merge can be unconditional.
    settings.personas = await listAllPersonas(settings.personas);
    if (
        settings.activePersonaId !== null &&
        !settings.personas.some((persona) => persona.id === settings.activePersonaId)
    ) {
        settings.activePersonaId = settings.personas[0]?.id ?? null;
        changed = true;
    }

    if (changed) {
        await writeProfileSettings(settings);
    }
    cachedSettings = settings;
    return settings;
}

/**
 * Write a profile's settings file.
 *
 * Two fields are in memory but not in this file. `providers` belongs to
 * `providers.json`, and writing it here would shadow the shared file on the
 * next load — a provider created after the last write would vanish. A persona
 * that lives in `shared/personas.json` belongs there for the same reason:
 * writing it here would duplicate it on the next load and make it undeletable.
 *
 * Every write goes through here, so a caller that only touched an unrelated
 * field still cannot leak a shared persona into the profile. That matters
 * because `getSettings()` hands back the merged list.
 */
async function writeProfileSettings(settings: AppSettings): Promise<void> {
    const { providers: _shared, ...profile } = settings;
    const sharedIds = new Set((await listSharedPersonas()).map((persona) => persona.id));
    // The list in memory is the merged one, whose entries carry `scope` and
    // `shadowed`. Neither belongs in this file: every persona stored here is the
    // profile's own by definition, and the scope is derived again on read.
    profile.personas = profile.personas
        .filter((persona) => !sharedIds.has(persona.id))
        .map((persona) => ({ id: persona.id, name: persona.name, description: persona.description }));
    await writeJsonFile(paths.settings, profile);
}

async function mutateSettings<T>(mutator: (settings: AppSettings) => T | Promise<T>): Promise<T> {
    return withFileLock(paths.settings, async () => {
        const settings = await loadSettingsUnlocked();
        const result = await mutator(settings);
        await writeProfileSettings(settings);
        cachedSettings = settings;
        return result;
    });
}

/** The personas this profile itself owns, without the shared ones merged in. */
export async function profilePersonas(settings: AppSettings): Promise<AppSettings['personas']> {
    const sharedIds = new Set((await listSharedPersonas()).map((persona) => persona.id));
    return settings.personas.filter((persona) => !sharedIds.has(persona.id));
}

export async function getSettings(): Promise<AppSettings> {
    if (cachedSettings) {
        return cachedSettings;
    }
    return withFileLock(paths.settings, loadSettingsUnlocked);
}

export async function getSecrets(): Promise<Record<string, string>> {
    const raw = await readJsonFile<unknown>(paths.secrets, {});
    if (!isRecord(raw)) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

export async function getProviderSecret(providerId: string): Promise<string | undefined> {
    const secrets = await getSecrets();
    return secrets[providerId];
}

/** The single TTS key lives beside provider keys, under a fixed name. */
const TTS_SECRET_KEY = 'tts';

/** The single image generation key lives beside the TTS key. */
const IMAGE_SECRET_KEY = 'image';

export async function getTtsSecret(): Promise<string | undefined> {
    return (await getSecrets())[TTS_SECRET_KEY];
}

export async function getImageSecret(): Promise<string | undefined> {
    return (await getSecrets())[IMAGE_SECRET_KEY];
}

export async function setTtsSecret(apiKey: string | undefined): Promise<void> {
    if (apiKey === undefined) {
        return;
    }
    await withFileLock(paths.secrets, async () => {
        const secrets = await getSecrets();
        if (apiKey === '') {
            delete secrets[TTS_SECRET_KEY];
        } else {
            secrets[TTS_SECRET_KEY] = apiKey;
        }
        await writeJsonFile(paths.secrets, secrets);
    });
}

export async function setImageSecret(apiKey: string | undefined): Promise<void> {
    if (apiKey === undefined) {
        return;
    }
    await withFileLock(paths.secrets, async () => {
        const secrets = await getSecrets();
        if (apiKey === '') {
            delete secrets[IMAGE_SECRET_KEY];
        } else {
            secrets[IMAGE_SECRET_KEY] = apiKey;
        }
        await writeJsonFile(paths.secrets, secrets);
    });
}

async function setProviderSecret(providerId: string, apiKey: string | undefined): Promise<void> {
    if (apiKey === undefined) {
        return;
    }

    await withFileLock(paths.secrets, async () => {
        const secrets = await getSecrets();
        if (apiKey === '') {
            delete secrets[providerId];
        } else {
            secrets[providerId] = apiKey;
        }
        await writeJsonFile(paths.secrets, secrets);
    });
}

export async function getPublicProviders(): Promise<ProviderPublic[]> {
    const [settings, secrets] = await Promise.all([getSettings(), getSecrets()]);
    return settings.providers.map((provider) => ({
        ...provider,
        hasKey: Boolean(secrets[provider.id]),
    }));
}

export async function getSettingsResponse(): Promise<SettingsResponse> {
    const settings = await getSettings();
    const [providers, secrets] = await Promise.all([getPublicProviders(), getSecrets()]);
    return {
        ...settings,
        // `loadSettingsUnlocked` merges the shared personas in and stamps each
        // entry with its scope, so the list is already the shape the response
        // wants. Merging here instead would treat the shared entries as this
        // profile's own.
        personas: settings.personas as PersonaView[],
        providers,
        ttsHasKey: Boolean(secrets[TTS_SECRET_KEY]),
        imageHasKey: Boolean(secrets[IMAGE_SECRET_KEY]),
    };
}

export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
    const settings = await getSettings();
    return settings.providers.find((provider) => provider.id === providerId) ?? null;
}

export async function getActiveProvider(): Promise<ProviderConfig | null> {
    const settings = await getSettings();
    const active = settings.providers.find((provider) => provider.id === settings.activeProviderId && provider.enabled);
    if (active) {
        return active;
    }
    return settings.providers.find((provider) => provider.enabled) ?? null;
}

async function mutateSettingsNow(patch: SettingsPatch): Promise<AppSettings> {
    return mutateSettings((settings) => {
        if (patch.profilePreferredModel !== undefined) {
            settings.profilePreferredModel = patch.profilePreferredModel;
        }
        if (patch.activeProviderId !== undefined) {
            if (patch.activeProviderId !== null) {
                const provider = settings.providers.find((item) => item.id === patch.activeProviderId);
                if (!provider) {
                    throw new Error('Provider not found');
                }
                if (!provider.enabled) {
                    throw new Error('Provider is disabled');
                }
            }
            settings.activeProviderId = patch.activeProviderId;
        }
        if (patch.activePresetId !== undefined) {
            settings.activePresetId = patch.activePresetId;
        }
        if (patch.generation) {
            settings.generation = { ...settings.generation, ...patch.generation };
        }
        if (patch.personas !== undefined) {
            settings.personas = patch.personas;
            if (
                settings.activePersonaId !== null &&
                !settings.personas.some((item) => item.id === settings.activePersonaId)
            ) {
                settings.activePersonaId = settings.personas[0]?.id ?? null;
            }
        }
        if (patch.activePersonaId !== undefined) {
            settings.activePersonaId =
                patch.activePersonaId !== null && settings.personas.some((item) => item.id === patch.activePersonaId)
                    ? patch.activePersonaId
                    : (settings.personas[0]?.id ?? null);
        }
        if (patch.ui) {
            settings.ui = { ...settings.ui, ...patch.ui };
        }
        if (patch.worldInfo) {
            settings.worldInfo = { ...settings.worldInfo, ...patch.worldInfo };
        }
        if (patch.authorNote) {
            settings.authorNote = { ...settings.authorNote, ...patch.authorNote };
        }
        if (patch.memory) {
            settings.memory = { ...settings.memory, ...patch.memory };
        }
        if (patch.quickReplies) {
            settings.quickReplies = { ...settings.quickReplies, ...patch.quickReplies };
        }
        if (patch.tts) {
            settings.tts = { ...settings.tts, ...patch.tts };
        }
        if (patch.imageGeneration) {
            settings.imageGeneration = { ...settings.imageGeneration, ...patch.imageGeneration };
        }
        return settings;
    });
}

/**
 * Persist settings and, when the patch carries one, the TTS key.
 *
 * The key is written to `secrets.json` only after the settings save succeeds,
 * so a failed patch cannot leave a new key behind.
 */
export async function updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const settings = await mutateSettingsNow(patch);
    if (patch.ttsApiKey !== undefined) {
        await setTtsSecret(patch.ttsApiKey);
    }
    if (patch.imageApiKey !== undefined) {
        await setImageSecret(patch.imageApiKey);
    }
    return settings;
}

/**
 * Point the account set list at a renamed set.
 *
 * A chat may keep its own `chat_metadata.quickReply` links; those are left
 * alone, matching SillyTavern's per-chat configuration.
 */
export async function renameQuickReplySetReference(oldName: string, newName: string): Promise<void> {
    await mutateSettings((settings) => {
        const seen = new Set<string>();
        settings.quickReplies.setList = settings.quickReplies.setList
            .map((link) => (link.set === oldName ? { ...link, set: newName } : link))
            .filter((link) => {
                if (seen.has(link.set)) {
                    return false;
                }
                seen.add(link.set);
                return true;
            });
    });
}

/** Drop a deleted set from the account set list. */
export async function removeQuickReplySetReference(name: string): Promise<void> {
    await mutateSettings((settings) => {
        settings.quickReplies.setList = settings.quickReplies.setList.filter((link) => link.set !== name);
    });
}

/**
 * Serialize a read-modify-write of the shared provider list.
 *
 * Providers are machine-wide, so a create in one profile is visible in every
 * other. The profile's `activeProviderId` is adjusted separately, inside the
 * profile's own lock, because that field *is* per profile.
 */
async function mutateSharedProviders<T>(mutate: (providers: ProviderConfig[]) => T): Promise<T> {
    return withFileLock(paths.providers, async () => {
        const providers = await loadSharedProviders();
        const result = mutate(providers);
        await saveSharedProviders(providers);
        clearSettingsCache();
        return result;
    });
}

/** Keep the profile's active provider usable after the shared list changes. */
async function revalidateActiveProvider(): Promise<void> {
    await mutateSettings((settings) => {
        normalizeActiveProvider(settings, settings.providers);
    });
}

export async function createProvider(input: ProviderInput): Promise<ProviderPublic> {
    const created = await mutateSharedProviders((providers) => {
        const provider: ProviderConfig = {
            id: randomUUID(),
            kind: input.kind,
            name: input.name,
            baseUrl: input.baseUrl || DEFAULT_BASE_URLS[input.kind] || '',
            models: [...input.models],
            defaultModel: input.defaultModel,
            enabled: input.enabled,
            headers: input.headers,
        };
        providers.push(provider);
        return provider;
    });

    // The first usable provider becomes this profile's active one.
    await mutateSettings((settings) => {
        if (!settings.activeProviderId && created.enabled) {
            settings.activeProviderId = created.id;
        }
    });

    await setProviderSecret(created.id, input.apiKey);
    const secrets = await getSecrets();
    return { ...created, hasKey: Boolean(secrets[created.id]) };
}

export async function updateProvider(providerId: string, input: ProviderInput): Promise<ProviderPublic> {
    const updated = await mutateSharedProviders((providers) => {
        const provider = providers.find((candidate) => candidate.id === providerId);
        if (!provider) {
            throw new Error('Provider not found');
        }
        provider.kind = input.kind;
        provider.name = input.name;
        provider.baseUrl = input.baseUrl || DEFAULT_BASE_URLS[input.kind] || '';
        provider.models = [...input.models];
        provider.defaultModel = input.defaultModel;
        provider.enabled = input.enabled;
        provider.headers = input.headers;
        return provider;
    });

    // Disabling the provider this profile had active must not leave it active.
    await revalidateActiveProvider();
    await setProviderSecret(providerId, input.apiKey);
    const secrets = await getSecrets();
    return { ...updated, hasKey: Boolean(secrets[providerId]) };
}

export async function deleteProvider(providerId: string): Promise<void> {
    await mutateSharedProviders((providers) => {
        const index = providers.findIndex((provider) => provider.id === providerId);
        if (index === -1) {
            throw new Error('Provider not found');
        }
        providers.splice(index, 1);
    });

    await revalidateActiveProvider();
    await setProviderSecret(providerId, '');
}

/**
 * Forget the cached configuration, so the next read comes from disk.
 *
 * Called when the settings change outside this module — a profile switch, or a
 * migration that moved the file — and by tests that point the server at a new
 * data directory.
 */
export function clearSettingsCache(): void {
    cachedSettings = null;
}
