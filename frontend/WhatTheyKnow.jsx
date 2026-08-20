// WHAT THEY KNOW — `.scout/cache/context.md`, rendered read-only.
//
// T11 / docs/03_MEMORY.md §7.3 and Law 7. This is the single read an assistant performs on waking:
// not a summary of it, not a UI paraphrase of it, the file itself. That is the whole point — the
// person can see exactly what their assistant knows about them, and go fix the source.
//
// READ-ONLY BY CONSTRUCTION. The cache is generated (backend/memory.mjs `renderCache` is its only
// producer). Editing it here would be editing a derived file, so the only write on this screen is
// Regenerate, and every block instead points at the source you WOULD edit.
//
// THE BUDGET IS THE FEATURE (docs/03_MEMORY.md §2). The token count is the real number from
// `GET /api/context`, printed mono with tabular numerals against the 2000-token cap, and it says
// out loud whether it is under or over. When the render had to compress to fit, `dropped` says
// what was left out — a silent truncation would be a defect, and a screen whose whole job is
// "nothing is hidden" cannot have one.
//
// Props
//   onOpenPath(path)   Law 8 — every block links to the file it came from, and every `.md` path
//                      inside the text is clickable.
//   project            optional project id. An assistant working a project reads the PROJECT
//                      cache only (docs/03_MEMORY.md §2), so this screen can show that one too.
//   refreshKey         optional. Change it to force a re-read — a memory screen that just wrote
//                      passes its own counter so this surface catches up without a manual reload.

import React from 'react';
import { sx } from './sx';
import { api } from './api';
import { Btn, Card, Eyebrow, Empty } from './ui';
import { Markdown } from './Markdown';
import { mono, PathLink, Bar, useResource, Loading, Failed, ScreenHead } from './Memory';

// docs/03_MEMORY.md §2 / docs/08 §5: MEMORY.CACHE_TOKEN_BUDGET = 2000. The backend is the
// authority and sends its own when it can; this is the documented default, used only until it does.
const DEFAULT_BUDGET = 2000;

// Every heading `renderCache` emits, and the file or folder it was built from. This is the
// "each block links to the file it came from" contract, and it is a table rather than a guess
// because a wrong link here would send a person to edit something that changes nothing.
const SOURCE = {
  'WHO I WORK FOR':          { path: 'me.md',       what: 'ABOUT YOU' },
  GOALS:                     { path: 'goals/',      what: 'YOUR GOALS' },
  PROJECT:                   { path: 'projects/',   what: 'THE PROJECT BRIEF' },
  'BEST GROUND':             { path: 'territory/',  what: 'THE GROUND' },
  BLOCKED:                   { path: 'territory/',  what: 'THE GROUND' },
  'NEVER TRIED':             { path: 'territory/',  what: 'THE GROUND' },
  'WHAT WORKS':              { path: 'playbook/',   what: 'WHAT WORKS' },
  LEARNED:                   { path: 'learnings/',  what: 'WHAT THEY LEARNED' },
  'SINCE YOUR LAST RUN':     { path: 'log/',        what: 'THE EVENT LOG' },
  'OPEN QUESTIONS FROM YOU': { path: 'proposals/',  what: 'THE DECIDE QUEUE' },
  COUNTS:                    { path: 'data/',       what: 'YOUR RECORDS' },
};

function sourceFor(heading) {
  const h = String(heading || '').toUpperCase();
  if (SOURCE[h]) return SOURCE[h];
  // `## PROJECT · 2026-08-hazing` — the id is part of the heading in the spec's own example.
  const key = Object.keys(SOURCE).find(k => h.startsWith(k));
  return key ? SOURCE[key] : null;
}

// The compression ladder, in the order renderCache runs it (docs/03_MEMORY.md §2), said in words a
// person can act on. `dropped` may arrive as a code, a sentence, or an object; all three are shown.
const DROP_WORDS = [
  [/territor/i,             'Some of the ground was left out — they kept the best five, the three that have gone longest without a visit, and everything you are locked out of.'],
  [/playbook|what works/i,  'What works was cut back to titles only. Your assistants still know the claims; they no longer get the one-line reason with them.'],
  [/learn/i,                'Older learnings that nobody has re-checked were left out.'],
  [/since|last run/i,       'What changed since their last run was cut down to counts.'],
  [/goal/i,                 'Only the goals that are behind were included.'],
];

function dropSentence(d) {
  const text = typeof d === 'string' ? d : (d?.reason || d?.what || d?.rule || JSON.stringify(d));
  const hit = DROP_WORDS.find(([re]) => re.test(text));
  return { code: String(text), plain: hit ? hit[1] : text };
}

