// Sheet Composer — AXL composer (Axis × Subject × Layout) for character turnarounds,
// location plates, contact sheets and model sheets. Deterministic fragment assembly, no AI pass.
// Writes nothing to disk: emits prompt text → clipboard, Prompt Builder (pbInsert) or Generate (genPrompt).
import React from 'react';
import { sx } from './sx';
import { optionsOfType } from './cinematicOptions';
import { SHOT_TYPE_LIB } from './shotTypes';
import { CAMERA_MOVEMENTS } from './cameraMovements';
import { ASSET_KIND_FOLDERS } from './AssetBoards';
import { MONO } from './tokens';

const AMBER = 'var(--accent)';
const GREEN = 'var(--ok)';

const eyebrow = (color = 'var(--fg-faint)', size = 10) =>
  ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: size, letterSpacing: '.16em', color });

// ── fragment library ───────────────────────────────────────────────────────────────────────────
// FrameForge has no fragment DB — the ReelStack `gridPromptFragments` table is replaced by these
// local const tables, written in the same voice. Adding a sheet = adding a row here.
const LAYOUTS = [
  {
    slug: 'turnaround-3view', label: '3-view turnaround', sub: '3 panels · character ref',
    sketch: [3, 1], panels: 3, defaultAxis: 'turnaround-3',
    body: 'Compose ONE wide image divided into three equal vertical panels, 3 across and 1 down, edge to edge with no gutters, no outer border and no drop shadow. Each panel is a full standing view of the same character at the same scale.'
  },
  {
    slug: 'location-plate-2x2', label: '2x2 location plate', sub: '4 panels · coverage',
    sketch: [2, 2], panels: 4, defaultAxis: 'location-coverage-4',
    body: 'Compose ONE image as a clean 2x2 plate — 2 across, 2 down, four equal quadrants, hairline separation only. Read it top-left, top-right, bottom-left, bottom-right.'
  },
  {
    slug: 'contact-sheet-3x3', label: '3x3 contact sheet', sub: '9 panels · full coverage',
    sketch: [3, 3], panels: 9, defaultAxis: 'camera-angle-9',
    body: 'Compose ONE image as a uniform 3x3 contact sheet — 9 equal panels, 3 across and 3 down, identical panel size and aspect, hairline separation only. Read it left to right, top row first.'
  },
  {
    slug: 'expression-6', label: '6-panel expressions', sub: '6 panels · emotion sheet',
    sketch: [3, 2], panels: 6, defaultAxis: 'emotion-6',
    body: 'Compose ONE image as a 6-panel expression sheet — 3 across and 2 down, six equal panels, identical crop and identical head size in every panel.'
  },
  {
    slug: 'model-sheet-full', label: 'Full model sheet', sub: 'body views + details',
    sketch: 'sheet', panels: 6, defaultAxis: 'model-sheet-regions',
    body: 'Compose ONE full-length model sheet against a flat neutral mid-grey studio backdrop ruled with a faint darker measurement grid, the character standing on the same ground line in every view. Upper two-thirds: three full-body standing views side by side at identical height. Lower band: three tighter detail insets. Flat even studio light, no cast shadows on the backdrop.'
  }
];

