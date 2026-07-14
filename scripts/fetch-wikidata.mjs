#!/usr/bin/env node
/**
 * Fetch (near) every dated event on Wikidata/Wikipedia and write it to
 * `public/events.json` in a compact format the app expands at load time.
 *
 * Run in an environment with outbound network access:
 *     npm run fetch:wikidata
 *
 * Strategy: WDQS caps queries at 60 s, so no single query can return the whole
 * dataset. We partition the timeline into ranges and fetch each with a plain
 * range-scan (no ORDER BY — we want completeness, not a top-N). Any range that
 * overflows the row cap or times out is split in half and re-queued, so the
 * script adapts to event density automatically. Two passes: P585 (point in
 * time), then P580 (start time) for duration events like wars and pandemics.
 *
 * Wikidata asks that scripts send a descriptive User-Agent — please keep one.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'EraLens/0.2 (https://github.com/; historical timeline clone) node-fetch'
const MIN_SITELINKS = Number(process.env.ERALENS_MIN_SITELINKS ?? 4)
const CAP = Number(process.env.ERALENS_CAP ?? 2500) // rows per query before we split the range
const MIN_SPAN = 0.25 // years; below this we accept a top-by-links truncation
const CONCURRENCY = 3

// Must stay in sync with CategoryId in src/lib/types.ts. Bit positions for the
// compact category mask; the loader reads this list from the file header.
const CATEGORY_ORDER = [
  'cosmos', 'life', 'politics', 'wars', 'science', 'technology', 'art', 'literature',
  'music', 'religion', 'exploration', 'construction', 'disasters', 'rights', 'economics',
  'sports',
]

const CATEGORY_RULES = [
  [/(sport|season|tournament|championship|olympi|world cup|grand prix|race|football|cricket|tennis|golf|athletics|marathon|regatta)/i, ['sports']],
  [/(war|battle|siege|conflict|invasion|revolt|revolution|campaign|offensive|massacre|mutiny|insurgency)/i, ['wars']],
  [/(treaty|election|referendum|coup|empire|state|monarch|president|politic|independence|summit|legislation)/i, ['politics']],
  [/(disease|pandemic|epidemic|earthquake|eruption|flood|famine|disaster|hurricane|cyclone|tsunami|wildfire|accident|crash|shipwreck|derailment)/i, ['disasters']],
  [/(discovery|scientific|experiment|theory|observation|eclipse|comet|conjunction)/i, ['science']],
  [/(invention|technolog|spaceflight|space mission|satellite|launch|rocket)/i, ['technology']],
  [/(painting|sculpture|artwork|exhibition|art )/i, ['art']],
  [/(novel|book|poem|literature|publication)/i, ['literature']],
  [/(symphony|opera|album|song|music|concert|festival)/i, ['music']],
  [/(religio|council|church|papal|caliph|synod|pilgrimage)/i, ['religion']],
  [/(expedition|voyage|exploration|circumnavigation|ascent)/i, ['exploration']],
  [/(building|monument|bridge|cathedral|construction|tower|canal|railway)/i, ['construction']],
  [/(trade|economic|financial|market|company|merger|bankruptcy|strike)/i, ['economics']],
  [/(protest|suffrage|rights|abolition|emancipation|demonstration|riot)/i, ['rights']],
]

function typesToMask(typesStr) {
  let mask = 0
  for (const [re, list] of CATEGORY_RULES) {
    if (re.test(typesStr)) for (const c of list) mask |= 1 << CATEGORY_ORDER.indexOf(c)
  }
  if (mask === 0) mask = 1 << CATEGORY_ORDER.indexOf('politics')
  return mask
}

// ── Time helpers ─────────────────────────────────────────────────────────

/** Decimal year → ISO dateTime, consistent on both sides of a split. */
function isoOfDecimalYear(dy) {
  const y = Math.floor(dy)
  const frac = dy - y
  const d = new Date(Date.UTC(2001, 0, 1 + Math.min(364, Math.floor(frac * 365))))
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const abs = String(Math.abs(y)).padStart(4, '0')
  return `${y < 0 ? '-' : ''}${abs}-${mm}-${dd}T00:00:00Z`
}

/** Starting partition — finer where history is denser; splitting handles the rest. */
function initialRanges() {
  const ranges = [[-10000, 0]]
  const step = (from, to, by) => {
    for (let y = from; y < to; y += by) ranges.push([y, Math.min(to, y + by)])
  }
  step(0, 1500, 250)
  step(1500, 1800, 50)
  step(1800, 1900, 20)
  step(1900, 1950, 10)
  step(1950, 2000, 5)
  step(2000, 2036, 2)
  return ranges
}

