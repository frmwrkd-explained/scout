// The markdown editor — CodeMirror 6, live preview, one instance per open document.
//
// What was here before: a `<textarea>` behind an EDIT / DONE toggle, with a read-only
// `Markdown.jsx` render underneath. You could not see a heading while writing one, `**bold**`
// stayed four asterisks, Enter did not continue a list, there was no undo beyond the browser's,
// and no find. It was a text box, and the note is the most-written thing in this app.
//
// CodeMirror 6 is the same engine Obsidian's editor is built on, and the same one
// `geckse/tesseract-md-app` uses for its source mode (docs/06_REUSE.md; its package.json carries
// `@codemirror/lang-markdown`, `-state`, `-view`, `-commands`, `-search`, `-merge`). Adding it took
// Scout from three runtime dependencies to eleven — a real cost, taken deliberately, because the
// alternative is hand-building a text editor and every one of those is worse than this one.
//
// ── what "live preview" means here ────────────────────────────────────────────────────────────
// Obsidian's trick is not a preview pane. It is: the markup stays in the document, and it is
// HIDDEN on every line the cursor is not on. Put the caret in a heading and the `##` comes back so
// you can edit it; move away and the line is just a heading. That is `livePreview` below — a
// ViewPlugin that walks the syntax tree over the visible ranges and replaces the mark nodes with
// nothing, skipping any line the selection touches.
//
// Everything paints through Scout's tokens (`styles.css :root`), so light and dark are the same
// contract here as everywhere else and there is not a single hex in this file.
//
// PROPS
//   value          the markdown body. External changes are adopted only when they differ from
//                  what is on screen — a save round-trip must not move the caret.
//   onChange(text) fired on every edit. The caller owns debouncing; Document.jsx already has one.
//   placeholder    shown on an empty document.
//   readOnly       no editing. The toolbar goes with it.
//   autoFocus      put the caret in the body on mount.
//   minHeight      the editor grows with the content; this is the floor.

import React from 'react';
import { EditorState, Compartment, Annotation } from '@codemirror/state';
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, placeholder as cmPlaceholder, Decoration, ViewPlugin,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  syntaxHighlighting, HighlightStyle, syntaxTree, bracketMatching, indentOnInput,
} from '@codemirror/language';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t } from '@lezer/highlight';
import { sx } from './sx';
import { MONO } from './tokens';

// ── the paint ──────────────────────────────────────────────────────────────────────────────────
// Every colour is a token. `--accent` is the app's one accent and stays reserved for the primary
// action, so it is used here only for links, which ARE the actionable thing in a body.
const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.5em', fontWeight: '600', lineHeight: 1.3, color: 'var(--fg)' },
  { tag: t.heading2, fontSize: '1.28em', fontWeight: '600', lineHeight: 1.3, color: 'var(--fg)' },
  { tag: t.heading3, fontSize: '1.12em', fontWeight: '600', color: 'var(--fg)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '600', color: 'var(--fg-soft)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--fg)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--fg)' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--fg-faint)' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)' },
  { tag: t.monospace, fontFamily: MONO, fontSize: '.92em', color: 'var(--marked)' },
  { tag: t.quote, color: 'var(--fg-muted)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--fg-soft)' },
  { tag: t.contentSeparator, color: 'var(--fg-faint)' },
  // Fenced code, highlighted by whichever language-data grammar the fence names.
  { tag: t.keyword, color: 'var(--marked)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--fg-faint)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: 'var(--warn)' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: 'var(--fg)' },
  { tag: t.typeName, color: 'var(--marked)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

const theme = EditorView.theme({
  '&': { color: 'var(--fg-soft)', backgroundColor: 'transparent', fontSize: '13.5px' },
  '.cm-scroller': {
    fontFamily: 'inherit', lineHeight: '1.75',
    // The one-hand rule from docs/05_UI_SPEC.md: prose does not run the width of a 1440px window.
    padding: '2px 0',
  },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)', maxWidth: '74ch' },
  '.cm-line': { padding: '0 2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-12)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-05)' },
  '.cm-placeholder': { color: 'var(--fg-faint)', fontStyle: 'italic' },
  // The find panel. CM ships one; it needs to look like it belongs here.
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--fg-soft)', border: 'none' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    fontFamily: 'inherit', fontSize: '11.5px',
  },
  '.cm-panel.cm-search input': {
    backgroundColor: 'var(--ink)', color: 'var(--fg)', border: '1px solid var(--border-2)',
    borderRadius: '5px', padding: '3px 7px',
  },
  '.cm-panel.cm-search button': {
    backgroundColor: 'transparent', color: 'var(--fg-muted)', border: '1px solid var(--border)',
    borderRadius: '5px', padding: '3px 8px', cursor: 'pointer', backgroundImage: 'none',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-12)', outline: '1px solid var(--accent-35)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-35)' },
  // A markdown blockquote reads as a quote, not as a line of text starting with a bracket.
  '.cm-md-quote': { borderLeft: '2px solid var(--border-3)', paddingLeft: '10px', marginLeft: '-12px' },
  '.cm-md-hr': { borderBottom: '1px solid var(--line)', display: 'block' },
});

