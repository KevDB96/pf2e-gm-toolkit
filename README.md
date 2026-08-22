# PF2e GM Toolkit

An offline-first phone-sized web app for running Pathfinder 2e at the table:
encounter planner, combat tracker, bestiary lookup, and loot distribution.

No build step. It is plain HTML, CSS, and ES modules — open it in a browser and it runs.

## Running it

```powershell
.\serve.ps1              # tiny PowerShell static server on http://localhost:8001/
# or
npm start                # npx http-server on http://localhost:5501/
```

A real server is required (not `file://`) because the app uses ES modules, `fetch`
for the data files, and a service worker.

## Tests

```powershell
npm test                 # node --test, no dependencies
```

The suite covers `src/pf2e.js` — the XP band, encounter budgets, threat naming, XP
awards, treasure by level, coin conversion, and dice parsing — plus a schema check on
`data/creatures.json`.

## The four screens

| Screen | What it does |
| --- | --- |
| **Encounters** | Add creatures and hazards, see the running XP total against the trivial/low/moderate/severe/extreme budgets for your party size, then push the roster into the combat tracker. |
| **Combat** | Initiative order, round counter, HP with quick ±1/±5 buttons, and condition chips. |
| **Bestiary** | Search the bundled creature data by name or trait, read a compact stat block, add it straight to the encounter. |
| **Loot** | The level's expected treasure budget in coins, a running hoard, and per-character claims. |

Party level and PC count live in the header and drive every calculation. Everything
persists to `localStorage` under the key `pf2e-gm-toolkit/v1`.

## Bestiary data

**`data/creatures.json` currently ships placeholder stat blocks**, not real Pathfinder
creatures. They exist so the UI has something to render. Before using the bestiary at
the table, replace the `creatures` array with a real import that matches `_schema` in
that file.

Options for a real dataset:

- The Foundry VTT `pf2e` system publishes creature data as JSON, released under the ORC
  licence.
- Archives of Nethys is the official free rules reference and can be scraped.
- The sibling `PF2e Loot` project in this account already has a `scraper.js` that could
  be pointed at creature pages and made to emit this schema.

## Layout

```
index.html            app shell: header, view slot, tab bar
styles.css            all styling; design tokens live in :root
service-worker.js     offline cache — bump CACHE_NAME whenever assets change
src/app.js            router, party header, view dispatch
src/store.js          localStorage-backed state + subscribe/save
src/pf2e.js           pure rules tables and maths (XP, budgets, treasure, DCs, dice)
src/dom.js            qs / esc / event delegation / bottom-sheet modal
src/views/*.js        one module per screen, each exporting mount() and update()
data/creatures.json   bestiary source data
```

### Adding a view

Create `src/views/thing.js` exporting `mount(root)` and optionally `update(root)`,
register it in the `VIEWS` map in [src/app.js](src/app.js), add a `.tab` button in
[index.html](index.html), and list the new file in `OFFLINE_URLS` in
[service-worker.js](service-worker.js).

### Conventions

- Rules maths goes in `src/pf2e.js` and stays pure — no DOM, no storage. It is the part
  worth being right.
- Views read `state`, mutate it, then call `save()`. `save()` persists and re-renders the
  active view; views never write to `localStorage` themselves.
- Interpolating anything user-entered into an HTML string goes through `esc()`.
- Bump `CACHE_NAME` in the service worker on every asset change, or phones will serve
  a stale app.

## Licence and content

Code here is the project's own. Pathfinder 2e rules content is Paizo's; any imported
creature or item data must respect its ORC/OGL terms and keep its attribution.
