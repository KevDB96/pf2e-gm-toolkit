import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const combat = await readFile(new URL('../src/views/combat.js', import.meta.url), 'utf8');
const encounters = await readFile(new URL('../src/views/encounters.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Ready is a persistent combatant toggle instead of a reminder form', () => {
  assert.match(combat, /function toggleReady\(id\)/);
  assert.match(combat, /c\.ready = !c\.ready/);
  assert.match(combat, /data-ready="\$\{esc\(c\.id\)\}"/);
  assert.match(combat, /aria-pressed="\$\{Boolean\(c\.ready\)\}"/);
  assert.doesNotMatch(combat, /Ready action|data-ready-action|data-ready-trigger|data-ready-used|data-ready-clear/);
  assert.match(styles, /\.ready-toggle\.on\{/);
});

test('tracker cards show class and spell save DCs instead of Perception', () => {
  assert.match(combat, /'Class DC ' \+ c\.classDC/);
  assert.match(combat, /'Spell DC ' \+ spells\.join\('\/'\)/);
  assert.match(combat, /spellDCs: \[\.\.\.new Set\(\(c\.spellcasting \|\| \[\]\)/);
  assert.doesNotMatch(combat, /\? 'Stealth' : 'Perc'/);
  assert.match(encounters, /spellDC: adjustedModifier\(e\.creature\?\.spellDC, e\.adjust\)/);
});

test('tracker HP uses amount plus damage or heal controls with no slider', () => {
  assert.match(combat, /data-hp-amount=/);
  assert.match(combat, /data-hp-mode="damage"/);
  assert.match(combat, /data-hp-mode="healing"/);
  assert.match(combat, /function applyHPChange\(id, mode, row\)/);
  assert.doesNotMatch(combat, /data-hp-slide|type="range"|function dragHP/);
  assert.match(styles, /\.hp-change\{display:grid;/);
  assert.doesNotMatch(styles, /\.hpslide\{/);
});
