# Goal integrations

Scout keeps goals, work and decisions in the existing Markdown store. Integrations prepare or
deliver a specific piece of work; they do not count an external outcome merely because a draft
exists. Today remains the owner of human work status and its clock.

## OpsGraph into Scout

Settings → OpsGraph goals and commitments accepts an existing read-only mirror folder and an
explicit universe such as `unit/growth`. Preview first, then import the reviewed snapshot.
The importer reads goals/objectives, approved or Now bets, and unfinished sprint commitments.
It links work to a goal and key-result text, records source provenance, and uses stable source
IDs. Repeating the import keeps existing Scout edits. The mirror is never a write destination.

For an OpsGraph growth workspace whose data is in browser storage, export its snapshot and send
the JSON object as `snapshot` to `POST /api/opsgraph/preview` and `/api/opsgraph/import` rather
than assuming a live API exists. Both calls require `unit`; import also requires the returned
`previewHash`. This is a reviewed import, not continuous two-way synchronization.

## Approved output into its destination

Today's handoff panel accepts the output and destination. **Review delivery** creates one exact
outbound card in Needs you. Accepting the card authorizes that text; **Deliver approved output**
executes the separate action and records a durable receipt.

The built-in Scout artifact destination creates a document in `data/delivery/` through the
canonical record writer. A custom webhook can be added in Settings with an ID, label, HTTPS URL
and optional token environment-variable name. Credentials belong in the backend environment,
not in the vault. Webhooks receive JSON with `workId`, `title`, `goal_id`, `destination` and
`content`, plus an `idempotency-key` header. Redirects are refused.

A completed receipt prevents duplicate execution. A lost network acknowledgement is marked
uncertain and cannot be silently retried: an operator must inspect the destination and reconcile
the receipt with evidence. Changing approved output or connector configuration requires another
preview. Saving an artifact does not mark human work done or increase the goal's result count.

## Workers and access

Settings → Worker access uses an existing assistant ID, explicit universe, collection IDs and
project IDs. Save the restricted policy, then enable the assistant for text preparation with
capabilities such as `writing` or `research`. A manual preparation task can run while automatic
scheduling is off. Scheduled routing requires both automatic schedules and worker routing on;
overnight preparation is a separate opt-in.

Workers claim matching tasks using durable leases. Concurrency, retries, backoff and quota
cooldowns are bounded. Preparation produces `prepared_text`, provider/model attribution and a
wake receipt; it does not claim that an external action occurred. Workers and Paperclip share
assignment ownership so they cannot both execute the same delegated work.

Server-issued run credentials enforce allowed universe/project/collection/memory access and
reject forged actors. Restricted workers use no-tools preparation: the local CLI tools mode is
refused because its filesystem cannot enforce the policy. This scope protects dispatched
workers; the legacy local owner's API and a process with raw filesystem access are not a hostile
multi-user security boundary. See [worker scope](13_WORKER_SCOPE.md) and
[worker orchestration](14_WORKER_ORCHESTRATION.md).

## Approved widgets

The conductor can propose a goal-progress, waiting-work or delivery-status widget with observed
evidence. Needs you is the only approval path. The approved layout persists in
`.scout/widgets.md`, and Today derives its rows from canonical goals, work and receipts.
The catalog accepts typed fields and never executes model-generated HTML or JavaScript.

## Paperclip

Settings → Paperclip handoffs stores the server URL, company and agent IDs, plus an opt-in flag.
`PAPERCLIP_TOKEN` belongs in the backend environment. A planned, ready work item gets an exact
Needs-you preview before the operator sends it. Pulling the result creates reviewed proposals;
it does not promote or complete Scout work automatically. Cancellation releases delegation.
See [Paperclip bridge](12_PAPERCLIP_BRIDGE.md) for recovery, authentication and deployment limits.

## Real collaboration fixture

`node scripts/demo-collaboration.mjs` creates an isolated goal-only vault and prints its workspace
and config paths. Start Scout with those `SCOUT_DATA`/`SCOUT_CONFIG` paths and `SCOUT_TEST=0` to
exercise GPT-6 Luna through the verified bundled desktop CLI. Scheduling is off; the fixture
explicitly saves output locally and contacts no real people. Its goal begins at zero observed
replies. The generated work and conversation are evidence of product behavior, not a measured
business outcome or the second-person production gates in `GOAL.md`.
