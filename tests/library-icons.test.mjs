import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { libraryIcon, libraryIconPath } from '../src/library-icons.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedCategories = [
  'creatures', 'equipment', 'spells', 'feats', 'actions', 'hazards', 'conditions',
  'classes', 'ancestries', 'heritages', 'backgrounds', 'archetypes', 'deities',
  'rituals', 'skills', 'traits'
];
const manifest = JSON.parse(await readFile(new URL('../data/index.json', import.meta.url), 'utf8'));
const categories = manifest.categories;

test('Library category artwork covers every manifest category and is precached', async () => {
  const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
  const view = await readFile(new URL('../src/views/library.js', import.meta.url), 'utf8');
  assert.deepEqual(categories.map(category => category.name), expectedCategories);
  assert.match(view, /libraryIcon\(c\)/);
  assert.match(view, /libraryIcon\(cat\)/);
  assert.match(worker, /['"]\.\/src\/library-icons\.js['"]/);
  assert.match(worker, /['"]\.\/data\/index\.json['"]/);
  assert.match(worker, /['"]\.\/data\/traits\.json['"]/);
  assert.match(worker, /WARM_REFERENCE_FILES = [\s\S]*['"]traits\.json['"]/);
  for (const category of categories) {
    const path = libraryIconPath(category.name);
    await access(join(root, path.slice(2)));
    assert.ok(worker.includes(`'${path}'`) || worker.includes(`"${path}"`), `service worker must precache ${path}`);
    assert.match(libraryIcon(category), new RegExp(`src="${path.replaceAll('/', '\\/')}"`));
  }
});

test('Library icon resolver encodes names and preserves future-category fallback', () => {
  assert.equal(libraryIconPath('future category'), './assets/icons/library/future%20category.png');
  const markup = libraryIcon({ name: 'future-category', glyph: '☆' });
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /alt=""/);
  assert.match(markup, /onerror=/);
  assert.match(markup, /library-icon-fallback/);
  assert.match(markup, /☆/);
  assert.match(libraryIcon({ glyph: '☆' }), /library-icon-fallback/);
});
