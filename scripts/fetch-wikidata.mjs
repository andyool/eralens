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

// Matched against the event's "instance of" type labels. Word boundaries
// matter: a bare /war/ used to put every aWARd ceremony in Wars & Conflict.
const CATEGORY_RULES = [
  [/sport(s|ing)?\b|\bseason\b|tournament|championship|olympi|world cup|grand prix|\brace\b|racing|\brally\b|football|soccer|cricket|tennis|golf|athletics|marathon|regatta|cycling|boxing|wrestling|motorsport|\bchess\b|basketball|baseball|hockey|rugby|swimming|skiing|skating|snooker|darts|volleyball|badminton|gymnastics|triathlon|rowing|biathlon|fencing|judo|weightlifting|archery|super bowl|uefa|fifa|\bcup\b|\bleague\b|olympiad|aquatics|giro d|tour de france|vuelta|speedway|motocross|\bderby\b|\bmatch\b|qualification event|playoffs?\b|all-star|\bdraft\b|tour of|san remo|roubaix|flanders|liège|lombardia|medal table|\bgames\b|\bfinals\b|\bnba\b|\bnhl\b|\bnfl\b|\bmlb\b/i, ['sports']],
  [/\bwars?\b|\bbattles?\b|\bsieges?\b|(?<!trade )(?<!diplomatic )\bconflict\b|invasion|revolt|rebellion|uprising|revolution|military (campaign|operation|expedition|offensive)|\boffensive\b|massacre|\bmutiny\b|insurgency|airstrike|\braid\b|ambush|skirmish|crusade|bombardment|blockade|pogrom|genocide|terror|\bcoup\b|assassination|bomb attack|\battack\b|shooting|hostage|kidnapping|hijacking|murder\b|robbery|bombing|\bassault\b|storming/i, ['wars']],
  [/treaty|\belection\b|referendum|empire|\bstate\b|monarch|president|politic|independence|\bsummit\b|legislation|parliament|congress|dynasty|kingdom|republic|annexation|secession|constitution|impeachment|inauguration|abdication|proclamation|partition|armistice|peace conference|coronation|\bconvention\b|clandestine|espionage|agreement\b|\bpact\b|accord\b|charter\b|protocol\b|accession|enlargement|statute\b|\bact\b|\bdecree\b|\bedict\b/i, ['politics']],
  [/disease|pandemic|epidemic|earthquake|eruption|\bflood\b|famine|disaster|hurricane|cyclone|typhoon|tsunami|wildfire|\bfires?\b|accident|\bcrash\b|shipwreck|derailment|collision|explosion|landslide|avalanche|drought|blizzard|tornado|\bstorms?\b|sinking|stampede|oil spill|\bwreck\b|conflagration/i, ['disasters']],
  [/discover|scientific|experiment|\btheory\b|observation|\beclipse\b|\bcomet\b|astronomical|supernova|clinical trial|vaccin|expedition.{0,12}research/i, ['science']],
  [/invention|technolog|spaceflight|space (mission|station|probe)|satellite|\blaunch\b|rocket|maiden flight|first flight|nuclear (weapons )?test|computer|software|internet|patent|algorithm/i, ['technology']],
  [/painting|sculpture|artwork|exhibition|\bart\b|\bfilms?\b|cinema|\bmovie\b|theatre|theater|premiere|biennale|ballet|photography/i, ['art']],
  [/\bnovel\b|\bbooks?\b|\bpoem\b|literature|literary|comics?\b/i, ['literature']],
  [/symphony|\bopera\b|\balbum\b|\bsongs?\b|music|concert|eurovision|choral|orchestra/i, ['music']],
  [/religio|ecumenical|\bsynod\b|papal|conclave|caliph|pilgrimage|\bchurch\b|\bmosque\b|\btemple\b|canoniz|beatific|\bhajj\b/i, ['religion']],
  [/expedition|voyage|exploration|circumnavigation|\bascent\b|polar/i, ['exploration']],
  [/building|monument|\bbridge\b|cathedral|construction|\btower\b|\bcanal\b|railway|tunnel|\bdam\b|skyscraper|\bstadium\b/i, ['construction']],
  [/\btrade\b|economic|financial|\bmarket\b|company|merger|bankruptcy|\bstrike\b|recession|stock exchange|currency|world's fair|expo\b/i, ['economics']],
  [/protest|suffrage|rights|abolition|emancipation|demonstration|\briots?\b|boycott|\bmarch\b|sit-in/i, ['rights']],
]

const bit = (id) => 1 << CATEGORY_ORDER.indexOf(id)

/**
 * Categorise from the type labels, with the title as a tie-breaker for award
 * ceremonies — "award ceremony" alone says nothing about whether the Golden
 * Globes (film → art) or the Grammys (music) are being handed out.
 */
function typesToMask(typesStr, title = '') {
  let mask = 0
  for (const [re, list] of CATEGORY_RULES) {
    if (re.test(typesStr)) for (const c of list) mask |= bit(c)
  }
  if (/award|\bprize\b|ceremon|film festival/i.test(typesStr)) {
    const hay = `${title} ${typesStr}`
    if (/grammy|\bmusic\b|billboard|\bmtv\b|brit award|juno|eurovision/i.test(hay)) mask |= bit('music')
    else if (/booker|pulitzer|litera|book fair/i.test(hay)) mask |= bit('literature')
    else if (/peace|humanitarian/i.test(hay)) mask |= bit('rights')
    else if (/nobel|science/i.test(hay)) mask |= bit('science')
    else if (/sport|fifa|laureus|ballon d'or|athlete/i.test(hay)) mask |= bit('sports')
    else mask |= bit('art') // film/TV/stage awards dominate the remainder
  }
  // Cultural catch-alls, only when nothing stronger matched.
  if (mask === 0 && /festival|\bfair\b|pageant|carnival|parade|exposition/i.test(typesStr)) {
    mask = bit('art')
  }
  if (mask === 0) mask = bit('politics')
  return mask
}

// ── Civilizations & regions ──────────────────────────────────────────────
// An event belongs to a civilization when its Wikidata country (P17) or its
// title matches. Country labels are the strong signal (a battle in "Han
// dynasty" is Chinese whatever its name says); titles catch the rest.
// Bit order matters — the loader maps bits by index from the file header.
const CIVS = [
  { id: 'rome', label: 'Rome', start: -753, end: 476, reCountry: /roman empire|roman republic|ancient rome|roman kingdom/i, reTitle: /\broman\b|\brome\b|\bpunic\b|caesar|\blatium/i },
  { id: 'greece', label: 'Ancient Greece', start: -800, end: -146, reCountry: /ancient greece|classical athens|sparta|macedonia \(ancient/i, reTitle: /\bgreek|\bgreece|athens|sparta|hellenistic|macedon|peloponnes/i },
  { id: 'egypt', label: 'Ancient Egypt', start: -3100, end: -30, reCountry: /ancient egypt|ptolemaic/i, reTitle: /\begypt|pharaoh|ptolema/i },
  { id: 'mesopotamia', label: 'Mesopotamia', start: -3500, end: -539, reCountry: /assyria|babylon|sumer|akkad|mesopotam/i, reTitle: /mesopotam|babylon|assyria|sumer|akkad|hittite/i },
  { id: 'persia', label: 'Persia & Iran', start: -550, end: 2026, reCountry: /achaemenid|sasanian|parthian|safavid|qajar|\biran\b|persia/i, reTitle: /\bpersia|achaemenid|sasanian|parthian|\biran(ian)?\b/i },
  { id: 'byzantium', label: 'Byzantium', start: 330, end: 1453, reCountry: /byzantine/i, reTitle: /byzantin|constantinople/i },
  { id: 'islamic', label: 'Islamic World', start: 622, end: 1517, reCountry: /caliphate|umayyad|abbasid|al-andalus|fatimid|seljuk|mamluk/i, reTitle: /caliph|umayyad|abbasid|al-andalus|islamic|\bmuslim|moorish|saracen/i },
  { id: 'ottoman', label: 'Ottoman Empire', start: 1299, end: 1922, reCountry: /ottoman/i, reTitle: /ottoman/i },
  { id: 'china', label: 'China', start: -2070, end: 2026, reCountry: /china|chinese|han dynasty|tang dynasty|song dynasty|yuan dynasty|ming dynasty|qing dynasty|qin dynasty|zhou dynasty|sui dynasty|jin dynasty|wei dynasty|shang dynasty/i, reTitle: /\bchina\b|\bchinese\b/i },
  { id: 'japan', label: 'Japan', start: 250, end: 2026, reCountry: /japan/i, reTitle: /\bjapan(ese)?\b/i },
  { id: 'korea', label: 'Korea', start: -57, end: 2026, reCountry: /korea|joseon|goryeo|silla|goguryeo|baekje/i, reTitle: /\bkorea(n)?\b|joseon|goryeo/i },
  { id: 'india', label: 'India & South Asia', start: -1500, end: 2026, reCountry: /\bindia\b|mughal|maurya|british raj|maratha|gupta|delhi sultanate|pakistan|bangladesh|sri lanka/i, reTitle: /\bindia(n)?\b|mughal|maratha|bengal/i },
  { id: 'mongols', label: 'Mongol Empire', start: 1206, end: 1368, reCountry: /mongol empire|golden horde|ilkhanate|yuan dynasty/i, reTitle: /\bmongol/i },
  { id: 'vikings', label: 'Vikings & Norse', start: 793, end: 1066, reCountry: /viking/i, reTitle: /viking|\bnorse|norsemen|danelaw/i },
  { id: 'hre', label: 'Holy Roman Empire', start: 800, end: 1806, reCountry: /holy roman empire/i, reTitle: /holy roman/i },
  { id: 'france', label: 'France', start: 481, end: 2026, reCountry: /\bfrance\b|french (first |second |third |fourth |fifth )?(empire|republic|kingdom)|west francia|francia/i, reTitle: /\bfrance\b|\bfrench\b|napoleon/i },
  { id: 'britain', label: 'Britain & Empire', start: 927, end: 2026, reCountry: /united kingdom|great britain|kingdom of england|kingdom of scotland|british empire|british raj|british america/i, reTitle: /\bbritish\b|\bbritain\b|\bengland\b|\benglish\b|\bscotland|\bwales\b/i },
  { id: 'spain', label: 'Spain & Portugal', start: 718, end: 2026, reCountry: /\bspain\b|spanish empire|castile|aragon|portugal|portuguese empire|al-andalus/i, reTitle: /\bspain\b|\bspanish\b|\bportug/i },
  { id: 'italy', label: 'Italian States', start: 476, end: 2026, reCountry: /\bitaly\b|kingdom of italy|papal states|republic of venice|republic of florence|republic of genoa|duchy of milan|kingdom of naples|sardinia/i, reTitle: /\bital(y|ian)\b|venice|venetian|florence|\bgenoa|\bmilan|\bnaples/i },
  { id: 'germany', label: 'Germany & Prussia', start: 962, end: 2026, reCountry: /germany|prussia|german empire|weimar|german confederation|bavaria|saxony|brandenburg/i, reTitle: /\bgerman(y)?\b|prussia(n)?\b|bavaria/i },
  { id: 'russia', label: 'Russia & USSR', start: 862, end: 2026, reCountry: /russia|soviet union|russian empire|tsardom|kievan rus|grand duchy of moscow|muscovy/i, reTitle: /\brussia(n)?\b|soviet|\bussr\b|kievan/i },
  { id: 'usa', label: 'United States', start: 1607, end: 2026, reCountry: /united states|confederate states|thirteen colonies|british america/i, reTitle: /\bunited states\b|\bu\.s\.|\bamerican (revolution|civil war)/i },
  { id: 'precolumbian', label: 'Aztec · Maya · Inca', start: -1500, end: 1533, reCountry: /aztec|inca empire|maya/i, reTitle: /aztec|\bmaya(n)?\b|\binca(n)?\b|mesoameric|tenochtitlan/i },
  { id: 'ottomansuccessors', label: 'Middle East (modern)', start: 1918, end: 2026, reCountry: /\biraq\b|\bsyria\b|\bisrael\b|palestine|lebanon|jordan|saudi arabia|\byemen\b|\bturkey\b|\begypt\b|\bkuwait|\bqatar|emirates|bahrain|\boman\b/i, reTitle: /\biraq(i)?\b|\bsyria(n)?\b|\bisrael(i)?\b|palestin|\bleban|\bsaudi\b|\byemen|\bturkey\b|turkish/i },
]

const REGIONS = [
  { id: 'europe', label: 'Europe', reCountry: /france|germany|italy|spain|portugal|united kingdom|great britain|england|scotland|ireland|wales|netherlands|belgium|austria|hungary|poland|russia|sweden|norway|denmark|finland|greece|roman|byzantine|holy roman|prussia|soviet|czech|slovak|yugoslav|switzerland|ukraine|romania|bulgaria|serbia|croatia|bosnia|albania|lithuania|latvia|estonia|iceland|luxembourg|monaco|malta|venice|florence|genoa|papal|castile|aragon|francia|viking|kievan/i },
  { id: 'asia', label: 'Asia & Pacific', reCountry: /china|chinese|dynasty|japan|korea|joseon|goryeo|india|mughal|maurya|raj|mongol|vietnam|thailand|siam|indonesia|philippines|malaysia|myanmar|burma|pakistan|bangladesh|afghanistan|kazakh|uzbek|nepal|sri lanka|cambodia|laos|taiwan|singapore|australia|new zealand|fiji|papua/i },
  { id: 'mideast', label: 'Middle East', reCountry: /ottoman|iran|persia|achaemenid|sasanian|parthian|safavid|iraq|syria|israel|palestine|lebanon|jordan|saudi|yemen|turkey|kuwait|qatar|emirates|bahrain|oman|caliphate|umayyad|abbasid|seljuk|assyria|babylon|sumer|akkad|mesopotam|hittite|phoenicia|byzantine/i },
  { id: 'africa', label: 'Africa', reCountry: /egypt|morocco|algeria|tunisia|libya|ethiopia|nigeria|ghana|kenya|south africa|sudan|congo|carthage|mali|songhai|zulu|rhodesia|angola|mozambique|uganda|tanzania|zimbabwe|senegal|somalia|madagascar|cameroon|ptolemaic/i },
  { id: 'americas', label: 'Americas', reCountry: /united states|confederate|thirteen colonies|canada|mexico|brazil|argentina|chile|peru|colombia|venezuela|cuba|haiti|bolivia|ecuador|uruguay|paraguay|guatemala|nicaragua|panama|jamaica|aztec|inca|maya|new spain|new france|british america/i },
]

// Rough continent bounding boxes for events that have coordinates but whose
// country didn't match a region rule. Checked in order; first hit wins.
function regionFromCoords(lon, lat) {
  if (lon >= -170 && lon <= -30) return 'americas'
  if (lat <= 0 && lon >= 110 && lon <= 180) return 'asia'
  if (lat >= 12 && lat <= 42 && lon >= 26 && lon <= 63) return 'mideast'
  if (lat >= -35 && lat <= 32 && lon >= -18 && lon <= 52) return 'africa'
  if (lat >= 36 && lat <= 72 && lon >= -25 && lon <= 60) return 'europe'
  if (lon > 60 || (lat > 0 && lon > 45)) return 'asia'
  return null
}

function civMaskOf(title, countries) {
  let mask = 0
  for (let i = 0; i < CIVS.length; i++) {
    const civ = CIVS[i]
    if ((countries && civ.reCountry.test(countries)) || civ.reTitle.test(title)) mask |= 1 << i
  }
  return mask
}

function regionMaskOf(countries, lon, lat) {
  let mask = 0
  for (let i = 0; i < REGIONS.length; i++) {
    if (countries && REGIONS[i].reCountry.test(countries)) mask |= 1 << i
  }
  if (mask === 0 && (lon !== 0 || lat !== 0)) {
    const id = regionFromCoords(lon, lat)
    if (id) mask |= 1 << REGIONS.findIndex((r) => r.id === id)
  }
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
       (GROUP_CONCAT(DISTINCT ?nextQ; separator="|") AS ?nexts)
       (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries) WHERE {
  {
    SELECT DISTINCT ?item ?date ?links WHERE {
      ?item wdt:${prop} ?date .
      hint:Prior hint:rangeSafe true .
      FILTER("${isoOfDecimalYear(fromYear)}"^^xsd:dateTime <= ?date && ?date < "${isoOfDecimalYear(toYear)}"^^xsd:dateTime)
      ?item wikibase:sitelinks ?links .
      FILTER(?links >= ${MIN_SITELINKS})
      MINUS {
        VALUES ?junkType { wd:Q577 wd:Q3186692 wd:Q39911 wd:Q578 wd:Q36507 wd:Q18340514 wd:Q47018901 wd:Q13406463 }
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
    ?item wdt:P17 ?country .
    ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en")
  }
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
    if (/^list of /i.test(title)) continue // navigation pages, not events
    // Month pages ("April 1973") carry P585 too — they're calendar plumbing.
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{1,4})?$/.test(title)) continue
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
    const countries = row.countries?.value ?? ''

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
      mask: typesToMask(row.types?.value ?? '', title),
      // 1 = derivable from the label, 0 = no article, string = explicit title
      wiki: enTitle == null ? 0 : enTitle === derivedTitle ? 1 : enTitle,
      lon,
      lat,
      civMask: civMaskOf(title, countries),
      regionMask: regionMaskOf(countries, lon, lat),
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
      nexts.length ? nexts : 0, r.civMask, r.regionMask,
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
    // Civ/region definitions ride along so the app renders filter chips and
    // tags seed events without duplicating the tables. `re` = title regex.
    civs: CIVS.map(({ id, label, start, end, reTitle }) => ({ id, label, start, end, re: reTitle.source })),
    regions: REGIONS.map(({ id, label }) => ({ id, label })),
    // Row layout: [qid, title, year, month, day, endYear, significance,
    //              categoryMask, wiki, lon, lat, parentQid, causes[], effects[],
    //              nexts[], civMask, regionMask]
    events,
  }
  await writeFile(outPath, JSON.stringify(payload))
  console.log(`Wrote ${events.length} events → ${outPath}`)
  console.log('Restart the dev server (or rebuild) and EraLens will use them automatically.')
}

// Exported for the classification audit script; only run the fetch when
// invoked directly.
export { typesToMask, CATEGORY_ORDER, runQuery, buildQuery }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('Failed to fetch from Wikidata:', err)
    process.exit(1)
  })
}
