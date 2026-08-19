// Screenplay — Fountain editor → industry-standard 12pt Courier page, live.
// Parses title page, scene headings, action, character, parenthetical, dialogue,
// transitions and centered text. Writes .fountain downloads and appends scene
// headings + action to the current project's story.md.
import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { MONO } from './tokens';

const COURIER = "'Courier New',Courier,monospace";
const AMBER = 'var(--accent)';

const SCENE_PREFIX = /^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i;

// Column geometry, in characters, relative to the 1.5in left page margin (12pt Courier = 10 chars/in).
// dialogue sits 1.0in in from the margin — 2.5in from the paper edge, per industry format.
const COLS = { width: 60, character: 22, parenthetical: 16, dialogue: 10, dialogueWidth: 35 };

function parseFountain(input) {
  const raw = String(input || '').replace(/\r\n/g, '\n');

  let title = '';
  let byline = '';
  const titlePageMatch = raw.match(/^([^\n]+:\s*[^\n]+(?:\n[^\n]+:\s*[^\n]+)*)\n\n/);
  let body = raw;
  if (titlePageMatch) {
    titlePageMatch[1].split('\n').forEach(line => {
      const m = line.match(/^([A-Za-z][\w ]*?):\s*(.+)$/);
      if (!m) return;
      const key = m[1].toLowerCase();
      if (key === 'title') title = m[2].trim();
      if (key === 'credit' || key === 'author' || key === 'by') byline = m[2].trim();
    });
    body = raw.slice(titlePageMatch[0].length);
  }

  const rawLines = body.split('\n');
  const out = [];
  const charactersUsed = new Set();
  let sceneCount = 0;

  const isAllCaps = s => s.length > 0 && s === s.toUpperCase() && /[A-Z]/.test(s);

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i].trim();
    const next = (rawLines[i + 1] || '').trim();
    const prev = (rawLines[i - 1] || '').trim();

    if (!trimmed) { out.push({ type: 'blank', text: '' }); continue; }

    // forced scene heading — .BLACK VOID
    if (trimmed.startsWith('.') && !trimmed.startsWith('..')) {
      out.push({ type: 'scene', text: trimmed.slice(1).trim().toUpperCase() });
      sceneCount++;
      continue;
    }

    // centered — >THE END<
    if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
      out.push({ type: 'centered', text: trimmed.slice(1, -1).trim() });
      continue;
    }

    // forced transition — > TO BLACK.
    if (trimmed.startsWith('>')) {
      out.push({ type: 'transition', text: trimmed.slice(1).trim().toUpperCase() });
      continue;
    }

    // standard transition — ALL CAPS ending in TO:, last line of its block
    if (isAllCaps(trimmed) && /TO:$/.test(trimmed) && !next) {
      out.push({ type: 'transition', text: trimmed });
      continue;
    }

    if (SCENE_PREFIX.test(trimmed)) {
      out.push({ type: 'scene', text: trimmed.toUpperCase() });
      sceneCount++;
      continue;
    }

    // character cue — all caps, preceded by a blank line, followed by dialogue or a parenthetical
    if (isAllCaps(trimmed) && !prev && next) {
      charactersUsed.add(trimmed.replace(/\(.*\)$/, '').trim());
      out.push({ type: 'character', text: trimmed });
      continue;
    }

    // a blank line closes a dialogue block, so only an unbroken run continues one.
    // prev being non-empty means the previous line took a non-blank branch, so the block we're
    // continuing is always the last thing pushed — peek at it directly. Copying and reversing the
    // whole output per line made a feature-length script quadratic on every keystroke.
    const lastReal = prev ? out[out.length - 1] : null;

    if (trimmed.startsWith('(') && trimmed.endsWith(')') && lastReal &&
      (lastReal.type === 'character' || lastReal.type === 'dialogue')) {
      out.push({ type: 'parenthetical', text: trimmed });
      continue;
    }

    // dialogue — the prior line is a cue, a parenthetical, or more dialogue
    if (lastReal && (lastReal.type === 'character' || lastReal.type === 'parenthetical' || lastReal.type === 'dialogue')) {
      out.push({ type: 'dialogue', text: trimmed });
      continue;
    }

    out.push({ type: 'action', text: trimmed });
  }

  // industry estimate: ~55 lines per page, blank lines counting half
  const usedLines = out.filter(l => l.type !== 'blank').length +
    Math.ceil(out.filter(l => l.type === 'blank').length / 2);
  const pageEstimate = Math.max(1, Math.ceil(usedLines / 55));
  const words = out.reduce((a, l) => a + (l.text ? l.text.split(/\s+/).filter(Boolean).length : 0), 0);

  return {
    title, byline, lines: out, pageEstimate, sceneCount, words,
    charactersUsed: Array.from(charactersUsed).sort()
  };
}

