// The left rail — 210px, per design/EXTRACT.md §3.2/§3.3.
//
// Order is fixed and comes from the design: project switcher → nav → COLLECTIONS → MEMORY →
// ASSISTANTS → FILES pinned at the bottom. `docs/05_UI_SPEC.md` §1 adds the MEMORY group to what
// the design drew; everything else is as measured.
//
// This is the app's ONLY navigation. Every screen is reachable from here, and every row that
// looks clickable is clickable — the previous version rendered three dead nav rows and two
// placeholder groups, which is most of why the app read as broken.
//
// Every row is the same row: 32px tall, a 13px sentence-case label (`--t-small`), a mono figure
// on the right. Selected is a `--raise` fill with a `--border-3` border — never an accent fill
// (docs/05_UI_SPEC.md §6). Hover is `--surface-2` + `--fg-soft` at 130ms ease.
//
// COLLECTIONS are listed by NAME with a coloured dot (frontend/collectionColour.js), not as
// `#id`: a collection is a kind of thing a person named — Companies, People, References — and the
// dot is how it is recognised everywhere else. A SUB-COLLECTION (docs/02_DATA_MODEL.md §4) sits one
// step in under its parent. `+ New collection` makes one right here; a row's ⋯ (or right-click)
// renames it, recolours it and nests another collection inside it.
//
// Props:
//   screen            current screen key — 'today' 'decide' 'project' 'collection' 'document'
//                     'goals' 'territory' 'playbook' 'memory' 'knows' 'assistants' 'assistant'
//                     'files' 'board' 'settings' 'admin' 'paperclip'
//   onNavigate(key, arg)  the one navigation callback
//   onSearch()        opens the ⌘K palette (item 11) — the SEARCH row at the top of nav is the
//                     visible way in; the chord works with or without it.
//   collections[]     from GET /api/collections            counts{}  id → row count
//   activeCollection  id of the collection on screen
//   assistants[]      from GET /api/assistants             memoryCounts { goals, territory, playbook }
//   needsYou          open decision count — the number that drives her day
//   project           active project id                    projects[] for the switcher
//   onCollectionsChanged()  a collection was created, renamed, recoloured or nested — App re-reads
//   actor             the human actor id, sent with every schema write

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Eyebrow } from './ui';
import PanelSplitter, { usePanelWidth, usePanelFlag } from './PanelSplitter';
import { useContextMenu } from './ContextMenu';
import CollectionMenu, { CollectionDot } from './CollectionMenu';
import { collectionsApi } from './collectionsApi';
import { collectionLabel } from './collectionColour';
import { collectionTree, folderOf } from '../shared/collectionShape.mjs';
import './collections.css';

export const RAIL_W = 210;
const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// One row, one behaviour. A row with no onClick renders as text rather than as a button, because
// a dead control that looks live is the thing this rail was guilty of.
function Row({ label, count, countTone, on, mono: isMono, onClick, dot, right }) {
  const [hover, setHover] = React.useState(false);
  const live = typeof onClick === 'function';
  return (
    <button
      type="button"
      disabled={!live}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...sx('display:flex;align-items:center;justify-content:space-between;gap:8px;height:32px;padding:0 10px;border-radius:7px;width:100%;text-align:left;font:inherit;transition:background 130ms ease,color 130ms ease,border-color 130ms ease'),
        cursor: live ? 'pointer' : 'default',
        background: on ? 'var(--raise)' : hover && live ? 'var(--surface-2)' : 'transparent',
        border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
        color: on ? 'var(--fg)' : hover && live ? 'var(--fg-soft)' : 'var(--fg-muted)',
      }}>
      <span style={sx('display:flex;align-items:center;gap:9px;min-width:0')}>
        {dot ? <span style={{ ...sx('flex:none;width:7px;height:7px;border-radius:9999px'), background: dot }} /> : null}
        <span style={{
          // A project id is data, so it keeps the mono face; everything else is a name.
          ...(isMono ? mono('font-size:var(--t-data)') : sx('font-size:var(--t-small)')),
          fontWeight: on ? 600 : 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{label}</span>
      </span>
      {right ? <span style={{ ...mono('flex:none;font-size:var(--t-label);font-weight:600;letter-spacing:.06em'), color: countTone || 'var(--fg-faint)' }}>{right}</span> : null}
      {count != null ? (
        <span style={{
          ...mono('flex:none;font-size:var(--t-data);font-weight:500;font-variant-numeric:tabular-nums'),
          color: countTone || 'var(--fg-faint)',
          ...(countTone ? sx('display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:9999px;border:1px solid ' + countTone) : {}),
        }}>{count}</span>
      ) : null}
    </button>
  );
}

