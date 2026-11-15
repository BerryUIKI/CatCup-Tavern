# RFC 0003 — Guided roleplay: a director layer, and story mode on top of it

- **Issue:** [#104](https://github.com/BerryUIKI/CatCup-Tavern/issues/104)
- **Status:** Proposed 2026-11-15
- **Touches:** `packages/shared/src/schemas/`, `apps/server/src/director/`, `apps/server/src/routes/`, `apps/server/src/prompt/`, `apps/server/src/distill/`, `apps/web/src/components/`, `docs/API.md`, `docs/DATA-FORMATS.md`, `docs/LIMITATIONS.md`, `CHANGELOG.md`

## The problem

CatCup can hold a conversation. It cannot run a story.

Everything the app knows how to do with a reply is "the model writes a message, the person writes one back". A distilled novel (RFC 0002) arrives as a cast of cards and a world info book — the raw material for playing _inside_ a book — and the library can already turn a card into a persona (#101) so the person speaks as someone from it. What is missing is the part that makes it a story rather than a chat:

1. **Nobody decides who is on screen.** A single chat has one speaking character. A group picks a speaker by a rule (`selection.ts`) and generates exactly one reply. Neither can say "the scene opens in the stairwell, only Mira is there, and the father is still upstairs".
2. **There is no way to offer the person a choice.** The composer is free text only. A guided story asks "what do you do?", which is a question with answers.
3. **A chat cannot carry story state.** Chapter, scene, what has already happened, which threads are open — there is nowhere to put any of it. `chat_metadata` is an untyped bag, and the only keys CatCup reads from it are `persona_id`, `timedWorldInfo` and the Quick Reply links.
4. **The Author's Note is unusable as a director slot.** The server honours one (`authorNoteSchema`, `settings.ts:104`) but it is a single global setting with no screen, so one chat's director rules would apply to every chat.

## What ships

Two layers, deliberately separated, because the second needs work the first does not.

### Layer 1 — the director

A per-chat layer that runs **on top of an existing chat**, single or group. It does three things:

- **Decides who is present and who may speak this turn**, overriding the group's activation strategy for that turn.
- **Writes narrative beats** as narrator messages (`extra.type === 'narrator'`, which both views already render and speaker selection already skips).
- **Asks for a choice**: a short list of options attached to a message, each of which becomes the person's next message when clicked.

It needs no new content. The cards and the world info the person already has are the material.

### Layer 2 — story mode

Story mode is the director **plus a story graph distilled from a book**: chapters, scenes, and the beats that link them. The person can see where they are ("第一幕 · 菜场小巷, 1/12") and the director aims at the next beat instead of improvising one.

The graph is a **new distillation output**, not something RFC 0002 already produces: 0002 emits entities (characters, places, facts) and never a plot structure. Story mode therefore depends on a second distillation pass that has not been designed yet; see "Open questions".

## Layer 1 in detail

### The chat carries a director config

`chat_metadata.director` — a typed object, absent on every chat that does not use one, so nothing changes for chats that don't. `chat_metadata` is preserved through read/write today and travels with the JSONL, as `persona_id` already does.

```ts
interface DirectorConfig {
    enabled: boolean;
    /** How the next speaker is chosen for this chat. */
    speakerMode: 'auto' | 'rotate' | 'director';
    /**
     * Cast the person plays: present in the prompt, never written by the model.
     * Avatar file names, so a name survives a card being renamed.
     */
    playedMembers: string[];
    /** Standing instructions, the replacement for a global Author's Note. */
    rules: string;
    /** Offer choices after each reply. */
    choices: boolean;
    /** How many options to offer, when `choices` is on. */
    choiceCount: number;
}
```

Defaults: `enabled: false`, `speakerMode: 'auto'`, `playedMembers: []`, `rules: ''`, `choices: false`, `choiceCount: 3`.

A chat with `enabled: false` — every chat written before this change — behaves exactly as it does today. That is the compatibility promise and a test asserts it.

### Playing a member, single chat or group

The person picks who they play. That character's card:

- **stays in the prompt**, so the model knows who they are, what they look like and how they speak;
- **is never written by the model** — its file name goes into `disabled_members` in a group, which already means "present but does not reply" (`groups.ts:189`);
- **is never offered a persona slot of its own**; the person's persona is still the account persona, and the played member is injected as a second identity block.

In a single chat this is the ordinary case: the one card is the played member, and the model's job is to write everyone _else_. Because a single chat has exactly one card, `playedMembers` there is really "the person plays this card, so the model narrates around it" — see "Open questions" on whether the single-chat path should require a group.

**A single chat refuses to play its own card.** The card block in the prompt says "you are `{{char}}`" (`assemble.ts`, the `CHAR_DESCRIPTION` literal), so a chat that both speaks as its character and forbids writing them contradicts itself. This is validated, not warned about:

- `playedMembers` in a single chat may name **any role except the chat's own character** — a narrator card, another NPC, or nothing at all.
- Naming the chat's own character is a `400`, with a message pointing at two ways forward: put the cast in a group, or keep this card as the narrator and play somebody the world book describes.

A group has no such collision: the speaking member is chosen per turn, and a played member is muted for the whole chat.

New prompt identifier: `directorRules`, placed after `personaDescription` and before `charDescription`, so the director's standing instructions sit with the other system material and not in the dialogue. Its content is `DirectorConfig.rules` plus a generated cast block:

```
You run this scene. Write the world and every character the player is not playing.
Player controls: {{playedNames}} — never write their dialogue or decisions.
Present now: {{presentNames}}.
```

An empty `rules` with `enabled: true` still emits the cast block, which is the useful half.

This replaces the missing Author's Note screen for this purpose and does **not** remove it: the Author's Note stays as it is for people who want it, and the director is the per-chat, structured alternative.

### Choices

A reply can carry a list of options:

```ts
interface DirectorChoices {
    options: Array<{ id: string; label: string /** Optional long form, shown on hover. */; detail?: string }>;
}
```

Stored on the message as `extra.director = { choices: DirectorChoices }` — an unknown `extra` key, which the chat writer already preserves.

- The UI renders them under the message as buttons; clicking one sends its `label` as the person's next message (exactly what typing it would do).
- The composer keeps working; a person who ignores the buttons is never blocked.
- An option may also be a **non-action** ("say nothing, keep walking") — it is still just a message.
- Options are stripped from the prompt's history once answered, so they do not accumulate. A message whose choices were used stays a normal message; only `extra.director.usedOptionId` is added, for the context inspector.

How the model produces them: a **final instruction** appended after the history for that one generation — the same mechanism the group nudge uses (`assemble.ts:469`).

The format is a **line-oriented sentinel block, not JSON**, and that choice is the reliability plan rather than a detail:

```
她抬起眼睛看着你，没有立刻回答。

<<<CHOICES>>>
掏出手机看那条短信
假装没看到，直接下楼
站在门口，回头再看一眼那扇门
<<<END>>>
```

JSON is fragile in exactly the way a streamed reply is: brackets and quotes have to balance, one unescaped quote kills the object, and a truncated stream loses everything. A line format has none of those failure modes — every complete line is a usable option, so a stream cut off mid-block still yields the lines before the cut, and an empty block yields no options rather than an exception. `extractJson`'s fenced-code and bracket-scanning recovery in `distill/analyze.ts:82` exists precisely because JSON-in-a-stream is unreliable; this avoids needing that machinery per turn.

Three layers of defence, cheapest first:

1. **The sentinel block.** No escaping, incrementally parseable, truncation-tolerant.
2. **Anthropic prefill, where the adapter has it.** `ProviderRequest.assistantPrefill` already exists (`types.ts:29`, joined in `anthropic.ts:56`). Prefilling the reply with `<<<CHOICES>>>\n` leaves the model nothing to do but write options, so the format cannot drift. OpenAI-compatible and local adapters have no equivalent, so this is a bonus path, never a requirement.
3. **One small follow-up request, only on parse failure.** A short prompt over the reply just written, asking for the block alone. Triggered rarely, so the extra round trip is not paid every turn.

If all three fail, **the message simply has no options** and the composer still works. Choices are an enhancement and must never be able to block a reply.

Story mode does not use any of this: its options come from the graph's `choices`, so they need no generation and cannot fail.

### Who speaks next

`speakerMode` extends the existing strategies rather than replacing them:

| Mode       | Behaviour                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto`     | Today's group `activation_strategy`, unchanged.                                                                                                                                |
| `rotate`   | List order, skipping played members.                                                                                                                                           |
| `director` | The model was asked, in the same call that produced the last reply, for a one-line `next` field naming the next speaker; a name not in the cast is ignored and `auto` applies. |

Played members are excluded from every mode. `POST .../generate`'s existing `speaker` field still forces a specific member and wins over all three.

### Presentation

A narrator message is already a first-class thing: `MessageBubble.tsx` treats `extra.type === 'narrator'` as not-user, TTS picks the narrator voice for it, and speaker selection skips it (`selection.ts:52`). The director uses it for scene-setting paragraphs and for the "what do you do?" prompt line. No new message kind is needed.

## Layer 2 in detail

### What it adds

- `chat_metadata.story = { graphId, nodeId, visited: string[], state: Record<string, unknown> }`
- A **story graph** on disk: `stories/<id>.json`, produced by distilling a book's plot, reviewed the same way RFC 0002's draft is.
- A story panel: where you are, what you have seen, a way to rewind to a node.

### The graph

```ts
interface StoryNode {
    id: string;
    title: string; // "菜场小巷"
    act: string; // "第一幕"
    /** Prose the director may use to open the scene. */
    beats: string[];
    /** Who is expected on stage. */
    cast: string[];
    /** World info entries this scene should guarantee. */
    entries: string[];
    choices: Array<{ label: string; goesTo: string | null }>;
    /** Where the story continues when no choice is taken. */
    continues: string | null;
    /** Free-form facts the director must keep true here. */
    state: Record<string, unknown>;
}
```

Options in a story node are the graph's, not the model's: the director fills in prose, the graph decides where the story can go. That is the difference between "guided" and "improvised".

### The second distillation

The plot pass is a sibling of RFC 0002's pipeline, sharing its upload, chunking, SSE and review semantics, but with a different contract: instead of "who and what exists", it asks "what happens, in what order, and what could the person do at each step". Its output is a **proposal** — a chapter and scene skeleton with beats and candidate branches — reviewed and edited before it becomes a graph, because a model's plot summary is a starting point, not a script.

It is not designed here. Scope, contract and cost belong in its own RFC, and story mode waits for it.

## What this is not

- **Not a STscript engine.** No scripting language, no event bus, no extension host; those are M3.
- **Not an auto-play loop.** The director does not keep generating turns on a timer. (SillyTavern's group auto mode is separate and already has `auto_mode_delay`.)
- **Not a save/load for branches.** Rewinding a story node rewrites `story.nodeId`; it does not fork the chat. Branching chats are out of scope.
- **Not a change to how existing chats behave.** A chat with no `director` key and no `story` key is byte-identical on the next write.

## Open questions

1. **Does a single chat need the played-member mechanism at all?** A single chat has one card. If the person plays it, the prompt both asserts "you are this character" and forbids writing them. **Settled: playable members are allowed in a single chat, but never the chat's own character** — that is a `400`, and the message offers a group or a narrator card instead. A narrator card whose job is the world, with the person playing someone the world book describes, is the single-chat shape that works, and it needs no second card.
2. **Where does `rules` live for a shared profile?** A director config is chat-level, so it is not affected by RFC 0001's scoping — but a _story graph_ is library content and would be. `stories/` should follow the same profile/shared split as characters, and the graph id is referenced from `chat_metadata`, which does not travel across profiles either.
3. **Is the choices block reliable across providers?** Settled by construction rather than by a spike: a line-oriented sentinel block that degrades to "fewer options" instead of to unparseable output, Anthropic prefill where the adapter has it, one follow-up request only on failure, and no options at all as the last resort. The residual risk is a model that ignores the instruction entirely, which costs the fallback request and nothing else.
4. **Do choices belong on the assistant's message or on a narrator message?** Putting them on the assistant's reply keeps one message per turn; putting them on their own narrator message keeps the reply text clean and makes "the director speaks" visually separate. Leaning toward the assistant's message with a distinct border.
5. **How much story state does the director need in the prompt?** A node's `beats` and `state` are small; `visited` grows. The prompt should get the current node and a compressed note of what was visited, not the whole list.
6. **Should the option count be fixed or adaptive?** A fixed 3 is easy to parse and easy to render. Adaptive ("as many as the scene supports") reads better but makes the parser and the UI defensive. A sentinel block settles most of this: an empty or short block is a normal outcome, not a malformed one.

## Acceptance criteria

### Layer 1

- [ ] A chat with no `director` key produces the same prompt and the same file after a reply as it does today (a test asserts it).
- [ ] An enabled director injects its rules and cast block at `directorRules`, after the persona and before the character description.
- [ ] A played member is present in the prompt and never written by the model — in a group by being in `disabled_members`, in a single chat by the director's cast block.
- [ ] Playing a single chat's own character is rejected with a `400` whose message names the way out (a group, or a narrator card).
- [ ] Choices render under a reply, clicking one sends that label, and ignoring them leaves the composer fully usable.
- [ ] The sentinel block is stripped from the stored prose and its lines become `extra.director.choices`.
- [ ] A truncated or missing sentinel block stores the prose unchanged and yields fewer or no options; it never fails the reply.
- [ ] `speakerMode` `rotate` and `director` both skip played members; an unknown name from the model falls back to `auto`.
- [ ] `chat_metadata.director` round-trips through the JSONL and is ignored by SillyTavern readers without error.

### Layer 2

- [ ] Not accepted until the plot distillation has its own RFC.

### Docs

- [ ] `docs/API.md`, `docs/DATA-FORMATS.md` (the `director` and `story` metadata keys, `stories/`), `docs/LIMITATIONS.md` and `CHANGELOG.md` are updated in the same change.
- [ ] `docs/MILESTONES.md` gains the scope when the RFC is accepted, per the "scope moves, update MILESTONES first" rule.
