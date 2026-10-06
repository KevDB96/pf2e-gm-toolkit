import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const notes = await readFile(new URL('../src/views/notes.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

test('Notes provides linkable General, Exploration, and Downtime workspaces', () => {
  for (const id of ['general', 'exploration', 'downtime']) {
    assert.match(notes, new RegExp(`'${id}'`));
  }
  assert.match(notes, /location\.hash = `#\/notes\/\$\{el\.dataset\.notesWorkspace\}`/);
  assert.match(notes, /location\.hash\.match/);
  assert.match(app, /split\('\/'\)\[0\]/);
});

test('Exploration Clock presentation and controls are absent while General Notes remains', () => {
  assert.doesNotMatch(notes, /Exploration clock|data-advance|data-start-timer|data-ack-timer|data-set-activity/);
  assert.match(notes, /visibleNotes\.length/);
  assert.match(notes, /data-add-note/);
});

test('switching Notes workspaces only changes local navigation state', () => {
  const handler = notes.match(/on\(root, 'click', '\[data-notes-workspace\]'([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(handler);
  assert.match(handler, /location\.hash/);
  assert.doesNotMatch(handler, /save\(|fetch\(|client\.|state\./);
});
