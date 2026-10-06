import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const notes = await readFile(new URL('../src/views/notes.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const exploration = await readFile(new URL('../src/views/exploration-gm.js', import.meta.url), 'utf8');
const downtime = await readFile(new URL('../src/views/downtime-gm.js', import.meta.url), 'utf8');

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

test('Notes Exploration mounts the existing dashboard and legacy route normalizes into it', () => {
  assert.match(notes, /import \{ bindExploration \} from '\.\/exploration-gm\.js'/);
  assert.match(notes, /workspace === 'exploration'[\s\S]*?bindExploration\(qs\('\[data-exploration-root\]'/);
  assert.match(app, /name === 'exploration'[\s\S]*?history\.replaceState\(null, '', '#\/notes\/exploration'\)/);
  assert.doesNotMatch(app, /exploration:\s*\{\s*title:/);
  assert.doesNotMatch(app, /views: \[[^\]]*'exploration'/);
});

test('Notes reuses canonical activity and map controls, including visibility and marker privacy', () => {
  assert.match(exploration, /client\.setExploration\(currentCampaign,workflow\.revision,t\.dataset\.activity,t\.value\|\|null\)/);
  assert.match(exploration, /client\.getCampaignMap\(id/);
  assert.match(exploration, /client\.setCampaignMap\(currentCampaign,mapRevision,map\)/);
  assert.match(exploration, /data-visibility/);
  assert.match(exploration, /hidden-marker/);
  assert.match(notes, /visibleNotes\.length/);
  assert.match(notes, /data-add-note/);
});

test('Notes Downtime mounts the existing dashboard and legacy route normalizes into it', () => {
  assert.match(notes, /import \{ bindDowntime \} from '\.\/downtime-gm\.js'/);
  assert.match(notes, /workspace === 'downtime'[\s\S]*?bindDowntime\(qs\('\[data-downtime-root\]'/);
  assert.match(app, /name === 'downtime'[\s\S]*?history\.replaceState\(null, '', '#\/notes\/downtime'\)/);
  assert.doesNotMatch(app, /downtime:\s*\{\s*title:/);
  assert.doesNotMatch(app, /views: \[[^\]]*'downtime'/);
});

test('Notes Downtime preserves the existing edit, clear, archive and retry integration', () => {
  assert.match(downtime, /client\.setDowntime\(currentCampaign, workflow\.revision, id, choice\)/);
  assert.match(downtime, /data-save-choice/);
  assert.match(downtime, /data-clear-choice/);
  assert.match(downtime, /advanceDowntimeMonth\(/);
  assert.match(downtime, /state\.notes = upsertDowntimeArchive\(state\.notes, archive\)/);
  assert.match(downtime, /archiveSaved\(persistenceStatus\(\)\)/);
});

test('offline shell precaches the Notes, Exploration, Downtime, and archive modules', () => {
  for (const path of [
    './src/views/notes.js',
    './src/views/exploration-gm.js',
    './src/views/downtime-gm.js',
    './src/downtime-history.js'
  ]) assert.ok(serviceWorker.includes(path), `${path} must stay available offline`);
});
