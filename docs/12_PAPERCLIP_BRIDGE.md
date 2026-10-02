# Paperclip worker bridge

Implemented 2026-10-02 in `backend/paperclip.mjs`. Scout keeps the goal, work, human clock,
approvals and learning in Markdown. Paperclip receives an approved task snapshot and runs an
existing worker. Its status never marks a Scout work item done or changes approved memory.

The bridge is off by default. It does not automatically install Paperclip or create workers.
Integration tests use temporary HTTP mocks on loopback. A separately installed local Paperclip
demo also passed the real REST flow with synthetic data and execution disabled; see the
[live proof](evidence/paperclip-live-proof.md). A later dedicated HTTP worker completed a real
GPT-6 Luna draft; see [execution proof](evidence/paperclip-worker-live-proof.md). The native
Paperclip board is now accessible inside Scout; see [UI proof](evidence/paperclip-board-proof.md).

## Connect an existing instance

1. Obtain a Paperclip **board API token** through its normal login/token flow, scoped as narrowly
   as the deployment supports. Put it in the Scout backend environment as `PAPERCLIP_TOKEN`.
   Scout never stores it in Markdown, browser settings, receipts, proposals or API responses.
2. Save the Paperclip origin, company ID and existing worker ID in Scout's Paperclip settings.
   Enable the bridge when all three are set. HTTPS is required for remote origins; loopback HTTP
   is supported for local instances. Credentials, query strings and extra paths in URLs are refused.
3. Link planned work to a Scout goal. Its prerequisites must be complete and any follow-up date
   must have arrived. Active, done, archived or quarantined work cannot be exported.
4. Preview the export. Needs you contains the exact project and issue snapshot, worker and
   destination. Approve that card, then press Send. Assignment can start a paid worker run.
5. Pull results when ready. Review the new finding cards. Record accepted evidence and press
   Done in Today through the usual clock and follow-up lifecycle.

The token uses board authentication so it can assign issues and interrupt active runs. Before
creating anything, Scout checks the board identity's company memberships and the worker's
company and status. Paused, terminated and unapproved workers are refused. API checks do not
grant an external worker access to Scout files or enforce that worker's operating-system sandbox;
configure Paperclip's own worker permissions and execution environment before live use.

## What leaves Scout

Only the selected work record's title, body (up to 24,000 characters), goal ID/title, key result,
destination and completion criterion, plus stable bridge markers. The preview shows the exact
snapshot. Known credentials and credential-shaped strings pass through Scout's shared redactor.
It does not send the entire hot cache, identity, other collections, OpsGraph universes, tools,
environment variables, repository mounts or provider credentials. This explicit snapshot is the
worker's context; expand the work record deliberately when more context is needed.

Changing the work record or connection invalidates the approval. The canonical outbound content
fingerprint and human decision are checked again before each outbound operation, alongside the
work revision. Rejected or obsolete approvals create a fresh review card without changing the
stable issue identity. Tokens and remote error bodies never appear in an error
response. Requests refuse redirects, time out after 15 seconds, and accept at most 1 MiB of JSON.

## Durable mapping and recovery

- `.scout/paperclip.md` stores opt-in connection metadata only.
- `.scout/paperclip/workspace.md` holds a stable workspace UUID.
- `.scout/paperclip/receipts/<hash>.md` holds one project or issue mapping, source revision,
  approved payload hash, remote ID, state and comment cursor.

A Scout goal maps to one Paperclip project. A Scout work ID maps to one Paperclip issue. Mapping
keys include workspace identity, origin and company; switching connections cannot silently sync
an old delegation. Export calls serialize per workspace within one Scout backend. A reservation
holds the work before network calls, so canonical local work claims can refuse a second executor.
The reservation survives backend restart. Source files stay editable in Scout, but re-sending does
not overwrite a previously created Paperclip issue: it returns its existing receipt.

The verified `paperclipai@2026.1001.0` package supports native issue `idempotencyKey` and
`allowDuplicate`. Scout uses both so separate occurrences with the same title remain separate
issues. Projects use the durable receipt and marker. For both objects Scout writes a creation
intent before POST and searches the stable description marker before retrying. A lost
response that created an object recovers its ID without a second POST. If an ambiguous creation
has no visible marker, Scout fails closed: inspect the original instance and wait for the object
to become visible. Duplicate remote markers are refused for human reconciliation. A definite
HTTP rejection permits another explicit attempt; there is no automatic retry loop. Multi-process
exports against the same vault are unsupported; run one Scout backend per workspace.

Cancellation requires a reason. A reservation that has not attempted issue creation can be
cancelled locally. Confirmed issues are checked for company and Scout marker before mutation,
closed through PATCH, and receive a board-authenticated
interrupt comment. Scout releases the delegation only after both calls succeed; a partial failure
retains it for retry. An already finished issue is recorded as finished and is not cancelled.
Already performed external actions cannot be rolled back by cancellation.

## Returned results and the gate

Pull reads only the mapped issue and its comments. Comment pages use a persisted ascending
cursor, with a maximum of ten 100-comment pages per call. Deployed APIs that repeat their cursor
anchor are tolerated without importing it again or stalling pagination. Each nonempty comment enters the
canonical `upsertRecord` pipeline as an agent-authored record in the gated `paperclip-result`
collection. Stable issue/comment identity prevents duplicates. Findings start `found` and
`proposed: true`, with a finding card and remote evidence link. Rejected outputs cannot patch
their source work, goals or learnings. Status changes to blocked, in review or done create an
actionable question in Needs you once per state transition.

