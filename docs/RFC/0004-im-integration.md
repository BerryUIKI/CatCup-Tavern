# RFC 0004 — Talking to a character from an IM client

- **Issue:** none yet; this is the first write-up
- **Status:** Proposed 2026-11-20 — the questions that need an answer are in §9

## 1. The problem

Three things were asked for at once, and they are not three features: they are
one core and two neighbours.

1. **IM as a chat channel** — talk to a character from Telegram/Discord and
   CatCup is the backend.
2. **Import chat logs from IM** — turn an exported conversation into a CatCup
   chat.
3. **Remote control from IM** — the server runs at home; you send a line from
   your phone and get the character's reply back.

(2) and (3) are smaller and mostly independent, so they are treated as their own
slices at the end. This page is about (1), because it decides everything else.

## 2. What exists today

The app is **single-user, local-first, and server-authoritative**:

- one access password, one session cookie, no accounts and no tenancy;
- prompt assembly, provider calls, key storage and persistence all on the Node
  server; the browser holds a cookie and nothing else;
- every write goes through `apps/server/src/storage/`, and derived state lives
  in a sidecar beside its source;
- **`runGenerationStream` takes a `FastifyReply`** (`generation/stream.ts:7`),
  opens SSE on it, and aborts the generation when the socket closes
  (`stream.ts:51-55`).

That last point is the real obstacle. Generation is not a service that has an
HTTP face; it _is_ an HTTP handler. An IM bot has no `FastifyReply` and no
socket that stays open for the reply — Telegram gives you one HTTP call per
message and a 4,096-character limit.

There is no notification, webhook or push infrastructure anywhere in the tree.

## 3. The decision that has to come first: who is talking to whom

Single-user is a hard constraint in this codebase, not an accident. Every route
assumes "the one person". An IM bot breaks that assumption the moment a second
person can message it, and the failure is not cosmetic — the bot would share
one chat history, one persona and one set of provider keys across strangers.

So the first question is not "which platform" but **who may reach the bot**:

| Model                        | What it means                                                  | Cost                                                                                      |
| ---------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Owner only**               | One allowlisted IM user id. Everyone else is ignored silently. | Small. Keeps the single-user invariant exactly.                                           |
| **Few, each with a profile** | A short allowlist, each mapped to a CatCup profile.            | The profiles feature already exists, so this is a mapping table, not a new tenancy model. |
| **Open**                     | Anyone who finds the bot gets a chat.                          | Needs per-user storage, quota, abuse control and a real threat model. Weeks, not days.    |

**Recommendation: owner only first.** It is the only one that does not
invalidate `SECURITY.md`'s threat model, and it still delivers everything the
user asked for — talking from a phone, remote control, importing logs. "Few,
each with a profile" is a natural second step because profiles already exist.
Open is a different product.

## 4. The transport question

Each platform differs in one thing that matters: **how it reaches you.**

| Platform     | How the bot receives                      | Notes                                                                                                                      |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Telegram** | Long polling by default; webhook optional | No public IP, no TLS, no domain. Works on a laptop on hotel wifi. Bot API is one HTTPS endpoint. 4,096-char message limit. |
| **Discord**  | Gateway WebSocket                         | Needs a bot token and a persistent socket; reconnects and heartbeats are on us. Message limit 2,000.                       |
| **Slack**    | Socket Mode WS, or webhook                | Socket Mode needs no public URL. More approval ceremony (app manifest, scopes).                                            |
| **Matrix**   | Client-server API, sync loop              | Same shape as Telegram polling, self-hostable, no vendor approval. Heavier protocol.                                       |

Telegram's long polling is the only one where **the default deployment needs
nothing exposed**. For a local-first app whose users run it at home or on a
laptop, that is decisive. I would build **Telegram first**, behind an adapter
interface shaped like the existing provider adapters, so Discord is a second
implementation rather than a second architecture.

The existing adapter precedent is the right model to copy: `providers/index.ts`
`getAdapter(config)` returns an object with a fixed interface, and each
provider file implements it. An `im/` directory with `telegram.ts` and a
`getTransport()` factory would sit the same way.

## 5. What has to be refactored, and how much

### 1. Generation must stop requiring a `FastifyReply`

This is the load-bearing change. Today `runGenerationStream` owns the SSE
response. It should instead own **the iteration and the persistence**, and let
the caller decide where the tokens go:

```ts
// today
await runGenerationStream({ reply, provider, model, prompt, …, persist });

// after
for await (const event of generateReply({ provider, model, prompt, … })) {
    // the HTTP route writes SSE; the IM transport collects text
}
```

Concretely: extract the `for await (chunk of adapter.streamChat(...))` loop and
the `persist` call out of the SSE body; keep `activeGenerations` and the
`AbortController` so stop still works; make the abort trigger a caller-supplied
signal rather than `reply.raw.on('close')`.