// ── live preview ───────────────────────────────────────────────────────────────────────────────
// The mark nodes lezer-markdown produces. Hiding these — and only these — is the whole effect:
// the text between them is untouched, so the document on disk never changes shape.
const MARKS = new Set([
  'HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'CodeMark', 'QuoteMark', 'LinkMark',
]);
const hidden = Decoration.replace({});
const quoteLine = Decoration.line({ class: 'cm-md-quote' });

function livePreview(view) {
  const deco = [];
  // Every line the selection touches keeps its markup, so a caret in a heading can still edit the
  // `##`. Obsidian's rule exactly, and the reason live preview does not fight you.
  const live = new Set();
  for (const r of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(r.from).number;
    const to = view.state.doc.lineAt(r.to).number;
    for (let n = from; n <= to; n++) live.add(n);
  }
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: node => {
        if (node.name === 'Blockquote') {
          const first = view.state.doc.lineAt(node.from);
          const last = view.state.doc.lineAt(node.to);
          for (let n = first.number; n <= last.number; n++) {
            deco.push(quoteLine.range(view.state.doc.line(n).from));
          }
          return;
        }
        // `[text](url)` — the brackets go with LinkMark, but the URL is a separate node and
        // hiding one without the other reads as `linkhttps://example.com`, which is worse than
        // showing the whole thing. A BARE url (an autolink, or a url in plain text) is content and
        // stays, so this is scoped to a URL whose parent is an inline Link.
        const isLinkUrl = node.name === 'URL' && node.node.parent && node.node.parent.name === 'Link';
        if (!MARKS.has(node.name) && !isLinkUrl) return;
        const line = view.state.doc.lineAt(node.from).number;
        if (live.has(line)) return;
        // A list bullet is content, not markup — hiding it would leave the item unmarked. A
        // blockquote's `>` is handled by the line decoration above, so its mark can go.
        if (node.name === 'QuoteMark' || node.from === node.to) return;
        deco.push(hidden.range(node.from, node.to));
      },
    });
  }
  // Decoration sets must arrive sorted; the tree walk gives block decorations out of order
  // relative to the inline ones.
  deco.sort((a, b) => a.from - b.from || a.startSide - b.startSide);
  return Decoration.set(deco, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = livePreview(view); }
  update(u) {
    if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = livePreview(u.view);
  }
}, { decorations: v => v.decorations });

// ── the formatting commands the toolbar and the shortcuts share ────────────────────────────────
// One implementation each. A toolbar button that does something subtly different from its
// keyboard shortcut is two implementations of one command (Law 10).
function wrapWith(mark) {
  return view => {
    const changes = [];
    const ranges = [];
    for (const r of view.state.selection.ranges) {
      const text = view.state.sliceDoc(r.from, r.to);
      const already = text.startsWith(mark) && text.endsWith(mark) && text.length >= mark.length * 2;
      const next = already ? text.slice(mark.length, -mark.length) : mark + text + mark;
      changes.push({ from: r.from, to: r.to, insert: next });
      const shift = already ? -mark.length : mark.length;
      ranges.push({ anchor: r.from + (r.empty ? mark.length : shift), head: r.from + next.length - (r.empty ? mark.length : 0) });
    }
    view.dispatch({ changes, selection: { anchor: ranges[0].anchor, head: ranges[0].head }, scrollIntoView: true });
    view.focus();
    return true;
  };
}

function prefixLines(prefix, { toggle = true } = {}) {
  return view => {
    const changes = [];
    for (const r of view.state.selection.ranges) {
      const first = view.state.doc.lineAt(r.from).number;
      const last = view.state.doc.lineAt(r.to).number;
      for (let n = first; n <= last; n++) {
        const line = view.state.doc.line(n);
        // Strip whichever heading/list/quote prefix is already there before applying the new one,
        // so `H2` on an `H1` line is a heading of two hashes and not three.
        const stripped = line.text.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s+|\d+\.\s+)/, '');
        const on = toggle && line.text.replace(/^\s+/, '').startsWith(prefix);
        changes.push({ from: line.from, to: line.to, insert: on ? stripped : prefix + stripped });
      }
    }
    view.dispatch({ changes, scrollIntoView: true });
    view.focus();
    return true;
  };
}

