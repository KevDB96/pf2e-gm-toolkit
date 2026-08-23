// Reading Archives of Nethys documents: their prose, their stat-block pairs, and the
// names they file things under.
//
// AoN stores each entry twice: `text`, which is the whole page flattened to one line,
// and `markdown`, which keeps the structure in a small set of pseudo-tags:
//
//   <title level="1" right="Feat 4">[Rescuer's Press](/Feats.aspx?ID=2167)</title>
//   <traits><trait label="Rare" ... /></traits>
//   <column gap="tiny">**Source** [Legends](...) pg. 68 ... </column>
//   ---
//   Any shield you wield gains the [shove](/Traits.aspx?ID=193) trait. ...
//   <title level="2">Knights in Training</title>
//   ...
//
// `text` is what the codex used to read, which is why descriptions arrived as one wall
// of prose with the stat block smeared across the front of it. This module works from
// `markdown` instead, so paragraphs, sub-headings and lists survive.
//
// Pure: no fetch, no filesystem. Covered by tests/aon-text.test.mjs.

import { actionIcons } from '../src/pf2e.js';

/** A line that is exactly `---`: AoN's rule between the stat block and the prose. */
const RULE = /^[ \t]*-{3,}[ \t]*$/;

/** `<title …>` with its level, however the attributes happen to be wrapped. */
const TITLE = /<title\b[^>]*>[\s\S]*?<\/title>/gi;
const TITLE_LEVEL = /<title\b[^>]*?\blevel="(\d+)"/i;

const collapse = s => s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

/** `[Shove](/Actions.aspx?ID=38)` -> `Shove`. The sheet has no use for AoN's links. */
const unlink = s => s.replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1');

/**
 * Split a markdown blob into its stat-block header and its prose body.
 *
 * The long-form pages put a `---` between the two. The short ones — heritages, traits,
 * creature abilities, skills — have no rule and no `<column>` either: the title is
 * followed by loose `**Source** …` paragraphs and then the prose, so the header ends at
 * the last of those paragraphs.
 */
function halves(md) {
  const s = String(md).replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  const at = lines.findIndex(l => RULE.test(l));
  if (at !== -1) {
    return { header: lines.slice(0, at).join('\n'), body: lines.slice(at + 1).join('\n') };
  }

  let cut = 0;
  const title = s.indexOf('</title>');
  if (title !== -1) cut = title + '</title>'.length;
  const traits = s.indexOf('</traits>', cut);
  if (traits !== -1 && s.slice(cut, traits).trim().startsWith('<traits')) {
    cut = traits + '</traits>'.length;
  }

  let header = s.slice(0, cut);
  // `<row>`/`<column>` are layout, and on these pages they wrap the prose rather than
  // sit above it, so they are dropped here instead of being treated as header.
  let body = s.slice(cut)
    .replace(/<traits>[\s\S]*?<\/traits>/gi, '\n')
    .replace(/<\/?(?:row|column)\b[^>]*>/gi, '\n');

  for (;;) {
    // One label and its value on a single short line: a stat, not a sentence. Prose that
    // opens in bold — a spell's "**Heightened (+1)** …" — only ever follows a rule.
    const m = body.match(/^\s*(\*\*[^*\n]{1,40}\*\*[^\n]{0,160})\n?/);
    if (!m) break;
    let taken = m[0];
    // A source title long enough to wrap leaves its link split across two lines.
    for (let i = 0; i < 2 && (taken.split('[').length > taken.split(']').length); i++) {
      const more = body.slice(taken.length).match(/^[^\n]*\n?/);
      if (!more) break;
      taken += more[0];
    }
    header += '\n' + taken.trim();
    body = body.slice(taken.length);
  }
  return { header, body };
}

/**
 * The `**Label** value` pairs AoN lays out above the rule, in page order.
 *
 * These are the numbers a stat block leads with — a weapon's damage die, an armour's
 * category and check penalty, a shield's Hardness — and the Elasticsearch document has
 * fields for only some of them, so the rest are only available here.
 */
export function headerPairs(md) {
  const text = collapse(unlink(String(md).replace(/<[^>]*>/g, '\n')));
  const out = [];
  const re = /\*\*([^*\n]+?)\*\*([\s\S]*?)(?=\*\*|$)/g;
  for (let m; (m = re.exec(text));) {
    const label = collapse(m[1]).replace(/:$/, '');
    const value = collapse(m[2].replace(/\n/g, ' '));
    if (label && value && value !== '—') out.push({ label, value });
  }
  return out;
}