const center = (s, w) => ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;

// plain-text render with real space indentation — what "Copy formatted" puts on the clipboard
function formattedText(script) {
  const W = COLS.width;
  const pad = n => ' '.repeat(n);
  const lines = [];
  if (script.title) {
    lines.push(center(script.title.toUpperCase(), W));
    if (script.byline) { lines.push('', center('written by', W), center(script.byline.toUpperCase(), W)); }
    lines.push('', '');
  }
  for (const l of script.lines) {
    if (l.type === 'blank') { lines.push(''); continue; }
    if (l.type === 'character') lines.push(pad(COLS.character) + l.text);
    else if (l.type === 'parenthetical') lines.push(pad(COLS.parenthetical) + l.text);
    else if (l.type === 'dialogue') lines.push(pad(COLS.dialogue) + l.text);
    else if (l.type === 'transition') lines.push(pad(Math.max(0, W - l.text.length)) + l.text);
    else if (l.type === 'centered') lines.push(center(l.text, W));
    else lines.push(l.text);
  }
  return lines.join('\n');
}

// scene headings + the action under them — the only parts a shot breakdown can use
function beatsFrom(script) {
  let cur = { head: '', body: [] };
  const blocks = [cur];
  for (const l of script.lines) {
    if (l.type === 'scene') { cur = { head: l.text, body: [] }; blocks.push(cur); }
    else if (l.type === 'action') cur.body.push(l.text);
  }
  return blocks
    .filter(b => b.head || b.body.length)
    .map(b => (b.head ? b.head + '\n' : '') + b.body.join(' '))
    .join('\n\n')
    .trim();
}

const PRINT_CSS = `
@page { size: 8.5in 11in; margin: 1in 1in 1in 1.5in; }
html, body { height: auto !important; overflow: visible !important; background: #FFFFFF !important; }
body * { visibility: hidden !important; box-shadow: none !important; }
#ffSpPaper, #ffSpPaper * { visibility: visible !important; }
#ffSpScroll { max-height: none !important; overflow: visible !important; border: 0 !important; padding: 0 !important; background: none !important; }
#ffSpPaper { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important;
  margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important;
  background: #FFFFFF !important; color: #000000 !important; font-size: 12pt !important; }
`;

const SAMPLE = `Title: The Cabin
Credit: Written by
Author: J. Doe

INT. CABIN - NIGHT

Wind rattles the windows. ANNA, 30s, journalist's notebook in hand, watches the door.

ANNA
You said it'd be over by midnight.

A KNOCK. Three slow taps.

MILES (O.S.)
It's me. Open up.

She doesn't move.

ANNA
(quiet)
Prove it.

EXT. CABIN PORCH - CONTINUOUS

MILES, soaked, holds up a key.

MILES
You gave me this in '99.

CUT TO:

INT. CABIN - LATER

The fire crackles. Two cups, untouched.

> THE END <
`;

