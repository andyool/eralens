import type { CategoryId, EventRelation, HistEvent } from '../lib/types'
import { SEED_EVENTS } from './events.seed'

/** Seed dataset, sorted oldest → newest. */
export const EVENTS: HistEvent[] = [...SEED_EVENTS].sort((a, b) => a.year - b.year)

export const EVENT_BY_ID: Map<string, HistEvent> = new Map(EVENTS.map((e) => [e.id, e]))

export function getEvent(id: string): HistEvent | undefined {
  return EVENT_BY_ID.get(id)
}

function isValidEvent(x: unknown): x is HistEvent {
  if (!x || typeof x !== 'object') return false
  const e = x as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.year === 'number' &&
    Array.isArray(e.categories)
  )
}

function normTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Compact row emitted by scripts/fetch-wikidata.mjs:
 * [qid, title, year, month, day, endYear, significance, categoryMask, wiki,
 *  lon, lat, parentQid, causes[], effects[], nexts[], civMask, regionMask]
 * where 0 means "absent" and wiki is 1 (derivable from title), 0 (no article)
 * or an explicit article title.
 */
type CompactRow = [
  string, string, number, number, number, number, number, number,
  0 | 1 | string, number, number, string | 0, string[] | 0, string[] | 0, string[] | 0,
  number, number,
]

/** A civilization filter definition shipped inside events.json. */
export interface CivDef {
  id: string
  label: string
  /** Heyday span, used to zoom when the filter is switched on. */
  start: number
  end: number
  /** Title regex source — used to tag seed events that predate the masks. */
  re: string
}

export interface RegionDef {
  id: string
  label: string
}

interface CompactPayload {
  format: 'eralens-compact-1'
  categories: string[]
  civs?: CivDef[]
  regions?: RegionDef[]
  events: CompactRow[]
}

export interface LoadedData {
  events: HistEvent[]
  civs: CivDef[]
  regions: RegionDef[]
}

function isCompactPayload(x: unknown): x is CompactPayload {
  if (!x || typeof x !== 'object') return false
  const p = x as Record<string, unknown>
  return p.format === 'eralens-compact-1' && Array.isArray(p.categories) && Array.isArray(p.events)
}

function expandCompact(payload: CompactPayload): HistEvent[] {
  const catByBit = payload.categories as CategoryId[]
  const out: HistEvent[] = []
  for (const row of payload.events) {
    const [qid, title, year, month, day, endYear, sig, mask, wiki, lon, lat, parent, causes, effects, nexts, civMask, regionMask] = row
    if (typeof qid !== 'string' || typeof title !== 'string' || typeof year !== 'number') continue
    const categories: CategoryId[] = []
    for (let i = 0; i < catByBit.length; i++) if (mask & (1 << i)) categories.push(catByBit[i])
    const relations: EventRelation[] = []
    if (causes) for (const q of causes) relations.push({ id: `wd_${q}`, kind: 'caused_by' })
    if (effects) for (const q of effects) relations.push({ id: `wd_${q}`, kind: 'led_to' })
    if (nexts) for (const q of nexts) relations.push({ id: `wd_${q}`, kind: 'same_movement' })
    out.push({
      id: `wd_${qid}`,
      title,
      year,
      month: month || undefined,
      day: day || undefined,
      endYear: endYear || undefined,
      precision: day ? 'day' : month ? 'month' : 'year',
      type: 'event',
      categories,
      significance: sig,
      description: '',
      coordinates: lon || lat ? [lon, lat] : undefined,
      wikiTitle: wiki === 1 ? title.replace(/ /g, '_') : typeof wiki === 'string' ? wiki : undefined,
      wikidataId: qid,
      parentId: parent ? `wd_${parent}` : undefined,
      tier: parent ? 'event' : undefined,
      relations: relations.length > 0 ? relations : undefined,
      civMask: civMask || undefined,
      regionMask: regionMask || undefined,
    })
  }
  return out
}

/**
 * The curated seed predates the civilization masks — tag its events by title
 * so "Storming of the Bastille" still shows under the France filter.
 */
function tagSeedMasks(civs: CivDef[]): void {
  if (civs.length === 0) return
  const res = civs.map((c) => {
    try {
      return new RegExp(c.re, 'i')
    } catch {
      return null
    }
  })
  for (const ev of EVENTS) {
    if (ev.civMask !== undefined) continue
    let mask = 0
    for (let i = 0; i < res.length; i++) {
      if (res[i]?.test(ev.title)) mask |= 1 << i
    }
    if (mask) ev.civMask = mask
  }
}

/**
 * Merge generated (Wikidata) events into the curated seed. The seed wins on
 * duplicates — it carries descriptions, relations and hand-built moment trees
 * the generated data lacks (and it is the only source of deep-time events,
 * which Wikidata's point-in-time query can't cover). Children of a dropped
 * duplicate are re-parented onto the seed event so hierarchies stay intact.
 */
function mergeWithSeed(generated: HistEvent[]): HistEvent[] {
  const seedByTitle = new Map(EVENTS.map((e) => [normTitle(e.title), e]))
  const remap = new Map<string, string>()
  const kept: HistEvent[] = []
  for (const g of generated) {
    const seed = seedByTitle.get(normTitle(g.title))
    if (seed && Math.abs(seed.year - g.year) <= 2) {
      remap.set(g.id, seed.id)
      continue
    }
    kept.push(g)
  }
  return [
    ...EVENTS,
    ...kept.map((g) => {
      let e = g
      if (e.parentId && remap.has(e.parentId)) e = { ...e, parentId: remap.get(e.parentId) }
      if (e.relations?.some((r) => remap.has(r.id))) {
        e = {
          ...e,
          relations: e.relations!.map((r) => (remap.has(r.id) ? { ...r, id: remap.get(r.id)! } : r)),
        }
      }
      return e
    }),
  ].sort((a, b) => a.year - b.year)
}

/**
 * Load the event dataset. Merges a generated `events.json` (produced by
 * `npm run fetch:wikidata`, served from the app root) into the seed so the
 * same UI can scale to hundreds of thousands of records; otherwise falls back
 * to the in-repo seed alone so the app always works offline. Also returns the
 * civilization/region filter definitions shipped inside the file.
 */
export async function loadEvents(): Promise<LoadedData> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}events.json`, { cache: 'no-cache' })
    if (res.ok) {
      const data = (await res.json()) as unknown
      if (isCompactPayload(data)) {
        const civs = data.civs ?? []
        tagSeedMasks(civs)
        return { events: mergeWithSeed(expandCompact(data)), civs, regions: data.regions ?? [] }
      }
      // Legacy format: a plain array of HistEvent objects.
      if (Array.isArray(data) && data.length > 0 && data.every(isValidEvent)) {
        return { events: mergeWithSeed(data as HistEvent[]), civs: [], regions: [] }
      }
    }
  } catch {
    // Offline or no generated dataset — fall back to the seed.
  }
  return { events: EVENTS, civs: [], regions: [] }
}
