// Tools suite (F3.3–F3.6): Look Extractor · Shot Types · Transcriber · Model Catalog.
// Look extraction = canvas measurements (k-means palette extraction) + the Groq
// "senior DP" prompt; every look saves as looks/<id>.md and pastes into shots and builders.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MODELS, PROVIDERS, KINDS, providerDef, providerHasKey, allModels } from './models';
import { SHOT_TYPE_LIB } from './shotTypes';
import { assetUrl } from './Moodboard';
import { MONO } from './tokens';

const label = t => <div style={{ ...sx('font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:7px;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>{t}</div>;
// shared page header — title + inline description + optional second line (toolkit scaffold)
const pageHead = (title, desc, sub) => (
  <>
    <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
      <div style={sx('font-weight:700;font-size:16px')}>{title}</div>
      <span style={sx('font-size:12px;color:var(--fg-faint)')}>{desc}</span>
    </div>
    <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>{sub}</div>
  </>
);

// ── canvas measurements — the numerical profile fed to the DP prompt (02b §A) ──
export async function measureImage(url) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => res(i); i.onerror = rej;
    i.src = url;
  });
  const w = 96, h = Math.max(1, Math.round(96 * img.height / img.width));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i], d[i + 1], d[i + 2]]);
  const luma = p => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const lumas = px.map(luma).sort((a, b) => a - b);
  const q = f => lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * f))];
  const avg = list => list.length ? list.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map(v => Math.round(v / list.length)) : [0, 0, 0];
  const hex = p => '#' + p.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  // k-means (k=5, 8 iterations) — simplified palette extractor
  let centers = [0, 1, 2, 3, 4].map(i => px[Math.floor(px.length * (i + 0.5) / 5)]);
  for (let it = 0; it < 8; it++) {
    const buckets = centers.map(() => []);
    for (const p of px) {
      let best = 0, bd = 1e9;
      centers.forEach((c, i) => { const dd = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (dd < bd) { bd = dd; best = i; } });
      buckets[best].push(p);
    }
    centers = buckets.map((b, i) => b.length ? avg(b) : centers[i]);
  }
  const sat = px.map(p => { const mx = Math.max(...p), mn = Math.min(...p); return mx ? (mx - mn) / mx : 0; });
  return {
    aspect: (img.width / img.height).toFixed(2),
    meanLuma: Math.round(lumas.reduce((a, b) => a + b, 0) / lumas.length),
    contrastRatio: +((q(0.95) + 5) / (q(0.05) + 5)).toFixed(1),
    saturationMean: +(sat.reduce((a, b) => a + b, 0) / sat.length).toFixed(2),
    shadowCast: hex(avg(px.filter(p => luma(p) < q(0.25)))),
    midCast: hex(avg(px.filter(p => { const l = luma(p); return l >= q(0.25) && l <= q(0.75); }))),
    highlightCast: hex(avg(px.filter(p => luma(p) > q(0.75)))),
    dominantPalette: centers.map(hex)
  };
}

