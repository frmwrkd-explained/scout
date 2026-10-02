// The extension set of the document editor: what a body may contain, and how each piece goes
// to and from Markdown. Ported from OpsGraph's features/editor/rich/extensions.ts — minus the
// nodes that belong to that app (wikilink, embed, structured rows, AI cards). Everything here
// is Tiptap's MIT core plus one node of our own, Callout.
//
// This is THE list: the live editor (RichEditor.jsx) and the headless round-trip test
// (tests/rich-editor-roundtrip.test.mjs) build from it, so what the test proves is what the
// editor runs.

import { Placeholder } from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { Markdown } from '@tiptap/markdown';
import { StarterKit } from '@tiptap/starter-kit';
import { Callout } from './callout.js';
import { SlashMenu } from './slash.js';

export function richExtensions({ placeholder }) {
  return [
    StarterKit.configure({
      // A link places the caret, it does not navigate — following links is the reader's job,
      // not the editor's.
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    TaskList,
    // Stock, tickable task item — a `- [ ]` in a note is a box the writer ticks, and the tick
    // writes `x` back to the file like any other edit.
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Placeholder.configure({ placeholder }),
    Callout,
    SlashMenu,
    Markdown.configure({ indentation: { style: 'space', size: 2 } }),
  ];
}
