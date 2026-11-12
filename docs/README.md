# Documentation

This directory is the project handbook. Start with the path that matches your role.

## Current status

- **M0 complete** (2026-11-09): runnable web + server foundation, ST card/chat basics, four provider families, dark tavern UI.
- **M1 complete**: world info, Prompt Manager, ST preset import, message editing/branching, tokenization.
- **0.2.0 released** (2026-11-11): regex scripts, card editing/export, multiple personas, SillyTavern data import, Windows desktop app.
- **0.2.1 released** (2026-11-11): macros in stored messages, card lorebook import, greeting switching, CI on every pull request.
- **UX overhaul in progress** (2026-11-12): the design system, the settings shell and the Providers panel were rebuilt; the chat chrome, message experience, editors and the accessibility audit follow.
- See [MILESTONES.md](MILESTONES.md) for the authoritative scope and acceptance criteria.

## Start here

| If you want to…                                   | Read                                       |
| ------------------------------------------------- | ------------------------------------------ |
| Understand where the project is going             | [MILESTONES.md](MILESTONES.md)             |
| Understand how the system is put together         | [ARCHITECTURE.md](ARCHITECTURE.md)         |
| Build or change the interface                     | [DESIGN.md](DESIGN.md)                     |
| Set up a development environment                  | [DEVELOPMENT.md](DEVELOPMENT.md)           |
| Call the HTTP API or consume the SSE stream       | [API.md](API.md)                           |
| Read or write ST-compatible files                 | [DATA-FORMATS.md](DATA-FORMATS.md)         |
| Configure a model provider                        | [PROVIDERS.md](PROVIDERS.md)               |
| Know what works and what does not, as a user      | [LIMITATIONS.md](LIMITATIONS.md)           |
| Know what SillyTavern features work today         | [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) |
| Deploy locally or on a LAN                        | [DEPLOYMENT.md](DEPLOYMENT.md)             |
| Work on the desktop build                         | [DESKTOP.md](DESKTOP.md)                   |
| Understand the security model                     | [SECURITY.md](SECURITY.md)                 |
| Fix a problem                                     | [TROUBLESHOOTING.md](TROUBLESHOOTING.md)   |
| Learn the vocabulary                              | [GLOSSARY.md](GLOSSARY.md)                 |
| Know what code was reused and under which license | [REUSE.md](REUSE.md)                       |
| See what changed                                  | [../CHANGELOG.md](../CHANGELOG.md)         |
| Contribute a change                               | [../CONTRIBUTING.md](../CONTRIBUTING.md)   |

## Documentation map

| Document                                   | Purpose                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| [MILESTONES.md](MILESTONES.md)             | Scope, sequencing, acceptance criteria and current status                         |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | Runtime topology, stack decisions, data flow and compatibility tiers              |
| [DESIGN.md](DESIGN.md)                     | Interface principles, layout, tokens, components, interaction and accessibility   |
| [API.md](API.md)                           | REST endpoints, request/response shapes, SSE protocol and error codes             |
| [DATA-FORMATS.md](DATA-FORMATS.md)         | ST-compatible character cards, chat JSONL, world info, presets and internal files |
| [PROVIDERS.md](PROVIDERS.md)               | Provider kinds, endpoint mapping, streaming normalization and adapter guide       |
| [LIMITATIONS.md](LIMITATIONS.md)           | User-facing: what this release does and does not do                               |
| [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) | Feature-by-feature compatibility matrix and known deviations                      |
| [DEVELOPMENT.md](DEVELOPMENT.md)           | Setup, commands, project layout, testing and extension workflows                  |
| [DEPLOYMENT.md](DEPLOYMENT.md)             | Production build, LAN access, reverse proxy, backup and upgrades                  |
| [DESKTOP.md](DESKTOP.md)                   | Tauri shell, server sidecar, readiness contract and packaging status              |
| [SECURITY.md](SECURITY.md)                 | Threat model, auth, secrets, LAN guidance and hardening backlog                   |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md)   | Common failures and diagnostic steps                                              |
| [GLOSSARY.md](GLOSSARY.md)                 | SillyTavern and CatCup terminology                                                |
| [REUSE.md](REUSE.md)                       | Licensing and code reuse assessment                                               |
| [../CHANGELOG.md](../CHANGELOG.md)         | Release history and unreleased changes                                            |
| [../CONTRIBUTING.md](../CONTRIBUTING.md)   | GitFlow, quality gates and contribution rules                                     |

## Documentation conventions

- **English-first.** All project documentation is written in English. When i18n lands, translated user docs may be added under a locale directory; the English pages remain the source of truth.
- **Docs are part of done.** A user-facing change updates the relevant page and `CHANGELOG.md` in the same PR.
- **No secrets.** Never put API keys, session cookies or real `data/` contents in documentation, examples or tests.
- **Relative links.** Use relative Markdown links so the docs work on GitHub and in a local checkout.
- **Scope changes update MILESTONES.md.** If a feature moves between milestones, change this file first.
- **Accuracy over aspiration.** Mark planned work as planned; do not describe unimplemented features as available.
