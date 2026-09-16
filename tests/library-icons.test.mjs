import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { libraryIcon, libraryIconPath } from '../src/library-icons.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const categories = [
  'creatures', 'equipment', 'spells', 'feats', 'actions', 'hazards', 'conditions',
  'classes', 'ancestries', 'heritages', 'backgrounds', 'archetypes', 'deities',
  'rituals', 'skills', 'traits'
];

test('Library category artwork maps every approved asset and is precached', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../src/views/library.js', import.meta.url), 'utf8');
  assert.match(view, /libraryIcon\(c\)/);
  assert.match(view, /libraryIcon\(cat\)/);
  assert.match(worker, /['"]\.\/src\/library-icons\.js['"]/);
  for (const name of categories) {
    const path = `./assets/icons/library/${name}.png`;
    assert.equal(libraryIconPath(name), path);
    await access(join(root, path.slice(2)));
    assert.match(worker, new RegExp(`['"]${path.replaceAll('/', '\\/')}['"]`));
    assert.match(libraryIcon({ name, glyph: 'fallback' }), new RegExp(`src="${path.replaceAll('/', '\\/')}"`));
  }
});

test('Library category artwork keeps the manifest glyph as a missing-image fallback', () => {
  const markup = libraryIcon({ name: 'future-category', glyph: '☆' });
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /alt=""/);
  assert.match(markup, /onerror=/);
  assert.match(markup, /library-icon-fallback/);
  assert.match(markup, /☆/);
  assert.match(libraryIcon({ glyph: '☆' }), /library-icon-fallback/);
});