const AXES = [
  {
    slug: 'turnaround-3', label: 'Turnaround — front / three-quarter / profile', panels: 3,
    layouts: ['turnaround-3view'],
    body: 'Three views of the same character, left to right: panel 1 dead-on front view, panel 2 three-quarter view turned 45 degrees toward camera-left, panel 3 hard 90-degree side profile. Identical height, identical eye line, identical camera distance and identical lighting in all three — this is a reference sheet, not three separate photographs.'
  },
  {
    slug: 'turnaround-4', label: 'Turnaround — front / three-quarter / profile / back', panels: 4,
    layouts: ['location-plate-2x2', 'turnaround-3view'],
    body: 'Four views of the same character in reading order: dead-on front, three-quarter turned 45 degrees to camera-left, hard 90-degree side profile, then straight back view. Same height, same eye line, same camera distance, same lighting in all four.'
  },
  {
    slug: 'location-coverage-4', label: 'Location coverage — master / eye-line / detail / reverse', panels: 4,
    layouts: ['location-plate-2x2'],
    body: 'Four coverage angles of the same location captured in one continuous lighting state: wide establishing master that reads the whole geography, an eye-level view from the natural entry point, a close detail of the dominant surface and materials, and a reverse angle looking back toward the way in. Same time of day and same weather in every panel.'
  },
  {
    slug: 'camera-angle-9', label: 'Camera angle — 9 positions', panels: 9,
    layouts: ['contact-sheet-3x3'],
    body: 'Nine panels of the SAME subject in the SAME moment, varying only the camera position: front-on at eye level, three-quarter left, three-quarter right, hard left profile, hard right profile, low angle looking up, high angle looking down, over-the-shoulder from behind, and a top-down overhead. Nothing about the subject, wardrobe, pose intent or lighting changes between panels — only where the camera stands.'
  },
  {
    slug: 'lens-focal-9', label: 'Lens / focal length — 9 steps', panels: 9,
    layouts: ['contact-sheet-3x3'],
    body: 'Nine panels of the same subject in the same position, varying only focal length and camera distance: 14mm, 18mm, 24mm, 35mm, 50mm, 85mm, 105mm, 135mm and 200mm, each framed to keep the subject a similar size so the change reads as compression and background falloff, not as a crop.'
  },
  {
    slug: 'lighting-setup-9', label: 'Lighting setup — 9 looks', panels: 9,
    layouts: ['contact-sheet-3x3'],
    body: 'Nine panels of the same subject at the same angle and framing, varying only the lighting: flat frontal, soft key from camera-left, hard key from camera-right, Rembrandt, split light, top light, underlight, hard backlit rim into silhouette, and open shade. Same face, same wardrobe, same lens in every panel.'
  },
  {
    slug: 'emotion-6', label: 'Expression — 6 beats', panels: 6,
    layouts: ['expression-6'],
    body: 'Six expressions of the same face at identical framing and identical lighting: neutral resting, faint amusement, open laugh, cold contained anger, grief holding back tears, and wide startled alarm. Only the face changes — head size, camera distance and eye line stay locked across all six.'
  },
  {
    slug: 'emotion-9', label: 'Expression — 9 beats', panels: 9,
    layouts: ['contact-sheet-3x3'],
    body: 'Nine expressions of the same face at identical framing and identical lighting: neutral, faint amusement, open laugh, cold anger, contempt, grief, fear, exhaustion, and quiet resolve. Only the face changes — head size, camera distance and eye line stay locked across all nine.'
  },
  {
    slug: 'model-sheet-regions', label: 'Model sheet — body views + details', panels: 6,
    layouts: ['model-sheet-full'],
    body: 'Upper band, left to right: full-body front view, full-body three-quarter view, full-body back view — same height, same ground line, arms relaxed and clear of the torso so the silhouette reads. Lower band, left to right: head and shoulders detail, hands detail, footwear and lower-leg detail. Every view is the same character in the same wardrobe under the same light.'
  }
];

const OUTPUT_RULES = [
  {
    slug: 'no-text', label: 'No text at all',
    body: 'Render no text of any kind — no labels, captions, watermarks, panel numbers, arrows, rulers or logos anywhere in the image.'
  },
  {
    slug: 'hairline-dividers', label: 'Hairline dividers, no text',
    body: 'Separate the panels with a single thin neutral hairline. No captions, no numbering, no watermark, no logo.'
  },
  {
    slug: 'labels-under-panels', label: 'Small labels under each panel',
    body: 'Set a small, clean, uppercase sans-serif label beneath each panel naming the view. Labels only — no other text, no watermark, no logo, no arrows.'
  }
];

const SUBJECT_SOURCES = [
  {
    slug: 'from-text', label: 'From this description',
    body: 'Build the subject entirely from the description above. Invent nothing that contradicts it and keep whatever it specifies identical in every panel.'
  },
  {
    slug: 'from-image-ref', label: 'From an attached reference image',
    body: 'REFERENCE LOCK — the attached reference image defines the subject identity. Replicate the face, hair, body proportions, skin tone and wardrobe exactly across every panel. Do not restyle, do not beautify, do not age, do not change the outfit. The description below only adds context the reference cannot carry.'
  }
];

