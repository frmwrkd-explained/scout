# 09 — GitHub sink behind the adapter interface

**Status:** resolved
**Blocked by:** 08

```js
// sink.create(report, verdict) -> { url, ref }
// sink.comment(ref, text)
// sink.close(ref, reason)
```

`github` implements it against `DevFrmwrkd/frameforge`. Linear is not built — but if
any code outside the adapter learns that the sink is GitHub, this ticket has failed
and swapping later means a rewrite.

- PAT in Convex env, fine-grained, **Issues read+write on that one repo and nothing
  else**. Never in the client, never in the app.
- Labels: `bug|ux|feature`, `sev:<severity>`, `ai:<disposition>`, `area:<top dir>`,
  `beta`.
- Body: verdict as markdown, evidence in collapsed `<details>`, screenshot inline. An
  issue nobody can read is not better than no issue.
- `not-a-bug` and `needs-more-info` **never** open one — they answer the reporter.
- 401/403/rate-limit → keep `triaged`, record `sinkError`, retry by cron. The verdict
  is already the valuable part.

## Done when

An `auto-fixable` report opens a correctly labelled issue whose body renders; a
`not-a-bug` opens none; a revoked PAT leaves the report `triaged` with the error
recorded and no crash.
