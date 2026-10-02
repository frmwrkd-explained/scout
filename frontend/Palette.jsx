// frontend/Palette.jsx — ⌘K, item 11.
//
// This was FrameForge's command palette — `app.openInbox`, `app.projDef`, `S.shots`, `S.library` —
// none of which exist on Scout's App, so it threw on the first keystroke. It was also never
// mounted or bound anywhere, so nobody had noticed. Rewritten against the app that is actually
// here: `App.go(screen, arg)` / `App.openPath(path)` / `App.pickCollection(id)`, and `GET
// /api/search`, which indexes records AND memory and returns a `location` object per hit
// (backend/search.mjs) — the same route `docs/decisions.md` fixed to stop lying to agents about
// what it could find, now finally used by the one human-facing search surface too.
//
// PROPS
//   onClose()                  Esc, a backdrop click, picking a result.
//   onGo(screen)                navigate to a rail screen.
//   onOpenPath(path)            open a `.md` on the document surface (Law 8).
//   onPickCollection(id)        open a collection.
//   collections  [{id,name}]    from App.state.collections — the jump list under COLLECTIONS.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

function fuzzy(hay, q) {
  if (!q) return true;
  const h = hay.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => h.includes(w));
}

// The rail's own screens, in the order she meets them there — a command IS a jump, so there is
// only one list of "places in this app" (Law 10: Rail.jsx is the other reader of this same idea,
// not a second one).
const SCREENS = [
  ['Today', 'today'], ['Admin', 'admin'], ['Needs you', 'decide'], ['Project', 'project'],
  ['Paperclip board', 'paperclip'],
  ['Goals', 'goals'], ['Territory', 'territory'], ['Playbook', 'playbook'],
  ['What they know', 'knows'], ['Assistants', 'assistants'], ['Hire an assistant', 'hire'],
  ['Whiteboard', 'board'], ['Files on disk', 'files'], ['Settings', 'settings'],
];

export default class Palette extends React.Component {
  constructor(props) {
    super(props);
    this.state = { q: '', ix: 0, results: [] };
    this._key = e => {
      const list = this.items();
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.props.onClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ ix: Math.min(list.length - 1, s.ix + 1) })); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); this.setState(s => ({ ix: Math.max(0, s.ix - 1) })); }
      else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        const it = list[Math.min(this.state.ix, list.length - 1)];
        if (it) { this.props.onClose(); it.go(); }
      }
      // The same chord that opened it closes it — a second ⌘K while typing must not stack a
      // second palette or leave this one deaf to Esc.
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); this.props.onClose(); }
    };
  }
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); clearTimeout(this._searchT); }

  // `GET /api/search` for anything two characters or longer — cheap enough that a debounce is
  // only about not hammering the route on every keystroke, not about the query being expensive.
  onQuery(q) {
    this.setState({ q, ix: 0 });
    clearTimeout(this._searchT);
    if (q.trim().length < 2) { this.setState({ results: [] }); return; }
    this._searchT = setTimeout(() => {
      api.search(q).then(r => this.setState({ results: r.results || [] })).catch(() => {});
    }, 140);
  }

  goResult(r) {
    this.props.onClose();
    const path = r.location && r.location.path;
    if (path) this.props.onOpenPath(path);
  }

  items() {
    const { collections = [], onGo, onPickCollection } = this.props;
    const q = this.state.q.trim();
    const out = [];
    const add = (group, label, sub, go, monoLabel) => out.push({ group, label, sub, go, mono: monoLabel });

    // search results first — a typed filter (`status:shortlist`, `collection:guest`) or two-plus
    // characters of free text means she is looking for something specific, not browsing screens.
    this.state.results.forEach(r => add('SEARCH', r.title, r.sub, () => this.goResult(r), true));

    SCREENS.forEach(([label, key]) => { if (fuzzy(label, q) && onGo) add('JUMP', label, '', () => onGo(key)); });

    collections.forEach(c => {
      if (fuzzy('#' + c.id + ' ' + (c.name || ''), q) && onPickCollection) {
        add('COLLECTIONS', '#' + c.id, c.name && c.name !== c.id ? c.name : '', () => onPickCollection(c.id), true);
      }
    });

    return out.slice(0, 60);
  }

  render() {
    const { onClose } = this.props;
    const S = this.state;
    const list = this.items();
    let lastGroup = null;
    return (
      <div onClick={onClose} style={sx('position:fixed;inset:0;z-index:95;background:rgba(5,6,8,.65);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:560px;max-width:calc(100vw - 40px);border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8);overflow:hidden')}>
          <div style={sx('display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)')}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="var(--fg-faint)" strokeWidth="1.5" /><path d="M9.5 9.5L13 13" stroke="var(--fg-faint)" strokeWidth="1.5" /></svg>
            <input autoFocus value={S.q} onChange={e => this.onQuery(e.target.value)}
              placeholder="Jump to a screen, search records and memory (status:shortlist, collection:guest)…"
              style={{ ...sx('flex:1;background:transparent;border:none;font-size:13px'), color: 'var(--fg)' }} />
            <span style={{ ...mono('font-size:9.5px'), color: 'var(--fg-faint)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 6px' }}>esc</span>
          </div>
          <div style={sx('max-height:380px;overflow-y:auto;padding-bottom:6px')}>
            {list.map((it, i) => {
              const head = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              const on = i === Math.min(S.ix, list.length - 1);
              return (
                <React.Fragment key={it.group + i}>
                  {head && <div style={{ ...sx('padding:9px 16px 4px;font-size:9px;font-weight:700;letter-spacing:.16em'), color: 'var(--fg-muted)' }}>{head}</div>}
                  <div onClick={() => { onClose(); it.go(); }} onMouseEnter={() => this.setState({ ix: i })}
                    style={{ ...sx('display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer'), background: on ? 'var(--raise)' : 'transparent', boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
                    <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: it.mono ? MONO : 'inherit', fontSize: it.mono ? 11.5 : 12.5, color: 'var(--fg)' }}>{it.label}</span>
                    <span style={{ ...mono('margin-left:auto;font-size:10.5px;flex:none'), color: 'var(--fg-faint)' }}>{it.sub}</span>
                  </div>
                </React.Fragment>
              );
            })}
            {!list.length && <div style={{ ...mono('padding:22px 16px;font-size:10.5px;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>NOTHING MATCHES — TRY A SCREEN NAME, A COLLECTION, OR A RECORD</div>}
          </div>
          <div style={{ ...sx('display:flex;gap:14px;padding:8px 16px;border-top:1px solid var(--border);font-size:9.5px'), color: 'var(--fg-faint)' }}>
            <span><span style={{ fontFamily: MONO }}>↑↓</span> navigate</span>
            <span><span style={{ fontFamily: MONO }}>⏎</span> open</span>
            <span style={sx('margin-left:auto')}><span style={{ fontFamily: MONO }}>⌘K</span> toggle</span>
          </div>
        </div>
      </div>
    );
  }
}
