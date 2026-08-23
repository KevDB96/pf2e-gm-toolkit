#!/usr/bin/env node
// Merge a Pathbuilder 2e JSON export into data/characters.json.
//
//   node tools/import-pathbuilder.mjs export.json
//   node tools/import-pathbuilder.mjs export.json --group one-shots --player Kevin
//   cat export.json | node tools/import-pathbuilder.mjs - --group one-shots
//
// Re-importing the same character replaces it in place, matched on id, so this is how
// you level a PC up: export from Pathbuilder again and re-run.
//
// The conversion itself lives in src/pathbuilder.js so the in-app importer and this
// tool produce byte-identical records.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromPathbuilder } from '../src/pathbuilder.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'characters.json');

const DEFAULT_GROUPS = [
  { id: 'mists-of-zalazar', label: 'Mists of Zalazar', kind: 'campaign' },
  { id: 'one-shots', label: 'One-shots', kind: 'one-shot' }
];

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

const args = process.argv.slice(2);
const positional = args.filter(x => !x.startsWith('--'));
const flag = name => {
  const i = args.indexOf('--' + name);
  return i === -1 ? null : args[i + 1];
};

if (!positional.length) {
  console.error('Usage: node tools/import-pathbuilder.mjs <export.json|-> ' +
    '[--group <id>] [--player <name>]');
  console.error('Groups live in data/characters.json; an unknown --group is created.');
  process.exit(1);
}

const raw = positional[0] === '-'
  ? await readStdin()
  : await readFile(positional[0], 'utf8');

const group = flag('group') || 'mists-of-zalazar';

let character;
try {
  character = fromPathbuilder(JSON.parse(raw), { group, player: flag('player') });
} catch (err) {
  console.error('Could not read that export: ' + err.message);
  process.exit(1);
}

let file;
try {
  file = JSON.parse(await readFile(FILE, 'utf8'));
} catch {
  file = {
    _note: 'Player characters, imported from Pathbuilder 2e exports with ' +
      'tools/import-pathbuilder.mjs. Hand-editable, and NOT touched by fetch-aon.mjs.',
    groups: DEFAULT_GROUPS,
    characters: []
  };
}
file.groups ||= DEFAULT_GROUPS;
file.characters ||= [];

if (!file.groups.some(g => g.id === group)) {
  file.groups.push({ id: group, label: group, kind: 'one-shot' });
  console.log('created group "' + group + '" — edit its label in data/characters.json');
}

const at = file.characters.findIndex(c => c.id === character.id);
if (at === -1) file.characters.push(character);
else file.characters[at] = character;

file.characters.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
await writeFile(FILE, JSON.stringify(file, null, 2) + '\n', 'utf8');

console.log((at === -1 ? 'added ' : 'updated ') + character.name +
  ' (' + character.class + ' ' + character.level + ') in group "' + group + '"');
console.log('  AC ' + character.ac + ' · HP ' + character.hp +
  ' · Perception +' + character.perception +
  ' · Fort +' + character.saves.fort +
  ' · Ref +' + character.saves.ref +
  ' · Will +' + character.saves.will);
console.log('  data/characters.json now holds ' + file.characters.length + ' character(s).');
