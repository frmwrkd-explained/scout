# Polish audit — what makes Scout look unfinished on a recording

Captured 2026-11-17 at 1920×1080, 1x, against the demo workspace plus the reference library
(1,169 records). Screenshots are in `before/` (`<screen>-dark.png`, `<screen>-light.png`);
`compare/` holds the gallery before and after side by side. `capture.cjs` is the rig that took
them. Numbers come from the live page (`before/measures.json`), not from reading the source.

Ranked by how much each one shows in a screen recording.

| # | What | Evidence | Seen in |
|---|---|---|---|
| 1 | **Text is too small to read on video.** On the collection screens every visible character is under 14px and 74% are under 12px. Labels and chips are 9–10px mono. One screen uses ten different font sizes. | measured | `04-collection-table`, `05-collection-board`, `11-territory`, `03-project` |
| 2 | **Opening the library shows an empty pane for 3.2 seconds.** No loading state; the centre is blank until all 1,169 tiles and six view counts arrive. | measured, click to first tile | `06-gallery` (blank if captured before 3s) |
| 3 | **Gallery cards cut off both the name and the picture.** Titles end after about 18 characters because the hidden Open button reserves their width. Images are cropped to 4:3, which removes the headline or product from portrait ads. | visible | `06-gallery` |
| 4 | **The properties panel dumps raw values.** The image prints as a 64-character hash path over three lines. The prompt prints as one unbroken paragraph down a 180px column with its line breaks lost. | visible | `07-gallery-selected` |
| 5 | **A reference's own page shows neither its image nor its prompt.** It opens on the concept paragraph and a Read note button. | visible | `08-document-reference` |
| 6 | **No measure.** At 1920 wide, Goals, Territory, Settings and the board leave 40–60% of the screen empty on the right, while Playbook lines run the full 1,650px. | visible | `10-goals`, `11-territory`, `16-settings`, `05-collection-board`, `12-playbook` |
| 7 | **Six different screen headers.** A bold date (Today), eyebrow plus lead sentence (Goals, Territory, Playbook), eyebrow plus title plus path (Project), eyebrow plus title (Settings), a counter strip (Decide), none (collections). | visible | `01-today`, `02-needs-you`, `03-project`, `10-goals`, `16-settings`, `04-collection-table` |
| 8 | **Empty states do not match and leave large empty boxes.** Today is three mostly empty panels. Some empties are mono capitals, some sentence case, some boxed, some bare. | visible | `01-today`, `15-files`, `03-project` |
| 9 | **The sidebar mixes three label styles.** Sentence-case rows, mono capital group labels, and FILES ON DISK / SETTINGS in non-mono capitals. Counts are 10px. Two accent-coloured text links sit among the navigation rows. | visible | every screen |
| 10 | **Accent and radius drift.** Files and Settings give a solid accent fill to Reveal, a secondary action. Screens carry four to six corner radii (1, 4, 5, 6, 7, 8, 10px) against the three `DESIGN.md` allows. | measured radii | `15-files`, `16-settings` |

## What the polished gallery changes (items 3 and 4)

- Whole image in a square frame on a recessed bed. Nothing reflows as images load.
- Two-line titles at 14px. Every tile is the same height, so rows and chips line up.
- Open moved onto the picture's corner, shown on hover.
- Tile size follows the view's density control (Compact 208px, Cosy 264px, Roomy 336px).
- Properties: a thumbnail and a short name for a file; long text keeps its line breaks, shows
  seven lines and expands on request.

Not changed, by instruction: every other screen, the view bar, the sidebar, the chips.
