# Providers

CatCup Tavern speaks to four chat provider families through a small adapter interface, and to text-to-speech endpoints through a separate adapter. All chat provider calls happen on the server, so API keys never reach the browser. The browser speech-synthesis TTS backend is the one exception: it runs locally and needs no key.

## Provider kinds

| Kind         | Default base URL               | Protocol                                  | Key required |
| ------------ | ------------------------------ | ----------------------------------------- | ------------ |
| `openai`     | `https://api.openai.com/v1`    | OpenAI Chat Completions                   | Usually      |
| `openrouter` | `https://openrouter.ai/api/v1` | OpenAI-compatible + attribution headers   | Yes          |
| `anthropic`  | `https://api.anthropic.com/v1` | Anthropic Messages API                    | Yes          |
| `ollama`     | `http://127.0.0.1:11434`       | Native Ollama NDJSON                      | No           |
| `custom`     | user supplied                  | Any OpenAI-compatible `/chat/completions` | Depends      |

The active provider is selected in Settings. Generation uses the provider's configured `model`; per-chat or per-character model overrides are not implemented yet.

## Configuration

Providers are stored in `data/settings.json` as public configuration:

```json
{
    "id": "provider-uuid",
    "kind": "custom",
    "name": "Local model",
    "baseUrl": "http://127.0.0.1:8080/v1",
    "model": "example-model",
    "enabled": true,
    "headers": {}
}
```

`headers` can add provider-specific HTTP headers (for example an organization header or a custom gateway token). API keys are stored separately in `data/secrets.json`, keyed by provider ID, plus a fixed `tts` entry for text to speech. The API returns `hasKey` only; it never returns the key.

The Settings UI can add, edit, duplicate and delete providers, and the library footer switches the active one from a list without opening settings. A new provider starts as a `custom` endpoint — the kind that takes any base URL — and the model field accepts any id: **Load** only fills the suggestion list from the provider's own model endpoint.

Duplicating a provider copies its configuration but not its API key, since the key belongs to the original provider's entry in `data/secrets.json`.

## OpenAI-compatible (`openai`, `openrouter`, `custom`)

**Streaming request**

```http
POST <baseUrl>/chat/completions
Authorization: Bearer <apiKey>
Content-Type: application/json
```

```json
{
    "model": "model-id",
    "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
    "stream": true,
    "temperature": 1,
    "top_p": 1,
    "max_tokens": 2048
}
```

**Streaming response** is parsed as SSE. CatCup reads:

- `choices[0].delta.content` (string or text-part array);
- `choices[0].delta.reasoning_content` or `choices[0].delta.reasoning`;
- `usage.prompt_tokens` / `usage.completion_tokens` when present;
- `data: [DONE]` as end of stream.

`openrouter` adds `HTTP-Referer` and `X-Title` headers unless the user overrides them. `custom` is the escape hatch for Ollama's OpenAI-compatible endpoint, LM Studio, vLLM, gateways and other `/chat/completions` servers.

**Model list:** `GET <baseUrl>/models`. Some compatible servers do not implement it; in that case "Save & test" fails even though chat may work. Type the model ID manually and use the provider anyway.

## Anthropic

**Streaming request**

```http
POST <baseUrl>/messages
x-api-key: <apiKey>
anthropic-version: 2023-06-01
Content-Type: application/json
```

```json
{
    "model": "claude-sonnet-5-5",
    "max_tokens": 2048,
    "system": "...",
    "messages": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }],
    "stream": true,
    "temperature": 1,
    "top_p": 1
}
```

CatCup converts the flat prompt into Anthropic's shape:

- all `system` messages are joined into the top-level `system` field;
- consecutive user or assistant messages are merged with blank lines;
- an assistant-only beginning is preceded by a `[Start of chat]` user message;
- an assistant-last prompt is valid and acts as continuation/prefill.

**Streaming response** events handled:

- `message_start` → prompt token count;
- `content_block_delta` with `text_delta` → text;
- `content_block_delta` with `thinking_delta` → reasoning;
- `message_delta` → completion token count;
- `error` → provider error;
- `message_stop` → end.

**Model list:** `GET <baseUrl>/models?limit=1000`.

## Ollama

**Streaming request**

```http
POST <baseUrl>/api/chat
Content-Type: application/json
```

```json
{
    "model": "llama3.2",
    "messages": [{ "role": "user", "content": "..." }],
    "stream": true,
    "options": {
        "temperature": 1,
        "top_p": 1,
        "num_predict": 2048
    }
}
```

The base URL has a trailing `/v1` stripped before native calls, so both `http://127.0.0.1:11434` and `http://127.0.0.1:11434/v1` work.

**Streaming response** is NDJSON, one JSON object per line:

- `message.content` → text;
- `message.thinking` → reasoning;
- `done: true` → end;
- `prompt_eval_count` / `eval_count` → usage;
- `error` → provider error.

**Model list:** `GET <baseUrl>/api/tags`.

## Streaming normalization

All adapters produce a common stream:

```ts
type StreamChunk =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'usage'; promptTokens?: number; completionTokens?: number };
```

The server converts these to SSE events `token`, `reasoning` and `done` (with usage). See [API.md](API.md).

