# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files
in `docs/specs/`.

As of 2026-07-21 the repo has a private remote (`DevFrmwrkd/frameforge`), so `gh` does
work — but **the tracker is still files, not GitHub Issues.** Do not open `gh issue`
threads: specs and tickets stay in `docs/specs/`, version-tracked alongside the code
they describe. The remote is for backup and sharing, not for issue management.

> Path note: the skill's stock template uses `.scratch/`. This repo deliberately uses
> `docs/specs/` instead, so specs and tickets are version-tracked rather than treated
> as scratch. Wherever a skill says `.scratch/`, read it as `docs/specs/`.

## Conventions

- One feature per directory: `docs/specs/<feature-slug>/`
- The spec is `docs/specs/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at
  `docs/specs/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a
  single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a
  `## Comments` heading

### Ticket header format (pinned 2026-07-19)

Both spec sets in this repo use bold markdown for the header fields, so match it:

```markdown
# NN — Title

**Status:** open | claimed | resolved
**Blocked by:** None — can start immediately.   ← or: 01, 03
**Type:** research | prototype | grilling | task   ← wayfinder tickets only
```

Grep for tickets with `rg -n '^\*\*Status:' docs/specs/`. If you introduce a third
header style, every existing query breaks — don't.

## When a skill says "publish to the issue tracker"

Create a new file under `docs/specs/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the
issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `docs/specs/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `docs/specs/<effort>/issues/NN-<slug>.md`, numbered from `01`, with
  the question in the body. A `Type:` line records the ticket type
  (`research`/`prototype`/`grilling`/`task`); a `Status:` line records
  `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when
  every file it lists is `resolved`.
- **Frontier**: scan `docs/specs/<effort>/issues/` for files that are open, unblocked,
  and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`,
  then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Triage labels

The `triage` skill is **not installed**, so there is no label vocabulary. `Status:` on
each file is the only state. If `triage` is installed later, re-run
`/setup-matt-pocock-skills` to add `docs/agents/triage-labels.md`.
