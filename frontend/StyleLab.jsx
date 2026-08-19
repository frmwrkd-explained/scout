// Style Lab — THE style surface. One window, one record, one grammar.
//
// This replaced three overlapping surfaces that all did the same job with different windows:
//   StyleStudio    — the composer's Style/Camera overlay (presets + axes, lossy save)
//   StyleLocks     — a separate Tools page with its own list, editor and duplicate fetch client
//   StyleLockPicker— a separate `s` overlay that could only pick, never build
// All three files are gone (the last two were deleted 2026-08-02, after sitting importerless).
// PromptBuilder.jsx is a FOURTH axis picker over the same AXES and it is still live — Tools.jsx
// mounts it as the `builder` tool. Folding it in here is real remaining work, not a done deal;
// do not write it up as replaced until Tools.jsx stops importing it.
//
// The premise: A STYLE IS A PROMPT-BUILDER COMPOSITION. Not a blob of prose that happens to be
// saved. So a style persists the picks it was built from (see lookBuilder.lockPayload) and loads
// straight back into the axis grid (lookBuilder.styleFromLock). Save a look, reopen it, keep
// composing — the grid is exactly where you left it. The assembled fragment is still what
// generation consumes, and a legacy or imported lock that only HAS a fragment still works.
//
// Two mounts, one component:
//   overlay (default) — from the composer's Style/Camera pills and the global `s` key
//   page  (page)      — Tools → Styles, same UI without the modal chrome
//
// Everything is draft state: props.style / props.camera are cloned in the constructor and never
// written back until Apply, because Cancel has to actually discard.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { AXES } from './models';
import { CAMERA_MOVEMENTS, MOVE_CATEGORIES, MOVE_SPEEDS, MOVE_STABILIZATIONS } from './cameraMovements';
import { Diagram } from './CameraMoves';
import { MONO } from './tokens';
import {
  styleAxes, cameraAxes, emptyStyle, emptyCamera,
  styleFragment, cameraFragment, styleLabel, cameraLabel,
  applyPreset, styleFromLock, cameraFromLock, lockPayload, fullFragment, isStyleEmpty,
  countPicks, LOOK_PRESETS
} from './lookBuilder';

const AMBER = 'var(--accent)';
const GREEN = 'var(--ok)';
const DANGER = 'var(--danger)';

// How many tokens an axis shows before it asks to be expanded. The catalog runs 20-49 tokens per
// axis across twelve axes; rendering all of them at once is what made this panel read as a wall.
// One row is enough to communicate what the axis IS and to cover the common picks — the rest is
// one click away, and nothing has been removed from the catalog to achieve it.
const COLLAPSED_TOKENS = 7;

const TABS = [['styles', 'MY STYLES'], ['style', 'STYLE'], ['camera', 'CAMERA']];

// picks live in state and get spread on every toggle — a shallow copy would alias the
// caller's arrays and make Cancel a lie.
const clonePicks = p => Object.fromEntries(Object.entries(p || {}).map(([k, v]) => [k, (v || []).slice()]));
const cloneSel = (sel, fallback) => (sel ? { ...sel, picks: clonePicks(sel.picks) } : fallback());

const axisMax = key => { const a = AXES.find(x => x.key === key); return a ? a.max : 1; };
const favFirst = (a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || ''));

