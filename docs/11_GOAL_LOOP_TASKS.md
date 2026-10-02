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

## Work requiring a later product or account decision

| ID | Task | Dependency / acceptance |
| --- | --- | --- |
| G14 | Pull approved bets and key results from OpsGraph | OpsGraph goals/backlog/sprints must become real records. Read-only import with stable IDs and explicit provenance; Scout never writes into the hub folder. |
| G15 | Execute in the actual destination | Each integration needs its destination account and explicit action authorization. Approval queues implementation; sends/publication/payment happen only through the approved connector. |
| G16 | Enforce worker scope and finance isolation | Define worker identities and universe membership; filter reads/prompts and enforce writes server-side. A UI filter or prompt instruction is insufficient. |
| G17 | Route work by skills and prepare overnight | Explicit worker capabilities, task leases, bounded concurrency, retry/backoff and durable wake-up receipts. |
| G18 | Add approved adaptive widgets | A small typed widget catalog, persistent layout preferences, proposed changes reviewed by the worker; no model-generated executable UI. |
| G19 | Bridge Paperclip if operationally useful | Opt-in mapping from Scout files to goals/issues; idempotent sync, cancellation and approved callbacks. Preserve Scout's local-first Markdown contract. |
| G20 | Prove the original production gates with a real operator | First real finding within 15 minutes; two runs demonstrate cache reuse; packaging and second-person operation demonstrated. Automated stand-ins do not prove these gates. |

These later dependencies are tracked as unfinished; no demo data or stand-in answer counts as a live provider, production access control, deployed campaign or measured revenue.


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
