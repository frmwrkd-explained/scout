export const WIDGET_CATALOG = [
  { type: 'goal_progress', label: 'Goal progress' },
  { type: 'waiting_work', label: 'Waiting follow-ups' },
  { type: 'delivery_status', label: 'Delivery receipts' },
];
export function validateWidget(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A widget must be an object.');
  if (Object.keys(input).some(key => !['id', 'type', 'title', 'goal_id'].includes(key))) throw new Error('Widgets accept catalog fields only; executable content is not allowed.');
  if (!WIDGET_CATALOG.some(row => row.type === input.type)) throw new Error('Choose a widget from the catalog.');
  const id = String(input.id || input.type);
  if (!/^[a-z][a-z0-9_-]{0,60}$/.test(id)) throw new Error('Invalid widget ID.');
  const title = String(input.title || WIDGET_CATALOG.find(row => row.type === input.type).label).trim();
  if (!title || title.length > 100) throw new Error('Widget title must be 1–100 characters.');
  return { id, type: input.type, title, ...(input.goal_id ? { goal_id: String(input.goal_id) } : {}) };
}
