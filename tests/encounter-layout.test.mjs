import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const encounters = await readFile(new URL('../src/views/encounters.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('Run encounter source actions use their dedicated non-shrinking layout', () => {
  assert.match(encounters, /class="encounter-source-actions"/);
  for (const label of ['Bestiary', 'Hazards', '+ Custom', 'Saved']) {
    assert.ok(encounters.includes(`>${label}</button>`), `${label} action must remain present`);
  }
  assert.doesNotMatch(encounters, /<div class="row wrap">\s*<button class="primary grow" data-add-bestiary>/);
});

test('encounter source action labels stay inside their button boxes at narrow widths', () => {
  assert.match(styles, /\.encounter-source-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:10px\}/);
  assert.match(styles, /\.encounter-source-actions button\{[^}]*width:100%;[^}]*min-width:0;[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /@media \(min-width:640px\)\{\.encounter-source-actions\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/);
});


test('encounter modifier controls wrap before reaching the quantity stepper', () => {
  assert.match(styles, /\.enc-adjust\{[^}]*display:flex;[^}]*flex-wrap:wrap;[^}]*min-width:0;[^}]*max-width:100%/);
});
