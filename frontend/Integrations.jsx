import React from 'react';
import { api } from './api';
import { Btn, Card, Eyebrow, Field, Input, Chip } from './ui';
import { sx } from './sx';
import { Markdown } from './Markdown';

const PREPARATION_TERMINAL = ['done', 'failed', 'paused'];
const preparationState = wake => ({ pending: 'Waiting for a worker', running: 'Preparing', done: 'Ready for your review',
  retry: 'Waiting to retry', cooldown: 'Paused for provider cooldown', paused: 'Needs your attention', failed: 'Needs your instructions' }[wake?.state] || 'Waiting for a worker');

function Group({ title, children }) {
  return <section style={sx('display:flex;flex-direction:column;gap:12px;max-width:560px')}><h2 style={sx('font-size:15.5px;font-weight:500;margin:0')}>{title}</h2>{children}</section>;
}
export function IntegrationSettings({ onToast }) {
  const [paperclip, setPaperclip] = React.useState({ enabled: false, url: 'http://127.0.0.1:3100', companyId: '', agentId: '' });
  const [folder, setFolder] = React.useState(''), [unit, setUnit] = React.useState(''), [person, setPerson] = React.useState('');
  const [preview, setPreview] = React.useState(null), [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  const [workers, setWorkers] = React.useState({ workerSchedulerEnabled: false, workerMaxConcurrent: 2, workerOvernightEnabled: false });
  const [assistant, setAssistant] = React.useState(''), [universe, setUniverse] = React.useState('local'), [collections, setCollections] = React.useState('work');
  const [projects, setProjects] = React.useState(''), [capabilities, setCapabilities] = React.useState('research,writing');
  const [taskTitle, setTaskTitle] = React.useState('');
  const [taskInstructions, setTaskInstructions] = React.useState(''), [preparation, setPreparation] = React.useState(null);
  const [dest, setDest] = React.useState({ id: '', label: '', url: '', tokenEnv: '' });
  const [destinations, setDestinations] = React.useState([]);
  React.useEffect(() => {
    let live = true;
    api.integration('paperclip/config').then(data => { if (live) setPaperclip(data.config || data); }).catch(() => {});
    api.state().then(data => { if (live) {
      setFolder(data.settings?.hubFolder || '');
      setWorkers(previous => ({ ...previous, ...Object.fromEntries(Object.keys(previous).map(key => [key, data.settings?.[key] ?? previous[key]])) }));
      setDestinations(data.settings?.deliveryDestinations || []);
    } }).catch(() => {});
    return () => { live = false; };
  }, []);
  const act = async fn => {
    setBusy(true); setMessage('');
    try { const result = await fn(); if (typeof result === 'string') { setMessage(result); onToast?.(result); } }
    catch (error) { setMessage(error.message); onToast?.(error.message, 'danger'); }
    finally { setBusy(false); }
  };
  const importInput = { folder, unit, person };
  return <>
    <Group title="OpsGraph goals and commitments">
      <p style={sx('margin:0;font-size:12.5px;color:var(--fg-muted);line-height:1.6')}>Choose a universe from your mirror. Review what will enter Scout; existing local work keeps your edits.</p>
      <Field label="MIRROR FOLDER"><Input value={folder} onChange={event => { setFolder(event.target.value); setPreview(null); }} /></Field>
      <Field label="UNIVERSE"><Input placeholder="unit/otr" value={unit} onChange={event => { setUnit(event.target.value); setPreview(null); }} /></Field>
      <Field label="PERSON (OPTIONAL)"><Input placeholder="person/crystal" value={person} onChange={event => { setPerson(event.target.value); setPreview(null); }} /></Field>
      <div style={sx('display:flex;gap:8px')}><Btn size="sm" busy={busy} disabled={!folder || !unit} onClick={() => act(async () => { setPreview(await api.integration('opsgraph/preview', 'POST', importInput)); })}>Preview import</Btn>
        {preview ? <Btn size="sm" variant="primary" busy={busy} onClick={() => act(async () => { const result = await api.integration('opsgraph/import', 'POST', { ...importInput, previewHash: preview.hash }); setPreview(null); return 'Imported ' + result.created.length + '; kept ' + result.skipped.length + ' existing records.'; })}>Import reviewed items</Btn> : null}</div>
      {preview ? <Card style={sx('padding:12px;font-size:12px;max-height:220px;overflow:auto')}>{preview.items.length ? preview.items.map(item => <p key={item.id}>{item.existing ? 'Keep existing' : 'Import'} · {item.kind} · {item.label || item.title}</p>) : 'No matching goals or approved commitments.'}</Card> : null}
    </Group>
    <Group title="Paperclip handoffs">
      <p style={sx('margin:0;font-size:12.5px;color:var(--fg-muted);line-height:1.6')}>Delegate selected work to your Paperclip company. Preview and approve the handoff in Needs you, then send it from Today.</p>
      <Field label="PAPERCLIP URL"><Input value={paperclip.url || ''} onChange={event => setPaperclip({ ...paperclip, url: event.target.value })} /></Field>
      <Field label="COMPANY ID"><Input value={paperclip.companyId || ''} onChange={event => setPaperclip({ ...paperclip, companyId: event.target.value })} /></Field>
      <Field label="AGENT ID"><Input value={paperclip.agentId || ''} onChange={event => setPaperclip({ ...paperclip, agentId: event.target.value })} /></Field>
      <div style={sx('display:flex;gap:8px')}><Chip label="Off" on={!paperclip.enabled} onClick={() => setPaperclip({ ...paperclip, enabled: false })} /><Chip label="On" on={!!paperclip.enabled} onClick={() => setPaperclip({ ...paperclip, enabled: true })} />
        <Btn size="sm" busy={busy} onClick={() => act(async () => { await api.integration('paperclip/config', 'PUT', { enabled: paperclip.enabled, url: paperclip.url, companyId: paperclip.companyId, agentId: paperclip.agentId, actor: 'crystal' }); return 'Paperclip connection settings saved.'; })}>Save connection</Btn></div>
      <span style={sx('font-size:11px;color:var(--fg-muted)')}>For an authenticated server, configure PAPERCLIP_TOKEN on the backend.</span>
    </Group>
    <Group title="Worker routing and overnight preparation">
      <p style={sx('margin:0;font-size:12.5px;color:var(--fg-muted);line-height:1.6')}>Match task requirements to assistant capabilities. Scheduled workers require both routing and automatic schedules enabled.</p>
      <div style={sx('display:flex;gap:8px')}><Chip label="Routing off" on={!workers.workerSchedulerEnabled} onClick={() => setWorkers({ ...workers, workerSchedulerEnabled: false })} /><Chip label="Routing on" on={!!workers.workerSchedulerEnabled} onClick={() => setWorkers({ ...workers, workerSchedulerEnabled: true })} /></div>
      <Field label="MAXIMUM CONCURRENT WORKERS"><Input type="number" min="1" max="8" value={workers.workerMaxConcurrent} onChange={event => setWorkers({ ...workers, workerMaxConcurrent: Number(event.target.value) })} /></Field>
      <div style={sx('display:flex;gap:8px')}><Chip label="Overnight off" on={!workers.workerOvernightEnabled} onClick={() => setWorkers({ ...workers, workerOvernightEnabled: false })} /><Chip label="Overnight on" on={!!workers.workerOvernightEnabled} onClick={() => setWorkers({ ...workers, workerOvernightEnabled: true })} /></div>
      <Btn size="sm" busy={busy} onClick={() => act(async () => { await api.saveSettings(workers); return 'Worker routing settings saved.'; })}>Save worker settings</Btn>
    </Group>
    <Group title="Worker access">
      <p style={sx('margin:0;font-size:12.5px;color:var(--fg-muted);line-height:1.6')}>Limit an assistant to selected records. Restricted workers use text preparation; unrestricted filesystem runtimes cannot enforce this policy.</p>
      <Field label="ASSISTANT ID"><Input value={assistant} onChange={event => setAssistant(event.target.value)} /></Field>
      <Field label="UNIVERSE"><Input value={universe} onChange={event => setUniverse(event.target.value)} /></Field>
      <Field label="COLLECTIONS (COMMA SEPARATED)"><Input value={collections} onChange={event => setCollections(event.target.value)} /></Field>
      <Field label="PROJECT IDS (COMMA SEPARATED)"><Input value={projects} onChange={event => setProjects(event.target.value)} /></Field>
      <Btn size="sm" disabled={!assistant || !universe} busy={busy} onClick={() => act(async () => { const allowed = collections.split(',').map(value => value.trim()).filter(Boolean); await api.integration('worker-policies/' + encodeURIComponent(assistant), 'PUT', { actor: 'crystal', policy: { enabled: true, universes: [universe], projects: projects.split(',').map(value => value.trim()).filter(Boolean), collections: { read: allowed, write: allowed }, memory: { read: [], write: [] }, finance: false } }); return 'Restricted worker policy saved.'; })}>Save restricted policy</Btn>
      <Field label="CAPABILITIES (COMMA SEPARATED)"><Input value={capabilities} onChange={event => setCapabilities(event.target.value)} /></Field>
      <Btn size="sm" disabled={!assistant} busy={busy} onClick={() => act(async () => { await api.saveAssistant(assistant, { worker_enabled: true, worker_mode: 'prepare', capabilities: capabilities.split(',').map(value => value.trim()).filter(Boolean) }, 'crystal'); return 'Assistant enabled for bounded text preparation.'; })}>Enable preparation worker</Btn>
      <Field label="PREPARATION TASK"><Input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} /></Field>
      <Field label="TASK INSTRUCTIONS"><textarea aria-label="Task instructions" placeholder="What should the worker prepare? Include the audience, evidence and the output you need." value={taskInstructions} onChange={event => setTaskInstructions(event.target.value)} maxLength={12000} rows={4} style={sx('font:inherit;font-size:12px;padding:8px;resize:vertical;background:var(--surface);color:var(--fg);border:1px solid var(--border);border-radius:4px')} /></Field>
      <Btn size="sm" disabled={!assistant.trim() || !taskTitle.trim() || !projects.split(',')[0].trim()} busy={busy} onClick={() => act(async () => {
        const project = projects.split(',')[0].trim();
        const response = await api.saveTask({ id: 'prep-' + crypto.randomUUID(), project, title: taskTitle.trim(), body: taskInstructions,
          requires: capabilities.split(',').map(value => value.trim()).filter(Boolean), universe, actor: 'crystal' });
        const task = response.task || response;
        const result = await api.integration('workers/wake', 'POST', { key: 'manual:' + project + ':' + task.id, task: task.id, project, assistant: assistant.trim(), actor: 'crystal' });
        setPreparation({ task, wake: result.wake });
        return result.started ? 'Preparation started. Its material will appear below.' : preparationState(result.wake) + (result.reason ? ': ' + result.reason : '.');
      })}>Prepare this task now</Btn>
      {preparation ? <PreparationResult key={preparation.task.project + ':' + preparation.task.id} initialTask={preparation.task} initialWake={preparation.wake} /> : null}
    </Group>
    <Group title="Delivery destinations">
      <p style={sx('margin:0;font-size:12.5px;color:var(--fg-muted);line-height:1.6')}>Scout artifacts are ready locally. Add your own webhook destination for approved output; sending remains a separate action.</p>
      {destinations.map(destination => <span key={destination.id} style={sx('font-size:12px')}>{destination.label} · {destination.url}</span>)}
      <Field label="DESTINATION ID"><Input value={dest.id} onChange={event => setDest({ ...dest, id: event.target.value })} /></Field>
      <Field label="NAME"><Input value={dest.label} onChange={event => setDest({ ...dest, label: event.target.value })} /></Field>
      <Field label="WEBHOOK URL"><Input value={dest.url} onChange={event => setDest({ ...dest, url: event.target.value })} /></Field>
      <Field label="TOKEN ENVIRONMENT VARIABLE (OPTIONAL)"><Input value={dest.tokenEnv} onChange={event => setDest({ ...dest, tokenEnv: event.target.value })} /></Field>
      <Btn size="sm" busy={busy} disabled={!dest.id || !dest.url} onClick={() => act(async () => { const next = [...destinations.filter(row => row.id !== dest.id), { ...dest, kind: 'webhook' }]; await api.saveSettings({ deliveryDestinations: next }); setDestinations(next); setDest({ id: '', label: '', url: '', tokenEnv: '' }); return 'Delivery destination saved.'; })}>Save destination</Btn>
    </Group>
    {message ? <p role="status" style={sx('font-size:12px;color:var(--fg-soft)')}>{message}</p> : null}
  </>;
}

