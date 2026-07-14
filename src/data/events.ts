import type { HistEvent } from '../lib/types'
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
    ...kept.map((g) =>
      g.parentId && remap.has(g.parentId) ? { ...g, parentId: remap.get(g.parentId) } : g,
    ),
  ].sort((a, b) => a.year - b.year)
}

/**
 * Load the event dataset. Merges a generated `events.json` (produced by
 * `npm run fetch:wikidata`, served from the app root) into the seed so the
 * same UI can scale to thousands of records; otherwise falls back to the
 * in-repo seed alone so the app always works offline.
 */
export async function loadEvents(): Promise<HistEvent[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}events.json`, { cache: 'no-cache' })
    if (res.ok) {
      const data = (await res.json()) as unknown
      if (Array.isArray(data) && data.length > 0 && data.every(isValidEvent)) {
        return mergeWithSeed(data as HistEvent[])
      }
    }
  } catch {
    // Offline or no generated dataset — fall back to the seed.
  }
  return EVENTS
}
