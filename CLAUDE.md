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
- **Every view gets a brand new host node.** `mount(root)` delegates its events from the
  node it is handed, and those listeners live on the node itself — `root.innerHTML = ''`
  does not remove them. `render()` in `app.js` therefore *replaces* `#view` on each switch
  (`freshRoot()`); do not go back to reusing one element. Reusing it stacked one set of
  handlers per mount, and the symptoms did not look like a listener bug: one tap on
  "+ condition" opened two sheets, so closing one left another behind, and −1 HP took off
  a point per mount.
- **Escape interpolated values.** Creature names, character names, and loot notes are
  user input and go through `esc()` from `src/dom.js`.
- **Bump `CACHE_NAME` in `service-worker.js`** whenever assets change, and add new files
  to `OFFLINE_URLS`. Otherwise installed phones keep the old app.
- **A combatant carries a `ref` back to the record it came from** — set in
  `sendToCombat()` and `addPC()`. Look records up through it, never by name: names repeat
  across the bestiary. `merge()` in `store.js` replaces the combatants array wholesale, so
  rows saved before `ref` existed do not have one and fall back to a name match; that
  fallback refuses an ambiguous name rather than guessing.
- **The shell updates as one unit.** `index.html`, everything under `src/`, `styles.css`
  and `manifest.json` are served network-first with the cache as an offline fallback
  only. Do not "optimise" them to cache-first: that pairs a new `index.html` with a
  stale `app.js`, so a newly added tab renders while its route does not exist and the
  tab silently does nothing for a whole session. Only `data/` and `icons/` are
  cache-first.
- **`cachePut()` stores two cross-origin hosts on purpose.** Cinzel and Inter come from
  `fonts.googleapis.com` and `fonts.gstatic.com`, and a cross-origin stylesheet or font is
  requested no-cors, so the response is *opaque*: `ok` is false and `status` is 0 even on
  success. `storable()` therefore accepts `type === 'opaque'` for those two origins only —
  do not simplify it back to a plain same-origin test, which is what left the app rendering
  in `system-ui`/Georgia whenever it was offline. They cannot go in `OFFLINE_URLS`: the
  `woff2` URLs live inside the stylesheet and vary by browser, so they are cached on first
  use. Nothing else cross-origin is cached — an opaque response hides its own failures.
- **The icons come in two pairs and both are listed in the manifest.** `icon-192/512.png`
  are `purpose: "any"`; `icon-maskable-192/512.png` are the same art inset to 90% for
  `purpose: "maskable"`, because Android masks an adaptive icon to a circle and the plain
  art overflows that safe zone by a few pixels at the d20's top and bottom points. Replace
  all four together, and keep maskable content inside the middle 80%. The art follows the
  same tokens as the app — `--accent` `#b592f6` on `--bg` `#0c0c10` — so recolouring the
  palette means recolouring these too; they were gold against a warm dark until the
  purple accent landed, and looked like a different app on the home screen.

- **Paths stay relative; the service worker derives its own base.** The app is deployed to
  GitHub Pages under `/pf2e-gm-toolkit/`, not a domain root, so a leading-slash path works
  locally and 404s only in production. `BASE` in `service-worker.js` comes from
  `new URL('./', self.location)` and `isLive()` tests against it — it used to be a literal
  `'/src/'`, which matched nothing on Pages and silently turned the whole shell
  cache-first. Bumping `CACHE_NAME` is what makes a deploy reach an installed phone.

## Rules accuracy

Encounter budgets, treasure-by-level, and level DCs are transcribed from the published
tables. Do not "fix" those numbers from memory — check a source. If a rule is
version-dependent (pre- vs post-Remaster), say which one the table follows.

`threatFor()` and `threatScale()` have to agree. A threat band starts at its own budget
and runs to the next budget up — an encounter is low the moment it reaches the low budget
and stays low until it reaches moderate — so a gauge band that *ends* at its budget puts
the needle in one band while the header names another. `extreme` is also the point where
`threatFor()` starts saying "beyond extreme", which the gauge folds into its last band.

## Reference data

`data/*.json` is **generated**, never hand-edited — with one exception below.
Regenerate with `npm run data` (see README, "Reference data"). Editing a generated file
by hand loses the change on the next pull.

**Two files are exceptions and `fetch-aon.mjs` never touches either.** Do not add them to
`TARGETS` and do not regenerate them:

- `data/campaign.json` — hand-authored campaign notes.
- `data/characters.json` — the player-character roster, written by
  `tools/import-pathbuilder.mjs` from Pathbuilder 2e exports.
- `data/codex.json` — full rules text for what those characters use, written by
  `tools/fetch-codex.mjs`. It is derived from `characters.json`, so **re-run
  `npm run codex` after any character import** or new feats will list with no
  description. Anything it cannot match is recorded under `unmatched` and given a
  **homebrew stub** — an entry with the name, `homebrew: true` and no text — so the sheet
  can still list and open it. Stubs are generated, never hand-written: do not put rules
  text in one, and do not remove the `unmatched` list that reports them.

Two things about the codex are easy to get wrong:

