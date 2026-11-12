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
    type SettingsPatch,
    type SettingsResponse,
} from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths } from './paths.js';

function createDefaultSettings(): AppSettings {
    const providers: ProviderConfig[] = [
        {
            id: randomUUID(),
            kind: 'openai',
            name: 'OpenAI',
            baseUrl: DEFAULT_BASE_URLS.openai,
            model: 'gpt-5',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'anthropic',
            name: 'Anthropic',
            baseUrl: DEFAULT_BASE_URLS.anthropic,
            model: 'claude-sonnet-5-5',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'openrouter',
            name: 'OpenRouter',
            baseUrl: DEFAULT_BASE_URLS.openrouter,
            model: '',
            enabled: true,
            headers: {},
        },
        {
            id: randomUUID(),
            kind: 'ollama',
            name: 'Ollama',
            baseUrl: DEFAULT_BASE_URLS.ollama,
            model: 'llama3.2',
            enabled: true,
            headers: {},
        },
    ];

    return {
        version: 1,
        activeProviderId: providers[0]?.id ?? null,
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
}

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

    if (settings.providers.length === 0) {
        const defaults = createDefaultSettings();
        settings.providers = defaults.providers;
        settings.activeProviderId = defaults.activeProviderId;
        changed = true;
    }

    if (
        !settings.activeProviderId ||
        !settings.providers.some((provider) => provider.id === settings.activeProviderId)
    ) {
        settings.activeProviderId = settings.providers[0]?.id ?? null;
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

    return { settings, changed, corrupt: false };
}

let cachedSettings: AppSettings | null = null;

async function loadSettingsUnlocked(): Promise<AppSettings> {
    if (cachedSettings) {
        return cachedSettings;
    }

    const raw = await readJsonFile<unknown>(paths.settings, null);
    const { settings, changed, corrupt } = normalizeSettings(raw);

    if (corrupt && raw !== null) {
        const backup = `${paths.settings}.corrupt-${Date.now()}`;
        await writeJsonFile(backup, raw);
        console.error(`[settings] Invalid settings.json backed up to ${backup}`);
    }

    if (changed) {
        await writeJsonFile(paths.settings, settings);
    }
    cachedSettings = settings;
    return settings;
}

async function mutateSettings<T>(mutator: (settings: AppSettings) => T | Promise<T>): Promise<T> {
    return withFileLock(paths.settings, async () => {
        const settings = await loadSettingsUnlocked();
        const result = await mutator(settings);
        await writeJsonFile(paths.settings, settings);
        cachedSettings = settings;
        return result;
    });
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
        if (patch.activeProviderId !== undefined) {
            if (
                patch.activeProviderId !== null &&
                !settings.providers.some((provider) => provider.id === patch.activeProviderId)
            ) {
                throw new Error('Provider not found');
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

export async function createProvider(input: ProviderInput): Promise<ProviderPublic> {
    const created = await mutateSettings<ProviderConfig>((settings) => {
        const provider: ProviderConfig = {
            id: randomUUID(),
            kind: input.kind,
            name: input.name,
            baseUrl: input.baseUrl || DEFAULT_BASE_URLS[input.kind] || '',
            model: input.model,
            enabled: input.enabled,
            headers: input.headers,
        };
        settings.providers.push(provider);
        if (!settings.activeProviderId) {
            settings.activeProviderId = provider.id;
        }
        return provider;
    });

    await setProviderSecret(created.id, input.apiKey);
    const secrets = await getSecrets();
    return { ...created, hasKey: Boolean(secrets[created.id]) };
}

export async function updateProvider(providerId: string, input: ProviderInput): Promise<ProviderPublic> {
    const updated = await mutateSettings<ProviderConfig>((settings) => {
        const provider = settings.providers.find((candidate) => candidate.id === providerId);
        if (!provider) {
            throw new Error('Provider not found');
        }
        provider.kind = input.kind;
        provider.name = input.name;
        provider.baseUrl = input.baseUrl || DEFAULT_BASE_URLS[input.kind] || '';
        provider.model = input.model;
        provider.enabled = input.enabled;
        provider.headers = input.headers;
        return provider;
    });

    await setProviderSecret(providerId, input.apiKey);
    const secrets = await getSecrets();
    return { ...updated, hasKey: Boolean(secrets[providerId]) };
}

export async function deleteProvider(providerId: string): Promise<void> {
    await mutateSettings((settings) => {
        const index = settings.providers.findIndex((provider) => provider.id === providerId);
        if (index === -1) {
            throw new Error('Provider not found');
        }
        settings.providers.splice(index, 1);
        if (settings.activeProviderId === providerId) {
            settings.activeProviderId = settings.providers[0]?.id ?? null;
        }
    });

    await setProviderSecret(providerId, '');
}

export function clearSettingsCache(): void {
    cachedSettings = null;
}