// always-on clause — the whole point of a sheet is that the panels agree with each other
const CONSISTENCY =
  'CONSISTENCY — one subject, one wardrobe, one hair state, one lighting setup, one lens character and one colour grade across every panel. Treat the sheet as a single photographic session with a locked rig, not a collage of separate images. No panel drifts in age, build, palette or exposure.';

// style axes pulled from the FrameForge cinematic library (same data the Prompt Builder uses)
const STYLE_AXES = [
  { type: 'Style', label: 'Style' },
  { type: 'Look & Feel', label: 'Look & Feel' },
  { type: 'Film Stock', label: 'Film Stock' },
  { type: 'Lighting Style', label: 'Lighting' },
  { type: 'Lens Type', label: 'Lens' },
  { type: 'Atmosphere', label: 'Atmosphere' }
];

const flat = s => (s || '').replace(/\s+/g, ' ').trim();

// ── style lock editor ──────────────────────────────────────────────────────────────────────────
// Ported from ReelStack's StyleLockEditor: `baseline` is what the axis picks compose, `value` is
// what actually ships. While they match the textarea tracks the picks live; the moment the user
// types, the parent stops overwriting it and Reset hands control back to the baseline.
class StyleLockEditor extends React.Component {
  constructor(props) { super(props); this.ref = React.createRef(); }
  componentDidMount() { this.grow(); }
  componentDidUpdate(prev) { if (prev.value !== this.props.value) this.grow(); }
  grow() {
    const el = this.ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, (this.props.rows || 3) * 22) + 'px';
  }
  render() {
    const { value, baseline, onChange, onReset } = this.props;
    // An emptied box is still an override — without this the reset link hides exactly when the
    // user needs it, and since pickStyle() only tracks while value === baseline the picks can
    // never repopulate it. Clearing the textarea would be a one-way trip.
    const overridden = value !== baseline;
    const words = value ? value.trim().split(/\s+/).filter(Boolean).length : 0;
    return (
      <div>
        <div style={sx('display:flex;align-items:baseline;gap:10px;margin-bottom:7px')}>
          <span style={eyebrow('var(--fg-muted)', 9.5)}>Style Lock</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: overridden ? AMBER : 'var(--fg-faint)' }}>
            {overridden ? 'edited' : value ? 'from picks' : 'empty'}{value ? ' · ' + words + 'w · ' + value.length + 'c' : ''}
          </span>
          {overridden && (
            <span onClick={onReset} title="Discard your edits and snap back to the axis picks" className="hFgL"
              style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)' }}>reset to picks</span>
          )}
        </div>
        <textarea ref={this.ref} value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          placeholder="Pick style axes above to compose a lock — or type your own here and it becomes the source of truth."
          style={{ ...sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);line-height:1.6;padding:10px 12px;display:block'), fontFamily: MONO, fontSize: 11 }} />
        <div style={{ ...sx('margin-top:5px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
          this exact string is injected as the STYLE LOCK line — edit freely
        </div>
      </div>
    );
  }
}

// ── tiny CSS-drawn layout preview (no image assets) ────────────────────────────────────────────
function sketch(kind, on) {
  const cell = { background: on ? 'var(--accent-35)' : 'rgba(255,255,255,.16)', borderRadius: 1 };
  const base = { ...sx('display:grid;width:100%;aspect-ratio:16/9;padding:3px;border-radius:3px;background:rgba(0,0,0,.35)'), gap: 2, border: '1px solid rgba(255,255,255,.06)' };
  if (kind === 'sheet') {
    return (
      <div style={{ ...base, gridTemplateRows: '1fr 0.55fr' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2 }}>
          {[0, 1, 2].map(i => <div key={i} style={cell} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ ...cell, background: on ? 'var(--accent-12)' : 'rgba(255,255,255,.09)' }} />)}
        </div>
      </div>
    );
  }
  const [cols, rows] = kind;
  return (
    <div style={{ ...base, gridTemplateColumns: 'repeat(' + cols + ',1fr)', gridTemplateRows: 'repeat(' + rows + ',1fr)' }}>
      {Array.from({ length: cols * rows }).map((_, i) => <div key={i} style={cell} />)}
    </div>
  );
}

