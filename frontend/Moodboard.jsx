// Mood board engine — shared by project context boards and the global asset library.
//   · Mosaic: masonry (natural aspect) grid with a tile-size slider, hover metadata, tag chips
//   · Lightbox: fullscreen viewer — vision metadata, entity kind, quick tags, Send to FAL
// All metadata lives in <asset>.meta.md sidecars; everything stays portable markdown.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { ASSET_KINDS, kindDef } from './models';
import { RenderMedia } from './RenderMedia';
import { MONO } from './tokens';


export const assetUrl = (scope, name, folder) =>
  scope === 'library' ? api.libraryUrl(name, folder) : api.contextUrl(scope, name, folder);

// Vision analysis reads raster formats only — SVGs stay on the board but can't be analyzed
export const canAnalyze = c => c.type === 'image' && /\.(png|jpe?g|gif|webp|avif)$/i.test(c.name);

export function collectTags(items) {
  const count = {};
  items.forEach(i => (i.meta?.tags || []).forEach(t => { count[t] = (count[t] || 0) + 1; }));
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ t, n }));
}
export function collectKinds(items) {
  const present = new Set(items.map(i => i.meta?.kind).filter(Boolean));
  return ASSET_KINDS.filter(k => present.has(k.id));
}
export function matchesFilter(item, tag, q, kind, favOnly) {
  if (favOnly && !item.meta?.fav) return false;
  if (kind && (item.meta?.kind || '') !== kind) return false;
  if (tag && !(item.meta?.tags || []).includes(tag)) return false;
  if (q) {
    const hay = (item.name + ' ' + (item.meta?.description || '') + ' ' + (item.meta?.mood || '') + ' ' + (item.meta?.kind || '') + ' ' + (item.meta?.tags || []).join(' ')).toLowerCase();
    if (!hay.includes(q.toLowerCase())) return false;
  }
  return true;
}
export const selKey = c => (c.folder || '') + '/' + c.name;

