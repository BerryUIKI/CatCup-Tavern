# Card writing: what makes a card actually play well

This is the craft half of the skill. The format half is in `SKILL.md`; this page is what to reach
for when a card is correct but feels flat.

## The test

Read the card back and ask: **could the model produce a line that surprises me?** A card that only
describes someone produces a narrator who recites the description. A card with voice produces
someone who answers back.

## `description` — the outside

What a stranger sees and what the world knows. Appearance, age, job, how they dress, what people say
about them. Physical detail is what image prompts draw from, so it earns its place.

Keep it in third person, present tense. `description` goes into the prompt uncooked — no commentary,
no "the character is…", just the facts.

Length: 100–250 characters for a minor character; up to a few hundred for a protagonist whose
appearance recurs. Beyond that, the model spends context repeating instead of acting.

## `personality` — the engine

Behaviour, not adjectives. The difference:

| Weak               | Strong                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| "Kind and gentle." | "Answers a hard question with a different question. Notices when someone is avoiding something and lets them." |
| "Aggressive."      | "Never raises his voice. Gets slower and quieter instead, and that is the warning."                            |

Three or four sentences, each one a _thing they do_. Include one habit and one thing they are bad at.

## `scenario` — the opening frame

A place, a moment, and who is where. Not a synopsis, not backstory.

> 学生宿舍。两个人都有点醉，风扇转着，窗户开着，走廊的灯从门缝里漏进来。

The `first_mes` should follow from it. If the greeting needs a paragraph of setup the scenario did not
give, the scenario is too thin.

## `first_mes` — the greeting

- **Staging plus speech.** One or two beats of what they're doing, then what they say. A greeting that
  is only dialogue reads as a chatbot; only action reads as a narration.
- **End in motion.** Leave a question open, a gesture unfinished, a silence the player has to fill.
- **`{{user}}`** when the character addresses the player; the app expands it before storage.
- If the source gives a strong opening line, use it. It is the highest-signal text on the card.

## `mes_example` — the calibration

Two or three `<START>`-separated exchanges. Each should do a different job:

1. **The ordinary register** — how they talk when nothing is at stake.
2. **The push** — the player presses them, and they do not simply give in.
3. **The tell** — one small moment that reveals the thing under the surface.

```text
<START>
{{user}}: 你不问我吗？
{{char}}: "问什么？"他笑了一下，把水瓶放在桌上，"你想说的时候自然会说。"
沉默了一会儿，他又补了一句："不过要是有人欺负你，得让我知道。"
```

The refusal in #2 is the most important block. Without it, the model defaults to compliance, and every
character becomes the same helpful assistant wearing different clothes.

## Tags

Twelve tags maximum, in the source's language. Cover: source role, archetype, one behavioural tag, one
tone tag, and any content marker. Tags are what the library sorts and filters on.

## What to leave out

- **Thoughts.** Unless the source is first person and the user asked for interiority, cards work on
  observable behaviour. Inner monologue in `mes_example` teaches the model to narrate feelings instead
  of acting.
- **Plot summary.** The scenario is a moment, not the story so far. The world book carries facts.
- **Instructions to the model** ("be seductive", "stay in character"). That is what the system prompt
  and the preset are for; cards that contain stage direction fight them.
- **Every character's name.** A card should not list the cast; the world book and group chat do that.

## Multi-character packs

Write the cards so they disagree with each other. If two characters could say the same line, one of
them has no card. The most useful thing you can add to `personality` for a side character is what they
do that the protagonist would find _inconvenient_.

## Formality and register (for non-English sources)

Chinese sources carry register explicitly — 您 vs 你, plain speech vs 敬语, given name vs epithet.
Pick one register per character and keep it consistent across `personality`, `first_mes` and
`mes_example`. This is the single most effective voice signal in Chinese cards, and it is invisible in
an English translation.
