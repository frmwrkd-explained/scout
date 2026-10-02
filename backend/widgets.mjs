import path from 'node:path';
import { getStorageRoot, readMd, writeMd } from './store.mjs';
import { isAgentActor } from './actors.mjs';
import { listGoals, getGoal } from './memory.mjs';
import { documentsFor } from './documents.mjs';
import { localDay } from './daytime.mjs';
import { propose } from './proposals.mjs';
import { deliveryStatus } from './delivery.mjs';
import { logEvent } from './log.mjs';
import { WIDGET_CATALOG, validateWidget } from '../shared/widgetCatalog.mjs';
import { currentWorkerIdentity } from './workerScope.mjs';

const file = () => path.join(getStorageRoot(), '.scout', 'widgets.md');
export function widgetLayout() { try { return (readMd(file()).data.widgets || []).map(validateWidget); } catch { return []; } }
export function saveWidgetLayout(widgets, { actor = 'crystal' } = {}) {
  if (currentWorkerIdentity() || isAgentActor(actor)) throw Object.assign(new Error('Agents propose layout changes in Needs you.'), { status: 403 });
  if (!Array.isArray(widgets) || widgets.length > 6) throw new Error('A layout has at most six widgets.');
  const layout = widgets.map(validateWidget);
  if (new Set(layout.map(widget => widget.id)).size !== layout.length) throw new Error('Widget IDs must be unique.');
  for (const widget of layout) if (widget.goal_id && !getGoal(widget.goal_id)) throw new Error('Unknown widget goal.');
  writeMd(file(), { widgets: layout }, 'Approved Today layout. Widgets are catalog data, never executable code.\n');
  logEvent({ type: 'update', actor, target: '.scout/widgets.md', detail: { widgets: layout.map(widget => widget.id) } });
  return layout;
}
export function proposeWidget(widget, { actor = 'conductor', why, evidence = [] } = {}) {
  const validated = validateWidget(widget);
  if (!evidence.length) throw new Error('A widget suggestion needs observed evidence.');
  return propose({ id: 'widget-' + validated.id + '-' + Date.now().toString(36), kind: 'widget', widget: validated,
    title: 'Add: ' + validated.title, why: why || 'Keep this useful information visible in Today.', evidence }, { actor });
}
export function approveWidget(widget, { actor = 'crystal' } = {}) {
  const validated = validateWidget(widget);
  return saveWidgetLayout([...widgetLayout().filter(row => row.id !== validated.id), validated], { actor });
}
export function widgetData() {
  const goals = listGoals(), work = documentsFor('work')?.documents || [];
  return { catalog: WIDGET_CATALOG, widgets: widgetLayout().map(widget => ({ ...widget,
    rows: widget.type === 'goal_progress' ? goals.filter(goal => !widget.goal_id || goal.id === widget.goal_id).slice(0, 8).map(goal => ({ id: goal.id, label: goal.label, detail: goal.current + ' / ' + goal.target + ' ' + goal.unit, path: 'goals/' + goal.id + '.md' }))
      : widget.type === 'waiting_work' ? work.filter(row => row.fields.status !== 'done' && row.fields.not_before && String(row.fields.not_before instanceof Date ? row.fields.not_before.toISOString().slice(0,10) : row.fields.not_before) > localDay()).slice(0, 8).map(row => ({ id: row.slug, label: row.fields.title || row.slug, detail: 'Due ' + (row.fields.not_before instanceof Date ? row.fields.not_before.toISOString().slice(0,10) : row.fields.not_before), path: row.path }))
      : deliveryStatus().receipts.slice(-8).map(receipt => ({ id: receipt.id, label: receipt.title, detail: receipt.status, path: receipt.result?.path || null })),
  })) };
}
export function registerWidgetRoutes(app) {
  const route = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { res.status(error.status || 400).json({ error: error.message }); } };
  app.get('/api/widgets', route(() => widgetData()));
  app.put('/api/widgets', route(req => ({ widgets: saveWidgetLayout(req.body?.widgets, { actor: req.body?.actor || 'crystal' }) })));
  app.post('/api/widgets/propose', route(req => proposeWidget(req.body?.widget, req.body || {})));
}
