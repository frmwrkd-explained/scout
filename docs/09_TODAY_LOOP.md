# 09 · THE TODAY LOOP

The day's working surface: plan ↔ chat ↔ clock ↔ review. One rule — **code drives, models only
write.** Everything that orders, counts, clocks or nudges is arithmetic over the event log and the
`work` collection. A model is called only to write: the plan's ordering, prepared material, a chat
reply, a review narrative.

## The loop

1. **Wake** — `ensurePlanned` runs on the first `GET /api/today` of a local day and from the
   scheduler tick once local time ≥ `settings.dayStart` (default 08:30). Idempotent: a `work` event
   with `action:'plan'` marks the day. It carries over yesterday's unfinished items, asks the brain
   for an ordering (+ ≤8 adds, validated: known ids, real buckets, 5–240 min, ≤ `dayMinutes`), falls
   back deterministically when no light agent answers, then posts the plan — led by the overnight
   summary line — into the day's chat and kicks off prep for the first prep-flagged items.
2. **Work** — the human clicks a plan row (or the push does it for them). `Done`/`Park`/`Stuck`
   closes the clock on the item and starts the next planned one; an empty plan pulls from the
   backlog; an empty backlog posts a conductor line. `stuck` requires a reason (400 without) and,
   with a light agent, gets an unblock suggestion or a split into smaller items.
3. **Nudges** — computed on every `getToday`, posted once a day each into the thread
   (`meta.kind:'conductor'`, dedupe key). Over-estimate ≥1.5× and ≥10 min over · a bucket >1.5× its
   planned minutes · paused >15 min · ≥3 parks.
4. **Review** — `dayEnd` (scheduler) or `End day` writes `data/reviews/daily-<day>.md`: numbers from
   the rollup, narrative and ≤3 *proposed* learnings from the light tier, a "tomorrow" line the next
   plan reads. Mondays pull `weekly-<weekStart>.md` for the previous Mon–Sun: per-bucket hours,
   results/hour, and the **automation rule** — ≥3h with zero results, or results/hour in the bottom
   third — creates exactly one `automate-<bucket>-<week>` backlog item.

## Time

`work` events (`start|pause|resume|stop|plan`, `outcome: done|parked|stuck|switched`) in the
append-only log ARE the clock — `segmentsFromEvents` replays them (open segment counts to now,
local-midnight split), `rollup` produces today/week/month by bucket and day. Week = local
Monday–Sunday; the log files are UTC-named, so range reads span one file either side and filter by
timestamp.

The app owns idle detection across navigation: after five minutes without activity or when the
window becomes hidden it pauses the server clock. Activity resumes only a clock paused by that
controller, preserving a manual pause. Failed pause/resume requests retry and workspace switches
discard the old clock state. End day stops every Now item before the review; a delayed scheduler
tick records its effective cutoff as `detail.clock_at`, so time after the configured day end is
not invented. A reviewed day may still contain new evening work without repeated automatic closure.

## The brain (backend/brain.mjs)

`TIERS = { light: ['gemini','devin'], heavy: ['claude','codex'] }` (settings `tiers` overrides).
`PURPOSE_TIER`: plan/prep/chat/review_daily → light; review_weekly/automation → heavy.
`pickProvider` requires installation, sign-in and verified text-only capability; light purposes
never reach heavy unless `allowHeavyFallback`. Each CLI attempt logs a reservation and completion
with one attempt ID; `usageToday()` counts the reservation once. Provider availability and daily
caps are described below. Under `SCOUT_TEST` nothing spawns unless `SCOUT_BRAIN_COMMAND` names a stub.

## Storage

| Thing | Where |
|---|---|
| Work items | `data/work/*.md` (collection `work`; `day` empty = backlog) |
| Prepared material | the item's body, under `## Prepared` (replaced on re-prep) |
| Reviews | `data/reviews/{daily,weekly}-<period>.md` |
| The day's thread | `chat/today-<day>.md` + `.messages.md` |
| The clock | `log/<day>.md` `work` events — replayed, never stored twice |
| Settings | `dayStart`, `dayEnd`, `dayMinutes`, `tiers`, `allowHeavyFallback` in settings.md |

## Goal, execution and follow-ups

`backend/workflow.mjs` owns the additional Work fields: `goal_id`, `key_result`, `destination`,
`done_when`, `depends_on`, `not_before`, `follow_up_days`, and `follow_up_title`. They remain ordinary
collection properties, so they can be edited in the document's properties and viewed in its table.
The Today Add form exposes the common fields, and Now shows the goal, destination and completion
condition. A completion condition requires a recorded evidence note; Scout does not automatically
verify an external campaign, deployment or business result.

Prerequisites must exist and cannot form a cycle. Their items must be done, and `not_before` must
have arrived, before a packet starts or completes. Waiting items stay visible. Completing a packet
with a follow-up delay creates one `followup-<source-id>` work record, carrying its goal and destination,
with a due date measured from completion. Repeating completion never postpones the date or creates
another copy. Work/review IDs identify occurrences; fuzzy title matching must not merge a follow-up
into the item it measures.

Example: approval packet → implementation packet (`depends_on: [approval]`) → a measurement packet
14 days after implementation. This establishes a durable handoff. Sending an email, publishing or
deploying still requires an authorized destination integration.

## Verified model restrictions and call budgets

The initial handoff overstated the CLI restrictions. Gemini plan mode and Devin auto permissions
permit read tools, and Codex read-only permits tools too. Today now uses a separate, verified
`textOnly` provider descriptor; normal assistant sessions keep their own tool contract. Currently
Claude has a verified invocation with built-ins disabled, all tools denied, strict empty MCP,
safe mode, user hooks disabled and a fresh empty working directory. Required flags are checked
without a model call. Administrator-managed policy still applies; these flags are not an OS
sandbox or team-level filesystem isolation.

Gemini, Devin and Codex are unavailable for Today until a complete prompt-only invocation can be
verified while preserving their authentication. Their normal assistant functionality is unaffected.
A signed-in badge alone is not evidence a model can answer. Light work still cannot use a heavy
provider without an explicit tier/fallback setting, and no working real answer has been established
in this implementation session.

`brainDailyLimits` defaults to 40 light and 4 heavy attempts per local day; zero disables a tier.
Attempts reserve a slot synchronously in the event log before a CLI launches. Failures and unfinished
calls consume that slot, so concurrent prep and process restarts cannot reset the budget. Heavy
providers always consume the heavy limit even when explicitly routed a light purpose. Today shows
remaining calls and unavailable provider reasons. This bounds calls, not dollars, tokens or a
subscription's actual remaining quota.

## Verification fixture

Run `node scripts/demo-goal-loop.mjs` with Node 22 or newer to create a fresh temporary copy of
`workspace-demo`. It prints the workspace and configuration paths. Start the server with those
`SCOUT_DATA` / `SCOUT_CONFIG` paths and `SCOUT_TEST=1` for a deterministic offline demonstration.
The fixture demonstrates approval, implementation, a 14-day follow-up and Markdown preservation;
no real campaign is sent. Screenshots are in `docs/evidence/`.

Work status transitions use Today endpoints. The generic records API continues to edit properties
and bodies, but refuses status changes that would bypass clock events, evidence and follow-ups.
Creating ordinary planned work through upsert/batch remains supported. Directly editing a local
Markdown file remains part of Scout's file-based contract.
