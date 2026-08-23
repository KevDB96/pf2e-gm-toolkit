#!/usr/bin/env node
// Report what each character's gear is worth against what the tables expect.
//
//   node tools/wealth.mjs
//   node tools/wealth.mjs --group one-shots
//   node tools/wealth.mjs --detail        # list every priced item
//
// Pricing comes from data/equipment.json, so run `npm run data` first if that file is
// missing. Anything the price index cannot match is listed rather than counted as zero.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceIndex, valueCharacter, toGp } from '../src/wealth.js';
import { wealthFor, cumulativeTreasure, CHARACTER_CURRENCY } from '../src/pf2e.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i === -1 ? null : args[i + 1]; };
const detail = args.includes('--detail');

const items = JSON.parse(await readFile(join(ROOT, 'data', 'equipment.json'), 'utf8')).items;
const file = JSON.parse(await readFile(join(ROOT, 'data', 'characters.json'), 'utf8'));
const group = flag('group');
const chars = file.characters.filter(c => !group || c.group === group);

if (!chars.length) {
  console.error('No characters' + (group ? ' in group "' + group + '"' : '') + '.');
  process.exit(1);
}

const index = priceIndex(items);
const gp = cp => toGp(cp).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pad = (s, n) => String(s).padStart(n);

const size = chars.length;
const levels = [...new Set(chars.map(c => c.level))];
const level = Math.max(...levels);
const expected = wealthFor(level);
const running = cumulativeTreasure(level, size);

console.log('Party of ' + size + ' at level ' + levels.join('/') + '\n');
console.log('Benchmarks');
console.log('  Character Wealth, level ' + level + ' lump sum   ' + pad(expected, 9) + ' gp each');
console.log('  ...of which currency                 ' + pad(CHARACTER_CURRENCY[level], 9) + ' gp each');
console.log('  Treasure handed out, levels 1-' + (level - 1) + '      '
  + pad(running.toFixed(0), 9) + ' gp each');
console.log('  ...once level ' + level + ' is finished too    '
  + pad(cumulativeTreasure(level + 1, size).toFixed(0), 9) + ' gp each\n');

let partyTotal = 0;
let partyUnmatched = 0;
for (const c of chars) {
  const v = valueCharacter(c, index);
  partyTotal += v.total;
  partyUnmatched += v.unmatched.length;
  const delta = toGp(v.total) - expected;

  console.log(c.name + ' — ' + c.class + ' ' + c.level);
  console.log('  gear   ' + pad(gp(v.gear), 10) + ' gp  (' + v.matched.length + ' items priced)');
  console.log('  coins  ' + pad(gp(v.coins), 10) + ' gp');
  console.log('  total  ' + pad(gp(v.total), 10) + ' gp  '
    + (delta >= 0 ? '+' : '') + delta.toFixed(0) + ' vs table ('
    + Math.round((toGp(v.total) / expected) * 100) + '%)');
  if (v.unmatched.length) {
    console.log('  unpriced: ' + v.unmatched.join(', '));
  }
  if (detail) {
    for (const m of [...v.matched].sort((a, b) => b.total - a.total)) {
      console.log('      ' + pad(gp(m.total), 9) + ' gp  ' + m.name +
        (m.qty > 1 ? ' x' + m.qty : ''));
    }
  }
  console.log('');
}

console.log('Party total ' + gp(partyTotal) + ' gp against ' + (expected * size) +
  ' gp for ' + size + ' freshly built level-' + level + ' characters.');
if (partyUnmatched) {
  console.log(partyUnmatched + ' entries had no match in data/equipment.json and were ' +
    'left out of every total above.');
}
