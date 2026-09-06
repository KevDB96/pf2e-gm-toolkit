import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeReferenceMetadata } from '../tools/cache-metadata.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

test('reference cache metadata hashes bytes and preserves unaffected partial entries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pf2e-cache-metadata-'));
  await writeFile(join(directory, 'index.json'), JSON.stringify({
    categories: [{ file: 'creatures.json' }, { file: 'equipment.json' }]
  }));
  await writeFile(join(directory, 'creatures.json'), 'old creatures');
  await writeFile(join(directory, 'equipment.json'), 'equipment');
  const first = await writeReferenceMetadata({ directory });
  assert.deepEqual(Object.keys(first.files), ['creatures.json', 'equipment.json']);
  assert.equal(first.files['creatures.json'].sha256, hash('old creatures'));
  assert.equal(first.files['creatures.json'].bytes, Buffer.byteLength('old creatures'));
  await writeFile(join(directory, 'creatures.json'), 'new creatures');
  const partial = await writeReferenceMetadata({ directory, files: ['creatures.json'] });
  assert.equal(partial.files['creatures.json'].sha256, hash('new creatures'));
  assert.deepEqual(partial.files['equipment.json'], first.files['equipment.json']);
  assert.equal((await JSON.parse(await readFile(join(directory, 'cache-metadata.json'), 'utf8')))._schema, 1);
});