export default class Screenplay extends React.Component {
  constructor(props) {
    super(props);
    this.state = { text: SAMPLE, sending: false };
  }
  parsed() {
    if (this._src !== this.state.text) { this._src = this.state.text; this._out = parseFountain(this.state.text); }
    return this._out;
  }
  slug() {
    const t = this.parsed().title || 'script';
    return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'script';
  }
  download() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([this.state.text], { type: 'text/plain' }));
    a.download = this.slug() + '.fountain';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 200);
    this.props.app.showToast(this.slug() + '.fountain downloaded', AMBER);
  }
  copyFormatted() {
    const text = formattedText(this.parsed());
    navigator.clipboard && navigator.clipboard.writeText(text).catch(() => { });
    this.props.app.showToast('Formatted screenplay copied — spaced for any plain-text editor', AMBER);
  }
  async sendToStory() {
    const { app } = this.props;
    const pid = app.state.proj;
    if (!pid || this.state.sending) return;
    const beats = beatsFrom(this.parsed());
    if (!beats) { app.showToast('No scene headings or action to send', 'var(--danger)'); return; }
    this.setState({ sending: true });
    try {
      const r = await api.story(pid);
      const base = (((r || {}).story || {}).content || '').trim();
      await api.saveStory(pid, (base ? base + '\n\n' : '') + beats);
      app.showToast('Scenes appended to ' + app.projDef(pid).name + ' story.md — break it into shots from the Story tab', 'var(--ok)');
      app.sync();
    } catch (e) {
      app.showToast('Could not write story — ' + (e.message || 'server unreachable'), 'var(--danger)');
    }
    this.setState({ sending: false });
  }

  render() {
    const S = this.state;
    const { app } = this.props;
    const p = this.parsed();
    const pid = app.state.proj;
    const eyebrow = (color = 'var(--fg-faint)') => ({ ...sx('font-weight:700;text-transform:uppercase'), fontFamily: MONO, fontSize: 10, letterSpacing: '.16em', color });

    const stat = (label, value, accent) => (
      <div key={label} style={sx('display:flex;flex-direction:column;gap:3px')}>
        <span style={eyebrow()}>{label}</span>
        <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: accent || 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
    );
    const btn = (label, onClick, opts) => {
      const o = opts || {};
      if (o.disabled) return (
        <div key={label} title={o.hint || ''} style={{ ...sx('padding:7px 14px;border:1px solid var(--line);border-radius:7px;color:var(--fg-faint);cursor:not-allowed'), fontFamily: MONO, fontSize: 10 }}>{label}</div>
      );
      if (o.primary) return (
        <div key={label} onClick={onClick} className="hBtnAccent" style={{ ...sx('padding:7px 16px;border-radius:7px;background:var(--accent);color:var(--on-accent);font-weight:700;cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>{label}</div>
      );
      return (
        <div key={label} onClick={onClick} className="hBd" style={{ ...sx('padding:7px 14px;border:1px solid var(--border-2);border-radius:7px;color:var(--fg-soft);cursor:pointer'), fontFamily: MONO, fontSize: 10 }}>{label}</div>
      );
    };

    const lineStyle = t => {
      if (t === 'scene') return sx('font-weight:700;text-transform:uppercase;margin:1.1em 0 .55em');
      if (t === 'action') return sx('margin-bottom:.55em');
      if (t === 'character') return { ...sx('text-transform:uppercase;margin-top:1.1em'), marginLeft: COLS.character + 'ch' };
      if (t === 'parenthetical') return { marginLeft: COLS.parenthetical + 'ch' };
      if (t === 'dialogue') return { marginLeft: COLS.dialogue + 'ch', maxWidth: COLS.dialogueWidth + 'ch' };
      if (t === 'transition') return sx('text-align:right;text-transform:uppercase;margin:1.1em 0 .55em');
      if (t === 'centered') return sx('text-align:center;margin:1.1em 0');
      return {};
    };

    return (
      <div style={sx('padding:22px 28px 90px')}>
        <style media="print" dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

        <div style={sx('display:flex;align-items:baseline;gap:12px;margin-bottom:4px')}>
          <div style={sx('font-weight:700;font-size:16px')}>Screenplay</div>
          <span style={sx('font-size:12px;color:var(--fg-faint)')}>Fountain in, industry-standard 12pt Courier out — parsed in the browser</span>
        </div>
        <div style={sx('font-size:11.5px;color:var(--fg-faint);margin-bottom:16px')}>Scene headings, character cues, parentheticals, dialogue and transitions are detected from plain text. Page count is the ~55-lines-per-page industry approximation.</div>

        {/* header strip — the numbers a writer actually watches */}
        <div style={sx('display:flex;align-items:center;gap:34px;flex-wrap:wrap;border:1px solid var(--line);border-radius:10px;background:var(--surface);padding:13px 18px;margin-bottom:16px')}>
          {stat('Pages', p.pageEstimate, 'var(--sand)')}
          {stat('Runtime', '≈ ' + p.pageEstimate + ' min')}
          {stat('Scenes', p.sceneCount)}
          {stat('Characters', p.charactersUsed.length)}
          {stat('Words', p.words)}
          <div style={sx('margin-left:auto;display:flex;gap:8px;flex-wrap:wrap')}>
            {btn('PRINT', () => window.print(), { primary: true })}
            {btn('DOWNLOAD .FOUNTAIN', () => this.download())}
            {btn('COPY FORMATTED', () => this.copyFormatted())}
            {pid
              ? btn(S.sending ? 'SENDING…' : '→ SEND TO STORY', () => this.sendToStory())
              : btn('→ SEND TO STORY', null, { disabled: true, hint: 'Open a project first — scene headings and action append to that project’s story.md' })}
          </div>
        </div>
        {!pid && (
          <div style={{ ...sx('margin:-8px 0 16px;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
            no project open — Send to Story appends scene headings + action to story.md once you open one.
          </div>
        )}

        <div style={sx('display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px;align-items:start')}>
          {/* fountain source */}
          <div>
            <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:8px')}>
              <span style={eyebrow('var(--fg-muted)')}>Fountain Source</span>
              <span onClick={() => this.setState({ text: SAMPLE })} className="hFgL" style={{ ...sx('margin-left:auto;cursor:pointer;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>RESET SAMPLE</span>
              <span onClick={() => this.setState({ text: '' })} className="hFgL" style={{ ...sx('cursor:pointer;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>CLEAR</span>
            </div>
            <textarea value={S.text} onChange={e => this.setState({ text: e.target.value })}
              onKeyDown={e => e.stopPropagation()} spellCheck={false}
              placeholder={'Title: Your Script\nAuthor: You\n\nINT. SOMEWHERE - DAY\n\nSomething happens.'}
              style={{ ...sx('width:100%;box-sizing:border-box;height:640px;resize:vertical;background:var(--sunk);border:1px solid var(--border);border-radius:10px;color:var(--fg);line-height:1.6;padding:14px 16px'), fontFamily: MONO, fontSize: 12 }} />
            <div style={{ ...sx('margin-top:8px;line-height:1.7;color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>
              INT. / EXT. → scene · ALL CAPS after a blank line → character · (beat) → parenthetical<br />
              ends in TO: → transition · &gt;text&lt; → centered · Title: / Author: at the top → title page
            </div>
          </div>

          {/* formatted page */}
          <div>
            <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:8px')}>
              <span style={eyebrow('var(--sand)')}>Formatted Preview</span>
              <span style={{ ...sx('color:var(--fg-faint)'), fontFamily: MONO, fontSize: 9.5 }}>8.5×11 · 12pt Courier · 1.5&quot; left margin</span>
            </div>
            <div id="ffSpScroll" style={sx('max-height:640px;overflow:auto;border-radius:10px;background:var(--sunk);padding:16px')}>
              <div id="ffSpPaper" style={{ ...sx('background:#FFFFFF;color:#000000;padding:44px 34px 44px 56px;border-radius:3px;box-shadow:0 18px 50px rgba(0,0,0,.55)'), fontFamily: COURIER, fontSize: 12, lineHeight: 1.32 }}>
                <div style={{ width: COLS.width + 'ch' }}>
                  {p.title && (
                    <div style={sx('text-align:center;margin-bottom:2.4em')}>
                      <div style={sx('text-transform:uppercase;font-weight:700;letter-spacing:.05em')}>{p.title}</div>
                      {p.byline && <>
                        <div style={sx('margin-top:1.1em')}>written by</div>
                        <div style={sx('text-transform:uppercase')}>{p.byline}</div>
                      </>}
                    </div>
                  )}
                  {p.lines.map((l, i) => l.type === 'blank'
                    ? <div key={i} style={{ height: '.55em' }} />
                    : <div key={i} style={lineStyle(l.type)}>{l.text}</div>)}
                  {!p.lines.some(l => l.type !== 'blank') && !p.title && (
                    <div style={{ ...sx('color:var(--fg-faint)'), fontFamily: COURIER }}>Empty script — type Fountain on the left.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
