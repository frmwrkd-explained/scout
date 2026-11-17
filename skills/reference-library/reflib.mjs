#!/usr/bin/env node
// reflib — read a Scout reference library straight from disk.
//
// Zero dependencies, Node 18+. It reads `<workspace>/data/references/*.md` and resolves the image
// each record points at under `<workspace>/files/`. Scout does not have to be running and no
// Airtable account is involved. IT NEVER WRITES: there is no command here that creates, edits or
// deletes anything.
//
//   node reflib.mjs find    [--category X] [--tag X]... [--text "words"] [--has-prompt] [--limit N] [--json]
//   node reflib.mjs show    <id> [--prompt | --json]
//   node reflib.mjs compose <id> --subject "..." [--fill "NAME=value"]... [--prompt-only | --json]
//   node reflib.mjs stats   [--json]
//
// Workspace: --workspace <dir>, else $SCOUT_WORKSPACE, else the nearest parent folder of the
// current directory that contains data/references.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── frontmatter ────────────────────────────────────────────────────────────────────────────────
// Scout writes records with gray-matter, which dumps YAML through js-yaml. A prompt is usually a
// folded block scalar (`>-`), so "word for word" depends on undoing that folding exactly. The
// block-scalar reader below follows js-yaml's own loader step for step; everything else is the
// small subset js-yaml emits for a flat record, plus enough tolerance for a hand-edited file.

// Split a file the way gray-matter does: the block between a leading `---` and the first
// following line that starts with `---`.
export function splitDocument(source) {
  let str = String(source);
  if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1);
  if (!str.startsWith('---') || str.charAt(3) === '-') return { matter: null, body: str };
  str = str.slice(3);
  const firstBreak = str.indexOf('\n');
  str = firstBreak < 0 ? '' : str.slice(firstBreak);   // drop a language tag on the opening line
  const close = str.indexOf('\n---');
  if (close < 0) return { matter: str, body: '' };
  let body = str.slice(close + 4);
  if (body[0] === '\r') body = body.slice(1);
  if (body[0] === '\n') body = body.slice(1);
  return { matter: str.slice(0, close), body };
}

export function parseDocument(source) {
  const { matter, body } = splitDocument(source);
  return { data: matter === null ? {} : parseFrontmatter(matter), body };
}

export function parseFrontmatter(matter) {
  const lines = String(matter).replace(/\r\n?/g, '\n').split('\n');
  const start = nextContent(lines, 0);
  if (start >= lines.length) return {};
  const [value] = parseNode(lines, start, indentOf(lines[start]));
  return value && typeof value === 'object' ? value : {};
}

const indentOf = line => line.length - line.replace(/^ +/, '').length;
const isBlank = line => line.trim() === '' || line.trim().startsWith('#');
function nextContent(lines, i) { while (i < lines.length && isBlank(lines[i])) i++; return i; }

const isDash = text => text === '-' || text.startsWith('- ');

function parseNode(lines, i, indent) {
  const text = lines[i].slice(indent);
  return isDash(text) ? parseSequence(lines, i, indent) : parseMapping(lines, i, indent);
}

// `key: rest` → [key, rest]. A quoted key is unquoted; a plain key ends at the first colon that is
// followed by a space or the end of the line.
function splitKey(text) {
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = closingQuote(text, quote);
    if (end < 0) return null;
    const after = text.slice(end + 1);
    if (!/^\s*:(\s|$)/.test(after)) return null;
    const key = quote === '"' ? unescapeDouble(text.slice(1, end)) : text.slice(1, end).replace(/''/g, "'");
    return [key, after.replace(/^\s*:/, '').trim()];
  }
  for (let k = 0; k < text.length; k++) {
    if (text[k] === '#' && k > 0 && /\s/.test(text[k - 1])) return null;
    if (text[k] === ':' && (k + 1 === text.length || /\s/.test(text[k + 1]))) {
      return [text.slice(0, k).trimEnd(), text.slice(k + 1).trim()];
    }
  }
  return null;
}

