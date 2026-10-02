// The document as Markdown, tidied: the serializer pads a table with a blank line on each side
// and leaves a newline at the end, which a file that already had one blank line would grow by
// one on every save. Runs of blank lines collapse to one; the end is trimmed.
//
// One function for both callers — RichEditor.jsx emits through it and the round-trip test
// serialises through it — so what the test asserts is exactly what the caller is handed.

export function tidyMarkdown(markdown) {
  const lines = [];
  let fence = null;
  let blank = false;
  for (const line of markdown.split('\n')) {
    // The serializer emits fenced code, including inside lists and blockquotes. Whitespace
    // and entity-looking text inside a fence are literal data, even a template string's
    // third newline. Normalise only the paragraphs around those blocks.
    const marker = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      lines.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      blank = false;
      continue;
    }
    if (marker) {
      fence = marker[1];
      lines.push(line);
      blank = false;
      continue;
    }
    const text = line === '&nbsp;' || line === '\u00a0' ? '' : line;
    if (text === '' && blank) continue;
    lines.push(text);
    blank = text === '';
  }
  return lines.join('\n').trimEnd();
}
