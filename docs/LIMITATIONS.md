# What works, and what does not

CatCup Tavern 0.3.0 is early-access software. The goal is narrow: someone who already uses SillyTavern can install it, point it at their data, and keep roleplaying — one character or a whole group, with lorebooks, presets, memory, speech and images — without going back. Everything outside that is either partial or absent, and this page says which.

## What works

**Getting your data in**

- Import character cards one at a time or in a batch: PNG with V2 or V3 metadata, JSON, and CharX packages with their assets.
- Point at a whole SillyTavern user folder and copy its **characters, chats, world info and OpenAI presets** in one action, after a scan shows what was found.
- Export cards back to PNG, JSON or CharX, and presets, world info and regex scripts back to JSON.

**Chatting**

- Streaming replies with reasoning shown separately when the model sends it.
- Macros such as `{{char}}` and `{{user}}` expand in greetings, chat history and what you type, both in the prompt and in the chat view; sent and edited messages are stored expanded, as SillyTavern does.
- Swipes on a regenerated reply, continue, inline editing, deleting messages, copying.
- Branch a conversation from any message, rename or delete a chat, start from any of a card's alternate greetings, and switch a chat's opening to another greeting from the chat header or by swiping the first message.
- Stop a reply mid-stream; the partial text is kept.
- **Group chats**: put several characters in one room, with their own greetings, avatars and names on every message. Natural, list, manual and pooled reply order; mute a member without removing them.
- **Summary memory**: a rolling summary stored in the chat file, updated automatically after replies or on demand, shown in the Memory panel where it can be edited or deleted, injected after or before the main prompt or at a chat depth, and available as `{{summary}}`.
- **Text to speech**: browser voices or an OpenAI-compatible `/audio/speech` endpoint, with per-character and narrator voices, a play button on every reply, and optional autoplay.
- **Image generation**: Automatic1111/Forge or an OpenAI-compatible `/images/generations` endpoint, with a prompt typed or drafted from the chat, a per-character and per-group gallery, and images inserted into the chat.

**Lorebooks**

- SillyTavern's scan pipeline: keys and secondary logic, recursion, inclusion groups with weights, timed effects, budget, and every injection position.
- An entry editor for every field, with a live test, plus import and export.
- The context inspector shows the assembled prompt, every entry considered, and why it fired or not.

**Prompts and presets**

- Import, switch, export and delete OpenAI presets; reorder prompts, enable or disable them, and move one between the ordered list and an in-chat injection with depth, order and role.
- Model-aware token counting: tiktoken for recognised OpenAI models, Claude's vocabulary for Anthropic, a labelled estimate otherwise.

**Tweaking text**

- Regex scripts with SillyTavern's field names, import and export, a live test box, and four live placements: your input, the model's output, reasoning, and lorebook content.

**Quick replies**

- SillyTavern version 2 quick reply sets: import, export, rename, edit and delete them in Settings → Quick Replies, and show the enabled sets as a bar above the message box.

**Characters and personas**

- Edit every text field of a card, export it, or delete it from the library.
- **Import lore** copies a card's embedded lorebook into the world info library and links it to the card, so its entries scan for that character without enabling the book globally.
- Several personas, one default, with a per-chat choice.

**Library**

- Tags and favorites on every card, filter by tags (multi-select, all must match) or favorites only, sort by name, recently changed, newest created or favorites, and apply favorite, tag or delete in bulk.

**Providers**

- Add, duplicate and delete providers, including any OpenAI-compatible endpoint.
- Switch the active provider from the library footer without opening settings; one click, and the model it uses is shown in the list.

## What does not work yet

**Not there at all**

- **STscript and typed slash commands.** A line such as `/send hello` typed into the message box is sent to the model as ordinary text. Only Quick Reply buttons run the supported commands.
- **SillyTavern extensions.** None load.
- **Attachments and images.** No file upload, no vision input, no character sprites or backgrounds.
- **Vector memory.** There is no embedding-based retrieval; long chats are trimmed to the token budget and the rolling summary is the only long-term memory.
- **Impersonation** — there is no "reply as me" action.
- **A change-password screen for the web and LAN builds.** Only the desktop app can set or remove its password, from About → Access password. Elsewhere the reset is deleting `data/auth.json`, which signs every device out.

**Partial, and worth knowing before you rely on it**