function parseMapping(lines, i, indent) {
  const out = {};
  while (i < lines.length) {
    i = nextContent(lines, i);
    if (i >= lines.length || indentOf(lines[i]) !== indent) break;
    const pair = splitKey(lines[i].slice(indent));
    if (!pair) break;
    const [key, rest] = pair;
    [out[key], i] = parseValue(lines, i, indent, rest, true);
  }
  return [out, i];
}

function parseSequence(lines, i, indent) {
  const out = [];
  while (i < lines.length) {
    i = nextContent(lines, i);
    if (i >= lines.length || indentOf(lines[i]) !== indent) break;
    const text = lines[i].slice(indent);
    if (!isDash(text)) break;
    const rest = text.slice(1).trim();
    const column = indent + (text.length - text.slice(1).trimStart().length);
    // `- key: value` is a mapping whose first key sits where the dash's content starts.
    if (rest && !/^[|>'"\[{]/.test(rest) && splitKey(rest)) {
      const patched = lines.slice();
      patched[i] = ' '.repeat(column) + rest;
      let value;
      [value, i] = parseMapping(patched, i, column);
      out.push(value);
      continue;
    }
    let value;
    [value, i] = parseValue(lines, i, indent, rest, false);
    out.push(value);
  }
  return [out, i];
}

// The value that starts on line `i` after a key or a dash. → [value, index of the next line]
function parseValue(lines, i, indent, rest, inMapping) {
  if (rest === '' || rest.startsWith('#')) {
    const next = nextContent(lines, i + 1);
    if (next < lines.length) {
      const deeper = indentOf(lines[next]);
      if (deeper > indent) return parseNode(lines, next, deeper);
      // A sequence may sit at the same indent as the key that owns it.
      if (inMapping && deeper === indent && isDash(lines[next].slice(indent))) return parseSequence(lines, next, indent);
    }
    return [null, i + 1];
  }
  if (/^[|>]/.test(rest)) return readBlockScalar(lines, i, indent, rest);
  if (rest[0] === '"' || rest[0] === "'") return readQuoted(lines, i, rest);
  if (rest[0] === '[' || rest[0] === '{') return readFlow(lines, i, indent, rest);
  return readPlain(lines, i, indent, rest);
}

// ── block scalars: `|` and `>` ─────────────────────────────────────────────────────────────────
// A port of js-yaml's readBlockScalar. `containerIndent` is the indent of the key or dash that
// owns the scalar; content must be indented at least one space past it.
function readBlockScalar(lines, i, containerIndent, header) {
  const m = /^([|>])([-+]?[1-9]?|[1-9][-+]?)\s*(#.*)?$/.exec(header);
  if (!m) return readPlain(lines, i, containerIndent, header);
  const folding = m[1] === '>';
  const chomp = (/[-+]/.exec(m[2]) || [''])[0];
  const digit = (/[1-9]/.exec(m[2]) || [null])[0];
  let textIndent = digit ? containerIndent + Number(digit) : containerIndent + 1;
  let detected = !!digit;

  let result = '', emptyLines = 0, didRead = false, atMoreIndented = false;
  let at = i + 1;
  for (; at < lines.length; at++) {
    const line = lines[at];
    let lineIndent = 0;
    while ((!detected || lineIndent < textIndent) && line[lineIndent] === ' ') lineIndent++;
    if (!detected && lineIndent > textIndent) textIndent = lineIndent;
    if (lineIndent === line.length) { emptyLines++; continue; }
    if (lineIndent < textIndent) break;

    const first = line[lineIndent];
    if (folding) {
      if (first === ' ' || first === '\t') {
        // More-indented lines are not folded, nor are the breaks around them.
        atMoreIndented = true;
        result += '\n'.repeat(didRead ? 1 + emptyLines : emptyLines);
      } else if (atMoreIndented) {
        atMoreIndented = false;
        result += '\n'.repeat(emptyLines + 1);
      } else if (emptyLines === 0) {
        if (didRead) result += ' ';
      } else {
        result += '\n'.repeat(emptyLines);
      }
    } else {
      result += '\n'.repeat(didRead ? 1 + emptyLines : emptyLines);
    }
    didRead = true; detected = true; emptyLines = 0;
    result += line.slice(lineIndent);
  }
  if (chomp === '+') result += '\n'.repeat(didRead ? 1 + emptyLines : emptyLines);
  else if (chomp === '' && didRead) result += '\n';
  return [result, at];
}

// ── quoted scalars ─────────────────────────────────────────────────────────────────────────────

// Index of the quote that closes the one at position 0, or -1 when it is on a later line.
function closingQuote(text, quote) {
  for (let k = 1; k < text.length; k++) {
    if (quote === '"' && text[k] === '\\') { k++; continue; }
    if (text[k] !== quote) continue;
    if (quote === "'" && text[k + 1] === "'") { k++; continue; }
    return k;
  }
  return -1;
}

const SIMPLE_ESCAPES = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1B',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xA0', L: ' ', P: ' ',
};
const HEX_LENGTH = { x: 2, u: 4, U: 8 };

function unescapeDouble(raw) {
  let out = '';
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] !== '\\') { out += raw[k]; continue; }
    const c = raw[++k];
    if (HEX_LENGTH[c]) {
      out += String.fromCodePoint(parseInt(raw.slice(k + 1, k + 1 + HEX_LENGTH[c]), 16));
      k += HEX_LENGTH[c];
    } else {
      out += c in SIMPLE_ESCAPES ? SIMPLE_ESCAPES[c] : '\\' + (c ?? '');
    }
  }
  return out;
}

