# Contributing

Thanks for helping build CatCup Tavern. The project is English-first and AGPL-3.0-only. By contributing, you agree that your changes are released under the same license.

## Before you start

- Read [docs/MILESTONES.md](docs/MILESTONES.md) to see the current milestone and its definition of done.
- For a bug, include the smallest reproduction you can.
- For a feature, keep it inside the current milestone unless the scope is explicitly changed.
- Never commit `data/`, `.ref/`, API keys, cookies or private chat content.

## GitFlow

- `main` is the release baseline.
- `dev` is the integration branch.
- Create feature branches from `dev` and target `dev` in pull requests.
- Use merge commits (not squash) when merging PRs so stacked branches keep clean diffs.
- `release/*` and `hotfix/*` branches may be used for release preparation later.

Branch names should be short and scoped:

```text
feature/world-info
feature/prompt-manager
fix/chat-swipe
docs/milestones
```

No long descriptive branch names are required. The PR title carries the detail.

### Stacked PRs

If a change depends on another open PR, branch from the dependency and target `dev`. Note the stack in the PR body. Merge the base PR first with a merge commit; the stacked PR's diff then shrinks to its own changes.

## Releases

Releases are cut from `main` and built by CI automatically:

1. Bump the version across the workspace (`package.json`, the app packages, `tauri.conf.json`, `Cargo.toml`/`Cargo.lock` and `apps/server/src/config.ts`), and turn the `Unreleased` changelog entries into a `## <version> — <date>` section.
2. Merge the release preparation into `dev`, then open a `dev` → `main` pull request and merge it with a merge commit.
3. That push to `main` is the release. `.github/workflows/release.yml` reads the version from `package.json`, creates the `v<version>` tag on the merged commit, builds the Windows installer on `windows-latest`, and creates the GitHub release with the changelog section as the body and the installer as an asset.

Nothing is published when the version in `package.json` already has a tag, so later merges into `main` stay quiet. A version without a matching `CHANGELOG.md` section fails the build on purpose.

To rebuild or republish an existing release, run the Release workflow manually with that tag. Pushing a `v*` tag by hand still works and releases that tag directly.

`main` requires its CI check to pass before a merge, so a broken release cannot start from a red branch.

## Commits

Use Conventional Commit-style subjects and keep each commit atomic:

```text
feat(shared): add world info schema
feat(server): scan world info entries
test(server): cover world info recursion
fix(web): keep swipe selection when regenerating
docs: add milestone document
chore: update dependencies
```

Rules:

- One logical change per commit.
- Include tests with behaviour changes.
- Update docs and `CHANGELOG.md` in the same PR when the change is user-facing.
- Do not mix formatting-only churn with behaviour changes.
- Do not commit generated output, `node_modules/`, `dist/`, `data/` or `.ref/`.

## Quality gates

Run before pushing:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For a package-scoped change, the equivalent workspace commands are also acceptable while the stack is incomplete:

```bash
pnpm --filter @catcup/server typecheck
pnpm --filter @catcup/server test
pnpm --filter @catcup/server build
```

There is no CI workflow yet; local gates are the current contract. If you add CI, run all four gates on every PR into `dev`.

## Code style

- TypeScript strict mode; no `any` without a comment explaining the boundary.
- 4-space indentation, single quotes, trailing commas; Biome is the formatter and linter.
- Keep user-facing strings in English for now; i18n is deferred.
- Keep provider calls and API keys server-side.
- Preserve unknown fields when reading ST files; do not drop data on round-trip.
- Do not import from `.ref/` at runtime or build time. It is reference material only.
- Add a file header when adapting code from SillyTavern or RisuAI:

```ts
// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/<commit>/<path>
```

## Tests

- Add Vitest tests for parsing, ordering, budgeting and other pure logic.
- Add fixture-based tests for ST compatibility changes.
- For UI changes, include a manual smoke-test description in the PR.
- Do not use real API keys in tests. Mock the provider or use a local stub.

## Documentation

Docs live in `docs/`; the index is [docs/README.md](docs/README.md). Update the relevant page in the same PR:

- scope change → `docs/MILESTONES.md`;
- endpoint/SSE change → `docs/API.md`;
- schema or file-format change → `docs/DATA-FORMATS.md`;
- provider change → `docs/PROVIDERS.md`;
- compatibility change → `docs/ST-COMPATIBILITY.md`;
- setup/deployment change → `docs/DEVELOPMENT.md` / `docs/DEPLOYMENT.md`;
- security change → `docs/SECURITY.md`;
- user-facing change → `CHANGELOG.md`.

## Licensing and reuse

- The project is AGPL-3.0-only.
- Do not copy code from SillyTavern (AGPL-3.0) or RisuAI (GPL-3.0) without updating `NOTICE` and [docs/REUSE.md](docs/REUSE.md).
- GPL-3.0 code may be combined into this AGPL-3.0 project under AGPLv3 §13.
- Do not introduce dependencies with licenses incompatible with AGPL-3.0 distribution.
- Keep the original copyright header and note the modifications.

## Security

- Never commit secrets; use `data/secrets.json` at runtime.
- Report vulnerabilities through GitHub's private security advisory, not a public issue.
- Security-sensitive changes should update [docs/SECURITY.md](docs/SECURITY.md).

## Pull requests

- Keep PRs small and focused on one concern.
- Base them on `dev`.
- Use the PR template.
- Describe the failure path, not just the happy path.
- Include the test plan and the docs you updated.
- Do not merge your own PR unless the maintainer asks; for this project the maintainer merges in stack order.

## Definition of done

A change is done when:

- [ ] Behaviour works, including the error path.
- [ ] Tests cover the new logic.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass.
- [ ] Docs and `CHANGELOG.md` are updated.
- [ ] No secrets, data or reference-checkout files are committed.
- [ ] Licensing/attribution is updated if code was reused.
- [ ] The PR targets `dev` and is small enough to review.
