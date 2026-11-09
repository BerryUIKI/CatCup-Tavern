## Summary

<!-- What changed, and why? Keep it short. -->

## Scope

<!-- One concern per PR. Link the milestone or issue if applicable. -->

- Base branch: `dev`
- Milestone:
- Related PRs (for stacked changes):

## Test plan

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Manual smoke test (describe):

## Data and compatibility

- [ ] SillyTavern data formats remain readable / round-trip without losing unknown fields
- [ ] No `data/`, `.ref/`, `node_modules/` or `dist/` files are included

## Documentation

- [ ] Updated the relevant `docs/` page
- [ ] Updated `CHANGELOG.md` for a user-facing change
- [ ] Updated `docs/MILESTONES.md` if scope changed

## Licensing and security

- [ ] No reused code without a `NOTICE` / `docs/REUSE.md` update
- [ ] No API keys, cookies, private chat content or other secrets included
- [ ] Security-sensitive changes reviewed against `docs/SECURITY.md`
