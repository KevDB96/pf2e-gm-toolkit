# PF2e GM Toolkit

An offline-first phone-sized web app for running Pathfinder 2e at the table: encounter
planner, combat tracker, a full rules library, loot distribution, and campaign notes.

No build step. It is plain HTML, CSS, and ES modules — open it in a browser and it runs.

## Running it

```powershell
.\serve.ps1              # tiny PowerShell static server on http://localhost:8001/
# or
npm start                # npx http-server on http://localhost:5501/
```

A real server is required (not `file://`) because the app uses ES modules, `fetch`
for the data files, and a service worker.

## Deploying

The app is served straight from the repository by GitHub Pages, from the root of `main`:

**https://kevdb96.github.io/pf2e-gm-toolkit/**

Pushing to `main` is the deploy. There is nothing to build, so a push is live within a
minute or two. Two things make that work under a subpath rather than a domain root:

- **Every path in the app is relative.** `index.html`, the manifest and the service
  worker all use `./`-style URLs, so the same files run at `/` locally and at
  `/pf2e-gm-toolkit/` on Pages. Do not introduce a leading-slash path — it resolves to
  `kevdb96.github.io/src/...` and 404s only in production.
- **`BASE` in [service-worker.js](service-worker.js)** is derived from the worker's own
  location, and `isLive()` tests against it. This used to be a literal `'/src/'`, which
  matched locally and matched nothing on Pages — quietly flipping the whole shell to
  cache-first, the one thing it must never be.

`.nojekyll` is present so Pages publishes the tree verbatim instead of running it through
Jekyll.

To install it on a phone: open the URL in the browser and use *Add to Home Screen*. It
then launches standalone and works offline, warming the small reference files on first run
and caching the large ones as you open them.

`icons/` holds two pairs. `icon-192.png` and `icon-512.png` are the plain icons; the
`icon-maskable-*.png` pair is the same art inset to 90% so it survives the circular mask
Android applies to an adaptive icon. Both pairs are listed in the manifest with the
matching `purpose`. Replacing the art means replacing all four — a maskable icon whose
content strays outside the middle 80% gets its corners clipped on the home screen. The art
uses the same tokens as the app, `--accent` on `--bg`, so it should be recoloured whenever
the palette is.

## Tests

```powershell
npm test                 # node --test, no dependencies
```

The suite covers `src/pf2e.js` — the XP band, encounter budgets, threat naming and gauge,
XP awards, treasure by level, loot selection, coin conversion and splitting, feat grouping,
skill lists, and dice parsing — plus the Pathbuilder conversion, the filter facets in
`src/facets.js`, the rules-text renderer in `src/dom.js`, the Archives document reader in
`tools/aon-text.mjs` including its creature-Strike parser, and a schema check on
`data/creatures.json`.

## The screens

| Screen | What it does |
| --- | --- |
| **Home** | The landing menu. One tile per screen, each showing what is waiting there. |
| **Plan** (Encounters) | Add creatures and hazards, watch the needle move across a gauge that runs trivial on the left to extreme on the right, then push the roster into the tracker — or pull it from the tracker instead. The bestiary picker filters by type, size, rarity, family, trait, a level range, the party's XP band, or name. |
| **Combat** | Both sides of the fight at once: the party down the left, enemies down the right, each column in initiative order, with a round counter and whose turn it is above them. The planned encounter comes in with one tap from here, or gets pushed over from the planner. Initiative is typed in — the die is rolled at the table — and each row prints the Perception modifier to add to it. HP is a typed number and a bar you drag, nothing else on the row. A condition applies everything the rules attach to it — prone also sets off-guard, grabbed also sets off-guard and immobilized — and persistent damage asks which damage type. PCs come straight out of the imported roster: tick a few or take the whole party, with AC, HP and Perception from the sheet. Anything added picks its side, so a charmed PC or a friendly NPC lands in the right column. |
| **Library** | One browser over all sixteen reference categories. Search by name, trait or summary, and filter on whatever fields the category has — a level range, type, tradition, size, rarity, category, group; creatures also filter to the party's XP band and add straight to an encounter. |
| **Loot** | The level's expected treasure budget in coins, a running hoard, per-character claims, and a rolled selection of usable items at the party's level or one above it — with the leftover handed out as gold, split evenly and already claimed. Every suggestion opens on the Archives of Nethys from the row, so an item can be read before it goes in the hoard. |
| **Campaign** (Notes) | Where the campaign is now, every arc with its beats, the NPC roster, reference tables — and your own session notes. |
| **Party** | The player characters, grouped by campaign or one-shot. Each opens a GM-facing sheet: AC, HP, saves, Perception, every skill trained or not, class DC, spellcasting, and feats grouped by category with their action costs. |
| **BGM** | Open the built-in campaign tracks in the official YouTube app, or save additional named YouTube links on this device. A Premium account can keep playback running in the background. |