// The cache is wrapped in `<scout-context v="184" generated="…" project="…">`. The wrapper is the
// agent's contract, not the person's, so it is lifted into the header and out of the reading.
function parseCache(text) {
  const raw = String(text || '');
  const openTag = /<scout-context([^>]*)>/i.exec(raw);
  const attrs = {};
  if (openTag) {
    for (const m of openTag[1].matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[m[1].toLowerCase()] = m[2];
  }
  const inner = raw
    .replace(/<scout-context[^>]*>/i, '')
    .replace(/<\/scout-context>/i, '')
    .trim();

  const blocks = [];
  let current = null;
  for (const line of inner.split('\n')) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) { if (current) blocks.push(current); current = { heading: h[1].trim(), lines: [] }; continue; }
    if (!current) { if (line.trim()) current = { heading: '', lines: [line] }; continue; }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  return { attrs, blocks: blocks.map(b => ({ heading: b.heading, text: b.lines.join('\n').trim() })) };
}

// Any `.md` path written inside a block is a real door — Law 8 says it opens.
const PATH_RE = /\b[\w][\w./-]*\.md\b/g;

function BlockPaths({ text, onOpenPath }) {
  const found = [...new Set(String(text || '').match(PATH_RE) || [])];
  if (!found.length) return null;
  return (
    <span style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:9px')}>
      <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>MENTIONED HERE</span>
      {found.map(p => <PathLink key={p} path={p} onOpenPath={onOpenPath} />)}
    </span>
  );
}

