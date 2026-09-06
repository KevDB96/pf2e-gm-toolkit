// Pure exploration-clock state transitions. Fictional time advances only when the GM
// calls advance(); it deliberately has no relationship to wall-clock time.
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const DEFAULT_EXPLORATION = { elapsedMinutes: 0, activities: {}, timers: [] };

export function normalizeExploration(saved) {
  const source = object(saved) ? saved : {};
  const elapsedMinutes = Number.isFinite(source.elapsedMinutes) && source.elapsedMinutes >= 0 ? Math.floor(source.elapsedMinutes) : 0;
  const activities = object(source.activities) ? Object.fromEntries(Object.entries(source.activities)
    .filter(([id, value]) => typeof id === 'string' && object(value) && typeof value.label === 'string')
    .map(([id, value]) => [id, { label: value.label, startedAtMinute: Number.isFinite(value.startedAtMinute) ? Math.max(0, Math.floor(value.startedAtMinute)) : 0 }])) : {};
  const timers = Array.isArray(source.timers) ? source.timers.flatMap(timer => {
    if (!object(timer) || typeof timer.id !== 'string' || typeof timer.label !== 'string') return [];
    const started = Number.isFinite(timer.startedAtMinute) ? Math.max(0, Math.floor(timer.startedAtMinute)) : 0;
    const due = Number.isFinite(timer.dueAtMinute) ? Math.max(started, Math.floor(timer.dueAtMinute)) : started;
    const status = ['active', 'due', 'acknowledged'].includes(timer.status) ? timer.status : 'active';
    return [{ id: timer.id, label: timer.label, startedAtMinute: started, dueAtMinute: due,
      targetId: typeof timer.targetId === 'string' ? timer.targetId : null,
      source: typeof timer.source === 'string' ? timer.source : null, status }];
  }) : [];
  return { elapsedMinutes, activities, timers };
}

export function advanceExploration(exploration, minutes) {
  const next = normalizeExploration(exploration);
  const amount = Number.isFinite(minutes) ? Math.floor(minutes) : 0;
  if (amount <= 0) return { exploration: next, matured: [] };
  next.elapsedMinutes += amount;
  const matured = [];
  next.timers = next.timers.map(timer => {
    if (timer.status !== 'active' || timer.dueAtMinute > next.elapsedMinutes) return timer;
    matured.push(timer.id);
    return { ...timer, status: 'due' };
  });
  return { exploration: next, matured };
}

export function formatElapsed(minutes) {
  const safe = Math.max(0, Math.floor(Number(minutes) || 0));
  const days = Math.floor(safe / 1440), hours = Math.floor((safe % 1440) / 60), mins = safe % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', mins || (!days && !hours) ? `${mins}m` : ''].filter(Boolean).join(' ');
}