Hovering anything with a description shows what it mechanically does, in a line: a creature's AC, HP and saves, a spell's cost, range and save, what a condition does to you and what it applies alongside itself.

Party level and PC count live in the header and drive every calculation. Everything
persists to `localStorage` under the key `pf2e-gm-toolkit/v1`.

**The threat gauge.** `threatScale()` in [src/pf2e.js](src/pf2e.js) lays the five bands out
from trivial to extreme, each as wide as the XP range it covers, so the gauge
re-proportions itself when the party size changes. A band starts at its *own* budget and
runs to the next one up, which is how `threatFor()` names a total — that is what keeps the
needle and the threat name from disagreeing, and it is worth preserving: an earlier version
had bands ending at their budgets, which put the needle in "low" while the header still
read "Trivial". Past the extreme budget the needle keeps a band's worth of headroom and the
name becomes "beyond extreme".

**Filters.** [src/facets.js](src/facets.js) drives the dropdowns above every browsable
list — the Library's and the encounter planner's bestiary picker. Which dropdowns appear is
decided by the records themselves: a field becomes a filter when the loaded category holds
at least two values for it, so spells get Rank, Type and Tradition, equipment gets Category,
Group and Damage type, hazards get Hazard type and Complexity, and none of that is wired
per category. The candidate fields are an allowlist rather than "anything enumerable" — the
records also carry Bulk, AC and Hardness, and a dropdown of AC values is noise.

Each dropdown is faceted: it lists what is still reachable through the *other* filters,
with counts, so a choice never narrows to nothing. Type comes from the traits AoN files
under "Creature Type" (the `groups` field in `data/traits.json`), and only when those
describe at least half the records — otherwise a few dragonhide items would give the
equipment list a creature-type dropdown. Trait is the catch-all for everything the other
axes do not cover.

**Loot suggestions.** `lootSelection()` picks from `data/equipment.json` at exactly the
party's level or one higher — the band the treasure tables hand out — skipping anything
unpriced and the categories that are not treasure (services, materials, cursed items; see
`NOT_LOOT`). It draws round-robin across categories rather than at random over the whole
band, or a roll lands on eight wands and calls it a hoard, and it fills to the level's own
treasure allowance rather than to a fixed number of items: it skips anything that would
overshoot by more than a twentieth and stops within a tenth of the target, which lands
between 92% and 105% of budget across levels 1–19. Whatever the items leave short is added
as gold, split evenly with `splitEvenly()` and claimed for each character, so a suggestion
hands out exactly what the level is owed. The split is in copper so nothing is lost to
rounding, and if the loot roster is empty it is filled from the committed campaign
characters first — there is no separate "split coins" step to remember.

**Hover descriptions.** On a machine with a mouse, anything that has a summary shows it on
hover: a feat or item on a character sheet, a spell in a caster's list, a Library row, a
condition chip in the tracker. Add one by interpolating `tip(text)` from
[src/dom.js](src/dom.js) into the tag — `installTips()` in the shell does the rest, from
one reused `position:fixed` card so a scrolling bottom sheet cannot clip it. Touch devices
get nothing, deliberately: a tap fires `mouseover` with no `mouseout` to follow, which
would leave the card stranded over the row it describes.

## Reference data

