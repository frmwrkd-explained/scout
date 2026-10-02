// The slash menu: `/` at the start of a line or after a space opens a list of blocks —
// heading, lists, checklist, quote, callout, table — and picking one replaces the `/query`
// with the block. Ported from OpsGraph's rich/slash.ts, minus the per-page `items` hook and
// the embed entries (Scout documents have no embed node to offer).

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { suggestionPopup } from './suggest-popup.js';

export const SLASH_SUGGESTION_KEY = new PluginKey('sc-slash-suggestion');

/** The blocks every document offers. */
function baseSlashItems() {
  return [
    {
      id: 'heading',
      label: 'Heading',
      detail: 'section',
      keywords: ['h2', 'h3', 'title'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run(),
    },
    {
      id: 'bullet',
      label: 'Bullet list',
      detail: 'list',
      keywords: ['ul', 'bullets'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      id: 'numbered',
      label: 'Numbered list',
      detail: 'list',
      keywords: ['ol', 'steps', 'ordered'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      id: 'checklist',
      label: 'Checklist',
      detail: 'boxes that write [x] back',
      keywords: ['task', 'check', 'todo'],
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: 'quote',
      label: 'Quote',
      detail: 'block',
      run: (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      id: 'callout',
      label: 'Callout',
      detail: 'note, tip, warning',
      keywords: ['note', 'tip', 'warning', 'admonition'],
      run: (editor, range) =>
        editor.chain().focus().deleteRange(range).insertCallout('note', '').run(),
    },
    {
      id: 'table',
      label: 'Table',
      detail: '3 × 3',
      run: (editor, range) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ].map(item => ({ ...item, group: 'Blocks' }));
}

function matches(item, query) {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return (
    item.label.toLowerCase().includes(needle) ||
    item.id.includes(needle) ||
    (item.keywords ?? []).some(word => word.includes(needle))
  );
}

export const SlashMenu = Extension.create({
  name: 'slashMenu',
  priority: 101,

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: SLASH_SUGGESTION_KEY,
        char: '/',
        allowSpaces: false,
        // Only at the start of a line or after a space: a URL's slash does not open it.
        allowedPrefixes: [' '],
        startOfLine: false,
        decorationClass: 'sc-suggest-query',
        items: ({ query }) => baseSlashItems().filter(item => matches(item, query)),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: suggestionPopup({
          testid: 'slash-suggest',
          empty: 'No block matches.',
          footer: true,
        }),
      }),
    ];
  },
});
