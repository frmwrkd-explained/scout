// The owner sees the real goal loop, named team and persisted work in one place.
// Configuration and approvals keep using their existing canonical screens.
import React from 'react';
import { api } from './api';
import { sx } from './sx';
import { Btn, Card, Empty, Eyebrow, Input } from './ui';
import { Dot, StateWord, stateOf, taskTitle, lastRun, firstPara, FIGURE } from './Assistants';
import { Markdown } from './Markdown';

const list = (v, key) => Array.isArray(v) ? v : Array.isArray(v?.[key]) ? v[key] : [];
const names = values => (values || []).join(', ');
const label = value => value?.label || value?.name || value?.title || value?.id || '';
const STATES = {
  thinking: ['Reviewing the goal', 'var(--marked)'], working: ['Team working', 'var(--marked)'],
  waiting: ['Waiting for the next useful step', 'var(--ok)'], paused: ['Paused', 'var(--warn)'],
  cooldown: ['Waiting to retry', 'var(--warn)'], ended: ['Goal closed', 'var(--fg-muted)'],
  idle: ['Ready to start', 'var(--fg-muted)'], disabled: ['Team is off', 'var(--fg-muted)'],
};
const selectStyle = sx('background:var(--ink);color:var(--fg);border:1px solid var(--border-2);border-radius:8px;padding:9px 11px;font:inherit;font-size:12px;width:100%;min-width:0');