- **Look entries up through `aliases`, not by name alone.** A sheet name often differs
  from the name the Archives file it under — "Sentry Dedication" is "Lastwall Sentry
  Dedication", an Everburning Torch is now an Everlight Crystal — and `aliases` maps one
  to the other. A view that builds a name map straight from `entries` silently loses
  every one of them.
- **`text` is light markdown, not plain prose.** Blank lines separate paragraphs, `## `
  marks a sub-heading, `- ` a bullet, `**` bold. Render it with `rich()` from
  `src/dom.js`, which escapes first; `esc()` alone prints the `##` and `**` on screen.

User-typed data is separate again: session notes live in `state.notes` and
device-imported PCs in `state.characters.extra`, both in `localStorage`, so nothing in
`data/` can clobber them.

When importing a character, do not invent derived numbers. AC comes straight from the
export because Pathbuilder has already folded in armour, runes and situational bonuses;
weapon attack bonuses are not derived at all because the export's fields do not
decompose reliably into a to-hit. Everything that *is* derived goes through `src/pf2e.js`
and must have a test.

The files follow the **Remaster** wherever a rule exists in both editions; pre-Remaster
content never reprinted is still included. Each file states this in `_ruleset`. Keep the
`_licence` header and the per-record `source` — the ORC/OGL redistribution depends on
that attribution.

Fields are sparse by design: the generator drops empty values, so most records are
missing most optional fields. Do not build features that assume a field is populated for
every record — a handful of AoN records lack even a `name`, and the tool drops those
rather than shipping a record no view can render. Look records up by `id`, never by
`name` — names repeat across runes, variant items, and a handful of creatures.

Filter dropdowns come from `src/facets.js` and are chosen by the data, not per screen: a
field becomes a filter when the loaded records hold two or more values for it. Add a field
to `CANDIDATES` there and every category that carries it gains the filter; do not special-
case a category in a view. The candidate list is an allowlist on purpose — the records also
carry Bulk, AC and Hardness, and "any field with few values" turns those into dropdowns.

`data/traits.json` carries a `groups` field — AoN's own `trait_group`, e.g. `Creature
Type`, `Rarity`, `Weapon`, `School`. The encounter planner's Type dropdown is built from
it, so do not drop it from the traits target; a hardcoded list of creature types would go
stale the next time Paizo adds one.

`data/index.json` is the manifest the Library builds its picker from. To add a
category, add it to `TARGETS` in the tool and re-run — **no view change is needed**, and
none should be written. The manifest is only rewritten on a full run.

## CSS is one global namespace

There is no scoping, no modules, and later rules win specificity ties. `.chips`/`.chip`
belong to the combat tracker's condition chips; the Library and Campaign pickers had to
become `.picker`/`.pick` after a silent override. Grep `styles.css` for a class name
before introducing it, and prefer specificity over ordering when a rule must hold — the
party header inputs use `.party-chip label input` for exactly that reason.

A `.picker` strip inside a bottom sheet needs `flex:0 0 auto` — `.sheet` is a flex column,
so without it a long list below squashes the chip strip into a row of empty outlines. That
rule now lives on `.picker` itself; do not remove it.

Hover descriptions are the exception to "views own their DOM": `tip(text)` writes a
`data-tip` attribute and `installTips()` in `src/dom.js` owns the single `.tip` element
that shows it. Do not build a CSS-only tooltip inside a bottom sheet — `.sheet` scrolls
its own content, so anything positioned inside one is clipped at its edge.

**A hover description says what the thing mechanically does, in 150 characters.** Two
pieces do that, and a new call site should use them rather than passing prose straight in:

- `brief()` in `src/dom.js` is what `tip()` runs everything through. Rules prose opens with
  flavour and reaches the mechanics afterwards, so it skips whole sentences until one says
  something mechanical, then keeps whole sentences up to the limit. Pass a smaller limit
  when you are appending something of your own, the way the condition chips do.
- `recordTip()` in `src/records.js` is the description for anything out of `data/*.json`.
  Do not use `record.notes` for a tooltip: AoN's `summary` is flavour for creatures and
  items — ecology, or what the thing looks like — and it is truncated mid-sentence besides.
  `recordTip()` builds the line out of the record's own mechanical fields instead, and only
  lets the blurb through for the categories where it is the effect (spells, feats, actions).

Where the mechanics live past AoN's own truncation there is nothing to recover — a handful
of conditions (Drained, Frightened) still read as flavour or trail off, because the
generator only has the truncated `summary` to work with. Fixing that means teaching
`fetch-aon.mjs` to keep the full condition text, not working around it in a view.

Flex items also inherit from the base `button` rule. `.tab` needs both `min-width:0` (or
it will not shrink below min-content and the last tab clips off the viewport) and
`padding:0` (the base rule's `0 14px` ate half of every tab cell and ellipsised the
labels). Measure the tab bar at 390px after adding a tab — do not trust a screenshot.

## Mobile first

The target is a phone held one-handed while GMing. Tap targets stay at 44px minimum,
the tab bar is thumb-reachable, and nothing should require horizontal scrolling.
Test at 390px wide before anything larger.