function PreparationResult({ initialTask, initialWake }) {
  const [task, setTask] = React.useState(initialTask), [wake, setWake] = React.useState(initialWake);
  const [error, setError] = React.useState(''), [copied, setCopied] = React.useState(false), [refresh, setRefresh] = React.useState(0), [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let live = true, timer;
    const load = async () => {
      setLoading(true);
      let nextWake;
      try {
        const [status, taskList] = await Promise.all([api.integration('workers'), api.tasks({ project: initialTask.project })]);
        if (!live) return;
        nextWake = (status.wakes || []).find(row => row.id === initialWake?.id);
        const nextTask = (taskList.tasks || []).find(row => row.id === initialTask.id);
        if (!nextWake || !nextTask) throw new Error('This preparation could not be found. Refresh after checking the selected workspace.');
        setWake(nextWake); setTask(nextTask); setError('');
      } catch (e) { if (live) setError(e.message); }
      finally { if (live) setLoading(false); }
      if (live && nextWake && !PREPARATION_TERMINAL.includes(nextWake.state)) timer = setTimeout(load, 3000);
    };
    load();
    return () => { live = false; clearTimeout(timer); };
  }, [initialTask.project, initialTask.id, initialWake?.id, refresh]);
  return <Card style={sx('padding:12px;display:flex;flex-direction:column;gap:8px')}>
    <Eyebrow>{task.title}</Eyebrow>
    <span role="status" style={sx('font-size:12px;color:var(--fg-soft)')}>{preparationState(wake)}</span>
    {wake?.reason ? <span style={sx('font-size:12px;color:var(--fg-muted)')}>{wake.reason}</span> : null}
    {task.prepared_text ? <>
      <div style={sx('font-size:12px;max-height:360px;overflow:auto')}><Markdown text={task.prepared_text} /></div>
      <span style={sx('font-size:11px;color:var(--fg-muted)')}>Prepared by {task.prepared_by || wake?.assistant || 'your worker'}{task.prep_model || task.prep_provider ? ' · ' + (task.prep_model || task.prep_provider) : ''}</span>
      <Btn size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(task.prepared_text); setCopied(true); } catch { setError('Copy is unavailable in this browser. Select the prepared text to copy it.'); } }}>{copied ? 'Copied' : 'Copy prepared text'}</Btn>
    </> : null}
    <Btn size="sm" variant="ghost" busy={loading} onClick={() => setRefresh(value => value + 1)}>Refresh preparation</Btn>
    {error ? <span role="alert" style={sx('font-size:12px;color:var(--danger)')}>{error}</span> : null}
  </Card>;
}