// ── masonry mosaic — natural aspect ratios, dense editorial feel ──
export function Mosaic({ scope, folder, media, size, onOpen, onDelete, onAnalyze, analyzing, activeTag, onTag, onFav, selected, onToggleSel }) {
  const cols = Math.max(2, Math.round(7 - (size / 100) * 4.5)); // slider → 7…2 columns
  return (
    <div style={{ columnCount: cols, columnGap: 12 }}>
      {media.map(c => {
        const url = assetUrl(scope, c.name, folder);
        const m = c.meta;
        const kd = m && kindDef(m.kind);
        const busy = analyzing && analyzing[c.folder + '/' + c.name];
        const isSel = selected && selected[selKey(c)];
        return (
          <div key={c.name} className="mTile rvH" onClick={e => {
            if (onToggleSel && (e.shiftKey || (selected && Object.keys(selected).length))) { onToggleSel(c, e.shiftKey); return; }
            onOpen(c);
          }} style={isSel ? { border: '1.5px solid var(--accent)', boxShadow: '0 0 0 1px var(--accent-35)' } : undefined}>
            {/* masonry: height is auto (see `.mTile img,.mTile video` in styles.css), so leave
                object-fit to CSS with fit={null} */}
            <RenderMedia src={url} kind={c.type} fit={null} hoverPlay alt={c.name} />
            {onToggleSel && (
              <span onClick={e => { e.stopPropagation(); onToggleSel(c, e.shiftKey); }} className={isSel ? '' : 'tileDel'}
                style={{ ...sx('position:absolute;bottom:9px;right:9px;width:19px;height:19px;border-radius:5px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2'), opacity: isSel ? 1 : undefined, background: isSel ? 'var(--accent)' : 'rgba(6,7,10,.6)', border: '1.5px solid ' + (isSel ? 'var(--accent)' : 'var(--border-3)'), color: 'transparent', top: 'auto', left: 'auto' }}>
                {isSel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.8 6.8L9 1" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" /></svg>}
              </span>
            )}
            {onFav && (
              <span onClick={e => { e.stopPropagation(); onFav(c); }} className={m?.fav ? '' : 'tileDel'} title={m?.fav ? 'Unfavorite' : 'Favorite'}
                style={{ ...sx('position:absolute;top:8px;right:34px;width:22px;height:22px;border-radius:6px;background:rgba(5,6,8,.7);display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;z-index:2'), opacity: m?.fav ? 1 : undefined, color: m?.fav ? 'var(--accent)' : 'var(--fg-muted)', left: 'auto' }}>
                {m?.fav ? '★' : '☆'}
              </span>
            )}
            {/* top rail: kind + mood + fal — reveal-on-hover chrome (.rvH/.rv), not always-on clutter */}
            <div className="rv" style={sx('position:absolute;top:9px;left:9px;right:32px;display:flex;gap:5px;align-items:center;pointer-events:none;flex-wrap:wrap')}>
              {kd && <span style={{ ...sx('display:inline-flex;align-items:center;gap:4px;font-size:8.5px;font-weight:800;letter-spacing:.08em;border-radius:5px;padding:2.5px 7px;text-transform:uppercase;backdrop-filter:blur(6px)'), color: kd.color, background: 'rgba(6,7,10,.72)', border: '1px solid rgba(255,255,255,.08)' }}>{kd.icon} {kd.label}</span>}
              {m && m.mood && <span style={sx('font-size:8.5px;font-weight:700;letter-spacing:.06em;color:var(--fg);background:rgba(6,7,10,.72);border:1px solid rgba(255,255,255,.08);border-radius:5px;padding:2.5px 7px;text-transform:uppercase;backdrop-filter:blur(6px)')}>{m.mood}</span>}
              {m && m.falUrl && <span title="on fal storage" style={sx('font-size:8.5px;font-weight:800;letter-spacing:.06em;color:var(--ok);background:rgba(6,7,10,.72);border:1px solid rgba(63,207,142,.35);border-radius:5px;padding:2.5px 7px;backdrop-filter:blur(6px)')}>FAL ↗</span>}
            </div>
            {m && m.palette && m.palette.length > 0 && (
              <div className="mPal">
                {m.palette.slice(0, 5).map((p, k) => <span key={k} style={{ background: p }} />)}
              </div>
            )}
            <div className="tileBar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
              {m && m.description && <div style={sx('font-size:10.5px;color:rgba(255,255,255,.94);line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-shadow:0 1px 3px rgba(0,0,0,.5)')}>{m.description}</div>}
              {m && m.tags && m.tags.length > 0 && (
                <div style={sx('display:flex;gap:4px;flex-wrap:wrap')}>
                  {m.tags.slice(0, 5).map(t => (
                    <span key={t} onClick={e => { e.stopPropagation(); onTag && onTag(t === activeTag ? '' : t); }}
                      style={{ ...sx('font-size:8.5px;border-radius:4px;padding:1.5px 7px;cursor:pointer;backdrop-filter:blur(4px)'), fontFamily: MONO, color: 'var(--fg)', background: t === activeTag ? 'var(--raise)' : 'rgba(255,255,255,.16)', border: t === activeTag ? '1px solid var(--border-3)' : '1px solid transparent', fontWeight: t === activeTag ? 700 : 400 }}>{t}</span>
                  ))}
                </div>
              )}
              <div style={sx('display:flex;align-items:center;gap:8px')}>
                <span style={{ ...sx('flex:1;color:rgba(255,255,255,.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9 }}>{c.name}</span>
                {canAnalyze(c) && !m?.description && !busy && onAnalyze && (
                  <span onClick={e => { e.stopPropagation(); onAnalyze(c); }}
                    style={sx('font-size:8.5px;font-weight:700;letter-spacing:.06em;color:var(--accent);background:rgba(6,7,10,.75);border:1px solid var(--accent-60);border-radius:4px;padding:1.5px 7px;cursor:pointer;flex:none')}>✦ ANALYZE</span>
                )}
                {busy && <span style={sx('font-size:8.5px;font-weight:700;color:var(--accent);flex:none;animation:dl-pulse 1.1s infinite')}>✦ READING…</span>}
              </div>
            </div>
            {onDelete && <span className="tileDel" onClick={e => { e.stopPropagation(); onDelete(c); }}>&#10005;</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── shared board toolbar: size slider + kind rail + tag chips + keyword search ──
export function BoardControls({ size, onSize, tags, activeTag, onTag, q, onQ, kinds, activeKind, onKind, extra, favOnly, onFavOnly, view, onView }) {
  return (
    <div style={sx('display:flex;flex-direction:column;gap:10px;margin-bottom:16px')}>
      <div style={sx('display:flex;align-items:center;gap:14px;flex-wrap:wrap')}>
        {onView && (
          <div style={sx('display:flex;border:1px solid var(--border-2);border-radius:7px;overflow:hidden')}>
            {['board', 'list'].map(v => (
              <div key={v} onClick={() => onView(v)}
                style={{ ...sx('padding:5px 11px;font-size:11px;font-weight:600;cursor:pointer'), background: view === v ? 'var(--raise)' : 'transparent', color: view === v ? 'var(--fg)' : 'var(--fg-faint)' }}>
                {v === 'board' ? 'Board' : 'List'}
              </div>
            ))}
          </div>
        )}
        {view !== 'list' && <div style={sx('display:flex;align-items:center;gap:9px')}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="4" rx="1" fill="var(--fg-faint)"/><rect x="7" y="1" width="4" height="4" rx="1" fill="var(--fg-faint)"/><rect x="1" y="7" width="4" height="4" rx="1" fill="var(--fg-faint)"/><rect x="7" y="7" width="4" height="4" rx="1" fill="var(--fg-faint)"/></svg>
          <input type="range" min="0" max="100" value={size} onChange={e => onSize(+e.target.value)}
            style={{ width: 130, accentColor: 'var(--accent)' }} />
          <svg width="15" height="15" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" fill="var(--fg-faint)"/></svg>
        </div>}
        <input value={q} onChange={e => onQ(e.target.value)} placeholder="Filter by keyword, mood, tag…"
          onKeyDown={e => e.stopPropagation()}
          style={sx('width:230px;background:var(--surface);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:11.5px;padding:6px 11px')} />
        {onFavOnly && (
          <span onClick={() => onFavOnly(!favOnly)}
            style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.05em;border-radius:99px;padding:3.5px 11px;cursor:pointer'), color: favOnly ? 'var(--fg)' : 'var(--fg-muted)', background: favOnly ? 'var(--raise)' : 'transparent', border: '1px solid ' + (favOnly ? 'var(--border-3)' : 'var(--border-2)') }}>
            ★ FAVORITES
          </span>
        )}
        {onKind && (
          <div style={sx('display:flex;gap:4px;flex-wrap:wrap')}>
            {ASSET_KINDS.map(k => {
              const present = kinds && kinds.some(x => x.id === k.id);
              const on = activeKind === k.id;
              if (!present && !on) return null;
              return (
                <span key={k.id} onClick={() => onKind(on ? '' : k.id)}
                  style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.05em;border-radius:99px;padding:3.5px 11px;cursor:pointer;text-transform:uppercase'), color: on ? 'var(--fg)' : k.color, background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'rgba(255,255,255,.12)') }}>
                  {k.icon} {k.label}
                </span>
              );
            })}
          </div>
        )}
        {extra}
      </div>
      {tags.length > 0 && (
        <div style={sx('display:flex;gap:5px;flex-wrap:wrap;align-items:center')}>
          <span style={sx('font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-right:3px')}>TAGS</span>
          {tags.slice(0, 18).map(({ t, n }) => {
            const on = t === activeTag;
            return (
              <span key={t} onClick={() => onTag(on ? '' : t)}
                style={{ ...sx('font-size:10px;border-radius:99px;padding:3px 10px;cursor:pointer'), fontFamily: MONO, color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 400 }}>
                {t} <span style={{ opacity: .6 }}>{n}</span>
              </span>
            );
          })}
          {(activeTag || activeKind) && <span onClick={() => { onTag(''); onKind && onKind(''); }} className="hFgL" style={sx('font-size:10px;color:var(--fg-faint);cursor:pointer;margin-left:3px')}>clear filters ✕</span>}
        </div>
      )}
    </div>
  );
}

// ── list view for asset surfaces (F1.4) — sortable, keyboard-navigable ──
export class AssetList extends React.Component {
  constructor(props) {
    super(props);
    this.state = { sort: 'added', dir: -1, cur: 0 };
    this._key = e => {
      if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || this.props.paused) return;
      const k = e.key.toLowerCase();
      const list = this.sorted();
      if (!list.length) return;
      if (k === 'j' || k === 'arrowdown') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ cur: Math.min(list.length - 1, s.cur + 1) })); }
      else if (k === 'k' || k === 'arrowup') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ cur: Math.max(0, s.cur - 1) })); }
      else if (k === 'enter') { e.preventDefault(); e.stopPropagation(); this.props.onOpen(list[Math.min(this.state.cur, list.length - 1)]); }
      else if (k === '.') { e.preventDefault(); this.props.onFav && this.props.onFav(list[Math.min(this.state.cur, list.length - 1)]); }
    };
  }
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); }
  sorted() {
    const { items } = this.props;
    const { sort, dir } = this.state;
    const val = c =>
      sort === 'name' ? c.name.toLowerCase()
        : sort === 'kind' ? (c.meta?.kind || '~')
          : sort === 'size' ? c.size
            : sort === 'analyzed' ? (c.meta?.analyzed ? 1 : 0)
              : c.mtime; // added
    return items.slice().sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }
  header(id, label, width) {
    const on = this.state.sort === id;
    return (
      <span onClick={() => this.setState(s => ({ sort: id, dir: s.sort === id ? -s.dir : (id === 'name' || id === 'kind' ? 1 : -1) }))}
        className="hFg" style={{ ...sx('cursor:pointer;user-select:none'), color: on ? 'var(--fg)' : 'var(--fg-faint)' }}>
        {label}{on ? (this.state.dir > 0 ? ' ▲' : ' ▼') : ''}
      </span>
    );
  }
  render() {
    const { scope, onOpen, onFav, onAnalyze, onFal, onDelete, selected, onToggleSel, canFal } = this.props;
    const list = this.sorted();
    const cols = '24px 64px minmax(180px,1.1fr) 92px minmax(140px,1fr) 90px minmax(160px,1.4fr) 64px 30px 30px 26px 120px';
    return (
      <div style={sx('border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden;margin-top:14px')}>
        <div style={{ ...sx('display:grid;gap:10px;padding:8px 14px;font-size:10px;font-weight:700;letter-spacing:.1em;border-bottom:1px solid var(--border);align-items:center'), gridTemplateColumns: cols, color: 'var(--fg-faint)' }}>
          <span /><span />{this.header('name', 'NAME')}{this.header('kind', 'KIND')}<span>TAGS</span><span>MOOD</span><span>DESCRIPTION</span>{this.header('size', 'SIZE')}{this.header('analyzed', '✦')}<span>FAL</span><span>★</span><span>ACTIONS</span>
        </div>
        {list.map((c, i) => {
          const m = c.meta;
          const kd = m && kindDef(m.kind);
          const isSel = selected && selected[selKey(c)];
          const cur = i === Math.min(this.state.cur, list.length - 1);
          return (
            <div key={selKey(c)} onClick={() => { this.setState({ cur: i }); onOpen(c); }} className="hBg"
              style={{ ...sx('display:grid;gap:10px;align-items:center;padding:5px 14px;border-bottom:1px solid var(--line);cursor:pointer'), gridTemplateColumns: cols, background: cur ? 'var(--surface-2)' : 'transparent', boxShadow: cur ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
              <span onClick={e => { e.stopPropagation(); onToggleSel && onToggleSel(c, e.shiftKey); }}
                style={{ ...sx('width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center'), background: isSel ? 'var(--accent)' : 'transparent', border: '1.5px solid ' + (isSel ? 'var(--accent)' : 'var(--border-3)') }}>
                {isSel && <svg width="9" height="7" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.8 6.8L9 1" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" /></svg>}
              </span>
              <div style={sx('width:56px;height:36px;border-radius:5px;overflow:hidden;background:var(--surface-2)')}>
                <RenderMedia src={assetUrl(scope, c.name, c.folder)} kind={c.type} fit="cover" style={sx('width:100%;height:100%')} />
              </div>
              <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10.5 }}>{c.folder && <span style={{ color: 'var(--fg-faint)' }}>{c.folder}/</span>}{c.name}</span>
              <span>{kd && <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.08em;border-radius:5px;padding:2px 7px;text-transform:uppercase'), color: kd.color, border: '1px solid rgba(255,255,255,.1)' }}>{kd.icon} {kd.label}</span>}</span>
              <span style={sx('display:flex;gap:4px;overflow:hidden')}>
                {(m?.tags || []).slice(0, 4).map(t => <span key={t} style={{ ...sx('font-size:8.5px;color:var(--fg-muted);border:1px solid var(--border);border-radius:4px;padding:0 5px;white-space:nowrap'), fontFamily: MONO }}>{t}</span>)}
                {(m?.tags || []).length > 4 && <span style={{ ...sx('font-size:8.5px;color:var(--fg-faint)'), fontFamily: MONO }}>+{m.tags.length - 4}</span>}
              </span>
              <span style={sx('font-size:9.5px;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.05em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m?.mood || ''}</span>
              <span style={sx('font-size:10.5px;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m?.description || ''}</span>
              <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>{c.size > 1048576 ? (c.size / 1048576).toFixed(1) + 'M' : Math.max(1, Math.round(c.size / 1024)) + 'K'}</span>
              <span style={{ color: m?.analyzed ? 'var(--ok)' : 'var(--border-2)', fontSize: 11 }}>✓</span>
              <span style={{ color: m?.falUrl ? 'var(--ok)' : 'var(--border-2)', fontSize: 10, fontWeight: 700 }}>↗</span>
              <span onClick={e => { e.stopPropagation(); onFav && onFav(c); }} className="hAccent" style={{ ...sx('cursor:pointer;font-size:12px'), color: m?.fav ? 'var(--accent)' : 'var(--border-2)' }}>{m?.fav ? '★' : '☆'}</span>
              <span style={sx('display:flex;gap:9px;font-size:10px;align-items:center')} onClick={e => e.stopPropagation()}>
                {canAnalyze(c) && onAnalyze && <span onClick={() => onAnalyze(c)} className="hAccent" style={sx('color:var(--accent);cursor:pointer;font-weight:600')}>✦</span>}
                {canFal && onFal && <span onClick={() => onFal(c)} className="hFg" style={sx('color:var(--fg-faint);cursor:pointer;font-weight:700')}>↗</span>}
                {onDelete && <span onClick={() => onDelete(c)} className="hFgL" style={sx('color:var(--danger);cursor:pointer')}>✕</span>}
              </span>
            </div>
          );
        })}
        {!list.length && <div style={{ ...sx('padding:30px;text-align:center;color:var(--fg-faint);font-size:10.5px;font-weight:700;letter-spacing:.14em'), fontFamily: MONO }}>NOTHING MATCHES THESE FILTERS</div>}
        <div style={sx('display:flex;gap:14px;padding:7px 14px;font-size:9.5px;color:var(--fg-faint);border-top:1px solid var(--line)')}>
          <span><span style={{ fontFamily: MONO }}>J/K</span> move</span><span><span style={{ fontFamily: MONO }}>Enter</span> open</span><span><span style={{ fontFamily: MONO }}>.</span> favorite</span><span style={sx('margin-left:auto')}>{list.length} assets</span>
        </div>
      </div>
    );
  }
}

// ── floating bulk bar (F1.5) — reuses the Assets-tab pill pattern ──
export class BulkBar extends React.Component {
  constructor(props) { super(props); this.state = { menu: null, tagText: '' }; }
  menuBtn(id, label, items, onPick) {
    const open = this.state.menu === id;
    return (
      <div style={sx('position:relative')}>
        <div onClick={() => this.setState({ menu: open ? null : id })} className="hBgAccent" style={sx('padding:5px 11px;border-radius:7px;color:var(--fg-soft);cursor:pointer;white-space:nowrap')}>{label} ▾</div>
        {open && (
          <div style={sx('position:absolute;bottom:34px;left:0;min-width:150px;max-height:240px;overflow-y:auto;border:1px solid var(--border-3);border-radius:10px;background:var(--surface-2);box-shadow:0 16px 48px rgba(0,0,0,.7);animation:dl-in .12s ease-out;z-index:5')}>
            {items.map(it => (
              <div key={it.id} onClick={() => { this.setState({ menu: null }); onPick(it.id); }} className="hRow"
                style={sx('display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;font-size:11px;color:var(--fg-soft);border-bottom:1px solid var(--line);white-space:nowrap')}>
                {it.icon && <span style={{ color: it.color || 'var(--fg-muted)', fontSize: 10 }}>{it.icon}</span>}{it.label}
              </div>
            ))}
            {!items.length && <div style={sx('padding:10px 12px;font-size:10.5px;color:var(--fg-faint)')}>nothing here</div>}
          </div>
        )}
      </div>
    );
  }
  render() {
    const { count, onFav, onKind, onTags, onMove, onAnalyze, onFal, onCopy, onDelete, onClear, folders, copyTargets } = this.props;
    const S = this.state;
    return (
      <div style={sx('position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:8px 10px 8px 16px;border-radius:12px;background:var(--raise);border:1px solid var(--border-3);box-shadow:0 12px 32px rgba(0,0,0,.6);font-size:12px;z-index:45;animation:dl-in .15s ease-out')}>
        <span style={sx('font-weight:700;color:var(--accent);margin-right:8px;white-space:nowrap')}>{count} selected</span>
        {onFav && <div onClick={onFav} className="hBgAccent" style={sx('padding:5px 11px;border-radius:7px;color:var(--accent);cursor:pointer')}>★ Favorite</div>}
        {onKind && this.menuBtn('kind', 'Kind', [{ id: '', label: '— none —' }, ...ASSET_KINDS.map(k => ({ id: k.id, label: k.label, icon: k.icon, color: k.color }))], onKind)}
        {onTags && (S.menu === 'tags'
          ? <input autoFocus value={S.tagText} onChange={e => this.setState({ tagText: e.target.value })}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter' && S.tagText.trim()) { onTags(S.tagText); this.setState({ menu: null, tagText: '' }); }
              else if (e.key === 'Escape') this.setState({ menu: null, tagText: '' });
            }}
            placeholder="tags, comma, separated ⏎"
            style={{ ...sx('width:170px;background:var(--surface);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:10.5px;padding:5px 9px'), fontFamily: MONO }} />
          : <div onClick={() => this.setState({ menu: 'tags' })} className="hBgAccent" style={sx('padding:5px 11px;border-radius:7px;color:var(--fg-soft);cursor:pointer')}>+ Tags…</div>)}
        {onMove && this.menuBtn('move', 'Move to', [{ id: '', label: '(root)' }, ...(folders || []).map(f => ({ id: f, label: f }))], onMove)}
        {onAnalyze && <div onClick={onAnalyze} className="hBgAccent" style={sx('padding:5px 11px;border-radius:7px;color:var(--fg-soft);cursor:pointer;white-space:nowrap')}>✦ Analyze</div>}
        {onFal && <div onClick={onFal} className="hBgGreen" style={sx('padding:5px 11px;border-radius:7px;color:var(--ok);cursor:pointer;white-space:nowrap')}>↗ FAL</div>}
        {onCopy && this.menuBtn('copy', 'Copy to', copyTargets || [], onCopy)}
        {onDelete && <div onClick={onDelete} className="hBgRed" style={sx('padding:5px 11px;border-radius:7px;color:var(--danger);cursor:pointer')}>Delete</div>}
        <div style={sx('width:1px;height:16px;background:var(--border-2);margin:0 4px')} />
        <div onClick={onClear} className="hBgEsc" style={sx('padding:5px 9px;border-radius:7px;color:var(--fg-faint);cursor:pointer')}>Esc</div>
      </div>
    );
  }
}

// ── lightbox with metadata panel ──
export class Lightbox extends React.Component {
  constructor(props) {
    super(props);
    this.state = { edit: false, desc: '', tags: '', busy: false, falBusy: false, quickTag: '', renaming: false, renameText: '' };
    this._key = e => {
      if ((e.target.isContentEditable || (e.target.tagName || '').match(/INPUT|TEXTAREA|SELECT/i))) { if (e.key === 'Escape') e.target.blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘A/⌘F are select-all/find — never a paid Analyze/FAL push
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.props.onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.setState({ edit: false, renaming: false }); this.props.onNav(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.setState({ edit: false, renaming: false }); this.props.onNav(-1); }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); this.analyze(e.shiftKey); } // ⇧A = deep
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); this.sendFal(); }
      else if (e.key === '.') { e.preventDefault(); this.toggleFav(); }
    };
  }
  toggleFav() {
    const m = this.props.item.meta;
    this.patchMeta({ fav: !m?.fav }, !m?.fav ? '★ Favorited' : 'Removed from favorites');
  }
  async rename() {
    const { app, scope, item, onRenamed } = this.props;
    const newName = this.state.renameText.trim();
    this.setState({ renaming: false });
    if (!newName || newName === item.name) return;
    try {
      const saved = await api.renameAsset(scope, item.name, item.folder, newName);
      app.showToast('Renamed → ' + saved.name + ' — sidecar moved with it', 'var(--ok)');
      onRenamed && onRenamed(saved);
    } catch (e) { app.showToast('Rename failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async move(toFolder) {
    const { app, scope, item, onRenamed } = this.props;
    if ((item.folder || '') === toFolder) return;
    try {
      const saved = await api.moveAsset(scope, item.name, item.folder, toFolder);
      app.showToast(item.name + ' → ' + (toFolder || '(root)'), 'var(--ok)');
      onRenamed && onRenamed(saved);
    } catch (e) { app.showToast('Move failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); }
  // reset the edit/rename buffers whenever the displayed asset changes — otherwise navigating
  // (via the on-screen arrows, which don't clear state) while editing would save image A's
  // description/tags onto image B's .meta.md sidecar.
  componentDidUpdate(prev) {
    const p = prev.item, c = this.props.item;
    if (p && c && (p.name !== c.name || p.folder !== c.folder) && (this.state.edit || this.state.renaming))
      this.setState({ edit: false, renaming: false });
  }

  // `deep` forces the paid tier for this one image regardless of the Settings default —
  // it's the "read this frame properly so I can rebuild it" escape hatch.
  async analyze(deep = false) {
    const { app, scope, item, onMeta } = this.props;
    if (!canAnalyze(item) || this.state.busy || this.state.deepBusy) return;
    this.setState(deep ? { deepBusy: true } : { busy: true });
    try {
      const r = await api.analyzeAsset(scope, item.name, item.folder, deep ? { provider: 'fal', depth: 'deep' } : undefined);
      onMeta(item, r.meta);
      app.showToast(deep
        ? 'Deep analysis written — reconstruct prompt on ' + item.name + '.meta.md'
        : 'Vision metadata written to ' + item.name + '.meta.md', 'var(--ok)');
    } catch (e) { app.showToast('Analysis failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState(deep ? { deepBusy: false } : { busy: false });
  }
  async sendFal() {
    const { app, scope, item, onMeta } = this.props;
    if (this.state.falBusy) return;
    this.setState({ falBusy: true });
    try {
      const r = await api.sendFal(scope, item.name, item.folder);
      onMeta(item, r.meta);
      if (navigator.clipboard) navigator.clipboard.writeText(r.url).catch(() => { });
      app.showToast('On fal storage — URL copied & saved to sidecar', 'var(--ok)');
    } catch (e) {
      const msg = (e.message || '').includes('api 502') || (e.message || '').includes('api 400') ? 'FAL push failed — check the FAL key in Settings' : 'FAL push failed — ' + (e.message || '');
      app.showToast(msg, 'var(--danger)');
    }
    this.setState({ falBusy: false });
  }
  async patchMeta(patch, toastText) {
    const { app, scope, item, onMeta } = this.props;
    try {
      const r = await api.saveMeta(scope, item.name, item.folder, patch);
      onMeta(item, r.meta);
      if (toastText) app.showToast(toastText, 'var(--ok)');
    } catch { app.showToast('Could not save metadata', 'var(--danger)'); }
  }
  async saveEdit() {
    await this.patchMeta({
      description: this.state.desc,
      tags: this.state.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    }, 'Metadata saved');
    this.setState({ edit: false });
  }
  addQuickTag() {
    const t = this.state.quickTag.trim().toLowerCase();
    if (!t) return;
    const cur = this.props.item.meta?.tags || [];
    if (!cur.includes(t)) this.patchMeta({ tags: [...cur, t] });
    this.setState({ quickTag: '' });
  }
  removeTag(t) {
    const cur = this.props.item.meta?.tags || [];
    this.patchMeta({ tags: cur.filter(x => x !== t) });
  }

  render() {
    const { app, scope, item, onClose, onNav, onTag } = this.props;
    const S = this.state;
    const url = assetUrl(scope, item.name, item.folder);
    const m = item.meta;
    const kd = m && kindDef(m.kind);
    const label = t => <div style={sx('font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:7px')}>{t}</div>;
    return (
      <div style={sx('position:fixed;inset:0;z-index:75;background:rgba(4,5,7,.94);backdrop-filter:blur(8px);display:flex;animation:dl-in .16s ease-out')} onClick={onClose}>
        {/* image stage */}
        <div style={sx('flex:1;display:flex;align-items:center;justify-content:center;min-width:0;padding:34px;position:relative')}>
          <div onClick={e => { e.stopPropagation(); onNav(-1); }} className="hBg" style={sx('position:absolute;left:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:99px;background:rgba(20,22,27,.8);border:1px solid var(--border-2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fg-soft);font-size:15px;z-index:2')}>←</div>
          {/* stage video autoplays with sound (muted={false}) exactly as before — the metadata
              rail is this lightbox's own surface, so only the media branch is shared */}
          <RenderMedia src={url} kind={item.type} fit="contain" controls autoPlay muted={false}
            alt={item.name} onClick={e => e.stopPropagation()}
            style={sx('max-width:100%;max-height:100%;border-radius:10px;box-shadow:0 30px 90px rgba(0,0,0,.7)')} />
          <div onClick={e => { e.stopPropagation(); onNav(1); }} className="hBg" style={sx('position:absolute;right:12px;top:50%;transform:translateY(-50%);width:38px;height:38px;border-radius:99px;background:rgba(20,22,27,.8);border:1px solid var(--border-2);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fg-soft);font-size:15px;z-index:2')}>→</div>
        </div>
        {/* metadata rail */}
        <div onClick={e => e.stopPropagation()} style={sx('width:370px;flex:none;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column')}>
          <div style={sx('display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border);flex:none')}>
            {S.renaming
              ? <input autoFocus value={S.renameText} onChange={e => this.setState({ renameText: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.rename(); else if (e.key === 'Escape') this.setState({ renaming: false }); }}
                onBlur={() => this.rename()}
                style={{ ...sx('flex:1;background:var(--ink);border:1px solid var(--accent-60);border-radius:6px;color:var(--fg);padding:4px 8px'), fontFamily: MONO, fontSize: 11.5 }} />
              : <span onClick={() => this.setState({ renaming: true, renameText: item.name })} title="Click to rename"
                className="hAccent" style={{ ...sx('flex:1;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text'), fontFamily: MONO, fontSize: 11.5, fontWeight: 600 }}>{item.name} <span style={sx('color:var(--fg-faint);font-size:9px')}>✎</span></span>}
            <span onClick={() => this.toggleFav()} title="Favorite (.)" className="hAccent"
              style={{ ...sx('font-size:15px;cursor:pointer;flex:none;line-height:1'), color: m?.fav ? 'var(--accent)' : 'var(--border-3)' }}>{m?.fav ? '★' : '☆'}</span>
            <span onClick={onClose} className="hFgL" style={sx('font-size:12px;color:var(--fg-faint);cursor:pointer;flex:none')}>✕ Esc</span>
          </div>
          <div style={sx('flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:18px')}>

            {/* entity kind */}
            <div>
              {label('KIND — what is this asset?')}
              <div style={sx('display:flex;gap:5px;flex-wrap:wrap')}>
                {ASSET_KINDS.map(k => {
                  const on = (m?.kind || '') === k.id;
                  return (
                    <span key={k.id} onClick={() => this.patchMeta({ kind: on ? '' : k.id })}
                      style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.05em;border-radius:99px;padding:4px 12px;cursor:pointer;text-transform:uppercase'), color: on ? 'var(--fg)' : k.color, background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'rgba(255,255,255,.14)') }}>
                      {k.icon} {k.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {(!m || !m.description) && canAnalyze(item) && (
              <div style={sx('border:1px dashed var(--accent-35);border-radius:12px;padding:16px;text-align:center')}>
                <div style={sx('font-size:12px;color:var(--fg-soft);font-weight:600')}>No vision metadata yet</div>
                <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:4px;line-height:1.5')}>Analysis writes a description, tags, palette and mood into a portable .meta.md sidecar. Deep additionally reverse-engineers the frame into a prompt you can regenerate from.</div>
                <div style={sx('display:flex;gap:8px;justify-content:center;margin-top:12px')}>
                  <div onClick={() => this.analyze()} className="hBtnAccent"
                    style={{ ...sx('display:inline-flex;align-items:center;gap:8px;padding:7px 16px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer'), background: S.busy ? 'var(--accent-12)' : 'var(--accent)', color: S.busy ? 'var(--accent)' : 'var(--on-accent)' }}>
                    {S.busy ? 'Reading image…' : '✦ Analyze'} <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: .7 }}>A</span>
                  </div>
                  <div onClick={() => this.analyze(true)} className="hBd"
                    style={{ ...sx('display:inline-flex;align-items:center;gap:8px;padding:7px 16px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;border:1px solid var(--accent-35)'), color: 'var(--accent)', animation: S.deepBusy ? 'dl-pulse 1.1s infinite' : 'none' }}>
                    {S.deepBusy ? 'Reading closely…' : '✦✦ Deep'} <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: .7 }}>⇧A</span>
                  </div>
                </div>
              </div>
            )}

            {m && m.description && !S.edit && (
              <div>
                {label('DESCRIPTION')}
                <div style={sx('font-size:13px;line-height:1.65;color:var(--fg)')}>{m.description}</div>
                {m.mood && <div style={sx('display:inline-flex;margin-top:9px;font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--fg-muted);border:1px solid var(--accent-35);border-radius:99px;padding:2px 10px;text-transform:uppercase')}>{m.mood}</div>}
              </div>
            )}

            {/* tags — always available, quick add */}
            {!S.edit && (
              <div>
                {label('TAGS — click to browse · ✕ to remove')}
                <div style={sx('display:flex;gap:5px;flex-wrap:wrap;align-items:center')}>
                  {(m?.tags || []).map(t => (
                    <span key={t} className="hBdAccentChip" style={{ ...sx('display:inline-flex;align-items:center;gap:6px;font-size:10.5px;color:var(--fg-soft);border:1px solid var(--border-2);border-radius:99px;padding:3px 5px 3px 11px'), fontFamily: MONO }}>
                      <span onClick={() => { onTag && onTag(t); onClose(); }} style={sx('cursor:pointer')}>{t}</span>
                      <span onClick={() => this.removeTag(t)} style={sx('cursor:pointer;color:var(--fg-faint);font-size:9px;padding:0 4px')}>✕</span>
                    </span>
                  ))}
                  <input value={S.quickTag} onChange={e => this.setState({ quickTag: e.target.value })}
                    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.addQuickTag(); }}
                    placeholder="+ tag ⏎"
                    style={{ ...sx('width:76px;background:transparent;border:1px dashed var(--border-2);border-radius:99px;color:var(--fg-muted);font-size:10.5px;padding:3px 10px'), fontFamily: MONO }} />
                </div>
              </div>
            )}

            {m && m.palette && m.palette.length > 0 && !S.edit && (
              <div>
                {label('PALETTE — click to copy')}
                <div style={sx('display:flex;gap:8px')}>
                  {m.palette.map((p, i) => (
                    <div key={i} onClick={() => { navigator.clipboard && navigator.clipboard.writeText(p).catch(() => { }); app.showToast(p + ' copied', 'var(--accent)'); }}
                      style={sx('cursor:pointer;text-align:center')}>
                      <div style={{ ...sx('width:42px;height:42px;border-radius:9px;border:1px solid rgba(255,255,255,.12)'), background: p }} />
                      <div style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', marginTop: 4 }}>{p}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {m && m.reconstruct && !S.edit && (
              <div>
                {label('RECONSTRUCT — full regeneration prompt · click to copy')}
                <div onClick={() => { navigator.clipboard && navigator.clipboard.writeText(m.reconstruct).catch(() => { }); app.showToast('Reconstruct prompt copied — paste it into any image model', 'var(--accent)'); }}
                  className="hBdAccentChip"
                  style={{ ...sx('font-size:11.5px;line-height:1.7;color:var(--fg-soft);background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:13px 15px;cursor:pointer;white-space:pre-wrap'), fontFamily: MONO }}>
                  {m.reconstruct}
                </div>
                {m.visionModel && <div style={{ ...sx('font-size:9.5px;color:var(--fg-faint);margin-top:6px'), fontFamily: MONO }}>read by {m.visionModel}</div>}
              </div>
            )}

            {!S.edit && (
              <div style={sx('display:flex;gap:12px;font-size:11px;flex-wrap:wrap')}>
                <span onClick={() => this.setState({ edit: true, desc: m?.description || '', tags: (m?.tags || []).join(', ') })} className="hAccent" style={sx('color:var(--accent);font-weight:600;cursor:pointer')}>Edit metadata</span>
                {canAnalyze(item) && m?.description && <span onClick={() => this.analyze()} className="hFg" style={{ ...sx('color:var(--fg-faint);cursor:pointer'), animation: S.busy ? 'dl-pulse 1.1s infinite' : 'none' }}>{S.busy ? 'Re-reading…' : '✦ Re-analyze'}</span>}
                {canAnalyze(item) && m?.description && <span onClick={() => this.analyze(true)} className="hAccent" style={{ ...sx('color:var(--accent);font-weight:600;cursor:pointer'), animation: S.deepBusy ? 'dl-pulse 1.1s infinite' : 'none' }}>{S.deepBusy ? 'Reading closely…' : (m?.reconstruct ? '✦✦ Re-run deep' : '✦✦ Deep analyze')}</span>}
                {canAnalyze(item) && (
                  <span onClick={() => { onClose(); app.go('tools', { toolsSel: 'look', lookAsset: { scope, name: item.name, folder: item.folder || '' } }); }}
                    className="hFg" style={sx('color:var(--fg-muted);cursor:pointer;font-weight:600')}>✦ Extract look</span>
                )}
                <span onClick={async () => { try { await api.revealAsset(scope, item.name, item.folder); } catch { app.showToast('Could not reveal file', 'var(--danger)'); } }}
                  className="hFg" style={sx('color:var(--fg-faint);cursor:pointer')}>⌖ Reveal in Finder</span>
              </div>
            )}

            {S.edit && (
              <>
                <div>
                  {label('DESCRIPTION')}
                  <textarea value={S.desc} onChange={e => this.setState({ desc: e.target.value })} autoFocus
                    style={sx('width:100%;box-sizing:border-box;height:90px;resize:vertical;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12.5px;line-height:1.6;padding:9px 11px')} />
                </div>
                <div>
                  {label('TAGS (COMMA-SEPARATED)')}
                  <input value={S.tags} onChange={e => this.setState({ tags: e.target.value })}
                    style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:12px;padding:8px 11px')} />
                </div>
                <div style={sx('display:flex;gap:10px;justify-content:flex-end;font-size:11.5px')}>
                  <span onClick={() => this.setState({ edit: false })} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer;padding:5px 8px')}>Cancel</span>
                  <span onClick={() => this.saveEdit()} className="hBtnAccent" style={sx('padding:5px 14px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer')}>Save</span>
                </div>
              </>
            )}

            {/* FAL */}
            <div style={sx('border-top:1px solid var(--line);padding-top:14px')}>
              {label('FAL STORAGE — reference this asset in generations')}
              {m && m.falUrl ? (
                <div>
                  <div onClick={() => { navigator.clipboard && navigator.clipboard.writeText(m.falUrl).catch(() => { }); app.showToast('fal URL copied', 'var(--accent)'); }}
                    className="hBd" style={{ ...sx('padding:8px 11px;border:1px solid rgba(63,207,142,.35);border-radius:8px;background:rgba(63,207,142,.05);color:var(--ok);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>{m.falUrl}</div>
                  <div style={sx('display:flex;gap:12px;margin-top:6px;font-size:10.5px')}>
                    <span style={sx('color:var(--fg-faint)')}>pushed {m.falAt}</span>
                    <span onClick={() => this.sendFal()} className="hFg" style={{ ...sx('color:var(--fg-faint);cursor:pointer'), animation: S.falBusy ? 'dl-pulse 1.1s infinite' : 'none' }}>{S.falBusy ? 'Re-pushing…' : 'Re-push'}</span>
                  </div>
                </div>
              ) : (
                <div onClick={() => this.sendFal()} className="hBd"
                  style={{ ...sx('display:inline-flex;align-items:center;gap:8px;padding:7px 15px;border-radius:8px;font-weight:700;font-size:11.5px;cursor:pointer'), border: '1px solid ' + (app.state.falReady ? 'rgba(63,207,142,.45)' : 'var(--border-2)'), color: app.state.falReady ? 'var(--ok)' : 'var(--fg-faint)' }}>
                  {S.falBusy ? <><span style={sx('width:7px;height:7px;border-radius:99px;background:var(--ok);animation:dl-pulse 1s infinite')} />Uploading…</> : <>↗ Send to fal storage <span style={{ fontFamily: MONO, fontSize: 9.5, opacity: .7 }}>F</span></>}
                </div>
              )}
              {!app.state.falReady && !(m && m.falUrl) && <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:5px')}>Add a FAL key in Settings to enable.</div>}
            </div>

            <div style={sx('border-top:1px solid var(--line);padding-top:12px;display:grid;grid-template-columns:74px 1fr;row-gap:7px;font-size:10.5px')}>
              <span style={sx('color:var(--fg-faint)')}>Type</span><span style={sx('color:var(--fg-muted);text-transform:uppercase')}>{item.type}{kd ? ' · ' + kd.label : ''}</span>
              <span style={sx('color:var(--fg-faint)')}>Size</span><span style={{ fontFamily: MONO, color: 'var(--fg-muted)' }}>{item.size > 1048576 ? (item.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(item.size / 1024)) + ' KB'}</span>
              <span style={sx('color:var(--fg-faint)')}>Board</span>
              {this.props.folders
                ? <select value={item.folder || ''} onChange={e => this.move(e.target.value)}
                  style={{ ...sx('background:var(--ink);border:1px solid var(--border-2);border-radius:6px;color:var(--fg-muted);padding:3px 6px;max-width:180px'), fontFamily: MONO, fontSize: 10 }}>
                  <option value="">(root)</option>
                  {this.props.folders.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                : <span style={{ fontFamily: MONO, color: 'var(--fg-muted)' }}>{item.folder || '(root)'}</span>}
              {m && m.analyzed && <><span style={sx('color:var(--fg-faint)')}>Analyzed</span><span style={{ fontFamily: MONO, color: 'var(--fg-muted)' }}>{m.analyzed}</span></>}
              <span style={sx('color:var(--fg-faint)')}>Sidecar</span><span style={{ ...sx('color:var(--fg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>{item.name}.meta.md</span>
            </div>
            {this.props.actions}
          </div>
        </div>
      </div>
    );
  }
}