// ── Query construction ───────────────────────────────────────────────────
// P585 = point in time, P580/P582 = start/end time, P31 = instance of,
// P625 = coordinates, P361 = part of (hierarchy). Causal net: P828 has cause,
// P1478 has immediate cause, P1537 has contributing factor (→ causes);
// P1542 has effect, P1536 immediate cause of (→ effects); P156 followed by
// (→ "same thread" sequels). Calendar units (years, decades, …) carry P585
// plus huge sitelink counts and would crowd out real events — the MINUS drops
// them.
function buildQuery(prop, fromYear, toYear, ordered) {
  return `
SELECT ?item ?itemLabel ?date ?coord ?links ?enTitle
       (MIN(?end) AS ?endDate)
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?partOf; separator="|") AS ?parents)
       (GROUP_CONCAT(DISTINCT ?causeQ; separator="|") AS ?causes)
       (GROUP_CONCAT(DISTINCT ?effectQ; separator="|") AS ?effects)
       (GROUP_CONCAT(DISTINCT ?nextQ; separator="|") AS ?nexts) WHERE {
  {
    SELECT DISTINCT ?item ?date ?links WHERE {
      ?item wdt:${prop} ?date .
      hint:Prior hint:rangeSafe true .
      FILTER("${isoOfDecimalYear(fromYear)}"^^xsd:dateTime <= ?date && ?date < "${isoOfDecimalYear(toYear)}"^^xsd:dateTime)
      ?item wikibase:sitelinks ?links .
      FILTER(?links >= ${MIN_SITELINKS})
      MINUS {
        VALUES ?junkType { wd:Q577 wd:Q3186692 wd:Q39911 wd:Q578 wd:Q36507 wd:Q18340514 }
        ?item wdt:P31 ?junkType .
      }
    }
    ${ordered ? 'ORDER BY DESC(?links)' : ''}
    LIMIT ${CAP}
  }
  OPTIONAL { ?item wdt:P582 ?end . }
  OPTIONAL {
    ?item wdt:P31 ?type .
    ?type rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en")
  }
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P361 ?partOf . }
  OPTIONAL { ?item wdt:P828|wdt:P1478|wdt:P1537 ?causeQ . }
  OPTIONAL { ?item wdt:P1542|wdt:P1536 ?effectQ . }
  OPTIONAL { ?item wdt:P156 ?nextQ . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> ;
             schema:name ?enTitle .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
GROUP BY ?item ?itemLabel ?date ?coord ?links ?enTitle
`
}

class TimeoutError extends Error {}

async function runQuery(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res
    try {
      res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(75_000),
      })
    } catch (err) {
      // network hiccup / local abort — treat like a timeout so the range splits
      throw new TimeoutError(String(err?.message ?? err))
    }
    if (res.status === 504) throw new TimeoutError('HTTP 504')
    if (res.ok) return res.json()
    if (attempt === 4) throw new Error(`HTTP ${res.status}`)
    const wait = res.status === 429 ? attempt * 8000 : attempt * 3000
    await new Promise((r) => setTimeout(r, wait))
  }
}

function countDistinctItems(rows) {
  const s = new Set()
  for (const row of rows) s.add(row.item.value)
  return s.size
}

// ── Adaptive fetch across the partition ──────────────────────────────────

async function fetchAll() {
  const queue = []
  for (const prop of ['P585', 'P580']) {
    for (const [from, to] of initialRanges()) queue.push({ prop, from, to })
  }

  const allRows = []
  let done = 0
  let truncated = 0

  async function handle(task) {
    const { prop, from, to } = task
    const span = to - from
    const label = `${prop} ${from} → ${to}`
    let rows
    try {
      rows = (await runQuery(buildQuery(prop, from, to, false))).results.bindings
    } catch (err) {
      if (err instanceof TimeoutError && span > MIN_SPAN) {
        const mid = (from + to) / 2
        queue.push({ prop, from, to: mid }, { prop, from: mid, to })
        console.log(`  ${label}: timed out — split at ${mid}`)
        return
      }
      console.warn(`  ${label}: FAILED (${err.message}) — skipping`)
      return
    }
    const distinct = countDistinctItems(rows)
    if (distinct >= CAP) {
      if (span > MIN_SPAN) {
        const mid = (from + to) / 2
        queue.push({ prop, from, to: mid }, { prop, from: mid, to })
        console.log(`  ${label}: ${distinct} hits cap — split at ${mid}`)
        return
      }
      // A tiny range denser than the cap: keep the most-linked slice of it.
      try {
        rows = (await runQuery(buildQuery(prop, from, to, true))).results.bindings
        truncated++
        console.warn(`  ${label}: denser than cap at min span — keeping top ${CAP} by sitelinks`)
      } catch {
        console.warn(`  ${label}: FAILED on ordered fallback — skipping`)
        return
      }
    }
    done++
    allRows.push(...rows)
    if (done % 10 === 0) {
      console.log(`  …${done} ranges done, ${queue.length} queued, ${allRows.length} rows`)
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const task = queue.shift()
      await handle(task)
      await new Promise((r) => setTimeout(r, 150))
    }
  })
  await Promise.all(workers)
  if (truncated > 0) console.warn(`  NOTE: ${truncated} sub-year ranges exceeded the cap and were truncated to the top ${CAP} by sitelinks.`)
  return allRows
}

