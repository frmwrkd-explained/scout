// The document surface — the most-used screen in the app (T04).
//
// Law 2 is the entire design of this file. A record opens at ONE HUMAN SENTENCE:
//
//   altitude 1   the title, author, status, freshness and first paragraph.
//   altitude 2   Read note, or an explicit Open full from an inline document. The summary is
//                replaced by the body rather than repeated above it. Editing is deliberate.
//   altitude 3   Raw bytes and the one Details inspector (also opened with P).
// Details always starts closed. A technical panel is not a second copy of the note.
//
// PROPS — the integrator mounts this; nothing here reaches into App.jsx.
//   path          string, required. The document's path in the store, e.g.
//                 'data/guests/maria-santos.md'. It is also what every write and the file browser
//                 take, so the string the human sees is the string the API takes.
//   collection    the collection schema (one entry of api.collections()), or null. Null is fine:
//                 the rows are then inferred from the frontmatter, which is how a memory object
//                 (territory/, playbook/) opens on this same surface.
//   collections   optional [schema] — every collection, used only to label relation targets.
//   doc           optional seed — the row the caller ALREADY has (a TableView row, or the shape
//                 /api/document returns). It renders immediately at altitude 1 while the
//                 authoritative read (which carries `rev` and the Law 4 flags) is in flight, so
//                 opening a record never flashes empty. The read always wins.
//   actor         who is writing. Defaults 'crystal' (the human). The agent doors send their own;
//                 this surface must never send an agent id (Law 4).
//   onOpen(collection, id)     a relation chip was clicked. `collection` may be null when the
//                              second argument is already a path.
//   onOpenPath(path)           the clickable file path, and the `files/` chips. Law 8. Someone
//                              else builds the file browser; this only calls the prop.
//   onPromote(nextStage)       optional. Present ⇒ the one solid accent button in the header,
//                              which moves the gate field one stage on. Absent ⇒ no button, and
//                              the stage is still visible as a chip.
//   onFieldAdded(field)        optional. Present ⇒ the inline `+ Add property` row is offered and
//                              the composer opens IN the property list. Fires after the field
//                              exists so the caller can reload the schema. A new field is a SCHEMA
//                              change (docs/02_DATA_MODEL.md §6) — the composer calls the route,
//                              this surface never writes a schema itself.
//   onBack()                   optional. Present ⇒ a back control left of the title, for when the
//                              surface is the whole centre pane rather than a slide-over.
//   onDirty(bool)              optional. Fires whenever unsaved edits appear or clear.
//   onSaved(doc)               optional. Fires after every accepted write, with { data, content }.
//   onArchived({ path, reason })  optional. Present ⇒ the record can be ARCHIVED from here. Fires
//                              after the server confirms, so the caller can leave the surface and
//                              reload. Scout never deletes (Law 5) — this is the only removal the
//                              app has, and it cannot happen without one of the five reasons.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Empty, InlineEdit } from './ui';
import { Cell, CopyButton, FieldIcon, LongText, LongTextEditor } from './cells';
import PropertyRows, { propertyLabel } from './PropertyRows';
import { RenderMedia, RenderLightbox, mediaKind } from './RenderMedia';
import { mediaSrc, mediaName, mediaLabel, mediaPath, isImagePath } from './media';
import { Freshness } from './Freshness';
import RichEditor, { MarkdownSourceEditor } from './RichEditor';
import { ConflictNotification } from './Conflict';
import AddField from './AddField';
import Subtables from './Subtables';
import Inspector from './Inspector';
import RecordHeader from './RecordHeader';
import PageLayout from './PageLayout';
import RecordPeek from './RecordPeek';
import RecordActions from './RecordActions';
import AskAI from './AskAI';
import { collectionsApi } from './collectionsApi';
import { updateField } from './schemaApi';
import { pageOf, PAGE_WIDTH_PX, PAGE_MEDIA_PX } from '../shared/recordPage.mjs';
import { Markdown } from './Markdown';
import { REJECT_REASONS } from './DecideCards';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// ── which three fields ride the collapsed row ─────────────────────────────────────────────────
// "the gate status, the primary number, and freshness" (§2.1). Picked from the schema, never
// named in a config, so a collection an agent invented gets a sensible collapsed row for free.
export function collapsedFields(collection, values) {
  const fields = collection?.fields || [];
  const gate = fields.find(f => f.type === 'status' && f.gate) || fields.find(f => f.type === 'status') || fields.find(f => f.type === 'select');
  const num = fields.find(f => f.type === 'number' && f.display === 'bar')
    || fields.find(f => f.type === 'number')
    || fields.find(f => f.type === 'rollup');
  const date = fields.find(f => f.type === 'date' && f.display === 'freshness') || fields.find(f => f.type === 'date');
  // No date field declared? Every document still carries `verified_at`/`updated` (the automatic
  // fields), and Law 3 says everything shows its age — so the row never goes without one.
  const fallback = values && (values.verified_at || values.updated || values.created);
  return { gate, num, date, fallbackDate: date ? null : fallback };
}

// Only used when /api/files/read is unavailable (it is an M5 route). Clearly labelled in the UI as
// RECONSTRUCTED so nobody mistakes an approximation for the bytes on disk — Law 8 cuts both ways.
function reconstruct(data, content) {
  const line = (k, v) => {
    if (Array.isArray(v)) return k + ':\n' + v.map(x => '  - ' + String(x)).join('\n');
    if (v && typeof v === 'object') return k + ': ' + JSON.stringify(v);
    return k + ': ' + (v === null || v === undefined ? '' : String(v));
  };
  const yaml = Object.entries(data || {}).map(([k, v]) => line(k, v)).join('\n');
  return '---\n' + yaml + '\n---\n\n' + String(content || '');
}

// The server computes the summary (backend/documents.mjs `firstParagraph`) and its value always
// wins. This is only the fallback for a read that did not carry one.
function firstParagraph(content) {
  const body = String(content || '').trim();
  if (!body) return '';
  const para = body.split(/\n\s*\n/).find(p => p.trim() && !p.trim().startsWith('#'));
  return (para || '').trim().replace(/\s+/g, ' ');
}

// ── what a record IS, above its note ─────────────────────────────────────────────────────────
// A record with a picture and a prompt used to open on a paragraph of analysis: the picture was a
// path in the Details panel and the prompt a three-line textarea beside it. The page now leads with
// both. Each is read off the SCHEMA, never named here, so any collection with a `file` field or a
// long `text` field gets the same page — a reference library, a set of proofs, a batch of clips.

const hasValue = v => !(v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length));

