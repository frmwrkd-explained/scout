// Assets = production building blocks: Cast · Locations · Wardrobe · Props (+ user folders).
// Concrete, reusable elements you generate/curate and re-use across shots — the counterpart to
// References ("what we look up to"). Both surfaces share BoardGrid (exported below), which wraps the
// Moodboard.jsx grid primitives (Mosaic · Lightbox · BulkBar · BoardControls) so the boards behave
// identically everywhere the user already likes them.
//
// Folder classification (References vs Assets): folders have no on-disk sidecar, so a board's side of
// the split is decided by a naming-convention map (cast/locations/wardrobe/props/… → asset; everything
// else → reference) with a per-folder override persisted server-side in context/_folders.md
// (see backend/memory.mjs · /api/folders/:pid). folderKind() is the single source of truth for the UI.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Mosaic, Lightbox, BoardControls, AssetList, BulkBar, collectTags, collectKinds, matchesFilter, canAnalyze, selKey } from './Moodboard';
import { VideoImport } from './VideoImport';
import { DEFAULT_PREVIEW_MODEL } from './models';
import Composer from './Composer';
import { buildEntityPool } from './entities';
import { MONO } from './tokens';
// The facade. Imported LOCALLY and re-exported explicitly, because `export … from` does not bind
// the names into this module's scope — this file calls assetFoldersOf() itself, and the aggregate
// form crashed it at render with "assetFoldersOf is not defined". Import, then export.
import { ASSET_KIND_FOLDERS, folderKind, assetFoldersOf, refFoldersOf } from '../shared/assetKinds.mjs';
// Re-exported for the four modules that already import them from here (App, References,
// SheetComposer, Story). The facade carries exactly what has a consumer — `assetKindOf` and
// friends are NOT re-exported, because nothing imports them from this path and new code should
// reach for shared/assetKinds.mjs directly, as Board.jsx and backend/board.mjs do.
export { ASSET_KIND_FOLDERS, folderKind, assetFoldersOf, refFoldersOf };


// tiny fetch helpers — api.js is owned by another agent; the integrator can promote these to
// api.folderKinds()/api.setFolderKind()/api.enhance() (the routes are backend/index.mjs, backend/enhance.mjs).
export const jget = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(r.status)));
export const jsend = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => (r.ok ? r.json() : Promise.reject(r.status)));

// canonical production-asset boards — matched case-insensitively against real folder names.
// DECLARED IN shared/assetKinds.mjs, re-exported here. The table moved so backend/board.mjs could
// group a canvas by cast/location/prop without importing a .jsx module; this is a facade, exactly
// like frontend/models.js over modelCatalog.js. Do not re-declare it here.

const isMedia = c => c.type === 'image' || c.type === 'video';

