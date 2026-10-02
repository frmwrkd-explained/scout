# Paperclip text worker

Scout can execute an explicitly approved work item through Paperclip's official HTTP adapter. Paperclip sends a native issue/run identity to Scout; Scout validates the exact accepted export, asks the configured light model for one Markdown draft, and posts the result as a Paperclip comment. Pulling that comment uses the ordinary proposed-finding pipeline. Local Work remains planned until the person accepts evidence and completes it.

## Configuration

Register `registerPaperclipWorkerRoutes(app)` from `backend/paperclipWorker.mjs` after JSON parsing and Scout's worker identity guard. The callback is `POST /api/paperclip/worker`. Set a separate random server-side `PAPERCLIP_WORKER_TOKEN` of at least 32 characters. Paperclip's HTTP adapter sends it in `X-Scout-Paperclip-Token`; an Authorization bearer is deliberately not a substitute because that header identifies ordinary scoped Scout workers. `X-Scout-Paperclip-Key` remains a legacy alias; a supplied Token header takes precedence, including when it is empty or invalid.

The existing bridge must be enabled with a matching URL, company and HTTP worker ID. `PAPERCLIP_TOKEN` stays server-side and must authorize the configured company. Credentials are excluded from API replies, prompts, Markdown exports and worker result receipts. In Paperclip, create a dedicated worker with `adapterType: "http"` and:

```json
{
  "adapterConfig": {
    "url": "http://127.0.0.1:5190/api/paperclip/worker",
    "method": "POST",
    "headers": { "X-Scout-Paperclip-Token": "<dedicated callback credential>" },
    "timeoutMs": 240000
  },
  "runtimeConfig": {
    "heartbeat": {
      "enabled": false,
      "wakeOnDemand": true,
      "maxConcurrentRuns": 1,
      "maxDailyRuns": 1
    }
  }
}
```

Use the Token spelling for new configurations: this pinned Paperclip version redacts secret-bearing header names such as `X-Scout-Paperclip-Token` in its public agent configuration. The older custom name ending only in `Key` is not matched by its native redactor. A supported environment secret reference has shape `{ "type": "secret_ref", "secretId": "<UUID>", "version": "latest" }`, but this HTTP adapter reads its headers directly and does not expand environment bindings or nested header references; do not place a secret-reference object in its headers.

Paperclip's HTTP adapter protects private network destinations. A loopback demo needs the exact server environment allowlist `PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST=http://127.0.0.1:5190`. Keep the narrow origin; do not disable its network guard. A production callback should use the authenticated HTTPS deployment address and its normal outbound policy.

The callback validates native GET `/api/heartbeat-runs/:runId` against company, worker, issue and active status. It also verifies GET `/api/issues/:issueId` against an active canonical delegation receipt, accepted human approval fingerprint, exact issue title/description, current local Work revision/status, and the approved goal title. The assignment can wake before Scout has received the issue-create response: a durable `creating` intent with its exact marker and approval is sufficient, without trusting arbitrary callback context.

## Context and writes

Only the selected approved project descriptor and issue snapshot enter `brain.think({ purpose: "prep" })`. Provider selection, limits and the no-tools boundary come from Scout's existing light-model configuration. This can use GPT-6 Luna. Callback context instructions, native runtime-tool tokens, owner-wide memory and unrelated collections are discarded. Output is bounded to 32,000 characters and known server credentials are redacted before it leaves Scout.

Scout authenticates remote requests with the board token. The result comment uses the already verified `X-Paperclip-Run-Id` and a persisted UUID `clientRequestId`. Paperclip attributes that comment to its run and suppresses another assignment wake for a self-result. The callback does not change issue status, local Work, accepted findings, goals or publication state.

Durable control receipts are `.scout/paperclip/worker-runs/<hash>.md`. The hash binds the exported issue key and approved snapshot. A shared per-work mutex reserves the single model attempt before any model wait; an in-process queue serializes duplicate callbacks. States are `generating`, `ready`, `posting`, `unknown`, `completed`, `failed` and `obsolete`.