## Adding a provider adapter

1. Add a `kind` to `providerKindSchema` and the default base URL map in `packages/shared/src/schemas/provider.ts`.
2. Implement `ProviderAdapter` in `apps/server/src/providers/<name>.ts`:
   - `streamChat(config, apiKey, request)`;
   - `listModels(config, apiKey)`;
   - `test(config, apiKey)`.
3. Register it in `apps/server/src/providers/index.ts`.
4. Add a provider entry to the Settings UI only if it needs custom fields; most adapters use the generic form.
5. Add tests with a mocked fetch/stream where practical.
6. Update this page, [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) and `CHANGELOG.md`.
7. If the adapter is derived from ST or RisuAI, update `NOTICE` and [REUSE.md](REUSE.md).

## Text to speech

Settings → TTS has two backends:

- **Browser voices (local).** Uses the browser's `speechSynthesis` voices. CatCup makes no server request and needs no key; some browsers' voice lists are network-backed, which is the browser vendor's behaviour. Configure the default voice, rate (0.1–2) and pitch (0–2); per-character voices are chosen from the same list.
- **OpenAI-compatible endpoint.** Calls `POST <baseUrl>/audio/speech` with the configured model, voice, format and speed, plus `instructions` when the model is `gpt-4o-mini-tts`. The key is stored in `data/secrets.json` under `tts` and is required only for an `api.openai.com` host; a local server that needs no key works without one. Works with OpenAI and with local servers that expose the same endpoint (for example openedai-speech or Kokoro-FastAPI).

The default voice is used for any character without an entry in the character voice map; `narratorVoice` overrides it for narrator notes. Autoplay speaks each newly completed assistant reply. Text is cleaned of code blocks, HTML tags, images, links and markdown emphasis before it is sent. The full field list is in [API.md](API.md#settings); the text-preparation behavior is described in [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md).

## Image generation

Settings → Images has two backends:

- **Automatic1111 / Forge.** Calls `POST <baseUrl>/sdapi/v1/txt2img` with the prompt, negative prompt, steps, CFG scale, dimensions, sampler and optional seed. The response is `images[0]`, either raw base64 or a data URL. No key is needed; if one is configured it is sent as HTTP Basic auth, so enter `user:password`. Save & test calls `GET /sdapi/v1/options`.
- **OpenAI-compatible endpoint.** Calls `POST <baseUrl>/images/generations` with the model, prompt, `n: 1` and a model-appropriate size (`dall-e-3`, `gpt-image-*` and other models map differently). DALL·E models are asked for `response_format: b64_json`; the gpt-image family returns base64 by default. A response that contains an image URL instead is downloaded server-side with the same size and protocol limits. The key is stored in `data/secrets.json` under `image` and is required only for an `api.openai.com` host. Save & test calls `GET /models`, which is advisory: a server can generate images without implementing that route.

The prompt sent to the backend is `imageGeneration.promptPrefix` followed by the user's prompt. The negative prompt applies to A1111. **Draft from chat** asks the active chat provider for a prompt using `promptTemplate` over the last `contextMessages` messages; it is an ordinary chat completion and counts against that provider's usage.

Generated images are stored in `data/user/images/<character or group>/` with a metadata sidecar and are inserted into the chat as SillyTavern `extra.media` messages. The server caps one image at 25 MB and a generation request at 180 seconds. The full field list is in [API.md](API.md#settings) and the storage layout in [DATA-FORMATS.md](DATA-FORMATS.md).

## Current limitations

- Text chat, speech output and image output only: no vision/image inputs, tool calling, embeddings or the OpenAI Responses API. TTS is a separate `/audio/speech` adapter, not part of the chat adapters.
- Text-to-speech supports only the two backends above; SillyTavern's other TTS provider extensions are not implemented.
- Image generation supports Automatic1111/Forge and OpenAI-compatible endpoints in this release. ComfyUI workflow graphs, Stability, NovelAI and the other ST image sources are not implemented; ComfyUI is the next adapter planned.
- There is one image generation configuration at a time; per-character backends, image-to-image, inpainting, upscaling, image upload and automatic per-message generation are not available.
- Images are generated one at a time; the gallery has no thumbnails, folders or bulk export yet.
- `max_tokens` is sent to OpenAI-compatible providers; models that require `max_completion_tokens` may need a compatibility flag in a future adapter.
- Only string reasoning fields are mapped; provider-specific reasoning formats may be ignored.
- No per-provider proxy configuration; use a custom base URL or server-level networking.
- No request timeout configuration; generation is stopped by the user or by client disconnect.
- Model lists are advisory; the model field is free text.
- There is one active provider for every chat; per-chat or per-character model overrides and provider fallback are not available.
- There is no automatic fallback between providers.

## Security

- API keys are stored server-side in `data/secrets.json` and are never returned by the API.
- The client only sees `hasKey` for providers, `ttsHasKey` for text to speech and `imageHasKey` for image generation.
- Provider errors are passed to the UI after being truncated; avoid including keys in custom headers where possible.
- Do not put keys in `settings.json`, screenshots, logs or issue reports.
- See [SECURITY.md](SECURITY.md) for the full model.
