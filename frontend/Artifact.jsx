// Inline documents use the same canonical read/write routes as the full document surface.
// A chat mention is only a reference, never permission to fetch an arbitrary file or URL.
import React from 'react';
import { api } from './api';
import { sx } from './sx';
import { Btn } from './ui';
import { Markdown } from './Markdown';
import RichEditor from './RichEditor';
import { inspectRichMarkdown } from './rich/compatibility.js';

const ROOTS = new Set(['data', 'goals', 'playbook', 'learnings', 'territory', 'projects']);
const escapeRE = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function localArtifactPath(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\\:%?#\x00-\x1f]/.test(value)) return null;
  const parts = value.trim().split('/');
  if (!ROOTS.has(parts[0]) || parts.length < 2 || !parts.at(-1).endsWith('.md')) return null;
  if (parts.some(part => !/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(part) || part === '.' || part === '..')) return null;
  if (parts[0] === 'data' && parts.length < 3) return null;
  if (parts[0] === 'projects' && !(parts.length === 4 && parts[2] === 'tasks')) return null;
  if (parts[0] !== 'data' && parts[0] !== 'projects' && parts.length !== 2) return null;
  return parts.join('/');
}

export function artifactTitle(ref = {}) {
  if (ref.title && !localArtifactPath(ref.title)) return String(ref.title);
  const path = ref.path || '';
  if (path.startsWith('data/delivery/')) return 'Delivery draft';
  if (path.startsWith('data/artifacts/')) return 'Prepared material';
  const name = path.split('/').at(-1)?.replace(/\.md$/, '').replace(/[-_]+/g, ' ') || 'Document';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function normalizeArtifacts(values) {
  const refs = new Map();
  for (const value of [].concat(values || [])) {
    const ref = typeof value === 'string' ? { path: value } : value;
    const path = localArtifactPath(ref?.path || ref?.artifact_path || ref?.output_path);
    if (!path) continue;
    const previous = refs.get(path) || {};
    refs.set(path, { ...previous, ...ref, path,
      title: ref.title || previous.title, assistant: ref.assistant || ref.worker || previous.assistant });
  }
  return [...refs.values()];
}

export function messageArtifacts(message = {}) {
  const refs = normalizeArtifacts(message.meta?.artifacts || []);
  const text = String(message.text || '');
  for (const match of text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const [path, title] = match[1].split('|');
    refs.push({ path: path.trim(), ...(title ? { title: title.trim() } : {}) });
  }
  // Require a text delimiter before relative paths: an external URL containing /data/... is
  // not a local document. Structured references cover names with spaces.
  for (const match of text.matchAll(/(?:^|[\s(`\[])((?:data|goals|playbook|learnings|territory|projects)\/[a-zA-Z0-9_./-]+\.md)(?=$|[\s)\]`,;.!])/g)) refs.push({ path: match[1] });
  return normalizeArtifacts(refs);
}

export function artifactMessageText(message, refs = messageArtifacts(message)) {
  let text = String(message?.text || '');
  for (const ref of refs) {
    const path = escapeRE(ref.path), label = artifactTitle(ref);
    text = text.replace(new RegExp('\\[\\[' + path + '(?:\\|[^\\]\\n]+)?\\]\\]', 'g'), label)
      .replace(new RegExp('\\[([^\\]\\n]+)\\]\\(' + path + '\\)', 'g'), '$1')
      .replace(new RegExp('`' + path + '`', 'g'), label)
      .replace(new RegExp('(^|[\\s(\\[`*_])' + path + '(?=$|[\\s)\\]`,;.!*_])', 'gm'), (_, before) => before + label);
  }
  return text;
}

export function workArtifacts(work, doc) {
  // The current typed packet owns its generated attachments. Historical links remain
  // readable in the work note, without bringing superseded checks back into the packet.
  const packet = work?.artifacts ?? doc?.data?.artifacts;
  if (Array.isArray(packet) && packet.length) return normalizeArtifacts(packet).filter(ref => ref.path !== work?.path);
  const refs = [];
  for (const data of [work, doc?.data]) {
    if (!data) continue;
    refs.push(...[].concat(data.artifacts || [], data.supporting_materials || [], data.artifact_paths || [],
      data.artifact_path || [], data.output_path || []));
  }
  refs.push(...messageArtifacts({ text: doc?.content || '' }));
  return normalizeArtifacts(refs).filter(ref => ref.path !== work?.path);
}

function summary(content) {
  const paragraph = String(content || '').split(/\n\s*\n/).find(line => line.trim() && !/^\s*#/.test(line)) || '';
  const plain = paragraph.replace(/[`*_#>]/g, '')
    .replace(/(^|\s)((?:data|goals|playbook|learnings|projects)\/[a-zA-Z0-9_./-]+\.md)(?=$|[\s),;.!])/g,
      (_, before, path) => before + artifactTitle({ path }))
    .replace(/\s+/g, ' ').trim();
  return plain.length > 170 ? plain.slice(0, 167) + '…' : plain;
}

export async function saveArtifactBody(path, content, rev, actor = 'crystal') {
  const safePath = localArtifactPath(path);
  if (!safePath || !rev) throw new Error('Reload this document before saving an edit.');
  return api.patchRecord(safePath, { body: content }, rev, content, actor);
}

function ArtifactBody({ value, editing, onChange }) {
  const supported = React.useMemo(() => inspectRichMarkdown(value).safe, [value]);
  if (!editing && !supported) return <Markdown text={value} />;
  return <RichEditor value={value} onChange={onChange} readOnly={!editing} toolbar={editing} minHeight={100} style={sx('min-width:0')} />;
}

export default function Artifact({ artifact, actor = 'crystal', agents = [], onOpenPath, onSaved, onDirty, refreshKey, defaultExpanded = false, seed }) {
  const path = localArtifactPath(artifact?.path);
  const [doc, setDoc] = React.useState(seed || null), [body, setBody] = React.useState(seed?.content || '');
  const [expanded, setExpanded] = React.useState(defaultExpanded), [editing, setEditing] = React.useState(false);
  const [loading, setLoading] = React.useState(!seed), [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(''), [conflict, setConflict] = React.useState(null), [retry, setRetry] = React.useState(0);
  const [showFile, setShowFile] = React.useState(false), [saved, setSaved] = React.useState(false);
  const bodyRef = React.useRef(body), docRef = React.useRef(doc), mounted = React.useRef(true);
  const writing = React.useRef(false);
  bodyRef.current = body; docRef.current = doc;
  const dirty = !!doc && body !== doc.content;

  React.useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  React.useEffect(() => {
    if (!path) return undefined;
    let live = true;
    // A parent refresh must not change the revision underneath an unsaved human draft.
    if (docRef.current && bodyRef.current !== docRef.current.content) return undefined;
    setLoading(!docRef.current); setError('');
    api.record(path).then(next => {
      if (!live || (docRef.current && bodyRef.current !== docRef.current.content)) return;
      docRef.current = next; bodyRef.current = next.content || '';
      setDoc(next); setBody(next.content || '');
    }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, refreshKey, retry]);
  React.useEffect(() => {
    if (!dirty) return undefined;
    const beforeLeave = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeLeave);
    return () => window.removeEventListener('beforeunload', beforeLeave);
  }, [dirty]);

  if (!path) return null;
  const title = doc?.data?.title || doc?.data?.name || artifactTitle(artifact);
  const authorId = artifact.assistant || artifact.worker || doc?.data?.assistant || doc?.data?.prepared_by || doc?.data?.created_by || '';
  const author = agents.find(agent => agent.id === authorId)?.name || authorId;
  const type = artifact.type || (path.startsWith('data/artifacts/') ? 'Prepared material'
    : path.startsWith('data/delivery/') ? 'Delivery draft' : path.startsWith('data/work/') ? 'Working notes' : 'Document');
  const blocked = !!(doc?.flags?.quarantined || doc?.flags?.agentPromotion);
  const change = next => { bodyRef.current = next; setBody(next); setSaved(false); };
  const save = async (base = docRef.current) => {
    if (writing.current || !base?.rev) return;
    writing.current = true; setSaving(true); setError(''); setSaved(false);
    const sent = bodyRef.current;
    try {
      const response = await saveArtifactBody(path, sent, base.rev, actor);
      const next = response.rev ? { ...base, ...response, content: response.content ?? sent } : await api.record(path);
      if (!mounted.current) return;
      docRef.current = next; setDoc(next); setConflict(null);
      if (bodyRef.current === sent) {
        bodyRef.current = next.content; setBody(next.content); setSaved(true); setEditing(false);
      }
      onSaved?.(next);
    } catch (e) {
      if (!mounted.current) return;
      if (e.status === 409) {
        try {
          const disk = await api.record(path);
          if (mounted.current) setConflict(disk);
        } catch (readError) { if (mounted.current) setError(readError.message); }
      } else setError(e.message);
    } finally {
      writing.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const useLatest = () => {
    docRef.current = conflict; bodyRef.current = conflict.content;
    setDoc(conflict); setBody(conflict.content); setConflict(null); setEditing(false); setSaved(false);
  };

  return <article data-artifact-path={path} aria-label={title} onKeyDown={event => {
    if (editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); event.stopPropagation();
      if (dirty && !conflict) save();
    }
  }} style={sx('border:1px solid var(--border-2);border-radius:8px;background:var(--surface);overflow:hidden;min-width:0')}>
    <div style={sx('padding:9px 11px;display:flex;align-items:center;gap:8px')}>
      <div style={sx('min-width:0;flex:1')}>
        <span style={sx('display:block;font-size:10px;color:var(--fg-muted);line-height:1.5')}>{type}{author ? ' · ' + author : ''}{doc?.data?.proposed ? ' · needs review' : ''}</span>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
          style={sx('display:block;text-align:left;font:inherit;font-size:12.5px;font-weight:600;line-height:1.5;color:var(--fg);background:none;border:0;padding:0;cursor:pointer;max-width:100%;overflow-wrap:anywhere')}>
          {title}
        </button>
      </div>
      {dirty ? <span role="status" style={sx('font-size:10px;color:var(--warn)')}>Unsaved</span> : saved ? <span role="status" style={sx('font-size:10px;color:var(--ok)')}>Saved</span> : null}
      <Btn size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Close' : 'Preview'}</Btn>
    </div>
    {!expanded && !loading && doc?.content ? <p style={sx('margin:0;padding:0 11px 10px;font-size:11.5px;line-height:1.5;color:var(--fg-muted)')}>{summary(doc.content)}</p> : null}
    {loading ? <p role="status" style={sx('margin:0;padding:0 11px 10px;font-size:11px;color:var(--fg-muted)')}>Loading document…</p> : null}
    {error ? <div role="alert" style={sx('padding:0 11px 10px;font-size:11.5px;color:var(--danger)')}>{error} {!doc ? <Btn size="sm" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry</Btn> : null}</div> : null}
    {expanded && doc ? <>
      <div style={sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap;border-top:1px solid var(--line);padding:8px 11px')}>
        {editing ? <><Btn size="sm" variant="primary" busy={saving} disabled={!dirty || !!conflict || !doc.rev} onClick={() => save()}>Save changes</Btn>
          <Btn size="sm" variant="ghost" disabled={saving} onClick={() => { if (conflict) useLatest(); else { change(docRef.current.content); setEditing(false); } }}>Cancel edit</Btn></>
          : <Btn size="sm" variant="secondary" disabled={blocked || !doc.rev} onClick={() => { setEditing(true); setSaved(false); }}>Edit here</Btn>}
        {onOpenPath ? <Btn size="sm" variant="ghost" disabled={dirty || saving} onClick={() => onOpenPath(path, { expanded: true })}>Open full</Btn> : null}
        <Btn size="sm" variant="ghost" onClick={() => setShowFile(value => !value)}>{showFile ? 'Hide file' : 'File details'}</Btn>
      </div>
      {showFile ? <code style={sx('display:block;padding:0 11px 9px;font-size:10px;color:var(--fg-muted);overflow-wrap:anywhere')}>{path}</code> : null}
      {blocked ? <p style={sx('margin:0;padding:0 11px 9px;font-size:11.5px;color:var(--warn)')}>Review this document in the full view before editing.</p> : null}
      {conflict ? <div role="alert" style={sx('padding:10px 11px;background:var(--surface-2);border-top:1px solid var(--border);display:flex;flex-direction:column;gap:8px')}>
        <span style={sx('font-size:12px;color:var(--fg-soft)')}>{conflict.data?.updated_by || 'Another writer'} changed this document. Your edit is kept below.</span>
        <details><summary style={sx('cursor:pointer;font-size:11.5px')}>Compare the latest version</summary><div style={sx('max-height:240px;overflow:auto;padding-top:8px;font-size:12px')}><Markdown text={conflict.content} /></div></details>
        <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}><Btn size="sm" variant="secondary" disabled={saving} onClick={useLatest}>Use latest version</Btn>
          <Btn size="sm" variant="ghost" busy={saving} onClick={() => save(conflict)}>Save my edit over latest</Btn></div>
      </div> : null}
      <div style={sx('padding:8px 11px 12px;max-height:360px;overflow:auto;font-size:12px;line-height:1.6')}>
        <ArtifactBody value={editing ? body : doc.content} editing={editing} onChange={change} />
        {!doc.content && !editing ? <span style={sx('font-size:12px;color:var(--fg-muted)')}>This document is empty.</span> : null}
      </div>
    </> : null}
  </article>;
}

export function ArtifactList({ artifacts, ...props }) {
  const refs = normalizeArtifacts(artifacts);
  if (!refs.length) return null;
  return <div style={sx('display:flex;flex-direction:column;gap:8px;min-width:0')}>
    {refs.map(ref => <Artifact key={ref.path} artifact={ref} {...props} />)}
  </div>;
}