// ── the tool ───────────────────────────────────────────────────────────────────────────────────
export default class SheetComposer extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      layout: 'turnaround-3view',
      axis: 'turnaround-3',
      subject: '',
      hasRef: false,
      refDesc: '',
      subjectSource: 'from-text',
      outputRules: 'hairline-dividers',
      framing: '',        // SHOT_TYPE_LIB slug — optional framing bias
      move: '',           // CAMERA_MOVEMENTS id — optional note for the later video pass
      stylePicks: {},     // { [cinematic type]: option name }
      styleLock: '',      // effective string (baseline until the user types)
      assetsOpen: false
    };
  }

  // ── selection plumbing ──
  layoutDef() { return LAYOUTS.find(l => l.slug === this.state.layout) || LAYOUTS[0]; }
  axesFor(slug) { return AXES.filter(a => a.layouts.indexOf(slug) >= 0); }
  axisDef() {
    const ok = this.axesFor(this.state.layout);
    return ok.find(a => a.slug === this.state.axis) || ok[0] || AXES[0];
  }
  pickLayout(slug) {
    const l = LAYOUTS.find(x => x.slug === slug);
    const ok = this.axesFor(slug);
    const keep = ok.some(a => a.slug === this.state.axis);
    this.setState({ layout: slug, axis: keep ? this.state.axis : (l.defaultAxis || (ok[0] && ok[0].slug)) });
  }

  // style picks → baseline string; the editor owns the value once it diverges
  baseline() {
    const parts = [];
    for (const ax of STYLE_AXES) {
      const name = this.state.stylePicks[ax.type];
      if (!name) continue;
      const opt = optionsOfType(ax.type).find(o => o.name === name);
      if (opt && opt.f) parts.push(flat(opt.f));
    }
    return parts.join(', ');
  }
  pickStyle(type, name) {
    const wasBaseline = this.state.styleLock === this.baseline();
    const stylePicks = { ...this.state.stylePicks };
    if (name) stylePicks[type] = name; else delete stylePicks[type];
    this.setState({ stylePicks }, () => {
      // only track the picks while the user hasn't taken ownership of the textarea
      if (wasBaseline) this.setState({ styleLock: this.baseline() });
    });
  }

  // ── cast / locations pull ──
  // Board assets are per-project; Tools is a global page, so fall back to the first project.
  boardAssets() {
    const app = this.props.app;
    // projDef() reads app.state.projects directly, so bail before calling it when there is
    // nothing to look up — a half-guarded pid would still throw inside projDef.
    const projects = (app.state && app.state.projects) || [];
    const pid = app.state.proj || (projects[0] && projects[0].id);
    if (!pid || !projects.length || typeof app.projDef !== 'function') return [];
    const pdef = app.projDef(pid) || {};
    const items = ((pdef.context || {}).items) || [];
    const kinds = ASSET_KIND_FOLDERS.filter(k => k.id === 'cast' || k.id === 'locations');
    return items.filter(c => (c.type === 'image' || c.type === 'video') && kinds.some(k => k.match.test(c.folder || '')));
  }
  useAsset(c) {
    const desc = (c.meta && c.meta.description) || '';
    const nice = c.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
    this.setState({
      subject: desc ? nice + ' — ' + flat(desc) : nice,
      hasRef: true,
      subjectSource: 'from-image-ref',
      refDesc: nice,
      assetsOpen: false
    });
    this.props.app.showToast('Pulled ' + c.name + ' from ' + (c.folder || 'board') + ' — attach the file yourself when you generate', AMBER);
  }

  // ── composition ──
  compose() {
    const S = this.state;
    const L = this.layoutDef(), A = this.axisDef();
    const src = SUBJECT_SOURCES.find(s => s.slug === S.subjectSource) || SUBJECT_SOURCES[0];
    const rules = OUTPUT_RULES.find(r => r.slug === S.outputRules) || OUTPUT_RULES[0];
    const shot = SHOT_TYPE_LIB.find(t => t.slug === S.framing);
    const mv = CAMERA_MOVEMENTS.find(m => m.id === S.move);
    const subject = S.subject.trim() || '[describe the subject]';

    const lines = [];
    lines.push('SHEET — ' + L.label.toUpperCase() + ' · ' + L.panels + ' PANELS');
    lines.push('');
    lines.push('SUBJECT: ' + subject);
    if (S.hasRef && S.refDesc.trim()) lines.push('REFERENCE: ' + S.refDesc.trim());
    lines.push('SUBJECT SOURCE: ' + src.body);
    lines.push('');
    lines.push('LAYOUT: ' + L.body);
    lines.push('');
    lines.push('PANELS: ' + A.body);
    if (shot) lines.push('FRAMING BIAS: ' + shot.promptFragment + '.');
    lines.push('');
    if (S.styleLock.trim()) { lines.push('STYLE LOCK: ' + flat(S.styleLock)); lines.push(''); }
    lines.push(CONSISTENCY);
    lines.push('');
    lines.push('OUTPUT: ' + rules.body);
    if (mv) { lines.push(''); lines.push('INTENDED MOTION (for the later video pass, not this still): ' + mv.promptFragment); }
    return lines.join('\n');
  }

  // ── handoffs ──
  copy() {
    navigator.clipboard && navigator.clipboard.writeText(this.compose()).catch(() => { });
    this.props.app.showToast('Sheet prompt copied to clipboard', AMBER);
  }
  toBuilder() {
    const { app } = this.props;
    app.go('tools', { toolsSel: 'builder', pbInsert: this.compose() });
  }
  toGenerate() {
    const { app } = this.props;
    app.jumpToGenerate();
    app.setState({ genPrompt: this.compose() });
    app.showToast('Sheet prompt loaded into Generate', GREEN);
  }

  // ── render pieces ──
  renderLayoutCards() {
    const S = this.state;
    return (
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
        {LAYOUTS.map(l => {
          const on = S.layout === l.slug;
          return (
            <div key={l.slug} onClick={() => this.pickLayout(l.slug)} className={on ? '' : 'hCard'} title={l.sub}
              style={{ ...sx('display:flex;flex-direction:column;gap:6px;padding:7px;border-radius:7px;cursor:pointer'), background: on ? 'var(--accent-05)' : 'var(--surface)', border: '1px solid ' + (on ? 'var(--accent-60)' : 'var(--border)') }}>
              {sketch(l.sketch, on)}
              <div>
                <div style={{ ...sx('font-weight:700;line-height:1.2'), fontSize: 11, color: on ? AMBER : 'var(--fg)' }}>{l.label}</div>
                <div style={{ ...sx('margin-top:2px;line-height:1.35;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>{l.sub}</div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  renderSelect(label, value, onChange, options, hint) {
    return (
      <div>
        <div style={sx('display:flex;align-items:baseline;gap:8px;margin-bottom:6px')}>
          <span style={eyebrow('var(--fg-muted)', 9.5)}>{label}</span>
          {hint && <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9 }}>{hint}</span>}
        </div>
        <select value={value} onChange={e => onChange(e.target.value)}
          style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);padding:7px 9px'), fontFamily: MONO, fontSize: 10 }}>
          {options}
        </select>
      </div>
    );
  }

  render() {
    const S = this.state;
    const { app } = this.props;
    const L = this.layoutDef(), A = this.axisDef();
    const out = this.compose();
    const base = this.baseline();
    const assets = this.boardAssets();
    const ready = !!S.subject.trim();
    const words = out.split(/\s+/).filter(Boolean).length;
    const chip = (label, onClick, accent) => (
      <span onClick={onClick} className={accent ? 'hBtnAccent' : 'hBd'}
        style={{ ...sx('padding:7px 15px;border-radius:7px;cursor:pointer;font-weight:700'), fontFamily: MONO, fontSize: 10, background: accent ? AMBER : 'transparent', color: accent ? 'var(--on-accent)' : 'var(--fg-soft)', border: accent ? '1px solid ' + AMBER : '1px solid var(--border-2)' }}>{label}</span>
    );

    return (
      <div style={sx('padding:22px 28px 90px')}>
        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Sheet Composer</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>axis × subject × layout — turnarounds, location plates, contact sheets, model sheets</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Deterministic fragment assembly, no AI in the loop. The tool returns prompt text — take it to Generate, the Prompt Builder, or paste it anywhere.</div>

        <div style={sx('display:grid;grid-template-columns:270px minmax(0,1fr);gap:22px;align-items:start')}>
          {/* ————— settings sidebar ————— */}
          <div style={sx('position:sticky;top:16px;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:14px;display:flex;flex-direction:column;gap:14px;max-height:calc(100vh - 100px);overflow-y:auto')}>
            <div>
              <div style={{ ...eyebrow(), ...sx('margin-bottom:8px') }}>1 · Sheet</div>
              {this.renderLayoutCards()}
            </div>

            {this.renderSelect('2 · What varies', S.axis, v => this.setState({ axis: v }),
              this.axesFor(S.layout).map(a => <option key={a.slug} value={a.slug}>{a.label}</option>),
              A.panels + ' panels')}

            {this.renderSelect('3 · Subject source', S.subjectSource, v => this.setState({ subjectSource: v, hasRef: v === 'from-image-ref' }),
              SUBJECT_SOURCES.map(s => <option key={s.slug} value={s.slug}>{s.label}</option>))}

            {this.renderSelect('4 · Output rules', S.outputRules, v => this.setState({ outputRules: v }),
              OUTPUT_RULES.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>))}

            <div style={sx('border-top:1px solid var(--line);padding-top:12px;display:flex;flex-direction:column;gap:12px')}>
              <div style={eyebrow()}>Optional</div>
              {this.renderSelect('Framing bias', S.framing, v => this.setState({ framing: v }),
                [<option key="" value="">none — layout decides</option>].concat(
                  SHOT_TYPE_LIB.filter(t => t.type === 'single').map(t => <option key={t.slug} value={t.slug}>{t.name}</option>)))}
              {this.renderSelect('Intended move', S.move, v => this.setState({ move: v }),
                [<option key="" value="">none</option>].concat(
                  CAMERA_MOVEMENTS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)),
                'video pass')}
            </div>

            <div style={{ ...sx('border-top:1px dashed var(--border);padding-top:10px;line-height:1.5;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              the result is one image containing {L.panels} panels — cut it into frames with the Grid Splitter.
            </div>
          </div>

          {/* ————— main canvas ————— */}
          <div style={sx('display:flex;flex-direction:column;gap:18px')}>
            {/* subject */}
            <div style={sx('border:1px solid var(--border);border-radius:10px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:baseline;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow('var(--fg-muted)')}>Subject</span>
                <span onClick={() => this.setState(s => ({ assetsOpen: !s.assetsOpen }))} className="hAccent"
                  style={{ ...sx('margin-left:auto;cursor:pointer'), fontFamily: MONO, fontSize: 9.5, color: assets.length ? AMBER : 'var(--fg-faint)', letterSpacing: '.1em' }}>
                  PULL FROM CAST / LOCATIONS ({assets.length})
                </span>
              </div>

              {S.assetsOpen && (
                <div style={sx('padding:12px 18px 0')}>
                  {assets.length ? (
                    <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
                      {assets.slice(0, 40).map(c => (
                        <span key={(c.folder || '') + '/' + c.name} onClick={() => this.useAsset(c)} className="hBdAccentChip"
                          title={(c.meta && c.meta.description) || c.name}
                          style={{ ...sx('padding:4px 11px;border-radius:99px;border:1px solid var(--border-2);cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 9.5 }}>
                          {c.folder} · {c.name.replace(/\.[^.]+$/, '')}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div style={{ ...sx('color:var(--fg-faint);text-transform:uppercase;letter-spacing:.1em;line-height:1.6'), fontFamily: MONO, fontSize: 9.5 }}>
                      No cast or location assets yet — add them under Assets, then pull one in here
                    </div>
                  )}
                </div>
              )}

              <div style={sx('padding:14px 18px 16px;display:flex;flex-direction:column;gap:12px')}>
                <textarea value={S.subject} onChange={e => this.setState({ subject: e.target.value })}
                  onKeyDown={e => e.stopPropagation()} rows={3}
                  placeholder="e.g. late-30s woman, close-cropped dark hair, olive field jacket over a grey tee, worn leather boots, quiet and watchful"
                  style={sx('width:100%;box-sizing:border-box;resize:vertical;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:12.5px;line-height:1.6;padding:11px 13px')} />

                <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
                  <span onClick={() => this.setState(s => ({ hasRef: !s.hasRef, subjectSource: !s.hasRef ? 'from-image-ref' : 'from-text' }))}
                    style={{ ...sx('padding:4px 12px;border-radius:99px;cursor:pointer;font-weight:600'), fontFamily: MONO, fontSize: 9.5, color: S.hasRef ? 'var(--on-accent)' : 'var(--fg-muted)', background: S.hasRef ? GREEN : 'transparent', border: '1px solid ' + (S.hasRef ? GREEN : 'var(--border-2)') }}>
                    {S.hasRef ? '✓ reference image attached' : '+ I have a reference image'}
                  </span>
                  {S.hasRef && (
                    <input value={S.refDesc} onChange={e => this.setState({ refDesc: e.target.value })}
                      onKeyDown={e => e.stopPropagation()}
                      placeholder="one-line description of the reference…"
                      style={{ ...sx('flex:1;min-width:220px;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);padding:6px 10px'), fontFamily: MONO, fontSize: 10 }} />
                  )}
                </div>
                {S.hasRef && (
                  <div style={{ ...sx('color:var(--fg-faint);line-height:1.5'), fontFamily: MONO, fontSize: 9.5 }}>
                    attach the file yourself in Generate — the composer only injects the REFERENCE LOCK clause.
                  </div>
                )}
              </div>
            </div>

            {/* style lock */}
            <div style={sx('border:1px solid var(--border);border-radius:10px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:baseline;gap:10px;padding:12px 18px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow('var(--fg-muted)')}>Look</span>
                <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>same axes the Prompt Builder uses</span>
              </div>
              <div style={sx('padding:14px 18px 16px;display:flex;flex-direction:column;gap:14px')}>
                <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px')}>
                  {STYLE_AXES.map(ax => (
                    <div key={ax.type}>
                      <div style={{ ...eyebrow('var(--fg-faint)', 9), ...sx('margin-bottom:5px') }}>{ax.label}</div>
                      <select value={S.stylePicks[ax.type] || ''} onChange={e => this.pickStyle(ax.type, e.target.value)}
                        style={{ ...sx('width:100%;box-sizing:border-box;background:var(--ink);border:1px solid var(--border);border-radius:6px;color:var(--fg);padding:6px 8px'), fontFamily: MONO, fontSize: 10 }}>
                        <option value="">—</option>
                        {optionsOfType(ax.type).map(o => <option key={o.name} value={o.name}>{o.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <StyleLockEditor value={S.styleLock} baseline={base} rows={3}
                  onChange={v => this.setState({ styleLock: v })}
                  onReset={() => this.setState({ styleLock: base })} />
              </div>
            </div>

            {/* composed prompt */}
            <div style={sx('border:1px solid var(--accent-35);border-top:2px solid var(--accent-60);border-radius:10px;background:var(--surface);overflow:hidden')}>
              <div style={sx('display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid var(--line)')}>
                <span style={eyebrow('var(--sand)')}>Composed Prompt</span>
                <span style={{ fontFamily: MONO, fontSize: 9.5, color: GREEN }}>◈ {L.label} · {A.panels} panels</span>
                <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 9.5, color: 'var(--fg-faint)', opacity: ready ? 1 : .7 }}>
                  {ready ? words + ' words · ' + out.length + ' chars' : 'waiting for a subject'}
                </span>
              </div>
              <pre style={{ ...sx('margin:0;padding:16px 18px;max-height:420px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;line-height:1.7;color:var(--fg)'), fontFamily: MONO, fontSize: 11 }}>{out}</pre>
              <div style={sx('display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line);flex-wrap:wrap;align-items:center')}>
                <span style={{ ...sx('color:var(--fg-faint);line-height:1.5;flex:1;min-width:260px'), fontFamily: MONO, fontSize: 9.5 }}>
                  this is a contact sheet — one image, {L.panels} panels. Cut it into single frames with the Grid Splitter
                  {' '}<span onClick={() => app.setState({ toolsSel: 'gridsplit' })} className="hAccent" style={{ ...sx('cursor:pointer;font-weight:700'), color: AMBER }}>⊞ open</span>.
                </span>
                {chip('→ PROMPT BUILDER', () => this.toBuilder())}
                {chip('→ GENERATE', () => this.toGenerate())}
                {chip('COPY PROMPT', () => this.copy(), true)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
