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
- **`#subnav` is a persistent node outside `#view`, and stays that way.** It is the
  segmented strip that switches between a group's screens (Run: Encounters/Combat;
  Table: Party/Loot/Campaign). `#view` gets replaced wholesale on every navigation —
  the note above — so `#subnav`'s click listener is bound exactly once at boot, by
  delegation, even though `render()` rewrites its buttons with `innerHTML` on every
  switch. Binding it from inside `render()` instead would stack one handler per
  navigation, the same failure mode as the `#view` one, just on a node that never gets
  torn down to shed the extras.
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

## How work gets done here

For this repository, Claude plans and a Sonnet 5 subagent implements — Claude itself
acts as orchestrator, not editor. That split exists because the two jobs pull in
different directions: reading the code, weighing an approach, and checking an ambiguous
request against the user before touching anything wants patience and judgement, while
actually writing the diff is mechanical once the approach and the constraints are
settled. So Claude reads the relevant files, decides how the change should be made, and
resolves anything unclear with the user first — then hands the edits themselves to a
Sonnet 5 subagent, along with the files it needs to touch, the conventions above that
apply, and concrete acceptance criteria. The subagent's report of what it did is not
the end of the task: Claude verifies the result against the criteria and runs the test
suite itself rather than taking that report at face value, the same way a stale
`CACHE_NAME` or a missed `esc()` call would pass a subagent's own account of its work.
This holds even for changes that look small — a one-line fix is still a diff someone
has to trust, and the split does not have a size exception.

## Every BGM control is a link, not a button

`.bgm-die` is an `<a href>` whose target is already chosen before the tap, and a die's
click handler re-rolls its href *afterwards*, on a `setTimeout(0)`. The die was a
`<button>` calling `window.open()` first, which a phone blocks as a popup — so the tap
did nothing at all on the one device that matters. And a whole track row is an anchor
rather than a row containing an "open" button, which is what lets the play glyph stay
small without dropping the tap target under 44px.

`rolled` is each pool's *next* pick and `handed` is what it last opened. They are separate
because any re-render rebuilds the dice, and the line naming what is playing has to
survive that — it used to be written straight into the DOM, so opening a folder wiped it.

## The combat tracker's valued conditions

A condition chip is still a plain string — "Frightened 2" encodes its value the same way
"Persistent Damage (fire)" already encoded its damage type. That is deliberate, not an
oversight left for later: it means nothing in `store.js` migrates, and a combatant saved
by an older version of the app, with a bare "Frightened" chip and no number on it, keeps
working without a conversion step. Anything that looks a chip up has to go through
`conditionName()` — never the raw string — or the tooltip and the implied-condition chain
(prone also sets off-guard, grabbed also sets off-guard and immobilized) silently stop
firing the moment a value gets appended to the name they were matching on.

`endOfTurnConditions()` in `src/pf2e.js` automates exactly one rule — Frightened decreases
by 1 at the end of the affected creature's own turn — and that narrowness is the point,
not a gap to close later:

- Stunned and Slowed are deliberately left alone even though both carry a value. They cut
  actions at the *start* of a turn, not the end, so ticking them here would be ticking
  them at the wrong moment; and Stunned's decrease is by however many actions were actually
  lost to it, a number only the GM at the table knows and the app has no way to see.
- Persistent damage gets a reminder, never a roll. The chip is left exactly as it is and
  `endOfTurnConditions()` prints the damage type and the flat-check DC instead, because
  persistent damage is rolled and saved against at the table — see "Rules accuracy" below —
  and the app does not roll dice on the GM's behalf.

Read this before "improving" the tick to decrement everything with a number on it: the
three exclusions above are why it does not, and each one is a different reason.

## The screen wake lock

`src/wake.js` holds a Screen Wake Lock while a screen a GM leaves open through a fight —
Combat, BGM — is showing; `app.js` calls `keepAwake()` from `render()` with exactly that
condition, and releases it for every other screen, because Home and the Library are not
where a phone sits face-up on the table burning battery.

Two things make it defensive rather than a straightforward `request()`/`release()` pair.
The browser drops the lock on its own the instant the page is hidden — the GM's own phone
locking the screen, or switching apps to check a rule — so it has to be re-requested on
`visibilitychange` whenever the page comes back and a lock is still wanted; skipping that
would leave the screen dimming again after the very first interruption. And the API is
simply absent on some targets — older iOS, any non-secure context — where every path has
to fail silently by design: a missing `navigator.wakeLock` or a rejected request is a
normal outcome here, not an error worth logging, because there is nothing the app can do
about it beyond letting the phone dim a little sooner than it would elsewhere.

## Rules accuracy

Encounter budgets, treasure-by-level, and level DCs are transcribed from the published
tables. Do not "fix" those numbers from memory — check a source. If a rule is
version-dependent (pre- vs post-Remaster), say which one the table follows.

