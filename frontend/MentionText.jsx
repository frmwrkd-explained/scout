// MentionText — the composer's prompt field: a contenteditable that renders @entity references
// as INLINE thumbnail pills, exactly as the Director Chat handover draws them ("@refs render as
// thumbnail pills inline"). This replaces SnippetText inside Composer.jsx only — every other
// SnippetText call site (story editor, chat cards…) keeps the plain textarea.
//
// THE VALUE CONTRACT IS A PLAIN STRING. The pill is a rendering of the literal token `@key` in
// the prompt text; serializing the DOM back always yields the same string a textarea would have
// held. Nothing downstream changes: Story.shotMentions() parses @keys, /api/generate receives a
// string, and a project opened in an old build still reads.
//
// What SnippetText carried and this must preserve (the reason a naive contenteditable was
// rejected once already):
//   · "/" snippet search + insert (same matching rules, same menu)
//   · keydown stopPropagation so the app keymap never fires while typing
//   · a focus({toEnd}) instance handle
//   · Escape/Enter semantics stay the caller's (props.onKeyDown runs first; only an
//     unhandled plain Enter becomes a newline here, since contenteditable would insert a <div>)
//
// Sync model: the DOM is the source of truth while the user types. Serialized text is emitted
// through onChange and cached in this._text; componentDidUpdate rebuilds the DOM only when
// props.value differs from that cache (external writes: dictation append, ghost-prompt load,
// clear-after-send). Pillification of a hand-typed token happens as soon as the caret leaves it,
// via a rebuild that measures and restores the caret as a TEXT offset — never a node reference,
// which the rebuild would orphan.
import React from 'react';
import { commandGroups, splitToken, filterItems } from './slashCommands';   // DEV-126 — the / command tree
import { createPortal } from 'react-dom';
import { sx } from './sx';
import { MONO } from './tokens';

const TOKEN_RE = /@[\w\-.]+/g;

export default class MentionText extends React.Component {
  constructor(props) {
    super(props);
    // menu: null | { kind: 'entity'|'snippet', token, at, ix }  (at = text offset of the sigil)
    this.state = { menu: null };
    this.root = React.createRef();
    this._text = String(props.value || '');
  }

  entMap() {
    const m = new Map();
    for (const e of (this.props.entities || [])) if (e && e.key) m.set(String(e.key).toLowerCase(), e);
    return m;
  }

