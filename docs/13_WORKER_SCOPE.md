# Worker membership and run identity

Scout keeps the local owner's existing UI contract. A configured restricted worker gets a separate server-issued run identity and explicit membership. Actor names remain provenance: sending `actor: crystal` is not a way for a credentialed worker to become the owner.

`backend/workerScope.mjs` is canonical for this boundary. `registerWorkerScope(app)` runs after JSON parsing and before every existing API handler. Canonical records and memory writers also enforce the active run identity, including direct module calls and the delegated document edit path.

## Membership

The owner writes one control file per assistant at `.scout/worker-policies/<assistantId>.md`. The owner API is:

- `GET /api/worker-policies` — all configured memberships.
- `GET /api/worker-policies/:assistantId` — one membership.
- `PUT /api/worker-policies/:assistantId` — replace membership and revoke its active identities. The body is `{policy, actor}`; omit `actor` for the existing local owner default.

Example policy:

```json
{
  "enabled": true,
  "universes": ["public"],
  "projects": ["campaign"],
  "collections": {"read": ["work", "contact"], "write": ["contact"]},
  "memory": {"read": ["goals/growth.md"], "write": []},
  "finance": false
}
```

Every write membership must also be a read membership. Universe, project and collection IDs are explicit lists with no wildcard. Universes accept bare IDs such as `local` and exact OpsGraph IDs such as `unit/growth`; traversal and additional path segments are refused. Memory membership names exact supported Markdown files; a project folder, arbitrary file path, cache or hub mirror is not a memory grant. A document without a `universe` field belongs to `local`. A `public` membership does not implicitly include it. A document carrying a project also requires membership in that project.

Finance is denied by default. Protection recognizes `sensitivity`, `access`, `classification`, `universe` or tags identifying finance, and finance/payroll/invoice collection or path names. Even an owner-approved `finance: true` grant still needs the correct universe and collection membership. A protected record in an otherwise allowed collection stays excluded. Changing a readable document into a disallowed universe or finance record is refused before a write.

Malformed or disabled membership denies access. Changing the file directly invalidates existing identities because every validation checks the current policy revision. The generic record editor cannot modify membership control files.

## Run credentials

Only trusted server orchestration calls `issueWorkerRun({assistantId, runId, project, ttlMs})`. The return contains an opaque random bearer token, public identity, headers and a `revoke()` callback. Default lifetime is 30 minutes; maximum is 24 hours. Credentials live in process memory, never in Markdown, logs, model output or settings. Restarting Scout revokes them all.

`withWorkerIdentity(token, fn)` establishes the verified identity across asynchronous code. `currentWorkerIdentity()` revalidates expiry, revocation, policy revision and storage root. `revokeWorkerRun({runId})` or `{assistantId}` ends access. A workspace switch rejects an old workspace identity. A worker cannot issue another identity or change its own policy.

Requests send `Authorization: Bearer <token>`. A missing actor is filled from the verified identity. Any conflicting body or query actor gets 403. Requests explicitly claiming a configured worker without a credential get 401. A valid credential can call:

- `GET /api/worker/identity`.
- `GET /api/context` or `/api/worker/context`; add `?format=json` for the envelope.
- Scoped collection listings, raw document projection and canonical record read/write routes.
- `POST /api/workers/wakes/:id/heartbeat`; the wake route additionally verifies run ownership.

Global state, search, Activity, caches, arbitrary files, goals aggregates, hub/bridge endpoints, delivery administration, widgets, settings and policy administration are denied for worker identities. New endpoints start denied and need an explicit scoped contract before entering the allowlist.

## Prompt and document projection

`projectWorkerPrompt({assistantId, project, tokenBudget})` reads only allowed documents and exact memory files. Its hard maximum is 2000 tokens using Scout's four-character token estimate. It never loads the owner's generated cache, global identity, hub bundle or event summaries into the prompt. The optional project must be in membership.

Scoped record reads and near-match sets use raw allowed documents. They bypass the owner's view resolver, whose relation rollups are calculated against the whole store. Projection removes every derived field, file attachment field and relation targeting an excluded collection. Hidden finance totals, labels and matches therefore cannot enter a readable record through a computed field. A hidden file with the same slug is checked before ingest and cannot be overwritten as a supposedly new finding.

`renderCache` and `readCache` return this projection inside an active worker identity. A worker cannot regenerate or replace the owner's cache. Existing proposal and promotion gates still apply to scoped writes; a verified worker remains an agent.

## Runtime boundary

The current local worker CLI has access to the host filesystem and local processes. A bearer token does **not** constrain those tools. `assertWorkerDispatchAllowed(assistant)` rejects sending a restricted worker through that CLI. It permits text-only preparation or a runtime that actually enforces scoped tools. The worker preparation path sends the projected prompt to the verified no-tools model, validates identity again when it returns, and lets Scout apply the prepared material.

This is a local API and prompt boundary, not an OS sandbox or a multi-user authentication system. The local owner API remains available to trusted processes on the same machine for compatibility. A hostile process can omit its bearer token and act as that local owner. Restricted workers must therefore stay in the verified text-only path until a runtime isolates host filesystem and uncredentialed localhost access. Team-level person authentication and an OpsGraph universe ACL require their own authenticated boundary.

## Verification

`tests/worker-scope.test.mjs` sends real HTTP requests to the exported application and verifies forged actors, missing credentials, scope-preserving proposals, finance and universe exclusions, relation/rollup filtering, denied aggregates and raw files, expiry, revocation, policy edits and workspace changes. It also exercises direct canonical writers, a hidden slug collision, scoped cache reads, prompt limits and the restricted CLI refusal. Legacy owner promotion still works.
