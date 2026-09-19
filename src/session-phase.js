// Shared GM control for the public session phase.

export const SESSION_PHASES = Object.freeze(['downtime', 'exploration', 'combat']);

const LABELS = Object.freeze({
  downtime: 'Downtime',
  exploration: 'Exploration',
  combat: 'Combat'
});

export function phaseLabel(phase) {
  return LABELS[phase] || LABELS.downtime;
}

export function phaseControlMarkup(current) {
  const selected = SESSION_PHASES.includes(current) ? current : SESSION_PHASES[0];
  return SESSION_PHASES.map(phase => `
    <button type="button" class="session-phase-button${phase === selected ? ' on' : ''}"
      data-session-phase="${phase}" aria-pressed="${phase === selected}">${phaseLabel(phase)}</button>`).join('');
}
