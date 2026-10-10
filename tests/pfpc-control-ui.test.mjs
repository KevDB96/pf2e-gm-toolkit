import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pfpcControlMarkup, pfpcControlView } from '../src/pfpc-control-ui.js';

const until = '2026-09-27T16:00:00.000Z';
const active = { state: 'active', startedAt: '2026-09-27T10:00:00.000Z', activeUntil: until, remainingSeconds: 21600 };
const deadline = Date.parse(until);

test('offline offers only explicit Start and restart is available after expiry', () => {
  const markup = pfpcControlMarkup({ state: 'offline' }, deadline);
  assert.match(markup, /Start Player Companion/);
  assert.doesNotMatch(markup, /Stop Now|Extend|Keep alive|Reset timer|\+time/i);
  assert.equal(pfpcControlView(active, deadline).state, 'offline');
  assert.match(pfpcControlMarkup(pfpcControlView(active, deadline), deadline), /data-pfpc-start/);
});

test('active derives countdown and absolute end from server activeUntil with Stop only', () => {
  const markup = pfpcControlMarkup(active, deadline - 90_000);
  assert.match(markup, /Player Companion: ACTIVE/);
  assert.match(markup, /data-pfpc-countdown>0:01:30/);
  assert.match(markup, new RegExp(until.replaceAll(':', ':')));
  assert.match(markup, /Stop Now/);
  assert.doesNotMatch(markup, /data-pfpc-start|Extend|Keep alive|Reset timer|\+time/i);
});

test('exact deadline changes the view to offline locally', () => {
  assert.deepEqual(pfpcControlView(active, deadline - 1), active);
  assert.deepEqual(pfpcControlView(active, deadline), { state: 'offline' });
  assert.match(pfpcControlMarkup(active, deadline), /Player Companion: OFFLINE/);
});

test('unreachable offers status retry only; setup and auth states stay actionable', () => {
  const unavailable = pfpcControlMarkup({ state: 'unreachable' });
  assert.match(unavailable, /Player Companion unavailable/);
  assert.match(unavailable, /data-pfpc-retry/);
  assert.doesNotMatch(unavailable, /data-pfpc-start|data-pfpc-stop/);
  assert.match(pfpcControlMarkup({ state: 'unconfigured' }), /data-pfpc-config/);
  for (const state of ['offline', 'active', 'auth-required', 'admin-required']) {
    const markup = pfpcControlMarkup({ state }, deadline);
    assert.doesNotMatch(markup, /sign.in|sign.out|username|password|gm.access|private.*link/i);
  }
});

test('control UI contains no extension affordance', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/pfpc-control-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /extend|keepalive|reset timer|\+time/i);
});
