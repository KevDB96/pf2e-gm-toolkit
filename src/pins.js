// Stable, local session pins. Targets deliberately carry record IDs, never names: names
// repeat in the reference data and campaign notes can be renamed after being pinned.

export function samePinTarget(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'reference') return a.category === b.category && a.id === b.id;
  return a.type === 'note' && a.id === b.id;
}

export function hasPin(pins, target) {
  return pins.some(pin => samePinTarget(pin.target, target));
}

export function addPin(pins, pin) {
  return hasPin(pins, pin.target) ? pins : [...pins, pin];
}

export function removePin(pins, id) {
  return pins.filter(pin => pin.id !== id);
}

export function movePin(pins, id, direction) {
  const from = pins.findIndex(pin => pin.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= pins.length) return pins;
  const next = [...pins];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
