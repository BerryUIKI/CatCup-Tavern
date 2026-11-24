# Contributing

Thanks for helping build CatCup Tavern. The project is English-first and AGPL-3.0-only. By contributing, you agree that your changes are released under the same license.

## Before you start

- Read [docs/MILESTONES.md](docs/MILESTONES.md) to see the current milestone and its definition of done.
- For a bug, include the smallest reproduction you can.
- For a feature, keep it inside the current milestone unless the scope is explicitly changed.
- Never commit `data/`, `.ref/`, API keys, cookies or private chat content.

## Trunk-based development

`main` is the trunk and the only long-lived branch. There is no integration
branch: a change is ready when its PR is ready, and it goes straight onto `main`.

- **Branch from `main`, target `main`.** Short-lived branches only — hours to a
  couple of days. If a branch would live a week, split the work into PRs that
  each land on their own; a long branch is a merge conflict with a name.
- **Squash merge.** One PR becomes one commit on `main`. The trunk stays linear,
  `git log main` is a readable history of what changed, and reverting a change is
  reverting one commit.
- **Rebase on `main`, do not merge it back in.** A merge commit from `main` into
  a working branch puts the trunk's history into the branch and then squash
  discards it anyway.
- **Delete the branch after it merges**, locally and on the remote. `git branch
  --merged main` and `git branch -r --merged origin/main` should stay short.
- **Keep `main` releasable at all times.** That is the point of the model: a
  release can be cut from any commit on `main`, not only from a stabilised
  branch. CI runs on every push for that reason.

Branch names stay short and scoped:

```text
feat/world-info
feat/prompt-manager
fix/chat-swipe
docs/milestones
ci/release-workflow
```

Prefixes in use: `feat/`, `fix/`, `docs/`, `ci/`, `chore/`. No long descriptive
branch names are required; the PR title carries the detail.

### Branch protection

`main` is protected on GitHub:

| Rule                                   | `main`                            |
| -------------------------------------- | --------------------------------- |
| Pull request required                  | yes                               |
| Required status check                  | `Typecheck, lint, test and build` |
| Branch must be up to date before merge | yes                               |
| Force push / branch deletion           | blocked                           |
| Rules apply to admins                  | yes                               |

Up-to-date-before-merge is required because a release can be cut from any commit
on the trunk, and a green check on a stale branch says nothing about the commit
that would actually land. The cost is that a PR needs a rebase rather than a
merge when another lands first; with short branches that is a small rebase.

### Stacked PRs

Trunk-based development prefers a stack to a long branch. If a change genuinely
depends on an open PR, branch from that PR's branch, note the stack in both
bodies, and merge the base first. The stacked PR then targets `main` too, and its
diff shrinks to its own changes once the base lands. A stack three deep is a
signal the work should have been split differently.

### Releases

`release/<version>` is cut from `main`, used only when a release needs commits
that should not sit on the trunk (a version bump is not one of those), and merges
back. `hotfix/<version>` is cut from `main` for an emergency and merges back.
Both are exceptions with a short life, not a second integration branch.

## Releases

Releases are cut from `main` and built by CI automatically:

1. Bump the version everywhere it is written down — `package.json`, `packages/shared`, `apps/server`, `apps/web`, `apps/desktop`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml` (and the `catcup-desktop` entry in `Cargo.lock`), and `apps/server/src/config.ts` — and turn the `Unreleased` changelog entries into a `## <version> — <date>` section.
2. Open that as a normal PR against `main` and squash-merge it, like any other change. There is no release branch: the trunk is already releasable, and the version bump is one commit on it.
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

For a package-scoped change, the equivalent workspace commands are also acceptable:

```bash
pnpm --filter @catcup/server typecheck
pnpm --filter @catcup/server test
pnpm --filter @catcup/server build
```

CI runs the same four gates on every PR into `main` and on every push to `main` (`.github/workflows/ci.yml`). The job name is the required status check on the protected trunk, so a PR cannot merge while it is red. A second job, `Desktop shell`, compiles the Tauri crate with `cargo check` on Windows, macOS and Linux — that is the only place the shell is compiled before a release, so treat a red result there as blocking even though it is not a required check yet.

## Code style

- TypeScript strict mode; no `any` without a comment explaining the boundary.
- 4-space indentation, single quotes, trailing commas; Biome is the formatter and linter.
- Keep user-facing strings in English for now; i18n is deferred.
- Keep provider calls and API keys server-side.
- Preserve unknown fields when reading ST files; do not drop data on round-trip.
- Do not import from `.ref/` at runtime or build time. It is reference material only.
- Add a file header when adapting code from another client:

```ts
// Adapted from <project> (<license>)
// https://github.com/<project>/blob/<commit>/<path>
```

A file written against a published format needs no such header — say which
specification it implements instead.

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

## Licensing and attribution

- The project is AGPL-3.0-only. That is CatCup's own choice, not something forced on it: the data formats it reads and writes are a shared standard, implemented here from the specification.
- A few modules were adapted from other tavern clients. Credit them: update `NOTICE` and [docs/REUSE.md](docs/REUSE.md) in the same change.
- Prefer writing against the format documentation to adapting an existing client's code. A format is free to implement; someone else's expression is not.
- Do not introduce dependencies with licenses incompatible with AGPL-3.0 distribution.
- Keep the original copyright header and note the modifications in any file you adapt.

## Security

- Never commit secrets; use `data/secrets.json` at runtime.
- Report vulnerabilities through GitHub's private security advisory, not a public issue.
- Security-sensitive changes should update [docs/SECURITY.md](docs/SECURITY.md).

## Pull requests

- Keep PRs small and focused on one concern.
- Base them on `main`.
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
- [ ] The PR targets `main` and is small enough to review.
