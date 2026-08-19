// Global asset library — cross-project reference assets at <storage root>/library/.
// Collections are folders on disk; every image can carry vision metadata.
// Assets can be copied into any project's context (and back) — meta rides along.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Mosaic, Lightbox, BoardControls, AssetList, BulkBar, collectTags, collectKinds, matchesFilter, canAnalyze, selKey } from './Moodboard';
import { MONO } from './tokens';

const STARTERS = ['Talents', 'Locations', 'Props', 'Styles', 'Moodboard'];


export default class LibraryPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      size: 42, tag: '', q: '', kind: '', fav: false, view: 'board',
      open: null,             // lightbox: { keys, ix } — items resolved live in render
      newColl: false, collName: '',
      renameColl: null, renameText: '',
      drag: false, dropTarget: null,
      analyzing: {},
      sel: {},                // multi-select: selKey → 1
      copyOpen: null          // item being copied to a project
    };
    this.fileRef = React.createRef();
    this._uploadFolder = '';
    this._anchor = null;
  }
  toggleFav(c) { return this.props.app.toggleAssetFav('library', c); }
  toggleSel(c, shift, list) {
    const ix = list.findIndex(x => selKey(x) === selKey(c));
    this.setState(s => {
      const sel = { ...s.sel };
      if (shift && this._anchor != null && this._anchor >= 0 && ix >= 0) {
        const [a, b] = [Math.min(this._anchor, ix), Math.max(this._anchor, ix)];
        for (let i = a; i <= b; i++) sel[selKey(list[i])] = 1;
      } else if (sel[selKey(c)]) delete sel[selKey(c)]; else sel[selKey(c)] = 1;
      this._anchor = ix;
      return { sel };
    });
  }
  async bulk(label, fn, filter) {
    const { app } = this.props;
    let targets = this.lib().items.filter(c => this.state.sel[selKey(c)]);
    if (filter) targets = targets.filter(filter);
    if (!targets.length) return;
    let ok = 0, fail = 0;
    for (const c of targets) { try { await fn(c); ok++; } catch { fail++; } }
    this.setState({ sel: {} });
    await app.sync();
    // report honestly — a whole-batch failure used to still show a green "done" toast
    if (ok) app.showToast(ok + (ok > 1 ? ' assets ' : ' asset ') + label + (fail ? ' · ' + fail + ' failed' : ''), fail ? 'var(--accent)' : 'var(--ok)');
    else app.showToast('All ' + fail + ' failed — ' + label.replace(/ed$/, '') + ' did not complete', 'var(--danger)');
  }

  lib() { return this.props.app.state.library || { folders: [], items: [] }; }
  componentDidMount() {
    this._key = e => {
      if (e.key === 'Escape' && Object.keys(this.state.sel).length && !this.state.open) {
        e.preventDefault(); e.stopPropagation();
        this.setState({ sel: {} });
      }
    };
    window.addEventListener('keydown', this._key, true);
  }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); }

  async upload(files, folder) {
    const { app } = this.props;
    let ok = 0;
    for (const f of files) { try { await api.uploadLibrary(f, folder); ok++; } catch { app.showToast('Upload failed: ' + f.name, 'var(--danger)'); } }
    if (ok) app.showToast(ok + (ok > 1 ? ' assets' : ' asset') + ' added to the library', 'var(--accent)');
    app.sync();
  }
  pick(folder) { this._uploadFolder = folder || ''; this.fileRef.current && this.fileRef.current.click(); }
  async del(c) {
    await api.deleteLibrary(c.name, c.folder).catch(() => { });
    this.props.app.sync();
  }
  async analyze(c) {
    const { app } = this.props;
    const key = c.folder + '/' + c.name;
    this.setState(s => ({ analyzing: { ...s.analyzing, [key]: 1 } }));
    try {
      await api.analyzeAsset('library', c.name, c.folder);
      app.sync();
    } catch (e) { app.showToast('Analysis failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState(s => { const a = { ...s.analyzing }; delete a[key]; return { analyzing: a }; });
  }
  async analyzeAll(items) {
    const { app } = this.props;
    const todo = items.filter(c => canAnalyze(c) && !(c.meta && c.meta.description));
    if (!todo.length) { app.showToast('Every image already has metadata', 'var(--ok)'); return; }
    // bulk deliberately uses the Settings default tier (free unless changed) — a sweep across a
    // whole library on the paid tier should be a conscious choice, not a side effect of one click
    app.showToast('Analyzing ' + todo.length + ' images…', 'var(--accent)');
    for (const c of todo) await this.analyze(c); // sequential — free tier friendly
    app.showToast('Mood board metadata complete — ' + todo.length + ' images tagged', 'var(--ok)');
  }
  openLightbox(list, c) {
    // store keys, not item objects — the lightbox then resolves live items each render,
    // so Analyze/favorite/tag updates show up without closing and reopening (App.jsx pattern)
    this.setState({ open: { keys: list.map(i => (i.folder || '') + '/' + i.name), ix: list.indexOf(c) } });
  }

  render() {
    const S = this.state;
    const { app } = this.props;
    const lib = this.lib();
    const all = lib.items.filter(i => matchesFilter(i, S.tag, S.q, S.kind, S.fav));
    const inFolder = f => all.filter(i => (i.folder || '') === f);
    const tags = collectTags(lib.items);
    const kinds = collectKinds(lib.items);
    const media = list => list.filter(c => c.type === 'image' || c.type === 'video');
    const docs = list => list.filter(c => !(c.type === 'image' || c.type === 'video'));
    const nAnalyzed = lib.items.filter(i => i.meta).length;
    const openItem = (() => {
      if (!S.open || !S.open.keys.length) return null;
      const key = S.open.keys[((S.open.ix % S.open.keys.length) + S.open.keys.length) % S.open.keys.length];
      return lib.items.find(i => (i.folder || '') + '/' + i.name === key) || null;
    })();

    const section = (title, folder, items) => {
      const med = media(items), dc = docs(items);
      const hot = S.drag && S.dropTarget === folder;
      if (!items.length && folder === '') return null;
      return (
        <div key={folder || '(root)'}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (S.dropTarget !== folder) this.setState({ drag: true, dropTarget: folder }); }}
          onDrop={e => { e.preventDefault(); e.stopPropagation(); this.setState({ drag: false, dropTarget: null }); this.upload([...e.dataTransfer.files], folder); }}
          style={{ ...sx('margin-top:18px;border-radius:16px;padding:16px 18px 18px;background:var(--surface)'), border: hot ? '1px dashed var(--accent)' : '1px solid var(--line)' }}>
          <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:12px')}>
            {S.renameColl === folder && folder
              ? <input autoFocus value={S.renameText} onChange={e => this.setState({ renameText: e.target.value })}
                onKeyDown={async e => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && S.renameText.trim() && S.renameText.trim() !== folder) {
                    try {
                      const r = await api.renameFolder('library', folder, S.renameText.trim());
                      this.setState({ renameColl: null });
                      app.showToast('Collection renamed → ' + r.name, 'var(--ok)'); app.sync();
                    } catch (err) { app.showToast('Rename failed — ' + (err.message || ''), 'var(--danger)'); }
                  } else if (e.key === 'Escape' || e.key === 'Enter') this.setState({ renameColl: null });
                }}
                onBlur={() => this.setState({ renameColl: null })}
                style={sx('width:200px;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px')} />
              : <span onClick={() => folder && this.setState({ renameColl: folder, renameText: folder })} title={folder ? 'Click to rename collection' : undefined}
                className={folder ? 'hAccent' : ''} style={{ ...sx('font-size:13px;font-weight:800;letter-spacing:.14em;color:var(--fg);text-transform:uppercase'), cursor: folder ? 'text' : 'default' }}>
                {title}{folder ? <span style={sx('font-size:9px;color:var(--fg-faint);margin-left:6px;font-weight:400')}>✎</span> : null}
              </span>}
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-muted)', fontVariantNumeric: 'tabular-nums' }}>{items.length}</span>
            <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>library/{folder ? folder + '/' : ''}</span>
            <div style={sx('margin-left:auto;display:flex;gap:12px;align-items:center;font-size:11px')}>
              {med.some(c => canAnalyze(c) && !(c.meta && c.meta.description)) && (
                <span onClick={() => this.analyzeAll(items)} className="hAccent" style={sx('color:var(--accent);font-weight:600;cursor:pointer')}>✦ Initialize</span>
              )}
              <span onClick={() => api.revealAsset('library', '', folder).catch(() => app.showToast('Could not open folder', 'var(--danger)'))} className="hFg" style={sx('color:var(--fg-faint);cursor:pointer')} title="Open this collection's folder — files you drop there appear here automatically">⌖ Finder</span>
              <span onClick={() => this.pick(folder)} className="hAccent" style={sx('color:var(--accent);font-weight:600;cursor:pointer')}>↑ Add assets</span>
              {folder && <span onClick={async () => { await api.deleteLibraryFolder(folder).catch(() => { }); app.sync(); }} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer')}>Delete collection</span>}
            </div>
          </div>
          {med.length > 0 && (
            <Mosaic scope="library" folder={folder} media={med} size={S.size}
              onOpen={c => this.openLightbox(media(all), c)} onDelete={c => this.del(c)}
              onAnalyze={c => this.analyze(c)} analyzing={S.analyzing}
              activeTag={S.tag} onTag={t => this.setState({ tag: t })}
              onFav={c => this.toggleFav(c)} selected={S.sel} onToggleSel={(c, sh) => this.toggleSel(c, sh, media(all))} />
          )}
          {dc.length > 0 && (
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:12px')}>
              {dc.map(c => (
                <div key={c.name} className="hBd" style={sx('display:flex;gap:10px;align-items:center;border:1px solid var(--border);border-radius:10px;padding:10px 12px;background:var(--surface)')}>
                  <span style={sx('font-size:15px')}>📎</span>
                  <a href={api.libraryUrl(c.name, c.folder)} target="_blank" rel="noreferrer" style={{ ...sx('flex:1;font-size:11px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{c.name}</a>
                  <span onClick={() => this.del(c)} className="hDel" style={sx('font-size:11px;color:var(--danger);cursor:pointer')}>&#10005;</span>
                </div>
              ))}
            </div>
          )}
          {!items.length && (
            <div onClick={() => this.pick(folder)} style={{ ...sx('border:1px dashed var(--border-2);border-radius:12px;padding:30px 16px;text-align:center;cursor:pointer;color:var(--fg-faint);font-size:10.5px;font-weight:700;letter-spacing:.14em'), fontFamily: MONO }}>
              EMPTY COLLECTION — DROP IMAGES, VIDEO OR DOCS
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        onDragOver={e => { e.preventDefault(); if (!S.drag) this.setState({ drag: true, dropTarget: '' }); }}
        onDragLeave={e => { if (e.currentTarget === e.target) this.setState({ drag: false, dropTarget: null }); }}
        onDrop={e => { e.preventDefault(); this.setState({ drag: false, dropTarget: null }); this.upload([...e.dataTransfer.files], ''); }}
        style={sx('padding:22px 28px 90px;position:relative')}>
        <input ref={this.fileRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => { this.upload([...e.target.files], this._uploadFolder); e.target.value = ''; }} />
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Library</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>{lib.items.length} assets · {nAnalyzed} analyzed · shared across every project</span>
          <div style={sx('margin-left:auto;display:flex;gap:8px;align-items:center')}>
            <span onClick={() => app.saveSettings({ autoAnalyze: !app.state.settings.autoAnalyze })}
              title="Auto-initialize — every new image (app upload or Finder drop) gets vision metadata automatically"
              style={{ ...sx('display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:700;letter-spacing:.06em;border-radius:99px;padding:3px 10px;cursor:pointer'), color: app.state.settings.autoAnalyze ? 'var(--fg)' : 'var(--fg-faint)', background: app.state.settings.autoAnalyze ? 'var(--raise)' : 'transparent', border: '1px solid ' + (app.state.settings.autoAnalyze ? 'var(--border-3)' : 'var(--border-2)') }}>
              ✦ AUTO {app.state.settings.autoAnalyze ? 'ON' : 'OFF'}
            </span>
            {!S.newColl && <div onClick={() => this.setState({ newColl: true, collName: '' })} className="hBdAccent" style={sx('padding:5px 13px;border:1px solid var(--accent-35);border-radius:7px;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer')}>+ New collection</div>}
            {S.newColl && (
              <div style={sx('display:flex;gap:7px;align-items:center')}>
                <input value={S.collName} autoFocus onChange={e => this.setState({ collName: e.target.value })}
                  onKeyDown={async e => {
                    e.stopPropagation();
                    if (e.key === 'Enter' && S.collName.trim()) { await api.createLibraryFolder(S.collName.trim()).catch(() => { }); this.setState({ newColl: false }); app.sync(); }
                    else if (e.key === 'Escape') this.setState({ newColl: false });
                  }}
                  placeholder="collection — textures, characters, grades…"
                  style={sx('width:250px;background:var(--surface);border:1px solid var(--accent-35);border-radius:7px;color:var(--fg);font-size:11.5px;padding:6px 11px')} />
                <span onClick={() => this.setState({ newColl: false })} className="hFgL" style={sx('font-size:11px;color:var(--fg-faint);cursor:pointer')}>Esc</span>
              </div>
            )}
            <div onClick={() => this.pick('')} className="hBtnAccent" style={sx('padding:5px 14px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:11px;cursor:pointer')}>↑ Upload</div>
          </div>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Reference assets that outlive a single project. Vision analysis tags them; copy any asset into a project board and the metadata travels with it.</div>
        <BoardControls size={S.size} onSize={v => this.setState({ size: v })} tags={tags}
          activeTag={S.tag} onTag={t => this.setState({ tag: t })} q={S.q} onQ={v => this.setState({ q: v })}
          kinds={kinds} activeKind={S.kind} onKind={k => this.setState({ kind: k })}
          favOnly={S.fav} onFavOnly={v => this.setState({ fav: v })}
          view={S.view} onView={v => this.setState({ view: v })} />

        {S.view === 'list' ? (
          <AssetList scope="library" items={media(all)} paused={!!S.open}
            onOpen={c => this.openLightbox(media(all), c)}
            onFav={c => this.toggleFav(c)} onAnalyze={c => this.analyze(c)} canFal={app.state.falReady}
            onFal={async c => { try { await api.sendFal('library', c.name, c.folder); app.sync(); app.showToast(c.name + ' → FAL storage', 'var(--ok)'); } catch { app.showToast('FAL push failed', 'var(--danger)'); } }}
            onDelete={c => this.del(c)}
            selected={S.sel} onToggleSel={(c, sh) => this.toggleSel(c, sh, media(all))} />
        ) : (<>
          {section('Unsorted', '', inFolder(''))}
          {lib.folders.map(f => section(f, f, inFolder(f)))}
        </>)}
        {!lib.items.length && !lib.folders.length && (
          <div style={sx('border:1px dashed var(--border-2);border-radius:16px;padding:60px 20px;text-align:center;margin-top:14px')}>
            <div style={{ ...sx('font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>NO LIBRARY YET — DROP REFERENCE IMAGES ANYWHERE</div>
            <div onClick={() => this.pick('')} style={sx('font-size:12px;color:var(--fg-faint);margin-top:6px;cursor:pointer')}>Drop reference images anywhere — vision analysis describes and tags them, and they become searchable across every project.</div>
            <div style={sx('display:flex;gap:8px;justify-content:center;margin-top:18px;flex-wrap:wrap')}>
              {STARTERS.map(n => (
                <span key={n} onClick={async () => { await api.createLibraryFolder(n).catch(() => { }); app.sync(); }}
                  className="hBdAccent" style={sx('font-size:11px;font-weight:600;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:5px 15px;cursor:pointer')}>+ {n}</span>
              ))}
            </div>
            <div style={sx('font-size:10.5px;color:var(--fg-faint);margin-top:10px')}>one-click starter collections — talents, locations, props, styles</div>
          </div>
        )}

        {S.drag && (
          <div style={sx('position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:50;padding:10px 22px;border-radius:99px;background:var(--raise);border:1px solid var(--accent-60);box-shadow:0 12px 32px rgba(0,0,0,.6);font-size:12px;color:var(--accent);font-weight:700;pointer-events:none')}>
            Drop to add to {S.dropTarget ? '“' + S.dropTarget + '”' : 'the library'}
          </div>
        )}

        {Object.keys(S.sel).length > 0 && (
          <BulkBar count={Object.keys(S.sel).length}
            folders={lib.folders} copyTargets={app.state.projects.map(p => ({ id: p.id, label: p.name }))}
            onFav={() => this.bulk('favorited ★', c => api.saveMeta('library', c.name, c.folder, { fav: true }))}
            onKind={k => this.bulk(k ? 'set to ' + k : 'kind cleared', c => api.saveMeta('library', c.name, c.folder, { kind: k }))}
            onTags={txt => {
              const add = txt.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
              this.bulk('tagged', c => api.saveMeta('library', c.name, c.folder, { tags: [...new Set([...(c.meta?.tags || []), ...add])] }));
            }}
            onMove={f => this.bulk('moved to ' + (f || '(root)'), c => api.moveAsset('library', c.name, c.folder, f))}
            onAnalyze={() => this.bulk('analyzed ✦', c => api.analyzeAsset('library', c.name, c.folder), c => canAnalyze(c))}
            onFal={() => this.bulk('pushed to FAL ↗', c => api.sendFal('library', c.name, c.folder))}
            onCopy={pid => this.bulk('copied to ' + pid, c => api.copyAsset('library', c.name, c.folder, pid, 'library'))}
            onDelete={() => this.bulk('deleted', c => api.deleteLibrary(c.name, c.folder))}
            onClear={() => this.setState({ sel: {} })} />
        )}

        {openItem && (
          <Lightbox app={app} scope="library" item={openItem} folders={lib.folders}
            onRenamed={() => { this.setState({ open: null }); app.sync(); }}
            onClose={() => this.setState({ open: null })}
            onNav={d => this.setState(s => ({ open: { ...s.open, ix: s.open.ix + d } }))}
            onTag={t => this.setState({ tag: t })}
            onMeta={() => app.sync()}
            actions={this.renderCopyTo(openItem)} />
        )}
      </div>
    );
  }

  renderCopyTo(item) {
    const { app } = this.props;
    return (
      <div style={sx('border-top:1px solid var(--line);padding-top:12px')}>
        <div style={sx('font-size:9.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-faint);margin-bottom:8px')}>SEND TO PROJECT</div>
        <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
          {app.state.projects.map(p => (
            <span key={p.id} onClick={async () => {
              await api.copyAsset('library', item.name, item.folder, p.id, 'library').catch(() => { });
              app.showToast(item.name + ' → ' + p.name + ' · context/library/', 'var(--ok)');
              app.sync();
            }} className="hBdAccentChip" style={{ ...sx('font-size:10.5px;color:var(--fg-soft);border:1px solid var(--border-2);border-radius:99px;padding:3px 11px;cursor:pointer'), fontFamily: MONO }}>{p.name}</span>
          ))}
        </div>
      </div>
    );
  }
}