// js-yaml writes a quoted scalar on one line. A hand-edited one may wrap: then a line break folds
// to a space, an empty line is a newline, and (double quotes only) a trailing `\` joins lines.
function readQuoted(lines, i, rest) {
  const quote = rest[0];
  const decode = raw => (quote === '"' ? unescapeDouble(raw) : raw.replace(/''/g, "'"));
  let end = closingQuote(rest, quote);
  if (end >= 0) return [decode(rest.slice(1, end)), i + 1];

  let raw = rest.slice(1), at = i + 1, pendingBreaks = 0, joined = false;
  const pushLine = segment => {
    if (joined) joined = false;
    else if (pendingBreaks === 1) raw += ' ';
    else if (pendingBreaks > 1) raw += '\n'.repeat(pendingBreaks - 1);
    pendingBreaks = 0;
    raw += segment;
  };
  const endLine = () => {
    if (quote === '"' && /(^|[^\\])(\\\\)*\\$/.test(raw)) { raw = raw.slice(0, -1); joined = true; return; }
    raw = raw.replace(/[ \t]+$/, '');
    pendingBreaks++;
  };
  endLine();
  for (; at < lines.length; at++) {
    const piece = lines[at].trim();
    if (piece === '') { if (!joined) pendingBreaks++; continue; }
    end = closingQuote(quote + piece, quote);
    if (end >= 0) { pushLine(piece.slice(0, end - 1)); return [decode(raw), at + 1]; }
    pushLine(piece);
    endLine();
  }
  return [decode(raw), at];
}

// ── plain and flow scalars ─────────────────────────────────────────────────────────────────────

const stripComment = text => text.replace(/\s+#.*$/, '').trim();

// Typed the way js-yaml types an unquoted value. Dates stay strings: a record's `created` is
// compared and printed as text here, never as a Date.
function resolvePlain(text) {
  if (text === '' || text === '~' || /^(null|Null|NULL)$/.test(text)) return null;
  if (/^(true|True|TRUE)$/.test(text)) return true;
  if (/^(false|False|FALSE)$/.test(text)) return false;
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(text)) return Number(text);
  if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)) return Number(text);
  if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text[0] === '-' ? -Infinity : Infinity;
  if (/^\.(nan|NaN|NAN)$/.test(text)) return NaN;
  return text;
}

function readPlain(lines, i, indent, rest) {
  const first = stripComment(rest);
  let at = i + 1, breaks = 0, text = first, multiline = false;
  // Continuation lines of a plain scalar are indented past its key.
  for (; at < lines.length; at++) {
    const line = lines[at];
    if (line.trim() === '') { breaks++; continue; }
    if (indentOf(line) <= indent) break;
    text += breaks ? '\n'.repeat(breaks) : ' ';
    text += stripComment(line);
    breaks = 0; multiline = true;
  }
  return [multiline ? text : resolvePlain(first), multiline ? at : i + 1];
}

