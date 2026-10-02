# Continuous collaboration simulation

This replaces the acceptance claim made by the earlier email-only demonstration. The user's
18:36 feedback was correct: a saved invitation and an empty backlog did not demonstrate a team
continuing to work toward a goal. The earlier conversation and failures are preserved.

## Scenario and actual boundary

The running copy is on `http://127.0.0.1:5190`. Ana is a simulated human trying to improve a beta
product's onboarding while awaiting a reply check on 4 October. The supplied product brief and
three session notes are invented fixtures, clearly labelled as such. The product is not connected,
no invitation was sent, and the goal remains at zero real replies.

The original workspace, both source feature worktrees, and the server on port 5188 are preserved.
Before extending the old copied demo, the script backed it up. `scripts/demo-continuity.mjs`
establishes the broader goal, supplied evidence, and real assistant records; it does not script
the model's answers or pretend that fixture notes are observed customers.

## Visible team and documents

Admin is a first-class navigation destination. It shows Mira (conductor), Scout (research), Pen
(writing), Check (review), and Signal (analysis), with their actual briefs, task state, model,
scope, and persisted outputs. Today shows the same team and its current assessment.

Prepared documents appear as attributed, expandable cards in chat and the current review. They
can be read and edited in place. Canonical revisions prevent a save from overwriting another
edit. Human edits stay in the saved artifact and become the text used by later specialists.

## Real Luna rounds

The first real round continued after the email by preparing a sample-invoice-first guide and a
feedback capture sheet. Check identified unsupported manual-client and field-mapping directions,
and ambiguous wording about the proposed flow. Mira briefed Pen to revise, then Check to review.
These were actual GPT-6 Luna preparations with dependency prompts and canonical draft files.

The simulation exposed defects that stand-in tests missed: successive reviews could leave Today
pointing to an older draft, and the embedded editor fetched a document projection lacking its
revision token. Both were corrected. New checks also refuse an outstanding coordinator answer
after its membership changes, and prevent historical summaries from reintroducing denied facts.

Ana saved her correction directly in Pen's embedded document: “Try a sample” must precede all
business details, and Tax ID must be optional. The replay exposed another defect: naming a
source document in the brief did not actually supply its body when no task dependency named it.
Explicit, authorized source artifacts now accompany the task, with canonical body hashes and
stale-answer checks. Scout then genuinely compared the three supplied notes, and Pen produced
the corrected sample-first proposal from Ana's saved text and Scout's comparison.

One Check reply accurately described the new Pen document but called it a prior draft and
incorrectly claimed the newest draft was missing. That contradictory model reply is preserved.
Ready upstream outputs and source/reference documents now have distinct prompt labels and
producer identity so Check can identify the exact document under review.

The browser also revealed that fixed side-panel widths reduced the Today document column to
roughly one hundred pixels in this window. The workspace now uses a container-based layout:
the work and chat retain a readable width, statistics move below them when necessary, and a
narrow workspace stacks the panels. Ana then read the actual final guide and Check report
inline and completed the current review with result **0** and a specific next request: two
labels for optional business details and an adaptation of the existing measurement sheet.

That completion triggered another real Luna round. Pen prepared **“Add business details
(optional)”** and **“Continue without business details.”** Signal consumed those actual options
and adapted the existing sheet. Its criterion is first-read understanding that business details
can wait and Tax ID can be skipped; the observation table remains blank until Ana tries it.
Research and the invitation were not repeated in this round, and Paperclip's separate flow
comparison stayed delegated.

Recovery found two further continuity defects. The old runtime could recreate a handled check
at another review path, then attach the new label work to that repeated review. Ana parked the
repeat, then recovered the genuine label packet and used Signal's saved review title and
criterion to make its new purpose clear. This manual recovery is part of the retained evidence,
not an invented model answer. The fix now treats canonical Done/Park and the exact handled task
lineage as authoritative during receipt recovery. Tests also prove that a genuinely new
revision remains eligible. Separately, a scoped metadata index keeps older permitted source
documents selectable beyond the sixteen body previews; denied finance remains absent.

The final Now item is **“Choose a label to try locally”**, with Pen's actual copy and Signal's
actual comparison sheet. The underlying goal remains **0/3 real replies**, the reply check
remains dated 4 October, and the Paperclip draft remains an open proposed finding. The extended
replay did not invoke End day.

Evidence: `evidence/continuity-live.json`, `evidence/continuity-corrected-guide.png`,
`evidence/continuity-next-decision.png`, and `evidence/continuity-next-sheet.png`. The JSON was
checked against both temporary Paperclip credentials before saving and includes the earlier
failed messages, the canonical human edit/completion, and actual subsequent outputs.

## Paperclip actually worked

The human approved the exact synthetic Work snapshot in Needs you, then sent the handoff.
Paperclip's native HTTP worker ran once, called Scout's bounded callback, and produced a real
GPT-6 Luna comparison script. Its run-attributed comment returned to Scout as a proposed draft,
readable inline in Needs you. The imported document is still awaiting the owner's review; the
source Work and external issue were not silently completed. See
`evidence/paperclip-worker-live-proof.md` and `evidence/continuity-paperclip-draft.png`.

## Limits

This is a real-provider simulation of collaboration, not a customer study. The existing daily
light-call accounting and coordinator bounds apply; heavy fallback stays off. This copied demo
reached its 40-light-call limit during debugging; its limit was explicitly raised to 48 for the
final verification, preserving every attempt and cooldown receipt. Its coordinator-attempt
bound was also raised from 12 to 16 for that replay, without granting further light calls.
Defaults and the original workspace were not changed. The replay ultimately used **48/48
light calls and 0 heavy calls**; additional AI work in this copy waits for the next local day's
allowance. The daily-limit cooldown now ends at the local-day boundary, with a regression
proving it cannot incorrectly block the next morning until yesterday's exhaustion time.
A pending human review
is a useful stopping point until the human acts, while a dated external dependency remains
waiting. The broader goal is not marked complete and End day is not invoked to conceal an empty
queue. Original production gates, including a second operator and a week of cache reuse, remain
open.

Final Node 22.22.0 verification: **1,023 tests, 1,021 passed, 2 skipped, 0 failed**. The production
build and `git diff --check` pass. The existing large JavaScript chunk warning remains. The
older copied demo on port 5189 was restarted on the same final source without reseeding it.