/**
 * The prose body, as light markdown: blank lines between paragraphs, `## ` for the
 * sub-headings AoN writes as `<title>`, `- ` for list items, `**bold**` kept.
 *
 * Everything from the first title of level `cutAt` or above is dropped. At the default
 * of 2 that is where AoN appends the boilerplate a page inherits rather than states —
 * the critical specialization rules on every weapon, "Specific Magic Shields" on every
 * shield, the archetype's own blurb under every one of its feats — and on a phone it
 * buries the two sentences that matter. Grade variants ("Rooting (Greater)") sit at that
 * level too, and each of those is already an entry in its own right.
 *
 * Pass `cutAt: 1` to keep those sections: sub-features are filed at level 2 on some
 * pages and level 3 on others, so sections() needs both.
 */
export function bodyText(md, { cutAt = 2 } = {}) {
  let t = String(md).replace(/\r\n?/g, '\n');

  for (let m, re = new RegExp(TITLE.source, 'gi'); (m = re.exec(t));) {
    const level = m[0].match(TITLE_LEVEL);
    if (level && Number(level[1]) <= cutAt) { t = t.slice(0, m.index); break; }
  }

  t = t.replace(/<document\b[^>]*>/gi, '\n\n');
  t = t.replace(TITLE, m => {
    const inner = collapse(unlink(m.replace(/<\/?title\b[^>]*>/gi, '')));
    return inner ? `\n\n## ${inner.replace(/\n+/g, ' ')}\n\n` : '\n\n';
  });
  // A spell's variants are labelled by an inline action cost and nothing else: strip the
  // tag and Heal's three-action list becomes three unattributed sentences.
  t = t.replace(/<actions\b[^>]*\bstring="([^"]*)"[^>]*>/gi, (_, cost) => {
    const icons = actionIcons(cost);
    return icons ? ` **${icons}** ` : ' ';
  });
  t = t.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '\n');
  t = t.replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n\n');
  t = t.replace(/<br\b[^>]*>/gi, '\n');
  t = t.replace(/<[^>]*>/g, ' ');
  t = unlink(t);

  // Fireball and friends separate the heightened block with another rule; a paragraph
  // break carries the same meaning here and costs no vertical space.
  t = t.split('\n').map(l => (RULE.test(l) ? '' : l)).join('\n');

  t = collapse(t).replace(/\n{3,}/g, '\n\n');
  // A list item wrapped onto the next line reads as a new paragraph otherwise.
  t = t.replace(/\n\n(?=- )/g, '\n');
  return t || null;
}

/**
 * `{ text, stats }` for one AoN markdown blob: the prose, and the stat-block pairs.
 * `drop` names the labels the caller already holds as fields, so they are not repeated.
 */
export function fromMarkdown(md, { drop = [], cutAt = 2 } = {}) {
  if (!md) return { text: null, stats: [] };
  const { header, body } = halves(md);
  const skip = new Set(['source', ...drop.map(d => d.toLowerCase())]);
  return {
    text: bodyText(body, { cutAt }),
    stats: headerPairs(header).filter(p => !skip.has(p.label.toLowerCase()))
  };
}

/**
 * The named sections of a body, as `{ name, text }`.
 *
 * A Pathbuilder sheet lists sub-features as if they were entries of their own — a
 * guardian has "Ever Ready", a kineticist has "Dual Gate", an alchemist has "Versatile
 * Vials" — but AoN has no page for any of them: they are sections inside Guardian's
 * Techniques, Kinetic Gate and Alchemy. This is how they get their rules text without
 * anyone typing it in.
 *
 * A heading is the usual delimiter. `bold: true` also treats a paragraph or list item
 * that opens in bold as a section, which is how the kineticist's gate junctions and the
 * "Expand the Portal" threshold benefit are written. That form is loose enough to turn
 * a spell's "**Critical Success**" into a section, so it is only safe when the caller is
 * looking for one particular name.
 */
