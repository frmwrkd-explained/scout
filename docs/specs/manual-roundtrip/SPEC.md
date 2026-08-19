# Manual round-trip — render elsewhere, keep the pipeline

Shipped 2026-07-30. `backend/manual.mjs`, `frontend/ManualHandoff.jsx`,
`frontend/ManualInbox.jsx`, `frontend/handoffCompose.js`,
`backend/skills/manual-roundtrip/`, `tests/phase23-manual-roundtrip.test.mjs`.

## The user

Already pays for Google Flow, a Midjourney seat, or has a local rig. Spending again
per image is the one thing they came here to avoid. They still want the breakdown,
the shot list, the composed prompts, the review queue, the selects and the edit
manifest — everything except the provider call.

## The problem, stated precisely

Copying a prompt out is trivial. The hard part is that **the link between a returned
file and its shot dies the moment you leave the app.** Flow hands back
`Flow_20260730_1a2b3c.mp4`, a hundred times. Nobody hand-files a hundred files, and
paying for a vision call per file to recover the link reintroduces exactly the spend
the user left to avoid.

So the design question is not "how do we copy prompts" but **how much identity can we
make survive the round trip, and how cheaply can we recover the rest.**

## The answer — a matching cascade, cheapest first

| Tier | Signal | Cost | Confidence |
|---|---|---|---|
| 1 | shot code / id / title-slug in the filename | free | 0.80–0.98 |
| 2 | position in the recorded handoff order | free | 0.70 exact count · 0.40 drifted |
| 3 | the agent CLI reads the image and matches it to a shot prompt | subscription tokens | its own claim |

**Tier 2 is the load-bearing idea.** When prompts are handed out, FrameForge persists
the ordered shot ids and the `perShot` stride as `projects/<pid>/handoffs/HO-<ts>.md`.
Downloads carry mtime; people paste prompts in the order they copied them. That single
recorded fact turns a hundred anonymous files into a solved 1:1 mapping with no
renaming and no model call. Without it, every ingest falls to tier 3.

Tier 1 hits are **removed from the stream tier 2 counts** — a file the user renamed
`SH030_hero.png` was never part of the anonymous sequence, and leaving it in both
shifts every later position and makes the total disagree with the handoff, which
downgrades a whole batch of correct matches to "alignment is a guess". This was found
by running the thing, not by reading it.

## Architecture decisions

**An ingested file becomes an ordinary generation record.** `provider:'manual'`,
`model:'manual'`, `cost:0`, `status:'done'`, `reviewState:'new'`, plus a `manual{}`
provenance block. The review inbox, the shot filmstrip, keep/kill, `selects/`, the edit
manifest, `shotsPayload` and the Remotion handoff all key off
`projects/<pid>/generations/*.md`, so manual media reaches every one of them with zero
downstream changes. A parallel "imported media" concept would have forked all of them.

`model` stays the honest `'manual'` — we do not know what produced the pixels. The
model the handoff *intended* is recorded separately as `intendedModel`. Fabricating a
model id here would poison the cost ledger and the "which model works" read of the
whole project.

**The agent proposes; the app applies.** `scan` and `sort` return proposals and write
nothing; only `apply` touches disk, on explicit confirmation, with every match visible
and labelled by tier and confidence. A cheap model silently moving a hero shot onto
the wrong scene is the one failure this feature cannot afford. It also means the whole
thing degrades cleanly with no CLI installed — tiers 1 and 2 are pure string/mtime logic.

**No auto-filing on drop.** Partial downloads (`.crdownload`, `.part`, …) and files
younger than `SETTLE_MS` are classified `partial`/`settling` and never ingested;
ingesting a half-written file yields something that looks like a real render until
someone opens it. `._*` AppleDouble sidecars — unavoidable on this repo's exFAT volume —
are skipped, or every dropped file would appear twice.

**Prompt composition is not re-implemented.** `frontend/handoffCompose.js` delegates to
`shotGenerateBody` (the single shot→generation composer) and takes its `.prompt`
verbatim. The prompt pasted into Flow is byte-identical to what `/api/generate` would
have received. `Story.exportPrompts` was **rewritten** to use the same path rather than
reading raw `shot.prompt` — it had been silently dropping the project's look, handing
out prompts that render differently from the same shot's Generate button.

## Surfaces

- Story → selection bar: **Hand off N**, beside Generate N with the cost between them —
  the free/paid choice belongs at the moment it is made.
- Story → ⋯ → RENDER ELSEWHERE: *Hand off prompts…* · *Open Inbox*.
- `ManualHandoff` dialog: `perShot` stride (remembered in `settings.manualPerShot`),
  the composed prompts in order, shots left out for want of a prompt, and two clipboard
  shapes — numbered `sheet` and prompts-only `plain`.
- `ManualInbox`: triage grid. Low-confidence rows arrive **deselected, not hidden** —
  hiding would make "Import all" quietly incomplete. Every row states its tier, its
  confidence and its reason. Unmatched files can be imported loose (`shot: null`) so
  they reach the review queue rather than rotting in a folder.
- Settings → Claude: the sort model (Haiku / Sonnet / Opus), defaulting to Sonnet 5.
- Settings → Integrations: `manualroundtrip`, default ON. Turning it off blocks new
  handoffs and imports; already-imported media is untouched — it belongs to the project
  now, not to this module.

## Routes

`GET /api/manual/:pid` · `POST …/handoff` · `PATCH …/handoff/:id` · `POST …/scan` ·
`POST …/sort` · `POST …/apply` · `POST …/upload` · `GET|DELETE …/file` · `POST …/reveal`.
All declared in `agentHome.mjs` `CORE_API_ROUTES`, so the in-app agent can drive them.

## Bounds

`AGENT_MAX_FILES = 60` per sort run, chunked at `settings.manualSortBatch` (8), run
**serially** — each turn reads several images and two concurrent vision-heavy CLIs will
brown out a laptop mid-review. Anything over the cap is reported as `skipped`, never
silently dropped.

## Known gaps

- Video/audio ingest records no duration (`imageSize` is stills-only). Harmless today;
  the edit manifest reads duration from the shot.
- The AI tier is untested against a live CLI in CI — `tests/` covers the free tiers, the
  refusals and the ingest; the agent path is exercised only for its no-CLI error.
- `smartRenderBase` produces `SH010_sh010_v1.png` for a shot whose title is still its own
  id. Pre-existing behaviour of the shared namer, shared with provider generations; not
  changed here.
