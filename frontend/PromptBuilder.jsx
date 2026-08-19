// Prompt builder — 8-axis cinematic prompt composer (8-axis shot-prompter design).
// Formula-based assembly, no AI in the loop: pick tokens per axis, get a deterministic
// prompt. Presets lock a look; saved prompts land in <root>/prompts/*.md.
// Can be opened from a shot ("Refine in prompt builder") and pushed back into it.
// Layout: settings sidebar (presets + axes) on the left,
// subject/environment + live prompt preview (NORMAL / SECTIONS) on the right.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { AXES, PRESETS, ENVIRONMENTS, assemblePrompt } from './models';
import { ModelPicker, modelName } from './GenerationControls';
import { SHOT_TYPE_LIB } from './shotTypes';
import { splitFlatPicks, mergeToFlatPicks, lockPayload, fullFragment, styleFromLock, cameraFromLock } from './lookBuilder';
import SnippetText from './SnippetText';
import { MONO } from './tokens';

const GREEN = 'var(--ok)';
const AMBER = 'var(--accent)';

// eyebrow label — mono, uppercase, wide tracking (toolkit convention)
const eyebrow = (color = 'var(--fg-muted)', size = 10) =>
  ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: size, letterSpacing: '.16em', color });

export default class PromptBuilder extends React.Component {
  constructor(props) {
    super(props);
    const shot = props.app.state.pbShot;
    this.state = {
      subject: shot ? (shot.title + (shot.desc ? ' — ' + shot.desc : '')).slice(0, 200) : '',
      environment: '',
      picks: Object.fromEntries(AXES.map(a => [a.key, []])),
      preset: null,
      model: '',
      saved: [], savedOpen: false, looks: [],
      edited: null,        // manual override of the whole assembled prompt (NORMAL view)
      extra: '',           // fragments handed off from Look Extractor / Shot Types / Camera Moves — kept
                           // OUT of `edited` so typing a subject (which nulls `edited`) can't destroy them
      sectionEdits: {},    // per-axis fragment overrides (SECTIONS view)
      previewMode: 'normal',
      pickerAxis: null,    // axis key (or 'env') whose image-grid picker modal is open
      pickerSearch: '',
      saveName: '',
      modelPickerOpen: false,   // the shared ModelPicker popover (target model — appended to the copied prompt)
      renaming: null, renameText: '',
      // ── style authoring ──
      // The axes here ARE the style system: the same AXES, the same tokens, the same records.
      // A style saved from this page carries its picks, so it reopens in the axis grid (here or
      // in Tools → Styles) instead of degrading into text.
      stylesOpen: false,
      styleSaving: false, styleName: '', styleTags: '', styleFav: false,
      // carried, not edited here — see stylePayload()
      styleAspect: null, styleMove: null, styleSpeed: 'normal', styleStab: 'smooth',
      stylePreview: null, stylePreviewBusy: false, styleBusy: false, styleErr: '',
      styleEditId: null
    };
  }
  componentDidMount() {
    this.loadSaved();
    this.loadLooks();
    const ins = this.props.app.state.pbInsert;
    if (ins) { this.insert(ins); this.props.app.setState({ pbInsert: null }); }
  }

