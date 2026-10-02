// Before giving a Markdown body to a structured editor, prove that its first save would
// retain the meaning of the original Markdown. Word counts miss lost URLs, moved words,
// code whitespace and formatting. Compare the lexer tokens before and after the actual
// schema/serializer instead. Unknown constructs stay in the source editor.

import { decodeHtmlEntities, getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { richExtensions } from './extensions.js';
import { tidyMarkdown } from './markdown.js';

let pipeline;
function richPipeline() {
  if (!pipeline) {
    const extensions = richExtensions({ placeholder: '' });
    pipeline = {
      schema: getSchema(extensions),
      markdown: new MarkdownManager({ extensions, indentation: { style: 'space', size: 2 } }),
    };
  }
  return pipeline;
}

function tokensMeaning(tokens) {
  const result = [];
  for (const token of tokens ?? []) {
    let meaning;
    switch (token.type) {
      case 'space': continue;
      case 'escape':
      case 'text':
        if (token.tokens) {
          meaning = { type: 'text-block', content: tokensMeaning(token.tokens) };
          break;
        }
        // Soft paragraph wraps are presentation; explicit hard breaks are separate tokens.
        meaning = { type: 'text', text: decodeHtmlEntities(token.text).replace(/\n/gu, ' ') };
        break;
      case 'code': meaning = { type: 'code', language: token.lang ?? '', text: token.text }; break;
      case 'codespan': meaning = { type: 'codespan', text: token.text }; break;
      case 'br':
      case 'hr': meaning = { type: token.type }; break;
      case 'heading': meaning = { type: 'heading', level: token.depth, content: tokensMeaning(token.tokens) }; break;
      case 'paragraph':
      case 'blockquote':
      case 'strong':
      case 'em':
      case 'del': meaning = { type: token.type, content: tokensMeaning(token.tokens) }; break;
      case 'link': meaning = { type: 'link', href: token.href, title: token.title ?? '', content: tokensMeaning(token.tokens) }; break;
      case 'list': meaning = { type: 'list', ordered: token.ordered, start: token.start, items: tokensMeaning(token.items) }; break;
      case 'list_item': meaning = { type: 'list_item', task: token.task, checked: token.checked ?? false, content: tokensMeaning(token.tokens) }; break;
      case 'taskList': meaning = { type: 'taskList', items: tokensMeaning(token.items) }; break;
      case 'taskItem': meaning = { type: 'taskItem', checked: token.checked, indent: token.indentLevel, content: tokensMeaning(token.tokens) }; break;
      case 'table': meaning = {
        type: 'table', align: token.align,
        header: token.header.map(cell => tokensMeaning(cell.tokens)),
        rows: token.rows.map(row => row.map(cell => tokensMeaning(cell.tokens))),
      }; break;
      case 'callout': meaning = {
        type: 'callout', kind: token.kind, title: token.title,
        folded: /^> \[![^\]]+\]([-+])/u.exec(token.raw)?.[1] ?? '',
        content: tokensMeaning(token.tokens),
      }; break;
      default: throw new Error(`Unsupported Markdown: ${token.type}`);
    }
    // Escaping punctuation often splits a text token into adjacent chunks. Their exact text
    // and order matter, the tokenizer's chunk boundaries do not.
    const previous = result.at(-1);
    if (meaning.type === 'text' && previous?.type === 'text') previous.text += meaning.text;
    else result.push(meaning);
  }
  return result;
}

function hasSourceOnlySyntax(tokens) {
  return (tokens ?? []).some(token => {
    if (token.type === 'code' || token.type === 'codespan') return false;
    // Marked treats footnotes and wikilinks as ordinary text; Tiptap then escapes away their
    // syntax. Keep those extensions intact even though this lexer does not render them.
    if (token.type === 'text' && /\[\^[^\]]+\]|!?\[\[[^\]]+\]\]/u.test(token.raw)) return true;
    return hasSourceOnlySyntax(token.tokens) || hasSourceOnlySyntax(token.items)
      || (token.header ?? []).some(cell => hasSourceOnlySyntax(cell.tokens))
      || (token.rows ?? []).some(row => row.some(cell => hasSourceOnlySyntax(cell.tokens)));
  });
}

export function inspectRichMarkdown(value) {
  // Tiptap fills an empty document with its initial paragraph. The schema's block+ check
  // must not force every newly created, blank note into the source fallback.
  if (value.trim() === '') return { safe: true };
  try {
    const { schema, markdown } = richPipeline();
    const original = markdown.instance.lexer(value);
    if (hasSourceOnlySyntax(original)) return { safe: false };
    const doc = schema.nodeFromJSON(markdown.parse(value));
    doc.check();
    const serialized = tidyMarkdown(markdown.serialize(doc.toJSON()));
    const restored = markdown.instance.lexer(serialized);
    return { safe: JSON.stringify(tokensMeaning(original)) === JSON.stringify(tokensMeaning(restored)) };
  } catch {
    return { safe: false };
  }
}
