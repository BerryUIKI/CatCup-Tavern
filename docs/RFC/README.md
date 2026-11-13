# Request for comments

Proposals for features that are large enough to need agreement before code. An RFC here is not a commitment to build it; it is the design as currently understood, with the questions that still need an answer.

| RFC                               | Feature                                      | Issue                                                       | Status   |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-profiles.md)          | Profiles: scoped data plus a shared layer    | [#78](https://github.com/BerryUIKI/CatCup-Tavern/issues/78) | Accepted |
| [0002](0002-book-distillation.md) | Distil world info and characters from a book | [#77](https://github.com/BerryUIKI/CatCup-Tavern/issues/77) | Proposed |

## How an RFC moves

1. **Proposed** — written, open questions listed at the end, review wanted.
2. **Accepted** — the open questions are answered in the document, then the work is cut into PRs and the scope moves into [MILESTONES.md](../MILESTONES.md).
3. **Rejected** — with a sentence saying why, in the document itself; the file stays so the reasoning is not lost.

An accepted RFC keeps its review questions as decided sections rather than deleting them, so a later change argues against the recorded reasoning instead of rediscovering it.

An accepted RFC is not a spec to copy blindly: the milestones document remains the source of truth for scope and acceptance criteria, and the docs under `docs/` remain the source of truth for what shipped.

## Open questions across both

Both proposals touch `data/settings.json` and the provider configuration from #76. They can be built in either order, but:

- RFC 0001 keeps the provider list global and the active provider per profile, so book distillation's "Distill model" setting lives inside a profile and its cost estimate follows that profile's provider choice.
- If book distillation lands first, the distillation model choice moves into a profile with everything else.

Neither blocks the other; the answer only decides which document to update second.

## Superseded drafts

RFC 0001 was first written as a settings bundle over one shared library. Review pointed out that two unrelated campaigns cannot share a character library: ids are file names, so two casts both containing "Mira" collide, and regex rules, prompt order and book names are all name-based too. The revision scopes content to the profile and keeps only the provider list and keys global, with an opt-in shared layer for items that really are common. The reasoning is kept in §2 of the document.