function time(value) {
  if (!value || !Number.isFinite(Date.parse(String(value)))) return null;
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function modelName(value) {
  return ({ 'gpt-6-luna': 'GPT-6 Luna', 'gpt-6.1-sol': 'GPT-6.1 Sol', 'gpt-6-sol': 'GPT-6 Sol' })[value] || value;
}
function conductorState(team) {
  const state = team ? (!team.enabled && team.state !== 'ended' ? 'disabled' : team.state) : 'idle';
  return STATES[state] || [String(state || 'Ready to start'), 'var(--fg-muted)'];
}

// Today receives the same server status. This compact view owns no second polling loop.
export function TeamPulse({ team, onAdmin }) {
  const [stateLabel, tone] = conductorState(team);
  const agents = [...(team?.coordinator ? [{ id: team.coordinator, name: team.coordinator_name || 'Conductor', status: team.state === 'thinking' ? 'running' : 'idle' }] : []), ...list(team, 'agents')];
  return (
    <Card tone={tone} label="Your team" right={<Btn size="sm" onClick={onAdmin}>Team / Admin</Btn>} style={sx('padding:14px 16px')}>
      <div style={sx('display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px')}>
        <strong>{team?.goal_label || team?.goal?.label || (team?.goal_id ? String(team.goal_id).replace(/[-_]/g, ' ') : 'Choose a goal in Admin')}</strong>
        <span style={{ color: tone }}>{team ? stateLabel : 'Status unavailable'}</span>
      </div>
      {team?.summary ? <div style={sx('font-size:12px;line-height:1.6;color:var(--fg-muted);margin-top:6px')}>{team.summary}</div> : null}
      {agents.length ? <div style={sx('display:flex;gap:12px;flex-wrap:wrap;margin-top:10px')}>{agents.slice(0, 5).map(agent => <span key={agent.id} style={sx('display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-muted)')}>
        <Dot tone={stateOf(agent) === 'running' ? 'var(--marked)' : stateOf(agent) === 'blocked' ? 'var(--warn)' : 'var(--ok)'} />
        {agent.name || agent.id}{stateOf(agent) === 'running' ? ' · working' : ''}
      </span>)}</div> : team ? <div style={sx('font-size:11px;color:var(--fg-faint);margin-top:8px')}>No goal team has been set up yet.</div> : null}
    </Card>
  );
}
function scopeLabel(policy, assistant, projects) {
  if (!policy) return assistant.role === 'conductor' ? 'Selected goal and team outputs' : 'Scope not configured';
  const projectNames = (policy.projects || []).map(id => label(projects.find(p => p.id === id)) || id);
  const collections = names(policy.collections?.read);
  return [names(projectNames) || 'No project access', collections ? collections + ' records' : 'No collection access', policy.finance ? 'Finance access' : 'Finance excluded'].join(' · ');
}

function AgentCard({ assistant, live, conductor, tasks, runs, policy, projects, onGo, onOpenPath }) {
  const coordinator = assistant.role === 'conductor' && assistant.project === conductor?.project && assistant.goal_id === conductor?.goal_id;
  const actual = live ? { ...assistant, ...live } : assistant;
  const state = coordinator ? (conductor?.state === 'thinking' ? 'running' : 'idle') : stateOf(actual);
  const mine = tasks.filter(t => String(t.assigned || t.assistant || '') === assistant.id);
  const active = mine.find(t => t.status === 'claimed');
  const latest = lastRun(runs, assistant.id);
  const prepared = mine.filter(t => t.prepared_text).sort((a, b) => String(b.prepared_at || '').localeCompare(String(a.prepared_at || '')))[0];
  const doing = coordinator ? conductor.summary : live?.doing || assistant.doing || (active ? taskTitle(active) : state === 'blocked' ? assistant.question || 'Waiting for an owner decision.' : 'Ready for the next brief.');
  const model = latest?.model || prepared?.prep_model || assistant.model;
  const provider = latest?.provider || prepared?.prep_provider || assistant.provider;
  return (
    <Card style={sx('padding:18px;display:flex;flex-direction:column;gap:12px;min-width:0')}>
      <div style={sx('display:flex;align-items:center;gap:9px')}>
        <Dot tone={state === 'running' ? 'var(--marked)' : state === 'blocked' ? 'var(--warn)' : 'var(--ok)'} glow={state === 'running'} />
        <strong style={sx('font-size:15px;min-width:0;flex:1')}>{assistant.name || assistant.id}</strong>
        <StateWord state={state} />
      </div>
      <div style={sx('font-size:12px;line-height:1.6;color:var(--fg-muted)')}>{assistant.job || firstPara(assistant.body) || 'No job brief yet.'}</div>
      <div style={sx('font-size:12.5px;line-height:1.55;color:var(--fg)')}>{doing || 'Ready for the next brief.'}</div>
      <div style={sx('font-size:11px;line-height:1.6;color:var(--fg-faint)')}>
        <div>{model ? modelName(model) : provider || 'Provider not selected'}{assistant.worker_mode === 'prepare' ? ' · prepares drafts' : coordinator ? ' · coordinates the team' : ''}</div>
        <div>{scopeLabel(policy, assistant, projects)}</div>
      </div>
      {prepared ? <div style={sx('font-size:11px;color:var(--ok)')}>Prepared: {taskTitle(prepared)}</div> : latest?.summary ? <div style={sx('font-size:11px;color:var(--fg-muted)')}>Last run: {latest.summary}</div> : null}
      <div style={sx('display:flex;gap:7px;flex-wrap:wrap;margin-top:auto')}>
        {assistant.path ? <Btn size="sm" onClick={() => onOpenPath(assistant.path)}>Open brief</Btn> : null}
        <Btn size="sm" onClick={() => onGo('hire', assistant)}>Edit job</Btn>
        {prepared?.path ? <Btn size="sm" onClick={() => onOpenPath(prepared.path)}>Open result</Btn> : null}
      </div>
    </Card>
  );
}

export default function Admin({ actor = 'crystal', project: selectedProject, refreshKey, onGo, onOpenPath, onWrote, onOpenProject }) {
  const [data, setData] = React.useState({ conductor: null, assistants: [], tasks: [], runs: [], goals: [], projects: [], policies: [], workers: null, paperclip: null });
  const [errors, setErrors] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [goal, setGoal] = React.useState('');
  const [project, setProject] = React.useState(selectedProject || '');
  const [newProject, setNewProject] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const mounted = React.useRef(false);
  const sequence = React.useRef(0);
  const load = React.useCallback(async () => {
    const turn = ++sequence.current;
    const requests = [
      ['conductor', api.conductor()], ['assistants', api.assistants()], ['tasks', api.tasks()],
      ['runs', api.runs()], ['goals', api.goals()], ['projects', api.scoutProjects()],
      ['policies', api.integration('worker-policies')], ['workers', api.integration('workers')], ['paperclip', api.integration('paperclip')],
    ];
    const results = await Promise.allSettled(requests.map(([, request]) => request));
    if (!mounted.current || turn !== sequence.current) return;
    const updates = {}, failures = [];
    results.forEach((result, i) => {
      const key = requests[i][0];
      if (result.status === 'rejected') failures.push(key + ': ' + (result.reason?.message || 'could not load'));
      else updates[key] = ['conductor', 'workers', 'paperclip'].includes(key) ? result.value : list(result.value, key);
    });
    setData(previous => ({ ...previous, ...updates }));
    setErrors(failures);
    setLoading(false);
  }, []);
  React.useEffect(() => {
    mounted.current = true;
    let cancelled = false, timer;
    const poll = async () => {
      await load();
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 15000 : 5000);
    };
    poll();
    return () => { cancelled = true; mounted.current = false; clearTimeout(timer); sequence.current++; };
  }, [load, refreshKey]);
  React.useEffect(() => {
    if (!data.conductor) return;
    setGoal(previous => previous || data.conductor.goal_id || '');
    setProject(previous => previous || data.conductor.project || selectedProject || '');
  }, [data.conductor, selectedProject]);

  const act = async (kind, action) => {
    setBusy(kind); setActionError(''); setNotice('');
    try {
      await action();
      if (!mounted.current) return;
      await load();
      onWrote?.();
    } catch (error) {
      if (mounted.current) setActionError(error.message || 'Could not update the team.');
    } finally { if (mounted.current) setBusy(''); }
  };
  const conductor = data.conductor;
  const contextReady = data.goals.some(g => g.id === goal) && data.projects.some(p => p.id === project);
  const teamIds = new Set((conductor?.agents || []).map(a => a.id));
  const team = data.assistants.filter(a => teamIds.has(a.id) || (a.role === 'conductor' && a.project === conductor?.project && a.goal_id === conductor?.goal_id));
  const other = data.assistants.filter(a => !team.some(member => member.id === a.id));
  const hasTeam = teamIds.size > 0;
  const paused = conductor?.state === 'paused';
  const running = conductor?.state === 'thinking' || conductor?.state === 'working';
  const [stateLabel, stateTone] = conductorState(conductor);
  const activeGoal = data.goals.find(g => g.id === conductor?.goal_id);
  const activeProject = data.projects.find(p => p.id === conductor?.project);
  const prepared = data.tasks.filter(t => t.prepared_text && (!conductor?.project || t.project === conductor.project))
    .sort((a, b) => String(b.prepared_at || '').localeCompare(String(a.prepared_at || '')));
  const outputs = list(conductor?.recent_outputs).slice(0, 6);
  const start = () => act('start', async () => {
    await api.configureConductor({ enabled: true, goal_id: goal, project, actor });
    if (paused) await api.resumeConductor({ actor });
    await api.wakeConductor({ actor });
  });
  const setup = () => act('setup', async () => {
    await api.setupTeam({ goal_id: goal, project, actor });
    await api.wakeConductor({ actor });
    if (mounted.current) setNotice('Team saved. Its current work appears below.');
  });
  const agentCard = assistant => <AgentCard key={assistant.id} assistant={assistant}
    live={conductor?.agents?.find(a => a.id === assistant.id)} conductor={conductor} tasks={data.tasks} runs={data.runs}
    policy={data.policies.find(p => p.assistantId === assistant.id)} projects={data.projects} onGo={onGo} onOpenPath={onOpenPath} />;

  return (
    <main style={sx('flex:1;min-width:0;overflow-y:auto;padding:28px 32px 48px')}>
      <div style={sx('max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:24px')}>
        <header style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap')}>
          <div><h1 style={sx('margin:0 0 7px;font-size:26px;font-weight:650')}>Admin</h1>
            <div style={sx('font-size:13px;color:var(--fg-muted)')}>Your goal, your team, and the work they are producing.</div></div>
          <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
            <Btn onClick={() => onGo('decide')}>Needs you</Btn>
            {Array.isArray(conductor?.needs_you) && conductor.needs_you.length ? <Btn onClick={() => onGo('today')}>Review next · {conductor.needs_you.length}</Btn> : null}
            <Btn onClick={() => onGo('settings')}>Configuration</Btn>
          </div>
        </header>
        {errors.length ? <Card tone="warn" label="Some state could not load"><div role="alert" style={sx('font-size:12px;color:var(--warn);line-height:1.6')}>{errors.join(' · ')}</div></Card> : null}
        {actionError ? <div role="alert" style={sx('font-size:12px;color:var(--danger)')}>{actionError}</div> : null}
        {notice ? <div role="status" style={sx('font-size:12px;color:var(--ok)')}>{notice}</div> : null}
        <Card tone={stateTone} label="Goal conductor" right={<span style={sx('font-size:12px;color:var(--fg-muted)')}>{loading ? 'Loading…' : stateLabel}</span>} style={sx('padding:22px')}>
          <h2 style={sx('font-size:19px;margin:4px 0 9px;font-weight:600')}>{activeGoal ? label(activeGoal) : 'Choose the goal your team should move forward'}</h2>
          {activeGoal && activeGoal.current != null && activeGoal.target != null ? <div style={{ ...sx('font-size:12px;color:var(--fg-muted);margin-bottom:10px'), ...FIGURE }}>{activeGoal.current} / {activeGoal.target}{activeGoal.unit ? ' ' + activeGoal.unit : ''}{activeProject ? ' · ' + label(activeProject) : ''}</div> : null}
          <div style={sx('font-size:13px;color:var(--fg-muted);line-height:1.65;margin-bottom:18px')}>{conductor?.summary || 'The conductor briefs specialists, reviews their actual work, and asks for decisions that need you. It keeps checking for useful work while Scout is open.'}</div>
          <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:13px;margin-bottom:15px')}>
            <label style={sx('display:flex;flex-direction:column;gap:6px')}><Eyebrow>Goal</Eyebrow>
              <select aria-label="Team goal" value={goal} onChange={e => setGoal(e.target.value)} disabled={!!busy || loading} style={selectStyle}>
                <option value="">Select a goal</option>{data.goals.map(g => <option key={g.id} value={g.id}>{label(g)}</option>)}
              </select></label>
            <label style={sx('display:flex;flex-direction:column;gap:6px')}><Eyebrow>Project</Eyebrow>
              <select aria-label="Team project" value={project} onChange={e => setProject(e.target.value)} disabled={!!busy || loading} style={selectStyle}>
                <option value="">Select a project</option>{data.projects.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}
              </select></label>
          </div>
          {!loading && (!data.goals.length || !data.projects.length) ? <div style={sx('font-size:12px;color:var(--fg-muted);margin-bottom:14px')}>
            {!data.goals.length ? <Btn size="sm" onClick={() => onGo('goals')}>Create a goal</Btn> : null}
            {!data.projects.length ? <form style={sx('display:flex;gap:8px;flex-wrap:wrap;margin-top:10px')} onSubmit={e => { e.preventDefault(); act('project', async () => { const created = await api.createProject(newProject.trim()); if (mounted.current) { setProject(created.id); setNewProject(''); } }); }}>
              <Input aria-label="New project name" placeholder="Project name" value={newProject} onChange={e => setNewProject(e.target.value)} disabled={!!busy} />
              <Btn type="submit" size="sm" busy={busy === 'project'} disabled={!newProject.trim() || !!busy}>Create project</Btn>
            </form> : null}
          </div> : null}
          <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
            {!hasTeam ? <Btn variant="primary" busy={busy === 'setup'} disabled={!contextReady || !!busy || loading} onClick={setup}>Set up team</Btn>
              : paused ? <Btn variant="primary" busy={busy === 'resume'} disabled={!!busy} onClick={() => act('resume', async () => { await api.resumeConductor({ actor }); await api.wakeConductor({ actor }); })}>Resume team</Btn>
              : running || conductor?.enabled ? <Btn variant="secondary" busy={busy === 'wake'} disabled={!!busy || running} onClick={() => act('wake', () => api.wakeConductor({ actor }))}>Check next step</Btn>
              : <Btn variant="primary" busy={busy === 'start'} disabled={!contextReady || !!busy} onClick={start}>Start team</Btn>}
            {hasTeam && conductor?.enabled && !paused ? <Btn busy={busy === 'pause'} disabled={!!busy} onClick={() => act('pause', () => api.pauseConductor({ actor }))}>Pause team</Btn> : null}
            {hasTeam && (goal !== conductor?.goal_id || project !== conductor?.project) ? <Btn variant="secondary" disabled={!contextReady || !!busy || running} busy={busy === 'setup'} onClick={setup}>Set up for this goal</Btn> : null}
            {activeGoal?.path ? <Btn onClick={() => onOpenPath(activeGoal.path)}>Open goal</Btn> : null}
            {activeProject ? <Btn onClick={() => onOpenProject(activeProject.id)}>Open project</Btn> : null}
            {conductor?.next_wake ? <span style={sx('font-size:11px;color:var(--fg-faint)')}>Next check {time(conductor.next_wake)}</span> : null}
          </div>
        </Card>
        <section aria-labelledby="admin-team-heading">
          <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:12px')}><h2 id="admin-team-heading" style={sx('margin:0;font-size:17px;font-weight:600')}>Team</h2><Btn size="sm" onClick={() => onGo('assistants')}>All assistants</Btn></div>
          {team.length ? <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:13px')}>{team.map(agentCard)}</div>
            : <Empty title={loading ? 'Loading team' : 'No goal team set up yet'} body="Choose a goal and project, then Set up team to create the conductor, researcher, writer, reviewer and analyst." />}
          {other.length ? <details style={sx('margin-top:15px')}><summary style={sx('font-size:12px;color:var(--fg-muted);cursor:pointer')}>Other assistants · {other.length}</summary><div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:13px;margin-top:12px')}>{other.map(agentCard)}</div></details> : null}
        </section>
        <section aria-labelledby="admin-results-heading">
          <h2 id="admin-results-heading" style={sx('margin:0 0 12px;font-size:17px;font-weight:600')}>Recent results</h2>
          {outputs.length ? <div style={sx('display:flex;flex-direction:column;gap:9px')}>{outputs.map((output, i) => <Card key={output.id || output.path || i} style={sx('padding:15px;display:flex;gap:15px;align-items:center;flex-wrap:wrap')}>
            <div style={sx('flex:1;min-width:150px')}><strong style={sx('font-size:13px')}>{output.title || 'Team output'}</strong><div style={sx('font-size:11px;color:var(--fg-muted);margin-top:5px')}>{data.assistants.find(a => a.id === output.worker)?.name || output.worker || ''}</div></div>
            {output.path ? <Btn size="sm" onClick={() => onOpenPath(output.path)}>Open output</Btn> : null}
          </Card>)}</div> : prepared.length ? <div style={sx('display:flex;flex-direction:column;gap:10px')}>{prepared.slice(0, 4).map(task => <Card key={task.project + '/' + task.id} style={sx('padding:16px')}>
            <div style={sx('display:flex;align-items:center;gap:12px;flex-wrap:wrap')}><strong style={sx('font-size:13px;flex:1')}>{taskTitle(task)}</strong>{task.path ? <Btn size="sm" onClick={() => onOpenPath(task.path)}>Open output</Btn> : null}</div>
            <details style={sx('margin-top:9px')}><summary style={sx('font-size:11px;color:var(--fg-muted);cursor:pointer')}>Read prepared material</summary><Markdown text={task.prepared_text} style={sx('font-size:12px;line-height:1.65;margin-top:12px')} /></details>
          </Card>)}</div> : <Empty title="No team outputs yet" body="Saved drafts and reviews appear here after an actual worker run finishes." />}
        </section>
        {list(conductor?.tasks).length ? <section aria-labelledby="admin-work-heading"><h2 id="admin-work-heading" style={sx('margin:0 0 12px;font-size:17px;font-weight:600')}>Current work</h2><Card style={sx('padding:4px 16px')}>
          {conductor.tasks.slice(0, 10).map(task => <div key={task.id} style={sx('padding:12px 0;border-bottom:1px solid var(--border-2);display:flex;gap:12px;align-items:center')}>
            <div style={sx('flex:1;min-width:0')}><div style={sx('font-size:12px')}>{task.title || task.id}</div><div style={sx('font-size:11px;color:var(--fg-muted);margin-top:4px')}>{data.assistants.find(a => a.id === task.assistant)?.name || task.assistant || 'Awaiting assignment'}{task.depends_on?.length ? ' · depends on earlier work' : ''}</div></div>
            <span style={sx('font-size:11px;color:var(--fg-muted)')}>{task.status}</span>
            {task.output_path ? <Btn size="sm" onClick={() => onOpenPath(task.output_path)}>Open result</Btn> : null}
          </div>)}
        </Card></section> : null}
        {data.workers ? <div style={sx('font-size:11px;color:var(--fg-faint);display:flex;gap:15px;flex-wrap:wrap')}>
          <span>Worker queue: {data.workers.config?.enabled ? 'scheduled wakes on' : 'scheduled wakes off'}</span>
          <span>{list(data.workers, 'wakes').filter(w => w.state === 'running').length} active worker runs</span>
        </div> : null}
        <Card label="Paperclip" tone={data.paperclip?.config?.ready ? 'ok' : 'muted'} right={<Btn size="sm" onClick={() => onGo('paperclip')}>Open board</Btn>} style={sx('padding:18px')}>
          <div style={sx('font-size:13px;line-height:1.65')}>{!data.paperclip ? 'Connection status is unavailable.' : !data.paperclip.config?.enabled ? 'Paperclip is off.' : data.paperclip.config?.ready ? 'Paperclip is configured. Outbound work still needs your approval in Needs you.' : 'Paperclip needs a backend credential before it can receive work.'}</div>
          {data.paperclip?.config?.error ? <div style={sx('font-size:12px;color:var(--warn);margin-top:7px')}>{data.paperclip.config.error}</div> : null}
          {list(data.paperclip, 'receipts').filter(r => r.kind === 'issue').slice(-5).reverse().map(receipt => <div key={receipt.key || receipt.id} style={sx('display:flex;align-items:center;gap:12px;margin-top:11px;font-size:12px')}>
            <span style={sx('flex:1')}>{receipt.title || 'Delegated work'}</span><span style={sx('color:var(--fg-muted)')}>{receipt.state}</span>
            {receipt.workPath ? <Btn size="sm" onClick={() => onOpenPath(receipt.workPath)}>Open work</Btn> : null}
          </div>)}
        </Card>
      </div>
    </main>
  );
}
