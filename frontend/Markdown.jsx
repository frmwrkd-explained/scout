// DEV-124 — a small markdown renderer for the story surface.
//
// NO DEPENDENCY, and no dangerouslySetInnerHTML: story text is user content (and can arrive from a
// transcription or an agent), so it is parsed into React nodes and never into raw HTML. That makes
// injection impossible by construction rather than by escaping carefully.
//
// SCOPE IS DELIBERATE. This covers what a filmmaker actually types into a treatment — headings,
// emphasis, lists, quotes, rules, inline code — and nothing else. It is not a CommonMark
// implementation and must not grow into one: if this file ever needs tables, footnotes or nested
// blockquotes, that is the signal to take a real renderer as a dependency, not to keep bolting on.
//
// The datastore is already markdown (projects/<pid>/story.md), so this renders the source format
// rather than introducing a second one.
import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';

// ── inline ── bold, italic, inline code, and @mentions left intact as plain text.
// Ordered longest-delimiter-first so ** is consumed before *.
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

function inline(text, keyBase) {
  const parts = String(text).split(INLINE);
  return parts.map((p, i) => {
    const k = keyBase + ':' + i;
    if (!p) return null;
    if ((p.startsWith('**') && p.endsWith('**')) || (p.startsWith('__') && p.endsWith('__')))
      return <strong key={k} style={{ color: 'var(--fg)', fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    if ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_')))
      return <em key={k}>{p.slice(1, -1)}</em>;
    if (p.startsWith('`') && p.endsWith('`'))
      return <code key={k} style={{ fontFamily: MONO, fontSize: '0.92em', background: 'var(--sunk)', borderRadius: 4, padding: '1px 5px' }}>{p.slice(1, -1)}</code>;
    return <span key={k}>{p}</span>;
  });
}

const H_SIZE = { 1: 17, 2: 14.5, 3: 12.5 };

// ── block ── line-oriented: the story format is paragraphs and lists, not nested structures.
export function Markdown({ text, style }) {
  const lines = String(text || '').split('\n');
  const out = [];
  let para = [];       // buffered plain lines → one <p>
  let list = null;     // { ordered, items: [] }

  const flushPara = () => {
    if (!para.length) return;
    const key = 'p' + out.length;
    out.push(<p key={key} style={sx('margin:0 0 9px;line-height:1.7')}>{inline(para.join(' '), key)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = 'l' + out.length;
    const Tag = list.ordered ? 'ol' : 'ul';
    out.push(
      <Tag key={key} style={sx('margin:0 0 9px;padding-left:20px;line-height:1.7')}>
        {list.items.map((it, i) => <li key={i} style={sx('margin:0 0 2px')}>{inline(it, key + ':' + i)}</li>)}
      </Tag>
    );
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { flush(); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flush();
      const lvl = h[1].length;
      const key = 'h' + out.length;
      out.push(
        <div key={key} style={{
          ...sx('margin:12px 0 6px;font-weight:700;line-height:1.35'),
          fontSize: H_SIZE[lvl], color: 'var(--fg)',
          ...(lvl === 1 ? sx('letter-spacing:-.01em') : null)
        }}>{inline(h[2], key)}</div>
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush();
      out.push(<div key={'hr' + out.length} style={sx('height:1px;background:var(--line);margin:12px 0')} />);
      continue;
    }

    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flush();
      const key = 'q' + out.length;
      out.push(
        <div key={key} style={sx('margin:0 0 9px;padding-left:11px;border-left:2px solid var(--border-3);color:var(--fg-muted);line-height:1.7')}>
          {inline(q[1], key)}
        </div>
      );
      continue;
    }

    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }

    flushList();
    para.push(line);
  }
  flush();

  return <div style={{ ...sx('color:var(--fg-soft)'), ...(style || {}) }}>{out}</div>;
}

// ── the formatting toolbar ──
// Operates on a real <textarea> through its selection, so the SOURCE stays the single
// representation — there is no rich-text model that could drift from the markdown on disk.
// `ref` is the textarea; `onChange` receives the whole next value.
export function MarkdownToolbar({ textareaRef, value, onChange }) {
  const apply = (fn) => {
    const el = textareaRef && textareaRef.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const before = value.slice(0, s), sel = value.slice(s, e), after = value.slice(e);
    const { text, caret } = fn({ before, sel, after });
    onChange(text);
    // restore the selection after React re-renders, or every click loses the user's place
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(caret[0], caret[1]); } catch { /* unmounted */ } });
  };
  // wrap the selection (or drop the markers with the caret between them when nothing is selected)
  const wrap = m => apply(({ before, sel, after }) => ({
    text: before + m + (sel || '') + m + after,
    caret: sel ? [before.length + m.length, before.length + m.length + sel.length]
      : [before.length + m.length, before.length + m.length]
  }));
  // line prefix — applied to every line the selection touches, and toggled off if already there
  const prefix = p => apply(({ before, sel, after }) => {
    const startOfLine = before.lastIndexOf('\n') + 1;
    const head = before.slice(0, startOfLine);
    const block = before.slice(startOfLine) + (sel || '');
    const lines = block.split('\n');
    const has = lines.every(l => l.startsWith(p));
    const next = lines.map(l => (has ? l.slice(p.length) : p + l)).join('\n');
    return { text: head + next + after, caret: [head.length, head.length + next.length] };
  });

  const btn = (label, title, onClick, mono) => (
    <span key={label} onClick={onClick} className="hBd" title={title}
      style={{
        ...sx('border-radius:5px;padding:2px 8px;cursor:pointer;border:1px solid var(--border-2)'),
        fontFamily: mono ? MONO : 'inherit', fontSize: 10, color: 'var(--fg-muted)'
      }}>{label}</span>
  );

  return (
    <div style={sx('display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px')}>
      {btn('H1', 'Big heading', () => prefix('# '), true)}
      {btn('H2', 'Heading', () => prefix('## '), true)}
      {btn('H3', 'Small heading', () => prefix('### '), true)}
      <span style={sx('width:1px;background:var(--border);margin:0 2px')} />
      {btn('B', 'Bold (**text**)', () => wrap('**'))}
      {btn('I', 'Italic (*text*)', () => wrap('*'))}
      <span style={sx('width:1px;background:var(--border);margin:0 2px')} />
      {btn('• List', 'Bullet list', () => prefix('- '))}
      {btn('1. List', 'Numbered list', () => prefix('1. '))}
      {btn('❝', 'Quote', () => prefix('> '))}
    </div>
  );
}

export default Markdown;
