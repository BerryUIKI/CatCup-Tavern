# Request for comments

Proposals for features that are large enough to need agreement before code. An RFC here is not a commitment to build it; it is the design as currently understood, with the questions that still need an answer.

| RFC                               | Feature                                      | Issue                                                       | Status   |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-profiles.md)          | Switchable profiles (settings bundles)       | [#78](https://github.com/BerryUIKI/CatCup-Tavern/issues/78) | Proposed |
| [0002](0002-book-distillation.md) | Distil world info and characters from a book | [#77](https://github.com/BerryUIKI/CatCup-Tavern/issues/77) | Proposed |

## How an RFC moves

1. **Proposed** — written, open questions listed at the end, review wanted.
2. **Accepted** — the open questions are answered in the document, then the work is cut into PRs and the scope moves into [MILESTONES.md](../MILESTONES.md).
3. **Rejected** — with a sentence saying why, in the document itself; the file stays so the reasoning is not lost.

An accepted RFC is not a spec to copy blindly: the milestones document remains the source of truth for scope and acceptance criteria, and the docs under `docs/` remain the source of truth for what shipped.

## Open questions across both

Both proposals touch `data/settings.json` and the provider configuration from #76. They can be built in either order, but:

- A profile bundles the provider list, so if profiles land first, book distillation's "Distill model" setting lives inside a profile.
- If book distillation lands first, a profile will bundle its model choice along with everything else.

Neither blocks the other; the answer only decides which document to update second.
