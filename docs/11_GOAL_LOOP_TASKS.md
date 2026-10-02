# Scout goal loop — implementation task list

The target is continuous work toward a goal: choose the next useful action, prepare it, work with the person in chat, capture evidence, hand off execution, wake delayed follow-ups, and improve the next plan from measured outcomes. An approved draft is a step; its destination and the next action must remain visible.

The existing `feat/today-loop` and `feat/tiptap-editor` worktrees remain intact. Their changes are combined for verification on `codex/goal-loop-integration`. The original T01–T16 build charter still applies; this list covers the newer handoffs. Paperclip research lives in `docs/10_PAPERCLIP_RESEARCH.md`.

## Implementation and verification

| ID | Task | Acceptance evidence | State |
| --- | --- | --- | --- |
| G01 | Combine Today and the Markdown editor | Both features build together; full existing suite passes | Verified |
| G02 | Keep exactly one Now item, including paused switches | Pause A, start B, finish B; C starts and A returns to plan | Verified |
| G03 | Count completion independently of running time | Finish a paused item; completion and result appear once | Verified |
| G04 | Stop at End day and bound review time | Ending seconds after start does not invent hours or keep running | Verified |
| G05 | Preserve historical completion and result events | Midnight segments and later record edits do not rewrite past outcomes | Verified |
| G06 | Validate plan/chat changes before applying them | Invalid split/update cannot create half a plan; carryover respects capacity | Verified |
| G07 | Preserve unsupported Markdown and provide editable Raw mode | Images/reference links/HTML survive an edit; opening writes nothing | Verified |
| G08 | Make goal, destination and done evidence explicit on work | The current item says what goal it serves, where output goes and what proves done | Verified |
| G09 | Hold work until prerequisites and follow-up dates permit it | Dependent implementation waits for approval; a two-week follow-up stays out of Now until due | Verified |
| G10 | Keep model costs and provider failures visible | Daily call caps cover concurrent calls; text-only requests use verified provider restrictions | Verified |
| G11 | Evaluate Paperclip against actual source | Cited adapters, heartbeats, approvals, budgets and access model; concrete reuse decision | Verified |
| G12 | Demonstrate the combined day loop in a copied fixture | Approval → implementation → future measurement, chat, time and reviews visible in the running app | Verified |
| G13 | Connect a real provider | GPT-6 Luna returned a validated real plan and daily review in a fresh copied fixture, plus a chat reply in the running app; completed calls recorded model and budget tier | Verified |

## Remaining integration work

| ID | Task | Evidence and practical limit | State |
| --- | --- | --- | --- |
| G14 | Pull approved bets and key results from OpsGraph | Reviewed mirror/JSON import, stable IDs, goal/KR links and repeat-import preservation. Source remains untouched. Browser-storage growth data needs an exported snapshot. | Implemented; integration tests pass |
| G15 | Execute in the actual destination | Exact human approval → separate execution → durable receipt. Scout artifacts work in the real browser; configurable webhook transport and uncertain-send recovery are tested. External destination accounts still need setup. | Implemented; local destination verified |
| G16 | Enforce worker scope and finance isolation | Server-issued identity, projected reads/prompts, canonical writes, actor forgery/finance/cross-universe refusal. Restricted workers use no-tools preparation. Host filesystem access is outside this boundary. | Implemented; enforcement tests pass |
| G17 | Route work by skills and prepare overnight | Capability matching, cross-process leases, heartbeats, bounded concurrency/retries, cooldown and durable opt-in wake receipts. Result viewer shows actual prepared output. | Implemented; orchestration tests pass |
| G18 | Add approved adaptive widgets | Typed catalog, evidence-backed proposal, human approval, persistent layout and canonical data. No executable model UI. | Implemented; approval/data tests pass |
| G19 | Bridge Paperclip if operationally useful | Real isolated Paperclip 2026.1001.0 passed approved export, duplicate suppression, proposed-only import and cancellation. A separately approved native HTTP worker completed one GPT-6 Luna preparation; its real run comment returned as a proposed draft in Needs you. Local work and the goal remain incomplete until human review and evidence. | Implemented; native worker and control plane verified |
| G20 | Prove the original production gates with a real operator | Real role-play uses GPT-6 Luna. A second person, one-week cache proof, packaging and a real business finding remain separate acceptance work. | Open |

See `15_GOAL_INTEGRATIONS.md` for operation and `16_GOAL_COLLABORATION.md` for the real-provider
role-play. Demo evidence does not establish a deployed campaign, measured revenue or the original
second-person production gates.


## Verification completed on 2026-10-02

Three agents handled the Today audit, editor audit, and Paperclip/provider research; their fixes
were integrated and checked together. Node 22.22.0: **893 tests, 891 passed, 2 skipped, 0 failed**.
The Vite production build passed; its large JavaScript chunk warning remains. `git diff --check`
passed. macOS `._` metadata copied into fixture folders was removed before the final suite.

Focused regressions cover simultaneous starts, root switches during model calls, review coalescing,
paused and midnight completions, scheduler cutoffs, evidence/dependency checks, delayed follow-up
identity, concurrent provider reservations and app-wide idle retries. Generic records writes cannot
bypass Today status transitions; property/body edits still work. Editor round-trip tests cover
unsupported syntax, fenced whitespace, external adoption and older autosave responses.