// ── Row → compact event ──────────────────────────────────────────────────

function parseDate(iso) {
  // Wikidata dates look like "+1969-07-20T00:00:00Z" or "-0044-03-15T00:00:00Z".
  const m = /^([+-]?\d+)-(\d\d)-(\d\d)/.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month === 1 && day === 1) return { year, month: 0, day: 0 }
  return { year, month, day }
}

function significanceFromLinks(links) {
  // links 4 → ~32, 10 → ~43, 100 → ~72, 500+ → ~93. Log scaled, wide range.
  const s = 14 + Math.log2(Math.max(1, links)) * 8.8
  return Math.max(5, Math.min(98, Math.round(s)))
}

function qidsOf(concatValue) {
  if (!concatValue) return []
  return concatValue
    .split('|')
    .map((u) => u.split('/').pop())
    .filter((q) => /^Q\d+$/.test(q))
}

async function main() {
  console.log(`Fetching all Wikidata events with ≥${MIN_SITELINKS} sitelinks (cap ${CAP}/query, ${CONCURRENCY} workers)…`)
  const t0 = Date.now()
  const rows = await fetchAll()
  console.log(`Fetched ${rows.length} rows in ${Math.round((Date.now() - t0) / 1000)}s. Post-processing…`)

  const seen = new Set()
  const raw = []
  for (const row of rows) {
    const qid = row.item.value.split('/').pop()
    if (seen.has(qid)) continue
    const date = parseDate(row.date.value)
    if (!date) continue
    const title = row.itemLabel?.value ?? qid
    if (/^Q\d+$/.test(title)) continue // skip unlabelled entities
    if (/^\d+s?( BCE?)?$/.test(title)) continue // backstop: calendar years/decades
    seen.add(qid)

    const links = Number(row.links.value)
    let lon = 0
    let lat = 0
    if (row.coord?.value) {
      const cm = /Point\(([-0-9.]+) ([-0-9.]+)\)/.exec(row.coord.value)
      if (cm) {
        lon = Math.round(Number(cm[1]) * 100) / 100
        lat = Math.round(Number(cm[2]) * 100) / 100
      }
    }
    const end = row.endDate?.value ? parseDate(row.endDate.value) : null
    const enTitle = row.enTitle?.value ? row.enTitle.value.replace(/ /g, '_') : null
    const derivedTitle = title.replace(/ /g, '_')

    raw.push({
      qid,
      links,
      parents: qidsOf(row.parents?.value),
      causes: qidsOf(row.causes?.value),
      effects: qidsOf(row.effects?.value),
      nexts: qidsOf(row.nexts?.value),
      title,
      year: date.year,
      month: date.month,
      day: date.day,
      endYear: end && end.year > date.year ? end.year : 0,
      sig: significanceFromLinks(links),
      mask: typesToMask(row.types?.value ?? ''),
      // 1 = derivable from the label, 0 = no article, string = explicit title
      wiki: enTitle == null ? 0 : enTitle === derivedTitle ? 1 : enTitle,
      lon,
      lat,
    })
  }

  // Keep hierarchy/relations only when the target is also in the dataset.
  const inSet = new Set(raw.map((r) => r.qid))
  let linked = 0
  let related = 0
  const events = raw.map((r) => {
    const parent = r.parents.find((p) => inSet.has(p) && p !== r.qid) ?? 0
    if (parent) linked++
    const causes = r.causes.filter((q) => inSet.has(q) && q !== r.qid)
    const effects = r.effects.filter((q) => inSet.has(q) && q !== r.qid)
    const nexts = r.nexts.filter((q) => inSet.has(q) && q !== r.qid)
    related += causes.length + effects.length + nexts.length
    return [
      r.qid, r.title, r.year, r.month, r.day, r.endYear, r.sig, r.mask, r.wiki,
      r.lon, r.lat, parent, causes.length ? causes : 0, effects.length ? effects : 0,
      nexts.length ? nexts : 0,
    ]
  })
  events.sort((a, b) => a[2] - b[2])

  console.log(`Kept ${events.length} unique events; ${linked} linked into "part of" containers; ${related} cause/effect links.`)

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, 'events.json')
  const payload = {
    format: 'eralens-compact-1',
    categories: CATEGORY_ORDER,
    // Row layout: [qid, title, year, month, day, endYear, significance,
    //              categoryMask, wiki, lon, lat, parentQid, causes[], effects[],
    //              nexts[]]
    events,
  }
  await writeFile(outPath, JSON.stringify(payload))
  console.log(`Wrote ${events.length} events → ${outPath}`)
  console.log('Restart the dev server (or rebuild) and EraLens will use them automatically.')
}

main().catch((err) => {
  console.error('Failed to fetch from Wikidata:', err)
  process.exit(1)
})