function Block({ block, onOpenPath }) {
  const src = sourceFor(block.heading);
  return (
    <Card style={sx('background:var(--surface-2);border-color:var(--border)')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:9px')}>
        <Eyebrow style={sx('font-size:9.5px;font-weight:800;letter-spacing:.18em;color:var(--fg-soft)')}>
          {block.heading || 'THE OPENING LINES'}
        </Eyebrow>
        <span style={sx('display:flex;align-items:center;gap:7px')}>
          {src ? (
            <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>FROM {src.what}</span>
          ) : null}
          <PathLink path={src ? src.path : '.scout/cache/context.md'} onOpenPath={onOpenPath} />
        </span>
      </div>
      <div className="mdBody" style={sx('font-size:12px;line-height:1.65;color:var(--fg-soft)')}>
        <Markdown text={block.text} />
      </div>
      <BlockPaths text={block.text} onOpenPath={onOpenPath} />
    </Card>
  );
}

export default function WhatTheyKnow({ onOpenPath, project = '', refreshKey = 0 }) {
  const { data, error, loading, reload } = useResource(() => api.context(project), [project, refreshKey]);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(null);
  const [raw, setRaw] = React.useState(false);

  const regenerate = async () => {
    setBusy(true);
    setNote(null);
    try {
      await api.regenerate(project);
      await reload();
      setNote({ kind: 'ok', text: 'REBUILT FROM YOUR FILES JUST NOW' });
    } catch (e) {
      setNote({ kind: 'error', text: 'COULD NOT REBUILD — ' + String(e.message || e).toUpperCase() });
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading what="WHAT THEY KNOW" />;
  if (!data) {
    return (
      <Failed
        error={error}
        title="THEY KNOW NOTHING YET"
        body={error ? String(error.message || error) : 'Nothing has been written into memory, so there is no wake-up note for your assistants to read.'}
      />
    );
  }

  const text = String(data.text ?? data.context ?? '');
  const budget = Number(data.budget ?? data.token_budget ?? DEFAULT_BUDGET);
  const tokens = Number(data.tokens ?? 0);
  const over = tokens > budget;
  const version = data.version ?? data.v ?? null;
  const dropped = [].concat(data.dropped || []).filter(Boolean).map(dropSentence);
  const { attrs, blocks } = parseCache(text);
  const cachePath = project ? 'projects/' + project + '/.cache/context.md' : '.scout/cache/context.md';
  const tone = over ? 'var(--danger)' : tokens / budget > 0.8 ? 'var(--warn)' : 'var(--ok)';

  return (
    <div style={sx('flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden')}>
      <ScreenHead
        eyebrow="WHAT YOUR ASSISTANTS KNOW"
        line="This is the whole of what an assistant reads before it starts work. Nothing else is in its head. If something here is wrong, fix it where it came from and rebuild."
        right={
          <>
            {note ? (
              <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em;white-space:nowrap'), color: note.kind === 'error' ? 'var(--danger)' : 'var(--ok)' }}>{note.text}</span>
            ) : null}
            {/* The one solid accent fill on this screen — UI_SPEC §6. */}
            <Btn variant="primary" size="md" busy={busy} onClick={regenerate}>
              {busy ? 'Rebuilding…' : 'Rebuild it now'}
            </Btn>
          </>
        }>
        <div style={sx('display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-top:2px')}>
          <span style={sx('display:flex;flex-direction:column;gap:5px;min-width:210px')}>
            <span style={sx('display:flex;align-items:baseline;gap:7px')}>
              <span style={{ ...mono('font-size:17px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1'), color: tone }}>
                {tokens.toLocaleString()}
              </span>
              <span style={{ ...mono('font-size:11px;font-weight:500;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
                / {budget.toLocaleString()}
              </span>
              <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em;margin-left:4px'), color: tone }}>
                {over ? 'OVER BUDGET' : 'UNDER BUDGET'}
              </span>
            </span>
            <Bar pct={budget ? (tokens / budget) * 100 : 0} tone={tone} />
            <span style={{ ...mono('font-size:9px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>
              HOW MUCH OF THEIR ATTENTION THIS TAKES UP BEFORE THEY START
            </span>
          </span>

          <span style={sx('display:flex;align-items:center;gap:9px;flex-wrap:wrap')}>
            {version != null ? (
              <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.06em;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
                VERSION {version}
              </span>
            ) : null}
            {attrs.generated ? (
              <span style={{ ...mono('font-size:9.5px;font-weight:500;letter-spacing:.06em;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
                BUILT {attrs.generated.toUpperCase()}
              </span>
            ) : null}
            <PathLink path={cachePath} onOpenPath={onOpenPath} />
          </span>
        </div>
      </ScreenHead>

      <div style={sx('flex:1;min-height:0;overflow-y:auto;padding:18px 20px 32px;display:flex;flex-direction:column;gap:12px')}>
        {over ? (
          <div style={{ ...sx('display:flex;flex-direction:column;gap:3px;padding:11px 13px;border-radius:8px'), background: 'var(--sunk)', border: '1px solid var(--danger)' }}>
            <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--danger)' }}>THIS IS TOO MUCH TO READ</span>
            <span style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}>
              It is over the limit, which is the same overload you are trying to avoid for yourself.
              Retire something in what works, or drop a learning nobody has confirmed.
            </span>
          </div>
        ) : null}

        {dropped.length ? (
          <div style={{ ...sx('display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:8px'), background: 'var(--sunk)', border: '1px solid var(--warn)' }}>
            <span style={{ ...mono('font-size:9px;font-weight:800;letter-spacing:.14em'), color: 'var(--warn)' }}>
              LEFT OUT SO IT WOULD FIT · {dropped.length}
            </span>
            <span style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}>
              Your assistants did not read the following. It is still on your disk, untouched — it
              just did not fit into what they can hold.
            </span>
            <ul style={sx('margin:2px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:5px')}>
              {dropped.map((d, i) => (
                <li key={i} style={sx('font-size:11.5px;line-height:1.55;color:var(--fg-soft)')}>
                  {d.plain}
                  {d.plain !== d.code ? (
                    <span style={{ ...mono('font-size:9px;font-weight:600;letter-spacing:.08em;margin-left:7px'), color: 'var(--fg-faint)' }}>{d.code}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <span style={{ ...mono('font-size:9.5px;font-weight:700;letter-spacing:.1em'), color: 'var(--fg-faint)' }}>
            NOTHING WAS LEFT OUT — THEY READ ALL OF IT
          </span>
        )}

        {blocks.length
          ? blocks.map((b, i) => <Block key={i} block={b} onOpenPath={onOpenPath} />)
          : <Empty title="THE WAKE-UP NOTE IS EMPTY" body="There is nothing in memory to tell them yet. Write a line about yourself and rebuild." />}

        <div style={sx('display:flex;flex-direction:column;gap:9px;padding-top:6px')}>
          <span style={sx('display:flex;align-items:center;gap:10px')}>
            <Btn size="sm" variant="ghost" onClick={() => setRaw(r => !r)}>
              {raw ? 'Hide the raw file' : 'Read it exactly as they do'}
            </Btn>
            <span style={{ ...mono('font-size:9px;font-weight:500;letter-spacing:.08em'), color: 'var(--fg-faint)' }}>{cachePath}</span>
          </span>
          {raw ? (
            <pre style={{
              ...mono('margin:0;padding:13px 15px;border-radius:8px;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-word;overflow-x:auto'),
              background: 'var(--sunk)', border: '1px solid var(--border)', color: 'var(--fg-muted)',
            }}>{text}</pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}
