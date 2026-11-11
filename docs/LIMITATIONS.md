# What works, and what does not

CatCup Tavern 0.2.0 is early-access software. The goal for this release is narrow: someone who already uses SillyTavern can install it, point it at their data, and keep telling single-character stories without going back. Everything outside that is either partial or absent, and this page says which.

## What works

**Getting your data in**

- Import character cards one at a time or in a batch: PNG with V2 or V3 metadata, and JSON.
- Point at a whole SillyTavern user folder and copy its **characters, chats, world info and OpenAI presets** in one action, after a scan shows what was found.
- Export cards back to PNG or JSON, and presets, world info and regex scripts back to JSON.

**Chatting**

- Streaming replies with reasoning shown separately when the model sends it.
- Swipes on a regenerated reply, continue, inline editing, deleting messages, copying.
- Branch a conversation from any message, rename or delete a chat, start from any of a card's alternate greetings, and switch a chat's opening to another greeting from the chat header or by swiping the first message.
- Stop a reply mid-stream; the partial text is kept.

**Lorebooks**

- SillyTavern's scan pipeline: keys and secondary logic, recursion, inclusion groups with weights, timed effects, budget, and every injection position.
- An entry editor for every field, with a live test, plus import and export.
- The context inspector shows the assembled prompt, every entry considered, and why it fired or not.

**Prompts and presets**

- Import, switch, export and delete OpenAI presets; reorder prompts, enable or disable them, and move one between the ordered list and an in-chat injection with depth, order and role.
- Model-aware token counting: tiktoken for recognised OpenAI models, Claude's vocabulary for Anthropic, a labelled estimate otherwise.

**Tweaking text**

- Regex scripts with SillyTavern's field names, import and export, a live test box, and four live placements: your input, the model's output, reasoning, and lorebook content.

**Characters and personas**

- Edit every text field of a card, export it, or delete it from the library.
- Several personas, one default, with a per-chat choice.

**Providers**

- Add, duplicate and delete providers, including any OpenAI-compatible endpoint.
- Switch the active provider from the library footer without opening settings; one click, and the model it uses is shown in the list.

## What does not work yet

**Not there at all**

- **Group chats.** One character per conversation, and SillyTavern group chats are not imported.
- **Quick Replies and STscript.** A line such as `/send hello` is sent to the model as ordinary text.
- **SillyTavern extensions.** None load.
- **Text to speech** and **image generation**.
- **Attachments and images.** No file upload, no vision input, no character sprites or backgrounds.
- **Summary or vector memory.** Long chats are trimmed to the token budget.
- **CharX (`.charx`)** import or export.
- **Impersonation** — there is no "reply as me" action.
- **A change-password screen.** The reset is deleting `data/auth.json`, which signs every device out.

**Partial, and worth knowing before you rely on it**

- **A card's embedded lorebook is not scanned.** Only world info books enabled globally, or named in the card's `extensions.world` and present in the library, reach the prompt. Lore that exists only inside the PNG or JSON does nothing.
- **Macros in a stored message are not expanded.** `{{char}}` and `{{user}}` work in card fields, lorebooks and prompt entries, but a greeting or a message you type shows the braces literally and sends them that way.
- **Only a small macro set exists**; `{{random}}`, `{{pick}}`, `{{roll}}` and the rest arrive as literal text.
- **Regex scripts are global.** SillyTavern's per-character and per-preset scopes and allowlists are not implemented, and scripts stored inside a card or a preset are preserved but never run.
- **The world info editor cannot edit character filters**, and a world info regex script needs "prompt only" ticked or it never runs — the same rule SillyTavern has.
- **Personas are a name and a description.** No avatars, no per-persona injection settings, no attached lorebook.
- **Sampling is limited to temperature, top P, max tokens and context size.** A preset's penalties, top K, seed, stop strings and model field are stored and ignored.
- **Prompt editing stops at order, on/off and injection.** You cannot create a preset or edit a prompt's text in the app; export, edit and re-import.
- **Per-character prompt orders are ignored**, and saving the order editor writes only the global list.
- **There is no Author's Note screen.** The server can apply one, but it is off by default and can only be changed through `settings.json` or the API.
- **Editing a message with swipes changes only the visible variant**, and text added by Continue is lost the same way.
- **Swiping past the last variant does nothing** and does not generate a new one.

**Platform**

- **No in-app backup, restore or migration.** Back up by copying the data folder while the server is stopped.
- **The SillyTavern folder import usually finds no presets.** SillyTavern 1.19 keeps user presets in OpenAI Settings, which the importer does not read; import them one at a time from Settings → Prompts.
- **Repeat imports add copies** with numeric suffixes instead of updating what is already there.
- **Imported books arrive disabled and imported presets arrive active** — the opposite of what you might expect; enable books before they affect a chat.
- **The desktop app is local-only and keeps its own data folder**, separate from the web build, with no migration between them. It cannot be opened from the LAN.
- **Downloads and sign-in persistence in the desktop app have not been exercised.**
- **Phone-sized screens** are not a supported target, and the interface is **English only**.
- **The installer is unsigned**, so Windows warns on first run, and there are no automatic updates.
- **LAN traffic is plain HTTP**, including the password. Use a trusted network or a TLS proxy.

## Things that may surprise a SillyTavern user

- **Renaming a character does not rename its file** — the file name is the id chats and avatars already point at.
- **A book icon means the card contains a lorebook, not that it is active.**
- **Importing a preset immediately activates it**, replacing your current prompt setup.
- **Deleting the active preset takes effect at once**, with no confirmation, and generation falls back to the built-in defaults.
- **Deleting a persona** does not break chats that used it; they fall back to the default.
- **Copy to clipboard** only works on localhost or HTTPS; over plain-HTTP LAN the button reports an error.
- **Reloading the page** returns you to the first character alphabetically, not the chat you had open.

## Where the details live

- [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) — the field-by-field matrix and every deliberate difference from SillyTavern.
- [DATA-FORMATS.md](DATA-FORMATS.md) — what each file contains and what is preserved.
- [MILESTONES.md](MILESTONES.md) — what is planned after this release.
