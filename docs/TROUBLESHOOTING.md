# Troubleshooting

Start with the health endpoint and the server logs:

```bash
curl -fsS http://127.0.0.1:8000/api/health
CATCUP_LOG_LEVEL=debug pnpm dev
```

## The app does not open

**`pnpm dev` starts but the page is blank**

- Open http://localhost:5173, not the API port, during development.
- Check that Vite is running and that `/api` requests proxy to `:8000`.
- Look at the browser console and the Vite terminal.

**Production page is 404**

- Run `pnpm build` first; the server serves `apps/web/dist` only when it exists.
- Open http://127.0.0.1:8000.
- Check the server log for the static root path.

**Port already in use**

- Change `CATCUP_PORT` or stop the conflicting process.
- The Vite dev port is fixed to `5173` (`strictPort: true`).

**Cannot reach it from another device**

- Start with `CATCUP_HOST=0.0.0.0`.
- Check the firewall allows the port only from trusted LAN devices.
- Use the LAN IP printed by the server at startup.
- If a reverse proxy is involved, verify it forwards to the server and preserves `Host`.

## Setup and login

**Setup returns 403**

First-run setup is accepted only from loopback. Open the app on the machine running the server and set the password there. `CATCUP_ALLOW_REMOTE_SETUP=true` exists but is unsafe on an untrusted network.

**Setup returns 409**

`data/auth.json` already exists. Use login instead. If the password is lost, see “Reset the password” below.

**Login says “Incorrect password”**

- Check the password; the minimum is 8 characters at setup.
- If the password was changed by deleting/recreating `auth.json`, old sessions are invalid.
- Login is rate-limited to 10 attempts per minute; wait and retry.

**Login succeeds but the app returns to the login screen**

- The session cookie may be rejected. Check that cookies are enabled for the site.
- Behind a reverse proxy, verify the `Host` header and origin match the browser URL; the API rejects cross-origin mutations.
- If the proxy or browser is stripping cookies, fix that first.
- Deleting `data/auth.json` changes the session secret and invalidates all sessions; log in again.

**Password reset**

Stop the server, back up `data/`, delete `data/auth.json`, start the server and set a new password. This logs out every device. Do not delete `data/settings.json` unless you also want to reset providers.

## Providers

**“Save & test” fails but chat might still work**

The test calls the provider's model-list endpoint. Some OpenAI-compatible servers do not implement `/models`. Type the model ID manually and try a generation; the test failure is advisory.

**OpenAI-compatible provider returns 401/403**

- Check the API key and that it is saved (the UI shows a “has key” state).
- Check the base URL ends at the API root, e.g. `https://api.openai.com/v1` or `http://127.0.0.1:8080/v1`.
- Some gateways need extra headers; add them in the provider's `headers` field via the API, or use a custom provider configuration.

**OpenRouter errors**

- OpenRouter uses the OpenAI-compatible protocol; the base URL should be `https://openrouter.ai/api/v1`.
- The adapter sends `HTTP-Referer` and `X-Title`; custom values can be supplied via headers.
- Check the model ID and account credits.

**Anthropic errors**

- Use base URL `https://api.anthropic.com/v1`.
- The adapter sends `x-api-key` and `anthropic-version: 2023-06-01`.
- Anthropic requires alternating roles and a user-first sequence; the adapter merges messages and inserts `[Start of chat]` when needed.
- If the model rejects `max_tokens`, reduce max tokens.

**Ollama errors**

- Confirm Ollama is running: `curl http://127.0.0.1:11434/api/tags`.
- The base URL may be `http://127.0.0.1:11434` or `http://127.0.0.1:11434/v1`; the adapter strips `/v1` for native calls.
- Pull the model first: `ollama pull llama3.2`.
- No API key is required.

**Generation starts and immediately errors**

- Check the server log for the provider status and response body.
- Verify the active provider and model in Settings.
- Some providers reject the configured `max_tokens` or sampling values; lower them.
- If a reverse proxy is used, disable buffering for SSE and increase read timeouts.

## Chat and messages

**The user message appears but the reply fails**

The user message is saved before generation. Check the generation error banner, then inspect the chat JSONL. A failed generation leaves the user message; delete it or retry.

**Streaming freezes**

- A proxy may be buffering the SSE response. Disable proxy buffering for `/api/generate`.
- The server sends a `: ping` comment every 15s; a proxy with a short idle timeout may still cut it.
- Check the provider's stream and the browser network tab.

**Regenerate seems to duplicate a message**

Regenerate stores the previous assistant text in `extra.swipes` and selects the new variant. The UI hides the old variant while streaming and refetches after completion. If the data looks wrong, inspect the JSONL `extra.swipes` / `swipe_id`.

**A chat is missing**

- The folder is named after the character name, with the character ID as a fallback. Renaming a card file can disconnect an existing chat folder; rename the folder too.
- Check file permissions and that the `.jsonl` extension is present.
- Look at the server log for parse errors.

**Import fails**

- PNG cards need a `chara` or `ccv3` `tEXt` chunk.
- JSON cards must be a V2/V3 wrapper or a legacy flat object.
- `.charx` is not supported yet.
- Files over 20 MB or more than 50 files per request are rejected.
- The card is saved under the sanitized display name; collisions get a numeric suffix.

**Context trimming cuts off the start of a long chat**

The M0 prompt builder uses an approximate token budget (`contextSize - maxTokens`) and keeps the newest messages. This is expected until the model-aware tokenizer lands in M1. Reduce the message length or raise context size if the provider supports it.

## Data and reset

**Where is my data?**

Default `./data` at the repository root; check `CATCUP_DATA_DIR` if set. The server log prints the effective port, not the data path; inspect the environment or the process command line.

**Reset local state**

Stop the server first. Then:

- password/session reset: delete `data/auth.json`;
- provider reset: delete `data/settings.json` and `data/secrets.json`;
- full reset: back up and remove `data/` (deletes characters, chats and credentials).

Never commit `data/`.

**Backup and restore**

Copy the entire `data/` directory while the server is stopped. The backup contains API keys and password hashes; protect it. Restore by copying it back and restarting.

## Logs and diagnostics

- Server logs are pino JSON in production, pretty-printed in development.
- `CATCUP_LOG_LEVEL=debug` increases detail.
- Authorization, cookie and `x-api-key` headers are redacted.
- API errors use `{ error, code }`; include the status and code in a report, not secrets or private chat text.
- The health endpoint is public: `GET /api/health`.

## Reporting a problem

Open an issue with:

- the CatCup version and OS;
- the provider kind (never the key);
- the exact error message and HTTP status;
- reproduction steps;
- relevant logs with secrets and private content removed.

For security issues, use GitHub's private security advisory instead of a public issue. See [SECURITY.md](SECURITY.md).

## Related docs

- [Deployment](DEPLOYMENT.md)
- [Security](SECURITY.md)
- [Data formats](DATA-FORMATS.md)
- [Providers](PROVIDERS.md)