  // ————— styles: the axes on this page are the style, minus subject & environment —————
  // Split the flat 12-axis map into the style/camera halves the rest of the app speaks, then
  // hand back exactly what the server persists.
  stylePayload() {
    const S = this.state;
    const { style, camera, aspect } = splitFlatPicks(S.picks);
    // This page has no frame-shape control and no camera-movement grid, but a style loaded here
    // may carry both (StyleLab and the presets set them). Carry them straight back out, or a
    // round-trip through the Prompt Builder would silently strip what another surface set.
    camera.move = S.styleMove;
    camera.speed = S.styleSpeed;
    camera.stabilization = S.styleStab;
    return lockPayload(style, camera, aspect || S.styleAspect);
  }
  // The style clause on its own — the part of the prompt that is the LOOK, with the subject and
  // environment left out. Same helper lockPayload uses, so what you preview is what gets saved.
  styleClause() {
    const { style, camera } = splitFlatPicks(this.state.picks);
    return fullFragment(style, camera);
  }
  loadStyle(l) {
    // style + camera halves folded back into this page's single flat map — the exact inverse of
    // what saveStyle() splits apart, so a style makes the round trip unchanged.
    const picks = Object.fromEntries(AXES.map(a => [a.key, []]));
    Object.assign(picks, mergeToFlatPicks(styleFromLock(l), cameraFromLock(l)));
    const cam = cameraFromLock(l) || {};
    this.setState({
      picks, preset: l.presetId || null, edited: null, sectionEdits: {},
      styleEditId: l.id || null, styleName: l.name || '', styleTags: (l.tags || []).join(', '), styleFav: !!l.fav,
      stylePreview: null, styleErr: '',
      // held so re-saving from this page gives them back untouched — see stylePayload()
      styleAspect: l.aspect || null,
      styleMove: cam.move || null, styleSpeed: cam.speed || 'normal', styleStab: cam.stabilization || 'smooth',
      // a text-only legacy style has no picks to restore — its prose lands where prose goes
      extra: (l.picks && Object.keys(l.picks).length) ? this.state.extra : (l.fragment || this.state.extra)
    });
    this.props.app.showToast('Loaded style "' + l.name + '"', AMBER);
  }
  async makeStylePreview() {
    if (this.state.stylePreviewBusy) return;
    const fragment = this.styleClause();
    if (!fragment) { this.setState({ styleErr: 'Pick some axes first — there is no look to render yet.' }); return; }
    this.setState({ stylePreviewBusy: true, styleErr: '' });
    try {
      const r = await api.styleLockPreview({ fragment, aspect: this.stylePayload().aspect || '16:9' });
      this.setState({ stylePreview: r.dataUrl, stylePreviewBusy: false });
      this.props.app.showToast('Preview rendered · $' + Number(r.cost || 0).toFixed(3), GREEN);
    } catch (e) { this.setState({ stylePreviewBusy: false, styleErr: e.message }); }
  }
  async saveStyle() {
    const S = this.state;
    // an id-less POST always creates — a second submit in flight would file a duplicate style
    if (S.styleBusy) return;
    const name = S.styleName.trim();
    if (!name) { this.setState({ styleErr: 'Name the style first.' }); return; }
    const payload = this.stylePayload();
    if (!payload.fragment) { this.setState({ styleErr: 'No look picked yet — choose some axes first.' }); return; }
    this.setState({ styleBusy: true, styleErr: '' });
    try {
      const rec = await api.saveStyleLock({
        id: S.styleEditId || undefined,
        name, tags: S.styleTags.split(',').map(t => t.trim()).filter(Boolean), fav: S.styleFav,
        ...payload,
        refImageData: S.stylePreview || undefined
      });
      this.props.app.showToast((S.styleEditId ? 'Style updated — ' : 'Style saved — ') + rec.name, GREEN);
      this.setState({ styleBusy: false, styleSaving: false, styleEditId: rec.id, stylePreview: null });
      this.props.app.reloadStyleLocks && this.props.app.reloadStyleLocks();
    } catch (e) { this.setState({ styleBusy: false, styleErr: e.message }); }
  }
  async loadSaved() { try { this.setState({ saved: await api.prompts() }); } catch { /* none */ } }
  async loadLooks() { try { this.setState({ looks: await api.looks() }); } catch { /* none */ } }
  insert(fragment) {
    // append to `extra` (survives subject/axis edits) rather than baking into `edited`, which
    // gets nulled the moment the user types a subject — that used to silently drop the fragment
    this.setState(s => ({ extra: (s.extra ? s.extra.trim().replace(/\.$/, '') + '. ' : '') + fragment }));
  }