export default class StyleLab extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      // A page mount has no composer to apply to, so it opens on the library rather than on the
      // axis grid; an overlay opens wherever the caller pointed it.
      tab: props.tab || 'styles',
      style: cloneSel(props.style, emptyStyle),
      camera: cloneSel(props.camera, emptyCamera),
      // Non-null only after a preset or a saved style set it: presets also decide frame shape,
      // and silently changing the composer's aspect on any other path would be rude.
      aspect: null,

      // axKey -> true once the user asks to see the whole axis. Deliberately NOT persisted: the
      // panel should open calm every time, not remember that you once opened Look & Feel's 49.
      expanded: {},

      // ── the save panel ──
      saving: false,
      editingId: null,   // set when the draft came from a saved style, so SAVE updates in place
      name: '', tags: '', fav: false,
      savedRefImage: null,   // the stored thumb of the style being edited (server-side filename)
      clearRef: false,       // user removed the stored thumb — must travel to the server on save
      previewData: null,     // a freshly rendered preview, held until save (never orphans a file)
      previewBusy: false, previewErr: '',
      busy: false,
      q: ''
    };
    this._key = e => {
      // The Tools mount is a PAGE, not a modal: it sits in the normal app chrome with nothing on
      // top of it, so every global key has to keep working there. Only the two overlay mounts
      // (the composer's Style/Camera pills, App's global `s`) own the keyboard.
      if (this.props.page) return;
      const t = e.target;
      const typing = !!t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);

      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        // Escape inside a field is the universal "let go of this field" reflex, and it is what
        // App.jsx trains everywhere else in the app (it blurs on Escape while typing). Here it
        // used to close the panel and take the whole draft with it — every pick and every
        // character, unconfirmed. Blur first; dismissing costs a second press, by which point
        // the user is aiming at the panel rather than at the box they were typing in.
        if (typing) { t.blur && t.blur(); return; }
        // the save panel is the inner-most dismissable thing — unwind it before the panel
        if (this.state.saving) this.closeSave();
        else this.props.onClose && this.props.onClose();
        return;
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); e.stopPropagation();
        // With the save panel open, ⌘⏎ is a commit gesture aimed at the half-typed name sitting
        // in front of the user. Applying and closing there abandons that name to do something
        // they did not ask for, so the panel — the innermost thing — claims the shortcut.
        if (this.state.saving) this.save(); else this.apply();
        return;
      }
      // An open overlay OWNS the keyboard, same contract as the command palette. Without this,
      // a bare letter still reached App's global keymap: pressing `s` a second time re-fired the
      // style shortcut and stacked a second lab on top of this one, and — far worse — `1`–`5`
      // switched the project tab, which unmounts ProjectGenerate underneath and destroys the
      // typed prompt, the attached references, the seed, the target shot and this draft with no
      // confirmation. i/q/m/g change route for the same total loss. Focus is on <body> the
      // moment you click a preset card or a token tile, so that is the ordinary state here.
      //
      // Typing is exempt, and it has to be: this listener is capture-phase on WINDOW, so
      // stopping the event means it never reaches React's root container and the focused
      // field's own onKeyDown never runs. App's keymap already checks the same
      // INPUT/TEXTAREA/SELECT/contentEditable set and bails, so letting those through is safe.
      // Modifier combos stay live so ⌘K, ⌘R and the OS keep working.
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      e.stopPropagation();
    };
  }
  // capture phase so the composer's own document-level keymap never sees these while the
  // lab is the thing the user is looking at
  componentDidMount() { window.addEventListener('keydown', this._key, true); }
  componentWillUnmount() { window.removeEventListener('keydown', this._key, true); }

  locks() { return ((this.props.locks || this.props.app.state.styleLocks || [])).slice().sort(favFirst); }
  toast(msg, color) { const a = this.props.app; a && a.showToast && a.showToast(msg, color); }
  reload() { const a = this.props.app; a && a.reloadStyleLocks && a.reloadStyleLocks(); }

  apply() {
    const S = this.state;
    this.props.onApply && this.props.onApply({ style: S.style, camera: S.camera, aspect: S.aspect });
    this.props.onClose && this.props.onClose();
  }

  setStyle(patch) { this.setState(s => ({ style: { ...s.style, ...patch } })); }
  setCamera(patch) { this.setState(s => ({ camera: { ...s.camera, ...patch } })); }

  // Toggle a token inside an axis, honouring the axis `max`. When the ceiling is hit we drop
  // the OLDEST selection and take the new one rather than refusing the click: a dead click
  // with no visible reason reads as a broken UI, and the user's most recent intent is the
  // one most likely to be right.
  togglePick(group, axKey, name) {
    this.setState(s => {
      const sel = s[group];
      const cur = (sel.picks[axKey] || []).slice();
      const next = cur.includes(name) ? cur.filter(t => t !== name) : [...cur, name].slice(-axisMax(axKey));
      const picks = { ...sel.picks, [axKey]: next };
      // Touching an axis by hand means the user has left the preset (and any hand-edited
      // fragment) behind, so the summary stops claiming a look it no longer is. It does NOT
      // clear editingId: editing a saved style's axes and hitting SAVE should update that
      // style, which is the whole reason picks are persisted.
      const patch = group === 'style' ? { picks, presetId: null, override: null, edited: false } : { picks };
      return { [group]: { ...sel, ...patch } };
    });
  }

  usePreset(id) {
    const r = applyPreset(id);
    if (!r) return;
    // A preset is a starting point, not a saved style — so it drops any edit target. Saving
    // after this creates a new style rather than overwriting the one that was loaded.
    this.setState({
      style: r.style, camera: r.camera, aspect: r.aspect, tab: 'style',
      editingId: null, savedRefImage: null, previewData: null, clearRef: false,
      name: '', tags: '', fav: false
    });
  }

  // Load a saved style back INTO the builder. With picks persisted this restores the axis grid;
  // a legacy lock with only a fragment still lands as editable override prose.
  useLock(l) {
    const cam = cameraFromLock(l);
    this.setState(s => ({
      style: styleFromLock(l),
      camera: cam || s.camera,
      aspect: l.aspect || null,
      editingId: l.id || null,
      name: l.name || '',
      tags: (l.tags || []).join(', '),
      fav: !!l.fav,
      savedRefImage: l.refImage ? l.id : null,
      previewData: null, previewErr: '', clearRef: false,
      tab: 'style'
    }));
  }

  newStyle() {
    this.setState({
      style: emptyStyle(), camera: emptyCamera(), aspect: null,
      editingId: null, name: '', tags: '', fav: false,
      savedRefImage: null, previewData: null, previewErr: '', clearRef: false,
      saving: false, tab: 'style'
    });
  }

  openSave() {
    // Seed the name from whatever identifies the look, so the common case is one keystroke.
    this.setState(s => {
      const label = styleLabel(s.style);
      return { saving: true, name: s.name || (label && label !== 'No style' ? label : '') };
    });
  }
  closeSave() { this.setState({ saving: false, previewErr: '' }); }

  // The whole style as one prompt clause — what a preview renders and what gets saved. Shared
  // with lockPayload so the previewed look and the stored fragment can never drift apart.
  fullFragment() { return fullFragment(this.state.style, this.state.camera); }

  async makePreview() {
    if (this.state.previewBusy) return;
    const fragment = this.fullFragment();
    if (!fragment) { this.setState({ previewErr: 'Pick some options first — there is nothing to render yet.' }); return; }
    this.setState({ previewBusy: true, previewErr: '' });
    try {
      const r = await api.styleLockPreview({ fragment, aspect: this.state.aspect || '16:9' });
      this.setState({ previewData: r.dataUrl, previewBusy: false });
      this.toast('Preview rendered · $' + Number(r.cost || 0).toFixed(3), GREEN);
    } catch (e) {
      this.setState({ previewBusy: false, previewErr: e.message });
    }
  }

  async save() {
    const S = this.state;
    // An id-less POST always CREATES, so a second submit in flight would file a duplicate style
    // rather than update the first. Guard here, not only on the button — Enter reaches this too.
    if (S.busy) return;
    const name = S.name.trim();
    if (!name) { this.setState({ previewErr: 'Name the style first.' }); return; }
    const payload = lockPayload(S.style, S.camera, S.aspect);
    if (!payload.fragment) { this.setState({ previewErr: 'This style is empty — pick some options first.' }); return; }
    this.setState({ busy: true, previewErr: '' });
    try {
      const rec = await api.saveStyleLock({
        id: S.editingId || undefined,
        name,
        tags: S.tags.split(',').map(t => t.trim()).filter(Boolean),
        fav: S.fav,
        ...payload,
        // a freshly rendered preview persists through the ordinary ref-image path
        refImageData: S.previewData || undefined,
        // ...and removing the thumb has to be said out loud, or the server keeps the old one
        clearRefImage: (!S.previewData && S.clearRef) || undefined
      });
      this.toast((S.editingId ? 'Style updated — ' : 'Style saved — ') + rec.name, GREEN);
      // Functional updater: the axis grid stays live during the request, so anything the user
      // toggled while it was in flight must survive. Spreading the pre-await snapshot silently
      // reverted it.
      this.setState(s => ({
        busy: false, saving: false,
        editingId: rec.id,
        savedRefImage: rec.refImage ? rec.id : null,
        previewData: null, clearRef: false,
        // the style is now attributable again — the header pill should say its name
        // edited:false — whatever the fragment says is now exactly what this saved style IS, so
        // the pill goes back to naming it plainly instead of flagging it as a departure from it.
        style: { ...s.style, lockId: rec.id, lockName: rec.name, edited: false }
      }));
      this.reload();
      this.props.onSaved && this.props.onSaved(rec);
    } catch (e) {
      this.setState({ busy: false, previewErr: e.message });
    }
  }

  async toggleFav(l, e) {
    e && e.stopPropagation();
    try { await api.favStyleLock(l.id, !l.fav); this.reload(); } catch { /* best effort */ }
  }
  async del(l, e) {
    e && e.stopPropagation();
    try {
      await api.deleteStyleLock(l.id);
      this.toast('Style deleted — undo from the Trash', AMBER);
      if (this.state.editingId === l.id) this.setState({ editingId: null, savedRefImage: null });
      this.reload();
    } catch (err) { this.toast('Delete failed — ' + err.message, DANGER); }
  }

  // ————— shared atoms —————
  eyebrow(t, right) {
    return (
      <div style={sx('display:flex;align-items:baseline;gap:9px;margin-bottom:9px')}>
        <span style={{ ...sx('font-weight:800;text-transform:uppercase'), fontSize: 10, letterSpacing: '.14em', color: 'var(--fg-muted)' }}>{t}</span>
        {right}
      </div>
    );
  }

  // One tile footprint for every token, image-backed or not, so a mixed strip stays on a grid.
  tokenTile(group, axKey, tok, on) {
    return (
      <div key={tok.t} onClick={() => this.togglePick(group, axKey, tok.t)} title={tok.d || tok.t}
        className={on ? '' : 'hBd'} style={sx('flex:none;width:92px;cursor:pointer')}>
        {tok.img
          ? <img src={tok.img} alt="" loading="lazy" decoding="async"
            style={{ ...sx('width:92px;height:62px;object-fit:cover;display:block;border-radius:8px;background:var(--sunk)'), border: '1.5px solid ' + (on ? AMBER : 'var(--border)') }} />
          : <div style={{ ...sx('width:92px;height:62px;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:8px;background:var(--sunk);padding:0 6px;box-sizing:border-box;line-height:1.35'), border: '1.5px solid ' + (on ? AMBER : 'var(--border)'), fontSize: 10.5, color: on ? AMBER : 'var(--fg-soft)' }}>{tok.t}</div>}
        <div style={{ ...sx('margin-top:5px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 10, color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{tok.t}</div>
      </div>
    );
  }

  toggleAxis(key) {
    this.setState(s => ({ expanded: { ...s.expanded, [key]: !s.expanded[key] } }));
  }

  // An axis rendered as a wrapping grid, truncated to one row until asked to open.
  //
  // This used to be a horizontal scroll strip showing every token. That trades one problem for a
  // worse one: the axis still costs a full row of visual weight, the tokens past the fold are
  // invisible AND unreachable without a horizontal scroll gesture nobody discovers, and twelve of
  // these stacked is the wall of thumbnails this panel became. Truncating instead means the page
  // shows twelve legible axes, and depth is an explicit request rather than an ambush.
  //
  // Picked tokens are hoisted to the front so a selection can never end up hidden behind '+13'
  // — a pick you cannot see reads as a pick that did not register. Array#sort is stable, so
  // catalog order survives underneath the hoist.
  axisStrip(group, ax) {
    const picks = this.state[group].picks[ax.key] || [];
    const open = !!this.state.expanded[ax.key];
    const ordered = picks.length
      ? [...ax.tokens].sort((a, b) => (picks.includes(b.t) ? 1 : 0) - (picks.includes(a.t) ? 1 : 0))
      : ax.tokens;
    const shown = open ? ordered : ordered.slice(0, COLLAPSED_TOKENS);
    const hidden = ax.tokens.length - shown.length;
    return (
      <div key={ax.key} style={sx('margin-bottom:16px')}>
        {this.eyebrow(ax.name, <span style={{ fontFamily: MONO, fontSize: 9.5, color: picks.length ? AMBER : 'var(--fg-faint)' }}>{picks.length}/{ax.max}</span>)}
        <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
          {shown.map(tok => this.tokenTile(group, ax.key, tok, picks.includes(tok.t)))}
          {(hidden > 0 || open) && (
            // same 92x62 footprint as a tile so the grid stays on its rhythm
            <div onClick={() => this.toggleAxis(ax.key)} className="hBd"
              title={open ? 'Show fewer' : `Show all ${ax.tokens.length} ${ax.name.toLowerCase()} options`}
              style={{ ...sx('flex:none;width:92px;height:62px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--sunk);cursor:pointer;text-align:center'), border: '1.5px dashed var(--border-2)', fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>
              {open ? '− less' : `+${hidden} more`}
            </div>
          )}
        </div>
      </div>
    );
  }

  // The escape hatch that makes 'not locked' concrete: the assembled fragment is text, and
  // text is editable. An override parks in style.override and wins over the picks downstream —
  // including when it is empty, which is the user saying "send no style clause at all".
  fragmentBlock(text, editable) {
    const S = this.state;
    const overridden = editable && S.style.override != null;
    // Reverting is only an offer worth making when there are picks underneath to revert TO. On a
    // legacy lock — prose and nothing else — it would clear the box and leave a dead end.
    const revertable = overridden && countPicks(S.style) > 0;
    return (
      <div style={sx('margin-top:4px;border:1px solid var(--border);border-radius:10px;background:var(--sunk);overflow:hidden')}>
        <div style={sx('display:flex;align-items:center;gap:10px;padding:9px 13px;border-bottom:1px solid var(--line)')}>
          <span style={{ ...sx('font-weight:800;text-transform:uppercase'), fontSize: 9.5, letterSpacing: '.14em', color: overridden ? AMBER : 'var(--fg-faint)' }}>Fragment</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{text ? text.split(/\s+/).filter(Boolean).length + ' words' : 'empty'}</span>
          {revertable && <span onClick={() => this.setStyle({ override: null, edited: false })} className="hFg"
            style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-muted)' }}>↺ back to picks</span>}
        </div>
        {editable
          // edited:true is what stops the STYLE pill from going on calling this look by the name
          // of the preset it no longer contains — see lookBuilder.styleLabel.
          ? <textarea value={text} onChange={e => this.setStyle({ override: e.target.value, edited: true })}
            onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return; e.stopPropagation(); }}
            placeholder="Pick tokens above, or write the style clause yourself — it is appended to your prompt."
            style={{ ...sx('width:100%;box-sizing:border-box;height:76px;resize:vertical;background:transparent;border:none;color:var(--fg-soft);line-height:1.7;padding:11px 13px'), fontFamily: MONO, fontSize: 11 }} />
          : <div style={{ ...sx('padding:11px 13px;line-height:1.7;color:var(--fg-soft);min-height:46px'), fontFamily: MONO, fontSize: 11 }}>{text || <span style={{ color: 'var(--fg-faint)' }}>No camera direction yet — pick framing, a lens or a body above.</span>}</div>}
      </div>
    );
  }

  // ————— MY STYLES —————
  renderLibrary() {
    const S = this.state;
    const q = S.q.trim().toLowerCase();
    const locks = this.locks().filter(l => !q || ((l.name || '') + ' ' + (l.tags || []).join(' ')).toLowerCase().includes(q));
    return (
      <div>
        <div style={sx('display:flex;align-items:center;gap:12px;margin-bottom:12px')}>
          <span style={{ ...sx('font-weight:800;text-transform:uppercase'), fontSize: 10, letterSpacing: '.14em', color: 'var(--fg-muted)' }}>Your styles</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>{locks.length}</span>
          <input value={S.q} onChange={e => this.setState({ q: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') return; e.stopPropagation(); }}
            placeholder="Filter by name or tag…"
            style={{ ...sx('width:190px;background:var(--ink);border:1px solid var(--border);border-radius:7px;color:var(--fg);padding:5px 10px'), fontFamily: MONO, fontSize: 10 }} />
          <span onClick={() => this.newStyle()} className="hBtnAccent"
            style={{ ...sx('margin-left:auto;padding:5px 14px;border-radius:6px;cursor:pointer;font-weight:700'), background: AMBER, color: 'var(--on-accent)', fontFamily: MONO, fontSize: 10 }}>+ NEW STYLE</span>
        </div>

        {!locks.length && (
          <div style={sx('font-size:11.5px;color:var(--fg-faint);line-height:1.7;padding:14px 16px;border:1px dashed var(--border);border-radius:10px;margin-bottom:22px')}>
            {S.q
              ? <span style={{ ...sx('font-weight:700;letter-spacing:.1em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10.5 }}>NO STYLE MATCHES THAT FILTER</span>
              : <>Nothing saved yet. Hit <span style={{ color: AMBER }}>+ NEW STYLE</span> to build one from the axes — or start from a preset below and save it. You can render a preview image for any style as you create it.</>}
          </div>
        )}

        {!!locks.length && (
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px;margin-bottom:24px')}>
            {locks.map(l => {
              const on = S.editingId === l.id || S.style.lockId === l.id;
              const editable = !!(l.picks && Object.keys(l.picks).length);
              return (
                <div key={l.id} onClick={() => this.useLock(l)} className={on ? '' : 'hBd'}
                  style={{ ...sx('border-radius:10px;background:var(--surface);overflow:hidden;cursor:pointer;position:relative'), border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                  {l.refImage
                    ? <img src={api.styleLockRefUrl(l.id)} alt="" loading="lazy" decoding="async"
                      style={sx('width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--surface-2)')} />
                    : <div style={{ ...sx('width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--border-2)'), fontFamily: MONO, fontSize: 22 }}>◈</div>}
                  <span onClick={e => this.toggleFav(l, e)} className="hAccent"
                    style={{ ...sx('position:absolute;top:7px;left:8px;cursor:pointer;text-shadow:0 1px 4px rgba(0,0,0,.8)'), fontSize: 13, color: l.fav ? AMBER : 'rgba(236,238,242,.55)' }}>{l.fav ? '★' : '☆'}</span>
                  <span onClick={e => this.del(l, e)} className="hFgL"
                    style={{ ...sx('position:absolute;top:7px;right:8px;cursor:pointer;text-shadow:0 1px 4px rgba(0,0,0,.8)'), fontSize: 11, color: 'rgba(236,238,242,.55)' }}>✕</span>
                  {on && <span style={{ ...sx('position:absolute;top:calc(56.25% - 20px);left:8px;padding:2px 7px;border-radius:99px;font-weight:800'), background: AMBER, color: 'var(--on-accent)', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em' }}>✓ LOADED</span>}
                  <div style={sx('padding:9px 11px 11px')}>
                    <div style={{ ...sx('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 12.5, color: on ? AMBER : 'var(--fg)' }}>{l.name}</div>
                    <div style={sx('display:flex;gap:4px;margin-top:5px;flex-wrap:wrap;align-items:center')}>
                      {(l.tags || []).slice(0, 3).map(t => (
                        <span key={t} style={{ ...sx('padding:1px 7px;border-radius:99px'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-muted)', border: '1px solid var(--border-2)' }}>{t}</span>
                      ))}
                      {/* A legacy lock has prose but no picks — say so, because clicking it will
                          fill the fragment box instead of the axis grid. */}
                      {!editable && <span title="Saved before styles carried their picks — loads as editable text, not as axis selections."
                        style={{ ...sx('padding:1px 7px;border-radius:99px'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', border: '1px solid var(--border-2)' }}>text only</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {this.eyebrow('Start from a preset', <span style={sx('font-size:11px;color:var(--fg-faint)')}>a whole look in one click — then edit it in STYLE and save it as your own</span>)}
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px')}>
          {LOOK_PRESETS.map(p => {
            const on = S.style.presetId === p.id;
            // p.aspect, not applyPreset(p.id).aspect — the aspect is fixed per preset, and
            // rebuilding two selection objects per card on every render to read one string was
            // seven throwaway applyPreset() calls a keystroke. LOOK_PRESETS bakes it in once.
            const asp = p.aspect;
            return (
              <div key={p.id} onClick={() => this.usePreset(p.id)} className={on ? '' : 'hBd'}
                style={{ ...sx('border-radius:10px;background:var(--surface);overflow:hidden;cursor:pointer;position:relative'), border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                <img src={p.img} alt="" loading="lazy" decoding="async"
                  onError={e => { e.target.style.visibility = 'hidden'; }}
                  style={sx('width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--surface-2)')} />
                {on && <span style={{ ...sx('position:absolute;top:8px;left:8px;padding:2px 7px;border-radius:99px;font-weight:800'), background: AMBER, color: 'var(--on-accent)', fontFamily: MONO, fontSize: 8.5, letterSpacing: '.1em' }}>✓ ACTIVE</span>}
                {asp && <span style={{ ...sx('position:absolute;top:8px;right:8px;padding:2px 7px;border-radius:4px'), background: 'rgba(10,11,14,.82)', border: '1px solid var(--border-2)', color: 'var(--fg-soft)', fontFamily: MONO, fontSize: 9 }}>{asp}</span>}
                <div style={sx('padding:9px 11px 11px')}>
                  <div style={{ ...sx('font-weight:700'), fontSize: 12.5, color: on ? AMBER : 'var(--fg)' }}>{p.name}</div>
                  <div style={sx('font-size:11px;color:var(--fg-faint);line-height:1.5;margin-top:3px')}>{p.blurb}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  renderStyleTab() {
    const S = this.state;
    const text = S.style.override != null ? S.style.override : styleFragment(S.style);
    return (
      <div>
        {styleAxes().map(ax => this.axisStrip('style', ax))}
        {this.fragmentBlock(text, true)}
      </div>
    );
  }

  renderCamera() {
    const S = this.state;
    const video = !!this.props.video;
    const framing = AXES.find(a => a.key === 'framing');
    const picked = S.camera.picks.framing || [];
    const lensAxes = cameraAxes().filter(a => a.key !== 'framing');
    const move = CAMERA_MOVEMENTS.find(m => m.id === S.camera.move) || null;
    return (
      <div>
        {/* Framing had its own hand-rolled copy of axisStrip purely because it was the one axis
            without thumbnails, so it needed a wrapping text grid while the rest scrolled. It has
            images now (see models.js), so it goes through the shared renderer and inherits the
            same collapse behaviour as every other axis. */}
        {framing && <div style={sx('margin-bottom:20px')}>{this.axisStrip('camera', framing)}</div>}

        <div style={sx('margin-bottom:4px')}>
          {this.eyebrow('Lens & body', <span style={sx('font-size:11px;color:var(--fg-faint)')}>glass and sensor — what the frame is shot on</span>)}
          {lensAxes.map(ax => this.axisStrip('camera', ax))}
        </div>

        <div style={sx('margin-bottom:16px')}>
          {this.eyebrow('Movement', video
            ? <span style={sx('font-size:11px;color:var(--fg-faint)')}>one continuous take — the move is written into the video prompt</span>
            : null)}
          {!video
            // Hiding this outright would read as a missing feature. Say where it went.
            ? <div style={sx('font-size:11px;color:var(--fg-faint);line-height:1.6;padding:10px 12px;border:1px dashed var(--border);border-radius:8px')}>Camera movement applies to video generations — a still frame has no motion. Switch the composer to a video model and the movement grid appears here.</div>
            : (
              <div>
                {MOVE_CATEGORIES.map(cat => {
                  const list = CAMERA_MOVEMENTS.filter(m => m.category === cat.id);
                  if (!list.length) return null;
                  return (
                    <div key={cat.id} style={sx('margin-bottom:12px')}>
                      <div style={{ ...sx('margin-bottom:7px;text-transform:uppercase'), fontFamily: MONO, fontSize: 9, letterSpacing: '.14em', color: 'var(--fg-faint)' }}>{cat.label}</div>
                      <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
                        {list.map(m => {
                          const on = S.camera.move === m.id;
                          return (
                            // clicking the active move clears it — the only way back to "no motion
                            // specified", which is not the same statement as Static.
                            <div key={m.id} onClick={() => this.setCamera({ move: on ? null : m.id })} title={m.description}
                              className={on ? '' : 'hBd'} style={{ ...sx('width:132px;border-radius:9px;background:var(--surface);padding:8px 9px 9px;cursor:pointer'), border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                              {/* m.diagram, never m.id — several movements share one schematic and the
                                  ids do not match the arrow keys (roll-clockwise → roll-cw). */}
                              <Diagram type={m.diagram} />
                              <div style={{ ...sx('margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10, color: on ? AMBER : 'var(--fg)', fontWeight: 600 }}>{m.name}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {move && (
                  <div style={sx('display:flex;gap:22px;flex-wrap:wrap;margin-top:14px;padding:12px 14px;border:1px solid var(--border);border-radius:9px;background:var(--surface)')}>
                    {[['Speed', MOVE_SPEEDS, 'speed'], ['Stabilization', MOVE_STABILIZATIONS, 'stabilization']].map(([label, opts, key]) => (
                      <div key={key}>
                        {this.eyebrow(label)}
                        <div style={sx('display:flex;gap:5px')}>
                          {opts.map(o => {
                            const on = S.camera[key] === o.id;
                            return (
                              <span key={o.id} onClick={() => this.setCamera({ [key]: o.id })} title={o.phrase}
                                style={{ ...sx('padding:4px 12px;border-radius:99px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'transparent', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border-2)'), fontWeight: on ? 700 : 400 }}>{o.label}</span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
        </div>

        {/* read-only: camera direction is assembled from the pickers above, there is no
            hand-edit path for it the way there is for style */}
        {this.fragmentBlock(cameraFragment(S.camera, { video }), false)}
      </div>
    );
  }

  // ————— save panel — name, tags, and the rendered preview —————
  renderSavePanel() {
    const S = this.state;
    const src = S.previewData || (S.savedRefImage ? api.styleLockRefUrl(S.savedRefImage) : null);
    return (
      <div style={sx('border-top:1px solid var(--line);background:var(--ink);padding:14px 22px;flex:none')}>
        <div style={sx('display:flex;gap:16px;align-items:flex-start')}>
          {/* preview */}
          <div style={sx('flex:none;width:168px')}>
            {src
              ? <img src={src} alt="" style={sx('width:168px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block;background:var(--surface-2);border:1px solid var(--border)')} />
              : <div style={{ ...sx('width:168px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--surface-2);border:1px dashed var(--border-2);color:var(--fg-faint);text-align:center;padding:0 10px;box-sizing:border-box;line-height:1.5'), fontFamily: MONO, fontSize: 9.5 }}>
                {S.previewBusy ? 'rendering…' : 'no preview yet'}
              </div>}
            <div style={sx('display:flex;gap:8px;align-items:center;margin-top:7px')}>
              <span onClick={() => this.makePreview()} className={S.previewBusy ? '' : 'hAccent'}
                style={{ ...sx('cursor:pointer;font-weight:700'), fontFamily: MONO, fontSize: 9.5, color: S.previewBusy ? 'var(--fg-faint)' : AMBER, letterSpacing: '.08em' }}>
                {S.previewBusy ? '◌ RENDERING…' : (src ? '✦ RE-RENDER' : '✦ GENERATE PREVIEW')}
              </span>
              {/* clearRef, not just local state: without it the save sends neither a new image
                  nor a clear flag, the server keeps the old one, and the thumbnail the user just
                  removed comes straight back. */}
              {src && !S.previewBusy && (
                <span onClick={() => this.setState({ previewData: null, savedRefImage: null, clearRef: true })} className="hFgL"
                  style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>clear</span>
              )}
            </div>
            <div style={{ ...sx('margin-top:5px;line-height:1.45'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>renders this look on a neutral subject · costs a generation</div>
          </div>

          {/* fields */}
          <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:10px')}>
            <div style={sx('display:flex;gap:10px')}>
              <div style={sx('flex:1;min-width:0')}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: 'var(--fg-muted)', marginBottom: 5 }}>NAME</div>
                <input autoFocus value={S.name} onChange={e => this.setState({ name: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.save(); return; } if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) return; e.stopPropagation(); }}
                  placeholder="e.g. Neon Noir Alley"
                  style={sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:12.5px;padding:8px 11px')} />
              </div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: 'var(--fg-muted)', marginBottom: 5 }}>TAGS · COMMA SEPARATED</div>
                <input value={S.tags} onChange={e => this.setState({ tags: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Escape') return; e.stopPropagation(); }}
                  placeholder="noir, night, anamorphic"
                  style={{ ...sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:8px 11px'), fontFamily: MONO, fontSize: 11 }} />
              </div>
              <div onClick={() => this.setState({ fav: !S.fav })} className="hBd"
                style={{ ...sx('flex:none;display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:7px;cursor:pointer;align-self:flex-end'), border: '1px solid ' + (S.fav ? 'var(--accent-35)' : 'var(--border-2)'), color: S.fav ? AMBER : 'var(--fg-faint)' }}>
                <span style={sx('font-size:13px')}>{S.fav ? '★' : '☆'}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700 }}>{S.fav ? 'FAVORITE' : 'FAVORITE'}</span>
              </div>
            </div>

            <div style={{ ...sx('line-height:1.6;max-height:44px;overflow:hidden'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>{this.fullFragment() || 'nothing picked yet'}</div>

            {S.previewErr && <div style={sx('font-size:11px;color:var(--danger);line-height:1.5')}>{S.previewErr}</div>}

            <div style={sx('display:flex;gap:9px;align-items:center')}>
              {S.editingId && <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>updating “{S.name || 'this style'}”</span>}
              <span onClick={() => this.closeSave()} className="hFg"
                style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>Cancel</span>
              <span onClick={() => !S.busy && this.save()} className="hBtnAccent"
                style={{ ...sx('padding:7px 18px;border-radius:8px;cursor:pointer;font-weight:700;font-size:11.5px'), background: AMBER, color: 'var(--on-accent)', opacity: S.busy ? .6 : 1 }}>
                {S.busy ? 'SAVING…' : (S.editingId ? 'UPDATE STYLE' : 'SAVE STYLE')}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderBody() {
    const S = this.state;
    return (
      <>
        {S.tab === 'styles' && this.renderLibrary()}
        {S.tab === 'style' && this.renderStyleTab()}
        {S.tab === 'camera' && this.renderCamera()}
      </>
    );
  }

  renderHeader(summary) {
    const S = this.state;
    return (
      <div style={sx('display:flex;align-items:center;gap:14px;padding:13px 22px;border-bottom:1px solid var(--line);flex:none')}>
        <span style={{ ...sx('font-weight:800;text-transform:uppercase'), fontSize: 10.5, letterSpacing: '.16em', color: AMBER }}>Styles</span>
        <div style={sx('display:flex;gap:5px')}>
          {TABS.map(([id, label]) => {
            const on = S.tab === id;
            return (
              <span key={id} onClick={() => this.setState({ tab: id })}
                style={{ ...sx('border-radius:99px;padding:4px 14px;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: on ? 'var(--on-accent)' : 'var(--fg-muted)', background: on ? 'var(--fg)' : 'transparent', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border-2)'), fontWeight: on ? 700 : 400 }}>{label}</span>
            );
          })}
        </div>
        <span title={summary} style={{ ...sx('margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>{summary}</span>
        {!this.props.page && (
          <span onClick={() => this.props.onClose && this.props.onClose()} className="hFg"
            style={{ ...sx('flex:none;cursor:pointer;padding:2px 4px'), fontSize: 13, color: 'var(--fg-faint)' }}>✕</span>
        )}
      </div>
    );
  }

  renderFooter() {
    const S = this.state;
    const canSave = !isStyleEmpty(S.style) || !!this.fullFragment();
    return (
      <div style={sx('display:flex;align-items:center;gap:10px;padding:11px 22px;border-top:1px solid var(--line);flex:none')}>
        <span onClick={() => this.newStyle()} className="hFg"
          style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>↺ Reset</span>
        {canSave && !S.saving && (
          <span onClick={() => this.openSave()} className="hAccent"
            style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>
            {S.editingId ? '✦ Update style' : '✦ Save as style'}
          </span>
        )}
        {/* A page mount has no composer to apply to — Apply would be a lie, so it isn't offered. */}
        {!this.props.page && (
          <>
            <span onClick={() => this.props.onClose && this.props.onClose()} className="hBd"
              style={{ ...sx('margin-left:auto;padding:6px 16px;border:1px solid var(--border-2);border-radius:8px;cursor:pointer;font-size:11.5px;color:var(--fg-soft)') }}>Cancel</span>
            <span onClick={() => this.apply()} className="hBtnAccent"
              style={{ ...sx('display:flex;align-items:center;gap:8px;padding:7px 18px;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px'), background: AMBER, color: 'var(--on-accent)' }}>
              Apply <span style={{ fontFamily: MONO, fontSize: 9.5, background: 'rgba(0,0,0,.18)', borderRadius: 4, padding: '1px 5px' }}>⌘⏎</span>
            </span>
          </>
        )}
      </div>
    );
  }

  render() {
    const S = this.state;
    const video = !!this.props.video;
    const summary = styleLabel(S.style) + ' · ' + cameraLabel(S.camera, { video });

    if (this.props.page) {
      return (
        <div style={sx('display:flex;flex-direction:column;height:calc(100vh - 96px)')}>
          {this.renderHeader(summary)}
          <div style={sx('flex:1;overflow-y:auto;padding:18px 22px')}>{this.renderBody()}</div>
          {S.saving && this.renderSavePanel()}
          {this.renderFooter()}
        </div>
      );
    }

    return (
      <div onClick={() => this.props.onClose && this.props.onClose()}
        style={sx('position:fixed;inset:0;z-index:110;background:rgba(6,7,10,.86);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box')}>
        <div onClick={e => e.stopPropagation()}
          style={sx('width:min(1120px,94vw);height:min(760px,88vh);background:var(--surface);border:1px solid var(--border-2);border-radius:16px;overflow:hidden;display:flex;flex-direction:column')}>
          {this.renderHeader(summary)}
          <div style={sx('flex:1;overflow-y:auto;padding:18px 22px')}>{this.renderBody()}</div>
          {S.saving && this.renderSavePanel()}
          {this.renderFooter()}
        </div>
      </div>
    );
  }
}
