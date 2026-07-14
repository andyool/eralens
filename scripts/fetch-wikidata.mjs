#!/usr/bin/env node
/**
 * Fetch thousands of real historical events from Wikidata and write them to
 * `public/events.json`, which the app loads in preference to the in-repo seed.
 *
 * Run in an environment with outbound network access:
 *     npm run fetch:wikidata
 *
 * This is intentionally simple and best-effort: it pulls occurrences that carry
 * a "point in time" (P585), ranks them by sitelink count as a significance
 * proxy, and maps their types onto EraLens categories. Tune the query below to
 * taste (add wars/treaties/discoveries slices, other languages, etc.).
 *
 * Wikidata asks that scripts send a descriptive User-Agent — please keep one.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'EraLens/0.1 (https://github.com/; historical timeline clone) node-fetch'
const LIMIT = Number(process.env.ERALENS_LIMIT ?? 6000)
const MIN_SITELINKS = Number(process.env.ERALENS_MIN_SITELINKS ?? 10)

// One query over all of history times out on WDQS (60 s cap), so we slice the
// timeline into ranges and run one small query per slice. Each slice first
// narrows to the top-N most-sitelinked dated items (a cheap range scan thanks
// to hint:rangeSafe), then joins the detail properties only for those.
const TIME_SLICES = [
  [-3000, 500],
  [500, 1200],
  [1200, 1500],
  [1500, 1700],
  [1700, 1800],
  [1800, 1850],
  [1850, 1900],
  [1900, 1915],
  [1915, 1930],
  [1930, 1945],
  [1945, 1960],
  [1960, 1970],
  [1970, 1980],
  [1980, 1990],
  [1990, 2000],
  [2000, 2010],
  [2010, 2020],
  [2020, 2030],
]

function isoYear(year) {
  const abs = String(Math.abs(year)).padStart(4, '0')
  return `${year < 0 ? '-' : ''}${abs}-01-01T00:00:00Z`
}

// P585 = point in time, P580 = start time (wars, pandemics and other duration
// events carry P580 instead of P585 — we date those by their start and query
// them separately, because a UNION defeats WDQS's range-scan optimisation).
// P31 = instance of, P18 = image, P625 = coordinates, P582 = end time,
// P361 = "part of" (battle → war → conflict) which gives us the hierarchy.
function sliceQuery(fromYear, toYear, limit, dateProp) {
  return `
SELECT ?item ?itemLabel ?date ?image ?coord ?links ?enTitle
       (MIN(?end) AS ?endDate)
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?partOf; separator="|") AS ?parents) WHERE {
  {
    SELECT DISTINCT ?item ?date ?links WHERE {
      ?item wdt:${dateProp} ?date .
      hint:Prior hint:rangeSafe true .
      FILTER("${isoYear(fromYear)}"^^xsd:dateTime <= ?date && ?date < "${isoYear(toYear)}"^^xsd:dateTime)
      ?item wikibase:sitelinks ?links .
      FILTER(?links >= ${MIN_SITELINKS})
      # Calendar units (years, decades, …) carry P585 + huge sitelink counts
      # and would crowd out real events — drop them.
      MINUS {
        VALUES ?junkType { wd:Q577 wd:Q3186692 wd:Q39911 wd:Q578 wd:Q36507 wd:Q18340514 }
        ?item wdt:P31 ?junkType .
      }
    }
    ORDER BY DESC(?links)
    LIMIT ${limit}
  }
  OPTIONAL {
    ?item wdt:P31 ?type .
    ?type rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en")
  }
  OPTIONAL { ?item wdt:P582 ?end . }
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P361 ?partOf . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> ;
             schema:name ?enTitle .
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}
GROUP BY ?item ?itemLabel ?date ?image ?coord ?links ?enTitle
`
}

const CATEGORY_RULES = [
  [/(war|battle|siege|conflict|invasion|revolt|revolution|campaign)/i, ['wars']],
  [/(treaty|election|coup|empire|state|monarch|president|politic|independence)/i, ['politics']],
  [/(disease|pandemic|epidemic|earthquake|eruption|flood|famine|disaster|hurricane)/i, ['disasters']],
  [/(discovery|scientific|experiment|theory)/i, ['science']],
  [/(invention|technolog|spaceflight|mission|launch)/i, ['technology']],
  [/(painting|sculpture|artwork|exhibition)/i, ['art']],
  [/(novel|book|poem|literature|publication)/i, ['literature']],
  [/(symphony|opera|album|song|music)/i, ['music']],
  [/(religio|council|church|papal|caliph)/i, ['religion']],
  [/(expedition|voyage|exploration|circumnavigation)/i, ['exploration']],
  [/(building|monument|bridge|cathedral|construction|tower)/i, ['construction']],
  [/(treaty|trade|economic|financial|market|company)/i, ['economics']],
  [/(protest|suffrage|rights|abolition|emancipation)/i, ['rights']],
]

function typesToCategories(typesStr) {
  const cats = new Set()
  for (const [re, list] of CATEGORY_RULES) {
    if (re.test(typesStr)) list.forEach((c) => cats.add(c))
  }
  if (cats.size === 0) cats.add('politics')
  return [...cats]
}

function parseDate(iso) {
  // Wikidata dates look like "+1969-07-20T00:00:00Z" or "-0044-03-15T00:00:00Z".
  const m = /^([+-]?\d+)-(\d\d)-(\d\d)/.exec(iso)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  let precision = 'day'
  if (month === 1 && day === 1) precision = 'year'
  return { year, month: month || undefined, day: day || undefined, precision }
}

function significanceFromLinks(links) {
  // ~12 sitelinks → ~55, ~150+ → ~98. Log scaled.
  const s = 40 + Math.log2(links) * 9
  return Math.max(40, Math.min(98, Math.round(s)))
}

async function runQuery(query) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}&format=json`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(70_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (err) {
      console.warn(`  attempt ${attempt} failed: ${err.message}`)
      if (attempt === 4) throw err
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }
}

async function main() {
  console.log(`Querying Wikidata for up to ${LIMIT} events (min ${MIN_SITELINKS} sitelinks)…`)
  const perSlice = Math.ceil(LIMIT / TIME_SLICES.length)
  const bindings = []
  // P585 (point in time) first so it wins the client-side dedupe when an item
  // carries both; P580 (start time) adds duration events like wars/pandemics.
  for (const [dateProp, limit] of [
    ['P585', perSlice],
    ['P580', Math.ceil(perSlice / 2)],
  ]) {
    for (const [from, to] of TIME_SLICES) {
      const json = await runQuery(sliceQuery(from, to, limit, dateProp))
      const rows = json.results.bindings
      console.log(`  ${dateProp} ${from} → ${to}: ${rows.length} rows`)
      bindings.push(...rows)
      await new Promise((r) => setTimeout(r, 500)) // be polite to WDQS
    }
  }

  const seen = new Set()
  const raw = []
  for (const row of bindings) {
    const qid = row.item.value.split('/').pop()
    if (seen.has(qid)) continue
    seen.add(qid)
    const date = parseDate(row.date.value)
    if (!date) continue
    const title = row.itemLabel?.value ?? qid
    if (/^Q\d+$/.test(title)) continue // skip unlabelled entities
    if (/^\d+s?( BCE?)?$/.test(title)) continue // backstop: calendar years/decades
    const links = Number(row.links.value)
    let coordinates
    if (row.coord?.value) {
      const cm = /Point\(([-0-9.]+) ([-0-9.]+)\)/.exec(row.coord.value)
      if (cm) coordinates = [Number(cm[1]), Number(cm[2])]
    }
    const parentQids = (row.parents?.value ?? '')
      .split('|')
      .map((u) => u.split('/').pop())
      .filter(Boolean)
    const end = row.endDate?.value ? parseDate(row.endDate.value) : null
    raw.push({
      qid,
      parentQids,
      event: {
        id: `wd_${qid}`,
        title,
        year: date.year,
        month: date.month,
        day: date.day,
        endYear: end && end.year > date.year ? end.year : undefined,
        precision: date.precision,
        type: 'event',
        categories: typesToCategories(row.types?.value ?? ''),
        significance: significanceFromLinks(links),
        confidence: Math.min(1, 0.5 + links / 200),
        description: '',
        coordinates,
        wikiTitle: row.enTitle?.value ? row.enTitle.value.replace(/ /g, '_') : undefined,
        wikidataId: qid,
      },
    })
  }

  // Wire up the containment hierarchy: link an event to a "part of" parent only
  // when that parent is also in the dataset (so the tree stays consistent).
  const inSet = new Set(raw.map((r) => r.qid))
  let linked = 0
  const events = raw.map((r) => {
    const parent = r.parentQids.find((p) => inSet.has(p) && p !== r.qid)
    if (parent) {
      r.event.parentId = `wd_${parent}`
      r.event.tier = 'event'
      linked++
    }
    return r.event
  })
  console.log(`Linked ${linked} events into "part of" containers.`)

  events.sort((a, b) => a.year - b.year)
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, 'events.json')
  await writeFile(outPath, JSON.stringify(events))
  console.log(`Wrote ${events.length} events → ${outPath}`)
  console.log('Restart the dev server (or rebuild) and EraLens will use them automatically.')
}

main().catch((err) => {
  console.error('Failed to fetch from Wikidata:', err)
  process.exit(1)
})
