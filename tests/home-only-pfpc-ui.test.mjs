import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const party = await readFile(new URL('../src/views/party.js', import.meta.url), 'utf8');
const notes = await readFile(new URL('../src/views/notes.js', import.meta.url), 'utf8');
const exploration = await readFile(new URL('../src/views/exploration-gm.js', import.meta.url), 'utf8');
const downtime = await readFile(new URL('../src/views/downtime-gm.js', import.meta.url), 'utf8');

test('PFPC session controls are visible only on Home and no PFPC tab exists', () => {
  assert.match(app, /qs\('#pfpc-control'\)\.hidden = name !== 'home'/);
  assert.match(app, /qs\('#session-phase-control'\)\.hidden = name !== 'home'/);
  assert.match(html, /id="pfpc-control"/);
  assert.doesNotMatch(html, /data-view="(?:pfpc|player-companion|companion)"/i);
  assert.doesNotMatch(html, /<span>Player Companion<\/span>/i);
  assert.match(app, /run:\s*\{\s*title: 'Run',\s*views: \['encounters', 'combat'\]\s*\}/);
});

test('Party presentation uses GM Toolkit language and preserves the read-only privacy boundary', () => {
  assert.doesNotMatch(party, /Player Companion|PFPC|No Companion characters/i);
  assert.match(party, /Shared campaign characters/);
  assert.match(party, /Player-owned sheet fields remain private/);
  assert.match(party, /Only shared character details appear here/);
});

test('Notes Exploration and Downtime remain native, unbranded Notes workspaces', () => {
  assert.match(notes, /exploration/);
  assert.match(notes, /downtime/);
  assert.doesNotMatch(notes, /PFPC|Player Companion/i);
  assert.match(exploration, /<h2>Exploration<\/h2>/);
  assert.doesNotMatch(exploration, /PFPC Exploration|Player Companion Exploration/i);
  assert.match(downtime, /<h2>Downtime<\/h2>/);
  assert.doesNotMatch(downtime, /PFPC Downtime|Player Companion Downtime/i);
});
