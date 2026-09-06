import { test } from 'node:test';
import assert from 'node:assert/strict';

function storageWith(value = null) {
  return {
    data: new Map(value === null ? [] : [['pf2e-gm-toolkit/v1', value]]),
    writes: 0,
    failWrite: false,
    getItem(key) { return this.data.get(key) ?? null; },
    setItem(key, next) {
      this.writes += 1;
      if (this.failWrite) throw new Error('quota exceeded');
      this.data.set(key, next);
    }
  };
}

let caseNumber = 0;
async function freshStore(storage) {
  globalThis.localStorage = storage;
  caseNumber += 1;
  return import(`../src/store.js?store-test=${caseNumber}`);
}

test('a write failure leaves the live edit visible and retry reports saved', async () => {
  const storage = storageWith();
  const store = await freshStore(storage);
  let updates = 0;
  store.subscribe(() => { updates += 1; });
  storage.failWrite = true;
  store.state.notes.entries.push({ id: 'n', title: 'Visible', body: '', at: 1 });
  assert.equal(store.save(), false);
  assert.equal(store.state.notes.entries[0].title, 'Visible');
  assert.equal(updates, 1);
  assert.equal(store.persistenceStatus().kind, 'unsaved');

  storage.failWrite = false;
  assert.equal(store.save(), true);
  assert.equal(store.persistenceStatus().kind, 'saved');
  assert.match(storage.data.get('pf2e-gm-toolkit/v1'), /Visible/);
});

test('malformed JSON is preserved and cannot be overwritten incidentally', async () => {
  const raw = '{ definitely not JSON';
  const storage = storageWith(raw);
  const store = await freshStore(storage);
  assert.equal(store.persistenceStatus().kind, 'load-error');
  assert.equal(store.corruptSavedData(), raw);
  store.state.notes.entries.push({ id: 'recovery', title: 'Live note', body: '', at: 1 });
  assert.equal(store.save(), false);
  assert.equal(storage.data.get('pf2e-gm-toolkit/v1'), raw);
  assert.match(store.serializeState(), /Live note/);
});

test('older valid state gains defaults without dropping device data or condition strings', async () => {
  const storage = storageWith(JSON.stringify({
    party: { level: 3 },
    notes: { entries: [{ id: 'n', title: 'Keep', body: 'it', at: 1 }] },
    characters: { extra: [{ id: 'pc' }] },
    combat: { round: 1, active: 0, combatants: [{ id: 'a', conditions: ['Made-up condition'] }] },
    future: { keep: true }
  }));
  const store = await freshStore(storage);
  assert.equal(store.state.party.level, 3);
  assert.equal(store.state.party.size, 5);
  assert.equal(store.state.notes.entries[0].title, 'Keep');
  assert.equal(store.state.characters.extra[0].id, 'pc');
  assert.deepEqual(store.state.combat.combatants[0].conditions, ['Made-up condition']);
  assert.equal(store.state.future.keep, true);
  assert.equal(store.state.ui.recent.length, 0);
  assert.deepEqual(store.state.ui.pins, []);
  assert.deepEqual(store.state.encounters.saved, []);
});

test('current data serializes when storage cannot be accessed', async () => {
  const storage = storageWith();
  storage.getItem = () => { throw new Error('security error'); };
  const store = await freshStore(storage);
  assert.equal(store.persistenceStatus().kind, 'load-error');
  assert.match(store.serializeState(), /"party"/);
});