// image | video | audio | file. `isImagePath` and RenderMedia's `mediaKind` are the two existing
// oracles; anything neither recognises is a file, shown as a chip rather than as a broken picture.
function fileKind(value) {
  if (isImagePath(value)) return 'image';
  const kind = mediaKind(mediaName(value) || '');
  return kind === 'image' ? 'file' : kind;
}

// Every file a record carries, the `primary_media` field's first. → [{ key, label, path, kind }]
export function recordMedia(collection, values) {
  const fields = (collection?.fields || []).filter(f => f.type === 'file');
  const ordered = [...fields.filter(f => f.primary_media), ...fields.filter(f => !f.primary_media)];
  const out = [];
  for (const f of ordered) {
    const files = [].concat(values?.[f.key] ?? []).filter(hasValue);
    files.forEach((file, i) => {
      const path = mediaPath(file);
      if (!path) return;
      out.push({ key: f.key + ':' + i, field: f.key, index: i, label: propertyLabel(f) + (files.length > 1 ? ' ' + (i + 1) : ''), path, kind: fileKind(path) });
    });
  }
  return out;
}

// The long text fields, in schema order — except a field literally keyed `prompt`, which leads:
// on a record that has one, it is what the person opened the record for.
export function longTextFields(collection) {
  const fields = (collection?.fields || []).filter(f => f.type === 'text' && f.multiline && !f.primary);
  return [...fields.filter(f => f.key === 'prompt'), ...fields.filter(f => f.key !== 'prompt')];
}

function MediaFrame({ item, title, onView, onOpenPath }) {
  const src = mediaSrc(item.path);
  if (item.kind === 'image') {
    return (
      <button type="button" className="recordMediaBtn" onClick={() => onView({ src, label: item.label })} title="Open full size">
        <RenderMedia src={src} kind="image" fit="contain" className="recordMediaImg" alt={title ? title + ' — ' + item.label : item.label} />
      </button>
    );
  }
  if (item.kind === 'video') {
    return <RenderMedia src={src} kind="video" fit="contain" controls hoverPlay={false} autoPlay={false} loop={false} muted={false} className="recordMediaImg" />;
  }
  if (item.kind === 'audio') return <div className="recordMediaAudio"><RenderMedia src={src} kind="audio" /></div>;
  return null;
}

// A record's pictures and files, in the style its collection chose (Edit layout → Pictures):
//   lead   the first one large, the others small beneath it
//   grid   every picture the same size — a gallery
//   strip  one picture large, the rest a filmstrip you click through
// A file the browser cannot draw (a PDF, a Markdown file) is a named chip under any of them.
// `onAdd` puts a "+ Add" tile at the end; `onRemove(item)` takes a picture OFF THE RECORD — the
// file itself stays in files/ (Law 5: never delete).
function RecordMedia({ items, title, style = 'lead', maxHeight, onView, onOpenPath, onAdd, onRemove, busy }) {
  const shown = items.filter(i => i.kind !== 'file');
  const files = items.filter(i => i.kind === 'file');
  const [at, setAt] = React.useState(0);
  React.useEffect(() => { setAt(0); }, [items.length]);
  if (!items.length && !onAdd) return null;

  const remove = item => (onRemove ? (
    <button type="button" className="recordMediaX" title="Take this off the record. The file stays in the workspace."
      aria-label={'Remove ' + item.label} onClick={e => { e.stopPropagation(); onRemove(item); }}>×</button>
  ) : null);
  const add = onAdd ? (
    <button type="button" className="recordMediaAdd hBd" onClick={onAdd} disabled={busy}
      title="Add a picture, video or file — or drop one anywhere on this page">
      <span aria-hidden="true" className="recordMediaAddPlus">+</span>
      <span>{busy ? 'Adding…' : shown.length ? 'Add' : 'Add a picture'}</span>
    </button>
  ) : null;
  const chips = files.map(item => (
    <span key={item.key} className="recordFileWrap">
      <button type="button" className="recordFile hBd" title={item.path} disabled={!onOpenPath}
        onClick={() => onOpenPath && onOpenPath(item.path)}>
        <FieldIcon type="file" size={15} />
        <span>{mediaLabel(item.path) || item.path}</span>
      </button>
      {remove(item)}
    </span>
  ));
  const cap = maxHeight ? { '--media-max': maxHeight + 'px' } : undefined;

  if (!shown.length) {
    return <div className="recordMedia" style={cap}><div className="recordMediaRow">{chips}{add}</div></div>;
  }

  if (style === 'grid') {
    return (
      <div className="recordMedia recordMedia-grid" style={cap}>
        <div className="recordMediaGrid">
          {shown.map(item => (
            <figure key={item.key} className="recordMediaCell" aria-label={item.label}>
              <MediaFrame item={item} title={title} onView={onView} />
              {remove(item)}
            </figure>
          ))}
        </div>
        {chips.length || add ? <div className="recordMediaRow">{chips}{add}</div> : null}
      </div>
    );
  }

  const current = style === 'strip' ? (shown[Math.min(at, shown.length - 1)] || shown[0]) : shown[0];
  const rest = style === 'strip' ? shown : shown.slice(1);
  return (
    <div className={'recordMedia recordMedia-' + style} style={cap}>
      <figure className="recordMediaLead" aria-label={current.label}>
        <MediaFrame item={current} title={title} onView={onView} />
        {remove(current)}
      </figure>
      {(style === 'strip' ? shown.length > 1 : rest.length) || chips.length || add ? (
        <div className="recordMediaRow">
          {style === 'strip' && shown.length > 1 ? shown.map((item, i) => (
            <button key={item.key} type="button" className={'recordMediaThumb' + (item === current ? ' on' : '')} aria-pressed={item === current}
              title={item.label} onClick={() => setAt(i)}>
              {item.kind === 'image'
                ? <img src={mediaSrc(item.path)} alt="" loading="lazy" />
                : <span className="recordMediaThumbKind">{item.kind}</span>}
            </button>
          )) : null}
          {style !== 'strip' ? rest.map(item => (
            <figure key={item.key} className="recordMediaItem">
              <div className="recordMediaFrame"><MediaFrame item={item} title={title} onView={onView} />{remove(item)}</div>
              <figcaption className="recordMediaCaption">{item.label}</figcaption>
            </figure>
          )) : null}
          {chips}
          {add}
        </div>
      ) : null}
    </div>
  );
}