// ── shared board surface — used by References→Moods and by AssetBoards ─────────────────────────
// Props: app, proj, folders(names[]), showRoot?, rootLabel?, emptyText?, onGenerate?(folder,prompt,level),
//        onReclass?(folder,kind), railLabel?. Owns filters, selection, bulk ops, lightbox and the
//        capture-phase keyboard (copied from Story.jsx's guard): arrows move, Enter opens, . favorites,
//        e inline-renames — inert while typing, dormant while the lightbox owns the keyboard.
export class BoardGrid extends React.Component {
  constructor(props) {
    super(props);
    this.state = { size: 42, q: '', tag: '', kind: '', fav: false, view: 'board',
      sel: {}, lightbox: null, analyzing: {}, cur: 0, focus: null,
      rename: null, gen: null, genPrompt: '', genLevel: 'none', vimport: null };
    this.fileRef = React.createRef();
    this._up = '';
    this._key = e => this.onKey(e);
  }
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); }

  scope() { return this.props.proj.id; }
  ctx() { return this.props.proj.context && this.props.proj.context.items ? this.props.proj.context : { folders: [], items: [] }; }
  allItems() { return this.ctx().items || []; }
  // folders to render (respecting the rail focus)
  shownFolders() {
    const S = this.state;
    const list = [...this.props.folders];
    if (this.props.showRoot) list.push('');
    return S.focus != null ? list.filter(f => f === S.focus) : list;
  }
  inFolder(f) { return this.allItems().filter(i => (i.folder || '') === f && isMedia(i)); }
  visIn(f) { return this.inFolder(f).filter(c => matchesFilter(c, this.state.tag, this.state.q, this.state.kind, this.state.fav)); }
  // flat, in-render-order list of every visible tile — the keyboard cursor walks this
  flat() { return this.shownFolders().flatMap(f => this.visIn(f)); }
  selItems() { return this.allItems().filter(c => isMedia(c) && this.state.sel[selKey(c)]); }

  onKey(e) {
    if (e.target.isContentEditable) return; // the composer's contenteditable prompt — same bail as INPUT/TEXTAREA
    const tag = (e.target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.props.app.state.paletteOpen || this.state.lightbox || this.state.rename || this.state.gen || this.state.vimport != null) return; // modal/lightbox owns the keyboard
    const list = this.flat();
    if (!list.length) return;
    const k = e.key.toLowerCase();
    const cur = Math.min(this.state.cur, list.length - 1);
    if (k === 'arrowright' || k === 'arrowdown' || k === 'j') { e.preventDefault(); e.stopPropagation(); this.setState({ cur: Math.min(list.length - 1, cur + 1) }); }
    else if (k === 'arrowleft' || k === 'arrowup' || k === 'k') { e.preventDefault(); e.stopPropagation(); this.setState({ cur: Math.max(0, cur - 1) }); }
    else if (k === 'enter') { e.preventDefault(); e.stopPropagation(); const c = list[cur]; if (c) this.setState({ lightbox: { folder: c.folder, name: c.name } }); }
    else if (k === '.') { e.preventDefault(); e.stopPropagation(); const c = list[cur]; if (c) this.toggleFav(c); }
    else if (k === 'e') { e.preventDefault(); e.stopPropagation(); const c = list[cur]; if (c) this.setState({ rename: { name: c.name, folder: c.folder || '' }, renameText: c.name }); }
  }

  async toggleFav(c) {
    try { await api.saveMeta(this.scope(), c.name, c.folder, { fav: !c.meta?.fav }); this.props.app.sync(); }
    catch { this.props.app.showToast('Could not favorite', 'var(--danger)'); }
  }
  async analyze(c) {
    const key = c.folder + '/' + c.name;
    this.setState(s => ({ analyzing: { ...s.analyzing, [key]: 1 } }));
    try { await api.analyzeAsset(this.scope(), c.name, c.folder); await this.props.app.sync(); }
    catch (e) { this.props.app.showToast('Analysis failed — ' + (e.message || 'Groq error'), 'var(--danger)'); }
    this.setState(s => { const a = { ...s.analyzing }; delete a[key]; return { analyzing: a }; });
  }
  async analyzeAll(media) {
    const todo = media.filter(c => canAnalyze(c) && !(c.meta && c.meta.description));
    if (!todo.length) { this.props.app.showToast('Every image already has metadata', 'var(--ok)'); return; }
    this.props.app.showToast('Analyzing ' + todo.length + ' images…', 'var(--accent)');
    for (const c of todo) await this.analyze(c);
    this.props.app.showToast('Board metadata complete', 'var(--ok)');
  }
  async del(c) { await api.deleteContext(this.scope(), c.name, c.folder).catch(() => {}); this.props.app.sync(); }
  toggleSel(c) { this.setState(s => { const sel = { ...s.sel }; if (sel[selKey(c)]) delete sel[selKey(c)]; else sel[selKey(c)] = 1; return { sel }; }); }
  async bulk(label, fn, filter) {
    const targets = filter ? this.selItems().filter(filter) : this.selItems();
    if (!targets.length) return;
    for (const c of targets) { try { await fn(c); } catch { /* keep going */ } }
    this.setState({ sel: {} });
    await this.props.app.sync();
    this.props.app.showToast(targets.length + (targets.length > 1 ? ' assets ' : ' asset ') + label, 'var(--ok)');
  }
  async doRename() {
    const r = this.state.rename, name = (this.state.renameText || '').trim();
    this.setState({ rename: null });
    if (!r || !name || name === r.name) return;
    try { const saved = await api.renameAsset(this.scope(), r.name, r.folder, name); this.props.app.showToast('Renamed → ' + saved.name, 'var(--ok)'); this.props.app.sync(); }
    catch (e) { this.props.app.showToast('Rename failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  async upload(files, folder) {
    for (const f of files) { try { await api.uploadContext(this.scope(), f, folder); } catch { this.props.app.showToast('Upload failed: ' + f.name, 'var(--danger)'); } }
    if (files.length) this.props.app.showToast(files.length + ' → ' + (folder || 'unsorted'), 'var(--accent)');
    this.props.app.sync();
  }
  pick(folder) { this._pickFolder = folder || ''; if (this.fileRef.current) this.fileRef.current.click(); }

  section(f, title) {
    const S = this.state;
    const media = this.visIn(f);
    const count = this.inFolder(f).length;
    const unanalyzed = media.filter(c => canAnalyze(c) && !(c.meta && c.meta.description)).length;
    return (
      <div key={f || '(root)'}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (S.focus !== f || !S.drag) this.setState({ drag: f }); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); this.setState({ drag: null }); this.upload([...e.dataTransfer.files], f); }}
        style={{ ...sx('margin-top:18px;border-radius:16px;padding:16px 18px 18px;background:var(--surface)'), border: S.drag === f ? '1px dashed var(--accent)' : '1px solid var(--line)' }}>
        <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:12px')}>
          <span style={sx('font-size:13px;font-weight:800;letter-spacing:.14em;color:var(--fg);text-transform:uppercase')}>{title || f || 'Unsorted'}</span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)' }}>{count}</span>
          <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>context/{f ? f + '/' : ''}</span>
          <div style={sx('margin-left:auto;display:flex;gap:12px;align-items:center;font-size:11px')}>
            {this.props.onGenerate && <span onClick={() => this.setState({ gen: f, genPrompt: '', genLevel: 'none' })} className="hAccent" style={sx('color:var(--fg-muted);font-weight:600;cursor:pointer')}>✦ Generate</span>}
            {unanalyzed > 0 && <span onClick={() => this.analyzeAll(media)} className="hAccent" style={sx('color:var(--fg-muted);font-weight:600;cursor:pointer')}>✦ Initialize ({unanalyzed})</span>}
            {this.props.onReclass && f && <span onClick={() => this.props.onReclass(f, this.props.side === 'asset' ? 'reference' : 'asset')} className="hFg" style={sx('color:var(--fg-faint);cursor:pointer')} title="Move this board to the other side of the References/Assets split">→ {this.props.side === 'asset' ? 'References' : 'Assets'}</span>}
            {f && <span onClick={() => api.revealAsset(this.scope(), '', f).catch(() => this.props.app.showToast('Could not open folder', 'var(--danger)'))} className="hFg" style={sx('color:var(--fg-faint);cursor:pointer')} title="Open this board's folder in Finder">⌖ Finder</span>}
            <span onClick={() => this.setState({ vimport: f })} className="hAccent" style={sx('color:var(--fg-muted);font-weight:600;cursor:pointer')} title="Import a YouTube/Vimeo link or local video — shot-cut detection extracts reference frames">⌁ Video → frames</span>
            <span onClick={() => this.pick(f)} className="hAccent" style={sx('color:var(--fg-muted);font-weight:600;cursor:pointer')}>&uarr; Add media</span>
          </div>
        </div>
        {this.gen(f)}
        {media.length > 0
          ? <Mosaic scope={this.scope()} folder={f} media={media} size={S.size}
              onOpen={c => this.setState({ lightbox: { folder: c.folder, name: c.name } })}
              onDelete={c => this.del(c)} onAnalyze={c => this.analyze(c)} analyzing={S.analyzing}
              activeTag={S.tag} onTag={t => this.setState({ tag: t })}
              onFav={c => this.toggleFav(c)} selected={S.sel} onToggleSel={c => this.toggleSel(c)} />
          : <div onClick={() => this.pick(f)} style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:34px 16px;text-align:center;cursor:pointer')}>
              <div style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>EMPTY BOARD — DROP MEDIA OR GENERATE INTO IT</div>
              <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:6px')}>Vision analysis tags everything automatically.</div>
            </div>}
      </div>
    );
  }

  // per-board quick generate — THE composer (frontend/Composer.jsx), not a bespoke input row.
  // showTech is off because the model is this board's own contract (the project default via
  // props.onGenerate), and showing a tech chip whose choices fireGen ignores would be a lie.
  // The ENHANCE level (no AI / ✦ quick / ✦✦ full) is board-specific and rides above as pills.
  gen(f) {
    const S = this.state;
    if (S.gen !== f || !this.props.onGenerate) return null;
    const { app } = this.props;
    const lv = [['none', 'no AI'], ['quick', '✦ quick'], ['full', '✦✦ full']];
    return (
      <div style={sx('margin-bottom:14px')}>
        <Composer
          app={app}
          value={{ prompt: S.genPrompt }}
          onChange={v => this.setState({ genPrompt: v.prompt })}
          showTech={false}
          submitOnEnter
          onSubmit={() => this.fireGen(f)}
          submitLabel="Generate"
          placeholder={'Quick-generate for ' + (f || 'this board') + '… ⏎'}
          entities={this.scope() !== 'library' ? buildEntityPool(app, this.scope()) : []}
          pills={[
            ...lv.map(([id, label]) => ({
              id, label: 'enhance · ' + label, thumb: false,
              tone: S.genLevel === id ? 'accent' : 'neutral',
              onClick: () => this.setState({ genLevel: id }),
              title: 'Prompt enhancement level',
            })),
            { id: '__esc', label: '✕ close', thumb: false, onClick: () => this.setState({ gen: null }) },
          ]}
        />
      </div>
    );
  }
  async fireGen(f) {
    const prompt = (this.state.genPrompt || '').trim();
    if (!prompt) return;
    this.setState({ gen: null });
    this.props.onGenerate(f, prompt, this.state.genLevel);
  }

  render() {
    const { app, emptyText } = this.props;
    const S = this.state;
    const shown = this.shownFolders();
    const allMedia = shown.flatMap(f => this.visIn(f));
    const media = this.allItems().filter(isMedia);
    const tags = collectTags(media), kinds = collectKinds(media);
    const total = media.length;
    // resolve the open lightbox item live so meta refreshes after analyze/fav
    const lbItem = S.lightbox ? allMedia.find(c => c.name === S.lightbox.name && (c.folder || '') === (S.lightbox.folder || '')) : null;
    const rail = this.props.folders.length > 1 && (
      <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-bottom:14px;align-items:center')}>
        <span style={sx('font-size:9px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-right:3px')}>{this.props.railLabel || 'BOARDS'}</span>
        {['', ...this.props.folders].map(f => {
          const on = (S.focus || '') === f;
          const label = f === '' ? 'All' : f;
          return <span key={f || 'all'} onClick={() => this.setState({ focus: f === '' ? null : f })}
            style={{ ...sx('font-size:10.5px;border-radius:99px;padding:3px 11px;cursor:pointer'), color: on ? 'var(--fg)' : 'var(--fg-muted)', background: on ? 'var(--raise)' : 'transparent', border: '1px solid ' + (on ? 'var(--border-3)' : 'var(--border-2)'), fontWeight: on ? 700 : 500 }}>{label}</span>;
        })}
      </div>
    );
    return (
      <div style={sx('position:relative;padding-bottom:80px')}>
        <input ref={this.fileRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { this.upload([...e.target.files], this._pickFolder || ''); e.target.value = ''; }} />
        {rail}
        <BoardControls size={S.size} onSize={v => this.setState({ size: v })} tags={tags}
          activeTag={S.tag} onTag={t => this.setState({ tag: t })} q={S.q} onQ={v => this.setState({ q: v })}
          kinds={kinds} activeKind={S.kind} onKind={k => this.setState({ kind: k })}
          favOnly={S.fav} onFavOnly={v => this.setState({ fav: v })}
          view={S.view} onView={v => this.setState({ view: v })} />

        {S.view === 'list'
          ? <AssetList scope={this.scope()} items={allMedia} paused={!!S.lightbox}
              onOpen={c => this.setState({ lightbox: { folder: c.folder, name: c.name } })}
              onFav={c => this.toggleFav(c)} onAnalyze={c => this.analyze(c)} canFal={app.state.falReady}
              onFal={async c => { try { await api.sendFal(this.scope(), c.name, c.folder); app.sync(); app.showToast(c.name + ' → FAL', 'var(--ok)'); } catch { app.showToast('FAL push failed', 'var(--danger)'); } }}
              onDelete={c => this.del(c)} selected={S.sel} onToggleSel={c => this.toggleSel(c)} />
          : shown.map(f => this.section(f, this.props.titleFor ? this.props.titleFor(f) : ''))}

        {!total && (
          <div onClick={() => this.pick(shown[0] || '')} style={sx('border:1px dashed var(--border-2);border-radius:16px;padding:70px 20px;text-align:center;cursor:pointer;margin-top:14px')}>
            <div style={{ ...sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>{(emptyText || 'No boards yet').toUpperCase()} — ADD MEDIA</div>
            <div style={sx('font-size:12px;color:var(--fg-faint);margin-top:7px')}>Vision analysis describes, tags and palettes each image automatically.</div>
          </div>
        )}

        {S.vimport != null && (
          <VideoImport app={app} scope={this.scope()} folder={S.vimport}
            onClose={() => this.setState({ vimport: null })}
            onSaved={() => { app.sync(); setTimeout(() => app.sync(), 1200); }} />
        )}

        {S.rename && (
          <div onClick={() => this.setState({ rename: null })} style={sx('position:fixed;inset:0;z-index:80;background:rgba(5,6,8,.6);display:flex;align-items:flex-start;justify-content:center;padding-top:22vh')}>
            <div onClick={e => e.stopPropagation()} style={sx('width:420px;padding:16px 18px;border-radius:12px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 24px 80px rgba(0,0,0,.8)')}>
              <div style={sx('font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:9px')}>RENAME ASSET</div>
              <input autoFocus value={this.state.renameText || ''} onChange={e => this.setState({ renameText: e.target.value })}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.doRename(); else if (e.key === 'Escape') this.setState({ rename: null }); }}
                style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--accent-60);border-radius:8px;color:var(--fg);padding:8px 11px'), fontFamily: MONO, fontSize: 12 }} />
              <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:7px')}>the .meta.md sidecar moves with it · ⏎ save · Esc cancel</div>
            </div>
          </div>
        )}

        {this.selItems().length > 0 && (
          <BulkBar count={this.selItems().length} folders={this.ctx().folders} copyTargets={[{ id: 'library', label: 'Global library' }]}
            onFav={() => this.bulk('favorited ★', c => api.saveMeta(this.scope(), c.name, c.folder, { fav: true }))}
            onKind={k => this.bulk(k ? 'set to ' + k : 'kind cleared', c => api.saveMeta(this.scope(), c.name, c.folder, { kind: k }))}
            onTags={txt => { const add = txt.split(',').map(t => t.trim().toLowerCase()).filter(Boolean); this.bulk('tagged', c => api.saveMeta(this.scope(), c.name, c.folder, { tags: [...new Set([...(c.meta?.tags || []), ...add])] })); }}
            onMove={f => this.bulk('moved to ' + (f || '(root)'), c => api.moveAsset(this.scope(), c.name, c.folder, f))}
            onAnalyze={() => this.bulk('analyzed ✦', c => api.analyzeAsset(this.scope(), c.name, c.folder), c => canAnalyze(c))}
            onFal={() => this.bulk('pushed to FAL ↗', c => api.sendFal(this.scope(), c.name, c.folder))}
            onCopy={() => this.bulk('copied to library', c => api.copyAsset(this.scope(), c.name, c.folder, 'library', c.folder))}
            onDelete={() => this.bulk('deleted', c => api.deleteContext(this.scope(), c.name, c.folder))}
            onClear={() => this.setState({ sel: {} })} />
        )}

        {lbItem && (
          <Lightbox app={app} scope={this.scope()} item={lbItem} folders={this.ctx().folders}
            onRenamed={saved => { this.setState({ lightbox: { folder: saved.folder, name: saved.name } }); app.sync(); }}
            onClose={() => this.setState({ lightbox: null })}
            onNav={d => { const ix = allMedia.indexOf(lbItem); const nx = allMedia[((ix + d) % allMedia.length + allMedia.length) % allMedia.length]; if (nx) this.setState({ lightbox: { folder: nx.folder, name: nx.name } }); }}
            onTag={t => this.setState({ tag: t })} onMeta={() => app.sync()} />
        )}
      </div>
    );
  }
}