// A collection in the rail: its dot, its name, its count — and on hover a ⋯ that opens the panel
// where it is renamed, recoloured and given sub-collections. The row is a wrapper holding TWO
// buttons side by side, because a button inside a button is not a thing a keyboard can reach.
// `drag` — optional { dragging, mark, onStart, onOver, onDrop, onEnd }. Given, the row can be
// picked up and dropped among its siblings (Rail's reorder, below); `mark` is where the dragged
// row would land relative to this one ('before' | 'after'), drawn as a line.
function CollectionRow({ collection, depth, count, on, menuOpen, onPick, onMore, onContextMenu, drag }) {
  const ref = React.useRef(null);
  return (
    <div ref={ref} className={'colRow' + (on ? ' on' : '') + (drag && drag.dragging ? ' dragging' : '') + (drag && drag.mark ? ' drop-' + drag.mark : '')}
      draggable={!!drag} onDragStart={drag ? drag.onStart : undefined} onDragEnd={drag ? drag.onEnd : undefined}
      onDragOver={drag ? e => drag.onOver(e, ref.current) : undefined} onDrop={drag ? drag.onDrop : undefined}
      onContextMenu={e => onContextMenu(e, ref.current)}>
      {Array.from({ length: depth }, (_, i) => <span key={i} className="colRowNest" aria-hidden="true" />)}
      <button type="button" className="colRowMain" onClick={onPick} title={collection.id}>
        <CollectionDot collection={collection} />
        <span className="colRowLabel">{collectionLabel(collection)}</span>
        <span className="colRowCount" style={{ fontFamily: MONO }}>{count}</span>
      </button>
      <button type="button" className="colRowMore" aria-label={'Options for ' + collectionLabel(collection)} aria-haspopup="dialog" aria-expanded={menuOpen}
        title="Rename, colour, sub-collections" onClick={() => onMore(ref.current)}>⋯</button>
    </div>
  );
}

// `+ New collection`: one field, in place. Enter makes it; Escape puts the row back. The human is
// the one who disposes (docs/02_DATA_MODEL.md §6), so hers is created — an assistant's arrives as
// a card instead.
function NewCollection({ actor, onCreated }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const close = () => { setOpen(false); setName(''); setError(null); };
  const create = async () => {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true); setError(null);
    try { const made = await collectionsApi.create(label, actor); close(); await onCreated(made); }
    catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };
  if (!open) return <button type="button" className="colNew hAccent" onClick={() => setOpen(true)}>+ New collection</button>;
  return (
    <>
      <input className="colNewInput" autoFocus value={name} disabled={busy} placeholder="Name it — Companies, People…" aria-label="Name of the new collection"
        onChange={e => setName(e.target.value)}
        onBlur={() => { if (!name.trim() && !error) close(); }}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); create(); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }} />
      {error ? <span className="colNewError" role="alert">{error}</span> : null}
    </>
  );
}

