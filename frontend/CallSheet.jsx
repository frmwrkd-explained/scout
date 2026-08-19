// Call Sheet — editable production call sheet with a live printable A4 preview.
// Prefills the production title from the current project and can pull scene rows
// from that project's shot list. Draft persists to localStorage; print = browser print → PDF.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

const AMBER = 'var(--accent)';
const GREEN = 'var(--ok)';
const RED = 'var(--danger)';
const LS_KEY = 'frameforge.callsheet.draft.v1';

// paper is built from the same tokens: ink var(--ink) on white, hairlines/tints as token alphas
const INK = 'var(--ink)';
const HAIR = 'rgba(13,14,17,.14)';
const ZEBRA = 'rgba(13,14,17,.035)';

// Only the sheet prints. Everything else is hidden, the sheet is promoted to the page origin.
// The app shell is height:100vh/overflow:hidden (App.jsx) and styles.css pins html,body,#root
// to height:100% — all three must be released or the sheet is clipped to a single page.
const PRINT_CSS = `
@page { size: A4; margin: 12mm; }
html, body { height: auto !important; overflow: visible !important; background: #FFFFFF !important; }
#root { height: auto !important; overflow: visible !important; }
body * { visibility: hidden !important; }
#ffCallSheet, #ffCallSheet * { visibility: visible !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
#ffCallSheet { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; max-width: none !important; margin: 0 !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; }
#ffCallSheet table tr, #ffCallSheet .ffAvoid { page-break-inside: avoid; break-inside: avoid; }
`;

const emptyCrew = call => ({ role: '', name: '', contact: '', callTime: call || '07:00' });
const emptyScene = () => ({ scene: '', description: '', cast: '', pages: '', location: '', dn: 'D' });

const blankSheet = () => ({
  production: '', episode: '', shootDay: '1', shootDays: '1',
  date: new Date().toISOString().slice(0, 10),
  generalCall: '07:00', shootCall: '08:00',
  weather: '', sunrise: '', sunset: '',
  locationName: '', locationAddress: '', parking: '', hospital: '',
  director: '', producer: '', ad: '', notes: '',
  crew: [
    { role: '1st AD', name: '', contact: '', callTime: '07:00' },
    { role: 'DP', name: '', contact: '', callTime: '07:00' },
    { role: 'Sound', name: '', contact: '', callTime: '07:00' }
  ],
  scenes: [emptyScene()]
});

const EXAMPLE = () => ({
  production: 'NOVA — AI Video Commercial', episode: 'Brand Spot · 30s + 15s cutdowns',
  shootDay: '2', shootDays: '4', date: new Date().toISOString().slice(0, 10),
  generalCall: '06:30', shootCall: '08:00',
  weather: '29°C · partly cloudy · 12% rain', sunrise: '05:42', sunset: '18:14',
  locationName: 'Studio 7 · Karrivin Plaza', locationAddress: '2316 Chino Roces Ave Ext, Makati City',
  parking: "Underground P2 · 14 slots reserved under 'NOVA'",
  hospital: 'Makati Medical Center · 5 min · +63 2 8888 8999',
  director: 'Theo Ramos', producer: 'Jana Cruz', ad: 'Miko Reyes',
  notes: 'AI plates rendered overnight — DIT to confirm sync before lunch. Generator at 75% load max. Lunch 13:00 at video village. Safety meeting at general call, attendance mandatory.',
  crew: [
    { role: '1st AD', name: 'Miko Reyes', contact: '+63 917 412 0098', callTime: '06:30' },
    { role: 'DP', name: 'Yuki Tanaka', contact: '+63 917 882 4411', callTime: '06:30' },
    { role: 'Gaffer', name: 'Carmen Velasco', contact: '+63 917 554 9912', callTime: '06:00' },
    { role: 'Key Grip', name: 'Boyet Santos', contact: '+63 999 110 4421', callTime: '06:00' },
    { role: 'Sound Mixer', name: 'Diego Aquino', contact: '+63 917 661 7723', callTime: '07:00' },
    { role: 'Production Designer', name: 'Mira Okafor', contact: '+63 917 808 2245', callTime: '05:30' },
    { role: 'DIT', name: 'Kenji Nakamura', contact: '+63 917 990 8821', callTime: '07:00' }
  ],
  scenes: [
    { scene: '1', description: 'INT. STUDIO — Hero product reveal on turntable', cast: 'Talent A', pages: '1/8', location: 'Studio 7 — Cyc A', dn: 'D' },
    { scene: '2', description: 'INT. STUDIO — Slow-mo pour, macro lens', cast: 'Hand model', pages: '2/8', location: 'Studio 7 — Cyc A', dn: 'D' },
    { scene: '3', description: 'INT. STUDIO — Lifestyle tableau, group of 3', cast: 'Talent A, B, C', pages: '4/8', location: 'Studio 7 — Cove B', dn: 'D' },
    { scene: '4', description: 'EXT. ROOFTOP — Golden hour brand frame', cast: 'Talent A', pages: '1 1/8', location: 'Rooftop deck', dn: 'N' }
  ]
});