function insertLink(view) {
  const r = view.state.selection.main;
  const text = view.state.sliceDoc(r.from, r.to) || 'text';
  const insert = '[' + text + '](url)';
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    // Land the caret on `url`, which is the part you always have to type.
    selection: { anchor: r.from + text.length + 3, head: r.from + text.length + 6 },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

export const COMMANDS = {
  bold: { run: wrapWith('**'), key: 'Mod-b', label: 'B', title: 'Bold  ⌘B', style: sx('font-weight:800') },
  italic: { run: wrapWith('*'), key: 'Mod-i', label: 'I', title: 'Italic  ⌘I', style: sx('font-style:italic') },
  code: { run: wrapWith('`'), key: 'Mod-e', label: '<>', title: 'Inline code  ⌘E', mono: true },
  link: { run: insertLink, key: 'Mod-k', label: '↗', title: 'Link  ⌘K' },
  h1: { run: prefixLines('# '), key: 'Mod-Alt-1', label: 'H1', title: 'Heading 1', mono: true },
  h2: { run: prefixLines('## '), key: 'Mod-Alt-2', label: 'H2', title: 'Heading 2', mono: true },
  bullet: { run: prefixLines('- '), key: 'Mod-Shift-8', label: '•', title: 'Bullet list' },
  quote: { run: prefixLines('> '), key: 'Mod-Shift-9', label: '❝', title: 'Quote' },
};
const ORDER = ['bold', 'italic', 'code', 'link', 'h1', 'h2', 'bullet', 'quote'];

function Toolbar({ view }) {
  return (
    <div style={sx('display:flex;align-items:center;gap:2px;flex-wrap:wrap')}>
      {ORDER.map(id => {
        const c = COMMANDS[id];
        return (
          <button key={id} type="button" title={c.title}
            // mousedown, not click: click fires after the editor has already lost focus, and the
            // command then has no selection to act on.
            onMouseDown={e => { e.preventDefault(); if (view) c.run(view); }}
            className="hBg"
            style={{
              ...sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border-radius:5px;background:none;border:none;cursor:pointer;font-size:11px;transition:background 130ms ease'),
              ...(c.mono ? { fontFamily: MONO, fontSize: '10px' } : null),
              ...(c.style || null),
              color: 'var(--fg-muted)',
            }}>
            {c.label}
          </button>
        );
      })}
      <span style={{ ...sx('margin-left:6px;font-size:10px;white-space:nowrap'), fontFamily: MONO, color: 'var(--fg-faint)' }}>
        ⌘F find
      </span>
    </div>
  );
}

// ── the component ──────────────────────────────────────────────────────────────────────────────
const editable = new Compartment();

// Marks a transaction as "this text came FROM the caller", so the update listener can tell an
// adopted value apart from a keystroke. Without it, loading a document dispatched a change, the
// listener reported it as an edit, and the save path wrote the file back — so merely OPENING a
// record rewrote `updated_by` from the assistant that found it to the human who looked at it.
// The backend now refuses a no-change patch as well (records.mjs `patchRecord`); both halves are
// wanted, because one is "do not lie about an edit" and the other is "do not trust a caller".
const adopted = Annotation.define();

export default function MarkdownEditor({
  value = '', onChange, placeholder = 'Write…', readOnly = false, autoFocus = false,
  minHeight = 120, toolbar = true, style,
}) {
  const host = React.useRef(null);
  const viewRef = React.useRef(null);
  const onChangeRef = React.useRef(onChange);
  const [, forceToolbar] = React.useReducer(n => n + 1, 0);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightSpecialChars(),
        highlightSelectionMatches(),
        indentOnInput(),
        bracketMatching(),
        EditorView.lineWrapping,
        cmPlaceholder(placeholder),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        syntaxHighlighting(highlight),
        livePreviewPlugin,
        // Order matters: the markdown keymap owns Enter (it continues a list, and outdents out of
        // an empty one), so it has to sit ahead of the default binding for Enter.
        keymap.of([
          ...ORDER.map(id => ({ key: COMMANDS[id].key, run: COMMANDS[id].run, preventDefault: true })),
          ...markdownKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        editable.of(EditorView.editable.of(!readOnly)),
        EditorView.updateListener.of(u => {
          const external = u.transactions.some(tr => tr.annotation(adopted));
          if (u.docChanged && !external && onChangeRef.current) onChangeRef.current(u.state.doc.toString());
          if (u.focusChanged) forceToolbar();
        }),
        EditorView.theme({ '&': { minHeight: minHeight + 'px' } }),
        theme,
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    forceToolbar();
    if (autoFocus) view.focus();
    return () => { view.destroy(); viewRef.current = null; };
    // Built once per mount. `value` changes are adopted by the effect below rather than by
    // rebuilding the editor, which would drop the caret, the undo history and the scroll position
    // on every autosave round-trip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt an external change ONLY when it differs from what is on screen. The save path echoes the
  // body back on every write; comparing first is what stops that echo from moving the caret.
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value ?? '' },
      selection: { anchor: Math.min(view.state.selection.main.anchor, (value ?? '').length) },
      annotations: adopted.of(true),
    });
  }, [value]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (view) view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) });
  }, [readOnly]);

  return (
    <div style={{ ...sx('display:flex;flex-direction:column;gap:8px;min-width:0'), ...style }}>
      {toolbar && !readOnly ? <Toolbar view={viewRef.current} /> : null}
      <div ref={host} style={sx('min-width:0')} />
    </div>
  );
}
