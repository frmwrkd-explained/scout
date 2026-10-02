// The document editor — Tiptap over a Markdown body, one instance per open document.
// Ported from OpsGraph's features/editor/rich/RichEditor.tsx (the core editor, bubble menu,
// slash menu, drag handle); the OpsGraph-only pieces — wikilinks, embeds, structured rows,
// AI cards — did not come across, because Scout's document is the file itself.
//
// What was here before: CodeMirror 6 with live preview (MarkdownEditor.jsx). Tiptap is a
// ProseMirror document, so the note now edits AS the rendered thing — a checklist is boxes,
// a table is a table — while the file on disk stays Markdown that git, Obsidian and the
// agent read as before. `value` in is Markdown, `onChange` out is Markdown: the ProseMirror
// document never leaves this file. What it cannot represent is still one click away in the
// document header's Editor / Raw toggle.
//
// ── the two guards that keep a live editor honest ─────────────────────────────────────────
// `adopted` / `emitted` replace CodeMirror's `adopted` annotation: an external `value`
// change is set into the document with update emission off, so merely OPENING a record can
// no longer report a "keystroke" and rewrite `updated_by` (tests/phase-review-regressions
// D4 is the server half of the same guard). And a change is adopted only while the editor
// is not focused and the value is not the echo of what this editor just emitted — a save
// coming back must never move the caret or fight the typist.
//
// ── the round trip ────────────────────────────────────────────────────────────────────────
// Markdown → Tiptap → Markdown normalises: `*` bullets become `-`, wrapped paragraphs join,
// a stray `_` earns a backslash. That is what a WYSIWYG editor costs. It is idempotent and
// text-lossless — tests/rich-editor-roundtrip.test.mjs proves both over every workspace-demo
// body.
//
// PROPS — the exact contract MarkdownEditor kept, so Document.jsx changes by one import:
//   value          the markdown body. External changes are adopted per the rules above.
//   onChange(text) fired on every user edit. The caller owns debouncing; Document.jsx has one.
//   placeholder    shown on an empty document.
//   readOnly       no editing; the toolbar, bubble menu and drag handle go with it.
//   autoFocus      put the caret at the end of the body on mount.
//   minHeight      the editor grows with the content; this is the floor.
//   toolbar        show the formatting bar (old prop, kept).

import React from 'react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { richExtensions } from './rich/extensions.js';
import { tidyMarkdown } from './rich/markdown.js';
import { inspectRichMarkdown } from './rich/compatibility.js';
import { sx } from './sx';
import { MONO } from './tokens';
import './rich/rich.css';

export function readMarkdown(editor) {
  return tidyMarkdown(editor.getMarkdown());
}

export default function RichEditor({
  value = '', onChange, placeholder = 'Write…', readOnly = false, autoFocus = false,
  minHeight = 120, toolbar = true, style,
}) {
  const compatible = React.useMemo(() => inspectRichMarkdown(value).safe, [value]);
  const [usingSource, setUsingSource] = React.useState(() => !compatible);
  React.useEffect(() => { if (!compatible) setUsingSource(true); }, [compatible]);
  // Stay in source mode for this mount after a fallback. Fixing the last unsupported token
  // while typing must not replace the textarea and move the person's caret.
  if (usingSource || !compatible) {
    return (
      <div style={style}>
        <p style={{ ...sx('margin:0 0 10px;font-size:12px;line-height:1.6'), color: 'var(--fg-muted)' }}>
          Editing Markdown source to preserve this note's original formatting.
        </p>
        <MarkdownSourceEditor {...{ value, onChange, placeholder, readOnly, autoFocus, minHeight }} />
      </div>
    );
  }
  return <FormattedEditor {...{ value, onChange, placeholder, readOnly, autoFocus, minHeight, toolbar, style }} />;
}

// The same source editor serves the unsupported-body fallback and Document's Raw surface.
// It edits only the body; Document keeps its single save, provenance and conflict pipeline.
export function MarkdownSourceEditor({
  value = '', onChange, placeholder = 'Write…', readOnly = false, autoFocus = false, minHeight = 260,
}) {
  return (
    <textarea
      aria-label="Markdown note"
      data-testid="markdown-source"
      value={value}
      onChange={event => onChange?.(event.target.value)}
      {...{ placeholder, readOnly, autoFocus }}
      spellCheck={false}
      style={{
        ...sx('display:block;width:100%;box-sizing:border-box;resize:vertical;padding:12px;border:1px solid var(--border-2);border-radius:6px;font-size:12px;line-height:1.8'),
        minHeight, fontFamily: MONO, background: 'var(--surface-2)', color: 'var(--fg-soft)',
      }}
    />
  );
}