// One long text field as a block in the reading column. READ: the text with its own line breaks,
// fourteen lines and then a toggle, and a Copy that takes the exact string. EDIT: the same block is
// a textarea as tall as its text, writing through the same `queue` every property row uses.
function TextBlock({ field, value, onChange, open = false }) {
  const body = React.useRef(null);
  const label = propertyLabel(field);
  const text = value == null ? '' : String(value);
  // A four-thousand-character prompt, fully open on every record, pushes everything else off the
  // screen. It starts at a readable height and scrolls inside itself; one click opens it whole.
  // (A collection that wants them open sets `page.text: open` in Edit layout.)
  const long = text.length > 900 || text.split('\n').length > 12;
  const [all, setAll] = React.useState(open);
  React.useEffect(() => { setAll(open); }, [open]);
  return (
    <section className={'recordText' + (long && !all ? ' folded' : '')} aria-label={label}>
      <div className="recordTextHead">
        <span className="recordTextLabel">{label}</span>
        <span className="recordTextTools">
          {long ? (
            <button type="button" className="recordTextFold hFgL" aria-expanded={all} onClick={() => setAll(v => !v)}>
              {all ? 'Fold' : 'Show all · ' + text.length.toLocaleString('en-US') + ' characters'}
            </button>
          ) : null}
          {text ? <CopyButton text={text} target={body} /> : null}
        </span>
      </div>
      <div className="recordTextBody" ref={body}>
        <LongTextEditor value={text} label={label} placeholder={'Write the ' + label.toLowerCase() + '…'}
          onChange={v => onChange(v === '' ? null : v)} />
      </div>
    </section>
  );
}

const SAVE_LOOK = {
  saved: { text: 'SAVED', colour: 'var(--fg-faint)' },
  saving: { text: 'SAVING…', colour: 'var(--fg-muted)' },
  unsaved: { text: 'UNSAVED / ⌘S', colour: 'var(--warn)' },
  conflict: { text: 'CONFLICT', colour: 'var(--marked)' },
  error: { text: 'NOT SAVED', colour: 'var(--danger)' },
};

// A seed may arrive as a table row ({ fields, body }) or as /api/document ({ data, content }).
function seedOf(doc) {
  if (!doc) return null;
  return {
    data: doc.fields || doc.data || {},
    content: doc.body ?? doc.content ?? '',
    rev: doc.rev ?? null,
    summary: doc.summary,
  };
}