`data/` is generated from the Elasticsearch index behind
[Archives of Nethys](https://2e.aonprd.com), the official free rules reference:

```powershell
npm run data                          # all sixteen categories
node tools/fetch-aon.mjs creatures    # just one
node tools/fetch-aon.mjs --legacy     # keep pre-Remaster duplicates too
```

Sixteen files, 22,245 records, 9.8 MB:

| Category | Records | Category | Records |
| --- | ---: | --- | ---: |
| creatures | 3,743 | archetypes | 248 |
| equipment | 6,823 | deities | 484 |
| spells | 1,811 | rituals | 162 |
| feats | 6,296 | ancestries | 67 |
| actions | 550 | heritages | 308 |
| hazards | 553 | backgrounds | 518 |
| conditions | 56 | skills | 33 |
| classes | 29 | traits | 564 |

`data/index.json` is the manifest listing every category with its file, key, label and
count. The Library screen builds its picker from it, so **adding a category to
`TARGETS` in the tool puts it in the app with no view change**. The manifest is only
rewritten on a full run; a partial run leaves it alone rather than dropping categories.

Creature records carry their Strikes — name, attack bonus, damage expression and traits —
parsed out of the stat block by [tools/aon-text.mjs](tools/aon-text.mjs), along with
`immunities`, `spellDC` and the activatable abilities under `specials`. That detail is
why `creatures.json` is the largest file here.

The tool keeps the mechanical fields the app computes with and drops the prose fields
(`text`, `markdown`, `search_markdown`), which are ~95% of the raw payload — the full
pull is roughly 132 MB. Every record keeps a `url` back to the Archives for the rules
text, plus its `source` book.

**Which edition:** by default the files hold one copy of each rule, the post-Remaster
one wherever both editions exist. AoN marks a superseded entry with `remaster_id`
pointing at its replacement, so dropping those leaves the current version while keeping
pre-Remaster content that was never reprinted. Each file records this in `_ruleset`.

**Identity:** names are not unique — runes and variant items repeat them, as do a few
creatures — so every record carries a stable `id` from the AoN document id. Look records
up by `id`, never by `name`.

**Shape:** records are sparse. The generator drops empty values, so most records are
missing most optional fields — always guard before reading one.

**Licence:** Pathfinder 2e mechanics are Paizo content published as Open Game Content
under the OGL/ORC licences, which is what makes this redistribution legitimate. Paizo
trademarks and Product Identity are not open content. Each generated file carries the
full notice in `_licence`; do not strip it or the per-record `source`.

## Campaign notes

`data/campaign.json` is **hand-authored and never generated** — `tools/fetch-aon.mjs`
does not touch it. It holds the campaign title, the party, which arc is current, every
arc with its beats and detail sections, the antagonists, the NPC roster, the kings list
and the loot table. Edit it directly to change any of that.

`data/soundtrack.json` is also hand-authored and never generated. It holds the named
YouTube links shown under BGM, separate from the campaign notes.

Session notes typed in the app are a different thing: they live in `state.notes` and
persist to `localStorage`, so regenerating or editing `campaign.json` never touches
them. They are per-device and are not in the repo.

Arc `status` is one of `done`, `current`, `next` or `later`, and drives the badge
colours plus what Home and the Campaign screen report as the current arc.

## Player characters

`data/characters.json` is the committed roster, built from Pathbuilder 2e exports:

```powershell
node tools/import-pathbuilder.mjs export.json
node tools/import-pathbuilder.mjs export.json --group one-shots --player Kevin
```

Re-importing the same character replaces it in place, matched on the id derived from
its name — so levelling a PC up is just exporting from Pathbuilder again and re-running.

`groups` in that file separates the main campaign from one-shots; an unknown `--group`
is created for you and you can edit its label afterwards. The Party screen groups by it,
and Home reports how many PCs are in the campaign.

The Party screen can also import a pasted export directly. Those characters go to
`state.characters.extra` in `localStorage`, are labelled "this device" in the roster, and
are **not** in the repo — use the CLI tool for anyone you want committed.

The conversion lives in [src/pathbuilder.js](src/pathbuilder.js), which is pure and
shared by both paths, so the app and the tool produce identical records. Derived numbers
(HP, saves, Perception, class DC, spell DC, skill bonuses) come from the maths in
`src/pf2e.js` and are covered by tests.

Every skill is stored, trained or not: untrained is the attribute modifier and nothing
else, and the sheet lists all sixteen because a GM calls for Nature from whoever is
standing there. Armour check penalties are in none of the numbers — the export does not
decompose into one — and the sheet says so.

Two deliberate omissions: **AC is taken from the export** rather than recomputed, because
Pathbuilder has already applied armour, runes and situational bonuses that cannot be
reconstructed from the fields it emits. **Weapon attack bonuses are not derived at all** —
the export's `attack` and `damageBonus` fields do not decompose reliably into a to-hit,
and a wrong attack bonus at the table is worse than none, so the sheet says so and shows
only the damage die.

## The codex

The reference files in `data/` drop the prose deliberately — keeping it for all 22,000
entries would be ~132 MB. `data/codex.json` pulls it back for the few hundred things the
party actually has in hand, which comes to under a megabyte:

```powershell
npm run codex                              # after importing or levelling a PC
node tools/fetch-codex.mjs --group one-shots
```

It collects three things, all derived from `data/characters.json`:

- everything named on a sheet — feats, class features, carried items, worn armour and
  weapons **with their runes**, prepared and focus spells, formula books
- the full selectable spell list for each prepared or spontaneous caster, taken from that
  caster's own tradition and highest slot rank rather than hardcoded (Priscilla's primal
  list to rank 4 is 464 spells)