- **Group chats reply one member per turn.** SillyTavern can have several members answer the same message and offers append modes that merge every member's card into the prompt; CatCup picks one speaker, uses that member's card, and leaves append modes, automatic turns and the queue UI for later. Manual groups ask you who replies next.
- **Group prompts use fixed defaults.** A SillyTavern preset's `new_group_chat_prompt` and `group_nudge_prompt` are ignored.
- **Groups have no picture of their own.** The library uses the first member's avatar as the group icon.
- **Summary memory uses the active provider only.** There is no Extras or WebLLM summarizer, no quiet-prompt builder and no automatic interval suggestions; the Memory extension's settings live in Settings → Memory.
- **Group chats have no context inspector.** A group summary is visible in its Memory panel but not in the inspector, and the inspector covers single-character chats only.
- **Quick Replies are a subset.** Version 2 sets import, edit and run as buttons, but only `/send`, `/sys` (`/nar`), `/echo`, `/trigger`, `/continue`, `/regenerate` and `/run` execute; auto-execution, context menus, icons and per-character sets are not implemented, and a generation command must be the last step in a button. The account set list shows the same sets in every chat, and a chat's own SillyTavern set links are read but have no editor. Version 1 sets are not migrated; export them from SillyTavern as version 2 first.
- **Text to speech has two backends.** Browser voices, or any OpenAI-compatible `/audio/speech` endpoint. SillyTavern's other TTS providers (ElevenLabs, Azure, AllTalk, XTTS and the rest), its multi-voice quote/action markers, narration modes and per-provider voice maps are not implemented. Autoplay speaks new assistant replies only; user messages have no play control, and long messages are played in chunks.
- **CharX support is a subset.** A `.charx` package imports its card and every `assets/**` file, and exports back as a V3 `card.json` with the PNG image as its icon. A PNG icon becomes the character image; another icon format leaves the card without a picture. Risu `module.risum` bundles, `.charx` embedded-JPEG files (`charxJpeg`) and in-app display of the non-icon assets (expressions, backgrounds, audio) are not implemented; the assets are preserved only so a CharX export can include them.
- **The character library is a focused subset.** Tags are the card's `data.tags`, not SillyTavern's settings-level tag registry: there are no tag colours, folders, hidden tags, manual tag order or import-from-card rules, and matching is case- and whitespace-insensitive but not accent-insensitive. Favorites live in `data.extensions.fav` and travel with CatCup exports, while SillyTavern clears them when it exports or imports a card. Bulk actions cover favorite/unfavorite, add/remove tag and delete; there is no bulk export, clear-all-tags, group favorite or chat deletion. Bulk delete keeps chat files on disk, as single delete does. Sorting offers name, recently changed, newest created and favorites, not SillyTavern's chat-count, token-size or random orders.
- **Image generation has three backends.** Automatic1111/Forge, a ComfyUI API workflow, and OpenAI-compatible `/images/generations`. Stability, NovelAI, DrawThings and SillyTavern's other sources are not implemented. The ComfyUI workflow is pasted into settings: there is no workflow file manager, model/sampler dropdown from `/object_info`, custom placeholders, avatar/img2img placeholders, RunPod serverless or video output. Generation is manual: one image at a time from the chat header or a message, with one active backend and no image-to-image, inpainting, upscaling or automatic per-message illustration. The gallery is a flat newest-first grid with download, insert and delete; there is no upload, folder management or thumbnail index. A prompt can be drafted from the chat by the active text model, but per-character prompt prefixes stored on ST cards are not read yet, and each generation costs one extra chat request when drafting.

- **A card's embedded lorebook is inert until you import it.** SillyTavern treats it the same way: it offers to copy the book into the world info library and leaves it unused if you decline. Use **Import lore** in the character editor; lore that only exists inside the PNG or JSON does nothing before that.
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
- **The desktop app is local-only and keeps its own data folder**, separate from the web build, with no migration between them. It cannot be opened from the LAN. It also opens without an access password, because the desktop is single-user on one machine; set one in About and the sign-in screen returns.
- **Closing the desktop window does not quit it.** The window hides to the notification area and the server keeps running; quit from the tray menu. If the icon has been tucked into the hidden-icons fly-out, the app can look stuck — it is still there, and a second launch brings the window back without starting another server.
- **Downloads and sign-in persistence in the desktop app have not been exercised.**
- **Phone-sized screens** are not a supported target, and the interface is **English only**.
- **The installer is unsigned, and signing it is deliberately deferred.** Windows warns once on first run; the update archive itself is signed with CatCup's own key and checked before it installs, so self-update is unaffected by this. A publisher certificate would put a name on that warning, not make the app run where it otherwise would not — see [MILESTONES.md](MILESTONES.md).
- **LAN traffic is plain HTTP**, including the password. Use a trusted network or a TLS proxy.

## Things that may surprise a SillyTavern user

- **Renaming a character does not rename its file** — the file name is the id chats and avatars already point at.
- **A book icon means the card contains a lorebook, not that it is active.**
- **Importing a preset immediately activates it**, replacing your current prompt setup.
- **Deleting the active preset takes effect at once**, with no confirmation, and generation falls back to the built-in defaults.
- **Deleting a persona** does not break chats that used it; they fall back to the default.
- **Copy to clipboard** only works on localhost or HTTPS; over plain-HTTP LAN the button reports an error.
- **Double-clicking a `.catcup` imports a copy of it**, which reloads the window — an open chat loses its place on the page and a reply that is still streaming is cut off. Nothing on disk is lost: the card is saved before the reload. Only `.catcup` is registered; `.charx`, `.png` and `.json` import from the library but are not file associations.
- **Reloading the page** returns you to the first character alphabetically, not the chat you had open.

## Where the details live

- [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) — the field-by-field matrix and every deliberate difference from SillyTavern.
- [DATA-FORMATS.md](DATA-FORMATS.md) — what each file contains and what is preserved.
- [MILESTONES.md](MILESTONES.md) — what is planned after this release.
