# T04 · The document surface
**Milestone:** M1 · **Reads:** `docs/05_UI_SPEC.md` §2.1 · steal list in `docs/06_REUSE.md`

## Do
1. Port Tesseract's **frontmatter property editor**: typed rows above the body, each editable in place, `+ Add property`. Port the pattern into React; do not copy Svelte.
2. Typed editors for every field type in T02. Selects and statuses render as coloured chips; relations as clickable chips; dates with `display: freshness` render the decay bar.
3. **Properties are COLLAPSED when a document opens.** The collapsed row shows the gate status, the primary number and freshness. Expands on click or `P`. The preference is remembered **per collection**.
4. **Summary block sits above the body**, with `READ THE FULL NOTE`. Body is altitude 2.
5. `Editor | Raw` toggle. Save state. The file path is shown and clickable.
6. Port `ConflictNotification` + `DiffView` — take disk / keep mine / merge.

## Demonstrate
Open a record: one human sentence is the first thing visible. Expand properties, edit a select, a relation and a date. Change the file on disk while it is open and resolve the conflict.
