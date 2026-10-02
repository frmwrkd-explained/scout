// The document editor's Markdown contract, proven headless.
//
// RichEditor keeps a ProseMirror document internally and hands the caller Markdown both ways.
// This test runs that exact pipeline without a DOM: `MarkdownManager.parse` (the same marked
// pass `contentType: 'markdown'` uses on the way in), the result checked against the real
// schema built by `getSchema` from `richExtensions()` — THE list, shared with the editor —
// then `serialize` (the same pass `editor.getMarkdown()` uses on the way out), with
// `tidyMarkdown` applied exactly as `readMarkdown` applies it before `onChange`.
//
// Two assertions per case:
//   · IDEMPOTENT — normalisation is allowed (`*` bullets become `-`, wrapped paragraphs join),
//     but it must settle: the second serialisation equals the first.
//   · LOSSLESS in text — the multiset of alphanumeric words going in equals the multiset
//     coming out of the first serialisation. Formatting may move; words may not vanish.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { richExtensions } from '../frontend/rich/extensions.js';
import { tidyMarkdown } from '../frontend/rich/markdown.js';
import { inspectRichMarkdown } from '../frontend/rich/compatibility.js';
import { loadJsx } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const extensions = richExtensions({ placeholder: '' });
const schema = getSchema(extensions);
const md = new MarkdownManager({
  extensions,
  indentation: { style: 'space', size: 2 },
});

// input → first serialisation, with the parse checked into a real document first — the same
// JSON the editor would hold after `setContent(markdown, { contentType: 'markdown' })`.
function serialise(input) {
  const doc = schema.nodeFromJSON(md.parse(input));
  doc.check(); // a parse the schema cannot hold is a fidelity bug, not a skip
  return tidyMarkdown(md.serialize(doc.toJSON()));
}

function words(text) {
  return (text.match(/[A-Za-z0-9]+/g) ?? []).map(w => w.toLowerCase()).sort();
}

function roundTrip(name, input) {
  test(`round trip · ${name}`, () => {
    const once = serialise(input);
    const twice = serialise(once);
    assert.equal(twice, once, 'second serialisation differs — normalisation is not stable');
    assert.deepEqual(words(once), words(input), 'words were lost or invented in the round trip');
  });
}

const CASES = {
  'headings': '# One\n\n## Two\n\n### Three\n\nBody.\n',
  'bold': 'Some **bold** words here.\n',
  'italic': 'Some *italic* words here.\n',
  'inline code': 'Run `npm test` first.\n',
  'bullet list': '- Alpha\n- Beta\n- Gamma\n',
  'ordered list': '1. First\n2. Second\n3. Third\n',
  'nested list': '- Outer\n  - Inner one\n  - Inner two\n- Outer again\n',
  'task list': '- [ ] Open item\n- [x] Done item\n',
  'table': '| Name | Role |\n| ---- | ---- |\n| Ada | Eng |\n| Grace | Ops |\n',
  'blockquote': '> A quoted line.\n> Second line.\n',
  'fenced code with language': '```js\nconst x = 1;\nconsole.log(x);\n```\n',
  'link': 'See [the docs](https://example.com/docs) for detail.\n',
  // writeMd keeps a leading `---` out of frontmatter; the editor must not eat it either.
  'horizontal rule first': '---\n\nAfter the rule.\n',
  'callout': '> [!note] Remember\n> The body of the callout.\n',
  'mixed body': [
    '# Brief',
    '',
    'Para with **bold**, *italic* and `code`.',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '1. step a',
    '2. step b',
    '',
    '- [ ] todo',
    '',
    '> quoted',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '---',
    '',
    '[link](https://example.com) tail.',
    '',
  ].join('\n'),
};

for (const [name, input] of Object.entries(CASES)) roundTrip(name, input);

for (const [name, input] of Object.entries(CASES)) {
  test(`formatted editing preserves Markdown meaning · ${name}`, () => {
    assert.equal(inspectRichMarkdown(input).safe, true);
  });
}

