// Content metadata for generated reference data. This runs locally after a data pull;
// it never contacts Archives of Nethys, so it can also repair metadata on its own.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const METADATA_FILE = 'cache-metadata.json';

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function categoryFiles(directory) {
  const manifest = await readJson(join(directory, 'index.json'), { categories: [] });
  return manifest.categories.map(category => category.file).filter(Boolean);
}

/**
 * Write the cache contract consumed by service-worker.js.
 *
 * With `files`, only those entries are rehashed and the rest of a prior coherent
 * metadata file is preserved. That is what makes partial AoN pulls safe: index.json
 * and search.json stay untouched, while the affected cache version advances.
 */
export async function writeReferenceMetadata({ directory = OUT, files } = {}) {
  const existing = await readJson(join(directory, METADATA_FILE), { files: {} });
  const targets = files?.length ? files : await categoryFiles(directory);
  const next = { ...(existing.files || {}) };

  for (const file of targets) {
    const bytes = await readFile(join(directory, file));
    next[file] = {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength
    };
  }

  const metadata = {
    _schema: 1,
    _generated: new Date().toISOString(),
    files: Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  };
  await writeFile(join(directory, METADATA_FILE), JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  return metadata;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const metadata = await writeReferenceMetadata({ files: process.argv.slice(2) });
  console.log(`wrote data/${METADATA_FILE} — ${Object.keys(metadata.files).length} files`);
}