`threatFor()` and `threatScale()` have to agree. A threat band starts at its own budget
and runs to the next budget up — an encounter is low the moment it reaches the low budget
and stays low until it reaches moderate — so a gauge band that *ends* at its budget puts
the needle in one band while the header names another. `extreme` is also the point where
`threatFor()` starts saying "beyond extreme", which the gauge folds into its last band.

`adjustedLevel()`, `adjustedHP()` and `adjustedAC()` in `src/pf2e.js` transcribe the
Elite and Weak creature adjustments from their own AoN pages (IDs 3264 and 3265) — check
those, not memory, before touching the numbers. Two things in them are easy to
"simplify" away by mistake: the level change has a special case at the bottom of each
scale (elite is +2, not +1, at level -1 or 0; weak is -2, not -1, at level 1 specifically,
not level 0), and the HP bands key off the creature's *starting* level, before the level
adjustment, not after. Weak's own HP table starts at level 1 and says nothing about level
0 or -1, which the app allows a creature to be — there is no rule to quote for that gap,
so a sub-1 creature takes the lowest band as the nearest fit, a choice the app makes
rather than a number Paizo published, and the result is floored at 1 either way so
nothing documents a dead or negative-HP creature.

## Reference data

`data/*.json` is **generated**, never hand-edited — with one exception below.
Regenerate with `npm run data` (see README, "Reference data"). Editing a generated file
by hand loses the change on the next pull.

**Some files are exceptions and `fetch-aon.mjs` never touches them.** Do not add them to
`TARGETS` and do not regenerate them:

- `data/campaign.json` — hand-authored campaign notes.
- `data/soundtrack.json` — the BGM groups. A group with `random: true` is a pool a die
  draws from, and the two kinds of pool have opposite length rules. `Combat` and `Boss`
  must hold **single videos of at least 30 minutes**, because a roll has to cover a whole
  fight; `Victory` holds fanfares that are seconds long, because that is what a victory
  sting is. Adding a track means checking its real duration, not trusting a title that
  says "1 Hour" — and verifying the id still resolves, since a fanfare uploaded by a
  small channel is the kind of link that goes private. `Ambience` and `Situational` are
  picked by hand and carry no die.
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

AoN's `actions_number` looks like an action count and is not one — it is the sort key the
Archives use internally, a duration in seconds (Free Action 0, Reaction 1, an action 2,
so Two Actions 4, "1 minute" 60, "1 hour" 3600). `fetch-aon.mjs` used to carry it through
as `actionCount`, and `src/facets.js` turned it into an "Actions" dropdown offering a GM
the choice of 0, 2, 4, 6, 60, 3600 — meanwhile every spell, feat and action detail sheet
printed a second, contradictory "Actions" row alongside the real one. `actions` (the
string — "Single Action", "1 hour") is the only action-cost field the app should ever
read; the Library's Actions filter is a facet over that string, ordered by `ACTION_ORDER`
rather than sorted as a number.

`data/traits.json` carries a `groups` field — AoN's own `trait_group`, e.g. `Creature
Type`, `Rarity`, `Weapon`, `School`. The encounter planner's Type dropdown is built from
it, so do not drop it from the traits target; a hardcoded list of creature types would go
stale the next time Paizo adds one.

`data/index.json` is the manifest the Library builds its picker from. To add a
category, add it to `TARGETS` in the tool and re-run — **no view change is needed**, and
none should be written. The manifest is only rewritten on a full run.

`data/search.json` is the name index behind global search (`src/search.js`,
`searchIndex()` in `src/data.js`) — id, name and level per record, keyed by category
name. It is **not a category**: never add it to `TARGETS`, and it must never appear in
`data/index.json`'s `categories` array or the Library's category picker. Like
`index.json`, it is only rewritten on a full run; a partial run (named targets on the
command line) leaves it alone rather than dropping the categories not requested.

## CSS is one global namespace

There is no scoping, no modules, and later rules win specificity ties. `.chips`/`.chip`
belong to the combat tracker's condition chips; the Library and Campaign pickers had to
become `.picker`/`.pick` after a silent override. Grep `styles.css` for a class name
before introducing it, and prefer specificity over ordering when a rule must hold — the
party header inputs use `.party-chip label input` for exactly that reason.

A `.picker` strip inside a bottom sheet needs `flex:0 0 auto` — `.sheet` is a flex column,
so without it a long list below squashes the chip strip into a row of empty outlines. That
rule now lives on `.picker` itself; do not remove it.

A sheet that browses a long list — the bestiary picker is the first — cannot size itself
by content the way `.sheet` normally does: the match count swings from 0 to 60 on every
keystroke, and `.modal` anchors the sheet to the bottom edge, so it visibly grows and
shrinks upward as the count changes. `.sheet-browse` fixes the sheet's height instead and
gives its list `flex:1 1 auto; min-height:0` so the list is the only part that scrolls.

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
