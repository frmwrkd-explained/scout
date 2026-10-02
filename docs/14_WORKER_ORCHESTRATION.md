# Task workers and overnight preparation

Scout routes tasks to workers by explicit skills, protects each task with an expiring lease, and keeps one durable receipt per wake. Preparation uses Today’s existing no-tools model route and daily call budget. The existing local CLI door remains available for unrestricted tool workers.

## Enable a worker

An assistant opts in with `worker_enabled: true`, `capabilities: [research, draft]`, and `worker_mode: prepare`. Tasks live in their existing project queue and declare `requires: [draft]`. Every requirement must match; a missing or malformed declaration grants no extra skill. Skills never grant access to a project, collection, universe or tool.

`prepare` is the default. Scout supplies the selected task’s title, instructions and requested output to `brain.think({purpose: 'prep'})`. The model has no tools. Scout stores the returned Markdown in `task.prepared_text` with `prep_state: ready`, `prepared_by`, `prepared_at`, provider and model. The preparation task becomes done; any human work item referenced by `work_id` remains under Today’s ordinary completion and evidence gates. Generated text is capped at 20,000 characters; task instructions at 12,000 and the assistant job at 4,000.

A worker with an explicit membership policy receives only `projectWorkerPrompt`’s projected context. Project membership, task universe and finance restrictions are checked before routing. Its server-issued identity is checked again before applying a response; changed membership or workspace discards the response. Unconfigured legacy workers receive only their selected task and own job, without the owner’s memory, hub bundle or other records.

`tools` explicitly uses `dispatch.sendOut` and its existing isolated agent home. A restricted worker is refused because that CLI can access the host filesystem. A bearer token is an API boundary, not a filesystem sandbox. Tool workers must complete their claimed task through the task API with their current actor and `leaseId`; their final prose alone does not count as completion.

## Manual and scheduled wakes

`POST /api/workers/wake` is an explicit owner action and works when `autoRun` is off. It takes `{key, project, task, assistant?, actor?}`. Repeating a key returns the original receipt without launching another run. Reusing a key for different work returns 409. A new key cannot dispatch an already claimed, done or blocked task. Work with no matching available worker waits without spending a model call.

Scheduled work requires **both** `autoRun: true` and `workerSchedulerEnabled: true`, plus each assistant’s opt-in. `tickWorkers` uses the app’s existing scheduler tick; there is no system cron and no work occurs after the app closes. Opted-in worker assistants are skipped by the legacy assistant scheduler to prevent duplicate dispatch.

Defaults:

| Setting | Default | Allowed range |
| --- | --- | --- |
| `workerSchedulerEnabled` | false | boolean |
| `workerMaxConcurrent` | 2 | 1–8 |
| `workerLeaseMinutes` | 25 | 1–120 |
| `workerMaxAttempts` | 3 | 1–5 |
| `workerRetryMinutes` | 5 | 1–120 |
| `workerQuotaCooldownMinutes` | 60 | 5–1440 |
| `workerOvernightEnabled` | false | boolean |
| `workerOvernightHour` | 6 | 0–23 local time |

Enabling overnight preparation defers scheduled wakes until that local hour. An app opened later catches up. The key includes the local day and task, so a repeated tick cannot run the same preparation twice. Ordinary queue keys include `worker_revision` (default 1); after deliberately reopening a completed task, increment that field or send a new manual wake.

The concurrency limit counts running wake receipts and existing CLI runs, including durable leases left by a backend restart. A worker cannot run two tasks concurrently. Wake states are `pending`, `running`, `done`, `retry`, `cooldown`, `paused` and `failed`.

## Lease and failure behavior

The canonical task claim owns `assigned`, `claimed_at`, `lease_id`, `lease_expires_at`, `lease_heartbeat_at` and `lease_run`. General task patches cannot set those fields. Claim, renewal, release and recovery use the existing cross-process task mutex. A completion transition requires the current actor, lease ID and an unexpired lease. An old worker cannot renew or finish its replacement’s claim.

Workers renew while their promise is live. On a crash, the durable task lease expires and the next worker tick reopens the task, marks the abandoned run failed, and preserves the wake’s attempt count. A late response is discarded. The same recovery runs even when scheduled launching is disabled.

Ordinary failures retry after exponential backoff, capped at two hours and `workerMaxAttempts`. Exhausted work becomes blocked and creates one plain-language question in the existing Needs-you queue. Correct the task instructions, clear `needs_human`, reopen it, and send a new manual wake to authorize another attempt.

Quota, rate-limit, missing-provider and daily-budget failures pause with a durable cooldown. They remain paused after the attempt cap. Preparation keeps the brain’s light purpose and existing tier rules; this module never invents a heavy fallback. Failed and unfinished calls still count through the brain’s existing event ledger.

Every receipt lives at `.scout/worker-wakes/<wake-id>.md`; runs remain in `runs/`, tasks in their existing project folders, and mutations in Activity. Credentials stay in memory. A root change prevents an old async completion from writing into the newly selected workspace; its original lease remains recoverable when that workspace opens again.

## Paperclip ownership

A task can reference canonical human work with `work_id`. Active or ambiguous Paperclip delegation prevents local routing and claiming. Conversely, Paperclip cannot reserve work already claimed locally. The two paths share a per-work assignment mutex and check the durable remote receipt before changing ownership. Remote `done` and `cancelled` states return local ownership; external delivery and human completion remain separate approvals.

## API and integration

| Endpoint | Behavior |
| --- | --- |
| `GET /api/workers` | Configuration, budget, opted-in workers, skill matches and durable wakes |
| `POST /api/workers/wake` | Explicit owner wake; immediate running/waiting receipt |
| `POST /api/workers/tick` | Runs the same bounded, opt-in scheduler tick |
| `POST /api/workers/wakes/:id/heartbeat` | Renews `{actor, leaseId}` only for the owning worker/run |

Register `registerWorkerRoutes(app)` after worker scope middleware. Wire `onSchedulerTick(now => tickWorkers({now}))` into the existing scheduler. `workersSettled()` is a demonstration/test helper; HTTP responses never wait for a model or CLI to finish. Stand-in execution can be injected through `{deps: {think, execute, clock}}` without creating another spawn path.

The behavior suite covers real task claims, stale recovery, duplicate wakes, concurrent queue work, overnight catch-up, retry exhaustion, quota pause, membership revocation, scoped context, root changes and both directions of the Paperclip ownership gate. Live-provider quality and production usefulness are demonstrated separately; passing the lease tests alone does not establish the production gates in `GOAL.md`.