function Group({ label, note, children }) {
  return (
    <div style={sx('padding:6px 12px 10px;display:flex;flex-direction:column;gap:2px;border-top:1px solid var(--line)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 10px 6px')}>
        <Eyebrow style={sx('font-size:var(--t-label);font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>{label}</Eyebrow>
        {note ? <span style={{ ...mono('font-size:var(--t-label);font-weight:500'), color: 'var(--fg-faint)' }}>{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

// Groups render with ZERO items rather than placeholder rows. A fake count is a lie the next
// person has to disprove.
function NoneYet({ children }) {
  return (
    <span style={{ ...sx('display:flex;align-items:center;min-height:32px;padding:0 10px;font-size:var(--t-small)'), color: 'var(--fg-faint)' }}>
      {children}
    </span>
  );
}

const DOT = { running: 'var(--marked)', blocked: 'var(--warn)', idle: 'var(--border-3)' };

export default function Rail({
  screen, onNavigate, onSearch,
  collections = [], counts = {}, activeCollection, onPickCollection,
  assistants = [], activeAssistant, memoryCounts = {}, needsYou = 0,
  project, projects = [], onPickProject, onCollectionsChanged, actor,
}) {
  const [switcher, setSwitcher] = React.useState(false);
  const go = key => () => onNavigate && onNavigate(key);

  // The collection panel: which row it belongs to (`key` = parent + child, since a sub-collection
  // with two parents has two rows), where that row is, and which part to put the cursor in.
  const [panel, setPanel] = React.useState(null);
  const contextMenu = useContextMenu();
  const changed = React.useCallback(async () => { if (onCollectionsChanged) await onCollectionsChanged(); }, [onCollectionsChanged]);
  const tree = collectionTree(collections);

  // REORDER BY DRAGGING. A collection is dragged among its SIBLINGS: top-level ones among the
  // top-level ones, a sub-collection among the others of the same parent. It only changes the order
  // they are listed in — nothing about what a collection contains or belongs to; nesting stays the
  // deliberate "Add sub-collection" in the ⋯ menu, because it adds a property to the records.
  const [dragging, setDragging] = React.useState(null);   // { id, parent }
  const [dropAt, setDropAt] = React.useState(null);       // { id, where: 'before' | 'after' }
  const [orderNote, setOrderNote] = React.useState(null);
  const sameGroup = parent => dragging && (dragging.parent || null) === (parent || null);
  const dragFor = (c, parent) => ({
    dragging: !!dragging && dragging.id === c.id && sameGroup(parent),
    mark: dropAt && dropAt.id === c.id && sameGroup(parent) && dragging.id !== c.id ? dropAt.where : null,
    onStart: e => { setDragging({ id: c.id, parent: parent || null }); setOrderNote(null); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); } catch { /* some shells refuse */ } },
    onEnd: () => { setDragging(null); setDropAt(null); },
    onOver: (e, el) => {
      if (!sameGroup(parent) || dragging.id === c.id || !el) return;
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const where = e.clientY < box.top + box.height / 2 ? 'before' : 'after';
      setDropAt(at => (at && at.id === c.id && at.where === where ? at : { id: c.id, where }));
    },
    onDrop: async e => {
      e.preventDefault();
      const moved = dragging, at = dropAt;
      setDragging(null); setDropAt(null);
      if (!moved || !at || !sameGroup(parent) || moved.id === at.id) return;
      const siblings = tree.filter(n => (n.parent || null) === (moved.parent || null)).map(n => n.collection.id).filter(id => id !== moved.id);
      const i = siblings.indexOf(at.id);
      if (i < 0) return;
      siblings.splice(at.where === 'before' ? i : i + 1, 0, moved.id);
      try { await collectionsApi.reorder(siblings, moved.parent, actor); await changed(); }
      catch (err) { setOrderNote(err.message || String(err)); }
    },
  });

  // The rail's width is the person's (drag its right edge), and it folds away with ⌘\ for the
  // moments a wide table or a wall of cards wants the whole window.
  const [width, setWidth, resetWidth] = usePanelWidth('scout.rail.w', RAIL_W, { min: 180, max: 460 });
  const [folded, setFolded] = usePanelFlag('scout.rail.folded');
  React.useEffect(() => {
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setFolded(v => !v); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setFolded]);

  if (folded) {
    return (
      <aside className="railFolded" aria-label="Sidebar (folded)">
        <button type="button" className="railFoldBtn hFg" onClick={() => setFolded(false)} title="Show the sidebar (⌘\\)" aria-label="Show the sidebar">›</button>
      </aside>
    );
  }

  return (
    <aside style={{ ...sx('position:relative;flex:none;background:var(--surface);border-right:1px solid var(--line);display:flex;flex-direction:column;overflow:hidden'), width }}>
      <PanelSplitter edge="right" width={width} onResize={setWidth} onReset={resetWidth} label="Resize the sidebar" />
      <button type="button" className="railFoldBtn railFoldBtnIn hFg" onClick={() => setFolded(true)} title="Hide the sidebar (⌘\\)" aria-label="Hide the sidebar">‹</button>
      {/* project switcher */}
      <div style={sx('flex:none;padding:10px 12px;border-bottom:1px solid var(--line);position:relative')}>
        <button type="button" onClick={() => setSwitcher(v => !v)}
          style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border-radius:6px;background:var(--raise);border:1px solid var(--border-3);cursor:pointer;text-align:left')}>
          <span style={sx('display:flex;flex-direction:column;gap:3px;min-width:0')}>
            <Eyebrow style={sx('font-size:var(--t-label);font-weight:700;letter-spacing:.12em;color:var(--fg-faint)')}>PROJECT</Eyebrow>
            <span style={sx('font-size:var(--t-small);font-weight:600;color:' + (project ? 'var(--fg)' : 'var(--fg-muted)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
              {project || 'No project yet'}
            </span>
          </span>
          <span style={{ ...mono('font-size:var(--t-label)'), color: 'var(--fg-muted)' }}>▾</span>
        </button>
        {switcher && projects.length ? (
          <div style={sx('position:absolute;left:12px;right:12px;top:66px;z-index:40;padding:4px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.45)')}>
            {projects.map(p => (
              <Row key={p.id} isMono label={p.label || p.id} on={p.id === project}
                onClick={() => { setSwitcher(false); onPickProject && onPickProject(p.id); }} />
            ))}
          </div>
        ) : null}
      </div>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column')}>
        {/* nav — the three things she does. NEEDS YOU carries the only warn-toned count in the
            rail, because it is the number that decides whether she opens the app at all. SEARCH
            is item 11's affordance — ⌘K worked with no visible way to learn it existed. */}
        <div style={sx('padding:10px 12px;display:flex;flex-direction:column;gap:2px')}>
          <Row label="Search" right="⌘K" onClick={onSearch} />
          <Row label="Needs you" count={needsYou} on={screen === 'decide'} onClick={go('decide')}
            countTone={needsYou > 0 ? 'var(--warn)' : 'var(--border-2)'} />
          <Row label="Today" on={screen === 'today'} onClick={go('today')} />
          <Row label="Admin" on={screen === 'admin'} onClick={go('admin')} />
          <Row label="Paperclip board" on={screen === 'paperclip'} onClick={go('paperclip')} />
          <Row label="Project" on={screen === 'project'} onClick={go('project')} />
        </div>

        {/* What the assistants know how to do, and the buttons that make things from a record
            (docs/10_SKILLS_AND_PLUGINS.md). Above the collections because both act ON them. */}
        <Group label="SKILLS">
          <Row label="Skills" on={screen === 'skills'} onClick={go('skills')} />
          <Row label="Plugins" on={screen === 'plugins'} onClick={go('plugins')} />
          <Row label="Automations" on={screen === 'automations'} onClick={go('automations')} />
        </Group>

        <Group label="COLLECTIONS">
          {tree.length
            ? tree.map(({ collection: c, depth, parent }) => {
                const key = (parent || '') + '/' + c.id;
                const openPanel = (anchorEl, focus) => setPanel({ key, id: c.id, parent, focus, anchor: anchorEl ? anchorEl.getBoundingClientRect() : null });
                return (
                  <CollectionRow key={key} collection={c} depth={depth} count={counts[c.id] ?? '·'}
                    drag={dragFor(c, parent)}
                    on={(screen === 'collection' || screen === 'document') && c.id === activeCollection}
                    menuOpen={!!panel && panel.key === key}
                    onPick={() => onPickCollection && onPickCollection(c.id)}
                    onMore={el => openPanel(el, 'name')}
                    // Right-click is the app's one ContextMenu; each item opens the panel on its part.
                    onContextMenu={(e, el) => contextMenu.open([
                      { label: 'Rename…', onClick: () => openPanel(el, 'name') },
                      { label: 'Colour…', onClick: () => openPanel(el, 'colour') },
                      { label: 'Add sub-collection…', onClick: () => openPanel(el, 'sub') },
                      { sep: true },
                      { label: 'Show folder in Files', onClick: () => onNavigate && onNavigate('files', folderOf(c)) },
                    ])(e)} />
                );
              })
            : <NoneYet>None yet</NoneYet>}
          {orderNote ? <p className="colOrderNote" role="alert">{orderNote}</p> : null}
          <NewCollection actor={actor} onCreated={async made => { await changed(); if (made && made.id && onPickCollection) onPickCollection(made.id); }} />
        </Group>

        {/* docs/05_UI_SPEC.md §1 — the group the design did not draw. This is the layer the whole
            product is about: what the assistants know, and what she can correct. */}
        <Group label="MEMORY">
          <Row label="Goals" count={memoryCounts.goals ?? '·'} on={screen === 'goals'} onClick={go('goals')} />
          <Row label="Territory" count={memoryCounts.territory ?? '·'} on={screen === 'territory'} onClick={go('territory')} />
          {/* Exactly four rows — Goals · Territory · Playbook · What they know (T11 step 4). There
              was a fifth called "Memory" that opened the same screen as Playbook: two doors to one
              room, which reads as a bug to anyone who tries both. `me`, the playbook and the
              learnings share one surface on purpose (T11 step 1), and Playbook is its door. */}
          <Row label="Playbook" count={memoryCounts.playbook ?? '·'}
            on={screen === 'playbook' || screen === 'memory'} onClick={go('playbook')} />
          <Row label="What they know" on={screen === 'knows'} onClick={go('knows')} />
        </Group>

        <Group label="ASSISTANTS">
          {assistants.length
            ? assistants.map(a => (
                <Row key={a.id} label={a.name || a.id}
                  dot={DOT[a.status] || DOT.idle}
                  right={String(a.status || 'idle').toUpperCase()}
                  countTone={DOT[a.status] || 'var(--fg-faint)'}
                  on={screen === 'assistants' && a.id === activeAssistant}
                  onClick={() => onNavigate && onNavigate('assistant', a.id)} />
              ))
            : <NoneYet>None hired</NoneYet>}
          {/* This goes to the HIRING screen, not the roster. It said `assistants` and therefore did
              nothing visible when you were already looking at the roster — a dead control that
              looks live, which is the exact class of bug this rail was rebuilt to remove. */}
          <button type="button" className="colNew hAccent" onClick={go('hire')}>+ Hire an assistant</button>
        </Group>

        <Group label="BOARD">
          <Row label="Whiteboard" on={screen === 'board'} onClick={go('board')} />
        </Group>
      </div>

      {/* Law 8 — we compress hard, so the way down is pinned where it can always be found.
          SETTINGS sits beside it — item 12 — the two rows a person looks for at the bottom of any
          app, not buried in a menu that does not exist here. */}
      <div style={sx('flex:none;border-top:1px solid var(--line);padding:8px 12px;display:flex;flex-direction:column;gap:2px')}>
        <Row label="Files" on={screen === 'files'} onClick={go('files')} />
        <Row label="Settings" on={screen === 'settings'} onClick={go('settings')} />
      </div>

      {contextMenu.render()}
      {panel ? (() => {
        const c = collections.find(x => x.id === panel.id);
        if (!c) return null;
        return (
          <CollectionMenu key={panel.key + ':' + panel.focus} anchor={panel.anchor} focus={panel.focus}
            collection={c} collections={collections} parent={collections.find(x => x.id === panel.parent) || null}
            actor={actor} onChanged={changed} onNavigate={onNavigate} onClose={() => setPanel(null)} />
        );
      })() : null}
    </aside>
  );
}