A duplicate completed callback returns the existing receipt. A definite result refusal retains the prepared output for a later explicit retry. An ambiguous comment response is reconciled by its unique result marker, without another model call or speculative second post. A crashed/failed generation remains fail-closed: inspect its receipt and create new reviewed work instead of silently repeating paid generation. Cancellation or changed approval during preparation prevents sending its result. A storage-root/connection/credential change prevents cross-workspace writes.

## Verification and compatibility

`tests/paperclip-worker.test.mjs` exercises the real bridge approval/export and mock HTTP callback contracts, proposed import, duplicate delivery, native run attribution, assignment-create races, model failure, cancellation, scope forgery, credential redaction, stale snapshots and workspace changes. Tests inject model output and consume no real provider budget.

The local execution was developed against the actual installed official `paperclipai@2026.1001.0` package. Relevant contracts are in `@paperclipai/server/dist/adapters/http/execute.js`, `adapters/http/remote-fetch.js`, `routes/issues.js`, `routes/agents.js`, `services/heartbeat.js` and the shared issue/agent validators. The HTTP adapter ignores response content; Scout must persist its result as a native issue comment. Some Paperclip versions include their comment cursor anchor, so both callback reconciliation and the bridge pull handle that occurrence.

Official API references: [issues](https://docs.paperclip.ing/reference/api/issues/), [authentication](https://docs.paperclip.ing/reference/api/authentication/) and [goals/projects](https://docs.paperclip.ing/reference/api/goals-and-projects/). Real synthetic run evidence is recorded separately in `docs/evidence/paperclip-worker-live-proof.md` after execution.

The temporary isolated demo remains at `/private/tmp/scout-paperclip-DOUjmB`; its company, embedded database, package and credential files are outside the repository. Its new worker has timers off, one concurrent run and a one-run daily cap. The old worker that demonstrated export/pull/cancellation is preserved with execution disabled. There are no global package, authentication or OS tool changes.

## Actual local execution

On 2026-10-02, the real Scout UI approved/exported `paperclip-continuity-experiment` and checked its returned Paperclip result. The native HTTP worker executed successfully, generating one actual GPT-6 Luna draft in 8.4 seconds and posting a run-attributed comment. Scout imported it as an open proposed finding (`found`, `proposed: true`). The goal stayed 0/3 and source Work stayed planned. The native issue remained `in_progress` after Paperclip checkout; no status was changed to disguise the pending human review.

See [the live proof](evidence/paperclip-worker-live-proof.md) and [sanitized machine evidence](evidence/paperclip-worker-live.json). The dedicated synthetic HTTP worker is `24441152-0d3a-4fe6-9296-098dae2c5999`; the earlier disabled worker is preserved. No additional real model calls were used for tests.

Imported cards now use their approved task title and remove only the strict initial machine result marker before redaction. Full raw-source hash and native issue/comment/run IDs remain metadata. Goal/project/universe membership comes only from a canonical source Work whose revision still matches the approved receipt; changed or missing source leaves membership unassigned for owner review. Collection upgrades add missing typed fields through the existing field writer and preserve custom fields. This presentation does not grant the team access to an unreviewed external draft; its ordinary review/scope policy continues to apply.

On the same day, the callback agent was changed only from `X-Scout-Paperclip-Key` to `X-Scout-Paperclip-Token`, preserving its credential and all other configuration. The running Scout handler authenticated the new header before rejecting an empty task payload with HTTP 400. Native public agent JSON masked the Token value, and the native run ledger stayed at its one existing run. No model or task action was triggered. See [header-redaction evidence](evidence/paperclip-header-redaction.json).

The initial configuration history still contained its old header name/value, so the dedicated callback credential was then rotated without changing historical records or other settings. The temporary `worker-token` file was atomically replaced at mode 600 and Scout restarted. The fresh Token authenticated an empty task and returned HTTP 400; the historical legacy Key value returned HTTP 401. Neither current native agent JSON nor its configuration-revision JSON contains the new active credential. The native run ledger remained at its one existing succeeded run, with no model calls or task changes. See [rotation evidence](evidence/paperclip-callback-rotation.json). History may retain the inactive old value as an audit record; a header-name change alone is insufficient when migrating a formerly unredacted credential.