// 'YYYY-MM-DD' → 'SATURDAY · 19 JUL 2026'. Split manually so it stays local-time, not UTC.
function fmtDate(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  if (p.length !== 3) return iso;
  const d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(d.getTime())) return iso;
  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return days[d.getDay()] + ' · ' + d.getDate() + ' ' + mons[d.getMonth()] + ' ' + d.getFullYear();
}

export default class CallSheet extends React.Component {
  constructor(props) {
    super(props);
    let sheet = null;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) sheet = { ...blankSheet(), ...JSON.parse(raw) };
    } catch (e) { /* corrupt / unavailable storage — fall through to a blank sheet */ }
    if (!sheet) {
      sheet = blankSheet();
      sheet.production = this.projectName();
    }
    this.state = { sheet };
  }
  componentDidUpdate(prevProps, prevState) {
    if (prevState.sheet !== this.state.sheet) {
      try { window.localStorage.setItem(LS_KEY, JSON.stringify(this.state.sheet)); } catch (e) { /* quota / private mode */ }
    }
  }
  // ── project bridge ──
  pid() {
    const st = this.props.app.state;
    return st.proj || (st.projects && st.projects[0] && st.projects[0].id) || null;
  }
  projectName() {
    const st = this.props.app.state;
    const p = (st.projects || []).find(x => x.id === this.pid());
    return (p && (p.name || p.id)) || '';
  }
  projectShots() {
    const pid = this.pid();
    if (!pid) return [];
    return (this.props.app.state.shots || []).filter(s => s.proj === pid);
  }
  // Shot records store cast/loc as asset KEYS (Story.jsx: mentionKey = filename minus
  // extension, lowercased). Most board assets are machine-named (gen-1784…), so print the
  // human label when the sidecar has one and blank otherwise — a UUID on a call sheet is
  // worse than an empty cell the AD fills in by hand.
  entLabels() {
    const { app } = this.props;
    const pid = this.pid();
    const pool = [];
    const p = (app.state.projects || []).find(x => x.id === pid);
    (((p || {}).context || {}).items || []).forEach(c => pool.push(c));
    ((app.state.library || {}).items || []).forEach(c => pool.push(c));
    const m = new Map();
    for (const c of pool) {
      if (!c || !c.name) continue;
      const key = String(c.name).replace(/\.\w+$/, '').toLowerCase();
      if (m.has(key)) continue;
      const meta = c.meta || {};
      const desc = String(meta.description || '').trim();
      const human = meta.title || meta.label
        || (/^gen-\d/.test(key) ? '' : String(c.name).replace(/\.\w+$/, ''))
        || (desc ? desc.split(/[,.]/)[0].trim().slice(0, 32) : '');
      m.set(key, human);
    }
    return m;
  }
  labelFor(key, m) {
    if (!key) return '';
    const v = m.get(String(key).toLowerCase());
    return v === undefined ? String(key) : v;   // unknown key → keep it; known-but-unnamed → blank
  }
  pullScenes() {
    const shots = this.projectShots().slice().sort((a, b) => (a.no || 0) - (b.no || 0));
    if (!shots.length) { this.props.app.showToast('No shots on this project yet', RED); return; }
    const labels = this.entLabels();
    const scenes = shots.map((s, i) => {
      const head = s.title || s.desc || s.id;
      // compare against `head`, not `s.title` — an untitled shot falls back to desc for the
      // head, and comparing to the empty title would append the same text a second time.
      const body = s.desc && s.desc !== head ? ' · ' + s.desc : '';
      const text = (head + body).toUpperCase();
      return {
        scene: String(s.scene || s.no || i + 1),
        description: head + body,
        cast: (Array.isArray(s.cast) ? s.cast : (s.cast ? [s.cast] : []))
          .map(k => this.labelFor(k, labels)).filter(Boolean).join(', '),
        pages: '',
        location: this.labelFor(s.loc, labels),
        dn: /NIGHT|DUSK|EXT\.?\s*NIGHT/.test(text) ? 'N' : 'D'
      };
    });
    this.set({ scenes });
    this.props.app.showToast(scenes.length + ' scenes pulled from the shot list', GREEN);
  }
  useProjectTitle() {
    const n = this.projectName();
    if (!n) { this.props.app.showToast('No project selected', RED); return; }
    this.set({ production: n });
  }
  // ── mutations ──
  set(patch) { this.setState(s => ({ sheet: { ...s.sheet, ...patch } })); }
  setRow(list, i, key, value) {
    this.setState(s => ({ sheet: { ...s.sheet, [list]: s.sheet[list].map((r, ix) => ix === i ? { ...r, [key]: value } : r) } }));
  }
  addRow(list, row) { this.setState(s => ({ sheet: { ...s.sheet, [list]: [...s.sheet[list], row] } })); }
  delRow(list, i) { this.setState(s => ({ sheet: { ...s.sheet, [list]: s.sheet[list].filter((_, ix) => ix !== i) } })); }
  reset() {
    const s = blankSheet();
    s.production = this.projectName();
    this.setState({ sheet: s });
    this.props.app.showToast('Call sheet reset', AMBER);
  }
  downloadJson() {
    const S = this.state.sheet;
    const slug = (S.production || 'callsheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' }));
    a.download = 'callsheet-' + (slug || 'sheet') + '-day' + (S.shootDay || '1') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 200);
    this.props.app.showToast('callsheet .json downloaded', GREEN);
  }

  // ── form primitives ──
  input(value, onChange, placeholder, type, mono) {
    return (
      <input type={type || 'text'} value={value || ''} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
        style={{ ...sx('width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;background:var(--ink);border:1px solid var(--line);color:var(--fg)'), fontSize: mono ? 10.5 : 11.5, fontFamily: mono ? MONO : undefined, fontVariantNumeric: mono ? 'tabular-nums' : undefined }} />
    );
  }
  field(label, key, opts) {
    const o = opts || {};
    return (
      <div>
        <div style={{ ...sx('font-weight:700;text-transform:uppercase;margin-bottom:4px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9, letterSpacing: '.16em' }}>{label}</div>
        {this.input(this.state.sheet[key], v => this.set({ [key]: v }), o.ph, o.type, o.mono)}
      </div>
    );
  }
  section(title, right, children) {
    return (
      <div style={sx('border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:13px 14px 15px;display:flex;flex-direction:column;gap:10px')}>
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={{ ...sx('font-weight:700;text-transform:uppercase;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 9.5, letterSpacing: '.18em' }}>{title}</span>
          <span style={sx('flex:1')} />
          {right}
        </div>
        {children}
      </div>
    );
  }
  miniBtn(label, onClick, color) {
    return (
      <span onClick={onClick} className="hBd" style={{ ...sx('padding:4px 10px;border-radius:6px;cursor:pointer'), border: '1px solid var(--border-2)', color: color || 'var(--fg-muted)', fontFamily: MONO, fontSize: 9.5 }}>{label}</span>
    );
  }
  colHead(label) {
    return <span style={{ ...sx('text-transform:uppercase;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 8.5, letterSpacing: '.14em' }}>{label}</span>;
  }

  render() {
    const S = this.state.sheet;
    const nShots = this.projectShots().length;
    const sceneRows = S.scenes.filter(sc => sc.scene || sc.description);
    const crewRows = S.crew.filter(c => c.role || c.name);
    const sceneGrid = { display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) 92px 52px 92px 40px 20px', gap: 6, alignItems: 'center' };
    const crewGrid = { display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1.2fr) 106px 72px 20px', gap: 6, alignItems: 'center' };
    const del = onClick => <span onClick={onClick} className="hFg" style={{ ...sx('cursor:pointer;text-align:center;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 12 }} title="Remove row">×</span>;

    return (
      <div style={sx('padding:22px 28px 90px')}>
        <style media="print" dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Call Sheet</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>editable sheet, live A4 preview — print or save as PDF from the browser</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Draft is kept in this browser. Nothing is uploaded; the preview matches the print 1:1.</div>

        <div style={sx('display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap')}>
          <div onClick={() => window.print()} className="hBtnAccent" style={{ ...sx('padding:7px 16px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>PRINT / SAVE PDF</div>
          <div onClick={() => this.downloadJson()} className="hBd" style={{ ...sx('padding:7px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>JSON</div>
          <div onClick={() => this.setState({ sheet: EXAMPLE() })} className="hBd" style={{ ...sx('padding:7px 13px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>EXAMPLE</div>
          <div style={sx('flex:1')} />
          <div onClick={() => this.reset()} className="hFgL" style={{ ...sx('padding:7px 10px;color:var(--fg-faint);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>RESET</div>
        </div>

        <div style={sx('display:grid;grid-template-columns:minmax(420px,1fr) minmax(430px,1fr);gap:22px;align-items:start')}>

          {/* ── FORM ── */}
          <div style={sx('display:flex;flex-direction:column;gap:12px')}>

            {this.section('Production', this.miniBtn('↺ project title', () => this.useProjectTitle()), (
              <div style={sx('display:flex;flex-direction:column;gap:10px')}>
                {this.field('Production title', 'production', { ph: 'Title of the project' })}
                {this.field('Episode / day tag', 'episode', { ph: 'EP 3 · Pickup Day' })}
                <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.4fr;gap:8px')}>
                  {this.field('Shoot day', 'shootDay', { mono: true })}
                  {this.field('of', 'shootDays', { mono: true })}
                  {this.field('Date', 'date', { type: 'date', mono: true })}
                </div>
                <div style={sx('display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px')}>
                  {this.field('General call', 'generalCall', { type: 'time', mono: true })}
                  {this.field('Shoot call', 'shootCall', { type: 'time', mono: true })}
                  {this.field('Sunrise', 'sunrise', { type: 'time', mono: true })}
                  {this.field('Sunset', 'sunset', { type: 'time', mono: true })}
                </div>
                {this.field('Weather', 'weather', { ph: '28°C · partly cloudy' })}
              </div>
            ))}

            {this.section('Production heads', null, (
              <div style={sx('display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px')}>
                {this.field('Director', 'director')}
                {this.field('Producer', 'producer')}
                {this.field('1st AD', 'ad')}
              </div>
            ))}

            {this.section('Location & safety', null, (
              <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:8px')}>
                {this.field('Set name', 'locationName', { ph: 'Café 86' })}
                {this.field('Address', 'locationAddress', { ph: 'Street, city' })}
                {this.field('Parking', 'parking', { ph: 'Where the crew parks' })}
                {this.field('Nearest hospital', 'hospital', { ph: 'Name · minutes · phone' })}
              </div>
            ))}

            {this.section('Schedule', (
              <span style={sx('display:flex;gap:6px')}>
                {nShots > 0 ? this.miniBtn('⇩ pull ' + nShots + ' shots', () => this.pullScenes(), AMBER) : null}
                {this.miniBtn('+ scene', () => this.addRow('scenes', emptyScene()))}
              </span>
            ), (
              <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                <div style={sceneGrid}>
                  {this.colHead('#')}{this.colHead('Description')}{this.colHead('Cast')}{this.colHead('Pgs')}{this.colHead('Location')}{this.colHead('D/N')}<span />
                </div>
                {S.scenes.map((sc, i) => (
                  <div key={i} style={sceneGrid}>
                    {this.input(sc.scene, v => this.setRow('scenes', i, 'scene', v), '1', 'text', true)}
                    {this.input(sc.description, v => this.setRow('scenes', i, 'description', v), 'INT. CAFÉ — dialogue 2-shot')}
                    {this.input(sc.cast, v => this.setRow('scenes', i, 'cast', v), 'Cast 1, 2', 'text', true)}
                    {this.input(sc.pages, v => this.setRow('scenes', i, 'pages', v), '2 1/8', 'text', true)}
                    {this.input(sc.location, v => this.setRow('scenes', i, 'location', v), 'Set A', 'text', true)}
                    <select value={sc.dn || 'D'} onChange={e => this.setRow('scenes', i, 'dn', e.target.value)}
                      style={{ ...sx('width:100%;box-sizing:border-box;padding:6px 4px;border-radius:6px;background:var(--ink);border:1px solid var(--line);color:var(--fg);cursor:pointer'), fontFamily: MONO, fontSize: 10.5 }}>
                      <option value="D">D</option>
                      <option value="N">N</option>
                    </select>
                    {del(() => this.delRow('scenes', i))}
                  </div>
                ))}
                {!S.scenes.length && <div style={{ ...sx('padding:10px 0;color:var(--fg-faint);text-transform:uppercase;letter-spacing:.12em'), fontFamily: MONO, fontSize: 9.5 }}>No scenes — add one, or pull the shot list</div>}
              </div>
            ))}

            {this.section('Crew call times', this.miniBtn('+ crew', () => this.addRow('crew', emptyCrew(S.generalCall))), (
              <div style={sx('display:flex;flex-direction:column;gap:6px')}>
                <div style={crewGrid}>
                  {this.colHead('Role')}{this.colHead('Name')}{this.colHead('Contact')}{this.colHead('Call')}<span />
                </div>
                {S.crew.map((c, i) => (
                  <div key={i} style={crewGrid}>
                    {this.input(c.role, v => this.setRow('crew', i, 'role', v), 'DP')}
                    {this.input(c.name, v => this.setRow('crew', i, 'name', v), 'Name')}
                    {this.input(c.contact, v => this.setRow('crew', i, 'contact', v), '+63 9XX…', 'text', true)}
                    {this.input(c.callTime, v => this.setRow('crew', i, 'callTime', v), '', 'time', true)}
                    {del(() => this.delRow('crew', i))}
                  </div>
                ))}
                {!S.crew.length && <div style={{ ...sx('padding:10px 0;color:var(--fg-faint);text-transform:uppercase;letter-spacing:.12em'), fontFamily: MONO, fontSize: 9.5 }}>No crew — add a row</div>}
              </div>
            ))}

            {this.section('Notes', null, (
              <textarea value={S.notes} rows={4} placeholder="Special equipment, safety notes, wardrobe reminders…"
                onChange={e => this.set({ notes: e.target.value })}
                style={{ ...sx('width:100%;box-sizing:border-box;padding:8px 9px;border-radius:6px;background:var(--ink);border:1px solid var(--line);color:var(--fg);resize:vertical;line-height:1.55'), fontSize: 11.5 }} />
            ))}
          </div>

          {/* ── PRINTABLE SHEET ── */}
          <div id="ffCallSheet" style={{ ...sx('border-radius:6px;overflow:hidden;max-width:820px'), background: '#FFFFFF', color: INK, boxShadow: '0 18px 44px rgba(0,0,0,.5)' }}>

            {/* header band */}
            <div className="ffAvoid" style={{ ...sx('padding:22px 24px 18px;position:relative'), background: INK, color: 'var(--fg)' }}>
              <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:24px')}>
                <div style={sx('min-width:0')}>
                  <div style={{ ...sx('text-transform:uppercase;margin-bottom:7px;color:var(--accent)'), fontFamily: MONO, fontSize: 8.5, letterSpacing: '.22em' }}>
                    Call Sheet{S.episode ? ' · ' + S.episode : ''}
                  </div>
                  <div style={sx('font-size:28px;font-weight:800;line-height:1.02;letter-spacing:.01em;text-transform:uppercase')}>{S.production || 'Untitled Production'}</div>
                  <div style={{ ...sx('margin-top:9px;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>
                    {fmtDate(S.date)}{S.locationName ? ' · ' + S.locationName : ''}
                  </div>
                </div>
                <div style={sx('display:flex;align-items:flex-start;gap:18px;flex:none')}>
                  <div style={{ fontFamily: MONO, fontSize: 10, lineHeight: 1.75, textAlign: 'right' }}>
                    {[['General', S.generalCall, false], ['Shoot', S.shootCall, true], ['Sunrise', S.sunrise, false], ['Sunset', S.sunset, false]].map(([l, v, gold]) => (
                      <div key={l} style={sx('display:flex;justify-content:flex-end;gap:10px;align-items:baseline')}>
                        <span style={{ ...sx('text-transform:uppercase;color:var(--fg-faint)'), fontSize: 8, letterSpacing: '.18em' }}>{l}</span>
                        <span style={{ fontWeight: 700, color: gold ? AMBER : 'var(--fg)' }}>{v || '—'}</span>
                      </div>
                    ))}
                  </div>
                  <div style={sx('text-align:right')}>
                    <div style={{ ...sx('text-transform:uppercase;color:var(--accent);margin-bottom:2px'), fontFamily: MONO, fontSize: 8.5, letterSpacing: '.22em' }}>Day</div>
                    <div style={{ ...sx('font-weight:800;line-height:.85'), fontSize: 44, color: AMBER }}>{S.shootDay || '1'}</div>
                    <div style={{ ...sx('color:var(--fg-faint);margin-top:4px'), fontFamily: MONO, fontSize: 9 }}>of {S.shootDays || '1'}</div>
                  </div>
                </div>
              </div>
              <div style={{ ...sx('position:absolute;left:0;bottom:0;height:3px;width:22%'), background: AMBER }} />
            </div>

            <div style={sx('padding:16px 24px 4px')}>
              {this.sheetH2('Production Heads', 'key creative')}
              <div className="ffAvoid" style={sx('display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px')}>
                {[['Director', S.director, true], ['Producer', S.producer, false], ['1st AD', S.ad, false]].map(([role, name, lead]) => (
                  <div key={role} style={{ ...sx('padding:9px 11px'), border: '1px solid ' + HAIR, borderLeft: '3px solid ' + (lead ? AMBER : INK) }}>
                    <div style={{ ...sx('text-transform:uppercase;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 8, letterSpacing: '.2em' }}>{role}</div>
                    <div style={sx('font-size:13px;font-weight:700;margin-top:4px')}>{name || '—'}</div>
                  </div>
                ))}
              </div>

              {this.sheetH2('Location & Safety')}
              <div className="ffAvoid" style={sx('display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin-top:8px')}>
                <div style={{ ...sx('padding:10px 12px'), border: '1px solid ' + HAIR }}>
                  <div style={sx('font-size:16px;font-weight:800;line-height:1.1;text-transform:uppercase')}>{S.locationName || 'Set'}</div>
                  <div style={sx('font-size:11px;line-height:1.5;margin-top:4px;color:var(--fg-faint)')}>{S.locationAddress || '—'}</div>
                  {S.parking ? (
                    <div>
                      <div style={{ ...sx('text-transform:uppercase;color:var(--fg-faint);margin-top:9px'), fontFamily: MONO, fontSize: 8, letterSpacing: '.2em' }}>Parking</div>
                      <div style={sx('font-size:11px;margin-top:2px')}>{S.parking}</div>
                    </div>
                  ) : null}
                </div>
                <div style={{ ...sx('padding:10px 12px'), border: '1px solid ' + AMBER, background: 'var(--accent-12)' }}>
                  <div style={{ ...sx('text-transform:uppercase;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 8, letterSpacing: '.2em' }}>Nearest Hospital</div>
                  <div style={sx('font-size:12px;font-weight:700;margin-top:4px;line-height:1.4')}>{S.hospital || '—'}</div>
                  {S.weather ? (
                    <div style={{ ...sx('display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-top:9px;padding-top:6px'), borderTop: '1px dashed ' + HAIR, fontFamily: MONO, fontSize: 9.5 }}>
                      <span style={{ ...sx('text-transform:uppercase;color:var(--fg-faint)'), fontSize: 8, letterSpacing: '.16em' }}>Weather</span>
                      <span style={sx('font-weight:700;text-align:right')}>{S.weather}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              {this.sheetH2('Schedule', sceneRows.length + ' scene' + (sceneRows.length === 1 ? '' : 's'))}
              {this.sheetTable(
                [['#', 34], ['Description', 0], ['Cast', 96], ['Pgs', 44], ['Location', 96], ['D/N', 34]],
                sceneRows.length ? sceneRows.map((sc, i) => (
                  <tr key={i} style={{ background: i % 2 ? ZEBRA : 'transparent' }}>
                    <td style={{ ...this.td(), fontSize: 15, fontWeight: 800, lineHeight: 1 }}>{sc.scene || '—'}</td>
                    <td style={this.td()}>{sc.description || ''}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5 }}>{sc.cast || ''}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5 }}>{sc.pages || ''}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5 }}>{sc.location || ''}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5, fontWeight: 700 }}>{sc.dn || 'D'}</td>
                  </tr>
                )) : this.emptyRow(6, 'No scenes scheduled.')
              )}

              {this.sheetH2('Crew Call Times', crewRows.length + ' member' + (crewRows.length === 1 ? '' : 's'))}
              {this.sheetTable(
                [['Role', 130], ['Name', 0], ['Contact', 120], ['Call', 56]],
                crewRows.length ? crewRows.map((c, i) => (
                  <tr key={i} style={{ background: i % 2 ? ZEBRA : 'transparent' }}>
                    <td style={{ ...this.td(), fontWeight: 700 }}>{c.role || '—'}</td>
                    <td style={this.td()}>{c.name || '—'}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5 }}>{c.contact || '—'}</td>
                    <td style={{ ...this.td(), fontFamily: MONO, fontSize: 9.5, fontWeight: 700 }}>{c.callTime || '—'}</td>
                  </tr>
                )) : this.emptyRow(4, 'No crew added.')
              )}

              {S.notes ? (
                <div>
                  {this.sheetH2('Notes')}
                  <div className="ffAvoid" style={{ ...sx('padding:10px 12px;font-size:11px;line-height:1.6;margin-top:8px;white-space:pre-wrap'), border: '1px solid ' + HAIR, borderLeft: '3px solid ' + INK }}>{S.notes}</div>
                </div>
              ) : null}
            </div>

            <div style={{ ...sx('display:flex;justify-content:space-between;gap:12px;margin:16px 24px 0;padding:8px 0 18px;text-transform:uppercase;color:var(--fg-faint)'), borderTop: '1px solid ' + HAIR, fontFamily: MONO, fontSize: 8, letterSpacing: '.18em' }}>
              <span>{S.production || 'Call Sheet'} · Day {S.shootDay || '1'} of {S.shootDays || '1'}</span>
              <span>Generated with FrameForge</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── sheet primitives ──
  sheetH2(title, meta) {
    return (
      <div className="ffAvoid" style={{ ...sx('display:flex;justify-content:space-between;align-items:baseline;text-transform:uppercase;margin:18px 0 0;padding-bottom:5px;color:var(--fg-faint)'), borderBottom: '1px solid ' + HAIR, fontFamily: MONO, fontSize: 9, letterSpacing: '.22em' }}>
        <span>{title}</span>
        {meta ? <span style={{ fontSize: 8, letterSpacing: '.18em', color: 'var(--fg-muted)' }}>{meta}</span> : null}
      </div>
    );
  }
  td() { return { ...sx('padding:7px 9px;vertical-align:top;font-size:11px'), borderBottom: '1px solid ' + HAIR }; }
  emptyRow(span, text) {
    return (
      <tr><td colSpan={span} style={{ ...sx('padding:16px;text-align:center;font-style:italic;font-size:11px;color:var(--fg-muted)'), borderBottom: '1px solid ' + HAIR }}>{text}</td></tr>
    );
  }
  sheetTable(cols, rows) {
    return (
      <table style={sx('width:100%;border-collapse:collapse;margin-top:8px')}>
        <thead>
          <tr>
            {cols.map(([label, w]) => (
              <th key={label} style={{ ...sx('text-align:left;padding:6px 9px;text-transform:uppercase;font-weight:500'), background: INK, color: 'var(--fg)', fontFamily: MONO, fontSize: 8, letterSpacing: '.2em', width: w ? w : undefined }}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    );
  }
}
