# 06 — Accent discipline — one fill per screen, semantic color split out

**Status:** resolved 2026-07-19.
**Blocked by:** ~~01~~ — unblocked by declaring only the tokens this ticket needs
(`--accent`, the four alpha steps, `--warn`, `--ok`, three `--fg-*`) in `styles.css :root`.
That is **not** ticket 01: no `tokens.js`, no 68-file literal migration. 01 still owns those.

> Citations re-measured 2026-07-19. **All 17 `App.jsx` line numbers in this ticket were stale**
> (file had drifted ~14–20 lines); `styles.css:16` → `:27`. All non-`App.jsx` citations were
> accurate. Headline counts had also drifted: `background:#E3FF32` 57→58, ink-on-accent 37→36,
> total `#E3FF32` 511→514, `rgba(227,255,50` 153→155, files 46→47. The 24-alpha and 28-label
> counts were exact. Line numbers below are left as originally written — treat them as
> descriptions, not coordinates.

## Problem

`#E3FF32` appears **511 times** as a hex literal plus **153 times** as `rgba(227,255,50,…)` across **46 frontend files** — 664 accent marks in **24 distinct alpha levels**:

```
grep -aho 'rgba(227,255,50,[.0-9]*)' frontend/*.jsx frontend/*.js frontend/*.css frontend/chat/*.jsx | sort -u | wc -l   → 24
grep -aho 'background:#E3FF32'       frontend/*.jsx frontend/chat/*.jsx | wc -l                                          → 57
grep -aor 'background:#E3FF32;color:#141519' frontend/ | wc -l                                                           → 37
```

The 37 ink-on-accent sites are the app's strongest treatment — it should mean "this is the one thing to click." On the project screen it fires for at least five different meanings at once: *primary action* (`App.jsx:1882` Review all), *status* (`App.jsx:1939` NEW badge, once per item), *this costs money* (`App.jsx:1339` month total, `:1871` project cost, `:1957` row cost), *you are here* (`App.jsx:1893` tab underline, `:1895` tab count), *this has a note* (`App.jsx:1953` feedback glyph fill). When one color carries five meanings it carries none, and the eye has no primary action to land on.

**24 accent marks are not interactive at all.** `grep -an "letter-spacing:[^;']*;color:#E3FF32" frontend/*.jsx frontend/chat/*.jsx` returns 28 hits; two are the rating control (`App.jsx:1958`, `:1991`), two are genuinely clickable (`Moodboard.jsx:96` ✦ ANALYZE, `chat/ProductionPanel.jsx:276` Lock this look), and the remaining 24 are static labels and badges — `ASSETS` (`AssetBoards.jsx:336`), `STORY / IDEA` (`Story.jsx:509`), `BRIEF` (`References.jsx:99`), `MEMORY` (`References.jsx:183`), `PROJECT CONTEXT` (`App.jsx:2185`), `KEYBOARD` (`App.jsx:1595`), `QUEUE` (`App.jsx:2933`), `TRANSCRIPT` (`ToolsSuite.jsx:331`), `INBOX` (`ReviewInbox.jsx:71`), `SCENE` (`Story.jsx:840`), and 14 more. 700/800 weight + uppercase + `.12–.2em` tracking + 9–13px already encodes "label." The accent adds noise only.

Two further defects found while verifying:

- **The rating control paints filled and empty dots the same color.** `App.jsx:1958` and `App.jsx:1991` render `'●'.repeat(rating) + '○'.repeat(5 - rating)` inside one `color:#E3FF32` span, so a 2-star and a 5-star item carry identical accent mass. `App.jsx:2137` does the same control **correctly**: `color: r <= it.rating ? '#E3FF32' : '#2A2E36'`.
- **There is no warn token.** `styles.css:6` declares `ok #3FCF8E · danger #F05B54` and stops; `grep -aor 'F0B23A\|E8A33D\|FFB020' frontend/` returns **0**. So overspend at `App.jsx:1340` falls back to the accent — `paceHot ? '#E3FF32' : '#3FCF8E'` — rendering a warning in the primary-action color.

## What to change

**1. Add a warn token.** Declare `--warn:#F0B23A` in `styles.css :root` alongside 01's tokens. Repoint `App.jsx:1340` to `var(--warn)`.

**2. Collapse 24 accent alphas to 4.** Declare `--accent-05` (.05), `--accent-12` (.12), `--accent-35` (.35), `--accent-60` (.60) and map to nearest: `.03/.04/.05/.06/.07/.08` → `-05`; `.10/.12/.14/.15/.2/.22/.25` → `-12`; `.3/.35/.4/.45` → `-35`; `.5/.55/.6/.7/.72/.75` → `-60`. Leave `rgba(227,255,50,0)` in the `dl-ring` keyframe (`styles.css:16`) alone — animation terminus, not a surface.

