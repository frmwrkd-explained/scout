// References = "what we look up to": the inspiration, the intended feel, and the project's current
// state of mind. Sub-tabs: Brief · Moods · Notes · Memory. This is the inspiration half of the old
// Context tab; the production half (Cast/Locations/Wardrobe/Props) now lives in AssetBoards.jsx.
//
// Brief/Notes re-implement the behaviour previously in App.renderContextPage (this component can't
// edit App.jsx). Moods reuses the shared BoardGrid (filtered to reference-classified folders + the
// unsorted root). Memory is the editable "hot cache" doc, injected into every agent run.
//
// Sub-tab state is prop-driven via app.state.refSub (mirrors how ctxSub lived on app state) so the
// global `m` shortcut can jump straight to Memory by setting app.state.refSub = 'memory'. Falls back
// to 'brief'. briefEdit / note-editor / memory-editor buffers are local to this component.
import React from 'react';
import { marked } from 'marked';
import { sx } from './sx';
import { api } from './api';
import { BoardGrid, refFoldersOf } from './AssetBoards';
import { MONO } from './tokens';

const Md = ({ src, style }) => <div className="mdBody" style={style} dangerouslySetInnerHTML={{ __html: marked.parse(src || '') }} />;
const CTX_ICON = { note: '✎', text: '✎', pdf: '▤', link: '↗', file: '▢' };
const fmtKB = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export class References extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      briefEdit: false, briefDraft: '',
      noteOpen: false, noteName: '', noteText: '', noteReplace: null,
      overrides: {},
      mem: null, memEdit: false, memDraft: '', append: ''
    };
    this.fileRef = React.createRef();
  }
  componentDidMount() { this.loadOverrides(); this.loadMemory(); }
  componentDidUpdate(prev) { if (prev.proj.id !== this.props.proj.id) { this.loadOverrides(); this.loadMemory(); this.setState({ briefEdit: false, noteOpen: false, memEdit: false }); } }

  sub() { return this.props.app.state.refSub || 'brief'; }
  setSub(id) { this.props.app.setState({ refSub: id }); this.setState({ briefEdit: false, noteOpen: false, memEdit: false }); }
  loadOverrides() { api.folderKinds(this.props.proj.id).then(r => this.setState({ overrides: r.kinds || {} })).catch(() => this.setState({ overrides: {} })); }
  loadMemory() { api.getMemory(this.props.proj.id).then(r => this.setState({ mem: r })).catch(() => this.setState({ mem: { body: '', updated: '' } })); }

  // ── brief ──
  async saveBrief() {
    const { app, proj } = this.props;
    const content = this.state.briefDraft;
    this.setState({ briefEdit: false });
    try { await api.saveBrief(proj.id, content); app.showToast('Brief saved to brief.md', 'var(--accent)'); app.sync(); }
    catch (e) { this.setState({ briefEdit: true }); app.showToast('Brief save failed — ' + (e.message || ''), 'var(--danger)'); }
  }

  // ── notes / docs ──
  async saveNote() {
    const { app, proj } = this.props; const S = this.state;
    if (!S.noteText.trim()) return;
    const rep = S.noteReplace;
    await api.addNote(proj.id, S.noteName || 'note', S.noteText, rep ? rep.folder : '', rep ? rep.name : '').catch(() => {});
    this.setState({ noteOpen: false, noteReplace: null }); app.sync();
    app.showToast(rep ? 'Note updated in place' : 'Note added', 'var(--accent)');
  }
  async editNote(c) {
    try { const raw = await api.fetchText(api.contextUrl(this.props.proj.id, c.name, c.folder));
      this.setState({ noteOpen: true, noteName: c.name.replace(/\.(md|txt)$/i, ''), noteText: raw, noteReplace: { name: c.name, folder: c.folder || '' } });
    } catch { this.props.app.showToast('Could not load note', 'var(--danger)'); }
  }
  async del(c) { await api.deleteContext(this.props.proj.id, c.name, c.folder).catch(() => {}); this.props.app.sync(); }
  async upload(files) { for (const f of files) { try { await api.uploadContext(this.props.proj.id, f, ''); } catch { this.props.app.showToast('Upload failed: ' + f.name, 'var(--danger)'); } } if (files.length) this.props.app.showToast(files.length + ' added', 'var(--accent)'); this.props.app.sync(); }

  // ── memory ──
  async saveMemory() {
    const body = this.state.memDraft;
    this.setState({ memEdit: false });
    try { const r = await api.saveMemory(this.props.proj.id, body); this.setState({ mem: r }); this.props.app.showToast('Memory saved', 'var(--accent)'); }
    catch { this.setState({ memEdit: true }); this.props.app.showToast('Memory save failed', 'var(--danger)'); }
  }
  async appendMemory() {
    const text = (this.state.append || '').trim();
    if (!text) return;
    this.setState({ append: '' });
    try { const r = await api.appendMemory(this.props.proj.id, text); this.setState({ mem: r }); this.props.app.showToast('Remembered', 'var(--ok)'); }
    catch { this.props.app.showToast('Could not save', 'var(--danger)'); }
  }

  subTab(id, label, n) {
    const on = this.sub() === id;
    return (
      <div key={id} onClick={() => this.setSub(id)} className={on ? '' : 'hFg'}
        style={{ ...sx('display:flex;align-items:baseline;gap:7px;padding:10px 1px;cursor:pointer;font-size:12px'), color: on ? 'var(--fg)' : 'var(--fg-faint)', fontWeight: on ? 700 : 500, boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>
        {label}{n != null && <span style={{ fontFamily: MONO, fontSize: 10, color: on ? 'var(--accent)' : 'var(--fg-faint)' }}>{n}</span>}
      </div>
    );
  }

  briefPane() {
    const { proj } = this.props; const S = this.state;
    return (
      <div style={sx('padding:20px 28px 0')}>
        <div style={{ ...sx('border-radius:14px;background:var(--surface);overflow:hidden'), border: S.briefEdit ? '1px solid var(--accent-35)' : '1px solid var(--border)' }}>
          <div style={sx('display:flex;align-items:center;gap:12px;padding:13px 24px;border-bottom:1px solid var(--line)')}>
            <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>BRIEF</span>
            <span style={{ ...sx('color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>projects/{proj.id}/brief.md</span>
            <div style={sx('margin-left:auto;display:flex;gap:10px;font-size:11px;align-items:center')}>
              {!S.briefEdit && <span onClick={() => this.setState({ briefEdit: true, briefDraft: proj.brief || '' })} className="hAccent" style={sx('color:var(--accent);cursor:pointer;font-weight:600')}>Edit</span>}
              {S.briefEdit && <span onClick={() => this.setState({ briefEdit: false })} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer')}>Cancel</span>}
              {S.briefEdit && <span onClick={() => this.saveBrief()} className="hBtnAccent" style={sx('padding:4px 14px;border-radius:6px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer')}>Save</span>}
            </div>
          </div>
          <div style={sx('padding:30px 36px 34px')}>
            {S.briefEdit
              ? <textarea value={S.briefDraft} onChange={e => this.setState({ briefDraft: e.target.value })} autoFocus onKeyDown={e => e.stopPropagation()}
                  style={sx('width:100%;box-sizing:border-box;height:440px;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:10px;color:var(--fg);font-size:13.5px;line-height:1.75;padding:18px 20px')} />
              : <Md src={proj.brief || '*No brief yet — hit **Edit** and write the core direction once. Every agent run reads it verbatim.*'} style={{ fontSize: '13.5px' }} />}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;padding:10px 24px;border-top:1px solid var(--line);font-size:10.5px;color:var(--fg-faint)')}>
            <span style={sx('width:6px;height:6px;border-radius:99px;background:var(--accent)')} />
            Read verbatim at the start of every background agent run — re-rolls, renders, skill jobs.
          </div>
        </div>
      </div>
    );
  }

  notesPane() {
    const { proj } = this.props; const S = this.state;
    const docs = ((proj.context || {}).items || []).filter(c => !(c.type === 'image' || c.type === 'video'));
    const docCard = c => (
      <div key={(c.folder || '') + '/' + c.name} className="hBd" style={sx('display:flex;gap:12px;align-items:flex-start;border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--surface)')}>
        <span style={sx('width:38px;height:38px;border-radius:9px;background:var(--surface-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px;flex:none')}>{CTX_ICON[c.type] || CTX_ICON.file}</span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            <a href={api.contextUrl(proj.id, c.name, c.folder)} target="_blank" rel="noreferrer" style={{ ...sx('font-size:11.5px;color:var(--fg);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO }}>{c.name}</a>
            <span style={sx('font-size:8.5px;font-weight:700;letter-spacing:.08em;color:var(--fg-muted);border:1px solid var(--border-2);border-radius:4px;padding:1px 6px;flex:none;text-transform:uppercase')}>{c.type}</span>
            {c.folder && <span style={{ ...sx('font-size:8.5px;color:var(--accent);border:1px solid var(--accent-35);border-radius:4px;padding:1px 6px;flex:none'), fontFamily: MONO }}>{c.folder}</span>}
            <span style={sx('margin-left:auto;font-size:9.5px;color:var(--fg-faint);flex:none')}>{fmtKB(c.size)}</span>
            {(c.type === 'note' || c.type === 'text') && <span onClick={() => this.editNote(c)} className="hAccent" style={sx('font-size:11px;color:var(--accent);cursor:pointer;flex:none')} title="Edit in place">✎</span>}
            <span onClick={() => this.del(c)} className="hDel" style={sx('font-size:11px;color:var(--danger);cursor:pointer;flex:none')}>&#10005;</span>
          </div>
          {c.excerpt && <div style={sx('font-size:11px;color:var(--fg-muted);line-height:1.5;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden')}>{c.excerpt}</div>}
        </div>
      </div>
    );
    return (
      <div style={sx('padding:20px 28px 0')}
        onDragOver={e => { e.preventDefault(); }} onDrop={e => { e.preventDefault(); this.upload([...e.dataTransfer.files]); }}>
        <input ref={this.fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => { this.upload([...e.target.files]); e.target.value = ''; }} />
        {S.noteOpen && (
          <div style={sx('border:1px solid var(--accent-35);border-radius:12px;background:var(--surface);padding:14px 16px;margin-bottom:14px')}>
            <input value={S.noteName} onChange={e => this.setState({ noteName: e.target.value })} placeholder="note name (e.g. client-feedback)" autoFocus onKeyDown={e => e.stopPropagation()}
              style={sx('width:100%;box-sizing:border-box;background:transparent;border:none;color:var(--fg);font-size:12.5px;font-weight:700;margin-bottom:7px')} />
            <textarea value={S.noteText} onChange={e => this.setState({ noteText: e.target.value })} onKeyDown={e => e.stopPropagation()} placeholder="Markdown supported — the agent reads this verbatim."
              style={sx('width:100%;box-sizing:border-box;height:88px;resize:vertical;background:transparent;border:none;color:var(--fg-soft);font-size:12px;line-height:1.55')} />
            <div style={sx('display:flex;gap:8px;justify-content:flex-end;font-size:11px;align-items:center')}>
              {S.noteReplace && <span style={{ ...sx('margin-right:auto;font-size:9.5px;color:var(--fg-faint)'), fontFamily: MONO }}>editing context/{S.noteReplace.folder ? S.noteReplace.folder + '/' : ''}{S.noteReplace.name}</span>}
              <span onClick={() => this.setState({ noteOpen: false, noteReplace: null })} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer;padding:4px 9px')}>Cancel</span>
              <span onClick={() => this.saveNote()} className="hBtnAccent" style={sx('padding:4px 12px;border-radius:6px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer')}>{S.noteReplace ? 'Save note' : 'Add note'}</span>
            </div>
          </div>
        )}
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:12px')}>{docs.map(docCard)}</div>
        <div onClick={() => this.fileRef.current && this.fileRef.current.click()} className="hBdAccent" style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:22px;text-align:center;cursor:pointer;margin-top:14px')}>
          <div style={sx('font-size:11.5px;color:var(--fg-muted);font-weight:600')}>Drop scripts, PDFs, reference docs here — or click to upload</div>
          <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:3px')}>Stored in <span style={{ fontFamily: MONO, fontSize: 9.5 }}>projects/{proj.id}/context/</span> · injected into every agent run</div>
        </div>
      </div>
    );
  }

  memoryPane() {
    const { proj } = this.props; const S = this.state;
    const mem = S.mem || { body: '', updated: '' };
    return (
      <div style={sx('padding:20px 28px 0')}>
        {/* quick-append */}
        <div style={sx('display:flex;align-items:center;gap:10px;border:1px solid var(--accent-35);border-radius:10px;background:var(--surface);padding:8px 12px;margin-bottom:14px')}>
          <span style={sx('font-size:9px;font-weight:700;letter-spacing:.12em;color:var(--fg-muted);flex:none')}>REMEMBER</span>
          <input value={S.append} onChange={e => this.setState({ append: e.target.value })}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.appendMemory(); }}
            placeholder="remember this…  ⏎ prepends a dated bullet to the doc"
            style={sx('flex:1;background:transparent;border:none;color:var(--fg);font-size:12.5px')} />
          <span onClick={() => this.appendMemory()} className={S.append.trim() ? 'hBtnAccent' : ''} style={{ ...sx('padding:4px 12px;border-radius:6px;font-weight:700;font-size:11px;cursor:pointer'), background: S.append.trim() ? 'var(--accent)' : 'var(--border-2)', color: S.append.trim() ? 'var(--on-accent)' : 'var(--fg-faint)', cursor: S.append.trim() ? 'pointer' : 'not-allowed' }}>Add</span>
        </div>
        <div style={{ ...sx('border-radius:14px;background:var(--surface);overflow:hidden'), border: S.memEdit ? '1px solid var(--accent-35)' : '1px solid var(--border)' }}>
          <div style={sx('display:flex;align-items:center;gap:12px;padding:13px 24px;border-bottom:1px solid var(--line)')}>
            <span style={sx('font-size:10.5px;font-weight:700;letter-spacing:.16em;color:var(--fg-muted)')}>MEMORY</span>
            <span style={{ ...sx('color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>projects/{proj.id}/memory.md</span>
            {mem.updated && <span style={sx('font-size:10px;color:var(--fg-faint)')}>· updated {mem.updated}</span>}
            <div style={sx('margin-left:auto;display:flex;gap:10px;font-size:11px;align-items:center')}>
              {!S.memEdit && <span onClick={() => this.setState({ memEdit: true, memDraft: mem.body || '' })} className="hAccent" style={sx('color:var(--accent);cursor:pointer;font-weight:600')}>Edit</span>}
              {S.memEdit && <span onClick={() => this.setState({ memEdit: false })} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer')}>Cancel</span>}
              {S.memEdit && <span onClick={() => this.saveMemory()} className="hBtnAccent" style={sx('padding:4px 14px;border-radius:6px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer')}>Save</span>}
            </div>
          </div>
          <div style={sx('padding:24px 30px 28px')}>
            {S.memEdit
              ? <textarea value={S.memDraft} onChange={e => this.setState({ memDraft: e.target.value })} autoFocus onKeyDown={e => e.stopPropagation()}
                  style={sx('width:100%;box-sizing:border-box;height:360px;resize:vertical;background:var(--sunk);border:1px solid var(--border-2);border-radius:10px;color:var(--fg);font-size:13px;line-height:1.7;padding:16px 18px')} />
              : (mem.body
                  ? <Md src={mem.body} style={{ fontSize: '13px' }} />
                  : <div style={sx('padding:30px 0;text-align:center')}>
                      <div style={{ ...sx('font-size:10.5px;font-weight:700;letter-spacing:.14em;color:var(--fg-soft)'), fontFamily: MONO }}>NOTHING REMEMBERED YET</div>
                      <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-top:6px')}>Use “remember this…” above, or Edit to write the hot cache for this project.</div>
                    </div>)}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;padding:10px 24px;border-top:1px solid var(--line);font-size:10.5px;color:var(--fg-faint)')}>
            <span style={sx('width:6px;height:6px;border-radius:99px;background:var(--accent)')} />
            Injected into every agent run alongside the brief — the running notes for a bigger project.
          </div>
        </div>
      </div>
    );
  }

  render() {
    const { app, proj } = this.props;
    const items = (proj.context || {}).items || [];
    const folders = (proj.context || {}).folders || [];
    const moodFolders = refFoldersOf(folders, this.state.overrides);
    const moodCount = items.filter(c => (c.type === 'image' || c.type === 'video') && (moodFolders.includes(c.folder || '') || !(c.folder || ''))).length;
    const docCount = items.filter(c => !(c.type === 'image' || c.type === 'video')).length;
    const sub = this.sub();
    return (
      <div style={sx('position:relative;padding-bottom:20px')}>
        <div style={sx('display:flex;align-items:center;gap:24px;padding:0 28px;border-bottom:1px solid var(--line)')}>
          {this.subTab('brief', 'Brief', null)}
          {this.subTab('moods', 'Moods', moodCount)}
          {this.subTab('notes', 'Notes', docCount)}
          {this.subTab('memory', 'Memory', null)}
          <div style={sx('margin-left:auto;display:flex;gap:8px;align-items:center;padding:6px 0')}>
            {sub === 'notes' && <div onClick={() => this.setState({ noteOpen: true, noteName: '', noteText: '', noteReplace: null })} className="hBdAccent" style={sx('padding:5px 12px;border:1px solid var(--accent-35);border-radius:7px;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer')}>+ Note</div>}
          </div>
        </div>

        {sub === 'brief' && this.briefPane()}
        {sub === 'moods' && (
          <div style={sx('padding:20px 28px 0')}>
            <BoardGrid app={app} proj={proj} folders={moodFolders} showRoot rootLabel="Unsorted" side="reference"
              railLabel="MOOD BOARDS" onReclass={(f, k) => this.reclass(f, k)} emptyText="No mood boards yet" />
          </div>
        )}
        {sub === 'notes' && this.notesPane()}
        {sub === 'memory' && this.memoryPane()}
      </div>
    );
  }

  async reclass(folder, kind) {
    try { const r = await api.setFolderKind(this.props.proj.id, folder, kind); this.setState({ overrides: r.kinds || {} }); this.props.app.showToast(folder + ' → ' + (kind === 'asset' ? 'Assets' : 'References'), 'var(--ok)'); }
    catch { this.props.app.showToast('Could not reclassify board', 'var(--danger)'); }
  }
}