  // ── DOM ⇄ text ─────────────────────────────────────────────────────────────
  serialize() {
    const root = this.root.current;
    if (!root) return this._text;
    let out = '';
    const walk = node => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) out += n.nodeValue;
        else if (n.nodeType !== 1) continue;
        else if (n.dataset && n.dataset.mkey != null) out += '@' + n.dataset.mkey;
        else if (n.tagName === 'BR') out += '\n';
        else {
          // block child (browser-inserted DIV) opens a new line unless we're at the start
          if (out && !out.endsWith('\n')) out += '\n';
          walk(n);
        }
      }
    };
    walk(root);
    return out;
  }

  // length a node contributes to the serialized text — pills count as their whole token
  nodeLen(n) {
    if (n.nodeType === 3) return n.nodeValue.length;
    if (n.nodeType !== 1) return 0;
    if (n.dataset && n.dataset.mkey != null) return 1 + n.dataset.mkey.length;
    if (n.tagName === 'BR') return 1;
    let len = 0;
    for (const c of n.childNodes) len += this.nodeLen(c);
    return len;
  }

  caretOffset() {
    const root = this.root.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.anchorNode || !root.contains(sel.anchorNode)) return null;
    let off = 0;
    const anchor = sel.anchorNode, aOff = sel.anchorOffset;
    let done = false;
    const walk = node => {
      for (const n of node.childNodes) {
        if (done) return;
        if (n === anchor) {
          off += n.nodeType === 3 ? aOff : Array.from(n.childNodes).slice(0, aOff).reduce((a, c) => a + this.nodeLen(c), 0);
          done = true; return;
        }
        if (n.nodeType === 3) off += n.nodeValue.length;
        else if (n.nodeType === 1) {
          if (n.contains(anchor)) { walk(n); if (done) return; }
          else off += this.nodeLen(n);
        }
      }
    };
    if (anchor === root) {
      off = Array.from(root.childNodes).slice(0, aOff).reduce((a, c) => a + this.nodeLen(c), 0);
      done = true;
    } else walk(root);
    return done ? off : null;
  }

  setCaret(offset) {
    const root = this.root.current;
    if (!root) return;
    const sel = window.getSelection();
    const range = document.createRange();
    let remaining = Math.max(0, offset);
    let placed = false;
    const place = (node, off) => { range.setStart(node, off); range.collapse(true); placed = true; };
    const walk = node => {
      for (const n of node.childNodes) {
        if (placed) return;
        const len = this.nodeLen(n);
        if (n.nodeType === 3) {
          if (remaining <= n.nodeValue.length) { place(n, remaining); return; }
          remaining -= len;
        } else if (n.nodeType === 1 && n.dataset && n.dataset.mkey != null) {
          if (remaining < len) { // inside a pill → land after it
            const ix = Array.from(node.childNodes).indexOf(n);
            place(node, ix + 1); return;
          }
          remaining -= len;
        } else if (n.nodeType === 1 && n.tagName === 'BR') {
          if (remaining < 1) { const ix = Array.from(node.childNodes).indexOf(n); place(node, ix); return; }
          remaining -= 1;
        } else if (n.nodeType === 1) {
          if (remaining <= len) { walk(n); if (placed) return; }
          else remaining -= len;
        }
      }
    };
    walk(root);
    if (!placed) { range.selectNodeContents(root); range.collapse(false); }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  pillEl(ent) {
    const s = document.createElement('span');
    s.contentEditable = 'false';
    s.dataset.mkey = ent.key;
    s.style.cssText = 'display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border-2);background:rgba(28,31,38,.8);border-radius:999px;padding:1px 8px 1px 2px;vertical-align:-4px;margin:0 1px;user-select:none';
    const th = document.createElement('span');
    th.style.cssText = 'flex:none;width:15px;height:15px;border-radius:99px;background:' +
      (ent.thumb ? 'center/cover no-repeat url(' + JSON.stringify(ent.thumb) + ')' : 'var(--raise)');
    const lb = document.createElement('span');
    lb.style.cssText = 'font-family:' + MONO + ';font-size:10px;color:var(--fg)';
    lb.textContent = ent.label || ent.key;
    s.append(th, lb);
    return s;
  }

  // rebuild the DOM from `text`, pillifying every token that resolves against the entity pool
  renderDom(text) {
    const root = this.root.current;
    if (!root) return;
    const m = this.entMap();
    root.textContent = '';
    const frag = document.createDocumentFragment();
    for (const line of String(text).split('\n').map((l, i) => (i ? ['\n', l] : [l])).flat()) {
      if (line === '\n') { frag.append(document.createElement('br')); continue; }
      let last = 0;
      for (const match of line.matchAll(TOKEN_RE)) {
        const ent = m.get(match[0].slice(1).toLowerCase());
        if (!ent) continue;
        if (match.index > last) frag.append(document.createTextNode(line.slice(last, match.index)));
        frag.append(this.pillEl(ent));
        last = match.index + match[0].length;
      }
      if (last < line.length) frag.append(document.createTextNode(line.slice(last)));
    }
    root.append(frag);
    this._text = text;
  }

  componentDidMount() { this.renderDom(String(this.props.value || '')); }
  componentDidUpdate() {
    const v = String(this.props.value || '');
    if (v !== this._text) {
      // external write — rebuild, caret to the end if we hold focus (dictation appends)
      const focused = document.activeElement === this.root.current;
      this.renderDom(v);
      if (focused) this.setCaret(v.length);
    }
    if (this.state.menu && !this._track) this._track = setInterval(() => this.forceUpdate(), 150);
    if (!this.state.menu && this._track) { clearInterval(this._track); this._track = null; }
  }
  componentWillUnmount() { clearInterval(this._track); }

  focus(opts) {
    const el = this.root.current;
    if (!el) return;
    el.focus();
    if (opts && opts.toEnd) this.setCaret(this._text.length);
  }

  // Public handle: insert text at the caret (end of text when the field is not focused).
  // The asset-picker popup uses this to drop an '@key ' mention where the user was typing.
  insertAtCaret(text) {
    const el = this.root.current;
    if (!el) return;
    const at = document.activeElement === el ? this.caretOffset() : null;
    const pos = at != null ? at : this._text.length;
    // a mention glued to a word reads as part of it — pad with a space when needed
    const before = this._text.slice(0, pos);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    el.focus();
    this.splice(pos, pos, pad + text);
  }

  emit(text) {
    this._text = text;
    this.props.onChange && this.props.onChange({ target: { value: text } });
  }

  // splice `insert` over [from, to) in the text, rebuild, park the caret after the insertion
  splice(from, to, insert) {
    const t = this._text;
    const next = t.slice(0, from) + insert + t.slice(to);
    this.renderDom(next);
    this.setCaret(from + insert.length);
    this.emit(next);
    this.setState({ menu: null });
  }

  onInput = () => {
    const text = this.serialize();
    const caret = this.caretOffset();
    // a completed token the caret has left → pillify in place (rebuild + caret restore)
    if (caret != null) {
      const m = this.entMap();
      let needs = false;
      for (const match of text.matchAll(TOKEN_RE)) {
        const end = match.index + match[0].length;
        if (!m.has(match[0].slice(1).toLowerCase())) continue;
        if (caret >= match.index && caret <= end) continue;          // still editing it
        // is it already a pill? — a pill's token never appears as raw text in the DOM walk of
        // text nodes; cheap check: rebuild is idempotent, so only rebuild when a raw-text token
        // exists. Detect by scanning DOM text nodes for the sigil.
        needs = true; break;
      }
      if (needs && this.hasRawToken()) {
        this.renderDom(text);
        this.setCaret(caret);
      }
    }
    this.emit(text);
    this.updateMenu(text);
  };

  hasRawToken() {
    const root = this.root.current;
    if (!root) return false;
    const m = this.entMap();
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      for (const match of n.nodeValue.matchAll(TOKEN_RE)) if (m.has(match[0].slice(1).toLowerCase())) return true;
    }
    return false;
  }

  updateMenu(text) {
    const caret = this.caretOffset();
    if (caret == null) { if (this.state.menu) this.setState({ menu: null }); return; }
    const head = text.slice(0, caret);
    const ent = head.match(/(^|\s)@([\w\-.]*)$/);
    // DEV-126 — the slash token may now carry a group argument ("/model nano banana"), so it
    // runs to end-of-line rather than stopping at the first space. A bare "/" still opens the
    // top level; two spaces in a row end it, so ordinary prose after a command never re-opens
    // the menu.
    const snip = head.match(/(^|\s)\/([\w-]*(?: [\w\s-]*)?)$/);
    if (ent && ((this.props.entities || []).length || this.props.onBrowse)) {
      this.setState({ menu: { kind: 'entity', token: ent[2], at: caret - ent[2].length - 1, ix: 0 } });
    } else if (snip && ((this.props.snippets || []).length || this.cmdGroups().length)) {
      this.setState({ menu: { kind: 'snippet', token: snip[2], at: caret - snip[2].length - 1, ix: 0 } });
    } else if (this.state.menu) this.setState({ menu: null });
  }

  matches() {
    const M = this.state.menu;
    if (!M) return [];
    const t = M.token.toLowerCase();
    if (M.kind === 'entity') {
      // pool order (project first, named first — entities.js) is the tiebreak; a typed token
      // additionally lifts prefix matches over mid-string ones, so "@ma" leads with Maren.
      const starts = e => e.key.toLowerCase().startsWith(t) || String(e.label || '').toLowerCase().startsWith(t);
      return (this.props.entities || [])
        .filter(e => e.key.toLowerCase().startsWith(t) || String(e.label || '').toLowerCase().includes(t))
        .sort((a, b) => (t ? starts(b) - starts(a) : 0))
        .slice(0, 6);
    }
    // ── DEV-126 · two-level slash menu ──
    // Inside a group ("/model nano") only that group's items show. At the top level, snippets come
    // first — they are the behaviour that already existed and the one people have muscle memory
    // for — followed by the group rows, which are filtered by the same token so "/mo" narrows to
    // /model rather than listing everything.
    const groups = this.cmdGroups();
    const [gid, rest] = splitToken(M.token, groups);
    if (gid) {
      const g = groups.find(x => x.id === gid);
      return filterItems(g.items, rest, gid).map(it => ({ ...it, __cmd: g }));
    }
    const rows = groups
      .filter(g => !t || g.id.startsWith(t) || g.label.toLowerCase().includes(t))
      .map(g => ({ id: '__g:' + g.id, label: g.label, sub: g.hint, __group: g }));
    // Snippets keep the top of the list (they are the existing behaviour and the muscle memory),
    // but the group rows are RESERVED room rather than competing for it — with six snippets and a
    // flat 8-row cap the last two groups fell off the bottom, which hides the whole new capability
    // behind a scroll the menu does not have.
    const snips = (this.props.snippets || [])
      .filter(s => (s.trigger || '').toLowerCase().startsWith(t) || (s.name || '').toLowerCase().includes(t))
      .slice(0, Math.max(2, 10 - rows.length));
    return [...snips, ...rows];
  }

  // Built per render from props — the composer owns the state each command mutates, so the tree is
  // rebuilt whenever those props change rather than cached.
  cmdGroups() { return commandGroups(this.props.commands || {}); }

  // the heading names the level you are in, so "/model nano" does not still say QUICK SNIPPETS
  menuHead() {
    const M = this.state.menu;
    if (!M || M.kind === 'entity') return null;
    const [gid] = splitToken(M.token, this.cmdGroups());
    if (!gid) return this.cmdGroups().length ? 'SNIPPETS · COMMANDS' : 'QUICK SNIPPETS';
    const g = this.cmdGroups().find(x => x.id === gid);
    return g ? (g.label + ' — ' + g.hint).toUpperCase() : null;
  }

  pick(item) {
    const M = this.state.menu;
    if (!M) return;
    const to = M.at + 1 + M.token.length;
    if (M.kind === 'entity') { this.splice(M.at, to, '@' + item.key + ' '); }
    // a GROUP row descends one level: rewrite the token to "/<group> " and keep the menu open,
    // so the whole interaction stays on the keyboard
    else if (item.__group) { this.splice(M.at, to, '/' + item.__group.id + ' '); }
    // a COMMAND item mutates composer state and inserts NOTHING — these are prompt fragments
    // composed in at generate time, so injecting them as text would double them into the prompt
    else if (item.__cmd) {
      // The command text is removed either way, but HOW depends on what the command writes:
      //   · /look /camera /angle set state on the SURFACE (a different component), so the ordinary
      //     splice is safe and does the removal.
      //   · /model goes through the composer's own set(), which merges into a CAPTURED value
      //     object — so a splice followed by a model write made the second clobber the first and
      //     left "/model nano" sitting in the field. It therefore also receives the cleaned text
      //     and lands both in ONE write.
      const cleaned = this._text.slice(0, M.at) + this._text.slice(to);
      this.splice(M.at, to, '');
      item.__cmd.apply(item, cleaned);
      this.setState({ menu: null });
    }
    else this.splice(M.at, to, item.content || '');
    // splice re-rendered; keep focus in the field
    this.root.current && this.root.current.focus();
  }

  onKeyDown = e => {
    e.stopPropagation();
    // keyCode fallback: automation layers (CDP rawKeyDown) can deliver Enter with e.key === ''
    const enter = e.key === 'Enter' || e.keyCode === 13;
    const ms = this.matches();
    if (this.state.menu && ms.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.setState(s => ({ menu: { ...s.menu, ix: Math.min(ms.length - 1, s.menu.ix + 1) } })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.setState(s => ({ menu: { ...s.menu, ix: Math.max(0, s.menu.ix - 1) } })); return; }
      if (enter || e.key === 'Tab') { e.preventDefault(); this.pick(ms[this.state.menu.ix]); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.setState({ menu: null }); return; }
    }
    if (this.props.onKeyDown) this.props.onKeyDown(e);
    // an Enter nobody claimed becomes a literal newline — contenteditable's own <div> wrapping
    // would survive serialization but double-fires input events across browsers; do it by hand.
    if (enter && !e.defaultPrevented) {
      e.preventDefault();
      const at = this.caretOffset();
      if (at != null) this.splice(at, at, '\n');
    }
  };

  onPaste = e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!t) return;
    const at = this.caretOffset();
    const sel = window.getSelection();
    // collapse any selection to a caret-range splice: measure both ends as text offsets
    let from = at, to = at;
    if (sel && !sel.isCollapsed && at != null) {
      // serialize measures the anchor; extend by the selected string length
      to = at + sel.toString().length;
      // caretOffset() measured the ANCHOR — normalize so from <= to
      if (sel.anchorNode === sel.focusNode ? sel.anchorOffset > sel.focusOffset : sel.anchorNode.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_PRECEDING) {
        from = at - sel.toString().length; to = at;
      }
    }
    if (from == null) { from = to = this._text.length; }
    this.splice(Math.max(0, from), Math.max(0, to), t);
  };

  render() {
    const { placeholder, disabled, style, wrapStyle } = this.props;
    const ms = this.matches();
    const M = this.state.menu;
    const r = this.root.current ? this.root.current.getBoundingClientRect() : null;
    const empty = !this._text;
    return (
      <div style={{ ...sx('position:relative'), ...(wrapStyle || {}) }}>
        {empty && placeholder ? (
          <span style={{ ...sx('position:absolute;left:0;top:0;pointer-events:none'), fontFamily: MONO, fontSize: 11.5, lineHeight: 1.9, color: 'var(--fg-faint)' }}>{placeholder}</span>
        ) : null}
        <div
          ref={this.root}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox" aria-multiline="true" aria-label="Prompt"
          spellCheck={false}
          onInput={this.onInput}
          onKeyDown={this.onKeyDown}
          onPaste={this.onPaste}
          onKeyUp={() => this.updateMenu(this._text)}
          onMouseUp={() => this.updateMenu(this._text)}
          onBlur={() => setTimeout(() => this.setState({ menu: null }), 150)}
          style={{
            ...sx('width:100%;outline:none;white-space:pre-wrap;word-break:break-word;overflow-y:auto'),
            // the field GROWS with the prompt — a long prompt must be readable whole, not
            // scrolled through a 4-line slot (explicit user ask). The 40vh cap is only the
            // backstop that keeps a pasted essay from swallowing the screen; past it, scroll.
            minHeight: '2.4em', maxHeight: '40vh',
            fontFamily: MONO, fontSize: 11.5, lineHeight: 1.9,
            color: 'var(--fg)',
            ...(style || {}),
          }}
        />
        {/* PORTALLED to <body>: the composer's glass shell carries backdrop-filter, which makes
            it the containing block for position:fixed — rendered in place, this menu lands ~250px
            off target. Same escape the Composer Popover uses; see its header comment. */}
        {M && (ms.length > 0 || (M.kind === 'entity' && this.props.onBrowse)) && r && createPortal(
          <div style={{
            ...sx('position:fixed;z-index:90;border-radius:10px;background:var(--surface-2);border:1px solid var(--border-3);box-shadow:0 16px 48px rgba(0,0,0,.7);overflow-y:auto'),
            left: r.left, width: Math.max(r.width, 320),
            // the composer is usually docked at the bottom of its surface — when there's no room
            // below the field, the menu opens UPWARD off its top edge (same rule as the popovers)
            ...(window.innerHeight - r.bottom > 320 || r.top < 320
              ? { top: r.bottom + 4, maxHeight: window.innerHeight - r.bottom - 16 }
              : { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 16 }),
          }}>
            <div style={sx('font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--fg-faint);padding:7px 12px 4px')}>
              {M.kind === 'entity' ? 'CAST · LOCATIONS · PROPS' : (this.menuHead() || 'QUICK SNIPPETS')}
            </div>
            {ms.map((item, i) => (
              <div key={(item.key || item.id || item.file || '') + i}
                onMouseDown={e => { e.preventDefault(); this.pick(item); }}
                onMouseEnter={() => this.setState(s => ({ menu: { ...s.menu, ix: i } }))}
                style={{
                  ...sx('display:flex;align-items:center;gap:10px;padding:7px 12px;cursor:pointer'),
                  background: i === M.ix ? 'var(--accent-05)' : 'transparent'
                }}>
                {M.kind === 'entity' ? (
                  // the LABEL is the identity — "@deckhand", never the raw filename key. The key
                  // still rides in the title for anyone who needs the stable id.
                  <>
                    <span style={{ ...sx('flex:none'), width: 20, height: 20, borderRadius: item.kind === 'talent' ? 99 : 5, background: item.thumb ? 'center/cover no-repeat url(' + JSON.stringify(item.thumb) + ')' : 'var(--raise)', border: '1px solid var(--border-2)' }} />
                    <span title={'@' + item.key} style={{ ...sx('white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), fontFamily: MONO, fontSize: 10.5, color: i === M.ix ? 'var(--accent)' : 'var(--fg)' }}>@{item.label}</span>
                    {item.kind ? <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 8.5, color: 'var(--fg-faint)', letterSpacing: '.1em', textTransform: 'uppercase' }}>{item.kind}</span> : null}
                  </>
                ) : (
                  /* DEV-126 — three row shapes share this list: a snippet (inserts text), a GROUP
                     row (descends a level, marked with a trailing ›), and a COMMAND item (applies
                     to composer state). They are visually distinct so it is never ambiguous which
                     one Enter is about to do. */
                  item.__group ? (
                    <>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: i === M.ix ? 'var(--accent)' : 'var(--fg-muted)', flex: 'none' }}>{item.label}</span>
                      <span style={sx('font-size:11px;color:var(--fg-faint)')}>{item.sub}</span>
                      <span style={{ ...sx('margin-left:auto'), fontFamily: MONO, fontSize: 11, color: 'var(--fg-faint)' }}>›</span>
                    </>
                  ) : item.__cmd ? (
                    <>
                      {item.thumb
                        ? <span style={{ ...sx('flex:none'), width: 26, height: 18, borderRadius: 4, background: 'center/cover no-repeat url(' + JSON.stringify(item.thumb) + ')', border: '1px solid var(--border-2)' }} />
                        : null}
                      <span style={sx('font-size:11.5px;color:var(--fg);flex:none')}>{item.label}</span>
                      <span style={sx('font-size:10.5px;color:var(--fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{String(item.sub || '').slice(0, 70)}</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontFamily: MONO, fontSize: 10.5, color: i === M.ix ? 'var(--accent)' : 'var(--fg-muted)', flex: 'none' }}>/{item.trigger}</span>
                      <span style={sx('font-size:11.5px;color:var(--fg);flex:none')}>{item.name}</span>
                      <span style={sx('font-size:10.5px;color:var(--fg-faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{(item.content || '').slice(0, 60)}</span>
                    </>
                  )
                )}
              </div>
            ))}
            {M.kind === 'entity' && this.props.onBrowse ? (
              <div
                onMouseDown={e => { e.preventDefault(); this.setState({ menu: null }); this.props.onBrowse(); }}
                style={sx('display:flex;align-items:center;gap:8px;padding:7px 12px;cursor:pointer;border-top:1px solid var(--line)')}
              >
                <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--accent)' }}>＋ Add more — project assets &amp; library →</span>
              </div>
            ) : null}
          </div>,
          document.body
        )}
      </div>
    );
  }
}
