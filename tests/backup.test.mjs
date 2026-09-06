import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_FORMAT, BACKUP_SCHEMA, MAX_BACKUP_BYTES, makeBackup, readBackup } from '../src/backup.js';

function backupState() {
  return {
    party: { level: 7, size: 4, members: [] },
    encounter: { entries: [{ id: 'creature-12', name: 'Café drake', level: 7, count: 1, kind: 'creature' }] },
    encounters: { saved: [{ id: 'saved-1', title: 'Café bridge', notes: '', createdAt: 1, updatedAt: 1, entries: [] }] },
    combat: { round: 2, activeId: 'pc-π', delayedIds: [], ready: [], order: null, combatants: [{ id: 'pc-π', init: 18, conditions: ['Frightened 2', 'Custom omen'], ref: { cat: 'characters', id: 'pc-π' }, adjust: 'elite', baseLevel: 3, initMod: 11, notes: 'Keep this separate from source data.' }] },
    loot: { pool: [{ id: 'loot-1', name: 'Épée', owner: 'pc-π' }], claimed: { 'loot-1': 'pc-π' } },
    notes: { entries: [{ id: 'note-1', title: 'Résumé', body: 'À demain', at: 1 }] },
    sound: { url: '', saved: [{ id: 'track-1', name: 'Élan', url: 'https://youtu.be/example' }] },
    characters: { extra: [{ id: 'pc-π', name: 'Zoë' }] },
    exploration: { elapsedMinutes: 70, activities: { 'pc-π': { label: 'Treat Wounds', startedAtMinute: 60 } }, timers: [{ id: 'timer-1', label: 'Refocus', startedAtMinute: 60, dueAtMinute: 70, targetId: 'pc-π', source: 'aon:refocus', status: 'due' }] },
    player: { entries: {} },
    ui: { group: { run: 'combat', table: 'party' }, recent: [], pins: [] },
    laterFeature: { keep: true }
  };
}

test('backup round trip retains live device state and safe future slices', () => {
  const original = backupState();
  const text = makeBackup(original, '2026-09-06T12:00:00.000Z');
  const parsed = readBackup(text);
  assert.equal(parsed.format, BACKUP_FORMAT);
  assert.equal(parsed.exportedAt, '2026-09-06T12:00:00.000Z');
  assert.deepEqual(parsed.state, original);
});

test('invalid, future, unsafe and oversized backups are rejected before restore', () => {
  const valid = JSON.parse(makeBackup(backupState(), '2026-09-06T12:00:00.000Z'));
  const future = { ...valid, schemaVersion: BACKUP_SCHEMA + 1 };
  const truncated = '{"format":';
  const badState = { ...valid, state: { ...valid.state, notes: [] } };
  const unsafe = JSON.parse(makeBackup(backupState(), '2026-09-06T12:00:00.000Z'));
  Object.defineProperty(unsafe.state, '__proto__', { value: { polluted: true }, enumerable: true });
  const oversized = 'x'.repeat(MAX_BACKUP_BYTES + 1);
  for (const input of [JSON.stringify(future), truncated, JSON.stringify(badState), JSON.stringify(unsafe), oversized]) {
    assert.throws(() => readBackup(input));
  }
});

test('pins are required only by the current backup schema', () => {
  const current = JSON.parse(makeBackup(backupState(), '2026-09-06T12:00:00.000Z'));
  const missingPins = structuredClone(current);
  delete missingPins.state.ui.pins;
  assert.throws(() => readBackup(JSON.stringify(missingPins)));

  missingPins.schemaVersion = 3;
  assert.deepEqual(readBackup(JSON.stringify(missingPins)).state.ui.recent, []);
});

function storageWith(raw = null) {
  return {
    data: new Map(raw === null ? [] : [['pf2e-gm-toolkit/v1', raw]]),
    fail: false,
    getItem(key) { return this.data.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw new Error('quota'); this.data.set(key, value); }
  };
}

let sequence = 0;
async function freshStore(storage) {
  globalThis.localStorage = storage;
  sequence += 1;
  return import(`../src/store.js?backup-test=${sequence}`);
}

test('a failed restore leaves memory and the previous stored value untouched', async () => {
  const storage = storageWith();
  const store = await freshStore(storage);
  store.state.notes.entries.push({ id: 'old', title: 'Old', body: '', at: 1 });
  store.save();
  const before = JSON.stringify(store.state);
  const stored = storage.data.get('pf2e-gm-toolkit/v1');
  storage.fail = true;
  assert.equal(store.restoreState(backupState()), false);
  assert.equal(JSON.stringify(store.state), before);
  assert.equal(storage.data.get('pf2e-gm-toolkit/v1'), stored);
});

test('a valid backup deliberately recovers a malformed protected save', async () => {
  const storage = storageWith('{broken');
  const store = await freshStore(storage);
  assert.equal(store.persistenceStatus().kind, 'load-error');
  assert.equal(store.restoreState(backupState()), true);
  assert.equal(store.state.notes.entries[0].title, 'Résumé');
  assert.equal(store.state.characters.extra[0].id, 'pc-π');
  assert.equal(store.persistenceStatus().kind, 'saved');
  assert.match(storage.data.get('pf2e-gm-toolkit/v1'), /Résumé/);
});