export function TodayExtras({ work, plannedWork, onGo, onOpenPath, onWrote, refreshKey }) {
  const [widgets, setWidgets] = React.useState([]), [deliveries, setDeliveries] = React.useState({ destinations: [], receipts: [] });
  const [paperclip, setPaperclip] = React.useState(null), [draft, setDraft] = React.useState(''), [destination, setDestination] = React.useState('local-artifact');
  const [busy, setBusy] = React.useState(false), [message, setMessage] = React.useState('');
  const paperclipWork = plannedWork || (work?.status === 'planned' ? work : null);
  const paperclipReceipts = Array.isArray(paperclip?.receipts) ? paperclip.receipts : Object.values(paperclip?.receipts || {});
  const delegated = paperclipReceipts.some(receipt => receipt.kind === 'issue' && receipt.workId === paperclipWork?.id && !['done', 'cancelled'].includes(receipt.state));
  const load = React.useCallback(async () => {
    const results = await Promise.allSettled([api.integration('widgets'), api.integration('deliveries'), api.integration('paperclip')]);
    if (results[0].status === 'fulfilled') setWidgets(results[0].value.widgets || []);
    if (results[1].status === 'fulfilled') setDeliveries(results[1].value);
    if (results[2].status === 'fulfilled') setPaperclip(results[2].value);
  }, []);
  React.useEffect(() => { load(); }, [load, refreshKey, work?.id, plannedWork?.id]);
  const act = async fn => { setBusy(true); setMessage(''); try { await fn(); onWrote?.(); await load(); } catch (error) { setMessage(error.message); } finally { setBusy(false); } };
  return <div style={sx('display:flex;flex-direction:column;gap:10px;max-height:320px;overflow:auto;flex:none')}>
    {widgets.map(widget => <Card key={widget.id} style={sx('padding:12px;display:flex;flex-direction:column;gap:8px')}><Eyebrow>{widget.title}</Eyebrow>{widget.rows.length ? widget.rows.map(row => <div key={row.id} style={sx('font-size:12px')}><Btn variant="ghost" size="sm" onClick={() => row.path && onOpenPath?.(row.path)}>{row.label}</Btn><span>{row.detail}</span></div>) : <span style={sx('font-size:12px;color:var(--fg-muted)')}>Nothing here yet.</span>}</Card>)}
    {work ? <Card style={sx('padding:12px;display:flex;flex-direction:column;gap:8px')}><Eyebrow>HANDOFF · {work.title}</Eyebrow>
      <select aria-label="Delivery destination" value={destination} onChange={event => setDestination(event.target.value)} style={sx('background:var(--surface);color:var(--fg);border:1px solid var(--border);padding:6px;border-radius:4px')}>{deliveries.destinations.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select>
      <textarea aria-label="Output to deliver" placeholder="Paste the output to review…" value={draft} onChange={event => setDraft(event.target.value)} style={sx('font:inherit;font-size:12px;padding:8px;resize:vertical;background:var(--surface);color:var(--fg);border:1px solid var(--border);border-radius:4px')} />
      <Btn size="sm" disabled={!draft.trim()} busy={busy} onClick={() => act(async () => { await api.integration('deliveries/preview', 'POST', { workId: work.id, destinationId: destination, message: draft, actor: 'crystal' }); onGo?.('decide'); })}>Review delivery</Btn>
    </Card> : null}
    {paperclipWork && (paperclip?.config?.enabled || paperclip?.enabled) ? <Card style={sx('padding:12px;display:flex;flex-direction:column;gap:8px')}>
      <Eyebrow>PAPERCLIP · {paperclipWork.title}</Eyebrow>
      {delegated ? <span style={sx('font-size:12px;color:var(--fg-muted)')}>This item is already delegated. Check its result below.</span> : <Btn size="sm" disabled={paperclipWork.status !== 'planned'} busy={busy} onClick={() => act(async () => { await api.integration('paperclip/preview', 'POST', { workId: paperclipWork.id, actor: 'crystal' }); onGo?.('decide'); })}>Review Paperclip handoff</Btn>}
    </Card> : null}
    {deliveries.receipts.slice(-3).map(receipt => <span key={receipt.id} style={sx('font-size:11px')}>{receipt.title}: {receipt.status}{receipt.result?.path ? <Btn variant="ghost" size="sm" onClick={() => onOpenPath?.(receipt.result.path)}>Open output</Btn> : null}</span>)}
    <Btn variant="ghost" size="sm" busy={busy} onClick={() => act(load)}>Refresh handoffs</Btn>
    <ApprovedDeliveries onGo={onGo} onOpenPath={onOpenPath} busy={busy} act={act} refreshKey={refreshKey} receipts={deliveries.receipts} paperclipReceipts={paperclipReceipts} />
    <PaperclipReceipts status={paperclip} busy={busy} act={act} />
    {message ? <span role="status" style={sx('font-size:12px;color:var(--danger)')}>{message}</span> : null}
  </div>;
}
function ApprovedDeliveries({ onOpenPath, busy, act, refreshKey, receipts, paperclipReceipts }) {
  const [cards, setCards] = React.useState([]);
  React.useEffect(() => { let live = true; api.proposals('accepted').then(result => { if (live) setCards((result.proposals || []).filter(card => card.delivery_hash || card.bridge_hash)); }).catch(() => {}); return () => { live = false; }; }, [refreshKey]);
  return cards.filter(card => !receipts.some(receipt => receipt.proposalId === card.id && receipt.status === 'delivered') &&
    !(card.bridge_hash && paperclipReceipts.some(receipt => receipt.kind === 'issue' && receipt.remoteId &&
      (receipt.proposalId === card.id || receipt.workId === card.bridge_work)))).slice(-4).map(card => <Card key={card.id} style={sx('padding:10px;display:flex;gap:6px;flex-direction:column;font-size:12px')}><span>{card.title} · approved</span><Btn size="sm" busy={busy} onClick={() => act(async () => { const receipt = card.bridge_hash ? await api.integration('paperclip/push', 'POST', { proposalId: card.id, workId: card.bridge_work, actor: 'crystal' }) : await api.integration('deliveries/execute', 'POST', { proposalId: card.id }); if (receipt.result?.path) onOpenPath?.(receipt.result.path); })}>{card.bridge_hash ? 'Send approved Paperclip handoff' : 'Deliver approved output'}</Btn></Card>);
}
function PaperclipReceipts({ status, busy, act }) {
  const receipts = Array.isArray(status?.receipts) ? status.receipts : Object.values(status?.receipts || {});
  return receipts.filter(receipt => receipt.kind === 'issue').slice(-4).map(receipt => <Card key={receipt.key} style={sx('padding:10px;display:flex;flex-direction:column;gap:6px;font-size:12px')}><span>{receipt.title || receipt.workId || receipt.work_id} · {receipt.status}</span>
    <Btn size="sm" busy={busy} onClick={() => act(() => api.integration('paperclip/' + encodeURIComponent(receipt.workId || receipt.work_id) + '/pull', 'POST', { actor: 'crystal' }))}>Check Paperclip result</Btn>
    {!['done', 'cancelled'].includes(receipt.state) ? <Btn size="sm" busy={busy} onClick={() => act(() => api.integration('paperclip/' + encodeURIComponent(receipt.workId || receipt.work_id) + '/cancel', 'POST', { actor: 'crystal', reason: 'Operator cancelled the delegation from Today' }))}>Cancel handoff</Btn> : null}
  </Card>);
}
