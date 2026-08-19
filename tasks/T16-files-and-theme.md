# T16 · File browser, light/dark, first run
**Milestone:** M5 · **Reads:** `docs/01_CANON.md` Law 8, `docs/05_UI_SPEC.md` §4

## Do
1. **FILES** — a plain browser over the workspace: folder tree, markdown preview, and **Reveal in Finder**. Pinned at the bottom of the rail. Every record's path is clickable and lands here. We compress hard, so the way down must exist.
2. **Light/dark** — a second `:root` under `[data-theme="light"]`, using the pairs in `05_UI_SPEC.md` §4. **No component may branch on theme.** `⌥⌘L` toggles; follows the OS by default. A test asserts every pair clears 4.5:1.
3. **First run** — port Hermes's `/intake` interview: one question at a time, always with an example answer, writing after each answer so nothing is lost. It ends by proposing the person's first collection and running one real search, so the first screen is never empty.

## Demonstrate
A new person completes the interview, gets a collection and a real finding, switches to light mode, and opens the raw `.md` of their first record — unaided.