The bridge imports Markdown comments, including links to artifacts. It does not download binary
attachments, execute returned code, follow remote commands, or treat an external approval as a
Scout decision. A human can accept the useful finding and then complete the original work with
evidence. Paperclip and Scout completion remain separate facts.

## HTTP contract

| Route | Input/result |
| --- | --- |
| `GET /api/paperclip` | Redacted configuration and durable receipts |
| `GET /api/paperclip/config` | `enabled`, `url`, `companyId`, `agentId`, `tokenConfigured`, `ready` |
| `GET /api/paperclip/ui` | Validated native app/board URLs and configured company name/prefix; no credentials |
| `PUT /api/paperclip/config` | Patch the four nonsecret settings; human actor only |
| `POST /api/paperclip/preview` | `{ workId, actor }` → `payload`, `proposalId`, `fingerprint`; no network |
| `POST /api/paperclip/push` | `{ workId, proposalId, actor }` → confirmed receipt, or duplicate receipt |
| `POST /api/paperclip/:workId/pull` | New proposed findings, state question ID, updated receipt, `more` |
| `POST /api/paperclip/:workId/cancel` | `{ reason, actor }` → confirmed cancellation receipt |

The existing actor policy is a local safety rail, not network authentication. Scout's loopback and
origin guard still applies. `assertPaperclipWorkAvailable(workId)` is the canonical bridge guard
for Today start and local worker claims; `paperclipDelegation(workId)` returns the durable receipt.

## API references and verification

The earlier architectural audit is [10_PAPERCLIP_RESEARCH.md](10_PAPERCLIP_RESEARCH.md), pinned to
Paperclip source `c46e41e81c03cd3c8b64cf993615b604d7fe8c62`. For this bridge the current official
API references were checked on 2026-10-02:

- [Projects API](https://docs.paperclip.ing/reference/api/goals-and-projects/) supplies company
  list/create routes, including `includeArchived=true`. The bridge maps the Scout goal into a
  project description and creates no shared filesystem workspace.
- [Issues API](https://docs.paperclip.ing/reference/api/issues/) supplies company issue creation,
  individual issue reads/updates, ascending paginated comments and board-only interrupt comments.
  The bridge lets the Paperclip worker perform checkout itself.
- [API authentication](https://docs.paperclip.ing/reference/api/authentication/) distinguishes
  board tokens from agent tokens. [CLI identity reference](https://docs.paperclip.ing/reference/cli/authentication/)
  documents the company membership list returned by `/api/cli-auth/me`.

`tests/paperclip.test.mjs` proves opt-in and token isolation, exact approval invalidation,
concurrent duplicate suppression, unknown-create recovery, refusal of foreign-company data,
proposed-only result imports, repeat-pull deduplication and cancellation/interrupt receipts using
mock HTTP servers. The real local demo additionally proves board authentication, company/worker
validation, create/read/update/comment routes, duplicate suppression, proposed result import
and cancellation against `paperclipai@2026.1001.0`. That first execution-disabled worker's run
ledger stayed empty. A later dedicated HTTP worker executed one real GPT-6 Luna draft and imported
it as a proposed finding, while source Work stayed planned and the goal stayed 0/3. See the
[bounded text-worker setup](19_PAPERCLIP_TEXT_WORKER.md) and [actual execution proof](evidence/paperclip-worker-live-proof.md).
Broader remote adapter containment and provider quota remain deployment-specific checks.

Scout still requires Node 22+. The separately installed Paperclip package declares Node 24.11+;
its demo uses the machine's existing Node 26.10.0 without changing Scout's Node 22 runtime.
Official [installation](https://docs.paperclip.ing/reference/cli/installation/) and
[common CLI options](https://docs.paperclip.ing/reference/cli/common-options/) describe the
separate runtime and isolated `PAPERCLIP_HOME` / `--data-dir` state paths. No global installation,
system package upgrade, background service or external provider authentication was performed.

## Native board in Scout

**Paperclip board** is a primary navigation entry and is also reachable from Admin → Open board.
It embeds the separately running Paperclip application, including its native task board,
agents, projects, audit and run history. Scout's rail is hidden in this screen to give the
board the full width; Back to Scout returns to Today. Open Paperclip opens the same company
in its full application, and Reload board rechecks the connection.

The native List/Board toggle remembers the company's view on the Paperclip origin. Select
Board view on a fresh browser; the verified local demo already has it selected. Scout does
not invent a `?view=board` parameter or write Paperclip's browser storage. The company prefix
is resolved by read-only `GET /api/paperclip/ui`, using Paperclip's actual company API. It
works in local_trusted mode without an API token, even when the outbound worker bridge is off.

Board/worker credentials are never injected into the frame or its URL. Browser authentication
belongs to Paperclip. A deployment that requires login or disallows framing can use Open
Paperclip in its own tab; Scout does not weaken its framing policy or proxy board credentials.
The board shows native Paperclip work and workers. Scout's local team remains in Admin;
only approved delegated work appears in both systems.
