// The collection table — rows and columns, the layout for scanning and comparing.
//
// One component per view type, chosen by the view's `type` (docs/05_UI_SPEC.md §3). The columns
// are the view's `fields` (the name always leads), the row scale is its `size`, and typed cells
// come from `./cells`, the only place a field type becomes UI. Every figure is mono with tabular
// numerals so digits line up down a column.
//
// COLUMN WIDTHS are the view's, like everything else about it (`view.widths`, pixels by field).
// Drag the edge of a header to set one. Until somebody does, the browser sizes the columns to
// their content; the first drag pins every column at the width it has right then, so resizing one
// column never makes the others jump.
//
// A COLUMN IS A PROPERTY, and its header is where it is changed. Clicking a header opens that
// column's own menu: sort by it, rename it, change what kind of thing it is, hide it from this
// view, delete it. The last header is a `+` that adds a property and shows it here at once. The
// editor is `PropertyMenu.jsx` — the same one the view bar's Properties menu opens, so the list,
// the cards and the board edit a property the same way.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Cell, Editor, isDerived } from './cells';
import { Empty, OpenRecord } from './ui';
import { GroupHeader } from './ListView';
import { sizeOf, wrapOf, shownFields, primaryOf, groupRows, groupFieldOf, fieldLabel } from './viewDisplay';
import { useIncremental, takeGroups, More } from './useIncremental.jsx';
import { Menu, MenuRow, MenuDivider, PropertyEditor, AddProperty, shownKeys } from './PropertyMenu';

const MIN_COL = 72;

const MENU_W = 284;
const ADD_COL = 44;

