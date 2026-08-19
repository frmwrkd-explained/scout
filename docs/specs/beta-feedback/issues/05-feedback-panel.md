# 05 — frontend/Feedback.jsx — capture · annotate · review · send

**Status:** resolved
**Blocked by:** 02, 04

The panel. Import `Btn`, `Card`, `Field`, `Input`, `Empty` from `./ui` — do not
re-render their markup by hand (CLAUDE.md, Shared UI). Three of those primitives have
zero importers app-wide; this surface is a good place to change that.

Four steps in one dock, not a wizard:

1. **Capture** — screenshot taken on open, region re-select, box/arrow/**blur** tools.
2. **Describe** — kind (`bug|confusing|idea`), one-line title, body, felt severity.
   The body field is `SnippetText`; the app already has one prompt-field component and
   this is not a reason for a second.
3. **Review** — spec §2.4. Renders the **actual redacted envelope**, section by
   section, each toggleable, with the redaction hit counts. Send stays disabled until
   this step has been rendered once.
4. **Sent** — the `FF-XXXX` code, copyable, and what happens next in one sentence.

Opened from a persistent affordance in the app chrome and from a new `keymap.js`
action (`feedback`, default `f`, ctx `Global`). Adding to `KEY_ACTIONS` is all that is
needed — `resolveKeys` and the Settings binder pick it up.

## Done when

The panel opens over any page without unmounting it, the review step shows a payload
that matches what ticket 06 sends byte for byte, no section is sent while untoggled,
and `f` opens it while `?` still opens the cheat sheet.
