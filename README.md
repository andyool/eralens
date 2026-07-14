# EraLens

**An interactive, zoomable map of time — every point is an event, discovery, person, work or historical change, from the Big Bang to today.**

EraLens is a modern, responsive, accessible re-imagining of the (now offline)
[Histography.io](https://histography.io). It renders thousands of historical
moments as a field of particles arranged along an *adaptive* timeline that can
travel from a single year to 13.8 billion years through one control.

This repository is **Stage 1** — the minimum viable product. See
[Roadmap](#roadmap) for what Stage 2 adds.

---

## Highlights

- **Particle canvas** — every event is a dot; horizontal position is its date,
  vertical stacking reveals how densely each period is documented (the
  "waveform" silhouette). Rendered on HTML5 Canvas for smooth animation of
  thousands of points.
- **Nested drill-down (semantic zoom)** — history is a containment hierarchy:
  *moments ⊂ a battle ⊂ a war ⊂ an era*. Zoomed out, a whole war is a single
  bright "aggregate" dot; zoom in (or click it) and it **steps down** into its
  battles, then into the moments inside a battle — e.g. **Hundred Years' War →
  Battle of Agincourt → the eight phases of the fighting**. A breadcrumb shows
  where you are and lets you climb back out. WWII → D-Day → the landings, and the
  Apollo programme → Apollo 11 → the mission's moments are built in too.
- **Illustrative detail (toggle)** — an optional layer adds thousands of clearly
  **badged placeholder** sub-moments so the dense particle cloud and the
  drill-down are there offline with zero setup. Placeholders never assert an
  invented fact; real depth comes from the Wikidata pipeline. Toggle it off to
  see only sourced events.
- **Adaptive (exponential) timeline** — a custom warp function is *linear for
  recent millennia* and *logarithmic for deep time*, joined smoothly, so the
  navigator's sensitivity changes automatically with the era on screen. One
  control spans years to eons.
- **Era presets** — Histography's broad geological sweep (The Beginning → Age of
  Mammals → the ages of Stone/Bronze/Iron) **plus** civilisation-scoped periods
  it lacked (Ancient Egypt, Classical Greece, Roman Empire, Islamic Golden Age,
  Imperial China, Age of Exploration, World Wars, Cold War, Digital Revolution).
- **Category filters with live counts** — multi-select subjects, "only" and
  "clear all", counts that reflect the visible time range.
- **Cursor discovery** — you don't have to hit a tiny dot. The pointer ranks
  nearby events by `0.50·significance + 0.30·proximity + 0.10·media +
  0.10·popularity` and highlights the most interesting one, with a short
  anti-flicker delay.
- **Event cards** — date (precision-aware, from "July 20, 1969" to "13.8 billion
  years ago"), people, place, category tags, summary, **labelled connections**
  (Led to / Caused by / Same people / Same place / Around the same time / Same
  field), and Wikipedia / Wikidata links. Images and richer summaries are pulled
  from Wikipedia on demand and degrade gracefully offline.
- **Search** — titles, people, places and categories, with prefix matching and
  light spelling tolerance.
- **"Feeling lucky"** — Surprise me · A major turning point · On this day ·
  Something obscure.
- **Built for every input** — responsive from phone to desktop; mouse hover,
  touch tap, drag-to-pan, wheel/pinch-zoom, and full **keyboard navigation**
  (arrow keys move between events, Enter opens, Escape closes). Honours
  `prefers-reduced-motion`, offers an accessible **list view**, and announces the
  focused event to screen readers.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

No API keys or backend are required — the app ships with a curated dataset and
runs entirely in the browser.

## Data

Stage 1 ships a **curated, in-repo dataset** of real events spanning cosmic time
to the present (`src/data/events.seed.ts`). It works fully offline.

To scale to **thousands** of structured records, EraLens can load a generated
`public/events.json` in preference to the seed. A best-effort Wikidata fetcher is
included:

```bash
npm run fetch:wikidata          # writes public/events.json
ERALENS_LIMIT=6000 ERALENS_MIN_SITELINKS=8 npm run fetch:wikidata
```

It queries the Wikidata SPARQL endpoint for occurrences with a *point in time*,
ranks them by sitelink count (a significance proxy), maps their types onto
EraLens categories, and wires up the containment hierarchy from the **"part of"
(P361)** property so battles nest under their wars. It needs outbound network
access to `query.wikidata.org`. Restart the dev server afterwards and the larger
dataset loads automatically — the same drill-down UI then works on real data at
scale.

Every event record follows the schema in `src/lib/types.ts`, including uncertain
dates (`day` / `month` / `year` / `circa` / `century` / `geological`), coordinates
(reserved for the Stage-2 map), and optional curated relationships.

## Architecture

```
src/
  lib/
    timeMapping.ts    Adaptive warp (year ⇄ pixel), zoom/pan, drill-to-span, ticks
    hierarchy.ts      Containment forest, decimalYear, level-of-detail selection
    particleField.ts  Canvas engine: LOD layout, aggregation, animation, hit-testing
    illustrative.ts   Optional badged placeholder sub-moments (density + drill-down)
    significance.ts   Selection-score formula + dot sizing
    search.ts         In-memory search index (prefix + fuzzy)
    related.ts        Labelled related-event relationships
    dateFormat.ts     Precision-aware date rendering
    discover.ts       "Feeling lucky" modes
    wiki.ts           Lazy Wikipedia enrichment (image + extract)
    sound.ts          Subtle, off-by-default interaction sounds
    types.ts          Domain types
  data/
    events.seed.ts    Curated real events (Big Bang → today)
    events.ts         Loader (prefers generated events.json, falls back to seed)
    eras.ts           Era presets
    categories.ts     Subject categories
  components/         React UI (Header/Search/Sidebar/EraRail/TimeCanvas/Navigator/EventCard/ListView)
scripts/
  fetch-wikidata.mjs  Optional dataset generator
```

The canvas engine (`ParticleField`) is deliberately imperative and lives outside
React's render loop; React owns the surrounding UI and feeds the field new views,
filters and highlights.

### How the adaptive timeline works

Time-before-present `bp` is warped by

```
warp(bp) = bp                                if bp ≤ 3000 years   (linear zone)
         = 3000 · (1 + ln(bp / 3000))        if bp > 3000 years   (log zone)
```

Both the main view and the bottom navigator are linear interpolations in this
warped space, which is what makes a small drag advance a year near the present
but tens of millions of years in deep time — using the same handle.

### How the nested drill-down works

Events form a containment forest via `parentId` (a battle's parent is its war).
`buildForest` precomputes each node's subtree time-span and descendant count.
On every view change the field runs **level-of-detail selection**: walking the
forest top-down, a container whose on-screen span is wider than a threshold is
"opened" into its children; otherwise it collapses to a single aggregate dot
(sized by how much it contains). So the same field shows a war as one dot when
zoomed out and its individual moments when zoomed in — and clicking an aggregate
zooms to its span. Sub-day moments carry a fractional-day position so the phases
of a single battle spread out once you zoom to that day.

The optional Wikidata dataset gets real hierarchy from the **"part of" (P361)**
property, so battles nest under their wars automatically.

## Accessibility

- Keyboard navigation across events; visible focus rings.
- Accessible **list view** alternative to the canvas.
- `prefers-reduced-motion` snaps animations instead of tweening.
- ARIA roles/labels on the search combobox, filter toggles, navigator sliders and
  event dialog; a live region announces the focused event.
- Sound is **off by default** and clearly toggleable; nothing autoplays.

## Roadmap (Stage 2)

Saved events & collections · comparison mode (e.g. *Rome vs Han China*) · map
view (coordinates already in the schema) · curated editorial stories & teacher
timelines · multilingual sources · multi-signal significance controls · citation
& source-quality indicators · accounts · sharing & embeds.

## Attribution

Event summaries and images are fetched at runtime from **Wikipedia** (CC BY-SA).
Structured data can be sourced from **Wikidata** (CC0) via the included script.
EraLens is an independent educational project inspired by Matan Stauber's
Histography.