export function sections(text, { bold = false } = {}) {
  if (!text) return [];
  const out = [];
  let current = null;
  for (const line of String(text).split('\n')) {
    const head = line.match(/^## (.+)$/);
    const lead = bold && line.match(/^(?:- )?\*\*([^*\n]{3,60})\*\*\s*(.*)$/);
    if (head) {
      out.push((current = { name: head[1], lines: [] }));
    } else if (lead) {
      out.push((current = { name: lead[1], lines: [lead[2]] }));
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out
    .map(s => ({
      name: collapse(s.name).replace(/\.$/, ''),
      text: collapse(s.lines.join('\n')).replace(/\n{3,}/g, '\n\n')
    }))
    .filter(s => s.name && s.text);
}

// --- creature stat blocks ----------------------------------------------------

/**
 * AoN writes the minus sign in creature damage as an en dash — `1d6–1 piercing` is
 * U+2013, not a hyphen — and `roll()` in src/pf2e.js only understands `[+-]`, so every
 * dash shape is folded to a hyphen before a number is read out of one. 57 of the 1,084
 * strikes in a 600-creature sample carry one; left alone each parses as a clean `1d6`
 * with the penalty silently dropped, which is the worst kind of wrong.
 */
const dashes = s => String(s ?? '').replace(/[‐-―−]/g, '-');

/**
 * The stat block proper, without the variant boxes AoN appends below it.
 *
 * A dragon's page ends with a "Red Dragon Spellcasters" `<aside>` whose bold labels look
 * exactly like ability blocks, and most pages carry a creature-family `<document>` after
 * that. Everything this module wants sits between the AC line and the first of those.
 */
function statBlock(md) {
  const s = dashes(String(md ?? '').replace(/\r\n?/g, '\n'));
  const from = Math.max(0, s.indexOf('**AC**'));
  const cut = s.slice(from).search(/<aside\b|<document\b/i);
  return cut === -1 ? s : s.slice(0, from + cut);
}

/** Save names as the rest of the app keys them: creature.saves is {fort, ref, will}. */
const SAVE_KEYS = { fortitude: 'fort', reflex: 'ref', will: 'will' };

/** A trait parenthetical, lowercased but with its values kept: `reach 20 feet`. */
function strikeTraits(blob) {
  return collapse(unlink(String(blob ?? '')))
    .split(',')
    .map(t => t.replace(/[_*]/g, '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The damage clause, which runs to the end of its line and no further. `<br />` ends it
 * on the pages that have no blank line after the Strike (Petitioner), and the next bold
 * label ends it everywhere else.
 */
function damageClause(tail) {
  const m = tail.match(/^([\s\S]*?)(?=\n\s*\n|\n\s*\*\*|<br|<\/|<column|<row|<actions|$)/);
  return collapse(unlink(m ? m[1] : ''))
    .replace(/[_*]/g, '')
    .replace(/[\s.;,]+$/, '') || null;
}

function readStrike(kind, head, tail) {
  const cost = head.match(/<actions\b[^>]*\bstring="([^"]*)"/i);
  const line = collapse(unlink(head.replace(/<[^>]*>/g, ' ')));
  // `hand +24 (finesse, magical),` — the trailing comma is AoN's, not a separator.
  const m = line.match(/^(.*?)\s*([+-]\d+)\s*(?:\(([^)]*)\))?\s*,?\s*$/);
  if (!m) return null;
  const name = m[1].replace(/[_*]/g, '').replace(/^[\s,]+|[\s,]+$/g, '');
  if (!name) return null;
  return {
    name,
    kind,
    bonus: Number(m[2]),
    damage: damageClause(tail),
    traits: strikeTraits(m[3]),
    actions: cost ? collapse(cost[1]) : null
  };
}

/**
 * Every Strike a creature's stat block lists, in the order the block lists them.
 *
 * The order matters: the Elasticsearch document has `attack_bonus` and
 * `strike_damage_average` arrays, but **both are sorted ascending rather than kept in
 * stat-block order** — an Adult Red Dragon is `[27,27,29,29]` and `[24,31,32,41]` against
 * a block reading jaws +29, claw +29, tail +27, wing +27 — so pairing them by index
 * invents a +27 wing attack dealing 41 damage. The markdown is the only correct source;
 * those arrays are good for nothing but a coverage check.
 *
 * `damage` stays the raw clause ("2d10+9 piercing plus Knockdown"). Reading dice out of
 * it is `parseDamage()` in src/pf2e.js, which has to exist anyway for PC weapons and for
 * spell text, and two parsers that must agree is one too many.
 */
export function creatureStrikes(md) {
  const s = statBlock(md);
  const out = [];
  for (let m, re = /\*\*(Melee|Ranged)\*\*/gi; (m = re.exec(s));) {
    const rest = s.slice(m.index + m[0].length);
    const at = rest.indexOf('**Damage**');
    // Past the next Strike heading is a different Strike, whose damage line this one
    // would otherwise reach forward and swallow.
    const next = rest.search(/\*\*(?:Melee|Ranged)\*\*/i);
    if (at === -1 || (next !== -1 && at > next)) continue;
    const strike = readStrike(
      m[1].toLowerCase(), rest.slice(0, at), rest.slice(at + '**Damage**'.length)
    );
    if (strike) out.push(strike);
  }
  return out;
}

/**
 * The offensive abilities a creature can actually spend actions on.
 *
 * Only blocks carrying an `<actions>` tag are kept, and that filter is the whole point:
 * a stat block writes `**Sneak Attack**` and `**Siphon Life**` in exactly the same shape
 * as `**Breath Weapon**`, and without the tag a simulator reads those riders as free
 * damage and fires them every turn. The tag is what separates an action a monster can
 * take from a note about its Strikes.
 *
 * An ability with no parseable damage still comes through with nulls — it costs actions,
 * so a fight that ignores it should be able to say which ones it ignored.
 */
export function creatureAbilities(md) {
  const s = statBlock(md);
  const out = [];
  // The tag must be on the ability's own line: a Strike writes `**Melee**` and puts its
  // <actions> on the next one, and horizontal-only whitespace here keeps them apart.
  const re = /^\*\*([^*\n]{2,60}?)[^\S\n]*\*\*[^\S\n]*<actions\b[^>]*\bstring="([^"]*)"[^>]*>([\s\S]*?)(?=\n\s*\n|\n\*\*|$)/gim;
  for (let m; (m = re.exec(s));) {
    const name = collapse(unlink(m[1])).replace(/[_*]/g, '').trim();
    if (!name || /^(?:melee|ranged)$/i.test(name)) continue;
    const body = collapse(unlink(m[3].replace(/<[^>]*>/g, ' ')));
    const lead = body.match(/^\s*\(([^)]*)\)/);
    const damage = body.match(/(\d+d\d+(?:[+-]\d+)?)\s+([a-z]+)\s+damage/i);
    const check = body.match(/DC\s+(\d+)(?:\s+(basic))?(?:\s+(Fortitude|Reflex|Will))?/i);
    const again = body.match(/again\s+for\s+(\d+d\d+|\d+)\s+round/i);
    out.push({
      name,
      actions: collapse(m[2]),
      traits: lead ? strikeTraits(lead[1]) : [],
      damage: damage ? `${damage[1]} ${damage[2].toLowerCase()}` : null,
      dc: check ? Number(check[1]) : null,
      save: check && check[3] ? SAVE_KEYS[check[3].toLowerCase()] : null,
      basic: Boolean(check && check[2]),
      recharge: again ? again[1] : null
    });
  }
  return out;
}

/** Both at once, which is the shape the creature mapper in fetch-aon.mjs wants. */
export function creatureOffence(md) {
  return { strikes: creatureStrikes(md), abilities: creatureAbilities(md) };
}

// --- names -------------------------------------------------------------------

// Apostrophes vanish rather than splitting a word, so a sheet that writes "Rescuers
// Press" still reaches "Rescuer's Press".
const norm = s => String(s ?? '').toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const words = s => norm(s).split(' ').filter(Boolean);

/** Levenshtein distance, capped: only ever asked whether it is 0 or 1 here. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    row = next;
  }
  return row[b.length];
}

/** Is every word of `inner` present in `outer`, in order? */
function subsequence(inner, outer) {
  let at = 0;
  for (const w of inner) {
    at = outer.indexOf(w, at) + 1;
    if (at === 0) return false;
  }
  return true;
}

/**
 * How `candidate` relates to the `wanted` name a character sheet wrote, or null when
 * the two are not the same thing. Deliberately narrow: a wrong match puts the wrong
 * rules text on a sheet, which is worse than no text at all.
 *
 *   exact     the same name once punctuation and case are ignored
 *   longer    the sheet dropped a prefix or an inner word: Pathbuilder's "Sentry
 *             Dedication" is "Lastwall Sentry Dedication", and its "Reinforcing
 *             (Lesser)" is "Reinforcing Rune (Lesser)"
 *   spelling  one word differs by a single character, which is how "Repulse the Wicked"
 *             reaches AoN's "Repulse the Wicken"
 *   category  the sheet appended what the entry is: "Spore Order" is the druidic order
 *             named "Spore"
 */
export function nameMatch(wanted, candidate, category = '') {
  const w = words(wanted);
  const c = words(candidate);
  if (!w.length || !c.length) return null;
  if (w.join(' ') === c.join(' ')) return 'exact';

  if (w.length >= 2 && c.length > w.length && c.length <= w.length + 2 && subsequence(w, c)) {
    return 'longer';
  }

  // Two words at least: on a one-word name a single character is the whole difference
  // between a Shovel and a Shove, and between a kholo's Bite and a Kite.
  if (w.length === c.length && w.length >= 2) {
    const off = w.map((x, i) => (x === c[i] ? null : i)).filter(i => i !== null);
    const at = off[0];
    if (off.length === 1 && w[at].length >= 4 && distance(w[at], c[at]) === 1) return 'spelling';
  }

  const tail = w[w.length - 1];
  if (w.length === c.length + 1 && subsequence(c, w.slice(0, -1))
      && norm(category).split(' ').includes(tail)) {
    return 'category';
  }
  return null;
}
