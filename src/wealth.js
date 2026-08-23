// Value a character's gear against data/equipment.json, and compare it to what the
// published tables expect for their level.
//
// Pure: no DOM, no storage, no fetch. Prices are integers in copper throughout, matching
// the `price` field the AoN import writes, and only converted to gp for display.
//
// Nothing here guesses a price. An item that cannot be matched by name is reported in
// `unmatched` rather than silently counted as zero — plot items and homebrew have no
// market value, and a total that quietly swallowed them would be worse than one that
// says what it skipped.

/** Pathbuilder names that differ from the Archives of Nethys entry. */
const ALIASES = {
  hide: 'hide armor',
  'reinforcing (lesser)': 'reinforcing rune (lesser)',
  'reinforcing (minor)': 'reinforcing rune (minor)',
  'reinforcing (moderate)': 'reinforcing rune (moderate)',
  'reinforcing (greater)': 'reinforcing rune (greater)',
  'reinforcing (major)': 'reinforcing rune (major)'
};

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** name -> price in copper. The cheapest entry wins when a name repeats. */
export function priceIndex(items) {
  const index = new Map();
  for (const i of items || []) {
    if (typeof i.price !== 'number') continue;
    const key = norm(i.name);
    if (!index.has(key) || i.price < index.get(key)) index.set(key, i.price);
  }
  return index;
}

/**
 * Look a name up, trying the shapes Pathbuilder writes: the plain name, a known alias,
 * "Longsword (Greater)" as "Greater Longsword", and the bare name with a category word
 * appended. Returns null when nothing matches.
 */
export function lookup(index, name) {
  const n = norm(name);
  if (!n) return null;
  if (index.has(n)) return index.get(n);
  if (ALIASES[n] && index.has(ALIASES[n])) return index.get(ALIASES[n]);

  // Try each rewrite, and each of those pluralised — AoN lists "Lesser Aether Marbles"
  // where Pathbuilder writes "Aether Marble (Lesser)".
  const candidates = [];
  const m = n.match(/^(.+?)\s*\((.+)\)$/);
  if (m) candidates.push(`${m[2]} ${m[1]}`);       // "Clothing (Explorer's)" -> "Explorer's Clothing"
  for (const suffix of [' armor', ' rune']) candidates.push(n + suffix);

  for (const c of [...candidates]) candidates.push(c + 's');
  candidates.push(n + 's');
  if (n.endsWith('s')) candidates.push(n.slice(0, -1));

  for (const c of candidates) if (index.has(c)) return index.get(c);
  return null;
}

/** The rune names implied by a weapon or armour entry's potency/striking/resilient. */
function runeNames(piece, kind) {
  const out = [];
  if (piece.potency > 0) {
    out.push(`${kind === 'armor' ? 'Armor' : 'Weapon'} Potency (+${piece.potency})`);
  }
  if (piece.striking) {
    const s = norm(piece.striking);
    out.push(s === 'striking' ? 'Striking'
      : s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase()));
  }
  if (piece.resilient) {
    const r = norm(piece.resilient);
    out.push(r === 'resilient' ? 'Resilient'
      : r.replace(/\b\w/g, c => c.toUpperCase()));
  }
  out.push(...(piece.runes || []));
  return out;
}

/**
 * Total a character's possessions.
 * Returns copper totals plus the lists behind them, so a caller can show its working.
 */
export function valueCharacter(character, index) {
  const matched = [];
  const unmatched = [];

  const add = (name, qty = 1) => {
    const price = lookup(index, name);
    if (price === null) { unmatched.push(name); return; }
    matched.push({ name, qty, price, total: price * qty });
  };

  for (const item of character.equipment || []) add(item.name, item.qty || 1);

  for (const w of character.weapons || []) {
    add(w.base || w.name);
    for (const r of runeNames(w, 'weapon')) add(r);
  }
  for (const a of character.armor || []) {
    add(a.base || a.name);
    for (const r of runeNames(a, 'armor')) add(r);
  }

  const m = character.money || {};
  const coins = (m.pp || 0) * 1000 + (m.gp || 0) * 100 + (m.sp || 0) * 10 + (m.cp || 0);
  const gear = matched.reduce((sum, x) => sum + x.total, 0);

  return { gear, coins, total: gear + coins, matched, unmatched };
}

/** Copper to gp, to two decimals at most. */
export const toGp = cp => Math.round(cp) / 100;