function FormattedEditor({
  value, onChange, placeholder, readOnly, autoFocus, minHeight, toolbar, style,
}) {
  // The callback lives in a ref so the editor, built once, always calls the latest one.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  /** The last Markdown this editor emitted, so its own echo is not re-adopted. */
  const emitted = React.useRef(null);
  /** The last `value` adopted into the document. */
  const adopted = React.useRef(value);
  const pendingValue = React.useRef(null);

  const editor = useEditor({
    extensions: richExtensions({ placeholder }),
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    autofocus: autoFocus ? 'end' : false,
    // Re-rendering the whole editor on every transaction is what makes a WYSIWYG lag; the
    // toolbar subscribes to the slice it needs through `useEditorState`.
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'sc-rich-content' },
    },
    onUpdate: ({ editor: live, transaction, appendedTransactions }) => {
      // docChanged — the same guard the CodeMirror listener had. `update` also fires for
      // transactions that moved nothing (a selection nudge, setEditable, a plugin refresh),
      // and reporting those as edits is how opening a record used to rewrite its file.
      const docChanged = transaction?.docChanged
        || (appendedTransactions ?? []).some(tr => tr.docChanged);
      if (!docChanged) return;
      const markdown = readMarkdown(live);
      pendingValue.current = null;
      emitted.current = markdown;
      onChangeRef.current?.(markdown);
    },
    onBlur: ({ editor: live }) => {
      if (pendingValue.current === null || live.isDestroyed) return;
      const next = pendingValue.current;
      pendingValue.current = null;
      live.commands.setContent(next, { contentType: 'markdown', emitUpdate: false });
      adopted.current = next;
    },
  }, []);

  // An external change: adopt it unless the person is typing or it is our own write returning.
  React.useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (value === adopted.current || value === emitted.current) {
      pendingValue.current = null;
      return;
    }
    if (editor.isFocused) {
      pendingValue.current = value;
      return;
    }
    editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    adopted.current = value;
    pendingValue.current = null;
  }, [editor, value]);

  React.useEffect(() => {
    if (!editor || editor.isDestroyed || editor.isEditable === !readOnly) return;
    // emitUpdate: false — setEditable's default is to fire `update`, which the onUpdate above
    // would report as an EDIT. Toggling read-only is not an edit; without this, merely opening
    // a document PATCHes a body that only differs by tidied whitespace (the D4 regression).
    editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  return (
    <div
      className="sc-rich"
      style={{
        '--sc-rich-min-height': `${minHeight}px`,
        ...sx('display:flex;flex-direction:column;gap:8px;min-width:0'),
        ...style,
      }}
    >
      {toolbar && !readOnly ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
      {editor && !readOnly ? (
        <>
          <DragHandle editor={editor} className="sc-drag-handle">
            <span aria-hidden="true">⠿</span>
          </DragHandle>
          <RichBubbleMenu editor={editor} />
        </>
      ) : null}
    </div>
  );
}

// ── the bubble menu ─────────────────────────────────────────────────────────────────────────
// Bold, italic, code, link and the heading levels over a selection. Glyph labels, like the
// toolbar — Scout ships no icon font.

function RichBubbleMenu({ editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: live }) => live === null ? null : ({
      bold: live.isActive('bold'),
      italic: live.isActive('italic'),
      code: live.isActive('code'),
      link: live.isActive('link'),
      h1: live.isActive('heading', { level: 1 }),
      h2: live.isActive('heading', { level: 2 }),
      h3: live.isActive('heading', { level: 3 }),
    }),
  });
  const link = () => {
    const current = editor.getAttributes('link').href;
    const href = window.prompt('Link to', current ?? 'https://');
    if (href === null) return;
    if (href.trim() === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().setLink({ href: href.trim() }).run();
  };
  const item = (key, label, title, run, pressed, mono) => (
    <button
      key={key}
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title || label}
      data-testid={`rich-bubble-${key}`}
      // The press keeps the selection to act on; the click (also Enter/Space) acts.
      onMouseDown={event => event.preventDefault()}
      onClick={run}
      className="sc-bubble-btn"
      style={mono ? { fontFamily: MONO, fontSize: '10px' } : undefined}
    >
      {label}
    </button>
  );
  return (
    <BubbleMenu
      editor={editor}
      data-testid="rich-bubble"
      className="sc-bubble glassPop"
      shouldShow={({ editor: live, from, to }) => from !== to && live.isEditable}
    >
      {item('bold', 'B', 'Bold  ⌘B', () => editor.chain().focus().toggleBold().run(), active?.bold)}
      {item('italic', 'I', 'Italic  ⌘I', () => editor.chain().focus().toggleItalic().run(), active?.italic)}
      {item('code', '<>', 'Inline code  ⌘E', () => editor.chain().focus().toggleCode().run(), active?.code, true)}
      {item('link', '↗', 'Link  ⌘K', link, active?.link)}
      <span className="sc-bubble-sep" aria-hidden="true" />
      {item('h1', 'H1', 'Heading 1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active?.h1, true)}
      {item('h2', 'H2', 'Heading 2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active?.h2, true)}
      {item('h3', 'H3', 'Heading 3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active?.h3, true)}
    </BubbleMenu>
  );
}

// ── the toolbar ─────────────────────────────────────────────────────────────────────────────
// The same compact glyph bar MarkdownEditor carried, extended with the blocks the slash menu
// also offers. `onMouseDown` + preventDefault keeps the caret: a click that took focus would
// lose the selection the command acts on.

const TOOLS = [
  { key: 'bold', label: 'B', title: 'Bold  ⌘B', run: e => e.chain().focus().toggleBold().run(), active: e => e.isActive('bold'), style: { fontWeight: 800 } },
  { key: 'italic', label: 'I', title: 'Italic  ⌘I', run: e => e.chain().focus().toggleItalic().run(), active: e => e.isActive('italic'), style: { fontStyle: 'italic' } },
  { key: 'code', label: '<>', title: 'Inline code  ⌘E', mono: true, run: e => e.chain().focus().toggleCode().run(), active: e => e.isActive('code') },
  { key: 'link', label: '↗', title: 'Link  ⌘K', run: e => {
      const href = window.prompt('Link to', e.getAttributes('link').href ?? 'https://');
      if (href === null) return;
      if (href.trim() === '') e.chain().focus().unsetLink().run();
      else e.chain().focus().setLink({ href: href.trim() }).run();
    }, active: e => e.isActive('link') },
  'sep',
  { key: 'h1', label: 'H1', title: 'Heading 1', mono: true, run: e => e.chain().focus().toggleHeading({ level: 1 }).run(), active: e => e.isActive('heading', { level: 1 }) },
  { key: 'h2', label: 'H2', title: 'Heading 2', mono: true, run: e => e.chain().focus().toggleHeading({ level: 2 }).run(), active: e => e.isActive('heading', { level: 2 }) },
  { key: 'bullet', label: '•', title: 'Bullet list', run: e => e.chain().focus().toggleBulletList().run(), active: e => e.isActive('bulletList') },
  { key: 'numbered', label: '1.', title: 'Numbered list', mono: true, run: e => e.chain().focus().toggleOrderedList().run(), active: e => e.isActive('orderedList') },
  { key: 'check', label: '☐', title: 'Checklist', run: e => e.chain().focus().toggleTaskList().run(), active: e => e.isActive('taskList') },
  { key: 'quote', label: '❝', title: 'Quote', run: e => e.chain().focus().toggleBlockquote().run(), active: e => e.isActive('blockquote') },
  'sep',
  { key: 'table', label: '▦', title: 'Table', run: e => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), active: e => e.isActive('table') },
  { key: 'callout', label: '▤', title: 'Callout — > [!note]', run: e => e.chain().focus().insertCallout('note', '').run(), active: e => e.isActive('callout') },
];

function Toolbar({ editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: live }) =>
      live === null ? [] : TOOLS.map(tool => tool === 'sep' ? false : (tool.active?.(live) ?? false)),
    equalityFn: (a, b) =>
      b !== null && a.length === b.length && a.every((value, i) => value === b[i]),
  });
  return (
    <div role="toolbar" aria-label="Formatting"
      style={sx('display:flex;align-items:center;gap:2px;flex-wrap:wrap')}>
      {TOOLS.map((tool, index) => {
        if (tool === 'sep') {
          return <span key={`sep-${index}`} aria-hidden="true"
            style={{ ...sx('display:inline-block;width:1px;height:14px;margin:0 5px'), background: 'var(--border-2)' }} />;
        }
        const pressed = active?.[index] ?? false;
        return (
          <button key={tool.key} type="button" title={tool.title}
            aria-label={tool.title} aria-pressed={tool.active ? pressed : undefined}
            data-testid={`rich-tool-${tool.key}`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => { if (editor) tool.run(editor); }}
            className="hBg"
            style={{
              ...sx('display:flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border-radius:5px;background:none;border:none;cursor:pointer;font-size:11px;transition:background 130ms ease'),
              ...(tool.mono ? { fontFamily: MONO, fontSize: '10px' } : null),
              ...(tool.style || null),
              color: pressed ? 'var(--fg)' : 'var(--fg-muted)',
              background: pressed ? 'var(--raise)' : 'none',
            }}>
            {tool.label}
          </button>
        );
      })}
      <span style={{ ...sx('margin-left:6px;font-size:10px;white-space:nowrap'), fontFamily: MONO, color: 'var(--fg-faint)' }}>
        / for blocks
      </span>
    </div>
  );
}
