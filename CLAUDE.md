# PF2e GM Toolkit — working notes

Read [README.md](README.md) first; it covers the layout, how to run the app, and the
conventions. This file only records the things that are easy to get wrong.

## Non-negotiables

- **No build step, no framework, no dependencies.** Plain HTML + CSS + ES modules,
  served statically. If a change would need bundling or `npm install`, propose it first
  rather than introducing it.
- **`src/pf2e.js` stays pure.** Rules tables and maths only: no DOM access, no
  `localStorage`, no `fetch`. It is the module worth unit-testing and the one place rules
  numbers belong.
- **Views own their DOM, not the state format.** A view mutates `state` and calls
  `save()`. `store.js` handles persistence and notifies the active view.
- **Escape interpolated values.** Creature names, character names, and loot notes are
  user input and go through `esc()` from `src/dom.js`.
- **Bump `CACHE_NAME` in `service-worker.js`** whenever assets change, and add new files
  to `OFFLINE_URLS`. Otherwise installed phones keep the old app.

## Rules accuracy

Encounter budgets, treasure-by-level, and level DCs are transcribed from the published
tables. Do not "fix" those numbers from memory — check a source. If a rule is
version-dependent (pre- vs post-Remaster), say which one the table follows.

`data/creatures.json` is placeholder data. Do not present it as real Pathfinder content
and do not build features that assume the fields are populated for every creature.

## Mobile first

The target is a phone held one-handed while GMing. Tap targets stay at 44px minimum,
the tab bar is thumb-reachable, and nothing should require horizontal scrolling.
Test at 390px wide before anything larger.