- nothing else — a name that cannot be matched is recorded under `unmatched` and shown on
  the sheet, never invented

A Pathbuilder sheet rarely writes a name the way the Archives file it, so matching runs
in four passes, weakest evidence last, and each entry records which one found it under
`matchedBy`:

1. the exact name on `name.keyword`
2. a name close enough to be the same thing — case, plurals, reordered grades
   (`Defoliation Bomb (Moderate)` is indexed as `Moderate Defoliation Bomb`), a dropped
   prefix (`Sentry Dedication` is `Lastwall Sentry Dedication`), or a one-character
   difference in one word of several (`Repulse the Wicked` is indexed as
   `Repulse the Wicken`)
3. the Remaster replacement, when a name now exists only as legacy content — an
   Everburning Torch resolves to the Everlight Crystal that reprinted it
4. a section of a larger page, for sub-features that have no page of their own: a
   guardian's `Ever Ready` is a section inside the Guardian class, and
   `Field Vials (Bomber)` is one inside the Bomber research field

Anything matched under a different name is listed in `aliases`, which is how the sheet
still finds it. A loose match is only taken when it brings rules text with it: an entry
with a heading and nothing under it would stop being reported as unmatched while telling
the GM no more than the miss did.

Whatever is left — around eighteen genuinely homebrew things, plot items and named
weapons with no rules entry to find — gets a **homebrew stub**: an entry carrying the name
and nothing else, marked `homebrew: true`, so the sheet lists it and opens it like any
other and says plainly that the Archives have nothing for it. A stub never invents rules
text, and every stubbed name stays in `unmatched` so a typo in an import is still visible
in the run's report.

Prose comes from the index's `markdown` field rather than its flattened `text`, parsed by
[tools/aon-text.mjs](tools/aon-text.mjs), so paragraphs, sub-headings and lists survive
and the `Source … pg. 68` citation does not. The same parse keeps the stat-block rows the
index has no field for — a weapon's damage die and hands, an armour's category and check
penalty, a shield's Hardness — under `stats`.

