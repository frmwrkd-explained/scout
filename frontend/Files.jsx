// frontend/Files.jsx — FILES ON DISK. The way down (docs/01_CANON.md Law 8).
//
// We compress hard: every screen opens at one decision and the reasoning is one click behind it.
// Compression without a way down is concealment, so this screen exists to end every chain of
// clicks at the actual bytes — the folder tree as it really is, the `.md` verbatim, and the
// folder itself open in Finder. Every record's path lands here.
//
// It is deliberately plain and fast. Not a second document surface: nothing here edits, nothing
// here interprets a field, and no collection schema is consulted. `backend/files.mjs` is
// read-only and so is this.
//
// The tree loads ONE LEVEL at a time (`api.files(dir)`), because a recursive walk of a workspace
// with ten thousand records is a stall, and because altitude 1 here means "the folders", not
// "every file you have ever had".
//
// NO THEME BRANCH. Every colour is a token; light and dark are the same code (docs/05_UI_SPEC.md §4).

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { api } from './api';
import { Btn, Chip, Empty, Eyebrow } from './ui';
import Markdown from './Markdown';
import { RenderMedia } from './RenderMedia';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// Rendered markdown is the preview; the raw file is the evidence. Anything not on this list is
// shown verbatim, because "prettifying" a .json or a .mjs would be inventing a second renderer.
const RENDERABLE = new Set(['.md', '.markdown']);

// What `GET /api/files/raw` will hand back as itself rather than as a download. Kept in step with
// backend/files.mjs MEDIA_TYPES — the server is the authority; this list only decides whether to
// ASK. SVG is absent from both, deliberately: it is a script host, not an image, when served raw.
const MEDIA_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico',
  '.mp4', '.webm', '.mov', '.m4v',
  '.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac',
  '.pdf',
]);
const rawUrl = p => '/api/files/raw?path=' + encodeURIComponent(p);

// Frontmatter is split off by delimiter, NOT parsed. This screen must never disagree with the
// file — a parser here would be a second source of truth for what a record says, and the whole
// point of the screen is that there is only one.
const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function splitFrontmatter(text) {
  const m = FM.exec(text || '');
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: null, body: text || '' };
}

function bytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function ago(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (!Number.isFinite(d)) return '';
  if (d <= 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 90) return d + 'd ago';
  return new Date(iso).toISOString().slice(0, 10);
}
// every ancestor of 'data/guests/maria-santos.md' → ['', 'data', 'data/guests']
// `includeSelf` is for a path that IS itself a folder (WHAT THEY KNOW's SOURCE links point at
// `goals/`, `territory/`, `data/` …, item 15) — the chain must expand the folder itself, not stop
// one level above it.
function ancestors(p, includeSelf = false) {
  const segs = String(p || '').split('/').filter(Boolean);
  if (!includeSelf) segs.pop();
  const out = [''];
  segs.reduce((acc, s) => { const next = acc ? acc + '/' + s : s; out.push(next); return next; }, '');
  return out;
}
// A path with no extension in its last segment is a directory. Files rows never have this shape
// (a file always ends `.md`/`.json`/…), so it is a safe, cheap test with no extra round trip.
const looksLikeDir = p => !!p && !/\.[^/.]+$/.test(String(p).replace(/\/+$/, ''));

// the platform word Reveal actually opens, per navigator.platform (item 20) — the button used to
// say "Finder" on every OS, including the two it has never been true on.
function platformWord() {
  const p = (typeof navigator !== 'undefined' && navigator.platform) || '';
  if (/mac/i.test(p)) return 'Finder';
  if (/win/i.test(p)) return 'Explorer';
  return 'file manager';
}