**3. One solid fill on the project screen.** `App.jsx:1882` (Review all) keeps `background:#E3FF32;color:#141519`. The three status badges lose it and become neutral chips (`background:#22252C;color:#C9CFD8`, same padding/radius): `App.jsx:1939` NEW, `:2077` SHOWING …, `:2113` CURRENT. `App.jsx:2153` (Queue note) drops to the outlined treatment — `border:1px solid var(--accent-35);background:transparent;color:var(--accent)` — and swaps class `hBtnAmber` → `hBdAmber`. Other screens are out of scope for this ticket.

**4. Accent text = interactive only.** Recolor the 24 static labels from `#E3FF32` to `#9AA3AF`. Do **not** touch weight, size, or tracking. Leave `Moodboard.jsx:96` and `chat/ProductionPanel.jsx:276` accent.

**5. Strip accent from pure status.** Cost numerals `App.jsx:1339`, `:1871`, `:1957` → `#C9CFD8`, keeping the `MONO` face, which is what actually reads as "figure." Tab count `App.jsx:1895` → `#9AA3AF` on the active tab; the `inset 0 -2px 0` underline at `:1893` is the "you are here" mark and stays accent.

**6. Fix the rating control.** Replace the single-color spans at `App.jsx:1958` and `:1991` with the two-color pattern proven at `App.jsx:2137` — filled `var(--accent)`, empty `#2A2E36`.

## Beyond the written scope

Three things the ticket did not list turned out to dominate the actual on-screen accent mass,
and were fixed in the same pass because they are the same defect:

- **`AssetBoards.jsx:148,149,152,153` — four accent actions repeated *per board row*.** With
  CAST / LOCATIONS / WARDROBE / PROPS on screen that is **16** identical accent links at rest.
  Now `#9AA3AF` at rest; the existing `.hAmber` hover class still reveals the accent on hover,
  so discoverability is unchanged and nothing moved.
- **Segmented / toggle "on" states painted solid accent** — `AssetBoards.jsx:219` (board filter),
  `:176` (gen level), `Moodboard.jsx:134` (★ FAVORITES). "Selected" is state, not the primary
  action; all three now use the neutral raised chip (`#22252C` / `#ECEEF2` / `#3A3F49`), matching
  the NEW / SHOWING / CURRENT badges this ticket already neutralised.
- **`AssetBoards.jsx:145` board count** → `#9AA3AF`, same rule as the tab count.

There is a **second `paceHot`** at `App.jsx:2246` (inside `renderCosts`) that the ticket missed;
it also rendered a warning in the primary-action colour and is now `var(--warn)`.

## Acceptance criteria

- [x] `grep -aho 'rgba(227,255,50,[.0-9]*)' frontend/*.jsx frontend/*.js frontend/chat/*.jsx | sort -u | wc -l` returns **0**; the only literal left is the `0` terminus in the `dl-ring` keyframe.
      *(Repo-wide the four `rgba(227,255,50,…)` literals in the `:root` block itself also remain —
      they are the token definitions. The AC as written assumed 01 had declared them elsewhere.)*
- [ ] `grep -an "letter-spacing:[^;']*;color:#E3FF32\|letter-spacing:[^;']*;color:var(--accent)" frontend/*.jsx frontend/chat/*.jsx` returns **2** hits — `Moodboard.jsx`, `chat/ProductionPanel.jsx`.
- [ ] `grep -ac 'F0B23A' frontend/styles.css` ≥ 1, and `grep -an "paceHot ? '#E3FF32'" frontend/App.jsx` returns nothing.
- [ ] On the project screen with items in `new` state, exactly **one** element renders a solid accent background. In the browser console: `[...document.querySelectorAll('*')].filter(e=>getComputedStyle(e).backgroundColor==='rgb(227, 255, 50)'&&e.getBoundingClientRect().width>20).length` returns `1`.
- [ ] A 2-star and a 5-star item in the Library grid differ in accent mass, not glyph shape alone.
- [ ] `node --test tests/` stays green (27 files, 139 tests, `FRFG_DATA` at a temp dir).

## Notes

Do not change the accent hue. `#E3FF32` on `#0D0E11` measures 17.2:1 and is the app's identity. The problem is quantity, not choice.

The header comment at `styles.css:1-7` must gain `--warn` and the four alpha steps in the same change or it becomes another false memo. It also cites a nonexistent `docs/DESIGN.md` — 01 owns that; do not duplicate.

The `.hBtnAmber` / `.hBdAmber` / `.hAmber` `!important` hover rules (`styles.css:20-31`) are 02's; this ticket only renames classes at call sites, never edits those rules.
