import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = {
  data: new Map(),
  writes: 0,
  getItem(key) { return this.data.get(key) || null; },
  setItem(key, value) { this.writes += 1; this.data.set(key, value); }
};
globalThis.localStorage = storage;

const { state, reset } = await import('../src/store.js');
const {
  canUndo, clearCombatHistory, combatTransaction, configureCombatHistory,
  undoCombat, undoLabel
} = await import('../src/combat-history.js');

let report = null;
configureCombatHistory({ readMeta: () => report, writeMeta: value => { report = value; } });

beforeEach(() => {
  reset();
  clearCombatHistory();
  report = null;
  storage.writes = 0;
});
test('one transaction restores combat, active turn and report exactly', () => {
  state.combat = {
    round: 2, activeId: 'b',
    combatants: [{ id: 'a', hp: 10, conditions: [] }, { id: 'b', hp: 20, conditions: ['Frightened 2'] }]
  };
  report = 'A report from the previous turn';
  const before = JSON.parse(JSON.stringify(state.combat));
  combatTransaction('Next turn', combat => {
    combat.round = 3;
    combat.activeId = 'a';
    combat.combatants[1].hp = 8;
    combat.combatants[1].conditions = [];
    report = 'B · Frightened ended';
  });
  assert.equal(undoLabel(), 'Next turn');
  assert.equal(undoCombat(), 'Next turn');
  assert.deepEqual(state.combat, before);
  assert.equal(report, 'A report from the previous turn');
});

test('no-op and invalid mutations do not create history or save', () => {
  state.combat = { round: 0, activeId: null, combatants: [] };
  const writes = storage.writes;
  assert.equal(combatTransaction('Invalid edit', () => {}), false);
  assert.equal(canUndo(), false);
  assert.equal(storage.writes, writes);
});

test('undo changes combat only, so notes remain intact', () => {
  combatTransaction('Add NPC', combat => {
    combat.combatants.push({ id: 'x', hp: 5, conditions: [] });
  });
  state.notes.entries.push({ id: 'note-1', title: 'Keep me', body: 'session note' });
  const note = JSON.parse(JSON.stringify(state.notes));
  undoCombat();
  assert.deepEqual(state.notes, note);
  assert.deepEqual(state.combat.combatants, []);
});

test('history is capped at twenty entries and reset clears it', () => {
  for (let i = 0; i < 25; i++) {
    combatTransaction(`Action ${i}`, combat => {
      combat.round = i + 1;
      combat.activeId = null;
    });
  }
  const labels = [];
  while (canUndo()) labels.push(undoLabel()), undoCombat();
  assert.equal(labels.length, 20);
  assert.equal(labels[0], 'Action 24');

  combatTransaction('After reset', combat => { combat.round = 1; });
  reset();
  assert.equal(canUndo(), false);
});