**Cost:** both `generate.ts` (447 lines) and `groupGenerate.ts` (598) call it
once each, so the refactor is contained — two call sites, one shared function.
**Risk:** moderate. The SSE route's behaviour must not change, and there is a
lot of behaviour in there (partial reply on stop, swipe replacement, group
speaker attribution, regex transforms). Existing tests cover it, which is what
makes this safe.

### 2. Chat storage is already right

`appendMessage` / `readChat` / `updateMessage` are plain functions over a
profile-scoped path. An IM message and a browser message become the same
`ChatMessage` with the same JSONL. **No change needed** — which is the point of
having kept the storage layer HTTP-free.

### 3. Who the chat belongs to

An IM conversation needs a chat, and the app's chats are per character and per
group. A sensible mapping:

- one Telegram chat ↔ one CatCup chat, selected by an in-IM `/chat <name>`
  command or bound on first use;
- the binding lives in a sidecar (`im-bindings.json` under the profile), not in
  `chat_metadata`, because it is CatCup-only wiring rather than anything about
  the story — and `chat_metadata` is already carrying `persona_id` and the
  summary anchors.

### 4. Reply length and formatting

Telegram caps a message at 4,096 characters; a roleplay reply can exceed it.
Split on paragraph boundaries and send in order, which is what a person would
do. Do **not** try to stream edits token by token: the Bot API allows roughly
one edit per second per chat and a rate-limited edit loop looks worse than a
single finished message.

The command surface should be small and explicit (`/chat`, `/new`, `/stop`,
`/who`, `/help`), because a bare text message has to mean "talk to the bound
character" and nothing else.

## 6. The other two requests

Both are smaller and neither depends on the transport.

### Import chat logs from IM

Telegram Desktop and most clients export a JSON or HTML transcript; Discord has
no first-party export, Matrix does. This is a **parser plus a mapping into
`ChatMessage`**, in the same shape as `import/sillytavern.ts` — no network, no
token, run from a settings screen on a file the user already has.

It is genuinely useful and it is the cheapest of the three: an afternoon for
Telegram's JSON export, with the usual care about who counts as "the user".

### Remote control from IM

This is what "chat channel with owner-only access" already gives you. There is
no separate feature: once your Telegram id is allowlisted and a chat is bound,
sending a line _is_ remote control. What it additionally wants is a couple of
commands that are about the instance rather than the story — `/status` (is a
generation running), `/stop`, `/provider` — and a notification when a
generation started from the browser finishes. That last one is the "push a
notification" option, and it is worth adding only after the channel exists,
because it reuses the same send path.

## 7. What I would build, in order

| Step | Work                                                                              | Why first                                                                 |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | Extract `generateReply` from `runGenerationStream`; SSE route keeps its behaviour | Nothing else is possible without it, and it is a pure refactor with tests |
| 2    | `im/` transport interface + Telegram long-polling transport, owner-only allowlist | Proves the shape with the platform that needs no exposed port             |
| 3    | Chat binding (sidecar) + `/chat`, `/new`, `/stop`, `/help`                        | Makes it usable                                                           |
| 4    | Long-reply splitting, error mapping (provider down → a message, not silence)      | Makes it not embarrassing                                                 |
| 5    | Telegram log import                                                               | Independent, cheap, immediately useful                                    |
| 6    | Notifications when a browser generation finishes                                  | Reuses 2's send path                                                      |
| 7    | Discord transport, if wanted                                                      | Second implementation of 2, not a second design                           |

Steps 1–2 are the only ones with real uncertainty; 3–4 are mechanical; 5–6 are
independent and can be done by anyone at any time.

## 8. Risks and open questions

- **Security surface.** A bot token is a credential that can post as the bot and
  read its messages. It belongs in `data/secrets.json` beside the provider keys,
  never in `settings.json`, and the allowlist must be server-side — a client-side
  check is decoration.
- **A bot token in a local-first app is a new kind of asset.** The threat model
  currently says "the machine and network the server runs on". A bot means the
  _platform_ is in the loop: Telegram sees every message. That should be stated
  plainly rather than discovered.
- **Group chats are ambiguous over IM.** A Telegram group has several humans; a
  CatCup group chat has several characters. Mapping one to the other is
  confusing. Owner-only means "ignore group messages", which is the safe
  default.
- **Streaming does not survive the trip.** SSE is a browser protocol. Over IM
  the reply arrives whole. The CLI-side behaviour (stop mid-stream) can be
  offered as `/stop` only while the generation is running, which is honest.
- **Do we want a queue?** If two messages arrive while a generation runs, the
  second must wait or be refused. Refusing with a message is simplest and
  clearest.

## 9. Questions for review

1. **Owner-only, or an allowlist mapped to profiles?** (Recommendation:
   owner-only first.)
2. **Telegram first, or a different platform the user actually uses?** The
   long-polling advantage only matters if Telegram is the right platform for
   them.
3. **Is the bot token acceptable at all**, given it puts a third party in the
   message path? For a roleplay app that stores private stories, that is the
   user's call, not mine.
