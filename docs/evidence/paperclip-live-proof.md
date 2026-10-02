# Local Paperclip bridge proof

Verified 2026-10-02 at 16:12 UTC against the official npm package `paperclipai@2026.1001.0`.
This is a synthetic REST integration proof. The worker's heartbeat and wake-on-demand execution
were disabled; Paperclip's company heartbeat ledger contained **zero runs** after verification.

| Check | Observed result |
| --- | --- |
| Exact human approval | Canonical outbound fingerprint matched the accepted card before export |
| Company/worker authentication | Board token membership and existing worker identity validated |
| Goal/work mapping | One Scout goal project; stable work issue with Scout marker |
| Repeated push | Returned the existing receipt without creating another issue |
| Same-title occurrences | A fresh occurrence got a different issue ID |
| Returned comment | Imported through `records.mjs` as `found`, `proposed: true` |
| Repeated pull | Zero new results |
| Scout source work | Remained `planned` after remote result import |
| Cancellation | Remote issue confirmed `cancelled`; board interrupt comment accepted |
| Agent execution | Zero heartbeat runs; no model invocation or provider spend |

The temporary instance serves [Paperclip on localhost](http://127.0.0.1:5191), using the existing
Node 26.10.0 runtime. Scout's verification client uses Node 22.22.0. State, package installation,
logs and synthetic vault are confined to `/private/tmp/scout-paperclip-DOUjmB`. The API credential
is held in a mode-600 temporary file and is absent from this repository, receipts and proof output.
No global packages, system tools, OS service, external sign-in or real workspace export were added.

The clearly labeled demo company is `54d9fff2-3039-45b6-bb83-1951ec5feb58`, and its execution-disabled
worker is `0326818d-2315-4a95-97bd-7a429975f956`. The final proof issue is
`c83920f8-5bd4-4b7e-b97b-5e5d93c982a9`, linked to project
`e485d27d-abf8-4a0e-89d6-50e6255a3647`. These IDs identify only synthetic fixtures.
Machine-readable evidence is `/private/tmp/scout-paperclip-DOUjmB/proof.json`.

Real API verification exposed two behaviors and their regression tests now cover both:

- The package's issue validator supports `idempotencyKey` and `allowDuplicate`; its create
  service otherwise deduplicates recent open issues by title. The bridge supplies a stable
  native key plus `allowDuplicate: true`, and validates the returned Scout marker.
- Its ascending comment cursor can echo the anchor because database timestamp precision
  exceeds JavaScript Date precision. The bridge skips the anchor and stops pages without
  cursor progress, while canonical record identity also prevents duplicate result writes.

The inspected official package files are `@paperclipai/shared/dist/validators/issue.js`,
`@paperclipai/server/dist/services/issues.js`, and its `routes/issues.js`, `routes/access.js`
and `routes/agents.js`. Route assumptions were also checked against the official
[Issues API](https://docs.paperclip.ing/reference/api/issues/),
[Projects API](https://docs.paperclip.ing/reference/api/goals-and-projects/) and
[authentication reference](https://docs.paperclip.ing/reference/api/authentication/).

The instance was launched with `PAPERCLIP_HOME` and `--data-dir`, telemetry/update checks disabled,
and no service installation, following the official
[CLI options](https://docs.paperclip.ing/reference/cli/common-options/) and
[setup commands](https://docs.paperclip.ing/reference/cli/setup-commands/). Installation scripts
were disabled; the bundled embedded PostgreSQL package's inspected hydration script only restored
relative library symlinks inside that temporary package tree.

This proof establishes HTTP compatibility and Scout's review boundary. A real Paperclip adapter,
its tool permissions, provider quotas, binary artifacts and external side effects were not exercised.