The browser used a fresh temporary copy of `workspace-demo` on `http://127.0.0.1:5189` with
`SCOUT_TEST=1`. It demonstrated owner evidence unlocking implementation, implementation evidence
creating one October 16 measurement item, that item staying waiting, source preservation through
an edit and Raw toggle, an honest no-provider chat reply, and End day stopping the clock and creating
a review. Screenshots: `docs/evidence/goal-loop-handoff.png`, `goal-loop-followup.png`,
`markdown-source-preserved.png`, and `goal-loop-end-day.png`. The original server on port 5188 and
both source worktrees were left intact. No account authentication, model quota, system install or
external campaign action was exercised.

## GPT-6 Luna follow-up verification on 2026-10-02

The user requested a GPT backup and selected GPT-6 Luna. The existing desktop CLI 0.159.2
answered through the user's subscription; the older Homebrew CLI rejected the GPT-6 name.
A local mock request capture confirmed an empty tool inventory. Today's separate `gpt` descriptor
pins that verified runtime/model and spends the light budget without enabling heavy fallback.

With `SCOUT_TEST=0`, a new copy of the demo produced a real validated plan (`source: gpt`) and
daily review, consuming two light attempts and no heavy attempts. In the running browser demo,
"Hi — what should I do next?" received: "Finish the planned Markdown preservation check. It’s
the only remaining planned item for today." Evidence: `docs/evidence/gpt6-luna-plan.json` and
`docs/evidence/gpt6-luna-chat.png`. This closes G13. The seven later dependencies remain open.

The final suite contains **897 tests: 895 passed, 2 skipped, 0 failed**. The production build
passed with the existing large chunk warning. New regressions cover default light routing,
instruction isolation, model locking, budget accounting and JSONL failure/tool rejection. No
software installation, global configuration change, authentication change or external campaign
action was needed; these verification calls did consume subscription model usage.

## Remaining integrations and collaboration verified on 2026-10-02

Three subagents implemented Paperclip, worker access and worker orchestration; the root integrated
OpsGraph import, delivery, widgets and the user-facing controls. Their review also closed agent
approval forgery, generic control-file edits and receipt-reset paths. Final Node 22 suite:
**962 tests, 960 passed, 2 skipped, 0 failed**. The production build and `git diff --check` pass;
the existing large JavaScript chunk warning remains.

The real GPT-6 Luna role-play is preserved in `16_GOAL_COLLABORATION.md`. It produced a local
approved artifact, two evidence-backed completions, one future waiting item, a persistent approved
goal widget, scoped worker material and a real daily review. The goal stayed at zero replies.
Twelve light calls and no heavy calls were used. Bugs encountered during the conversation and
their fixes are recorded with the full thread, rather than editing them out of the evidence.

Paperclip's separate isolated local instance passed real REST verification, with zero worker
heartbeat runs. The updated copied demo remains on port 5189 and is connected to that synthetic
company; the goal-only collaboration demo remains on port 5190. The original port 5188 workspace
and source feature worktrees are preserved. Temporary Paperclip dependencies and state stay under
`/private/tmp`; no global packages, OS service or account sign-in was changed.

G14–G19 are implemented with the limits in the table above. G20 remains open: role-play and local
REST verification do not replace a second person, real customer outcomes, one-week cache reuse
or production packaging.

## Continuous team and native Paperclip replay verified on 2026-10-02

The 18:36 feedback correctly rejected the earlier email-only acceptance claim. Three subagents
implemented/audited continuing orchestration, projected coordinator context, and the native
Paperclip callback; the root integrated Admin, inline document editing, readable approvals,
responsive Today, and the real human replay.

| ID | Task | Evidence and practical limit | State |
| --- | --- | --- | --- |
| G21 | Make Admin and the requested goal team visible | Five real assistant records, briefs, scope, task state, model and actual outputs; owner setup/pause/resume; same team in Today. | Implemented; browser verified |
| G22 | Read and edit the actual work documents inline | Canonical revision-aware editor, attributed cards, current typed packets, readable Paperclip review, responsive work/chat width. Ana's saved edit reached Research/Pen/Check. | Implemented; live edit and regression checks pass |
| G23 | Continue beyond the email and beyond a human completion | Real Luna research → writing → checking → human correction/Done → two label options → adapted measurement sheet. Recovery failures and fixes remain in evidence. Final Now is the specific label decision. | Implemented; real-provider replay verified with disclosed manual recovery |

Final Node 22.22.0 suite: **1,023 tests, 1,021 passed, 2 skipped, 0 failed**. Build and
`git diff --check` pass, with the existing large bundle warning. Detailed replay and sanitized
machine evidence are in `18_CONTINUITY_SIMULATION.md` and `evidence/continuity-live.json`.

Paperclip also performed one native HTTP worker run with one real GPT-6 Luna preparation,
then imported its attributed comment into an open proposed finding. See
`19_PAPERCLIP_TEXT_WORKER.md` and `evidence/paperclip-worker-live-proof.md`. This supersedes
only the earlier execution-disabled demo's zero-run limitation; it does not approve the result,
complete its source Work, or claim customer replies.

The final copied demo is running on port 5190, and the older 5189 copy was restarted on the
same code without reseeding. The original workspace/5188 server and source feature worktrees
remain preserved. The debugging replay consumed 48 light attempts and no heavy attempts; its
explicit local limit increase and next-day reset are documented. G20 remains open because
synthetic role-play cannot establish a second operator, a week of cache reuse or real outcomes.