On the Party screen every matched entry becomes tappable and opens its rules text over
the sheet; a caster's full spell list opens as a searchable browser. Re-run `npm run
codex` whenever a character changes, or the new feats will list without descriptions.

## Layout

```
index.html            app shell: header, view slot, tab bar
styles.css            all styling; design tokens live in :root
service-worker.js     offline cache — bump CACHE_NAME whenever assets change
src/app.js            router, party header, view dispatch
src/store.js          localStorage-backed state + subscribe/save
src/pf2e.js           pure rules tables and maths (XP, budgets, treasure, DCs, dice)
src/dom.js            qs / esc / rich text / hover tips / delegation / bottom-sheet modal
src/facets.js         the filter dropdowns, built from whatever fields a category has
src/data.js           lazy, cached loaders for the data files
src/pathbuilder.js    pure Pathbuilder-export converter, shared by app and tool
src/youtube.js        pure YouTube URL validation and embed-URL builder
src/views/*.js        one module per screen, each exporting mount() and update()
data/index.json       manifest the Library reads to build its category list
data/campaign.json    HAND-AUTHORED campaign notes — never regenerated
data/soundtrack.json  HAND-AUTHORED BGM links — never regenerated
data/codex.json       full rules text for what the PCs use — see "The codex"
data/characters.json  player characters — imported, never regenerated by fetch-aon
data/*.json           generated reference data — see "Reference data" above
tools/fetch-aon.mjs          regenerates data/ from Archives of Nethys (Node 18+)
tools/import-pathbuilder.mjs merges a Pathbuilder export into data/characters.json
tools/fetch-codex.mjs        builds data/codex.json from data/characters.json
tools/aon-text.mjs           pure reader for AoN markdown, stat pairs and names
tools/wealth.mjs             values party gear against the published wealth tables
```

### Adding a view

Create `src/views/thing.js` exporting `mount(root)` and optionally `update(root)`,
register it in the `VIEWS` map in [src/app.js](src/app.js), add a `.tab` button in
[index.html](index.html), and list the new file in `OFFLINE_URLS` in
[service-worker.js](service-worker.js).

Adding a *reference category* is different and easier: add it to `TARGETS` in
[tools/fetch-aon.mjs](tools/fetch-aon.mjs) and re-run `npm run data`. The Library picks
it up from the manifest with no view change.

### Conventions

- Rules maths goes in `src/pf2e.js` and stays pure — no DOM, no storage. It is the part
  worth being right.
- Views read `state`, mutate it, then call `save()`. `save()` persists and re-renders the
  active view; views never write to `localStorage` themselves.
- Interpolating anything user-entered into an HTML string goes through `esc()`.
- Rules entries never show a rulebook or page number in the UI. The `source` field stays
  in `data/` for the ORC/OGL attribution, and a single Archives of Nethys link stands in
  its place. Action costs render through `actionIcons()` as ◆ / ◆◆ / ◆◆◆ / ◇ / ⤾, not as
  words.
- Bump `CACHE_NAME` in the service worker on every asset change, or phones will serve
  a stale app.
- The shell (`index.html`, `src/**`, `styles.css`, `manifest.json`) is served
  **network-first**, with the cache only as an offline fallback. It has to update as one
  unit: cache-first left a new `index.html` paired with a stale `app.js`, so a newly
  added tab rendered but its route did not exist and the tab silently did nothing. Only
  `data/`, `icons/` and the Google Fonts files are cache-first.
- Cinzel and Inter are the only cross-origin assets, and they are cached on first use.
  They cannot be precached — the `woff2` URLs live inside the stylesheet and vary by
  browser — so the fonts go offline after one online load, which installing needs anyway.
  Until this was added the app fell back to `system-ui`/Georgia whenever it was offline.
- Colour lives entirely in the `:root` tokens in [styles.css](styles.css) — greyscale
  ground, purple for every primary accent, green for healthy/done/low, and red reserved
  for danger. Each accent has three forms: `--accent` (text/marks), `--accent-soft`
  (tinted fills), `--accent-edge` (tinted borders). Use the tokens; do not hardcode a
  colour or an `rgba()` tint in a rule or a view.
- CSS class names are a flat global namespace and later rules win ties. `.chips`/`.chip`
  already belong to the combat tracker's condition chips; the Library and Campaign
  pickers use `.picker`/`.pick` for exactly that reason. Grep before naming.

## Licence and content

Code here is the project's own. Pathfinder 2e rules content is Paizo's; any imported
creature or item data must respect its ORC/OGL terms and keep its attribution.
