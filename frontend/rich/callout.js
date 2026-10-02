// The callout: Obsidian's `> [!note] Title` block, kept as exactly that in the file so the
// markdown on disk still reads it. Kinds are Obsidian's common ones — note, tip, warning,
// info, example, quote — drawn as a box with the kind as its eyebrow; the body is ordinary
// blocks. Ported from OpsGraph's rich/callout.ts, re-prefixed.

import { mergeAttributes, Node } from '@tiptap/core';

const HEAD_RE = /^> \[!([a-zA-Z-]+)\][-+]?[ \t]*(.*)$/;
const START_RE = /(?:^|\n)> \[!/;

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: 'note',
        parseHTML: element => element.getAttribute('data-sc-callout') ?? 'note',
        renderHTML: attributes => ({ 'data-sc-callout': attributes.kind }),
      },
      title: {
        default: '',
        parseHTML: element => element.getAttribute('data-sc-title') ?? '',
        renderHTML: attributes =>
          typeof attributes.title === 'string' && attributes.title !== ''
            ? { 'data-sc-title': attributes.title }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-sc-callout]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = String(node.attrs.kind ?? 'note');
    const title = String(node.attrs.title ?? '');
    return [
      'div',
      mergeAttributes({ class: 'sc-callout' }, HTMLAttributes),
      [
        'div',
        { class: 'sc-callout-head', contenteditable: 'false' },
        ['span', { class: 'sc-callout-kind' }, kind],
        ...(title === '' ? [] : [['span', { class: 'sc-callout-title' }, title]]),
      ],
      ['div', { class: 'sc-callout-body' }, 0],
    ];
  },

  /* --- Markdown ------------------------------------------------------------------------ */

  markdownTokenName: 'callout',

  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: src => {
      const match = START_RE.exec(src);
      if (match === null) return -1;
      return match.index + (match[0].startsWith('\n') ? 1 : 0);
    },
    tokenize(src, _tokens, lexer) {
      const lines = src.split('\n');
      const first = lines[0] ?? '';
      const head = HEAD_RE.exec(first);
      if (head === null) return undefined;
      const body = [];
      let consumed = 1;
      for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line === '>' || line.startsWith('> ') || line.startsWith('>\t')) {
          body.push(line.replace(/^>[ \t]?/, ''));
          consumed += 1;
        } else break;
      }
      // The blank line after the block belongs to the block, so the next paragraph does not
      // start with one.
      let raw = lines.slice(0, consumed).join('\n');
      if (lines[consumed] === '') raw += '\n';
      const inner = body.join('\n');
      const blockTokens = lexer.blockTokens;
      const tokens = inner.trim() === '' || typeof blockTokens !== 'function'
        ? []
        : blockTokens.call(lexer, inner, []);
      return {
        type: 'callout',
        raw: `${raw}\n`,
        kind: (head[1] ?? 'note').toLowerCase(),
        title: (head[2] ?? '').trim(),
        tokens,
      };
    },
  },

  parseMarkdown(token, helpers) {
    const content = helpers.parseChildren(token.tokens ?? []);
    return helpers.createNode(
      'callout',
      { kind: token.kind, title: token.title },
      content.length === 0 ? [helpers.createNode('paragraph', {}, [])] : content,
    );
  },

  renderMarkdown(node, helpers) {
    const kind = String(node.attrs?.kind ?? 'note');
    const title = String(node.attrs?.title ?? '');
    const inner = helpers.renderChildren(node.content ?? [], '\n\n').trim();
    const head = `> [!${kind}]${title === '' ? '' : ` ${title}`}`;
    if (inner === '') return head;
    return `${head}\n${inner
      .split('\n')
      .map(line => (line === '' ? '>' : `> ${line}`))
      .join('\n')}`;
  },

  addCommands() {
    return {
      insertCallout:
        (kind, title) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: { kind, title },
              content: [{ type: 'paragraph' }],
            })
            .run(),
    };
  },
});