// asset picker grid shared by Look Extractor and the Camera Move analyzer — all images across
// library + project boards. `rank` optionally floats the images a caller cares about to the
// front (the analyzer wants contact sheets first) without hiding the rest.
export function AssetPicker({ app, onPick, sel, rank, empty }) {
  const pool = [];
  (app.state.library.items || []).forEach(c => { if (c.type === 'image') pool.push({ ...c, scope: 'library' }); });
  app.state.projects.forEach(p => ((p.context || {}).items || []).forEach(c => { if (c.type === 'image') pool.push({ ...c, scope: p.id }); }));
  if (rank) pool.sort((a, b) => (rank(b) ? 1 : 0) - (rank(a) ? 1 : 0));
  return (
    <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:7px;max-height:300px;overflow-y:auto')}>
      {pool.map(c => {
        const on = sel && sel.scope === c.scope && sel.name === c.name && (sel.folder || '') === (c.folder || '');
        return (
          <div key={c.scope + '/' + (c.folder || '') + '/' + c.name} onClick={() => onPick(c)} title={c.name}
            className="hBd" style={{ ...sx('aspect-ratio:1;border-radius:8px;overflow:hidden;cursor:pointer;background:var(--surface)'), border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--border)') }}>
            <img src={assetUrl(c.scope, c.name, c.folder)} alt="" loading="lazy" style={sx('width:100%;height:100%;object-fit:cover')} />
          </div>
        );
      })}
      {!pool.length && <div style={{ ...sx('grid-column:1/-1;color:var(--fg-muted);padding:14px 0;letter-spacing:.08em'), fontFamily: MONO, fontSize: 10 }}>{empty || 'NO IMAGES YET — UPLOAD REFERENCES TO A BOARD OR THE LIBRARY'}</div>}
    </div>
  );
}

// shared "apply to shot" select
function ApplyToShot({ app, onApply }) {
  return (
    <select defaultValue="" onChange={e => { if (e.target.value) { const [pid, id] = e.target.value.split('::'); onApply(pid, id); e.target.value = ''; } }}
      style={sx('background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-size:11px;padding:6px 9px;max-width:220px')}>
      <option value="">Apply to shot ▾</option>
      {app.state.projects.map(p => (
        <optgroup key={p.id} label={p.name}>
          {(app.state.shots || []).filter(s => s.proj === p.id).map(s => <option key={s.id} value={p.id + '::' + s.id}>{s.id} · {s.title}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

// ── F3.3 Look Extractor ──
export class LookExtractor extends React.Component {
  constructor(props) {
    super(props);
    this.state = { sel: props.app.state.lookAsset || null, busy: false, result: null, looks: [], openLook: null };
  }
  componentDidMount() {
    this.loadLooks();
    if (this.state.sel) this.extract(this.state.sel);
  }
  async loadLooks() { try { this.setState({ looks: await api.looks() }); } catch { /* none */ } }
  async extract(c) {
    const { app } = this.props;
    if (this.state.busy) return;
    this.setState({ sel: c, busy: true, result: null });
    try {
      let measurements = null;
      try { measurements = await measureImage(assetUrl(c.scope, c.name, c.folder)); } catch { /* vision-only fallback */ }
      const rec = await api.extractLook(c.scope, c.name, c.folder, measurements);
      this.setState({ result: rec });
      app.showToast('Look saved — looks/' + rec.id + '.md', 'var(--ok)');
      this.loadLooks();
    } catch (e) { app.showToast('Extraction failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busy: false });
  }
  copy(text, what) {
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => { });
    this.props.app.showToast(what + ' copied', 'var(--accent)');
  }
  async applyToShot(pid, id, fragment) {
    const { app } = this.props;
    const sh = (app.state.shots || []).find(s => s.proj === pid && s.id === id);
    const prompt = ((sh?.prompt || '').trim() + '\n\n' + fragment).trim();
    await api.patchShot(pid, id, { prompt }, 'look fragment applied').catch(() => { });
    app.showToast('Look applied to ' + id, 'var(--ok)');
    app.sync();
  }
  renderLookCard(rec, full) {
    const { app } = this.props;
    return (
      <div key={rec.id} style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px 16px;display:flex;flex-direction:column;gap:11px')}>
        <div style={sx('display:flex;align-items:center;gap:9px')}>
          <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: 'var(--accent)' }}>{rec.id}</span>
          <span style={{ ...sx('color:var(--fg-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), fontFamily: MONO, fontSize: 9.5 }}>{rec.source}</span>
          <span style={sx('margin-left:auto;font-size:10px;color:var(--fg-faint);flex:none')}>{rec.created}</span>
          {!full && <span onClick={async () => { await api.deleteLook(rec.id).catch(() => { }); this.loadLooks(); }} className="hFgL" style={sx('font-size:11px;color:var(--danger);cursor:pointer;flex:none')}>✕</span>}
        </div>
        <div style={sx('font-size:12.5px;color:var(--fg);line-height:1.5')}>{rec.summary}</div>
        {(rec.palette || []).length > 0 && (
          <div style={sx('display:flex;gap:6px')}>
            {rec.palette.map((c, i) => (
              <div key={i} onClick={() => this.copy(c, c)} style={sx('cursor:pointer;text-align:center')}>
                <div style={{ ...sx('width:30px;height:30px;border-radius:7px;border:1px solid rgba(255,255,255,.12)'), background: c }} />
                {full && <div style={{ fontFamily: MONO, fontSize: 7.5, color: 'var(--fg-faint)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{c}</div>}
              </div>
            ))}
          </div>
        )}
        <div>
          {label('TIER 1 — COMPACT LOOK (paste anywhere)')}
          <div style={{ ...sx('padding:9px 11px;border:1px solid var(--accent-35);border-radius:9px;background:var(--ink);line-height:1.6;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>{rec.tier1}</div>
        </div>
        {full && (
          <div>
            {label('TIER 2 — MEASUREMENT-GROUNDED')}
            <div style={{ ...sx('padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--ink);line-height:1.6;color:var(--fg-muted);max-height:170px;overflow-y:auto'), fontFamily: MONO, fontSize: 10 }}>{rec.tier2}</div>
          </div>
        )}
        <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:11px')}>
          <span onClick={() => this.copy(rec.tier1, 'Tier-1 look')} className="hBdAccentChip" style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:4px 12px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>Copy tier1</span>
          <span onClick={() => this.copy(rec.tier2, 'Tier-2 look')} className="hBdAccentChip" style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:4px 12px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>Copy tier2</span>
          <span onClick={() => { app.go('tools', { toolsSel: 'builder', pbInsert: rec.tier1 }); }} className="hBdAccentChip" style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:4px 12px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 10 }}>→ Prompt Builder</span>
          <ApplyToShot app={app} onApply={(pid, id) => this.applyToShot(pid, id, rec.tier1)} />
        </div>
      </div>
    );
  }
  render() {
    const { app } = this.props;
    const S = this.state;
    return (
      <div style={sx('padding:22px 28px 90px')}>
      {pageHead('Look Extractor', 'any reference still → a reusable two-tier LOOK', 'The frame is measured on canvas, read by a senior-DP prompt, and saved as a paste-anywhere fragment.')}
      <div style={sx('display:grid;grid-template-columns:380px minmax(0,1fr);gap:22px;align-items:start')}>
        <div style={sx('position:sticky;top:16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px')}>
          {label('PICK A REFERENCE — library + every project board')}
          <AssetPicker app={app} sel={S.sel} onPick={c => this.extract(c)} />
          <div style={sx('font-size:10px;color:var(--fg-faint);margin-top:10px;line-height:1.6')}>
            The image is measured in-canvas (palette k-means, luma, contrast, casts) and read by
            Groq scout with a senior-DP prompt. Output: a 50-80 token reusable LOOK and a
            measurement-grounded tier-2. Saved to <span style={{ fontFamily: MONO, fontSize: 9.5 }}>looks/*.md</span>.
          </div>
        </div>
        <div style={sx('display:flex;flex-direction:column;gap:14px')}>
          {S.busy && (
            <div style={sx('border:1px dashed var(--accent-35);border-radius:12px;padding:32px;text-align:center')}>
              <span style={{ ...sx('color:var(--accent);font-weight:700;letter-spacing:.1em;animation:dl-pulse 1.1s infinite'), fontFamily: MONO, fontSize: 11 }}>✦ MEASURING + READING THE FRAME…</span>
            </div>
          )}
          {S.result && this.renderLookCard(S.result, true)}
          {!S.busy && !S.result && (
            <div style={sx('border:1px dashed var(--border-2);border-radius:12px;padding:44px 20px;text-align:center')}>
              <div style={{ ...sx('font-weight:700;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>NO LOOK YET — PICK A REFERENCE FRAME</div>
              <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-top:6px')}>Any analyzed still can become a reusable LOOK — grade, light and lens feel in one fragment.</div>
            </div>
          )}
          {S.looks.length > 0 && (
            <div>
              <div style={{ ...sx('font-weight:700;letter-spacing:.16em;color:var(--fg-muted);margin:8px 0 10px'), fontFamily: MONO, fontSize: 10 }}>SAVED LOOKS <span style={{ color: 'var(--accent)' }}>{S.looks.length}</span></div>
              <div style={sx('display:flex;flex-direction:column;gap:10px')}>
                {S.looks.filter(l => !S.result || l.id !== S.result.id).map(l => this.renderLookCard(l, false))}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    );
  }
}

// ── F3.4 Shot Types browser ──
export class ShotTypes extends React.Component {
  constructor(props) { super(props); this.state = { filter: 'all', q: '' }; }
  async apply(pid, id, fragment) {
    const { app } = this.props;
    const sh = (app.state.shots || []).find(s => s.proj === pid && s.id === id);
    const prompt = ((sh?.prompt || '').trim() + (sh?.prompt ? '. ' : '') + fragment).trim();
    await api.patchShot(pid, id, { prompt }, 'shot-type fragment applied').catch(() => { });
    app.showToast('Framing applied to ' + id, 'var(--ok)');
    app.sync();
  }
  render() {
    const { app } = this.props;
    const S = this.state;
    const list = SHOT_TYPE_LIB.filter(t =>
      (S.filter === 'all' || t.type === S.filter) &&
      (!S.q || (t.name + ' ' + t.description + ' ' + t.promptFragment).toLowerCase().includes(S.q.toLowerCase())));
    return (
      <div style={sx('padding:22px 28px 90px')}>
        {pageHead('Shot Types', '60 camera-grammar framings — genre-neutral, paste-ready', 'Single and multi-subject framings; each fragment drops into a shot prompt or the Prompt Builder.')}
        <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:16px')}>
          <div style={sx('display:flex;gap:4px')}>
            {[['all', 'All', SHOT_TYPE_LIB.length], ['single', 'Single', 30], ['multi', 'Multi', 30]].map(([v, l, n]) => {
              const on = S.filter === v;
              return <div key={v} onClick={() => this.setState({ filter: v })}
                style={{ ...sx('padding:4px 12px;border-radius:99px;cursor:pointer;font-size:11.5px'), background: on ? 'var(--fg)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--fg-muted)', border: '1px solid ' + (on ? 'var(--fg)' : 'var(--border-2)'), fontWeight: on ? 600 : 400 }}>{l} {n}</div>;
            })}
          </div>
          <input value={S.q} onChange={e => this.setState({ q: e.target.value })} placeholder="Search framing, grammar, purpose…"
            onKeyDown={e => e.stopPropagation()}
            style={sx('width:250px;background:var(--surface);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);font-size:11.5px;padding:6px 11px')} />
          <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10 }}>camera grammar · genre-neutral fragments · frontend/shotTypes.js</span>
        </div>
        <div style={sx('display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px')}>
          {list.map(t => (
            <div key={t.slug} style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:14px 16px;display:flex;flex-direction:column;gap:9px')}>
              <div style={sx('display:flex;align-items:center;gap:9px')}>
                <span style={{ ...sx('width:26px;height:26px;border-radius:7px;background:var(--surface-2);border:1px solid var(--border-2);display:flex;align-items:center;justify-content:center;flex:none;font-size:11px'), color: t.type === 'single' ? 'var(--fg-muted)' : 'var(--fg-muted)' }}>{t.type === 'single' ? '◉' : '◉◉'}</span>
                <span style={sx('font-size:13px;font-weight:700')}>{t.name}</span>
                <span style={{ ...sx('margin-left:auto;font-size:8.5px;font-weight:800;letter-spacing:.08em;border-radius:99px;padding:1.5px 8px;flex:none;text-transform:uppercase'), color: t.type === 'single' ? 'var(--fg-muted)' : 'var(--fg-muted)', border: '1px solid ' + (t.type === 'single' ? 'rgba(153,161,141,.4)' : 'rgba(153,161,141,.4)') }}>{t.type}</span>
              </div>
              <div style={sx('font-size:11px;color:var(--fg-muted);line-height:1.5')}>{t.description}</div>
              <div style={{ ...sx('padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--ink);line-height:1.55;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 9.5 }}>{t.promptFragment}</div>
              <div style={sx('display:flex;gap:8px;align-items:center;font-size:10.5px')}>
                <span onClick={() => { navigator.clipboard && navigator.clipboard.writeText(t.promptFragment).catch(() => { }); app.showToast('Fragment copied', 'var(--accent)'); }}
                  className="hBdAccentChip" style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:3px 11px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 9.5 }}>Copy</span>
                <span onClick={() => app.go('tools', { toolsSel: 'builder', pbInsert: t.promptFragment })}
                  className="hBdAccentChip" style={{ ...sx('border:1px solid var(--border-2);border-radius:99px;padding:3px 11px;cursor:pointer;color:var(--fg-soft)'), fontFamily: MONO, fontSize: 9.5 }}>→ Builder</span>
                <ApplyToShot app={app} onApply={(pid, id) => this.apply(pid, id, t.promptFragment)} />
              </div>
            </div>
          ))}
        </div>
        {!list.length && <div style={{ ...sx('padding:50px;text-align:center;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>NO SHOT TYPES MATCH</div>}
      </div>
    );
  }
}

// ── F3.5 Transcriber ──
export class Transcriber extends React.Component {
  constructor(props) { super(props); this.state = { busy: false, text: '', name: '', drag: false }; this.fileRef = React.createRef(); }
  async run(file) {
    const { app } = this.props;
    if (!file || this.state.busy) return;
    if (/\.aiff?$/i.test(file.name)) { app.showToast('Groq cannot read AIFF — use wav, mp3, m4a, ogg or webm', 'var(--danger)'); return; }
    this.setState({ busy: true, name: file.name });
    try {
      const r = await api.transcribe(file);
      this.setState({ text: (this.state.text ? this.state.text.trim() + '\n\n' : '') + r.text.trim() });
      app.showToast('Transcribed with Groq Whisper', 'var(--ok)');
    } catch (e) { app.showToast('Transcription failed — ' + (e.message || ''), 'var(--danger)'); }
    this.setState({ busy: false });
  }
  async saveNote(pid) {
    const { app } = this.props;
    await api.addNote(pid, 'transcript-' + new Date().toISOString().slice(0, 10), this.state.text, '').catch(() => { });
    app.showToast('Saved as a note in ' + pid, 'var(--ok)');
    app.sync();
  }
  async toStory(pid) {
    const { app } = this.props;
    try {
      const r = await api.story(pid);
      const base = (r.story.content || '').trim();
      await api.saveStory(pid, (base ? base + '\n\n' : '') + this.state.text.trim());
      app.showToast('Appended to ' + pid + ' story.md — break it into shots from the Story tab', 'var(--ok)');
    } catch { app.showToast('Could not write story', 'var(--danger)'); }
  }
  render() {
    const { app } = this.props;
    const S = this.state;
    const projSelect = (labelText, fn) => (
      <select defaultValue="" onChange={e => { if (e.target.value) { fn(e.target.value); e.target.value = ''; } }}
        style={sx('background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-size:11px;padding:6px 9px')}>
        <option value="">{labelText}</option>
        {app.state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
    return (
      <div style={sx('padding:22px 28px 90px')}>
        {pageHead('Transcriber', 'voice memo → editable transcript — Groq Whisper, free', 'Drop audio or video; the transcript can be saved as a project note or appended straight into a story.')}
        <input ref={this.fileRef} type="file" accept="audio/*,video/mp4,video/webm" style={{ display: 'none' }}
          onChange={e => { this.run(e.target.files[0]); e.target.value = ''; }} />
        <div
          onDragOver={e => { e.preventDefault(); if (!S.drag) this.setState({ drag: true }); }}
          onDragLeave={() => this.setState({ drag: false })}
          onDrop={e => { e.preventDefault(); this.setState({ drag: false }); this.run(e.dataTransfer.files[0]); }}
          onClick={() => !S.busy && this.fileRef.current && this.fileRef.current.click()}
          style={{ ...sx('border-radius:12px;padding:34px 20px;text-align:center;cursor:pointer;margin-bottom:16px'), border: S.drag ? '1px dashed var(--accent)' : '1px dashed var(--border-2)', background: S.drag ? 'var(--accent-05)' : 'var(--surface)' }}>
          {S.busy
            ? <span style={sx('font-size:12.5px;color:var(--accent);font-weight:600;animation:dl-pulse 1.1s infinite')}>🎙 Transcribing {S.name}…</span>
            : <>
              <div style={{ fontFamily: MONO, fontSize: 12, color: 'var(--fg-muted)' }}>Drop audio or video — or click to pick</div>
              <div style={{ ...sx('font-size:10px;color:var(--fg-faint);margin-top:5px'), fontFamily: MONO }}>flac mp3 mp4 mpeg m4a ogg opus wav webm — NOT aiff · whisper-large-v3-turbo · free</div>
            </>}
        </div>
        {S.text && (
          <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden')}>
            <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line)')}>
              <span style={{ ...sx('font-weight:700;letter-spacing:.16em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>TRANSCRIPT</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--fg-faint)' }}>{S.text.split(/\s+/).filter(Boolean).length} words · editable</span>
              <span onClick={() => this.setState({ text: '' })} className="hFgL" style={sx('margin-left:auto;font-size:10.5px;color:var(--fg-faint);cursor:pointer')}>Clear</span>
            </div>
            <textarea value={S.text} onChange={e => this.setState({ text: e.target.value })}
              onKeyDown={e => e.stopPropagation()}
              style={sx('width:100%;box-sizing:border-box;height:260px;resize:vertical;background:transparent;border:none;color:var(--fg);font-size:13px;line-height:1.7;padding:14px 16px')} />
            <div style={sx('display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line);align-items:center')}>
              <div onClick={() => { navigator.clipboard && navigator.clipboard.writeText(S.text).catch(() => { }); app.showToast('Transcript copied', 'var(--accent)'); }}
                className="hBd" style={sx('padding:7px 14px;border:1px solid var(--border-2);border-radius:8px;color:var(--fg-soft);font-weight:600;font-size:11.5px;cursor:pointer')}>Copy</div>
              {projSelect('Save as note to ▾', pid => this.saveNote(pid))}
              {projSelect('Send to story ▾', pid => this.toStory(pid))}
            </div>
          </div>
        )}
      </div>
    );
  }
}

// ── F3.6 Model Catalog — provider-aware list view (browse · filter by provider · select/deselect) ──
export class ModelCatalog extends React.Component {
  constructor(props) { super(props); this.state = { prov: 'all', kind: 'all', q: '' }; }
  // a provider is "connected" if the server said so (/api/state · providers) — for REST providers
  // also accept a freshly-typed key before the next state sync lands.
  connected(pid) {
    const app = this.props.app;
    const srv = (app.state.providers || {})[pid];
    const p = providerDef(pid);
    if (p && p.type === 'rest') return providerHasKey(app.state.settings, pid) || !!srv;
    return !!srv;
  }
  render() {
    const { app } = this.props;
    const st = app.state.settings;
    const d = st.modelDefaults || {};
    const off = new Set(st.disabledModels || []);
    const S = this.state;
    // curated + customModels (fal endpoints enabled from the synced catalog in Settings)
    const POOL = allModels(st);
    const toggle = (id, custom) => {
      if (custom) {   // synced-catalog extras are opt-in — "disable" = drop the entry
        app.saveSettings({ customModels: (st.customModels || []).filter(m => m.id !== id) });
        app.showToast(id + ' removed — re-enable it in Settings → FAL → Manage models', 'var(--fg-muted)');
        return;
      }
      const next = off.has(id) ? (st.disabledModels || []).filter(x => x !== id) : [...(st.disabledModels || []), id];
      app.saveSettings({ disabledModels: next });
      app.showToast(id + (off.has(id) ? ' enabled' : ' disabled — hidden from Generate'), off.has(id) ? 'var(--ok)' : 'var(--fg-muted)');
    };
    const q = S.q.trim().toLowerCase();
    const view = POOL.filter(m =>
      (S.prov === 'all' || m.provider === S.prov) &&
      (S.kind === 'all' || m.kind === S.kind) &&
      (!q || (m.id + ' ' + m.label + ' ' + (m.note || '')).toLowerCase().includes(q)));
    const enabledN = POOL.filter(m => !off.has(m.id)).length;

    const provChip = (id, lbl) => {
      const active = S.prov === id;
      const conn = id === 'all' ? null : this.connected(id);
      const n = id === 'all' ? POOL.length : POOL.filter(m => m.provider === id).length;
      return (
        <span key={id} onClick={() => this.setState({ prov: id })}
          style={{ ...sx('display:inline-flex;align-items:center;gap:7px;padding:5px 13px;border-radius:99px;cursor:pointer;font-size:11px;font-weight:700;white-space:nowrap;transition:all .12s'),
            background: active ? 'var(--fg)' : 'var(--surface-2)', color: active ? 'var(--on-accent)' : 'var(--fg-muted)', border: '1px solid ' + (active ? 'var(--fg)' : 'var(--border-2)') }}>
          {conn != null && <span style={{ width: 6, height: 6, borderRadius: 99, background: conn ? 'var(--ok)' : 'var(--danger)', flex: 'none' }} />}
          {lbl}<span style={{ fontFamily: MONO, fontSize: 9.5, opacity: .65 }}>{n}</span>
        </span>
      );
    };
    const kindChip = (id, lbl) => {
      const active = S.kind === id;
      return <span key={id} onClick={() => this.setState({ kind: id })}
        style={{ ...sx('padding:4px 11px;border-radius:99px;cursor:pointer;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase'),
          background: active ? 'var(--accent-12)' : 'transparent', color: active ? 'var(--accent)' : 'var(--fg-faint)', border: '1px solid ' + (active ? 'var(--accent-35)' : 'var(--border-2)') }}>{lbl}</span>;
    };
    const defRow = (key, labelText, kinds) => {
      const opts = POOL.filter(m => kinds.includes(m.kind) && (!off.has(m.id) || d[key] === m.id));
      return (
        <div key={key} style={sx('display:flex;align-items:center;gap:10px')}>
          <span style={sx('width:64px;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--fg-faint);text-transform:uppercase')}>{labelText}</span>
          <select value={d[key] || ''} onChange={e => app.saveSettings({ modelDefaults: { ...d, [key]: e.target.value } })}
            style={{ ...sx('flex:1;background:var(--ink);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:7px 9px'), fontFamily: MONO, fontSize: 10.5 }}>
            <option value="">— none —</option>
            {opts.map(m => <option key={m.id} value={m.id}>{(providerDef(m.provider)?.label || m.provider)} · {m.label}</option>)}
          </select>
        </div>
      );
    };
    const notReady = S.prov !== 'all' && !this.connected(S.prov) ? providerDef(S.prov) : null;

    return (
      <div style={sx('padding:22px 28px 90px')}>
        {pageHead('Model Catalog', 'every model in the stack, with prices', 'Filter by provider or kind, toggle what Generate can see, and set the per-purpose defaults.')}
        {/* provider filter — each chip shows a live connection dot */}
        <div style={sx('display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px')}>
          {provChip('all', 'All providers')}
          {PROVIDERS.map(p => provChip(p.id, p.label))}
        </div>

        {notReady && (
          <div style={sx('display:flex;align-items:center;gap:10px;border:1px solid rgba(240,91,84,.35);background:rgba(240,91,84,.06);border-radius:10px;padding:10px 14px;margin-bottom:16px')}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--danger)', flex: 'none' }} />
            <span style={sx('font-size:11.5px;color:var(--fg-soft)')}><b>{notReady.label} isn’t connected.</b> {notReady.connect}.</span>
            <span onClick={() => app.go('settings')} className="hAccent" style={sx('margin-left:auto;font-size:11px;font-weight:700;color:var(--accent);cursor:pointer;white-space:nowrap')}>Open Settings →</span>
          </div>
        )}

        <div style={sx('border:1px solid var(--accent-35);border-radius:8px;background:var(--surface);padding:16px 18px;margin-bottom:18px;display:flex;flex-direction:column;gap:10px')}>
          <div style={{ ...sx('font-weight:700;letter-spacing:.16em;color:var(--fg-muted)'), fontFamily: MONO, fontSize: 10 }}>DEFAULTS — WHAT THE GENERATE TOOL REACHES FOR PER PURPOSE</div>
          {defRow('preview', 'Preview', ['preview', 'render'])}
          {defRow('render', 'Render', ['render', 'preview'])}
          {defRow('edit', 'Edit', ['edit'])}
          {defRow('video', 'Video', ['video'])}
          {defRow('music', 'Music', ['music'])}
          {defRow('voice', 'Voice', ['voice'])}
          {defRow('sfx', 'Sound FX', ['sfx'])}
          <div style={sx('font-size:10px;color:var(--fg-faint)')}>Persisted to <span style={{ fontFamily: MONO, fontSize: 9.5 }}>settings.md · modelDefaults</span>. The edit default is what reference-conditioned FAL generations auto-route to.</div>
        </div>

        {/* toolbar: search · kind filter · counts */}
        <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap')}>
          <input value={S.q} onChange={e => this.setState({ q: e.target.value })} onKeyDown={e => e.stopPropagation()}
            placeholder="Search models…" style={{ ...sx('background:var(--surface);border:1px solid var(--border-2);border-radius:8px;color:var(--fg);padding:7px 12px;width:230px'), fontFamily: MONO, fontSize: 11 }} />
          <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
            {kindChip('all', 'All')}
            {KINDS.map(k => kindChip(k.key, k.label))}
          </div>
          <span style={{ ...sx('margin-left:auto;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 10.5 }}>{view.length} shown · {enabledN}/{POOL.length} on</span>
        </div>

        {/* the list */}
        <div style={sx('border:1px solid var(--line);border-radius:8px;background:var(--surface);overflow:hidden')}>
          {!view.length && <div style={{ ...sx('padding:26px;text-align:center;color:var(--fg-muted);letter-spacing:.1em'), fontFamily: MONO, fontSize: 11 }}>NO MODELS MATCH</div>}
          {view.map((m, i) => {
            const on = !off.has(m.id);
            const conn = this.connected(m.provider);
            const pd = providerDef(m.provider);
            return (
              <div key={m.id} className="hRow" style={{ ...sx('display:flex;align-items:center;gap:11px;padding:9px 14px'), borderTop: i ? '1px solid var(--line)' : 'none', opacity: on ? 1 : 0.5 }}>
                <span onClick={() => toggle(m.id, m.custom)} title={on ? 'Enabled — click to hide from Generate + Prompt Builder' : 'Disabled — click to enable'}
                  style={{ ...sx('width:26px;height:15px;border-radius:99px;cursor:pointer;flex:none;position:relative;transition:background .15s'), background: on ? 'var(--accent)' : 'var(--border-2)' }}>
                  <span style={{ ...sx('position:absolute;top:1.5px;width:12px;height:12px;border-radius:99px;transition:left .15s'), left: on ? 12.5 : 1.5, background: on ? 'var(--on-accent)' : 'var(--fg-faint)' }} />
                </span>
                <span title={(pd?.label || m.provider) + (conn ? ' · connected' : ' · not connected — ' + (pd?.connect || ''))}
                  style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:99px;flex:none;width:104px;box-sizing:border-box'), border: '1px solid var(--border-2)', fontFamily: MONO, fontSize: 9 }}>
                  <span style={{ width: 5, height: 5, borderRadius: 99, background: conn ? 'var(--ok)' : 'var(--danger)', flex: 'none' }} />
                  <span style={{ color: 'var(--fg-muted)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pd?.label || m.provider}</span>
                </span>
                <span onClick={() => { navigator.clipboard && navigator.clipboard.writeText(m.slug || m.id).catch(() => { }); app.showToast((m.slug || m.id) + ' copied', 'var(--accent)'); }}
                  title="Click to copy the model id" className="hAccent" style={{ ...sx('width:250px;color:var(--fg-soft);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none'), fontFamily: MONO, fontSize: 10.5 }}>{m.id}</span>
                <span style={sx('font-size:12px;font-weight:600;flex:1;min-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.label}</span>
                <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.06em;border:1px solid var(--border-2);border-radius:99px;padding:1.5px 8px;color:var(--fg-faint);flex:none;text-transform:uppercase'), fontFamily: MONO }}>{m.kind}</span>
                <span style={sx('font-size:10.5px;color:var(--fg-faint);width:140px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{m.note}</span>
                <span style={{ ...sx('font-size:10px;color:var(--fg-muted);width:44px;text-align:right;flex:none'), fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}>${(m.cost ?? 0).toFixed(m.cost >= 0.1 ? 2 : 3)}</span>
                {on
                  ? <span onClick={() => { app.jumpToGenerate(); app.setState({ genModel: m.id }); }} className="hAccent" style={sx('font-size:10.5px;color:var(--accent);font-weight:600;cursor:pointer;flex:none;width:94px;text-align:right')}>Use in Generate →</span>
                  : <span style={{ ...sx('font-size:8.5px;font-weight:800;letter-spacing:.08em;flex:none;width:94px;text-align:right;color:var(--fg-faint)'), fontFamily: MONO }}>OFF</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
