# 06 — Egress, outbox, and the integration switch

**Status:** resolved
**Blocked by:** 01, 02, 03, 05

`POST /api/feedback` in `backend/feedback.mjs`. **The only outbound call in the repo
to a FrameForge-owned server**, and the only place the envelope is sealed.

Order, and it matters: assemble → merge client rings → attach server rings and env
facts → `redact()` over the **whole** envelope → sign → send. Redaction is last so
nothing can be added downstream of it. **If `redact()` throws, the send is aborted** —
the one path in this feature that fails closed.

Screenshot goes to Convex storage via a generated upload URL; only the `storageId`
rides in the envelope.

- **Outbox.** Convex unreachable → `workspace/feedback/outbox/<code>.md` (gray-matter
  front matter + body, like every other record in this datastore), retried on next
  launch. A report someone typed is never lost to a flaky network.
- **Config.** `FRFG_FEEDBACK_URL` in `backend/env.mjs` alongside the existing names.
  Absent → the panel still captures and writes to the outbox, with the reason shown.
- **Switch.** Add `feedback` to `shared/integrations.mjs` (`group: 'Automate'`,
  `defaultOn: true`, cost: *"free — nothing leaves your machine until you press Send"*)
  and a `MODULE_ROUTES` entry gating `/api/feedback`.

## Done when

A report round-trips to Convex; with the URL unset it lands in the outbox and is sent
on next launch; a report containing a live `FAL_KEY` in three places arrives with none
of them; turning the module off in Settings 403s the route.
