// Cmd+K command palette (F4) — custom, no dependency. Groups: Jump · Shots · Assets ·
// Actions. Fuzzy word-prefix match, ↑↓/Enter/Esc, recent-first for jumps.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';


function fuzzy(hay, q) {
  if (!q) return true;
  const h = hay.toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => h.includes(w));
}

export default class Palette extends React.Component {
  constructor(props) {
    super(props);
    this.state = { q: '', ix: 0, searchResults: [] };
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
    };
  }
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); clearTimeout(this._searchT); }

  // Structured server search (Phase 8/9) — fires for typed filters (contains ':') or any 2+ char
  // query, and its results carry exact location objects the palette navigates to.
  onQuery(q) {
    this.setState({ q, ix: 0 });
    clearTimeout(this._searchT);
    if (q.trim().length < 2) { this.setState({ searchResults: [] }); return; }
    this._searchT = setTimeout(() => {
      api.search(q).then(r => this.setState({ searchResults: (r.results || []).slice(0, 12) })).catch(() => { });
    }, 140);
  }
  goResult(r) { this.props.onClose(); this.props.app.applyLocation(r.location); }

  items() {
    const { app } = this.props;
    const S = app.state;
    const q = this.state.q.trim();
    const out = [];
    const add = (group, label, sub, go, mono) => out.push({ group, label, sub, go, mono });

    // Structured search results (server) — exact deep links via location objects. Shown first when
    // the query has a typed filter (key:value); otherwise below the local jumps.
    const structured = q.includes(':');
    if (structured) this.state.searchResults.forEach(r => add('SEARCH', r.title, r.sub, () => this.goResult(r), true));

    // Jump
    [['Inbox', () => app.openInbox()], ['Queue', () => app.go('queue')],
    ['Home', () => app.go('home')], ['Library', () => app.go('library')], ['Tools', () => app.go('tools', { toolsSel: null })],
    ['Generate', () => app.openGenerate(null)], ['Prompt Builder', () => app.go('tools', { toolsSel: 'builder' })],
    ['Look Extractor', () => app.go('tools', { toolsSel: 'look' })], ['Shot Types', () => app.go('tools', { toolsSel: 'shottypes' })],
    ['Transcriber', () => app.go('tools', { toolsSel: 'transcribe' })], ['Model Catalog', () => app.go('tools', { toolsSel: 'models' })],
    ['Remotion', () => app.go('remotion')], ['Style Locks', () => app.go('tools', { toolsSel: 'stylelocks' })],
    ['Skills', () => app.go('skills')], ['Costs', () => app.go('costs')], ['Trash', () => app.go('trash')], ['Settings', () => app.go('settings')]]
      .forEach(([l, go]) => fuzzy(l, q) && add('JUMP', l, '', go));
    S.projects.forEach(p => {
      if (fuzzy(p.name, q)) add('JUMP', p.name, 'project', () => app.openProj(p.id));
      ['story', 'generate', 'assets', 'references'].forEach(tab => {
        if (q && fuzzy(p.name + ' ' + tab, q)) add('JUMP', p.name + ' · ' + tab, 'project tab', () => app.openProj(p.id, tab));
      });
    });
    // Shots (current project first, then all)
    const shots = (S.shots || []).slice().sort((a, b) => (a.proj === S.proj ? -1 : 0) - (b.proj === S.proj ? -1 : 0));
    shots.forEach(sh => {
      if (out.length > 60) return;
      if (fuzzy(sh.id + ' ' + sh.title + ' ' + (sh.tags || []).join(' '), q) && (q || sh.proj === S.proj))
        add('SHOTS', sh.id + ' · ' + sh.title, app.projDef(sh.proj).name, () => app.openProj(sh.proj, 'story'), true);
    });
    // Assets (by name/tag/kind)
    if (q) {
      const pool = [];
      (S.library.items || []).forEach(c => pool.push({ ...c, scope: 'library', from: 'Library' }));
      S.projects.forEach(p => ((p.context || {}).items || []).forEach(c => pool.push({ ...c, scope: p.id, from: p.name })));
      pool.forEach(c => {
        if (out.length > 80) return;
        if ((c.type === 'image' || c.type === 'video') && fuzzy(c.name + ' ' + (c.meta?.tags || []).join(' ') + ' ' + (c.meta?.kind || ''), q))
          add('ASSETS', c.name, c.from + (c.meta?.kind ? ' · ' + c.meta.kind : ''), () => {
            if (c.scope === 'library') app.go('library');
            else app.openProj(c.scope, 'assets');
          }, true);
      });
    }
    // Items — media pages. DEV-123: this group came from the topbar search, which was the only
    // surface that could find an item BY ITS PROMPT. Folding it in here is what let that second
    // search UI be deleted rather than merely hidden. Same matcher (name / label / prompt), same
    // destination (the item page), same 8-hit ceiling it had.
    if (q) {
      let n = 0;
      (S.items || []).forEach(x => {
        if (x.trashed || n >= 8) return;
        if (fuzzy(x.name + ' ' + (x.label || '') + ' ' + app.promptOf(x), q)) {
          n++;
          add('ITEMS', x.name, app.projDef(x.proj).name + (x.type ? ' · ' + x.type : ''), () => app.openItem(x.proj, x.id), true);
        }
      });
    }

    // Actions
    [['Keyboard shortcuts', () => app.setState({ cheatOpen: true, paletteOpen: false })],
    ['New project', () => app.openNewProject()],
    ['New shot' + (S.proj ? ' in ' + app.projDef(S.proj).name : ''), () => S.proj && app.openProj(S.proj, 'story')],
    ['Generate…' + (S.proj ? ' (' + app.projDef(S.proj).name + ')' : ''), () => app.openGenerate(null)],
    ['Project settings…' + (S.proj ? ' (' + app.projDef(S.proj).name + ')' : ''), () => S.proj && app.openProjSettings()],
    ['Transcribe audio', () => app.go('tools', { toolsSel: 'transcribe' })],
    ['Style locks: manage', () => app.go('tools', { toolsSel: 'stylelocks' })],
    ['Apply style lock…', () => app.openStyleLockPicker(S.proj)],
    ['Remember for ' + (S.proj ? app.projDef(S.proj).name : 'a project') + '…', () => app.openQuickNote()],
    ['Open References → Memory' + (S.proj ? ' (' + app.projDef(S.proj).name + ')' : ''), () => app.openMemoryTab()],
    ['Open Remotion library', () => app.go('remotion')],
    ['Export selects' + (S.proj ? ' (' + app.projDef(S.proj).name + ')' : ''), () => S.proj && api.exportSelects(S.proj).then(r => app.showToast('Selects exported — ' + r.count + ' clips (' + r.symlinked + ' linked, ' + r.copied + ' copied)', 'var(--ok)')).catch(e => app.showToast('Export failed — ' + (e.message || ''), 'var(--danger)'))]]
      .forEach(([l, go]) => fuzzy(l, q) && add('ACTIONS', l, '', go));

    // free-text server results (entities across brief/story/prompts/notes/tags) below the local hits
    if (!structured && q.length >= 2) this.state.searchResults.forEach(r => add('SEARCH', r.title, r.sub, () => this.goResult(r), true));

    return out.slice(0, 40); // scrollable — no artificial 14-row cap (Phase 8)
  }

  render() {
    const { onClose } = this.props;
    const S = this.state;
    const list = this.items();
    let lastGroup = null;
    return (
      <div onClick={onClose} style={sx('position:fixed;inset:0;z-index:95;background:rgba(5,6,8,.65);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding-top:14vh')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:560px;border-radius:14px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8);overflow:hidden;animation:dl-in .12s ease-out')}>
          <div style={sx('display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)')}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="var(--fg-faint)" strokeWidth="1.5" /><path d="M9.5 9.5L13 13" stroke="var(--fg-faint)" strokeWidth="1.5" /></svg>
            <input autoFocus value={S.q} onChange={e => this.onQuery(e.target.value)}
              placeholder="Jump, search (p:neon rating:>=4), find a shot/asset, run an action…"
              style={sx('flex:1;background:transparent;border:none;color:var(--fg);font-size:13px')} />
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 6px' }}>esc</span>
          </div>
          <div style={sx('max-height:380px;overflow-y:auto;padding-bottom:6px')}>
            {list.map((it, i) => {
              const head = it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              const on = i === Math.min(S.ix, list.length - 1);
              return (
                <React.Fragment key={i}>
                  {head && <div style={sx('padding:9px 16px 4px;font-size:9px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>{head}</div>}
                  <div onClick={() => { this.props.onClose(); it.go(); }} onMouseEnter={() => this.setState({ ix: i })}
                    style={{ ...sx('display:flex;align-items:center;gap:10px;padding:8px 16px;cursor:pointer'), background: on ? 'var(--raise)' : 'transparent', boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
                    <span style={{ ...sx('font-size:12.5px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: it.mono ? MONO : 'inherit', fontSize: it.mono ? 11.5 : 12.5 }}>{it.label}</span>
                    <span style={sx('margin-left:auto;font-size:10.5px;color:var(--fg-faint);flex:none')}>{it.sub}</span>
                  </div>
                </React.Fragment>
              );
            })}
            {!list.length && <div style={{ ...sx('padding:22px 16px;font-size:10.5px;letter-spacing:.08em;color:var(--fg-faint)'), fontFamily: MONO }}>NOTHING MATCHES — TRY A SHOT ID, TAG, OR PAGE NAME</div>}
          </div>
          <div style={sx('display:flex;gap:14px;padding:8px 16px;border-top:1px solid var(--border);font-size:9.5px;color:var(--fg-faint)')}>
            <span><span style={{ fontFamily: MONO }}>↑↓</span> navigate</span><span><span style={{ fontFamily: MONO }}>⏎</span> open</span><span style={sx('margin-left:auto')}><span style={{ fontFamily: MONO }}>⌘K</span> toggle</span>
          </div>
        </div>
      </div>
    );
  }
}