test('new empty notes open in the formatted editor', () => {
  assert.equal(inspectRichMarkdown('').safe, true);
  assert.equal(inspectRichMarkdown('\n\n').safe, true);
});

test('a code block retains literal blank lines and entity-looking text', () => {
  const input = '```js\nconst text = `first\n\n\nlast`;\n&nbsp;\n```';
  assert.equal(serialise(input), input);
  assert.equal(inspectRichMarkdown(input).safe, true);
});

test('tidying protects fences nested in quotes and lists, and longer closing delimiters', () => {
  for (const prefix of ['', '  ', '> ']) {
    const input = [
      `${prefix}\`\`\`\`js`, `${prefix}\`\`\``, `${prefix}first`, `${prefix}`, `${prefix}`, `${prefix}last`, `${prefix}&nbsp;`, `${prefix}\`\`\`\`\``,
    ].join('\n');
    assert.equal(tidyMarkdown(input), input);
  }
  assert.equal(tidyMarkdown('~~~text\nfirst\n\n\nlast\n~~~'), '~~~text\nfirst\n\n\nlast\n~~~');
});

const SOURCE_ONLY = {
  'inline image with a meaningful URL': 'Before ![Brand logo](https://example.com/logo.png) after.',
  'block image': 'Before\n\n![Brand logo](https://example.com/logo.png)\n\nAfter',
  'HTML disclosure': '<details><summary>More context</summary>Hidden answer</details>',
  'HTML drafting comment': 'Visible\n\n<!-- private drafting note -->\n\nEnd',
  'footnote': 'Claim[^1]\n\n[^1]: Supporting evidence.',
  'wikilink': 'Read [[Other note]] first.',
  'folded callout': '> [!note]- Closed note\n> Body',
};
for (const [name, input] of Object.entries(SOURCE_ONLY)) {
  test(`unsupported Markdown stays editable as exact source · ${name}`, () => {
    assert.equal(inspectRichMarkdown(input).safe, false);
  });
}

test('source-only syntax inside code remains safely editable in the formatted editor', () => {
  const input = '```md\n![logo](https://example.com/image.png)\n[^1]: Evidence\n[[Other note]]\n```';
  assert.equal(serialise(input), input);
  assert.equal(inspectRichMarkdown(input).safe, true);
});

test('opening unsupported Markdown renders its exact source without reporting an edit', async () => {
  const { default: React } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: RichEditor, MarkdownSourceEditor } = await loadJsx('frontend/RichEditor.jsx');
  const input = '![Logo](https://example.com/logo.png)\n\n<!-- drafting note -->\n\nCafé 👋';
  let changes = 0;
  const onChange = () => { changes += 1; };
  for (const component of [RichEditor, MarkdownSourceEditor]) {
    const markup = renderToStaticMarkup(React.createElement(component, { value: input, onChange }));
    assert.match(markup, /data-testid="markdown-source"/u);
    assert.match(markup, /!\[Logo\]\(https:\/\/example\.com\/logo\.png\)/u);
    assert.match(markup, /&lt;!-- drafting note --&gt;/u);
    assert.match(markup, /Café 👋/u);
    assert.equal(changes, 0, 'opening the source editor must not queue a save');
  }
});

// Every body the demo workspace ships — frontmatter stripped, exactly what the editor gets.
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // exFAT AppleDouble sidecars (`._x.md`) are not documents — skip them like the app does.
    if (entry.name.startsWith('._')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.md')) yield full;
  }
}

const demoDir = path.join(ROOT, 'workspace-demo');
const bodies = [...walk(demoDir)].map(file => ({
  file: path.relative(demoDir, file),
  body: matter(fs.readFileSync(file, 'utf8')).content,
}));
assert.ok(bodies.length > 20, `expected the demo corpus, found ${bodies.length} files`);

for (const { file, body } of bodies) roundTrip(`workspace-demo/${file}`, body);