// ── the Assets tab: production building blocks ────────────────────────────────────────────────
export class AssetBoards extends React.Component {
  constructor(props) { super(props); this.state = { overrides: {} }; }
  componentDidMount() { this.loadOverrides(); }
  componentDidUpdate(prev) { if (prev.proj.id !== this.props.proj.id) this.loadOverrides(); }
  loadOverrides() { api.folderKinds(this.props.proj.id).then(r => this.setState({ overrides: r.kinds || {} })).catch(() => this.setState({ overrides: {} })); }
  async reclass(folder, kind) {
    try { const r = await api.setFolderKind(this.props.proj.id, folder, kind); this.setState({ overrides: r.kinds || {} }); this.props.app.showToast(folder + ' → ' + (kind === 'asset' ? 'Assets' : 'References'), 'var(--ok)'); }
    catch { this.props.app.showToast('Could not reclassify board', 'var(--danger)'); }
  }
  // enhance runs through the shared /api/enhance ({ text, mode } → { text }); any failure degrades
  // silently to the raw prompt so a missing Groq key never blocks the quick-gen.
  async generate(folder, prompt, level) {
    const { app, proj } = this.props;
    let text = prompt;
    if (level && level !== 'none') {
      try { const r = await api.enhance(prompt, level === 'full' ? 'full' : 'quick'); if (r && r.text) text = r.text; }
      catch { /* enhance unavailable → plain text */ }
    }
    const model = app.state.settings?.modelDefaults?.preview || DEFAULT_PREVIEW_MODEL;
    try {
      await api.generate({ pid: proj.id, prompt: text, model, aspect: '1:1', seed: null });
      app.showToast('Quick-gen queued — review in Generate, then Save to “' + (folder || 'a board') + '”', 'var(--accent)');
      app.sync();
    } catch (e) { app.showToast('Generate failed — ' + (e.message || ''), 'var(--danger)'); }
  }
  // canonical Cast/Locations/Wardrobe/Props first (mapped to a real folder if one exists, else a
  // virtual board that's created on first upload), then any other asset-classified user folders.
  sections() {
    const folders = (this.props.proj.context || {}).folders || [];
    const ov = this.state.overrides;
    const out = [], used = new Set();
    for (const c of ASSET_KIND_FOLDERS) {
      const hit = folders.find(f => c.match.test(f) && ov[f] !== 'reference');
      if (hit) { out.push(hit); used.add(hit); } else out.push(c.label);
    }
    for (const f of assetFoldersOf(folders, ov)) if (!used.has(f) && !ASSET_KIND_FOLDERS.some(c => c.match.test(f))) out.push(f);
    return out;
  }
  render() {
    const { app, proj } = this.props;
    return (
      <div style={sx('padding:20px 28px 0')}>
        <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:6px')}>
          <span style={sx('font-size:11px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>ASSETS</span>
          <span style={sx('font-size:11px;color:var(--fg-faint)')}>production building blocks — cast, locations, wardrobe, props you generate and reuse across shots. Context is injected into every agent run.</span>
        </div>
        <BoardGrid app={app} proj={proj} folders={this.sections()} side="asset" railLabel="ASSET BOARDS"
          onGenerate={(f, p, l) => this.generate(f, p, l)} onReclass={(f, k) => this.reclass(f, k)}
          emptyText="No production assets yet" />
      </div>
    );
  }
}