export default function Document({
  path, collection, collections, doc, actor = 'crystal', assistants = [], referencedBy = [], onOpenBoard, startExpanded = false,
  onOpen, onOpenPath, onBrowse, onPromote, onFieldAdded, onBack, onDirty, onSaved, onArchived, onSchemaChanged,
}) {
  const seed = seedOf(doc);
  const [loading, setLoading] = React.useState(!seed);
  const [loadError, setLoadError] = React.useState(null);
  const [data, setData] = React.useState(seed ? seed.data : {});
  const [body, setBody] = React.useState(seed ? seed.content : '');
  const [summary, setSummary] = React.useState(seed ? (seed.summary != null ? seed.summary : firstParagraph(seed.content)) : '');
  const [flags, setFlags] = React.useState(null);
  // Which collection THIS document belongs to, as the server computed it (records.mjs
  // `collectionOf`). The surface used to render whatever collection the RAIL had selected, so
  // opening a group while #guest was active drew a group through the guest schema: `Score`,
  // `On camera` and `Found in` appeared as editable rows on a Facebook group, and writing one
  // put a guest's field into a group's frontmatter. A schema is a property of the record, not of
  // the screen you arrived from.
  //
  // `ownCollection` alone cannot carry this: `null` meant BOTH "the read hasn't landed yet" AND
  // "the server confirmed this document is in no collection", and the schema memo below treated
  // the two the same — falling back to the RAIL's active collection either way. That is exactly
  // how me.md gained `status: shortlist, score: 9`: opening it with #guest active, the server
  // correctly reported no collection, and the memo still reached for #guest because it could not
  // tell "not yet known" from "known to be none". `collectionKnown` makes the two states distinct.
  const [ownCollection, setOwnCollection] = React.useState(null);
  const [collectionKnown, setCollectionKnown] = React.useState(false);
  // An explicit label for a document that is in no collection at all — `identity | goal |
  // territory | playbook | learning | assistant | task | project | other` — so the header can say
  // what this IS (`IDENTITY · me.md`) instead of nothing, once `schema` is null. See
  // backend/documents.mjs `kindOf`.
  const [kind, setKind] = React.useState(null);

  // THE schema this surface renders by. Before the read lands, the RAIL's active collection is the
  // best guess — it avoids a flash of unstyled rows for a seed handed in from that same collection.
  // Once the server has actually answered (`collectionKnown`), its word is final, including "none":
  // a memory object belongs to no collection, and PropertyRows already renders frontmatter-inferred
  // rows for a null schema (PropertyRows.jsx) — that is what a memory object opens through.
  const schema = React.useMemo(() => {
    if (!collectionKnown) return collection;
    if (!ownCollection) return null;
    if (collection && collection.id === ownCollection) return collection;
    return (collections || []).find(c => c.id === ownCollection) || collection;
  }, [collectionKnown, ownCollection, collection, collections]);

  // The gate's next stage — memoized above the early-return so the `A` key (below, item 3) and the
  // header button (render, at the bottom) act on the exact same answer. Board's drag was the only
  // way to move a record's stage with a mouse before onPromote reached this surface; this is the
  // one keyboard equivalent, and it is the same key the button already prints.
  const nextStage = React.useMemo(() => {
    if (!onPromote) return null;
    const { gate } = collapsedFields(schema, data);
    // Only a STATUS field is a stage (docs/02 §2 — the gate guards the one `gate: true` status
    // field). collapsedFields falls back to a `select` for the collapsed ROW, which is right for
    // display and wrong for promotion: on #group it offered "instagram" as the next stage, and
    // pressing it would have written `platform: instagram` through the move route.
    // …and only the field the schema MARKS as the gate (`gate: true`). A plain status field is a
    // property, not a pipeline to be advanced: on a CRM deal whose stage was `won`, this offered a
    // solid "lost" button — and the `A` key anywhere on the page would have pressed it.
    if (!gate || gate.type !== 'status' || !gate.gate) return null;
    const opts = (gate.options || []).map(o => (typeof o === 'string' ? o : o.value));
    const i = opts.indexOf(data[gate.key]);
    return opts[i + 1] || null;
  }, [schema, data, onPromote]);

  // 'editor' is the page; 'raw' is its Markdown source. There is NO read mode and no edit mode:
  // the page is always live. A person opens a record to write on it, and a button between them
  // and the first keystroke ("Edit note") was the stiffest thing about this screen.
  const [mode, setMode] = React.useState('editor');
  // The one side panel: null · 'details' (every property, history, links) · 'layout' (Edit layout).
  const [panel, setPanel] = React.useState(null);
  const propsOpen = panel === 'details';
  const [detailSection, setDetailSection] = React.useState('props');
  // Layout choices made in Edit layout, shown at once and confirmed by the server a moment later.
  const [layoutDraft, setLayoutDraft] = React.useState(null);
  const [layoutError, setLayoutError] = React.useState(null);
  // Long text fields with no value yet that the person has asked to write (by key).
  const [openText, setOpenText] = React.useState([]);
  // A value clicked to see the other records that share it — { field, value } (RecordPeek.jsx).
  const [peek, setPeek] = React.useState(null);
  const [save, setSave] = React.useState('saved');
  const [saveError, setSaveError] = React.useState(null);
  const [conflict, setConflict] = React.useState(null);
  const [raw, setRaw] = React.useState(null);
  const [options, setOptions] = React.useState({});
  // Counts saves that changed a property — what the sub-collection lists re-read on (Subtables.jsx).
  const [savedProps, setSavedProps] = React.useState(0);
  // null = not archiving · 'picking' = the reason strip is up · 'busy' = the write is in flight.
  // Law 5 has no path out of a removal without a reason, so there is no state that archives
  // without one — the button opens the picker, and only the picker calls the API.
  const [archiving, setArchiving] = React.useState(null);
  const [archiveError, setArchiveError] = React.useState(null);
  // The add-property composer is a row in the list, not a dialog over the page — see AddField.jsx.
  const [addingProperty, setAddingProperty] = React.useState(false);
  // The picture opened full size — { src, label } — in the app's one viewer (RenderLightbox).
  const [viewer, setViewer] = React.useState(null);

  // Refs shadow the state the save path reads, so a debounced flush firing three keystrokes later
  // writes what is on screen and not what was on screen when the timer was set.
  const dataRef = React.useRef(seed ? seed.data : {});
  const bodyRef = React.useRef(seed ? seed.content : '');
  const revRef = React.useRef(seed ? seed.rev : null);
  const pendingRef = React.useRef({});
  const bodyDirtyRef = React.useRef(false);
  const timerRef = React.useRef(null);
  const aliveRef = React.useRef(true);
  // The seed belonging to the CURRENT path, readable from the load effect without making `doc` a
  // dependency (a caller that rebuilds the object every render would otherwise reload on every one).
  const seedRef = React.useRef(seed);
  seedRef.current = seed;

  const primary = (schema?.fields || []).find(f => f.primary);
  const title = (primary && data[primary.key]) || data.name || data.title
    || String(path || '').split('/').pop().replace(/\.md$/, '');

  // ── read ────────────────────────────────────────────────────────────────────────────────────
  // api.record() is backend/records.mjs (M2) and is the read that carries `rev` and the Law 4
  // flags. Until it is mounted, /api/document is the read: `rev` is then null, which is exactly
  // right — there is no pipeline writing underneath us yet, so there is nothing to conflict with.
  const readDisk = React.useCallback(async () => {
    try {
      const r = await api.record(path);
      // `kind` is not on this envelope yet — see INTEGRATION PATCHES (records.mjs `readRecord`).
      // `r.kind || null` picks it up the moment that patch lands, with no change needed here.
      return { data: r.data || {}, content: r.content || '', rev: r.rev ?? null, flags: r.flags || null, summary: r.summary, collection: r.collection || null, kind: r.kind || null };
    } catch (e) {
      if (e.status && e.status !== 404) throw e;
      const d = await api.document(path);
      return { data: d.data || {}, content: d.content || '', rev: d.rev ?? null, flags: null, summary: d.summary, collection: (d.collections || [])[0] || null, kind: d.kind || null };
    }
  }, [path]);

  // The header button already called `onPromote(nextStage)` directly and never looked at what it
  // returned. App.jsx's `onMove` — the function `onPromote` is wired to — catches every failure
  // itself (a gate refusal included) and shows it as a toast, but resolves the SAME way whether
  // the write landed or was refused; there is no return value this surface can trust to tell the
  // two apart (see INTEGRATION PATCHES for a version that would). Re-reading the file after every
  // attempt sidesteps that entirely: nothing changed ⇒ the stage shown is still the true one;
  // something did ⇒ the button now offers the record's ACTUAL next stage instead of one already
  // spent. Without this, promoting from either the button or the `A` key (item 3) left "shortlist
  // A" on screen forever after a successful promote — the write landed, Activity and the
  // collection's rows knew it, and this surface alone kept lying about it.
  const promote = React.useCallback(async next => {
    if (!onPromote) return;
    try { await onPromote(next); } catch { /* a rejection (once the integration patch lands) still re-reads below */ }
    if (!aliveRef.current) return;
    try {
      const d = await readDisk();
      if (!aliveRef.current) return;
      dataRef.current = d.data; bodyRef.current = d.content; revRef.current = d.rev;
      setData(d.data); setBody(d.content); setFlags(d.flags); setOwnCollection(d.collection || null);
      setCollectionKnown(true); setKind(d.kind || null);
      setSummary(d.summary != null ? d.summary : firstParagraph(d.content));
    } catch { /* a failed re-read leaves the last-known state on screen, which is still not wrong */ }
  }, [onPromote, readDisk]);

  React.useEffect(() => {
    aliveRef.current = true;
    let cancelled = false;
    setLoadError(null); setConflict(null); setRaw(null); setOwnCollection(null);
    setCollectionKnown(false); setKind(null);
    setSave('saved'); setSaveError(null); setMode('editor'); setOpenText([]); setPeek(null);
    setPanel(p => (p === 'layout' ? p : null));   // Edit layout stays open across records: it is about the collection
    pendingRef.current = {}; bodyDirtyRef.current = false;
    // Switching documents re-seeds synchronously, so the surface never shows the PREVIOUS
    // record's fields under the new record's path for a frame.
    const s = seedRef.current;
    dataRef.current = s ? s.data : {};
    bodyRef.current = s ? s.content : '';
    revRef.current = s ? s.rev : null;
    setData(dataRef.current);
    setBody(bodyRef.current);
    setSummary(s ? (s.summary != null ? s.summary : firstParagraph(s.content)) : '');
    setLoading(!s);
    readDisk().then(d => {
      if (cancelled) return;
      dataRef.current = d.data; bodyRef.current = d.content; revRef.current = d.rev;
      setData(d.data); setBody(d.content); setFlags(d.flags); setOwnCollection(d.collection || null);
      setCollectionKnown(true); setKind(d.kind || null);
      setSummary(d.summary != null ? d.summary : firstParagraph(d.content));
      setLoading(false);
    }).catch(e => { if (!cancelled) { setLoadError(e.message); setLoading(false); } });
    // FLUSH, do not just cancel. This cleanup runs on every path change and on unmount, and it was
    // calling clearTimeout on the 800ms autosave — so changing a status cell and clicking Back
    // inside 800ms threw the edit away. The field had already changed on screen, no error was
    // shown, and the file kept the old value. Silent loss of a human's edit is the worst failure
    // this surface can have; a redundant PATCH is the cheapest possible price for avoiding it.
    return () => {
      cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); flushRef.current && flushRef.current(); }
      aliveRef.current = false;
    };
  }, [path, readDisk]);

  // Closing the window is the other way to lose a pending edit. Electron and the browser both fire
  // this; `flush()` is idempotent, so a save already in flight is not duplicated.
  React.useEffect(() => {
    const onLeave = () => { if (timerRef.current) { clearTimeout(timerRef.current); flushRef.current && flushRef.current(); } };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  React.useEffect(() => { if (onDirty) onDirty(save === 'unsaved' || save === 'conflict'); }, [save, onDirty]);

  // ── writes ──────────────────────────────────────────────────────────────────────────────────
  // The cleanup above needs the CURRENT flush without taking it as a dependency — depending on it
  // would re-run the load effect (and re-read the file) on every keystroke.
  const flushRef = React.useRef(null);
  const flush = React.useCallback(async () => {
    clearTimeout(timerRef.current);
    const patch = { ...pendingRef.current };
    const sendBody = bodyDirtyRef.current ? bodyRef.current : undefined;
    if (!Object.keys(patch).length && sendBody === undefined) return;
    setSave('saving'); setSaveError(null);
    try {
      // The note rides INSIDE the patch: `backend/records.mjs` patchRecord() reads `patch.body`,
      // and PATCH /api/records does not destructure a top-level `body` — a field a route does not
      // destructure does not exist (CLAUDE.md). It is also passed as api.patchRecord's 4th
      // argument, which the shim sends and the route currently ignores; the two are the same
      // string, so whichever the route grows to read, the same note is written.
      const wire = sendBody === undefined ? patch : { ...patch, body: sendBody };
      const res = await api.patchRecord(path, wire, revRef.current, sendBody, actor);
      if (!aliveRef.current) return;
      const bodyChangedDuringSave = sendBody === undefined
        ? bodyDirtyRef.current
        : bodyRef.current !== sendBody;
      // Clear only what we actually sent — a keystroke that landed mid-flight is still pending.
      for (const k of Object.keys(patch)) {
        if (JSON.stringify(pendingRef.current[k]) === JSON.stringify(patch[k])) delete pendingRef.current[k];
      }
      if (sendBody !== undefined && bodyRef.current === sendBody) bodyDirtyRef.current = false;
      if (res.rev !== undefined) revRef.current = res.rev;
      if (Object.keys(patch).length) setSavedProps(n => n + 1);
      if (res.data) { dataRef.current = res.data; setData(res.data); }
      if (res.content !== undefined && !bodyChangedDuringSave) { bodyRef.current = res.content; setBody(res.content); setSummary(firstParagraph(res.content)); }
      const stillDirty = Object.keys(pendingRef.current).length || bodyDirtyRef.current;
      setSave(stillDirty ? 'unsaved' : 'saved');
      if (stillDirty) timerRef.current = setTimeout(() => flush(), 700);
      if (onSaved) onSaved({ path, data: res.data || dataRef.current, content: res.content ?? bodyRef.current });
    } catch (e) {
      if (!aliveRef.current) return;
      if (e.status === 409) {
        // The 409 body carries the server's current state, but frontend/api.js's error shim keeps
        // only { error, code } — and that file is owned by the integrator. Re-reading disk is one
        // extra GET and is strictly more truthful anyway: it is the state AT RESOLUTION TIME.
        try {
          const disk = await readDisk();
          if (!aliveRef.current) return;
          setConflict({
            by: disk.data.updated_by || 'another writer',
            at: disk.data.updated || null,
            disk,
            mine: { data: dataRef.current, content: bodyRef.current },
            keys: [...new Set([...Object.keys(pendingRef.current), ...Object.keys(patch)])],
            bodyChanged: bodyDirtyRef.current,
          });
          setSave('conflict');
        } catch (e2) { setSave('error'); setSaveError(e2.message); }
        return;
      }
      setSave('error');
      setSaveError(e.message);
    }
  }, [path, actor, readDisk, onSaved]);

  React.useEffect(() => { flushRef.current = flush; }, [flush]);

  const queue = React.useCallback((key, value) => {
    setData(d => {
      const next = { ...d };
      if (value === null || value === undefined || value === '') delete next[key]; else next[key] = value;
      dataRef.current = next;
      return next;
    });
    pendingRef.current[key] = value === undefined ? null : value;
    setSave('unsaved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), 800);
  }, [flush]);

  const queueBody = React.useCallback(next => {
    bodyRef.current = next; bodyDirtyRef.current = true;
    setBody(next); setSummary(firstParagraph(next));
    setSave('unsaved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), 800);
  }, [flush]);

  // ── conflict resolution ─────────────────────────────────────────────────────────────────────
  // All three are non-destructive: none of them deletes a key, because the write is a PATCH and a
  // key only the other writer added survives every answer (Law 5).
  const takeDisk = () => {
    const d = conflict.disk;
    pendingRef.current = {}; bodyDirtyRef.current = false;
    dataRef.current = d.data; bodyRef.current = d.content; revRef.current = d.rev;
    setData(d.data); setBody(d.content); setSummary(d.summary != null ? d.summary : firstParagraph(d.content));
    setConflict(null); setSave('saved');
  };

  const keepMine = () => {
    const d = conflict.disk;
    // Every key I can see, written with my value, on top of the disk's revision.
    pendingRef.current = { ...dataRef.current };
    bodyDirtyRef.current = true;
    revRef.current = d.rev;
    setConflict(null);
    flush();
  };

  const mergeBoth = () => {
    const d = conflict.disk;
    const mineChanged = {};
    for (const k of conflict.keys) mineChanged[k] = dataRef.current[k] ?? null;
    const merged = { ...d.data, ...mineChanged };
    dataRef.current = merged; setData(merged);
    if (!conflict.bodyChanged) { bodyRef.current = d.content; setBody(d.content); setSummary(firstParagraph(d.content)); }
    pendingRef.current = mineChanged;
    bodyDirtyRef.current = !!conflict.bodyChanged;
    revRef.current = d.rev;
    setConflict(null);
    flush();
  };

  // ── the pickers a schema cannot fill in ─────────────────────────────────────────────────────
  // Loaded only when PROPERTIES is opened. Altitude 1 must not pay for altitude 2: opening a
  // record is one GET, and the relation lists are a click away by construction.
  React.useEffect(() => {
    // The header rows under the title are editable from the first paint, so their pickers are
    // needed as soon as the schema is known — not only once Details is opened.
    let cancelled = false;
    const actors = (schema?.fields || []).filter(f => f.type === 'actor');
    (async () => {
      const next = {};
      // Relation pickers load their own names (RelationPicker.jsx → recordNames.js), from the WHOLE
      // target collection. This used to ask for the target's first saved view, so a company outside
      // that view's filter could not be linked at all.
      if (actors.length) {
        try {
          const r = await api.assistants();
          const list = (r.assistants || []).map(a => ({ value: a.id, label: a.name || a.id, kind: 'agent' }));
          for (const f of actors) next[f.key] = [{ value: actor, label: actor, kind: 'human' }, ...list];
        } catch { /* M4 route; typing an id still works */ }
      }
      if (!cancelled && Object.keys(next).length) setOptions(o => ({ ...o, ...next }));
    })();
    return () => { cancelled = true; };
  }, [schema, actor]);

  // ── raw ─────────────────────────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (mode !== 'raw' || raw) return;
    let cancelled = false;
    api.fileRead(path)
      .then(r => { if (!cancelled) setRaw({ text: r.text ?? r.content ?? r.body ?? '', source: 'disk' }); })
      .catch(() => { if (!cancelled) setRaw({ text: reconstruct(dataRef.current, bodyRef.current), source: 'reconstructed' }); });
    return () => { cancelled = true; };
  }, [mode, raw, path]);
  // A save invalidates the raw text; it is re-read next time Raw is opened.
  React.useEffect(() => { if (save === 'saved') setRaw(null); }, [save]);

  // ── keys ────────────────────────────────────────────────────────────────────────────────────
  // `P` toggles properties (§2.1), ⌘S / ⌃S forces the pending write, and `A` promotes — the same
  // key the header button prints (docs/05_UI_SPEC.md §5). All three stand down inside any text
  // field — an editor that eats a letter it should have typed is worse than no shortcut.
  React.useEffect(() => {
    const editable = el => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); flush(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (editable(e.target)) return;
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setPanel(v => (v === 'details' ? null : 'details'));
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && nextStage) {
        e.preventDefault();
        // Same call the button makes — App.onMove already toasts a gate refusal (or any other
        // failure) with the server's own message, so a keyboard promotion is refused exactly as
        // visibly as a mouse one; `promote` (above) re-reads the file afterward either way, so
        // the button's own label is never left promising a stage that was already spent.
        promote(nextStage);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [schema?.id, flush, nextStage, promote]);

  // ── pictures ────────────────────────────────────────────────────────────────────────────────
  // A file chosen or dropped is stored once, by its content (`POST /api/files/attach` →
  // files/<sha256>.<ext>), and then the RECORD is changed through the same `queue` as any other
  // property. Which field takes it: the collection's picture field. If that field holds one file
  // and already has one, it is made a field that holds several — a person who adds a second
  // picture has just said this kind of thing can have more than one.
  const [attaching, setAttaching] = React.useState(false);
  const fileInput = React.useRef(null);
  const addFiles = async list => {
    const files = [...(list || [])];
    const fields = (schema?.fields || []).filter(f => f.type === 'file');
    const target = fields.find(f => f.primary_media) || fields[0];
    if (!files.length || !target) return;
    setAttaching(true); setSaveError(null);
    try {
      const paths = [];
      for (const file of files) {
        const res = await fetch('/api/files/attach?name=' + encodeURIComponent(file.name || 'file') + '&actor=' + encodeURIComponent(actor),
          { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'That file could not be added.');
        paths.push(out.path);
      }
      const have = [].concat(dataRef.current[target.key] ?? []).filter(hasValue);
      const all = [...have, ...paths.filter(p => !have.includes(p))];
      if (!target.many && all.length > 1) {
        await updateField(schema.id, target.key, { many: true }, actor);
        if (onSchemaChanged) await onSchemaChanged();
      }
      queue(target.key, target.many || all.length > 1 ? all : all[0]);
    } catch (e) { setSaveError(e.message); }
    finally { if (aliveRef.current) setAttaching(false); }
  };
  const removeMedia = item => {
    const have = [].concat(dataRef.current[item.field] ?? []).filter(hasValue);
    const next = have.filter((_, i) => i !== item.index);
    const field = (schema?.fields || []).find(f => f.key === item.field);
    queue(item.field, field && field.many ? next : (next[0] ?? null));
  };
  const canAttach = !!schema && (schema.fields || []).some(f => f.type === 'file');
  const onDropFiles = e => {
    if (!canAttach || !e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  };

  const toggleProps = () => setPanel(v => (v === 'details' ? null : 'details'));
  const toggleLayout = () => setPanel(v => (v === 'layout' ? null : 'layout'));

  // The server's schema has caught up with what Edit layout changed: drop the draft.
  React.useEffect(() => { setLayoutDraft(null); }, [schema]);
  const changeLayout = async patch => {
    if (!schema) return;
    setLayoutError(null);
    setLayoutDraft(d => ({ ...(d || {}), ...patch }));
    try {
      await collectionsApi.setMeta(schema.id, patch, actor);
      if (onSchemaChanged) await onSchemaChanged();
    } catch (e) { setLayoutDraft(null); setLayoutError(e.message); }
  };

  // Opening another record must not leave the previous one's reason strip armed over it.
  React.useEffect(() => { setArchiving(null); setArchiveError(null); setAddingProperty(false); setViewer(null); }, [path]);

  // The ONE removal in the app. `records.mjs` refuses a reasonless archive with a 400 that names
  // the five, so the picker is not politeness — sending nothing would simply fail. The pending
  // edit is flushed first: archiving a record while a debounced keystroke is still in the air
  // would write it back a moment after it moved.
  const archive = async reason => {
    setArchiveError(null);
    setArchiving('busy');
    try {
      await flush();
      const out = await api.archiveRecord(path, reason, actor);
      if (!aliveRef.current) return;
      setArchiving(null);
      if (onArchived) onArchived({ path, reason, result: out });
    } catch (e) {
      if (!aliveRef.current) return;
      // Verbatim: the route's message names the legal reasons, and a friendlier sentence would
      // say less.
      setArchiveError(e.message);
      setArchiving('picking');
    }
  };

  // ── render ──────────────────────────────────────────────────────────────────────────────────
  if (loading) return <div style={sx('flex:1;min-width:0')} />;
  if (loadError) {
    return (
      <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;padding:40px')}>
        <Empty size="page" style={sx('max-width:460px')} title="That document did not open" body={loadError + ' — ' + path} />
      </div>
    );
  }

  const { gate, num } = collapsedFields(schema, data);
  const look = SAVE_LOOK[save] || SAVE_LOOK.saved;
  const saveText = save === 'saved' ? 'Saved' : look.text;
  const gateValue = gate ? data[gate.key] : null;
  const writerId = data.assistant || data.prepared_by || data.updated_by || data.created_by || '';
  const writer = assistants.find(a => a.id === writerId)?.name || writerId;
  const when = data.verified_at || data.updated || data.created;
  const canArchive = String(path || '').startsWith('data/');
  const technicalKeys = String(path || '').startsWith('data/artifacts/')
    ? ['source_task', 'source_cycle', 'result_hash', 'assistant', 'goal_id', 'project', 'universe']
    : ['source_task', 'source_cycle', 'result_hash'];

  // The collection as it should be DRAWN: the saved schema, with any layout choice still on its
  // way to the server applied on top (a `null` there means "back to the default").
  const shape = !schema ? null : !layoutDraft ? schema
    : Object.fromEntries(Object.entries({ ...schema, ...layoutDraft }).filter(([, v]) => v !== null));
  const page = pageOf(shape);

  // Long text fields (a prompt, a brief) get their own blocks on the page. The ones with text, and
  // the ones somebody has asked to write, are open; the rest are one small button each, so an
  // empty "Generated prompt" does not sit on every record as a blank box.
  const media = recordMedia(schema, data);
  const longFields = longTextFields(schema);
  const textBlocks = longFields.filter(f => hasValue(data[f.key]) || openText.includes(f.key));
  const emptyText = longFields.filter(f => !textBlocks.includes(f));
  const detailOmit = [...(primary ? [primary.key] : []), ...longFields.map(f => f.key)];
  const slug = String(path || '').split('/').pop().replace(/\.md$/, '');

  // The picture leaves the flow when the layout gives it its own place.
  const showMedia = page.sections.includes('media');
  const hasMedia = media.length > 0 && showMedia;
  const beside = page.layout === 'side' && hasMedia;
  const small = page.layout === 'compact' && hasMedia;
  // In its own column or as a thumbnail the picture is sized by that place; on top, by the
  // collection's chosen size.
  const mediaEl = media.length || canAttach ? (
    <RecordMedia items={media} title={title} style={small ? 'lead' : page.media}
      maxHeight={beside || small ? null : PAGE_MEDIA_PX[page.mediaSize]}
      onView={setViewer} onOpenPath={onOpenPath} busy={attaching}
      onAdd={canAttach && !small ? () => fileInput.current && fileInput.current.click() : null}
      onRemove={small ? null : removeMedia} />
  ) : null;

  const part = {
    properties: schema ? (
      <RecordHeader key="properties" schema={shape} data={data} options={options} onChange={queue} onFollow={onOpen}
        onShowAll={() => setPanel('details')} onPick={(field, value) => setPeek({ field, value })} />
    ) : null,
    media: beside || small ? null : (mediaEl ? <React.Fragment key="media">{mediaEl}</React.Fragment> : null),
    text: textBlocks.length || emptyText.length ? (
      <div key="text" className="recordTexts">
        {textBlocks.map(f => (
          <TextBlock key={f.key} field={f} value={data[f.key]} open={page.text === 'open'} onChange={v => queue(f.key, v)} />
        ))}
        {emptyText.length ? (
          <div className="recordTextAdd">
            {emptyText.map(f => (
              <button key={f.key} type="button" className="recordTextAddBtn hBd" onClick={() => setOpenText(o => [...o, f.key])}>
                + {propertyLabel(f)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ) : null,
    note: (
      <div key="note" className="documentBody">
        <RichEditor key={path} value={body} onChange={queueBody} minHeight={160}
          placeholder="Write here. Type / for headings, lists, tables and more." />
      </div>
    ),
    // What belongs to this record: its sub-collections (docs/02_DATA_MODEL.md §4).
    children: schema ? (
      <Subtables key="children" collection={schema} collections={collections} slug={slug}
        actor={actor} onOpenPath={onOpenPath} onOpen={onOpen} refreshKey={savedProps} />
    ) : null,
  };
  // A document that is in no collection (a goal, me.md) has no layout to customize: it is its
  // title and its note, with everything else in Details.
  const flow = schema ? page.sections.map(s => part[s]) : [part.note];
  const widthPx = PAGE_WIDTH_PX[page.width];

  return (
    <div className="documentSurface">
      <div className="documentMain">
        <div className="documentToolbar">
          <div className="documentToolbarGroup">
            {onBack ? <Btn variant="ghost" size="sm" onClick={onBack} title="Back to the collection">← Back</Btn> : null}
            <span className="documentCollection">{schema?.label || (kind && kind !== 'other' ? kind : 'Note')}</span>
          </div>
          <div className="documentToolbarGroup">
            <span role="status" className="documentSaveState" title={saveError || 'Everything you type is saved automatically'} style={{ color: look.colour }}>{saveText}</span>
            {/* What installed plugins can do with this record ("Create invoice" on a deal). Renders
                nothing when no plugin has an action for this collection. */}
            {schema ? <RecordActions collection={schema.id} path={path} actor={actor} onOpenPath={onOpenPath} /> : null}
            {/* Ask the connected AI about this record. What it proposes is applied through the same
                queue as anything typed, so it autosaves, shows in history and can be undone by hand. */}
            <AskAI path={path} schema={schema} data={data} disabled={mode === 'raw'}
              onApply={(fields, bodyAppend) => {
                for (const [key, value] of Object.entries(fields || {})) queue(key, value);
                if (bodyAppend) queueBody((bodyRef.current ? bodyRef.current.replace(/\s+$/, '') + '\n\n' : '') + bodyAppend);
              }} />
            <Btn variant="ghost" size="sm" onClick={() => setMode(v => v === 'raw' ? 'editor' : 'raw')} aria-pressed={mode === 'raw'}
              title="The Markdown file behind this page">{mode === 'raw' ? 'Back to page' : 'Source'}</Btn>
            <Btn variant="ghost" size="sm" onClick={toggleProps} aria-expanded={propsOpen} title="Every property, the history and the links (P)">Details</Btn>
            {schema ? (
              <Btn variant="secondary" size="sm" onClick={toggleLayout} aria-expanded={panel === 'layout'}
                title={'Change how every ' + (schema.label || schema.id) + ' record is laid out'}>Edit layout</Btn>
            ) : null}
          </div>
        </div>
      {/* The reason strip — the same shape as NOT SAVED below, and the same five reasons the
          DECIDE queue rejects with (REJECT_REASONS mirrors records.mjs ARCHIVE_REASONS). Importing
          that list rather than retyping it is the point: a sixth reason added in one place must not
          leave a fifth-reason picker behind on this screen. */}
      {archiving ? (
        <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:9px 22px'), background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--danger)' }}>
          <span style={{ ...mono('font-size:var(--t-label);font-weight:700;letter-spacing:.14em;white-space:nowrap'), color: 'var(--danger)' }}>ARCHIVE — WHY?</span>
          {REJECT_REASONS.map(r => (
            <Btn key={r.id} variant="secondary" size="sm" disabled={archiving === 'busy'} onClick={() => archive(r.id)}>
              {r.label}
            </Btn>
          ))}
          <span style={{ ...sx('flex:1;min-width:0;font-size:var(--t-data)'), color: archiveError ? 'var(--danger)' : 'var(--fg-faint)' }}>
            {archiveError || 'It stays on disk with the reason attached, and the reason moves the source’s score.'}
          </span>
          <Btn variant="ghost" size="sm" disabled={archiving === 'busy'} onClick={() => { setArchiving(null); setArchiveError(null); }}>Cancel</Btn>
        </div>
      ) : null}

      {conflict ? (
        <ConflictNotification conflict={conflict} onTakeDisk={takeDisk} onKeepMine={keepMine} onMerge={mergeBoth} />
      ) : null}

      {saveError && !conflict ? (
        <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:12px;padding:9px 22px'), background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', borderLeft: '2px solid var(--danger)' }}>
          <span style={{ ...mono('font-size:var(--t-label);font-weight:700;letter-spacing:.14em'), color: 'var(--danger)' }}>NOT SAVED</span>
          <span style={{ ...sx('flex:1;min-width:0;font-size:var(--t-small)'), color: 'var(--fg-muted)' }}>{saveError}</span>
          <Btn variant="ghost" size="sm" onClick={() => flush()}>Try again</Btn>
        </div>
      ) : null}

        <div className="documentScroll">
          <article className={'documentPage recordPage-' + page.layout + (beside ? ' hasSide' : '')} aria-label="Record"
            style={{ maxWidth: widthPx == null ? 'none' : widthPx }}
            onDragOver={e => { if (canAttach && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) e.preventDefault(); }}
            onDrop={onDropFiles}>
            <input ref={fileInput} type="file" multiple hidden accept="image/*,video/*,audio/*,application/pdf"
              onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
            {beside ? <aside className="recordSide">{mediaEl}</aside> : null}
            <div className="recordFlow">
              <header className="documentHeading">
                <div className="recordTitleRow">
                 <div className="recordTitleMain">
                  <h1>{primary
                    ? <InlineEdit value={title} placeholder="Untitled" onCommit={v => queue(primary.key, v)} title="Click to rename" />
                    : title}</h1>
                <div className="documentByline">
                  {writer ? <span>{writer}</span> : null}
                  {when ? <Freshness value={when} /> : null}
                  {data.proposed && !gateValue ? <span>Needs review</span> : null}
                  {flags?.quarantined ? <span style={{ color: 'var(--danger)' }}>Quarantined · excluded from counts</span> : null}
                  {flags?.agentPromotion ? <span style={{ color: 'var(--warn)' }}>Agent promotion ignored</span> : null}
                  {nextStage ? <Btn variant="primary" size="sm" onClick={() => promote(nextStage)}>{String(nextStage).replace(/-/g, ' ')} <span style={{ opacity: .55 }}>A</span></Btn> : null}
                </div>
                 </div>
                 {small ? <div className="recordThumbs">{mediaEl}</div> : null}
                </div>
              </header>

              {mode === 'raw' ? (
                <div className="documentRaw">
                  <p>Markdown source of the note · changes save automatically</p>
                  <MarkdownSourceEditor value={body} onChange={queueBody} />
                  <details>
                    <summary>{raw?.source === 'disk' ? 'Full file on disk' : 'Reconstructed file'}</summary>
                    <div className="documentFilePath">{path}</div>
                    <pre>{raw?.text || ''}</pre>
                  </details>
                </div>
              ) : flow}
            </div>
          </article>
        </div>
      </div>
      {propsOpen ? <Inspector className="documentDetails" collection={schema}
        doc={{ path, fields: data, body }} referencedBy={referencedBy}
        open={detailSection} onToggle={setDetailSection} onClose={toggleProps}
        onOpen={onOpen} onOpenPath={onOpenPath} onOpenBoard={onOpenBoard}
        properties={<>
          <PropertyRows collection={schema} values={data} onChange={queue} onFollow={onOpen}
            onPick={schema ? (field, value) => setPeek({ field, value }) : undefined}
            options={options} variant="inspector" showAuto hideEmpty={false} omit={detailOmit}
            technicalKeys={technicalKeys}
            onAddProperty={onFieldAdded && schema ? () => setAddingProperty(true) : undefined}
            addComposer={addingProperty && schema ? <AddField collection={schema} actor={actor}
              onCancel={() => setAddingProperty(false)} onDone={f => { setAddingProperty(false); onFieldAdded(f); }} /> : null} />
          {onArchived && canArchive ? <Btn variant="ghost" size="sm" onClick={() => setArchiving('picking')} disabled={archiving === 'busy'} style={{ marginTop: 16 }}>Archive note…</Btn> : null}
        </>} /> : null}
      {panel === 'layout' && shape ? (
        <PageLayout schema={shape} onChange={changeLayout} onClose={() => setPanel(null)} error={layoutError} />
      ) : null}
      {peek && schema ? (
        <RecordPeek collection={schema} field={peek.field} value={peek.value} currentPath={path}
          onOpenPath={onOpenPath} onBrowse={onBrowse} onClose={() => setPeek(null)} />
      ) : null}
      {viewer ? <RenderLightbox src={viewer.src} kind="image" title={viewer.label} keyboard autoPlay={false}
        onClose={() => setViewer(null)} /> : null}
    </div>
  );
}
