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

// P585 = point in time, P31 = instance of, P18 = image, P625 = coordinates,
// P361 = "part of" (battle → war → conflict) which gives us the hierarchy.
const QUERY = `
SELECT ?item ?itemLabel ?date ?image ?coord ?links ?enTitle
       (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?partOf; separator="|") AS ?parents) WHERE {
  ?item wdt:P585 ?date .
  ?item wikibase:sitelinks ?links .
  FILTER(?links >= ${MIN_SITELINKS})
  ?item wdt:P31 ?type .
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P625 ?coord . }
  OPTIONAL { ?item wdt:P361 ?partOf . }
  OPTIONAL {
    ?article schema:about ?item ;
             schema:isPartOf <https://en.wikipedia.org/> ;
             schema:name ?enTitle .
  }
  ?type rdfs:label ?typeLabel . FILTER(LANG(?typeLabel) = "en")
  SERVICE wikibase:label { bd:serviceLabel bd:serviceParam wikibase:language "en" . }
}
GROUP BY ?item ?itemLabel ?date ?image ?coord ?links ?enTitle
ORDER BY DESC(?links)
LIMIT ${LIMIT}
`

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

async function main() {
  console.log(`Querying Wikidata for up to ${LIMIT} events (min ${MIN_SITELINKS} sitelinks)…`)
  let json
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}?query=${encodeURIComponent(QUERY)}&format=json`, {
        headers: { Accept: 'application/sparql-results+json', 'User-Agent': USER_AGENT },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      json = await res.json()
      break
    } catch (err) {
      console.warn(`Attempt ${attempt} failed: ${err.message}`)
      if (attempt === 4) throw err
      await new Promise((r) => setTimeout(r, attempt * 2000))
    }
  }

  const seen = new Set()
  const raw = []
  for (const row of json.results.bindings) {
    const qid = row.item.value.split('/').pop()
    if (seen.has(qid)) continue
    seen.add(qid)
    const date = parseDate(row.date.value)
    if (!date) continue
    const title = row.itemLabel?.value ?? qid
    if (/^Q\d+$/.test(title)) continue // skip unlabelled entities
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
    raw.push({
      qid,
      parentQids,
      event: {
        id: `wd_${qid}`,
        title,
        year: date.year,
        month: date.month,
        day: date.day,
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
