# 03 — backend/feedback.mjs — server rings and env facts

**Status:** resolved
**Blocked by:** 01

New module following the `register*Routes(app, deps)` pattern used by every other
feature block in `backend/index.mjs`.

- **Log ring (200).** Tee `console.log/warn/error` at server start. stdout still goes
  to the terminal and Electron's `[server]` pipe — this only copies.
- **API ring (60).** A sibling of the existing `res.on('finish')` seam at
  `index.mjs:132`: method, path, status, duration, and the `error` string on 4xx/5xx.
  Must not add a second `res.on('finish')` listener to every request — extend the one
  that is there.
- **`envFacts()`** — spec §4.3. Booleans and versions only. Providers report
  `configured|absent`, never a value. Modules come from `resolveModules()`; binaries
  from the existing tool probes.
- **`recentFailures()`** — last 10 failed jobs/generations from the existing surfaces.

## Done when

`GET /api/feedback/context` returns rings + env facts, `providers` is booleans, no
value from `SECRET_SETTING_KEYS` appears anywhere in the response, and the API ring
shows a request made one second earlier.
