import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile(new URL('../src/views/home.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

const homeMappings = [
  ['encounters', 'encounters-tile.png'],
  ['combat', 'combat-tile.png'],
  ['library', 'library-tile.png'],
  ['loot', 'loot-tile.png'],
  ['notes', 'campaign-tile.png'],
  ['party', 'party-tile.png'],
  ['sound', 'bgm-tile.png']
];

test('Home maps every approved tile to rendered PNG artwork', () => {
  const tileBlock = home.match(/const TILES = \[(.*?)\n\];/s)?.[1];
  assert.ok(tileBlock, 'Home tile definitions should be present');
  const mappings = [...tileBlock.matchAll(/\{\s*view:\s*'([^']+)'\s*,\s*icon:\s*'([^']+)'\s*,\s*title:\s*'([^']+)'\s*\}/g)];
  assert.equal(mappings.length, homeMappings.length, 'Home should define exactly seven tiles');
  for (const [view, icon] of homeMappings) {
    assert.ok(mappings.some(([, mappedView, mappedIcon]) => mappedView === view && mappedIcon === icon), `${view} should map to ${icon}`);
  }
  assert.match(home, /<img class="glyph" src="\.\/assets\/icons\/home\/\$\{t\.icon\}" alt="" aria-hidden="true">/);
  assert.doesNotMatch(tileBlock, /glyph\s*:/);
  assert.doesNotMatch(home, /t\.glyph/);
});

test('Home artwork is listed in the shell precache', () => {
  for (const [, icon] of homeMappings) {
    assert.match(worker, new RegExp(`['"]\.\/assets\/icons\/home\/${icon}['"]`));
  }
  assert.match(worker, /pf2e-gm-shell-v78/);
});