// ── one row in the tree ─────────────────────────────────────────────────────────────────────
// Folder and file share a row shape on purpose: the tree is a list of things on disk, and the
// caret is what says which kind it is. Selected is the neutral raised chip treatment (§6) —
// never an accent fill, which means "click this", not "you are here".
function Row({ depth, name, kind, open, on, count, meta, onClick, draggable, onDragStart }) {
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      className={on ? '' : 'hRow'}
      title={name}
      style={{
        ...sx('display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;height:24px;padding:0 10px;border:none;border-radius:6px;cursor:pointer;text-align:left'),
        paddingLeft: 8 + depth * 13,
        background: on ? 'var(--raise)' : 'transparent',
        color: on ? 'var(--fg)' : kind === 'dir' ? 'var(--fg-soft)' : 'var(--fg-muted)',
      }}
    >
      <span style={{ ...mono('flex:none;width:9px;font-size:9px'), color: 'var(--fg-faint)' }}>
        {kind === 'dir' ? (open ? '▾' : '▸') : ''}
      </span>
      <span style={{
        ...sx('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px'),
        fontWeight: kind === 'dir' ? 600 : 400,
      }}>{name}</span>
      {count != null ? (
        <span style={{ ...mono('flex:none;font-size:9.5px;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{count}</span>
      ) : null}
      {meta ? (
        <span style={{ ...mono('flex:none;font-size:9.5px;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>{meta}</span>
      ) : null}
    </button>
  );
}

// ── the tree ────────────────────────────────────────────────────────────────────────────────
// Recursive render over listings already fetched. A folder that has been opened but not yet
// answered renders a mono LOADING line rather than collapsing — a tree that flickers shut while
// you are reading it is the thing that makes a file browser feel broken.
function Tree({ dir, depth, listings, openDirs, selected, onToggle, onPick }) {
  const listing = listings[dir];
  if (!listing) return <div style={{ ...mono('font-size:9.5px;letter-spacing:.14em;padding:3px 0 3px ' + (21 + depth * 13) + 'px'), color: 'var(--fg-faint)' }}>LOADING…</div>;
  if (!listing.dirs.length && !listing.files.length) {
    return <div style={{ ...mono('font-size:9.5px;letter-spacing:.14em;padding:3px 0 3px ' + (21 + depth * 13) + 'px'), color: 'var(--fg-faint)' }}>EMPTY</div>;
  }
  return (
    <>
      {listing.dirs.map(d => (
        <React.Fragment key={d.path}>
          <Row depth={depth} name={d.name} kind="dir" open={openDirs.has(d.path)} on={false} onClick={() => onToggle(d.path)} />
          {openDirs.has(d.path) ? (
            <Tree dir={d.path} depth={depth + 1} listings={listings} openDirs={openDirs} selected={selected} onToggle={onToggle} onPick={onPick} />
          ) : null}
        </React.Fragment>
      ))}
      {listing.files.map(f => (
        // A record is a card the whiteboard already knows how to place — item 17's "drop the
        // project brief". Only `.md` carries frontmatter the board can resolve into one, so only
        // `.md` rows are draggable; a `.json`/binary row would land as FILE NOT FOUND forever.
        <Row key={f.path} depth={depth} name={f.name} kind="file" on={selected === f.path} meta={bytes(f.size)} onClick={() => onPick(f.path)}
          draggable={f.path.endsWith('.md')}
          onDragStart={f.path.endsWith('.md') ? e => {
            e.dataTransfer.setData('application/x-scout-node', JSON.stringify({ t: 'document', path: f.path }));
            e.dataTransfer.effectAllowed = 'copy';
          } : undefined} />
      ))}
    </>
  );
}

// ── the preview ─────────────────────────────────────────────────────────────────────────────
function Preview({ file, mode, onMode, error }) {
  if (error) {
    return <Empty size="page" style={sx('max-width:420px;margin:40px auto')} title="That file could not be read" body={error} />;
  }
  if (!file) {
    return (
      <Empty
        size="page"
        style={sx('max-width:440px;margin:40px auto')}
        title="Pick a file — this is what is actually on disk"
        body={'Everything Scout knows is a plain markdown file in this folder. Nothing is hidden here: what you see is the file, frontmatter and all, and Reveal in ' + platformWord() + ' opens the real folder.'}
      />
    );
  }
  if (file.binary) {
    // A picture is not "nothing honest to show" — it is the file, and Law 8 is about being able to
    // SEE what is on disk. `GET /api/files/raw` serves the recognised media types as themselves
    // (and everything else as a download it will never render), so a photo, a clip or a PDF in the
    // workspace previews here. Anything else still says what it is and how big it is.
    const media = MEDIA_EXT.has(file.ext);
    if (media) {
      return (
        <div style={sx('flex:1;min-height:0;overflow:auto;padding:16px 22px 40px;display:flex;flex-direction:column;gap:12px')}>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <span style={{ ...mono('font-size:9.5px;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
              {file.ext.replace('.', '').toUpperCase() + ' · ' + bytes(file.size)}
            </span>
          </div>
          {file.ext === '.pdf' ? (
            <object data={rawUrl(file.path)} type="application/pdf"
              style={{ ...sx('width:100%;flex:1;min-height:480px;border-radius:10px'), border: '1px solid var(--border)', background: 'var(--sunk)' }}>
              <Empty size="page" style={sx('max-width:420px;margin:40px auto')} title="PDF"
                body="This machine has no inline PDF viewer. Reveal in Finder opens it." />
            </object>
          ) : (
            <RenderMedia src={rawUrl(file.path)} controls hoverPlay={false} fit="contain"
              style={{ ...sx('max-width:100%;max-height:70vh;border-radius:10px'), background: 'var(--sunk)' }} />
          )}
        </div>
      );
    }
    return (
      <Empty
        size="page"
        style={sx('max-width:420px;margin:40px auto')}
        title={'BINARY — ' + bytes(file.size)}
        body={'Not text, so there is nothing honest to show here. Reveal in ' + platformWord() + ' opens it in whatever the machine uses for this kind of file.'}
      />
    );
  }

  const renderable = RENDERABLE.has(file.ext);
  const { fm, body } = splitFrontmatter(file.text);
  const raw = !renderable || mode === 'raw';

  return (
    <div style={sx('flex:1;min-height:0;overflow:auto;padding:16px 22px 40px')}>
      {renderable ? (
        <div style={sx('display:flex;align-items:center;gap:6px;margin-bottom:12px')}>
          <Chip label="RENDERED" on={!raw} onClick={() => onMode('rendered')} />
          <Chip label="RAW" on={raw} onClick={() => onMode('raw')} />
          <span style={{ ...mono('margin-left:auto;font-size:9.5px;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
            {file.truncated ? 'FIRST 512 KB OF ' + bytes(file.size) : bytes(file.size)}
          </span>
        </div>
      ) : null}

      {raw ? (
        <pre style={{
          ...mono('margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.65;padding:14px 16px;border-radius:10px'),
          background: 'var(--sunk)', border: '1px solid var(--border)', color: 'var(--fg-soft)',
        }}>{file.text}</pre>
      ) : (
        <>
          {fm != null ? (
            <div style={sx('margin-bottom:14px')}>
              <Eyebrow style={sx('display:block;margin-bottom:6px')}>FRONTMATTER</Eyebrow>
              {/* verbatim, never re-serialised: the point of this screen is that it cannot
                  disagree with the file */}
              <pre style={{
                ...mono('margin:0;white-space:pre-wrap;word-break:break-word;font-size:10.5px;line-height:1.6;padding:11px 13px;border-radius:8px'),
                background: 'var(--sunk)', border: '1px solid var(--border)', color: 'var(--fg-muted)',
              }}>{fm}</pre>
            </div>
          ) : null}
          <div className="mdBody"><Markdown text={body} /></div>
        </>
      )}

      {file.truncated && raw ? (
        <div style={{ ...mono('font-size:9.5px;letter-spacing:.12em;margin-top:12px'), color: 'var(--fg-faint)' }}>
          {'TRUNCATED AT 512 KB — REVEAL IN ' + platformWord().toUpperCase() + ' FOR THE WHOLE FILE'}
        </div>
      ) : null}
    </div>
  );
}

// ── the screen ──────────────────────────────────────────────────────────────────────────────
// Props (all optional — `<Files />` is a working screen):
//   path / arg    a workspace-relative file path to open on mount. This is how a record's
//                 `data/guests/maria-santos.md` lands here; ancestors are expanded for you.
//                 Two names because App.jsx's `go(screen, arg)` carries its argument as `arg`.
//   onOpenPath    App.jsx's `openPath` — the way back UP, from the bytes to the record on the
//                 document surface. Offered on any `.md`, and only when the prop is supplied.
//   onSelect      fired with the workspace-relative path whenever a file is picked here.
export default function Files({ path = '', arg = '', onOpenPath, onSelect }) {
  const initial = path || arg || '';
  const [listings, setListings] = React.useState({});     // dir path → listing
  const [openDirs, setOpenDirs] = React.useState(() => new Set(['']));
  const [selected, setSelected] = React.useState('');
  const [file, setFile] = React.useState(null);
  const [mode, setMode] = React.useState('rendered');
  const [treeError, setTreeError] = React.useState(null);
  const [fileError, setFileError] = React.useState(null);
  const [revealed, setRevealed] = React.useState(null);   // transient confirmation

  // Fetch one directory, once. Refs rather than state for the in-flight set: two rows expanding
  // in the same tick must not both fire, and a state update would not have landed yet.
  const inflight = React.useRef(new Set());
  const load = React.useCallback(async dir => {
    if (inflight.current.has(dir)) return;
    inflight.current.add(dir);
    try {
      const listing = await api.files(dir);
      setListings(l => ({ ...l, [dir]: listing }));
      setTreeError(null);
    } catch (e) {
      // A folder that will not list is reported where it happened, not swallowed into an empty
      // tree that looks like an empty workspace.
      if (!dir) setTreeError(e.message);
      setListings(l => ({ ...l, [dir]: { path: dir, dirs: [], files: [] } }));
    } finally {
      inflight.current.delete(dir);
    }
  }, []);

  React.useEffect(() => { load(''); }, [load]);

  // Open a path handed in from a record: expand every ancestor and select the file. WHAT THEY
  // KNOW's per-block SOURCE links point at a FOLDER (`goals/`, `territory/`, `data/` …, item 15) —
  // an extensionless initial path is treated as the directory it is: expand it (and everything
  // above it — `includeSelf`) and select nothing, rather than asking api.fileRead for a folder and
  // showing "that is a folder" as if the link were broken.
  React.useEffect(() => {
    if (!initial) return;
    const isDir = looksLikeDir(initial);
    const chain = ancestors(initial, isDir);
    setOpenDirs(prev => { const next = new Set(prev); chain.forEach(d => next.add(d)); return next; });
    chain.forEach(load);
    setSelected(isDir ? '' : initial);
  }, [initial, load]);

  // Read whatever is selected. The guard on `live` is the stale-response case: click three files
  // quickly and the slowest answer must not win.
  React.useEffect(() => {
    if (!selected) { setFile(null); setFileError(null); return; }
    let live = true;
    setFileError(null);
    api.fileRead(selected)
      .then(f => { if (live) { setFile(f); setMode('rendered'); } })
      .catch(e => { if (live) { setFile(null); setFileError(e.message); } });
    return () => { live = false; };
  }, [selected]);

  const toggle = dir => {
    setOpenDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else { next.add(dir); if (!listings[dir]) load(dir); }
      return next;
    });
  };
  const pick = p => { setSelected(p); setRevealed(null); onSelect && onSelect(p); };

  const reveal = async () => {
    // Reveal what is selected; with nothing selected, open the workspace root — the person asked
    // to see the folder, and "nothing happened" is the wrong answer to that.
    const target = selected || '';
    try {
      await api.revealPath(target);
      setRevealed(target || 'the workspace');
      setTimeout(() => setRevealed(null), 2400);
    } catch (e) {
      setRevealed('could not reveal — ' + e.message);
    }
  };

  const root = listings[''] || null;
  const crumbs = String(selected || '').split('/').filter(Boolean);

  return (
    <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
      {/* header — where you are, and the way out to the OS file browser */}
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px 12px')}>
        <div style={sx('display:flex;align-items:baseline;gap:9px;min-width:0')}>
          <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.16em;flex:none'), color: 'var(--fg-faint)' }}>PATH</span>
          <span style={{ ...mono('font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg-soft)' }}>
            {crumbs.length
              ? crumbs.map((c, i) => (
                <React.Fragment key={i}>
                  {i ? <span style={{ color: 'var(--fg-faint)' }}> / </span> : null}
                  <span style={{ color: i === crumbs.length - 1 ? 'var(--fg)' : 'var(--fg-muted)' }}>{c}</span>
                </React.Fragment>
              ))
              : <span style={{ color: 'var(--fg-muted)' }}>{root?.absolute || 'the workspace'}</span>}
          </span>
        </div>
        <div style={sx('display:flex;align-items:center;gap:10px;flex:none')}>
          {revealed ? (
            <span style={{ ...mono('font-size:9.5px;letter-spacing:.12em'), color: 'var(--fg-faint)' }}>
              {revealed.startsWith('could not') ? revealed.toUpperCase() : 'OPENED IN ' + platformWord().toUpperCase()}
            </span>
          ) : null}
          {/* the screen's one solid accent fill — its primary action (docs/DESIGN.md) */}
          <Btn variant="primary" size="sm" onClick={reveal}>{'Reveal in ' + platformWord()}</Btn>
        </div>
      </div>

      <div style={sx('flex:1;min-height:0;display:flex;border-top:1px solid var(--line)')}>
        {/* tree */}
        <div style={sx('flex:none;width:262px;min-width:0;overflow:auto;padding:10px 8px 24px;border-right:1px solid var(--line);background:var(--surface)')}>
          {treeError ? (
            <Empty style={sx('margin:8px 4px')} title="The workspace did not list" body={treeError} />
          ) : (
            <Tree dir="" depth={0} listings={listings} openDirs={openDirs} selected={selected} onToggle={toggle} onPick={pick} />
          )}
        </div>

        {/* preview */}
        <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden')}>
          {file && !fileError ? (
            <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 22px 0')}>
              <span style={{ ...sx('font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'), color: 'var(--fg)' }}>{file.name}</span>
              <div style={sx('display:flex;align-items:center;gap:12px;flex:none')}>
                <span style={{ ...mono('font-size:9.5px;letter-spacing:.12em;white-space:nowrap;font-variant-numeric:tabular-nums'), color: 'var(--fg-faint)' }}>
                  {bytes(file.size)}{file.modified ? ' · ' + ago(file.modified).toUpperCase() : ''}
                </span>
                {/* the way back up: from the bytes to the record. Ghost, not accent — the one
                    solid accent fill on this screen is Reveal. */}
                {onOpenPath && RENDERABLE.has(file.ext) ? (
                  <Btn size="sm" onClick={() => onOpenPath(file.path)}>Open as record</Btn>
                ) : null}
              </div>
            </div>
          ) : null}
          <Preview file={file} mode={mode} onMode={setMode} error={fileError} />
        </div>
      </div>
    </div>
  );
}
