# Real Paperclip → Luna → Scout review proof

Verified 2026-10-02 at 17:36 UTC with the official installed `paperclipai@2026.1001.0` HTTP adapter. A person approved the exact synthetic Work snapshot in Scout's Needs you UI and clicked its handoff button. Paperclip assigned the issue to the dedicated HTTP worker, invoked Scout's authenticated bounded callback, and received an actual GPT-6 Luna draft. The person then clicked **Check Paperclip result**, importing its comment into the ordinary review pipeline.

| Check | Observed result |
| --- | --- |
| Native Paperclip execution | One heartbeat, `succeeded`, 17:33:29–17:33:38 UTC |
| Native adapter | `HTTP POST http://127.0.0.1:5190/api/paperclip/worker` |
| Actual model | Provider `gpt`, model `gpt-6-luna`, 8,358 ms |
| Model accounting | One reserved/completed `prep` attempt with the same durable attempt ID |
| Remote result | One 1,415-character comment; native run attribution and UUID client request ID |
| Imported result | `found`, `proposed: true`, provenance `pipeline` |
| Human review | One open finding card |
| Source Work | `planned`, linked to `activation-demo` |
| Goal rollup | Still **0/3** |
| External issue | `in_progress` after native checkout; its lifecycle was left intact |
| Scheduled execution | Worker timers disabled; one concurrent run; daily cap 1 |

The local company is `54d9fff2-3039-45b6-bb83-1951ec5feb58`; the dedicated HTTP worker is `24441152-0d3a-4fe6-9296-098dae2c5999`. The synthetic issue is `6a8a0871-2193-4afd-8aa1-143853da5cda`, native run `ce0be144-7d9e-408f-80f8-73ee8ce05fa3`, result comment `ed7c61e7-1ce5-422d-a7e7-7b70171cc181`, and model attempt `698f8104-1f55-4912-ab66-9a4885b572eb`. These identify synthetic fixtures only.

Canonical imported document: `data/paperclip-result/pc-61a1c6cf092621eb6ae01d7f4fcf108a194d1b3d.md`. Open human finding: `finding-paperclip-result-paperclip-continuity-ex-mur8sw4s`. Callback receipt: `.scout/paperclip/worker-runs/2fe55e6a6572c0bef13ecf6c2448176d4be75dff17065e600349a0dd3b4f8b48.md`.

Machine-readable sanitized evidence is [paperclip-worker-live.json](paperclip-worker-live.json). It contains selected identities, lifecycle flags and timings, with no credentials, runtime tool descriptors or draft body. Both temporary credential files were checked against the evidence before it was copied. The earlier [REST-only proof](paperclip-live-proof.md) remains a historical record of the execution-disabled export/pull/cancel phase; this proof adds actual worker/model execution.

Paperclip's original HTTP adapter, private-origin guard, native comment idempotency and run attribution were used without modifying the installed package. The result did not run filesystem tools, publish, contact customers, approve findings, change a goal or complete Scout Work. The temporary package/server/database remain isolated outside the repository. No global installation, OS tool change or external authentication was needed.

The final import presentation regression additionally verifies that cards use the approved task title, omit the initial machine result marker, preserve native source IDs/hash, and inherit goal/project/universe only from the unchanged approved Work revision. Already imported demo records are migrated by an owner; a repeated pull does not silently overwrite them. Thirty-three bridge/callback integration tests pass with injected models and consume no provider budget.