  toggle(axKey, token) {
    this.setState(s => {
      const ax = AXES.find(a => a.key === axKey);
      let cur = s.picks[axKey] || [];
      if (cur.includes(token)) cur = cur.filter(t => t !== token);
      else cur = ax.max === 1 ? [token] : [...cur, token].slice(-ax.max);
      const sectionEdits = { ...s.sectionEdits };
      delete sectionEdits[axKey]; // repicking an axis resets its hand-edited fragment
      return { picks: { ...s.picks, [axKey]: cur }, sectionEdits, edited: null, preset: null };
    });
  }
  applyPreset(p) {
    this.setState({
      picks: Object.fromEntries(AXES.map(a => [a.key, (p.pick[a.key] || []).slice()])),
      preset: p.id, edited: null, sectionEdits: {}, pickerAxis: null
    });
  }
  clearAll() {
    this.setState({ picks: Object.fromEntries(AXES.map(a => [a.key, []])), preset: null, edited: null, extra: '', sectionEdits: {}, pickerAxis: null });
  }
  // formula fragment for one axis, honoring a SECTIONS override
  frag(key) {
    if (this.state.sectionEdits[key] != null) return this.state.sectionEdits[key];
    const ax = AXES.find(a => a.key === key);
    return (this.state.picks[key] || []).map(t => (ax.tokens.find(x => x.t === t) || {}).f).filter(Boolean).join(', ');
  }
  prompt() {
    if (this.state.edited != null) return this.state.edited;
    const base = assemblePrompt(this.state.subject, this.state.environment, this.state.picks, this.state.sectionEdits);
    const extra = (this.state.extra || '').trim();
    return extra ? base.replace(/\.$/, '') + '. ' + extra : base;
  }
  async save() {
    const { app } = this.props;
    const name = this.state.saveName.trim() || (this.state.subject || 'prompt').slice(0, 40);
    await api.savePrompt(name, this.prompt(), this.state.picks).catch(() => { });
    this.setState({ saveName: '' });
    app.showToast('Prompt saved to prompts/ — portable .md', GREEN);
    this.loadSaved();
  }
  copy() {
    const { app } = this.props;
    const text = this.prompt() + (this.state.model ? '\n\n[model: ' + this.state.model + ']' : '');
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => { });
    app.showToast('Prompt copied to clipboard', AMBER);
  }
  async pushToShot() {
    const { app } = this.props;
    const shot = app.state.pbShot;
    if (!shot) return;
    await api.patchShot(shot.proj, shot.id, { prompt: this.prompt() }, 'prompt refined in builder').catch(() => { });
    app.showToast('Prompt written into ' + shot.id + ' — ' + shot.title, GREEN);
    app.sync();
  }

  // ————— sidebar pieces —————
  renderPresetRow(p) {
    const on = this.state.preset === p.id;
    return (
      <div key={p.id} onClick={() => this.applyPreset(p)} className={on ? '' : 'hRow'}
        style={{
          ...sx('display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer'),
          background: on ? 'var(--accent-05)' : 'transparent',
          border: '1px solid ' + (on ? 'var(--accent-35)' : 'transparent')
        }}>
        <img src={'/preset-previews/' + p.id + '.jpg'} alt="" loading="lazy" decoding="async"
          onError={e => { e.target.style.visibility = 'hidden'; }}
          style={sx('width:34px;height:34px;border-radius:4px;object-fit:cover;flex:none;background:var(--surface-2)')} />
        <span style={{ ...sx('flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 11.5, color: on ? 'var(--fg)' : 'var(--fg-soft)', fontWeight: on ? 600 : 400 }}>{p.name}</span>
        {on && <span style={{ ...sx('flex:none'), fontFamily: MONO, fontSize: 9, color: AMBER }}>●</span>}
      </div>
    );
  }
  renderAxisRow(ax) {
    const S = this.state;
    const picked = S.picks[ax.key] || [];
    const open = () => this.setState({ pickerAxis: ax.key, pickerSearch: '' });
    return (
      <div key={ax.key} className="hBg" style={sx('padding:9px 8px;border-radius:6px;cursor:pointer')} onClick={open}>
        <div style={sx('display:flex;align-items:baseline;gap:8px')}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--fg-soft)' }}>{ax.name}</span>
          <span style={{ fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>max {ax.max}</span>
          {picked.length > 0 && (
            <span onClick={e => { e.stopPropagation(); this.setState(s => { const se = { ...s.sectionEdits }; delete se[ax.key]; return { picks: { ...s.picks, [ax.key]: [] }, sectionEdits: se, edited: null, preset: null }; }); }}
              className="hFgL" style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>clear</span>
          )}
        </div>
        <div style={sx('display:flex;gap:4px;flex-wrap:wrap;margin-top:6px')}>
          {!picked.length && (
            <span style={{ ...sx('padding:3px 10px;border-radius:99px;border:1px dashed var(--border-2);color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>+ pick</span>
          )}
          {picked.map(t => (
            <span key={t} style={{ ...sx('padding:3px 9px;border-radius:99px'), fontFamily: MONO, fontSize: 10, color: AMBER, background: 'var(--accent-12)', border: '1px solid var(--accent-35)' }}>+ {t}</span>
          ))}
        </div>
      </div>
    );
  }

  // ————— image-grid option picker modal (camera-body style) —————
  renderPicker() {
    const S = this.state;
    if (!S.pickerAxis) return null;
    const isEnv = S.pickerAxis === 'env';
    const ax = isEnv ? null : AXES.find(a => a.key === S.pickerAxis);
    const picked = isEnv ? [] : (S.picks[ax.key] || []);
    const q = S.pickerSearch.trim().toLowerCase();
    const tokens = (isEnv ? ENVIRONMENTS.map(e => ({ t: e.name, f: e.f, d: e.d, img: e.img })) : ax.tokens)
      .filter(tok => !q || tok.t.toLowerCase().includes(q) || (tok.d || '').toLowerCase().includes(q));
    const close = () => this.setState({ pickerAxis: null });
    const pick = tok => {
      if (isEnv) { this.setState({ environment: tok.f || tok.t, edited: null, pickerAxis: null }); return; }
      this.toggle(ax.key, tok.t);
      if (ax.max === 1) close();
    };
    return (
      <div onClick={close} style={sx('position:fixed;inset:0;background:rgba(5,6,8,.82);z-index:60;display:flex;align-items:center;justify-content:center;padding:34px')}>
        <div onClick={e => e.stopPropagation()} style={sx('width:100%;max-width:1120px;max-height:100%;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border-2);border-radius:12px;overflow:hidden')}>
          <div style={sx('display:flex;align-items:baseline;gap:12px;padding:16px 20px 12px')}>
            <span style={{ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 12, letterSpacing: '.16em', color: 'var(--fg)' }}>{isEnv ? 'Environment' : ax.name}</span>
            <span style={sx('font-size:11.5px;color:var(--fg-faint);font-style:italic')}>
              {isEnv ? 'Pick a setting — fills the environment field.' : 'Pick ' + (ax.max === 1 ? 'one' : 'up to ' + ax.max) + ' — sets the ' + ax.name.toLowerCase() + ' character.'}
            </span>
            <span onClick={close} className="hBd" style={{ ...sx('margin-left:auto;padding:5px 14px;border:1px solid var(--border-2);border-radius:5px;color:var(--fg-soft);cursor:pointer;font-weight:700'), fontFamily: MONO, fontSize: 10 }}>DONE</span>
          </div>
          <div style={sx('padding:0 20px 12px')}>
            <input autoFocus value={S.pickerSearch} onChange={e => this.setState({ pickerSearch: e.target.value })}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}
              placeholder={'Search ' + (isEnv ? 'environments' : ax.name.toLowerCase())}
              style={sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--accent-60);border-radius:7px;color:var(--fg);font-size:13px;padding:11px 14px')} />
          </div>
          <div style={sx('overflow-y:auto;padding:4px 20px 18px')}>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px')}>
              {tokens.map(tok => {
                const on = picked.includes(tok.t);
                return (
                  <div key={tok.t} onClick={() => pick(tok)} className={on ? '' : 'hCard'}
                    style={{ ...sx('border-radius:9px;background:var(--surface);overflow:hidden;cursor:pointer;position:relative'), border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                    {tok.img
                      ? <img src={tok.img} alt="" loading="lazy" decoding="async" style={sx('width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--surface-2)')} />
                      : <div style={{ ...sx('width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--border-3)'), fontFamily: MONO, fontSize: 20 }}>◈</div>}
                    {on && <span style={{ ...sx('position:absolute;top:8px;right:8px;width:20px;height:20px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-weight:700'), background: AMBER, color: 'var(--on-accent)', fontSize: 12 }}>✓</span>}
                    <div style={sx('padding:9px 11px 11px')}>
                      <div style={{ ...sx('font-weight:700'), fontSize: 12.5, color: on ? AMBER : 'var(--fg)' }}>{tok.t}</div>
                      {tok.d && <div style={sx('font-size:10.5px;color:var(--fg-muted);line-height:1.5;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden')}>{tok.d}</div>}
                    </div>
                  </div>
                );
              })}
              {!tokens.length && <div style={{ ...sx('padding:30px 0;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>NO MATCHES</div>}
            </div>
          </div>
          <div style={sx('display:flex;align-items:center;gap:10px;padding:11px 20px;border-top:1px solid var(--line)')}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)', letterSpacing: '.1em' }}>{isEnv ? tokens.length + ' ENVIRONMENTS' : picked.length + ' / ' + ax.max + ' SELECTED'}</span>
            <span onClick={close} className="hBd" style={{ ...sx('margin-left:auto;padding:5px 14px;border:1px solid var(--border-2);border-radius:5px;color:var(--fg-soft);cursor:pointer;font-weight:700'), fontFamily: MONO, fontSize: 10 }}>CLOSE</span>
          </div>
        </div>
      </div>
    );
  }

  // ————— preview pieces —————
  renderSections() {
    const S = this.state;
    const row = (label, value, onChange, placeholder) => {
      const empty = !value;
      return (
        <div key={label} style={sx('display:flex;gap:14px;padding:9px 0;border-bottom:1px dashed var(--line);align-items:flex-start')}>
          <span style={{ ...sx('flex:none;width:120px;padding-top:2px;text-transform:uppercase'), fontFamily: MONO, fontSize: 9.5, letterSpacing: '.1em', color: empty ? 'var(--fg-faint)' : 'var(--fg-muted)' }}>{label}</span>
          <textarea value={value} onChange={onChange} onKeyDown={e => e.stopPropagation()} placeholder={placeholder}
            rows={Math.max(1, Math.ceil((value || '').length / 70))}
            style={{ ...sx('flex:1;background:transparent;border:none;resize:none;line-height:1.6;padding:0'), fontFamily: MONO, fontSize: 11.5, color: 'var(--fg)' }} />
        </div>
      );
    };
    return (
      <div style={sx('padding:4px 16px 12px')}>
        {row('Subject', S.subject, e => this.setState({ subject: e.target.value, edited: null }), 'describe the subject…')}
        {row('Environment', S.environment, e => this.setState({ environment: e.target.value, edited: null }), 'describe the environment…')}
        {AXES.map(ax => row(ax.name, this.frag(ax.key),
          e => this.setState(s => ({ sectionEdits: { ...s.sectionEdits, [ax.key]: e.target.value }, edited: null })),
          'describe ' + ax.name.toLowerCase() + '…'))}
      </div>
    );
  }

  render() {
    const S = this.state;
    const { app } = this.props;
    const shot = app.state.pbShot;
    const filled = AXES.filter(a => (S.picks[a.key] || []).length).length;
    const out = this.prompt();
    const hasSubject = !!S.subject.trim() || S.edited != null;
    const words = out.split(/\s+/).filter(Boolean).length;
    const activePreset = PRESETS.find(p => p.id === S.preset);
    const seg = (id, label) => (
      <span key={id} onClick={() => this.setState({ previewMode: id })}
        style={{
          ...sx('padding:4px 14px;cursor:pointer;border-radius:99px'), fontFamily: MONO, fontSize: 10, letterSpacing: '.1em',
          color: S.previewMode === id ? 'var(--on-accent)' : 'var(--fg-muted)', background: S.previewMode === id ? 'var(--fg)' : 'transparent', fontWeight: 700
        }}>{label}</span>
    );
    return (
      <div style={sx('padding:22px 28px 90px')}>
        {this.renderPicker()}
        {/* header */}
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:16px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Prompt Builder</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>8-axis cinematic composer — formula assembly, zero AI drift</span>
          {shot && (
            <span style={sx('display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:700;color:var(--accent);border:1px solid var(--accent-35);border-radius:99px;padding:2px 11px')}>
              refining {shot.id} · {shot.title}
              <span onClick={() => { app.setState({ pbShot: null }); }} className="hFgL" style={sx('color:var(--fg-faint);cursor:pointer;font-weight:400')}>✕</span>
            </span>
          )}
          <span onClick={() => this.setState(s => ({ stylesOpen: !s.stylesOpen, savedOpen: false }))} className="hFg" style={sx('margin-left:auto;font-size:11.5px;color:var(--fg-muted);cursor:pointer')}>
            My styles <span style={{ fontFamily: MONO, fontSize: 10 }}>{(app.state.styleLocks || []).length}</span> {S.stylesOpen ? '▴' : '▾'}
          </span>
          <span onClick={() => this.setState(s => ({ savedOpen: !s.savedOpen, stylesOpen: false }))} className="hFg" style={sx('font-size:11.5px;color:var(--fg-muted);cursor:pointer')}>
            Saved prompts <span style={{ fontFamily: MONO, fontSize: 10 }}>{S.saved.length}</span> {S.savedOpen ? '▴' : '▾'}
          </span>
        </div>

        {/* Saved styles — the SAME records Tools → Styles and the composer's `s` picker use.
            Clicking one restores its axis picks into the grid below, so a style is something you
            keep editing rather than a dead block of text. */}
        {S.stylesOpen && (
          <div style={sx('border:1px solid var(--border);border-radius:8px;background:var(--surface);margin-bottom:16px;padding:12px 14px')}>
            {!(app.state.styleLocks || []).length
              ? <div style={sx('font-size:11.5px;color:var(--fg-faint);line-height:1.6')}>No styles yet — build a look on the axes, then hit <span style={{ color: AMBER }}>✦ SAVE AS STYLE</span> below. It shows up here, in Tools → Styles, and on the <span style={{ fontFamily: MONO }}>s</span> picker in Generate.</div>
              : (
                <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px')}>
                  {(app.state.styleLocks || []).slice()
                    .sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || String(a.name || '').localeCompare(String(b.name || '')))
                    .map(l => {
                      const on = S.styleEditId === l.id;
                      return (
                        <div key={l.id} onClick={() => this.loadStyle(l)} className={on ? '' : 'hBd'}
                          style={{ ...sx('border-radius:8px;background:var(--surface);overflow:hidden;cursor:pointer'), border: '1px solid ' + (on ? AMBER : 'var(--border)') }}>
                          {l.refImage
                            ? <img src={api.styleLockRefUrl(l.id)} alt="" loading="lazy" decoding="async" style={sx('width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--surface-2)')} />
                            : <div style={{ ...sx('width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--border-2)'), fontFamily: MONO, fontSize: 18 }}>◈</div>}
                          <div style={sx('padding:7px 9px 9px;display:flex;align-items:center;gap:6px')}>
                            {l.fav && <span style={{ color: AMBER, fontSize: 10 }}>★</span>}
                            <span style={{ ...sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontSize: 11.5, color: on ? AMBER : 'var(--fg)' }}>{l.name}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
          </div>
        )}

        {S.savedOpen && (
          <div style={sx('border:1px solid var(--border);border-radius:8px;background:var(--surface);margin-bottom:16px;overflow:hidden')}>
            {S.saved.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0)).map(p => (
              <div key={p.file} className="hRow" style={sx('display:flex;gap:12px;align-items:center;padding:9px 16px;border-bottom:1px solid var(--line)')}>
                <span onClick={async () => {
                  await api.patchPrompt(p.file, { fav: !p.fav }).catch(() => { });
                  this.loadSaved();
                }} className="hAccent" style={{ ...sx('font-size:13px;cursor:pointer;flex:none'), color: p.fav ? AMBER : 'var(--border-2)' }}>{p.fav ? '★' : '☆'}</span>
                {S.renaming === p.file
                  ? <input autoFocus value={S.renameText} onChange={e => this.setState({ renameText: e.target.value })}
                    onKeyDown={async e => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && S.renameText.trim()) {
                        await api.patchPrompt(p.file, { name: S.renameText.trim() }).catch(() => { });
                        this.setState({ renaming: null }); this.loadSaved();
                      } else if (e.key === 'Escape') this.setState({ renaming: null });
                    }}
                    onBlur={() => this.setState({ renaming: null })}
                    style={sx('width:200px;flex:none;background:var(--ink);border:1px solid var(--accent-60);border-radius:6px;color:var(--fg);font-size:11.5px;padding:4px 8px')} />
                  : <span onClick={() => this.setState({ renaming: p.file, renameText: p.name })} title="Click to rename" className="hAccent"
                    style={sx('font-size:12px;font-weight:600;color:var(--fg);flex:none;width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text')}>{p.name} <span style={sx('font-size:9px;color:var(--fg-faint)')}>✎</span></span>}
                <span style={{ ...sx('flex:1;color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 10 }}>{p.prompt}</span>
                <span onClick={() => { this.setState({ edited: p.prompt }); app.showToast('Loaded "' + p.name + '"', AMBER); }} className="hAccent" style={sx('font-size:11px;color:var(--accent);font-weight:600;cursor:pointer;flex:none')}>Load</span>
                <span onClick={() => { app.jumpToGenerate(); app.setState({ genPrompt: p.prompt }); }} className="hFg" style={sx('font-size:11px;color:var(--fg-muted);cursor:pointer;flex:none')}>→ Generate</span>
                <span onClick={() => { navigator.clipboard && navigator.clipboard.writeText(p.prompt).catch(() => { }); app.showToast('Copied', AMBER); }} className="hFg" style={sx('font-size:11px;color:var(--fg-muted);cursor:pointer;flex:none')}>Copy</span>
                <span onClick={async () => { await api.deletePrompt(p.file).catch(() => { }); this.loadSaved(); }} className="hFgL" style={sx('font-size:11px;color:var(--danger);cursor:pointer;flex:none')}>✕</span>
              </div>
            ))}
            {!S.saved.length && <div style={sx('padding:16px;font-size:11.5px;color:var(--fg-faint)')}>No saved prompts yet.</div>}
          </div>
        )}

        <div style={sx('display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px;align-items:start')}>
          {/* ————— settings sidebar ————— */}
          <div style={sx('position:sticky;top:16px;display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px 10px;max-height:calc(100vh - 100px);overflow-y:auto')}>
            <div style={sx('display:flex;align-items:baseline;gap:8px;padding:0 8px 8px')}>
              <span style={eyebrow()}>Presets</span>
              <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>{PRESETS.length}</span>
            </div>
            {PRESETS.map(p => this.renderPresetRow(p))}
            <div style={sx('display:flex;align-items:baseline;gap:8px;padding:16px 8px 4px;border-top:1px solid var(--line);margin-top:10px')}>
              <span style={eyebrow()}>Axes</span>
              <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9, fontVariantNumeric: 'tabular-nums', color: filled ? AMBER : 'var(--fg-faint)' }}>{filled}/{AXES.length}</span>
              {filled > 0 && <span onClick={() => this.clearAll()} className="hFgL" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9, color: 'var(--fg-faint)' }}>clear all</span>}
            </div>
            {AXES.map(ax => this.renderAxisRow(ax))}
          </div>

          {/* ————— main canvas ————— */}
          <div style={sx('display:flex;flex-direction:column;gap:18px')}>
            {/* subject & environment */}
            <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:baseline;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow('var(--fg-muted)')}>Subject & Environment</span>
                <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>live preview below</span>
              </div>
              <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:14px 18px 18px')}>
                <div>
                  <div style={{ ...eyebrow(AMBER, 9.5), ...sx('margin-bottom:7px') }}>Subject · Action</div>
                  <SnippetText value={S.subject} snippets={this.props.app.state.snippets} onChange={e => this.setState({ subject: e.target.value, edited: null })}
                    rows={3}
                    placeholder="e.g. woman walking along a rain-soaked alley, hood up, shoulders tight, looking back over her shoulder"
                    style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12.5px;line-height:1.6;padding:11px 13px')} />
                </div>
                <div>
                  <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:7px')}>
                    <span style={eyebrow('var(--fg-faint)', 9.5)}>Environment · Optional</span>
                    <span onClick={() => this.setState({ pickerAxis: 'env', pickerSearch: '' })} className="hAccent"
                      style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 9, color: AMBER, letterSpacing: '.1em' }}>BROWSE {ENVIRONMENTS.length}</span>
                  </div>
                  <SnippetText value={S.environment} snippets={this.props.app.state.snippets} onChange={e => this.setState({ environment: e.target.value, edited: null })}
                    rows={3}
                    placeholder="e.g. Tokyo backstreet, 3am, neon reflections puddling on wet asphalt, faint sodium streetlight overhead"
                    style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12.5px;line-height:1.6;padding:11px 13px')} />
                </div>
              </div>
            </div>

            {/* prompt preview */}
            <div style={sx('border:1px solid var(--accent-35);border-top:2px solid var(--accent-60);border-radius:8px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:center;gap:14px;padding:11px 18px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow(AMBER)}>Prompt Preview</span>
                <span style={sx('display:inline-flex;gap:2px;border:1px solid var(--border);border-radius:99px;padding:2px')}>
                  {seg('normal', 'NORMAL')}{seg('sections', 'SECTIONS')}
                </span>
                {activePreset && <span style={{ fontFamily: MONO, fontSize: 9.5, color: AMBER }}>◈ {activePreset.name}</span>}
                {S.edited != null && (
                  <span onClick={() => this.setState({ edited: null })} className="hFgL" style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>edited — reset to formula</span>
                )}
                <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9.5, fontVariantNumeric: 'tabular-nums', color: 'var(--fg-faint)' }}>
                  {hasSubject ? words + ' words · ' + out.length + ' chars · ' + filled + '/' + AXES.length + ' axes' : 'waiting for subject'}
                </span>
              </div>
              {!hasSubject ? (
                <div style={sx('margin:16px 18px;border:1px dashed var(--border-2);border-radius:12px;padding:52px 20px;text-align:center')}>
                  <span style={{ ...sx('font-weight:700;letter-spacing:.1em'), fontFamily: MONO, fontSize: 11, color: 'var(--fg-muted)' }}>NO SUBJECT YET — DESCRIBE THE SHOT ABOVE</span>
                </div>
              ) : S.previewMode === 'sections' && S.edited == null ? this.renderSections() : (
                <textarea value={out} onChange={e => this.setState({ edited: e.target.value })}
                  onKeyDown={e => e.stopPropagation()}
                  style={{ ...sx('width:100%;box-sizing:border-box;height:180px;resize:vertical;background:transparent;border:none;color:var(--fg);line-height:1.8;padding:16px 18px;display:block'), fontFamily: MONO, fontSize: 11.5 }} />
              )}
              {S.previewMode === 'sections' && S.edited != null && hasSubject && (
                <div style={{ ...sx('padding:0 18px 12px'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>prompt was edited by hand — reset to formula to edit sections</div>
              )}
              {/* insert + actions */}
              <div style={sx('display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap;align-items:center')}>
                <select value="" onChange={e => { const l = S.looks.find(x => x.id === e.target.value); if (l) this.insert(l.tier1); }}
                  style={{ ...sx('background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg-muted);padding:6px 8px'), fontFamily: MONO, fontSize: 10 }}>
                  <option value="">+ look {S.looks.length ? '(' + S.looks.length + ')' : ''}</option>
                  {S.looks.map(l => <option key={l.id} value={l.id}>{l.id} — {(l.summary || '').slice(0, 50)}</option>)}
                </select>
                <select value="" onChange={e => { const t = SHOT_TYPE_LIB.find(x => x.slug === e.target.value); if (t) this.insert(t.promptFragment); }}
                  style={{ ...sx('background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg-muted);padding:6px 8px'), fontFamily: MONO, fontSize: 10 }}>
                  <option value="">+ shot-type</option>
                  {['single', 'multi'].map(k => (
                    <optgroup key={k} label={k.toUpperCase()}>
                      {SHOT_TYPE_LIB.filter(t => t.type === k).map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                {/* Target model — the shared ModelPicker (frontend/GenerationControls.jsx), the same
                    provider/price-aware list the Generate console uses. Opens upward (the toolbar sits
                    at the bottom of the preview panel). The dismiss catcher is a SIBLING of the
                    wrapper, below it in z-order, so a click outside closes while a row click still
                    lands on the row — the same layering the Generate console's pill popovers use. */}
                {S.modelPickerOpen && <div onClick={() => this.setState({ modelPickerOpen: false })} style={sx('position:fixed;inset:0;z-index:40')} />}
                <div style={{ ...sx('position:relative'), zIndex: S.modelPickerOpen ? 41 : 'auto' }}>
                  <div onClick={() => this.setState(s => ({ modelPickerOpen: !s.modelPickerOpen }))} className="hBd"
                    style={{ ...sx('display:inline-flex;align-items:center;gap:7px;background:var(--ink);border-radius:6px;padding:6px 10px;cursor:pointer;max-width:230px'), border: '1px solid ' + (S.model ? 'var(--border-2)' : 'var(--border)'), color: S.model ? 'var(--fg)' : 'var(--fg-muted)', fontFamily: MONO, fontSize: 10 }}>
                    <span style={sx('overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{S.model ? modelName(S.model) : 'target model —'}</span>
                    <span style={{ color: 'var(--fg-faint)' }}>▾</span>
                  </div>
                  {S.modelPickerOpen && (
                    <div style={{ ...sx('position:absolute;right:0;bottom:calc(100% + 7px);z-index:42;border-radius:11px;background:var(--surface-2);overflow:hidden;width:320px'), border: '1px solid var(--border-3)', boxShadow: '0 18px 52px rgba(0,0,0,.72)' }}>
                      <ModelPicker settings={this.props.app.state.settings} value={S.model} video={null}
                        defaultRow={{ label: 'target model —', sub: 'no model bound — prompt only', note: '', cost: null }}
                        onChange={id => this.setState({ model: id, modelPickerOpen: false })} />
                    </div>
                  )}
                </div>
                <div style={sx('flex:1')} />
                <input value={S.saveName} onChange={e => this.setState({ saveName: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') this.save(); }}
                  placeholder="save as… (name)"
                  style={{ ...sx('width:150px;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);padding:6px 10px'), fontFamily: MONO, fontSize: 10 }} />
                <div onClick={() => this.save()} className="hBd" style={{ ...sx('padding:6px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);font-weight:600;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>SAVE .MD</div>
                {/* The look half of what's on screen, saved as a reusable style — subject and
                    environment deliberately excluded, since those are about THIS shot. */}
                <div onClick={() => this.setState(s => ({ styleSaving: !s.styleSaving, styleName: s.styleName || (S.preset ? (PRESETS.find(p => p.id === S.preset) || {}).name || '' : '') }))}
                  className="hBdAccent" style={{ ...sx('padding:6px 13px;border-radius:7px;font-weight:700;cursor:pointer'), border: '1px solid var(--accent-35)', color: AMBER, fontFamily: MONO, fontSize: 10 }}>
                  {S.styleEditId ? '✦ UPDATE STYLE' : '✦ SAVE AS STYLE'}
                </div>
                {shot && <div onClick={() => this.pushToShot()} className="hBdAccent" style={{ ...sx('padding:6px 13px;border-radius:7px;border:1px solid var(--accent-35);color:var(--accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>→ {shot.id}</div>}
                <div onClick={() => this.copy()} className="hBtnAccent" style={{ ...sx('padding:6px 16px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>COPY PROMPT</div>
              </div>
              {S.styleSaving && this.renderStyleSave()}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ————— save-as-style panel — name, tags, and an optional rendered preview frame —————
  renderStyleSave() {
    const S = this.state;
    const clause = this.styleClause();
    return (
      <div style={sx('border-top:1px solid var(--line);background:var(--ink);padding:14px 18px')}>
        <div style={sx('display:flex;gap:16px;align-items:flex-start')}>
          <div style={sx('flex:none;width:158px')}>
            {S.stylePreview
              ? <img src={S.stylePreview} alt="" style={sx('width:158px;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block;background:var(--surface-2);border:1px solid var(--border)')} />
              : <div style={{ ...sx('width:158px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--surface-2);border:1px dashed var(--border-2);color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
                {S.stylePreviewBusy ? 'rendering…' : 'no preview yet'}
              </div>}
            <div style={sx('display:flex;gap:8px;align-items:center;margin-top:7px')}>
              <span onClick={() => this.makeStylePreview()} className={S.stylePreviewBusy ? '' : 'hAccent'}
                style={{ ...sx('cursor:pointer;font-weight:700'), fontFamily: MONO, fontSize: 9.5, color: S.stylePreviewBusy ? 'var(--fg-faint)' : AMBER, letterSpacing: '.08em' }}>
                {S.stylePreviewBusy ? '◌ RENDERING…' : (S.stylePreview ? '✦ RE-RENDER' : '✦ GENERATE PREVIEW')}
              </span>
              {S.stylePreview && !S.stylePreviewBusy && (
                <span onClick={() => this.setState({ stylePreview: null })} className="hFgL"
                  style={{ ...sx('cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>clear</span>
              )}
            </div>
            <div style={{ ...sx('margin-top:5px;line-height:1.45'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)' }}>renders this look on a neutral subject · costs a generation</div>
          </div>

          <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:10px')}>
            <div style={sx('display:flex;gap:10px')}>
              <div style={sx('flex:1;min-width:0')}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: 'var(--fg-muted)', marginBottom: 5 }}>STYLE NAME</div>
                <input autoFocus value={S.styleName} onChange={e => this.setState({ styleName: e.target.value })}
                  onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !S.styleBusy) this.saveStyle(); }}
                  placeholder="e.g. Neon Noir Alley"
                  style={sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);font-size:12.5px;padding:8px 11px')} />
              </div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', color: 'var(--fg-muted)', marginBottom: 5 }}>TAGS · COMMA SEPARATED</div>
                <input value={S.styleTags} onChange={e => this.setState({ styleTags: e.target.value })}
                  onKeyDown={e => e.stopPropagation()} placeholder="noir, night, anamorphic"
                  style={{ ...sx('width:100%;box-sizing:border-box;background:var(--sunk);border:1px solid var(--border-2);border-radius:7px;color:var(--fg);padding:8px 11px'), fontFamily: MONO, fontSize: 11 }} />
              </div>
              <div onClick={() => this.setState({ styleFav: !S.styleFav })} className="hBd"
                style={{ ...sx('flex:none;display:flex;align-items:center;gap:7px;padding:8px 13px;border-radius:7px;cursor:pointer;align-self:flex-end'), border: '1px solid ' + (S.styleFav ? 'var(--accent-35)' : 'var(--border-2)'), color: S.styleFav ? AMBER : 'var(--fg-faint)' }}>
                <span style={sx('font-size:13px')}>{S.styleFav ? '★' : '☆'}</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700 }}>FAVORITE</span>
              </div>
            </div>

            <div style={{ ...sx('line-height:1.6;max-height:44px;overflow:hidden'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>{clause || 'no axes picked yet — the style would be empty'}</div>
            {S.styleErr && <div style={sx('font-size:11px;color:var(--danger);line-height:1.5')}>{S.styleErr}</div>}

            <div style={sx('display:flex;gap:9px;align-items:center')}>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>saves the look only — subject &amp; environment stay with this prompt</span>
              <span onClick={() => this.setState({ styleSaving: false, styleErr: '' })} className="hFg"
                style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 10, color: 'var(--fg-muted)' }}>Cancel</span>
              <span onClick={() => !S.styleBusy && this.saveStyle()} className="hBtnAccent"
                style={{ ...sx('padding:7px 18px;border-radius:8px;cursor:pointer;font-weight:700;font-size:11.5px'), background: AMBER, color: 'var(--on-accent)', opacity: S.styleBusy ? .6 : 1 }}>
                {S.styleBusy ? 'SAVING…' : (S.styleEditId ? 'UPDATE STYLE' : 'SAVE STYLE')}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
