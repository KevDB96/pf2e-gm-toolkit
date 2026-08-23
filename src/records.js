// What a data/*.json record does, in one line, for a hover description.
//
// The `notes` AoN files under `summary` are flavour far more often than mechanics — a
// creature's summary is its ecology, an item's is what it looks like — and a GM hovering a
// row mid-session wants the numbers: AC and HP for a creature, the action cost and save
// for a spell, price and damage for a weapon. So the line is built from the record's own
// mechanical fields, and the blurb only gets a look-in with whatever room is left, and
// only if it fits whole.
//
// Pure: no DOM, no storage, no fetch. Field names are the ones tools/fetch-aon.mjs writes.

import { brief, caps } from './dom.js';

/** How long one line may be, and how long any single segment of it may be. */
const LINE = 150;
const SEGMENT = 52;

const mod = n => (n >= 0 ? '+' : '') + n;

// Object-valued fields read as "Fort +30, Ref +27, Will +33": the keys are names of things
// and the data stores them lowercase, so caps() gives them their capitals.

/**
 * The mechanical fields worth a segment, in the order they should read.
 *
 * An allowlist, like the facet candidates: the records also carry prerequisites, triggers
 * and stealth DCs written as whole sentences, and those belong on the detail sheet rather
 * than in a one-line summary. Fields missing from a category are simply skipped, so one
 * list covers every category — `ac`/`hp` are creatures and hazards, `range`/`save` are
 * spells, `damage`/`priceRaw` are equipment.
 *
 * `label` is omitted where the value says what it is: "Two Actions", "1d10 S", "1 gp".
 */
const STATS = [
  { field: 'actions' },
  { field: 'ac', label: 'AC' },
  { field: 'hp', label: 'HP' },
  { field: 'hardness', label: 'Hardness' },
  { field: 'saves', modifier: true },
  { field: 'weaknesses', label: 'Weak' },
  { field: 'resistances', label: 'Resist' },
  { field: 'immunity', label: 'Immune' },
  { field: 'perception', label: 'Per', modifier: true },
  { field: 'speed', label: 'Speed' },
  { field: 'range', label: 'Range' },
  { field: 'target' },
  { field: 'save', label: 'Save' },
  { field: 'traditions' },
  { field: 'damage' },
  { field: 'priceRaw' },
  { field: 'bulkRaw', label: 'Bulk' },
  { field: 'hands', label: 'Hands' }
];

/** One field as it reads in the line, or '' when the record does not carry it. */
function segment(record, spec) {
  const value = record[spec.field];
  if (value === null || value === undefined || value === '') return '';

  let text;
  if (Array.isArray(value)) {
    if (!value.length) return '';
    text = value.join(', ');
  } else if (typeof value === 'object') {
    const parts = Object.entries(value).map(([key, n]) =>
      `${caps(key)} ${typeof n === 'number' && spec.modifier ? mod(n) : n}`);
    if (!parts.length) return '';
    text = parts.join(', ');
  } else if (typeof value === 'number') {
    text = spec.modifier ? mod(value) : String(value);
  } else {
    text = String(value);
  }
  return spec.label ? `${spec.label} ${text}` : text;
}

/**
 * A record's hover description: its mechanical line, then its blurb if there is room.
 *
 * Segments are added in order until the line is full, so what gets dropped is always the
 * least important thing — a creature keeps AC, HP and its saves and loses its list of
 * resistances, never the other way round. A segment longer than SEGMENT on its own is
 * skipped rather than allowed to fill the line: five resistances at 15 each is a stat
 * block, not a summary.
 *
 * The blurb is only appended if it fits whole. AoN truncates its own summaries mid-sentence
 * and a description that trails off into an ellipsis is the thing this is meant to replace
 * — except when the record has no mechanical fields at all, where a clipped blurb still
 * beats no description.
 *
 * And only for records whose blurb is about what they do. A creature, a hazard or an item
 * is summarised by its numbers, and AoN's summary for one is its ecology or what it looks
 * like; a spell, feat or action has few numbers to give and its summary *is* the effect —
 * "An explosion of fire in an area burns creatures." — which is the whole point of a hover
 * description.
 */
const statted = r =>
  (r.ac !== undefined && r.hp !== undefined) || r.priceRaw !== undefined || r.bulkRaw !== undefined;

export function recordTip(record, limit = LINE) {
  if (!record) return '';

  const segments = [];
  for (const spec of STATS) {
    const text = segment(record, spec);
    if (!text || text.length > SEGMENT) continue;
    if ([...segments, text].join(' · ').length > limit) break;
    segments.push(text);
  }

  const stats = segments.join(' · ');
  const room = limit - (stats ? stats.length + 3 : 0);
  const flavour = stats && statted(record);
  const note = room >= 24 && !flavour ? brief(record.notes, room) : '';
  const usable = note && (!stats || !note.endsWith('…'));
  return [stats, usable ? note : ''].filter(Boolean).join(' · ');
}