// `[a, b]` and `{a: 1}` — the empty forms are all js-yaml emits; simple one-level ones are read too.
function readFlow(lines, i, indent, rest) {
  let text = stripComment(rest), at = i + 1;
  const close = text[0] === '[' ? ']' : '}';
  while (!text.endsWith(close) && at < lines.length && indentOf(lines[at]) > indent) text += ' ' + lines[at++].trim();
  const inner = text.slice(1, text.endsWith(close) ? -1 : undefined).trim();
  const parts = inner === '' ? [] : splitFlow(inner);
  const scalar = part => {
    const t = part.trim();
    if (t[0] === '"' || t[0] === "'") return readQuoted([t], 0, t)[0];
    return resolvePlain(t);
  };
  if (close === ']') return [parts.map(scalar), at];
  const out = {};
  for (const part of parts) {
    const pair = splitKey(part.trim()) || [part.trim(), ''];
    out[pair[0]] = scalar(pair[1]);
  }
  return [out, at];
}

function splitFlow(inner) {
  const parts = [];
  let current = '', quote = null;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (quote) {
      current += c;
      if (quote === '"' && c === '\\') current += inner[++k] ?? '';
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") { quote = c; current += c; }
    else if (c === ',') { parts.push(current); current = ''; }
    else current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

// ── the library ────────────────────────────────────────────────────────────────────────────────

class UsageError extends Error {}

export function resolveWorkspace(flag, env = process.env, cwd = process.cwd()) {
  const has = dir => fs.existsSync(path.join(dir, 'data', 'references'));
  for (const [source, value] of [['--workspace', flag], ['SCOUT_WORKSPACE', env.SCOUT_WORKSPACE]]) {
    if (!value) continue;
    const dir = path.resolve(value);
    if (!has(dir)) throw new UsageError(source + ' points at ' + dir + ', which has no data/references folder.');
    return dir;
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (has(dir)) return dir;
    if (dir === path.dirname(dir)) break;
  }
  throw new UsageError('No reference library found. Name the Scout workspace one of three ways:\n'
    + '  1. --workspace <folder>\n'
    + '  2. the SCOUT_WORKSPACE environment variable\n'
    + '  3. run from inside the workspace (a folder that contains data/references)');
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;   // `._*` AppleDouble sidecars included
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const list = value => (value === null || value === undefined ? [] : [].concat(value).map(String));
const str = value => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

function absoluteFile(workspace, value) {
  const rel = str(Array.isArray(value) ? value[0] : value).trim();
  if (!rel || /^[a-z]+:\/\//i.test(rel)) return rel || null;
  return path.resolve(workspace, rel);
}

export function loadLibrary(workspace) {
  const dir = path.join(workspace, 'data', 'references');
  const records = [];
  for (const file of markdownFiles(dir)) {
    let parsed;
    try { parsed = parseDocument(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const data = parsed.data;
    records.push({
      id: path.basename(file, '.md'),
      file,
      data,
      body: parsed.body,
      name: str(data.name) || path.basename(file, '.md'),
      category: str(data.category),
      tags: list(data.tags),
      prompt: typeof data.prompt === 'string' ? data.prompt : '',
      signature: str(data.signature),
      archived: data.archived === true,
      image_path: absoluteFile(workspace, data.image),
      generated_image_path: absoluteFile(workspace, data.generated_image),
    });
  }
  const order = record => (typeof record.data.airtable_number === 'number' ? record.data.airtable_number : Infinity);
  return records.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
}

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function findRecords(records, { category = null, tags = [], text = '', hasPrompt = false } = {}) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  return records.filter(record => {
    if (record.archived) return false;
    if (category && !same(record.category, category)) return false;
    if (!tags.every(tag => record.tags.some(have => same(have, tag)))) return false;
    if (hasPrompt && !record.prompt.trim()) return false;
    if (!words.length) return true;
    const haystack = [record.prompt, record.name, record.signature, record.tags.join(' ')].join('\n').toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

function getRecord(records, id) {
  const wanted = String(id || '').trim().replace(/\.md$/, '');
  const record = records.find(r => r.id === wanted) || records.find(r => same(r.id, wanted))
    || records.find(r => str(r.data.airtable_id) === wanted);
  if (!record) throw new UsageError('No reference "' + id + '". Use `find` to list ids (they look like ref-0042).');
  return record;
}

const summary = record => ({
  id: record.id, name: record.name, category: record.category || null, tags: record.tags,
  image_path: record.image_path, prompt_length: record.prompt.length,
});

const detail = record => ({
  ...record.data, id: record.id, file: record.file,
  image_path: record.image_path, generated_image_path: record.generated_image_path,
  image_exists: !!record.image_path && fs.existsSync(record.image_path),
  body: record.body,
});

// ── compose ────────────────────────────────────────────────────────────────────────────────────
// The script WRAPS the reference prompt; it never rewrites it. The only edit it can make is the
// one the caller spells out with --fill, and every such replacement is reported.

const PLACEHOLDER = /\[[A-Z][A-Z0-9 _/&'-]*\]/g;

export function composePrompt(record, subject, fills = []) {
  if (!record.prompt.trim()) throw new UsageError(record.id + ' has no prompt to build from.');
  if (!String(subject || '').trim()) throw new UsageError('compose needs --subject "<what the picture is of>".');
  let reference = record.prompt;
  const filled = [];
  for (const fill of fills) {
    const cut = fill.indexOf('=');
    if (cut < 1) throw new UsageError('--fill takes NAME=value, e.g. --fill "PRODUCT=red wool sweater". Got: ' + fill);
    const token = '[' + fill.slice(0, cut).trim().replace(/^\[|\]$/g, '') + ']';
    const value = fill.slice(cut + 1);
    const count = reference.split(token).length - 1;
    if (count) reference = reference.split(token).join(value);
    filled.push({ placeholder: token, value, count });
  }
  const placeholders = [...new Set(reference.match(PLACEHOLDER) || [])];
  const header = 'Subject: ' + String(subject).trim() + '\n'
    + 'Wherever the reference prompt below says "the product", "the provided product image" or uses a '
    + 'bracketed placeholder such as [PRODUCT], it means this subject.';
  return {
    id: record.id, name: record.name, subject: String(subject).trim(),
    image_path: record.image_path, placeholders, filled,
    reference_prompt: record.prompt,
    prompt: header + '\n\n' + reference,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['workspace', 'category', 'tag', 'text', 'limit', 'subject', 'fill']);
const REPEATABLE = new Set(['tag', 'fill']);

function parseArgs(argv) {
  const flags = {}, positional = [];
  for (let k = 0; k < argv.length; k++) {
    const arg = argv[k];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (!VALUE_FLAGS.has(name)) { flags[name] = true; continue; }
    const value = eq < 0 ? argv[++k] : arg.slice(eq + 1);
    if (value === undefined) throw new UsageError('--' + name + ' needs a value.');
    if (REPEATABLE.has(name)) (flags[name] = flags[name] || []).push(value);
    else flags[name] = value;
  }
  return { flags, positional };
}

const print = text => process.stdout.write(text + '\n');
const json = value => print(JSON.stringify(value, null, 2));

function cmdFind(records, flags) {
  const limit = flags.limit === undefined ? 10 : Math.max(1, Number(flags.limit) || 10);
  const hits = findRecords(records, { category: flags.category, tags: flags.tag || [], text: flags.text, hasPrompt: !!flags['has-prompt'] });
  const shown = hits.slice(0, limit).map(summary);
  if (flags.json) return json({ total: hits.length, shown: shown.length, results: shown });
  if (!hits.length) return print('No references match.');
  for (const r of shown) {
    print(r.id + '  ' + (r.category || '(no category)') + '  ' + r.name);
    print('  tags:   ' + (r.tags.join(', ') || '—'));
    print('  image:  ' + (r.image_path || '—'));
    print('  prompt: ' + (r.prompt_length ? r.prompt_length + ' chars' : 'none'));
  }
  print(shown.length + ' of ' + hits.length + ' shown' + (hits.length > shown.length ? ' — raise --limit or narrow the search' : ''));
}

function cmdShow(records, flags, id) {
  const record = getRecord(records, id);
  // Byte for byte: nothing before it, nothing after it, not even a newline.
  if (flags.prompt) {
    if (!record.prompt) throw new UsageError(record.id + ' has no prompt.');
    return void process.stdout.write(record.prompt);
  }
  if (flags.json) return json(detail(record));
  print(record.id + '  ' + record.name);
  print('category:  ' + (record.category || '—'));
  print('tags:      ' + (record.tags.join(', ') || '—'));
  print('image:     ' + (record.image_path || '—') + (record.image_path && !fs.existsSync(record.image_path) ? '  (missing on disk)' : ''));
  if (record.generated_image_path) print('generated: ' + record.generated_image_path);
  if (record.signature) print('signature: ' + record.signature);
  print('file:      ' + record.file);
  print('');
  print(record.prompt ? '----- PROMPT (word for word) -----\n' + record.prompt + '\n----- END -----' : 'No prompt on this reference.');
}

function cmdCompose(records, flags, id) {
  const built = composePrompt(getRecord(records, id), flags.subject, flags.fill || []);
  if (flags['prompt-only']) return void process.stdout.write(built.prompt);
  if (flags.json) return json(built);
  print('Reference:       ' + built.id + ' — ' + built.name);
  print('Reference image: ' + (built.image_path || '—') + '   (attach it alongside the prompt)');
  for (const f of built.filled) print('Filled:          ' + f.placeholder + ' → ' + f.value + ' (' + (f.count ? f.count + '×' : 'not found in this prompt') + ')');
  if (built.placeholders.length) print('Still to fill:   ' + built.placeholders.join(' '));
  print('----- READY PROMPT -----');
  print(built.prompt);
  print('----- END -----');
}

function cmdStats(records, flags) {
  const live = records.filter(r => !r.archived);
  const by = {};
  for (const r of live) by[r.category || '(no category)'] = (by[r.category || '(no category)'] || 0) + 1;
  const stats = {
    total: live.length,
    with_image: live.filter(r => r.image_path).length,
    image_missing_on_disk: live.filter(r => r.image_path && !/^[a-z]+:\/\//i.test(r.image_path) && !fs.existsSync(r.image_path)).length,
    with_prompt: live.filter(r => r.prompt.trim()).length,
    by_category: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1])),
  };
  if (flags.json) return json(stats);
  print(stats.total + ' references · ' + stats.with_image + ' with an image · ' + stats.with_prompt + ' with a prompt');
  if (stats.image_missing_on_disk) print(stats.image_missing_on_disk + ' image files are missing on disk');
  for (const [name, n] of Object.entries(stats.by_category)) print('  ' + String(n).padStart(5) + '  ' + name);
}

const USAGE = `reflib — read a Scout reference library from disk (never writes)

  find    [--category X] [--tag X]... [--text "words"] [--has-prompt] [--limit N] [--json]
  show    <id> [--prompt | --json]          --prompt prints only the prompt, word for word
  compose <id> --subject "..." [--fill "NAME=value"]... [--prompt-only | --json]
  stats   [--json]

Workspace: --workspace <dir>, else $SCOUT_WORKSPACE, else a parent folder containing data/references.`;

export function main(argv) {
  const { flags, positional } = parseArgs(argv);
  const [command, id] = positional;
  if (!command || flags.help || command === 'help') return print(USAGE);
  if (!['find', 'show', 'compose', 'stats'].includes(command)) throw new UsageError('Unknown command "' + command + '".\n\n' + USAGE);
  if ((command === 'show' || command === 'compose') && !id) throw new UsageError(command + ' needs a reference id, e.g. ref-0042.');
  const workspace = resolveWorkspace(flags.workspace);
  const records = loadLibrary(workspace);
  if (command === 'find') return cmdFind(records, flags);
  if (command === 'show') return cmdShow(records, flags, id);
  if (command === 'compose') return cmdCompose(records, flags, id);
  return cmdStats(records, flags);
}

function runAsScript() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (runAsScript()) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write((error instanceof UsageError ? error.message : 'reflib failed: ' + (error && error.stack || error)) + '\n');
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