export default function TableView({ collection, view, rows, selected, onSelect, onOpen, onFollow, onPick, onPatch, onSaveView, onSchemaChanged, actor }) {
  const z = sizeOf(view);
  const wrap = wrapOf(view);
  const defs = shownFields(collection, view, { title: true });
  const primary = primaryOf(collection);
  const groups = groupRows(rows, collection, view);
  // A screenful at a time (./useIncremental) — the rest is drawn as it is scrolled towards.
  const win = useIncremental(rows.length, { step: 150, resetKey: collection.id + '/' + view.id });

  // Sorting from a header writes the SAME saved view the Sort control writes — one model, one
  // field at a time.
  const sortField = view.sort?.[0]?.field || null;
  const sortDir = view.sort?.[0]?.dir || null;
  const save = next => (onSaveView ? Promise.resolve(onSaveView(next)).catch(() => {}) : Promise.resolve());
  const setSort = (key, dir) => save({ ...view, sort: dir ? [{ field: key, dir }] : [] });

  // The open header menu: { key, mode: 'menu' | 'edit' | 'delete', align } — or { key: '+' } for
  // the add column. One at a time; opening another closes this one.
  const [menu, setMenu] = React.useState(null);
  // The one cell being edited — { path, key }.
  const [editing, setEditing] = React.useState(null);
  const closeMenu = React.useCallback(() => setMenu(null), []);
  const scroller = React.useRef(null);
  const toggleMenu = (key, e) => {
    if (menu && menu.key === key) return setMenu(null);
    // A menu hangs from its column's left edge unless that would run it out of the pane.
    const th = e.currentTarget.closest('th').getBoundingClientRect();
    const pane = scroller.current ? scroller.current.getBoundingClientRect() : { right: window.innerWidth };
    setMenu({ key, mode: 'menu', align: th.left + MENU_W > pane.right - 8 ? 'right' : 'left' });
  };
  const canEdit = !!onSchemaChanged;
  const hide = key => { closeMenu(); return save({ ...view, fields: shownKeys(collection, view).filter(k => k !== key), card: null }); };

  // While a column is being dragged the width lives here; it is written to the view on release.
  const [live, setLive] = React.useState(null);
  const widths = live || view.widths || null;
  const head = React.useRef(null);

  const startResize = (key, e) => {
    if (!onSaveView) return;
    e.preventDefault(); e.stopPropagation();
    // Pin every column at its current width first (see the header note).
    const measured = {};
    for (const th of head.current ? head.current.querySelectorAll('th[data-key]') : []) measured[th.dataset.key] = Math.round(th.getBoundingClientRect().width);
    const base = { ...measured, ...(view.widths || {}) };
    const from = e.clientX, start = base[key] || 160;
    let next = base;
    const move = ev => { next = { ...base, [key]: Math.max(MIN_COL, Math.round(start + ev.clientX - from)) }; setLive(next); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      Promise.resolve(onSaveView({ ...view, widths: next })).catch(() => {}).finally(() => setLive(null));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const resetWidths = () => { if (onSaveView && view.widths) onSaveView({ ...view, widths: undefined }); };

  // EDITING IN PLACE. A choice and a yes/no change on one click (Cell does that itself). Anything
  // else that a person types or picks — text, a number, a date, a link, tags, a linked record —
  // becomes its editor when its cell is clicked, with the caret already in it. What can NOT be
  // edited here says so by not reacting: computed values, files, and structured lists, which are
  // edited on the record's own page.
  const canType = f => !!onPatch && !isDerived(f) && !f.auto && ['text', 'number', 'date', 'url', 'email', 'phone', 'multiselect', 'relation'].includes(f.type);
  const cellRef = React.useRef(null);
  React.useEffect(() => {
    if (!editing || !cellRef.current) return;
    const input = cellRef.current.querySelector('input, textarea');
    if (input) { input.focus(); try { input.select && input.type !== 'date' && input.select(); } catch { /* not selectable */ } }
  }, [editing && editing.path, editing && editing.key]);

  const body = r => {
    const on = selected === r.path;
    return (
      // `rvH` arms the reveal-on-hover Open chip in the name cell. The row still opens on
      // double-click — OpenRecord makes that gesture discoverable rather than replacing it.
      <tr key={r.path} className={'tvRow rvH' + (on ? ' on' : '')} onClick={() => onSelect(r)} onDoubleClick={() => onOpen(r)}>
        {defs.map(f => (
          <td key={f.key} style={{ paddingTop: z.row, paddingBottom: z.row }}>
            {f.key === primary?.key ? (
              <span className={'tvName' + (wrap ? ' wrap' : '')}>
                <span className="tvNameText" style={{ fontSize: z.title }}>{r.title}</span>
                <OpenRecord onOpen={() => onOpen(r)} />
              </span>
            ) : (
              editing && editing.path === r.path && editing.key === f.key ? (
                // A double-click inside a field selects a word; it must not open the record.
                <div ref={cellRef} className="tvCell editing" onDoubleClick={e => e.stopPropagation()}>
                  <Editor field={f} value={r.fields[f.key]} onChange={v => onPatch(r, f.key, v)} onFollow={onFollow} onPick={onPick} />
                </div>
              ) : (
                <div className={'tvCell' + (wrap ? ' wrap' : '') + (canType(f) ? ' can' : '')} style={{ zoom: z.zoom }}
                  title={canType(f) ? 'Click to edit' : undefined}
                  onClick={canType(f) ? () => setEditing({ path: r.path, key: f.key }) : undefined}>
                  <Cell field={f} value={r.fields[f.key]} onFollow={onFollow} onPick={onPick}
                    onChange={onPatch ? v => onPatch(r, f.key, v) : undefined} />
                </div>
              )
            )}
          </td>
        ))}
        {canEdit ? <td aria-hidden="true" /> : null}
      </tr>
    );
  };

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      <div ref={scroller} style={sx('flex:1;min-height:0;overflow:auto')}>
        <table className={'tv' + (widths ? ' fixed' : '')} style={widths ? { width: defs.reduce((sum, f) => sum + (widths[f.key] || 160), 0) + (canEdit ? ADD_COL : 0) } : undefined}>
          {widths ? <colgroup>{defs.map(f => <col key={f.key} style={{ width: widths[f.key] || 160 }} />)}{canEdit ? <col style={{ width: ADD_COL }} /> : null}</colgroup> : null}
          <thead ref={head}>
            <tr>
              {defs.map(f => {
                const on = sortField === f.key;
                const open = !!menu && menu.key === f.key;
                // A key the schema does not declare has a column (Law 8) and nothing to edit yet.
                const declared = (collection.fields || []).some(x => x.key === f.key);
                const isName = f.key === primary?.key;
                return (
                  <th key={f.key} data-key={f.key} className={open ? 'tvOpen' : undefined}>
                    <button type="button" className="tvHead hFg" aria-haspopup="menu" aria-expanded={open}
                      onClick={e => toggleMenu(f.key, e)} disabled={!onSaveView}
                      title={fieldLabel(f) + (on ? (sortDir === 'asc' ? ' — sorted ascending' : ' — sorted descending') : '')}
                      style={{ color: on || open ? 'var(--fg)' : 'var(--fg-muted)' }}>
                      <span className="tvHeadText">{fieldLabel(f)}</span>
                      {on ? <span style={{ fontFamily: MONO, fontSize: 'var(--t-label)', color: 'var(--fg-faint)' }}>{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
                      <span className="tvHeadCaret" aria-hidden="true">▾</span>
                    </button>
                    <Menu open={open} onDismiss={closeMenu} width={MENU_W} align={open ? menu.align : 'left'}>
                      {open && menu.mode === 'menu' ? (
                        <>
                          <MenuRow on={on && sortDir === 'asc'} label="Sort ascending" onClick={() => { closeMenu(); setSort(f.key, 'asc'); }} />
                          <MenuRow on={on && sortDir === 'desc'} label="Sort descending" onClick={() => { closeMenu(); setSort(f.key, 'desc'); }} />
                          {on ? <MenuRow label="Clear sort" onClick={() => { closeMenu(); setSort(f.key, null); }} /> : null}
                          {canEdit && declared ? (
                            <>
                              <MenuDivider />
                              <MenuRow label={isName ? 'Rename' : 'Edit property'} hint={isName ? null : 'Name, type, choices'}
                                onClick={() => setMenu({ ...menu, mode: 'edit' })} />
                              {!isName ? <MenuRow label="Hide in this view" onClick={() => hide(f.key)} /> : null}
                              {!isName && !f.gate ? <MenuRow danger label="Delete property…" onClick={() => setMenu({ ...menu, mode: 'delete' })} /> : null}
                            </>
                          ) : null}
                        </>
                      ) : open ? (
                        <PropertyEditor collection={collection} field={f} view={view} onSaveView={save} onSchemaChanged={onSchemaChanged}
                          actor={actor} startAt={menu.mode === 'delete' ? 'delete' : 'edit'} onClose={closeMenu} />
                      ) : null}
                    </Menu>
                    {onSaveView ? (
                      <span className="tvGrip" role="separator" aria-orientation="vertical" aria-label={'Resize ' + fieldLabel(f)}
                        title="Drag to resize. Double-click to let the columns size themselves again."
                        onPointerDown={e => startResize(f.key, e)} onDoubleClick={resetWidths} />
                    ) : null}
                  </th>
                );
              })}
              {canEdit ? (
                <th className={'tvAddCol' + (menu && menu.key === '+' ? ' tvOpen' : '')}>
                  <button type="button" className="tvAddBtn" aria-haspopup="dialog" aria-expanded={!!menu && menu.key === '+'}
                    title="Add a property" aria-label="Add a property"
                    onClick={() => setMenu(m => (m && m.key === '+' ? null : { key: '+', mode: 'add', align: 'right' }))}>+</button>
                  <Menu open={!!menu && menu.key === '+'} onDismiss={closeMenu} width={MENU_W} align="right">
                    <AddProperty collection={collection} view={view} onSaveView={save} onSchemaChanged={onSchemaChanged} actor={actor} onClose={closeMenu} />
                  </Menu>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {groups
              ? takeGroups(groups, win.count).map(g => (
                <React.Fragment key={g.key || 'none'}>
                  <tr className="tvGroup"><td colSpan={defs.length + (canEdit ? 1 : 0)}><GroupHeader label={g.label} count={g.size} field={groupFieldOf(collection, view)} value={g.key} onFollow={onFollow} /></td></tr>
                  {g.items.map(body)}
                </React.Fragment>
              ))
              : rows.slice(0, win.count).map(body)}
          </tbody>
        </table>
        <More win={win} total={rows.length} />

        {!rows.length ? (
          <div style={sx('padding:40px 20px;display:flex;justify-content:center')}>
            <Empty size="page" style={sx('max-width:420px')} title="Nothing matches this view"
              body="The collection's query and this view's filters together return no records. Nothing is hidden — widen either one." />
          </div>
        ) : null}
      </div>
    </div>
  );
}
